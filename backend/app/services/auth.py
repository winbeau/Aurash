"""Auth helpers — bcrypt password hashing + HS256 JWT issue/decode + roles.

JWT payload `sub` is the user's sid (student ID, also the table PK).
"""

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import bcrypt
from jose import JWTError, jwt

from app.settings import settings

if TYPE_CHECKING:
    from app.db.models import User

ALGO = "HS256"

# Authorization tiers (mirror users.role column + frontend Role union).
ROLE_USER = "user"
ROLE_ADMIN = "admin"
ROLE_SUPERADMIN = "superadmin"


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(sid: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sid,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_expire_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGO)


def decode_token(token: str) -> str | None:
    """Return user sid from a valid JWT, or None if invalid/expired."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGO])
    except JWTError:
        return None
    sub = payload.get("sub")
    return sub if isinstance(sub, str) else None


# ---------------------------------------------------------------------------
# Roles / authorization tiers
# ---------------------------------------------------------------------------


def effective_role(user: "User") -> str:
    """The authorization tier actually in force for `user`.

    The configured bootstrap super-admin (``settings.admin_sid``) is ALWAYS
    treated as superadmin regardless of its DB column — so a misconfigured /
    lagging column can never lock us out. Otherwise the ``role`` column wins;
    anything unrecognized degrades to the least-privileged ``user``.
    """
    if user.sid == settings.admin_sid or user.role == ROLE_SUPERADMIN:
        return ROLE_SUPERADMIN
    if user.role == ROLE_ADMIN:
        return ROLE_ADMIN
    return ROLE_USER


def is_superadmin(user: "User") -> bool:
    return effective_role(user) == ROLE_SUPERADMIN


def is_admin(user: "User") -> bool:
    """True for both admin and superadmin (the /admin-capable set)."""
    return effective_role(user) in (ROLE_ADMIN, ROLE_SUPERADMIN)
