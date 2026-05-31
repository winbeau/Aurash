"""Doc-attachment upload route — POST /notes/files.

Companion to test_image_upload.py: same `_isolate_uploads` / monkeypatch
idiom, but for the writing-pane doc attachments (pdf / word / ppt /
excel) that flow through `uploads_common.save_upload`.

We deliberately build OOXML payloads with stdlib `zipfile` (no
python-docx / openpyxl — the backend has no new deps): a real .docx /
.xlsx is just a zip carrying `[Content_Types].xml` plus the subtype's
directory prefix (`word/`, `xl/`, `ppt/`), which is exactly what
`uploads_common.sniff_magic` verifies. PDF is just `%PDF-...`.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.routes import uploads as uploads_route
from app.services import uploads_common

# --- demo account (conftest.demo_user) -----------------------------------
_SID = "20211010001"


# --- payload builders -----------------------------------------------------
def _pdf_bytes() -> bytes:
    """Minimal but magic-valid PDF (`sniff_magic` only checks `%PDF-`)."""
    return b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


def _ooxml_bytes(dir_prefix: str) -> bytes:
    """A zip carrying `[Content_Types].xml` + one entry under `dir_prefix`.

    `dir_prefix` is `word/` (docx) / `xl/` (xlsx) / `ppt/` (pptx) — the
    real OOXML directory the sniffer keys on.
    """
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?><Types/>',
        )
        zf.writestr(f"{dir_prefix}document.xml", "<doc/>")
    return buf.getvalue()


def _docx_bytes() -> bytes:
    return _ooxml_bytes("word/")


def _xlsx_bytes() -> bytes:
    return _ooxml_bytes("xl/")


@pytest.fixture(autouse=True)
def _isolate_uploads(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirect FILE_DIR to a per-test tmp_path so disk artifacts vanish on
    teardown and parallel tests don't collide."""
    file_dir = tmp_path / "notes"
    monkeypatch.setattr(uploads_route, "FILE_DIR", file_dir)
    return file_dir


