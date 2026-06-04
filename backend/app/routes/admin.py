"""Admin dashboard routes — 3-tier roles (user / admin / superadmin).

Gating (see app.deps):
- `require_admin`     → admin OR superadmin; non-admins get a generic 404 so
                        the whole /admin surface stays undiscoverable.
- `require_superadmin`→ superadmin only; a plain admin gets 403 (they know the
                        dashboard exists, they just lack this privilege).

Privilege hierarchy for acting on *other* accounts:
- a plain admin may only touch role='user' accounts;
- a superadmin may touch users + admins, but never another super-admin;
- nobody may reset the bootstrap super-admin's password / change its role via
  the API (use scripts/reset_password.py on the host).
"""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import LoginEvent, MaterialFile, MaterialResource, Note, User
from app.deps import get_db, require_admin, require_superadmin
from app.schemas._base import CamelModel, UtcDateTime
from app.schemas.admin import (
    AdminStats,
    AdminUserRow,
    DayCount,
    RecentSignup,
    ResetPasswordIn,
    ResetPasswordOut,
    RoleCount,
    SetRoleIn,
    TopUploader,
    UserCreateIn,
)
from app.services.auth import effective_role, hash_password, is_superadmin
from app.services.greeting import familiar_name
from app.settings import settings

router = APIRouter(prefix="/admin", tags=["admin"])

DEFAULT_PASSWORD = "123456"
# Login-activity sparkline is bucketed by Shanghai calendar day (the app's
# audience), independent of the UTC storage tz.
TZ = ZoneInfo("Asia/Shanghai")
ACTIVITY_DAYS = 14


# ---------------------------------------------------------------------------
# Users table
# ---------------------------------------------------------------------------


