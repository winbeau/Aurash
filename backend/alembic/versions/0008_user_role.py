"""add users.role (3-tier authorization)

Adds the `role` column ('user' | 'admin' | 'superadmin') that backs the
3-tier admin system and the hidden /admin dashboard. Existing rows default to
'user' via server_default; the configured bootstrap super-admin
(settings.admin_sid) is backfilled to 'superadmin' so the very first deploy
already has a working super-admin without a manual step.

Note: the bootstrap admin_sid is *also* treated as superadmin at runtime
regardless of this column (services.auth.effective_role) — the backfill just
keeps the DB consistent so the admin dashboard reflects reality.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op
from app.settings import settings

revision: str = "0008_user_role"
down_revision: str | None = "0007_preferred_name"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "role",
            sa.String(16),
            nullable=False,
            server_default="user",
        ),
    )
    # Backfill the configured bootstrap super-admin so the column matches the
    # runtime behaviour. Parameter-bound to stay injection-safe across SQLite
    # and Postgres.
    op.execute(
        sa.text("UPDATE users SET role = 'superadmin' WHERE sid = :sid").bindparams(
            sid=settings.admin_sid
        )
    )


def downgrade() -> None:
    op.drop_column("users", "role")
