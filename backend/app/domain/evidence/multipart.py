"""RFC 2387 multipart/related builder for PayPal evidence uploads.

PayPal's provide-evidence endpoint takes a multipart/related body whose first
part ("input") is the JSON manifest and whose remaining parts ("file1",
"file2", ...) are the attached documents. The boundary is derived from the
submission identity so the same submission always serializes identically.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.domain.protocols import EvidenceSubmission

_CRLF = b"\r\n"
_MAX_NOTES = 2000
_BOUNDARY_RE = re.compile(r"^[A-Za-z0-9._-]{1,70}$")


@dataclass(frozen=True, slots=True)
class MultipartPayload:
    """A ready-to-send multipart/related body plus its exact content type."""

    content_type: str
    body: bytes
    boundary: str


def _safe_filename(name: str) -> str:
    """Strip characters that would break a Content-Disposition header."""
    cleaned = name.replace("\r", "").replace("\n", "").replace('"', "'").strip()
    return cleaned or "document.pdf"


def _safe_content_type(content_type: str) -> str:
    """Reject a document content type that could inject header lines."""
    cleaned = content_type.strip()
    if not cleaned or "\r" in cleaned or "\n" in cleaned:
        return "application/octet-stream"
    return cleaned


def _boundary_for(submission: EvidenceSubmission) -> str:
    """Derive a stable boundary from the idempotency identity of the upload."""
    digest = hashlib.sha256(
        f"{submission.dispute_id}:{submission.idempotency_key}".encode()
    ).hexdigest()
    return f"vp-{digest[:24]}"


def _validate(submission: EvidenceSubmission, boundary: str | None) -> None:
    """Reject malformed submissions and unsafe explicit boundaries."""
    if not isinstance(submission, EvidenceSubmission):
        raise TypeError("submission must be an EvidenceSubmission instance")
    if not submission.dispute_id:
        raise ValueError("dispute_id must be non-empty")
    if not submission.evidence_type:
        raise ValueError("evidence_type must be non-empty")
    if not isinstance(submission.documents, Sequence):
        raise TypeError("documents must be a sequence")
    if boundary is not None and not _BOUNDARY_RE.match(boundary):
        raise ValueError("boundary must match [A-Za-z0-9._-]{1,70}")


def _part(
    boundary: str,
    *,
    disposition: str,
    content_type: str,
    content: bytes,
) -> bytes:
    """Serialize one MIME part with CRLF framing and no preamble."""
    return b"".join(
        (
            b"--" + boundary.encode("ascii") + _CRLF,
            b"Content-Disposition: " + disposition.encode("utf-8") + _CRLF,
            b"Content-Type: " + content_type.encode("ascii") + _CRLF,
            _CRLF,
            content,
            _CRLF,
        )
    )


def build_multipart_related(
    submission: EvidenceSubmission,
    *,
    boundary: str | None = None,
) -> MultipartPayload:
    """Build the multipart/related evidence payload for one submission."""
    _validate(submission, boundary)
    resolved_boundary = boundary or _boundary_for(submission)

    notes = submission.notes or ""
    if len(notes) > _MAX_NOTES:
        notes = notes[:_MAX_NOTES]
    manifest = {
        "evidences": [
            {
                "evidence_type": submission.evidence_type,
                "evidence_info": {"notes": notes},
                "documents": [{"name": document.name} for document in submission.documents],
            }
        ]
    }
    manifest_bytes = json.dumps(
        manifest, ensure_ascii=True, separators=(",", ":")
    ).encode("utf-8")

    chunks = [
        _part(
            resolved_boundary,
            disposition='form-data; name="input"; filename="evidence.json"',
            content_type="application/json",
            content=manifest_bytes,
        )
    ]
    for index, document in enumerate(submission.documents, start=1):
        chunks.append(
            _part(
                resolved_boundary,
                disposition=(
                    f'form-data; name="file{index}"; '
                    f'filename="{_safe_filename(document.name)}"'
                ),
                content_type=_safe_content_type(document.content_type),
                content=document.content,
            )
        )
    chunks.append(b"--" + resolved_boundary.encode("ascii") + b"--" + _CRLF)

    return MultipartPayload(
        content_type=f'multipart/related; boundary="{resolved_boundary}"',
        body=b"".join(chunks),
        boundary=resolved_boundary,
    )