@router.get("/users", response_model=list[AdminUserRow])
async def list_users(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[AdminUserRow]:
    """Every user + per-user note / owned-material counts + last-login time.

    One pass: three grouped sub-selects left-joined onto users (no N+1).
    """
    note_counts = (
        select(Note.author_sid.label("sid"), func.count().label("c"))
        .group_by(Note.author_sid)
        .subquery()
    )
    mat_counts = (
        select(MaterialResource.owner_sid.label("sid"), func.count().label("c"))
        .where(MaterialResource.deleted == False)  # noqa: E712
        .group_by(MaterialResource.owner_sid)
        .subquery()
    )
    last_login = (
        select(
            LoginEvent.user_sid.label("sid"),
            func.max(LoginEvent.created_at).label("ts"),
        )
        .group_by(LoginEvent.user_sid)
        .subquery()
    )
    stmt = (
        select(
            User.sid,
            User.name,
            User.nickname,
            User.role,
            User.email,
            User.phone,
            User.avatar_thumb,
            User.created_at,
            func.coalesce(note_counts.c.c, 0).label("note_count"),
            func.coalesce(mat_counts.c.c, 0).label("material_count"),
            last_login.c.ts.label("last_login_at"),
        )
        .outerjoin(note_counts, note_counts.c.sid == User.sid)
        .outerjoin(mat_counts, mat_counts.c.sid == User.sid)
        .outerjoin(last_login, last_login.c.sid == User.sid)
        .order_by(User.created_at.desc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        AdminUserRow(
            sid=r.sid,
            name=r.name,
            nickname=r.nickname,
            role=effective_role_str(r.sid, r.role),
            email=r.email,
            phone=r.phone,
            avatar_thumb=r.avatar_thumb,
            note_count=r.note_count,
            material_count=r.material_count,
            last_login_at=r.last_login_at,
            created_at=r.created_at,
        )
        for r in rows
    ]


def effective_role_str(sid: str, role: str) -> str:
    """Row-level effective role (bootstrap super-admin always wins)."""
    if sid == settings.admin_sid:
        return "superadmin"
    return role or "user"


# ---------------------------------------------------------------------------
# Dashboard stats
# ---------------------------------------------------------------------------


@router.get("/stats", response_model=AdminStats)
async def stats(
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminStats:
    total_users = (await db.execute(select(func.count(User.sid)))).scalar_one()

    role_rows = (await db.execute(select(User.role, func.count()).group_by(User.role))).all()
    role_breakdown = [RoleCount(role=r[0] or "user", count=r[1]) for r in role_rows]
    total_admins = sum(rc.count for rc in role_breakdown if rc.role in ("admin", "superadmin"))

    total_notes = (await db.execute(select(func.count(Note.id)))).scalar_one()
    total_resources = (
        await db.execute(
            select(func.count(MaterialResource.id)).where(
                MaterialResource.deleted == False  # noqa: E712
            )
        )
    ).scalar_one()

    file_filter = (
        MaterialFile.is_folder == False,  # noqa: E712
        MaterialFile.deleted == False,  # noqa: E712
    )
    total_files = (
        await db.execute(select(func.count(MaterialFile.id)).where(*file_filter))
    ).scalar_one()
    total_storage_bytes = (
        await db.execute(
            select(func.coalesce(func.sum(MaterialFile.size_bytes), 0)).where(*file_filter)
        )
    ).scalar_one()

    # --- login activity (last 14 Shanghai days) -------------------------
    today = datetime.now(TZ).date()
    days = [today - timedelta(days=i) for i in range(ACTIVITY_DAYS - 1, -1, -1)]
    buckets: dict[str, int] = {d.isoformat(): 0 for d in days}
    # Lower bound as *naive* UTC so it string-compares correctly against
    # SQLite's naive-UTC storage (see schemas._base note).
    since_utc = (
        datetime.combine(days[0], time.min, tzinfo=TZ).astimezone(timezone.utc).replace(tzinfo=None)
    )
    login_rows = (
        await db.execute(select(LoginEvent.created_at).where(LoginEvent.created_at >= since_utc))
    ).all()
    for (ts,) in login_rows:
        if ts is None:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        key = ts.astimezone(TZ).date().isoformat()
        if key in buckets:
            buckets[key] += 1
    login_activity = [DayCount(date=k, count=v) for k, v in buckets.items()]
    logins_today = buckets[today.isoformat()]

    # --- top uploaders --------------------------------------------------
    top_stmt = (
        select(
            User.sid,
            User.nickname,
            func.count(MaterialFile.id).label("fc"),
            func.coalesce(func.sum(MaterialFile.size_bytes), 0).label("sz"),
        )
        .select_from(MaterialFile)
        .join(MaterialResource, MaterialResource.id == MaterialFile.resource_id)
        .join(User, User.sid == MaterialResource.owner_sid)
        .where(*file_filter, MaterialResource.deleted == False)  # noqa: E712
        .group_by(User.sid, User.nickname)
        .order_by(func.count(MaterialFile.id).desc())
        .limit(5)
    )
    top_uploaders = [
        TopUploader(sid=r.sid, nickname=r.nickname, file_count=r.fc, size_bytes=r.sz)
        for r in (await db.execute(top_stmt)).all()
    ]

    # --- recent signups -------------------------------------------------
    recent_stmt = (
        select(User.sid, User.nickname, User.role, User.created_at)
        .order_by(User.created_at.desc())
        .limit(8)
    )
    recent_signups = [
        RecentSignup(
            sid=r.sid,
            nickname=r.nickname,
            role=effective_role_str(r.sid, r.role),
            created_at=r.created_at,
        )
        for r in (await db.execute(recent_stmt)).all()
    ]

    return AdminStats(
        total_users=total_users,
        total_admins=total_admins,
        total_notes=total_notes,
        total_resources=total_resources,
        total_files=total_files,
        total_storage_bytes=total_storage_bytes,
        logins_today=logins_today,
        role_breakdown=role_breakdown,
        login_activity=login_activity,
        top_uploaders=top_uploaders,
        recent_signups=recent_signups,
    )


# ---------------------------------------------------------------------------
# Import a single user
# ---------------------------------------------------------------------------


@router.post("/users", response_model=AdminUserRow, status_code=201)
async def create_user(
    body: UserCreateIn,
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserRow:
    existing = await db.get(User, body.sid)
    if existing:
        raise HTTPException(status_code=409, detail=f"学号 {body.sid} 已存在")
    name = body.name.strip()
    preferred = (body.preferred_name or "").strip() or familiar_name(name)
    user = User(
        sid=body.sid,
        name=name,
        nickname=name,
        preferred_name=preferred,
        password_hash=hash_password(body.password or DEFAULT_PASSWORD),
        role="user",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return AdminUserRow(
        sid=user.sid,
        name=user.name,
        nickname=user.nickname,
        role="user",
        email=user.email,
        phone=user.phone,
        avatar_thumb=user.avatar_thumb,
        note_count=0,
        material_count=0,
        last_login_at=None,
        created_at=user.created_at,
    )


# ---------------------------------------------------------------------------
# Reset a user's password (admin+, with privilege hierarchy)
# ---------------------------------------------------------------------------


@router.post("/users/{sid}/reset-password", response_model=ResetPasswordOut)
async def reset_password(
    sid: str,
    body: ResetPasswordIn,
    actor: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> ResetPasswordOut:
    target = await db.get(User, sid)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")

    target_role = effective_role(target)
    if target_role == "superadmin":
        raise HTTPException(status_code=403, detail="不能重置超级管理员的密码")
    if target_role == "admin" and not is_superadmin(actor):
        raise HTTPException(status_code=403, detail="只有超级管理员能重置管理员的密码")

    password = body.password or DEFAULT_PASSWORD
    target.password_hash = hash_password(password)
    await db.commit()
    return ResetPasswordOut(sid=sid, password=password)


# ---------------------------------------------------------------------------
# Promote / demote an admin (superadmin only)
# ---------------------------------------------------------------------------


@router.post("/users/{sid}/role", response_model=AdminUserRow)
async def set_role(
    sid: str,
    body: SetRoleIn,
    actor: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> AdminUserRow:
    if sid == actor.sid:
        raise HTTPException(status_code=400, detail="不能修改自己的角色")
    target = await db.get(User, sid)
    if not target:
        raise HTTPException(status_code=404, detail="用户不存在")
    if effective_role(target) == "superadmin":
        raise HTTPException(status_code=403, detail="不能修改超级管理员的角色")

    target.role = body.role
    await db.commit()
    await db.refresh(target)

    note_count = (
        await db.execute(select(func.count(Note.id)).where(Note.author_sid == sid))
    ).scalar_one()
    material_count = (
        await db.execute(
            select(func.count(MaterialResource.id)).where(
                MaterialResource.owner_sid == sid,
                MaterialResource.deleted == False,  # noqa: E712
            )
        )
    ).scalar_one()
    last_login_at = (
        await db.execute(select(func.max(LoginEvent.created_at)).where(LoginEvent.user_sid == sid))
    ).scalar_one()
    return AdminUserRow(
        sid=target.sid,
        name=target.name,
        nickname=target.nickname,
        role=effective_role(target),
        email=target.email,
        phone=target.phone,
        avatar_thumb=target.avatar_thumb,
        note_count=note_count,
        material_count=material_count,
        last_login_at=last_login_at,
        created_at=target.created_at,
    )


# ---------------------------------------------------------------------------
# Login audit (admin+) — pre-existing, now role-gated via require_admin
# ---------------------------------------------------------------------------


class LoginEventOut(CamelModel):
    id: int
    sid: str
    nickname: str
    name: str
    ip: str
    user_agent: str | None = None
    at: UtcDateTime


@router.get("/login-events", response_model=list[LoginEventOut])
async def list_login_events(
    limit: int = Query(default=200, ge=1, le=1000),
    sid: str | None = Query(default=None, description="filter by user sid"),
    _admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[LoginEventOut]:
    stmt = (
        select(
            LoginEvent.id,
            LoginEvent.user_sid,
            LoginEvent.ip,
            LoginEvent.user_agent,
            LoginEvent.created_at,
            User.nickname,
            User.name,
        )
        .join(User, User.sid == LoginEvent.user_sid)
        .order_by(LoginEvent.created_at.desc())
        .limit(limit)
    )
    if sid:
        stmt = stmt.where(LoginEvent.user_sid == sid)
    rows = (await db.execute(stmt)).all()
    return [
        LoginEventOut(
            id=row.id,
            sid=row.user_sid,
            nickname=row.nickname,
            name=row.name,
            ip=row.ip,
            user_agent=row.user_agent,
            at=row.created_at,
        )
        for row in rows
    ]
