"""Deterministic PDF dossier tests (Phase 3.3)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from io import BytesIO

import pytest
from pypdf import PdfReader

from app.api import schemas
from app.domain.evidence.pdf import DossierInput, render_dossier

REASON = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"


def _facts(**overrides: object) -> schemas.CaseFacts:
    base: dict[str, object] = {
        "payer_id": "YRZ829104KLA",
        "chain_valid": True,
        "chain_head": "4" * 64,
        "event_count": 4,
        "completeness": 1.0,
        "tos_version": "v2.4-2026-01",
        "tos_hash": "a" * 64,
        "tos_accepted_at": datetime(2026, 2, 19, 10, 0, tzinfo=UTC),
        "first_seen": datetime(2026, 2, 19, 12, 0, tzinfo=UTC),
        "last_seen": datetime(2026, 2, 22, 12, 0, tzinfo=UTC),
        "ips": ["198.51.100.5", "203.0.113.10"],
        "devices": ["dev-abc", "dev-xyz"],
        "deliveries": [
            {
                "resource_id": "q3_financial_model.xlsx",
                "sha256": "b" * 64,
                "delivered_at": "2026-02-21T12:00:00+00:00",
            }
        ],
        "usage_units": 42000,
        "usage_events": 1,
        "login_count": 5,
        "response_due_date": datetime(2026, 3, 8, 12, 0, tzinfo=UTC),
        "ce3_matches": [
            {
                "transaction_id": "TXN-200",
                "amount_usd": "49.00",
                "status": "COMPLETED",
                "days_ago": 200,
                "matched_on": "ip",
            }
        ],
        "ce3_window_days": 365,
        "signals": {"tos_accepted": True, "ip_match": True},
    }
    base.update(overrides)
    return schemas.CaseFacts(**base)  # type: ignore[arg-type]


NARRATIVE = (
    "Aurora Analytics responds to the dispute filed by payer YRZ829104KLA.\n\n"
    "The accepted Terms of Service version is v2.4-2026-01.\n\n"
    "The telemetry chain head is " + "4" * 64 + ".\n\n"
    "The seller response is submitted before the response deadline."
)


def _dossier(**overrides: object) -> DossierInput:
    base: dict[str, object] = {
        "dispute_id": "PP-D-9001",
        "facts": _facts(),
        "narrative": NARRATIVE,
        "reason_code": REASON,
        "stage": "INQUIRY",
        "amount_usd": Decimal("99.00"),
        "currency": "USD",
        "merchant_name": "Aurora Analytics",
        "generated_at": datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
    }
    base.update(overrides)
    return DossierInput(**base)  # type: ignore[arg-type]


def test_pdf_magic_and_page_count() -> None:
    pdf = render_dossier(_dossier())
    assert pdf.startswith(b"%PDF-1.")
    reader = PdfReader(BytesIO(pdf))
    assert len(reader.pages) >= 2


def test_pdf_text_contains_locked_facts() -> None:
    pdf = render_dossier(_dossier())
    reader = PdfReader(BytesIO(pdf))
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "YRZ829104KLA" in text
    assert "4" * 64 in text
    assert REASON in text
    assert "PP-D-9001" in text
    assert "Seller Protection Evidence Dossier" in text
    assert "Locked Fact Summary" in text
    assert "Evidence Timeline" in text
    assert "Chain of Custody" in text
    assert "Seller Rebuttal" in text
    assert "no facts are model-generated" in text


def test_pdf_is_byte_reproducible() -> None:
    first = render_dossier(_dossier())
    second = render_dossier(_dossier())
    assert first == second
    assert len(first) > 1000


def test_pdf_changes_with_input() -> None:
    first = render_dossier(_dossier())
    second = render_dossier(_dossier(dispute_id="PP-D-9002"))
    assert first != second


def test_pdf_empty_ce3_exhibit_is_safe() -> None:
    facts = _facts(ce3_matches=[], ce3_window_days=0)
    pdf = render_dossier(_dossier(facts=facts))
    reader = PdfReader(BytesIO(pdf))
    raw = "\n".join(page.extract_text() or "" for page in reader.pages)
    text = " ".join(raw.split())
    assert "No prior completed transactions" in text


def test_pdf_rejects_wrong_input_type() -> None:
    with pytest.raises(TypeError, match="DossierInput"):
        render_dossier("not-a-dossier")  # type: ignore[arg-type]


def test_pdf_rejects_non_pdf_facts() -> None:
    with pytest.raises(TypeError, match="CaseFacts"):
        render_dossier(_dossier(facts={"payer_id": "x"}))
