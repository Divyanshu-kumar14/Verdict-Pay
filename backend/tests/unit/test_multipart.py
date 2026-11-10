"""RFC 2387 multipart/related round-trip tests (Phase 3.4)."""

from __future__ import annotations

import json
from email import policy
from email.parser import BytesParser

import pytest

from app.domain.evidence.multipart import MultipartPayload, build_multipart_related
from app.domain.protocols import EvidenceDocument, EvidenceSubmission

PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
CSV_BYTES = b"event,units\r\nUSAGE_METERED,42000\r\n"


def _submission(
    *, notes: str = "Delivery proof for the disputed order.", documents=None
) -> EvidenceSubmission:
    docs = documents or (
        EvidenceDocument(name="dossier.pdf", content=PDF_BYTES, content_type="application/pdf"),
    )
    return EvidenceSubmission(
        dispute_id="PP-D-9001",
        evidence_type="PROOF_OF_DELIVERY",
        notes=notes,
        documents=docs,
        idempotency_key="idem-0001",
    )


def _parse(payload: MultipartPayload):
    raw = (
        b"Content-Type: "
        + payload.content_type.encode("ascii")
        + b"\r\nMIME-Version: 1.0\r\n\r\n"
        + payload.body
    )
    return BytesParser(policy=policy.default).parsebytes(raw)


def test_one_document_round_trip() -> None:
    payload = build_multipart_related(_submission())
    message = _parse(payload)
    parts = list(message.iter_parts())
    assert len(parts) == 2

    manifest = json.loads(parts[0].get_payload(decode=True).decode("utf-8"))
    assert manifest == {
        "evidences": [
            {
                "evidence_type": "PROOF_OF_DELIVERY",
                "evidence_info": {"notes": "Delivery proof for the disputed order."},
                "documents": [{"name": "dossier.pdf"}],
            }
        ]
    }
    assert parts[0].get_content_type() == "application/json"
    assert parts[0].get_param("name", header="content-disposition") == "input"
    assert parts[0].get_filename() == "evidence.json"
    assert parts[0].get_content_disposition() == "form-data"

    assert parts[1].get_content_type() == "application/pdf"
    assert parts[1].get_param("name", header="content-disposition") == "file1"
    assert parts[1].get_filename() == "dossier.pdf"
    assert parts[1].get_payload(decode=True) == PDF_BYTES


def test_two_documents_get_file_parts() -> None:
    documents = (
        EvidenceDocument(name="dossier.pdf", content=PDF_BYTES, content_type="application/pdf"),
        EvidenceDocument(name="timeline.png", content=CSV_BYTES, content_type="image/png"),
    )
    payload = build_multipart_related(_submission(documents=documents))
    parts = list(_parse(payload).iter_parts())
    assert len(parts) == 3
    assert parts[1].get_param("name", header="content-disposition") == "file1"
    assert parts[2].get_param("name", header="content-disposition") == "file2"
    assert parts[1].get_payload(decode=True) == PDF_BYTES
    assert parts[2].get_payload(decode=True) == CSV_BYTES
    assert parts[2].get_content_type() == "image/png"


def test_content_type_and_boundary() -> None:
    payload = build_multipart_related(_submission())
    assert payload.content_type == f'multipart/related; boundary="{payload.boundary}"'
    assert f'boundary="{payload.boundary}"' in payload.content_type
    assert payload.boundary.startswith("vp-")
    assert payload.body.startswith(b"--" + payload.boundary.encode("ascii") + b"\r\n")
    assert payload.body.endswith(b"--" + payload.boundary.encode("ascii") + b"--\r\n")


def test_crlf_framing_has_no_preamble() -> None:
    payload = build_multipart_related(_submission())
    boundary = payload.boundary.encode("ascii")
    assert payload.body[: len(boundary) + 2] == b"--" + boundary
    assert b"\r\n\r\n" in payload.body
    assert payload.body.count(b"--" + boundary) == 3
    assert payload.body.startswith(
        b"--"
        + boundary
        + b'\r\nContent-Disposition: form-data; name="input"; '
        + b'filename="evidence.json"\r\nContent-Type: application/json\r\n\r\n'
    )


def test_boundary_is_deterministic() -> None:
    first = build_multipart_related(_submission())
    second = build_multipart_related(_submission())
    assert first.boundary == second.boundary
    assert first.body == second.body

    altered = EvidenceSubmission(
        dispute_id="PP-D-9001",
        evidence_type="PROOF_OF_DELIVERY",
        notes="other",
        documents=_submission().documents,
        idempotency_key="idem-0002",
    )
    assert build_multipart_related(altered).boundary != first.boundary


