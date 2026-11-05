"""Deterministic seller-protection PDF dossier renderer.

ReportLab platypus only, A4, core fonts, ASCII text. The canvas runs in
ReportLab's invariant mode, so identical input always produces byte-identical
output; no fact is generated at render time (ADR-003).
"""

from __future__ import annotations

import io
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Final

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.api import schemas

_CENTS: Final[Decimal] = Decimal("0.01")
_BODY_FONT: Final[str] = "Helvetica"
_MONO_FONT: Final[str] = "Courier"
_GRID_COLOR = colors.HexColor("#8a8a8a")
_HEADER_FILL = colors.HexColor("#e8e8e8")


@dataclass(frozen=True, slots=True)
class DossierInput:
    """Everything the renderer needs; already locked by the caller."""

    dispute_id: str
    facts: schemas.CaseFacts
    narrative: str
    reason_code: str
    stage: str
    amount_usd: Decimal
    currency: str
    merchant_name: str
    generated_at: datetime
    narrative_source: str = "template"


def _ascii(text: str) -> str:
    """Fold text to ASCII, dropping characters with no ASCII equivalent."""
    normalized = unicodedata.normalize("NFKD", text)
    return normalized.encode("ascii", "ignore").decode("ascii")


def _utc(value: datetime) -> datetime:
    """Return a timezone-aware UTC datetime (naive values are assumed UTC)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _ts(value: datetime | None) -> str:
    """Render a timestamp for the dossier, or a dash when absent."""
    if value is None:
        return "-"
    return _utc(value).strftime("%Y-%m-%d %H:%M:%S UTC")


def _money(value: Decimal) -> str:
    """Render money with two decimals, quantized ROUND_HALF_UP."""
    return str(value.quantize(_CENTS, rounding=ROUND_HALF_UP))


def _styles() -> dict[str, ParagraphStyle]:
    """Build the fixed paragraph style set used by every section."""
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "vp_title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=26,
            alignment=0,
        ),
        "subtitle": ParagraphStyle(
            "vp_subtitle",
            parent=base["Normal"],
            fontName=_BODY_FONT,
            fontSize=12,
            leading=16,
            alignment=0,
        ),
        "meta": ParagraphStyle(
            "vp_meta",
            parent=base["Normal"],
            fontName=_BODY_FONT,
            fontSize=9,
            leading=12,
            alignment=0,
        ),
        "heading": ParagraphStyle(
            "vp_heading",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            spaceBefore=2,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            "vp_body",
            parent=base["BodyText"],
            fontName=_BODY_FONT,
            fontSize=9.5,
            leading=13,
        ),
        "cell": ParagraphStyle(
            "vp_cell",
            parent=base["BodyText"],
            fontName=_BODY_FONT,
            fontSize=8,
            leading=10,
        ),
        "mono": ParagraphStyle(
            "vp_mono",
            parent=base["BodyText"],
            fontName=_MONO_FONT,
            fontSize=6.5,
            leading=8.5,
            wordWrap="CJK",
        ),
    }


def _make_footer(narrative_source: str) -> Any:
    """Return a deterministic footer callback that names the narrative source."""
    footer_text = (
        f"Narrative source: {_ascii(narrative_source)}. Facts were locked before generation; "
        "model prose is validated against the fact pack; no fact is model-generated."
    )

    def _footer(canvas: Canvas, doc: Any) -> None:
        canvas.saveState()
        canvas.setFont(_BODY_FONT, 7)
        canvas.setFillColor(colors.HexColor("#444444"))
        canvas.drawString(18 * mm, 10 * mm, footer_text)
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    return _footer


def _heading(text: str, styles: dict[str, ParagraphStyle]) -> Paragraph:
    """Render one section heading."""
    return Paragraph(_ascii(text), styles["heading"])


def _table(
    rows: list[list[Any]],
    widths: list[float],
    *,
    header: bool = False,
    span_empty: bool = False,
) -> Table:
    """Build a standard, consistently styled table."""
    table = Table(rows, colWidths=widths, hAlign="LEFT")
    commands: list[tuple[Any, ...]] = [
        ("GRID", (0, 0), (-1, -1), 0.5, _GRID_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ]
    if header:
        commands.append(("BACKGROUND", (0, 0), (-1, 0), _HEADER_FILL))
        commands.append(("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"))
    if span_empty:
        commands.append(("SPAN", (0, 0), (-1, 0)))
    table.setStyle(TableStyle(commands))
    return table


def _kv_rows(rows: list[tuple[str, str]], styles: dict[str, ParagraphStyle]) -> Table:
    """Render a label/value table with monospaced values."""
    data: list[list[Any]] = [
        [
            Paragraph(_ascii(label), styles["cell"]),
            Paragraph(_ascii(value), styles["mono"]),
        ]
        for label, value in rows
    ]
    return _table(data, [135, 360])


def _cover(inputs: DossierInput, styles: dict[str, ParagraphStyle]) -> list[Any]:
    """Build the cover page flowables."""
    facts = inputs.facts
    story: list[Any] = [
        Spacer(1, 28 * mm),
        Paragraph("VerdictPay", styles["title"]),
        Paragraph("Seller Protection Evidence Dossier", styles["subtitle"]),
        Spacer(1, 8 * mm),
        _kv_rows(
            [
                ("Dispute ID", inputs.dispute_id),
                ("Merchant", inputs.merchant_name),
                ("Amount", f"{inputs.currency} {_money(inputs.amount_usd)}"),
                ("Reason code", inputs.reason_code),
                ("Stage", inputs.stage),
                ("Generated at", _ts(inputs.generated_at)),
                ("Chain head", facts.chain_head or "not recorded"),
            ],
            styles,
        ),
        Spacer(1, 8 * mm),
        Paragraph(
            _ascii(
                "This dossier is assembled from the merchant's append-only "
                "telemetry ledger. The narrative cites only locked facts and can be "
                "reproduced from the chain head above."
            ),
            styles["body"],
        ),
    ]
    return story


def _locked_fact_summary(inputs: DossierInput, styles: dict[str, ParagraphStyle]) -> Table:
    """Build the Locked Fact Summary table."""
    facts = inputs.facts
    rows: list[tuple[str, str]] = [
        ("Payer ID", facts.payer_id),
        ("Dispute ID", inputs.dispute_id),
        ("Amount", f"{inputs.currency} {_money(inputs.amount_usd)}"),
        ("Reason code", inputs.reason_code),
        ("Stage", inputs.stage),
        ("Response due", _ts(facts.response_due_date)),
        ("ToS version", facts.tos_version or "not recorded"),
        ("ToS SHA-256", facts.tos_hash or "not recorded"),
        ("ToS accepted at", _ts(facts.tos_accepted_at)),
        ("First seen", _ts(facts.first_seen)),
        ("Last seen", _ts(facts.last_seen)),
        ("Login count", str(facts.login_count)),
        ("Event count", str(facts.event_count)),
        ("Distinct IPs", str(len(facts.ips))),
        ("Distinct devices", str(len(facts.devices))),
        ("Metered units", str(facts.usage_units)),
        ("Usage events", str(facts.usage_events)),
        ("Completeness", f"{facts.completeness:.4f}"),
        ("Chain head", facts.chain_head or "not recorded"),
        ("Chain status", "valid" if facts.chain_valid else "invalid"),
    ]
    return _kv_rows(rows, styles)


def _evidence_timeline(inputs: DossierInput, styles: dict[str, ParagraphStyle]) -> Table:
    """Build the Evidence Timeline table of deliveries, usage and consent."""
    facts = inputs.facts
    header = ["Kind", "Occurred (UTC)", "Reference", "Units"]
    data: list[list[Any]] = [[Paragraph(_ascii(cell), styles["cell"]) for cell in header]]

    tos_ref = (
        f"version {facts.tos_version or 'not recorded'}; "
        f"sha256 {facts.tos_hash or 'not recorded'}"
    )
    data.append(
        [
            Paragraph("Terms accepted", styles["cell"]),
            Paragraph(_ts(facts.tos_accepted_at), styles["cell"]),
            Paragraph(_ascii(tos_ref), styles["mono"]),
            Paragraph("-", styles["cell"]),
        ]
    )
    if facts.deliveries:
        for delivery in facts.deliveries:
            reference = (
                f"resource {delivery.get('resource_id') or 'unnamed'}; "
                f"sha256 {delivery.get('sha256') or 'not recorded'}"
            )
            data.append(
                [
                    Paragraph("Asset delivery", styles["cell"]),
                    Paragraph(_ascii(str(delivery.get("delivered_at") or "-")), styles["cell"]),
                    Paragraph(_ascii(reference), styles["mono"]),
                    Paragraph("-", styles["cell"]),
                ]
            )
    else:
        data.append(
            [
                Paragraph("Asset delivery", styles["cell"]),
                Paragraph("-", styles["cell"]),
                Paragraph("no delivery recorded", styles["mono"]),
                Paragraph("-", styles["cell"]),
            ]
        )
    data.append(
        [
            Paragraph("Login sessions", styles["cell"]),
            Paragraph(_ts(facts.last_seen), styles["cell"]),
            Paragraph(f"{facts.login_count} authenticated logins", styles["mono"]),
            Paragraph("-", styles["cell"]),
        ]
    )
    data.append(
        [
            Paragraph("Metered usage", styles["cell"]),
            Paragraph(_ts(facts.last_seen), styles["cell"]),
            Paragraph(f"{facts.usage_events} usage events", styles["mono"]),
            Paragraph(str(facts.usage_units), styles["cell"]),
        ]
    )
    return _table(data, [78, 92, 245, 40], header=True)


def _chain_of_custody(inputs: DossierInput, styles: dict[str, ParagraphStyle]) -> Table:
    """Build the Chain of Custody table."""
    facts = inputs.facts
    rows: list[tuple[str, str]] = [
        ("Chain head", facts.chain_head or "not recorded"),
        ("Algorithm", "SHA-256 chained per merchant and payer stream"),
        ("Event count", str(facts.event_count)),
        ("Verification", "valid" if facts.chain_valid else "invalid"),
        ("Ledger", "append-only telemetry_ledger (no updates, no deletes)"),
    ]
    return _kv_rows(rows, styles)


def _ce3_exhibit(inputs: DossierInput, styles: dict[str, ParagraphStyle]) -> Table:
    """Build the Visa Compelling Evidence exhibit table (empty-safe)."""
    facts = inputs.facts
    header = ["Transaction", "Amount (USD)", "Status", "Days ago", "Matched on"]
    data: list[list[Any]] = [[Paragraph(_ascii(cell), styles["cell"]) for cell in header]]
    if facts.ce3_matches:
        for match in facts.ce3_matches:
            data.append(
                [
                    Paragraph(_ascii(str(match.get("transaction_id"))), styles["mono"]),
                    Paragraph(_ascii(str(match.get("amount_usd"))), styles["cell"]),
                    Paragraph(_ascii(str(match.get("status"))), styles["cell"]),
                    Paragraph(str(match.get("days_ago")), styles["cell"]),
                    Paragraph(_ascii(str(match.get("matched_on"))), styles["cell"]),
                ]
            )
        return _table(data, [110, 80, 80, 60, 90], header=True)
    data.append(
        [
            Paragraph(
                "No prior completed transactions share the payer's IP address or device "
                "fingerprint in the lookback window.",
                styles["cell"],
            ),
            "",
            "",
            "",
            "",
        ]
    )
    return _table(data, [110, 80, 80, 60, 90], header=True, span_empty=True)


def _rebuttal(inputs: DossierInput, styles: dict[str, ParagraphStyle]) -> list[Any]:
    """Build the Seller Rebuttal paragraphs from the locked narrative."""
    paragraphs = [part.strip() for part in inputs.narrative.split("\n\n") if part.strip()]
    if not paragraphs:
        paragraphs = ["No narrative was produced for this dossier."]
    return [Paragraph(_ascii(part), styles["body"]) for part in paragraphs]


def render_dossier(inputs: DossierInput) -> bytes:
    """Render the complete deterministic dossier as PDF bytes."""
    if not isinstance(inputs, DossierInput):
        raise TypeError("inputs must be a DossierInput instance")
    if not isinstance(inputs.facts, schemas.CaseFacts):
        raise TypeError("facts must be a schemas.CaseFacts instance")
    if not inputs.dispute_id or not inputs.reason_code or not inputs.stage:
        raise ValueError("dispute_id, reason_code and stage must be non-empty")
    if not isinstance(inputs.amount_usd, Decimal):
        raise TypeError("amount_usd must be a Decimal")
    if inputs.amount_usd < 0:
        raise ValueError("amount_usd must be non-negative")
    if not isinstance(inputs.generated_at, datetime):
        raise TypeError("generated_at must be a datetime")

    styles = _styles()
    buffer = io.BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title=f"VerdictPay dossier {inputs.dispute_id}",
        author="VerdictPay",
        subject="Seller protection evidence dossier",
        creator="VerdictPay deterministic renderer",
        invariant=1,
    )
    story: list[Any] = []
    story.extend(_cover(inputs, styles))
    story.append(PageBreak())
    story.append(_heading("1. Locked Fact Summary", styles))
    story.append(_locked_fact_summary(inputs, styles))
    story.append(Spacer(1, 5 * mm))
    story.append(_heading("2. Evidence Timeline", styles))
    story.append(_evidence_timeline(inputs, styles))
    story.append(Spacer(1, 5 * mm))
    story.append(_heading("3. Chain of Custody", styles))
    story.append(_chain_of_custody(inputs, styles))
    story.append(Spacer(1, 5 * mm))
    story.append(_heading("4. Visa Compelling Evidence 3.0 Exhibit", styles))
    story.append(_ce3_exhibit(inputs, styles))
    story.append(PageBreak())
    story.append(_heading("5. Seller Rebuttal", styles))
    story.extend(_rebuttal(inputs, styles))

    footer = _make_footer(inputs.narrative_source)
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