# --- happy paths ----------------------------------------------------------
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("name", "data_fn", "ctype"),
    [
        ("report.pdf", _pdf_bytes, "application/pdf"),
        (
            "notes.docx",
            _docx_bytes,
            "application/vnd.openxmlformats-officedocument"
            ".wordprocessingml.document",
        ),
        (
            "sheet.xlsx",
            _xlsx_bytes,
            "application/vnd.openxmlformats-officedocument"
            ".spreadsheetml.sheet",
        ),
    ],
)
async def test_upload_file_happy_path(
    client: AsyncClient,
    auth_headers: dict[str, str],
    _isolate_uploads: Path,
    name: str,
    data_fn,
    ctype: str,
) -> None:
    data = data_fn()
    r = await client.post(
        "/notes/files",
        files={"file": (name, data, ctype)},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # Response shape: {url, filename, size}.
    assert body["url"].startswith("http")
    assert f"/uploads/notes/{_SID}/" in body["url"]
    ext = Path(name).suffix
    assert body["url"].endswith(ext)
    assert body["filename"] == name  # no meta-chars → unchanged display name
    assert body["size"] == len(data)
    # File actually written under the monkeypatched FILE_DIR/<sid>/.
    fname = body["url"].rsplit("/", 1)[-1]
    written = _isolate_uploads / _SID / fname
    assert written.exists()
    assert written.read_bytes() == data


@pytest.mark.asyncio
async def test_upload_file_sanitizes_display_name(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """A filename with markdown meta-chars is escaped in the returned
    `filename` (so the `[name](url)` link can't be broken/injected), while
    the on-disk name stays server-generated (`<ts>-<rand>.pdf`)."""
    r = await client.post(
        "/notes/files",
        files={"file": ("a](http://evil).pdf", _pdf_bytes(), "application/pdf")},
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    # `]` `(` `)` escaped with backslashes by safe_display_name.
    assert body["filename"] == "a\\]\\(http://evil\\).pdf"
    # On-disk basename is never the user string.
    assert "evil" not in body["url"].rsplit("/", 1)[-1]


# --- auth -----------------------------------------------------------------
@pytest.mark.asyncio
async def test_upload_file_requires_auth(client: AsyncClient) -> None:
    r = await client.post(
        "/notes/files",
        files={"file": ("report.pdf", _pdf_bytes(), "application/pdf")},
    )
    assert r.status_code == 401


# --- allowlist / deny-list ------------------------------------------------
@pytest.mark.asyncio
async def test_upload_file_rejects_unknown_ext(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await client.post(
        "/notes/files",
        files={"file": ("notes.txt", b"plain text", "text/plain")},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "仅支持" in r.json()["detail"]


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["payload.svg", "page.html", "x.htm", "feed.xml"])
async def test_upload_file_rejects_denied_ext(
    client: AsyncClient, auth_headers: dict[str, str], name: str
) -> None:
    """Explicit DENY_EXTS — browser-executable types refused even though a
    naive check might let them through (stored-XSS defense)."""
    r = await client.post(
        "/notes/files",
        files={"file": (name, b"<svg/>", "image/svg+xml")},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "不被允许" in r.json()["detail"]


# --- size cap -------------------------------------------------------------
@pytest.mark.asyncio
async def test_upload_file_rejects_oversize(
    client: AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Cap below a trivial PDF so we exercise the streamed abort without
    pushing 50 MB through the test loop. MAX lives on uploads_common (the
    util owns the streaming write), not on the route module."""
    monkeypatch.setattr(uploads_common, "MAX_UPLOAD_BYTES", 8)
    big = _pdf_bytes()
    assert len(big) > 8
    r = await client.post(
        "/notes/files",
        files={"file": ("big.pdf", big, "application/pdf")},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "50 MB" in r.json()["detail"]


# --- magic-byte sniffing --------------------------------------------------
@pytest.mark.asyncio
async def test_upload_file_rejects_spoofed_pdf(
    client: AsyncClient,
    auth_headers: dict[str, str],
    _isolate_uploads: Path,
) -> None:
    """A `.pdf` whose bytes aren't actually `%PDF-` → 400, no orphan left."""
    r = await client.post(
        "/notes/files",
        files={"file": ("fake.pdf", b"hello world not a pdf", "application/pdf")},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "类型不符" in r.json()["detail"]
    # Partial temp file unlinked — the <sid> dir is empty (or absent).
    sid_dir = _isolate_uploads / _SID
    assert not sid_dir.exists() or not any(sid_dir.iterdir())


@pytest.mark.asyncio
async def test_upload_file_rejects_ooxml_subtype_mismatch(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """An .xlsx renamed to .docx: it's a valid zip with the OOXML manifest
    but only the `xl/` prefix, so the `.docx` sniff (which requires `word/`)
    must reject it."""
    r = await client.post(
        "/notes/files",
        files={
            "file": (
                "mislabeled.docx",
                _xlsx_bytes(),  # has xl/, not word/
                "application/vnd.openxmlformats-officedocument"
                ".wordprocessingml.document",
            )
        },
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "类型不符" in r.json()["detail"]


# --- empty body -----------------------------------------------------------
@pytest.mark.asyncio
async def test_upload_file_rejects_empty(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    r = await client.post(
        "/notes/files",
        files={"file": ("empty.pdf", b"", "application/pdf")},
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "为空" in r.json()["detail"]


# --- concurrent same-name uploads don't collide --------------------------
@pytest.mark.asyncio
async def test_upload_file_same_name_no_clobber(
    client: AsyncClient,
    auth_headers: dict[str, str],
    _isolate_uploads: Path,
) -> None:
    """Two uploads of the same display name get distinct on-disk basenames
    (`<ts>-<rand>.ext`), so neither clobbers the other."""
    data = _pdf_bytes()
    urls = []
    for _ in range(2):
        r = await client.post(
            "/notes/files",
            files={"file": ("dup.pdf", data, "application/pdf")},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        urls.append(r.json()["url"])

    names = [u.rsplit("/", 1)[-1] for u in urls]
    assert names[0] != names[1], "same-name uploads collided on disk"
    sid_dir = _isolate_uploads / _SID
    assert {p.name for p in sid_dir.iterdir()} == set(names)