def test_explicit_boundary_override() -> None:
    payload = build_multipart_related(_submission(), boundary="vp-fixed-boundary")
    assert payload.boundary == "vp-fixed-boundary"
    assert payload.content_type == 'multipart/related; boundary="vp-fixed-boundary"'
    assert len(list(_parse(payload).iter_parts())) == 2


def test_notes_are_truncated_to_2000_chars() -> None:
    payload = build_multipart_related(_submission(notes="x" * 2500))
    manifest = json.loads(
        next(iter(_parse(payload).iter_parts())).get_payload(decode=True).decode("utf-8")
    )
    notes = manifest["evidences"][0]["evidence_info"]["notes"]
    assert len(notes) == 2000
    assert notes == "x" * 2000


def test_unsafe_filename_is_sanitised() -> None:
    document = EvidenceDocument(
        name='dossier"\r\nX-Injected: 1.pdf',
        content=PDF_BYTES,
        content_type="application/pdf",
    )
    payload = build_multipart_related(_submission(documents=(document,)))
    assert b"X-Injected: 1\r\n" not in payload.body.split(b"\r\n\r\n", 1)[0]
    parts = list(_parse(payload).iter_parts())
    assert parts[1].get_filename() == "dossier'X-Injected: 1.pdf"


def test_invalid_boundary_rejected() -> None:
    with pytest.raises(ValueError, match="boundary"):
        build_multipart_related(_submission(), boundary='bad"boundary')


def test_json_body_matches_expected_bytes() -> None:
    payload = build_multipart_related(_submission())
    body_part = next(iter(_parse(payload).iter_parts())).get_payload(decode=True)
    expected = {
        "evidences": [
            {
                "evidence_type": "PROOF_OF_DELIVERY",
                "evidence_info": {"notes": "Delivery proof for the disputed order."},
                "documents": [{"name": "dossier.pdf"}],
            }
        ]
    }
    assert body_part == json.dumps(expected, separators=(",", ":")).encode("utf-8")


# ---------------------------------------------------------- PayPal constraints
def _submission_with(*documents: object, **extra: object) -> object:
    from app.domain.protocols import EvidenceDocument, EvidenceSubmission

    return EvidenceSubmission(
        dispute_id="PP-D-1",
        evidence_type="PROOF_OF_FULFILLMENT",
        notes="n",
        documents=[EvidenceDocument(*doc) for doc in documents],  # type: ignore[misc]
        idempotency_key="k",
        **extra,  # type: ignore[arg-type]
    )


@pytest.mark.parametrize(
    "name,ctype",
    [("a.exe", "application/pdf"), ("a.svg", "image/svg+xml"), ("a.pdf", "text/html")],
)
def test_disallowed_evidence_types_rejected(name: str, ctype: str) -> None:
    from app.domain.evidence.multipart import EvidenceConstraintError, build_multipart_related

    with pytest.raises(EvidenceConstraintError):
        build_multipart_related(_submission_with((name, b"x", ctype)))


def test_file_and_batch_size_limits() -> None:
    from app.domain.evidence.multipart import (
        MAX_FILE_BYTES,
        EvidenceConstraintError,
        build_multipart_related,
    )

    with pytest.raises(EvidenceConstraintError):
        build_multipart_related(
            _submission_with(("a.pdf", b"x" * MAX_FILE_BYTES, "application/pdf"))
        )
    near = b"x" * (MAX_FILE_BYTES - 1)
    with pytest.raises(EvidenceConstraintError):
        build_multipart_related(
            _submission_with(*[(f"f{i}.png", near, "image/png") for i in range(6)])
        )
    build_multipart_related(_submission_with(("ok.jpeg", near, "image/jpeg")))


def test_tracking_info_and_refund_ids_are_validated_and_serialized() -> None:
    import json as _json

    from app.domain.evidence.multipart import EvidenceConstraintError, build_multipart_related

    payload = build_multipart_related(
        _submission_with(
            ("a.pdf", b"%PDF", "application/pdf"),
            tracking_info=[{"carrier_name": "UPS", "tracking_number": "1Z999AA10123456784"}],
            refund_ids=["8KX12345AB678901C"],
        )
    )
    manifest = payload.body.split(b"\r\n\r\n", 1)[1].split(b"\r\n", 1)[0]
    info = _json.loads(manifest)["evidences"][0]["evidence_info"]
    assert info["tracking_info"] == [
        {"carrier_name": "UPS", "tracking_number": "1Z999AA10123456784"}
    ]
    assert info["refund_ids"] == ["8KX12345AB678901C"]
    with pytest.raises(EvidenceConstraintError):
        build_multipart_related(
            _submission_with(
                ("a.pdf", b"%PDF", "application/pdf"),
                tracking_info=[{"carrier_name": "UPS", "tracking_number": "../x"}],
            )
        )
