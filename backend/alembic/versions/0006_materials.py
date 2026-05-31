"""add materials tables — material_resources / material_files

Backs the `/materials` shared knowledge-base page (migrated from KnoHub
course resources):

  - `material_resources`: the top-level resource cards. `owner_sid` FK →
    users.sid (ondelete CASCADE, indexed). `deleted` is a soft-delete flag
    (indexed); physical files are unlinked at DELETE time.
  - `material_files`: files *and* folders (`is_folder` distinguishes them)
    arranged as a self-referential recursive tree. `parent_id` is NULL at
    the resource root and otherwise FK → material_files.id (ondelete
    CASCADE). `resource_id` FK → material_resources.id (ondelete CASCADE).

Name uniqueness within a `(resource_id, parent_id)` scope is enforced in
the service layer (NOT a DB UniqueConstraint — SQLite treats NULL
parent_id rows as mutually distinct, which would miss root-level dups).

Auto-generated via `alembic revision --autogenerate`, then renamed to the
repo's `0006_materials` convention; down_revision pinned to the verified
head `0005_draft_summary`.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_materials"
down_revision: str | None = "0005_draft_summary"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "material_resources",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("tag", sa.String(16), nullable=True),
        sa.Column(
            "owner_sid",
            sa.String(11),
            sa.ForeignKey("users.sid", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_material_resources_owner_sid", "material_resources", ["owner_sid"]
    )
    op.create_index(
        "ix_material_resources_deleted", "material_resources", ["deleted"]
    )

    op.create_table(
        "material_files",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column(
            "resource_id",
            sa.String(64),
            sa.ForeignKey("material_resources.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            sa.String(64),
            sa.ForeignKey("material_files.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("is_folder", sa.Boolean(), nullable=False),
        sa.Column("ext", sa.String(32), nullable=True),
        sa.Column("mime", sa.String(128), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("url", sa.String(512), nullable=True),
        sa.Column("storage_path", sa.String(512), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_material_files_resource_id", "material_files", ["resource_id"])
    op.create_index("ix_material_files_parent_id", "material_files", ["parent_id"])
    op.create_index("ix_material_files_deleted", "material_files", ["deleted"])


def downgrade() -> None:
    op.drop_index("ix_material_files_deleted", table_name="material_files")
    op.drop_index("ix_material_files_parent_id", table_name="material_files")
    op.drop_index("ix_material_files_resource_id", table_name="material_files")
    op.drop_table("material_files")
    op.drop_index(
        "ix_material_resources_deleted", table_name="material_resources"
    )
    op.drop_index(
        "ix_material_resources_owner_sid", table_name="material_resources"
    )
    op.drop_table("material_resources")
