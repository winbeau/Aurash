"""UGC overlay for schools rows.

Placeholder layer: this is where per-user note counts and starred state
will eventually be joined onto advisor rows. Today the tables don't exist
yet (`note.advisor_ref` / `advisor_star` are explicit future-extension
points — see docs/plan-schools-integration.md §3.5), so we just hardcode
``note_count=0`` and ``is_starred=False`` on each row.

Keeping the call site stable means the route code doesn't need to change
when the real implementation lands.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import User


async def overlay_ugc(
    main_db: AsyncSession,  # noqa: ARG001 — wired for future use
    user: User | None,  # noqa: ARG001
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Fill ``note_count`` / ``is_starred`` on each row in place."""
    for r in rows:
        r.setdefault("note_count", 0)
        r.setdefault("is_starred", False)
    return rows


async def overlay_ugc_detail(
    main_db: AsyncSession,
    user: User | None,
    row: dict[str, Any],
) -> dict[str, Any]:
    """Same as overlay_ugc but for a single detail row."""
    await overlay_ugc(main_db, user, [row])
    return row
