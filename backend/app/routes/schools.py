"""HTTP routes for /schools/* and /admin/schools/*.

Wire format is snake_case (see app/schemas/_base.py::SnakeModel for why
this domain breaks from site-wide camelCase). When the schools.sqlite
file is missing all /schools/* read endpoints return 503 — the rest of
the API (notes, drafts, etc.) keeps working.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User
from app.db.schools_engine import SchoolsDataMissing, SchoolsEngineHolder, get_holder
from app.deps import get_db, get_optional_user
from app.routes.admin import require_admin
from app.schemas.school import (
    AdvisorDetail,
    AdvisorRow,
    ManifestOut,
    PaginatedAdvisors,
    ReloadResult,
    SchoolsMeta,
)
from app.services.schools_overlay import overlay_ugc, overlay_ugc_detail
from app.services.schools_query import (
    AdvisorFilters,
    SortSpec,
    query_advisor_detail,
    query_advisor_rows,
    query_schools_meta,
)

router = APIRouter(tags=["schools"])


def _get_holder() -> SchoolsEngineHolder:
    return get_holder()


def _manifest_or_none(holder: SchoolsEngineHolder) -> ManifestOut | None:
    m = holder.manifest
    if not m:
        return None
    return ManifestOut.model_validate(m)


async def _session_for(holder: SchoolsEngineHolder) -> AsyncSession:
    try:
        engine = await holder.get_engine()
    except SchoolsDataMissing as exc:
        raise HTTPException(
            status_code=503,
            detail="schools data not ready",
        ) from exc
    return AsyncSession(engine, expire_on_commit=False)


@router.get("/schools/meta", response_model=SchoolsMeta)
async def schools_meta(
    holder: SchoolsEngineHolder = Depends(_get_holder),
) -> SchoolsMeta:
    session = await _session_for(holder)
    try:
        data = await query_schools_meta(session)
    finally:
        await session.close()
    return SchoolsMeta(
        schools=data["schools"],
        titles=data["titles"],
        manifest=_manifest_or_none(holder),
    )


@router.get("/schools/list", response_model=PaginatedAdvisors)
async def schools_list(
    school: list[str] = Query(default=[]),
    dept: list[str] = Query(default=[]),
    title: list[str] = Query(default=[]),
    recruit: list[Literal["yes", "no", "unk"]] = Query(default=[]),
    rep: list[str] = Query(default=[]),
    q: str | None = None,
    has_email: bool = False,
    has_summary: bool = False,
    sort_key: Literal["default", "name", "recruit", "rep", "updated"] = "default",
    sort_dir: Literal["asc", "desc"] = "desc",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    holder: SchoolsEngineHolder = Depends(_get_holder),
    main_db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
) -> PaginatedAdvisors:
    filters = AdvisorFilters(
        schools=list(school),
        depts=list(dept),
        titles=list(title),
        recruit=list(recruit),
        reps=list(rep),
        q=q,
        has_email=has_email,
        has_summary=has_summary,
    )
    sort = SortSpec(key=sort_key, dir=sort_dir)
    session = await _session_for(holder)
    try:
        rows, total = await query_advisor_rows(
            session, filters=filters, sort=sort, page=page, page_size=page_size
        )
    finally:
        await session.close()
    rows = await overlay_ugc(main_db, user, rows)
    return PaginatedAdvisors(
        items=[AdvisorRow.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/schools/{advisor_id}", response_model=AdvisorDetail)
async def schools_detail(
    advisor_id: int,
    holder: SchoolsEngineHolder = Depends(_get_holder),
    main_db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
) -> AdvisorDetail:
    session = await _session_for(holder)
    try:
        detail = await query_advisor_detail(session, advisor_id)
    finally:
        await session.close()
    if detail is None:
        raise HTTPException(status_code=404, detail="advisor not found")
    detail = await overlay_ugc_detail(main_db, user, detail)
    return AdvisorDetail.model_validate(detail)


@router.post("/admin/schools/reload", response_model=ReloadResult)
async def schools_reload(
    _admin: User = Depends(require_admin),
    holder: SchoolsEngineHolder = Depends(_get_holder),
) -> ReloadResult:
    ok = await holder.force_reload()
    return ReloadResult(ok=ok, manifest=_manifest_or_none(holder))
