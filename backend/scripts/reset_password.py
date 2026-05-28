"""Reset a user's password by sid.

Usage:

    # reset to default 123456
    uv run python scripts/reset_password.py --sid 20241401231

    # custom password
    uv run python scripts/reset_password.py --sid 20241401231 --password newpass

Errors out if the user doesn't exist.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.db.models import User  # noqa: E402
from app.db.session import AsyncSessionLocal  # noqa: E402
from app.services.auth import hash_password  # noqa: E402

DEFAULT_PASSWORD = "123456"


async def _reset(sid: str, password: str) -> int:
    async with AsyncSessionLocal() as session:
        user = await session.scalar(select(User).where(User.sid == sid))
        if not user:
            print(f"  ! sid={sid} 不存在", file=sys.stderr)
            return 1
        user.password_hash = hash_password(password)
        await session.commit()
        print(f"reset  sid={sid}  name={user.name!r}  pw={password}")
        return 0


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="重置一个学生账号的密码")
    p.add_argument("--sid", "-s", required=True, help="11 位学号")
    p.add_argument(
        "--password",
        "-p",
        default=DEFAULT_PASSWORD,
        help=f"新密码（默认 {DEFAULT_PASSWORD}）",
    )
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    sys.exit(asyncio.run(_reset(args.sid.strip(), args.password)))
