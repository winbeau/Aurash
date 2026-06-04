"""Schemas for the /admin dashboard (mirrors frontend features/admin).

Wire format is camelCase (CamelModel). These are admin-only payloads —
`AdminUserRow` intentionally carries contact + audit fields that the public
`UserOut` never leaks, because only admins ever see this surface.
"""

from typing import Literal

from pydantic import Field

from app.schemas._base import CamelModel, UtcDateTime

# The two roles a super-admin may assign via the UI. 'superadmin' is NOT
# assignable (bootstrap-only, see services.auth.effective_role).
AssignableRole = Literal["user", "admin"]


class AdminUserRow(CamelModel):
    """One row in the admin user table."""

    sid: str
    name: str
    nickname: str
    role: str
    email: str | None = None
    phone: str | None = None
    avatar_thumb: str | None = None
    note_count: int = 0
    material_count: int = 0
    last_login_at: UtcDateTime | None = None
    created_at: UtcDateTime | None = None


class UserCreateIn(CamelModel):
    """POST /admin/users — import a single user (default password applied)."""

    sid: str = Field(pattern=r"^\d{11}$", description="11-digit student ID")
    name: str = Field(min_length=1, max_length=120)
    preferred_name: str | None = Field(default=None, min_length=1, max_length=120)
    # Optional initial password; falls back to the shared default (123456).
    password: str | None = Field(default=None, min_length=6, max_length=128)


class ResetPasswordIn(CamelModel):
    """POST /admin/users/{sid}/reset-password — omit password ⇒ default 123456."""

    password: str | None = Field(default=None, min_length=6, max_length=128)


class ResetPasswordOut(CamelModel):
    sid: str
    # Echo the password that was set so the admin can hand it to the user.
    password: str


class SetRoleIn(CamelModel):
    """POST /admin/users/{sid}/role — promote/demote (super-admin only)."""

    role: AssignableRole


# --- /admin/stats ----------------------------------------------------------


class RoleCount(CamelModel):
    role: str
    count: int


class DayCount(CamelModel):
    """One bucket of the login-activity sparkline (YYYY-MM-DD, local day)."""

    date: str
    count: int


class TopUploader(CamelModel):
    sid: str
    nickname: str
    file_count: int
    size_bytes: int


class RecentSignup(CamelModel):
    sid: str
    nickname: str
    role: str
    created_at: UtcDateTime | None = None


class AdminStats(CamelModel):
    total_users: int
    total_admins: int  # admin + superadmin
    total_notes: int
    total_resources: int
    total_files: int
    total_storage_bytes: int
    logins_today: int
    role_breakdown: list[RoleCount]
    login_activity: list[DayCount]  # last 14 days, oldest → newest
    top_uploaders: list[TopUploader]
    recent_signups: list[RecentSignup]
