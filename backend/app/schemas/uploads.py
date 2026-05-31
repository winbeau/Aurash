"""Upload schemas — mirrors frontend src/api/endpoints/uploads.ts."""
from app.schemas._base import CamelModel


class UploadedImage(CamelModel):
    """Response from POST /notes/images: served-back absolute URL the
    frontend writes into the markdown body as `![](url)`."""

    url: str


class UploadedFile(CamelModel):
    """Response from POST /notes/files: a doc attachment the frontend writes
    into the markdown body as `[filename](url)` and renders as a FileCard.

    No `mime` field — the FileCard dispatches preview/icon purely by the
    extension (`kindOf`), so a wire MIME would be a dead field (and the
    client-supplied Content-Type is forgeable anyway). Per the
    plan-file-upload §7 "删死字段" revision.
    """

    url: str
    filename: str
    size: int
