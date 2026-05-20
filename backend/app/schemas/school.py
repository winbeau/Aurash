"""Pydantic schemas for the /schools/* domain.

Wire format here is snake_case — see app/schemas/_base.py::SnakeModel for
why this is the only place we break from site-wide camelCase. Field shapes
mirror frontend/src/features/schools/types.ts exactly so the frontend's
type definitions stay untouched.
"""
from __future__ import annotations

from typing import Literal

from app.schemas._base import SnakeModel, UtcDateTime

Reputation = Literal["positive", "neutral", "negative", "unknown"]
Degree = Literal["PhD", "MS", "Postdoc"]
RecruitFilter = Literal["yes", "no", "unk"]
SortKey = Literal["default", "name", "recruit", "rep", "updated"]
SortDir = Literal["asc", "desc"]


class SchoolRef(SnakeModel):
    code: str
    name_cn: str


class DeptRef(SnakeModel):
    code: str
    name_cn: str


class Quota(SnakeModel):
    year: int | None = None
    degree: Degree | None = None
    count: int | None = None
    confidence: float | None = None
    raw_text: str
    source_url: str | None = None


class Evaluation(SnakeModel):
    source: str
    source_url: str | None = None
    content: str
    rating: float | None = None
    posted_at: UtcDateTime | None = None


class TraceItem(SnakeModel):
    kind: str
    label: str
    detail: str


class AdvisorBase(SnakeModel):
    id: int
    school: SchoolRef
    departments: list[DeptRef]
    name_cn: str
    name_en: str | None = None
    title: str | None = None
    homepage: str
    source_url: str
    email: str | None = None
    email_obfuscated: bool
    research_interests: list[str]
    is_recruiting: bool | None = None
    recruiting_confidence: float | None = None
    reputation_tag: Reputation | None = None
    enriched_summary: str | None = None
    last_enriched_at: UtcDateTime | None = None
    # UGC overlay (filled by services/schools_overlay.py — placeholder for now)
    note_count: int = 0
    is_starred: bool = False


class AdvisorRow(AdvisorBase):
    """Slim row for the table view — no nested quotas/evaluations/trace."""


class AdvisorDetail(AdvisorBase):
    """Full detail for the drawer."""

    phone: str | None = None
    photo_url: str | None = None
    bio_text: str | None = None
    quotas: list[Quota]
    evaluations: list[Evaluation]
    trace: list[TraceItem]


class PaginatedAdvisors(SnakeModel):
    items: list[AdvisorRow]
    total: int
    page: int
    page_size: int


class SchoolMetaItem(SnakeModel):
    code: str
    name_cn: str
    name_en: str | None = None
    count: int
    departments: list[DeptRef]


class ManifestOut(SnakeModel):
    schema_version: int | None = None
    exported_at: str | None = None
    claw_version: str | None = None
    schools_sqlite_sha256: str | None = None
    schools_sqlite_bytes: int | None = None
    counts: dict[str, int] | None = None


class SchoolsMeta(SnakeModel):
    schools: list[SchoolMetaItem]
    titles: list[str]
    manifest: ManifestOut | None = None


class ReloadResult(SnakeModel):
    ok: bool
    manifest: ManifestOut | None = None
