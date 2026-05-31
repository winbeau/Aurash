"""Business layer for the /materials/* domain.

Everything that touches the ``MaterialResource`` / ``MaterialFile`` ORM does
so without ever traversing the ``lazy="raise"`` relationships (``.files`` /
``.children`` / ``.parent`` / ``.resource``): the file tree is assembled by a
single flat ``SELECT`` + pure-Python grouping (plan-materials §4), so we
never trip ``MissingGreenlet`` in production.

Responsibilities:
- flat-query → in-memory tree (``build_file_tree``);
- duplicate-name guard within a ``(resource_id, parent_id)`` scope, with the
  root level expressed as ``parent_id IS NULL`` (SQLite would treat NULLs as
  mutually distinct under a DB UniqueConstraint, so this lives here);
- cascade soft-delete (``deleted=True`` on the whole subtree) + physical
  ``unlink`` of the backing files;
- reorder (whole-scope ``sort_order`` rewrite + ``parent_id`` move) with an
  **ancestor cycle guard** (plan-materials §2);
- owner-permission helpers (write/modify require ``owner_sid == user.sid``);
- disk path resolution for uploads under ``uploads/materials/<sid>/<rid>/``.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MaterialFile, MaterialResource, User
from app.schemas.material import FileOut, ResourceOut
from app.settings import settings

# Disk layout: <repo>/backend/uploads/materials/<sid>/<rid>/<ts>-<rand>.<ext>.
# Mirrors routes/uploads.py::UPLOAD_ROOT so the StaticFiles mount + HF
# `uploads dir_tar` artifact cover it with zero config change.
UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads"
MATERIALS_DIR = UPLOAD_ROOT / "materials"


# Display-name length ceiling (matches uploads_common._MAX_NAME_LEN).
_MAX_NAME_LEN = 200


# ---------------------------------------------------------------------------
# Display-name sanitization
# ---------------------------------------------------------------------------

def clean_name(raw: str | None) -> str:
    """Sanitize a user-supplied file/folder name for the tree UI.

    Materials names render as React tree-node text (not a markdown link), so
    unlike `uploads_common.safe_display_name` we do **not** backslash-escape
    markdown meta-characters (that would visibly corrupt the label). We only
    strip control characters (incl. CR/LF/TAB — they could smuggle terminal
    escapes / break log lines), collapse surrounding whitespace, and truncate
    to 200. A blank result falls back to ``"file"``.
    """
    if not raw:
        return "file"
    cleaned = "".join(
        ch for ch in raw if ch == " " or (ord(ch) >= 0x20 and ord(ch) != 0x7F)
    )
    cleaned = cleaned.strip()
    if len(cleaned) > _MAX_NAME_LEN:
        cleaned = cleaned[:_MAX_NAME_LEN].rstrip()
    return cleaned or "file"


# ---------------------------------------------------------------------------
# Human-readable size
# ---------------------------------------------------------------------------

def human_size(size_bytes: int | None) -> str | None:
    """Format a byte count as a short human string ("1.2 MB"), or None.

    Folders (no byte count) return None so the client renders nothing.
    """
    if size_bytes is None:
        return None
    if size_bytes < 1024:
        return f"{size_bytes} B"
    units = ("KB", "MB", "GB", "TB")
    value = float(size_bytes)
    for unit in units:
        value /= 1024.0
        if value < 1024.0 or unit == units[-1]:
            # One decimal place; drop a trailing ".0" for tidy "5 MB".
            text = f"{value:.1f}".rstrip("0").rstrip(".")
            return f"{text} {unit}"
    return f"{size_bytes} B"  # pragma: no cover - unreachable


# ---------------------------------------------------------------------------
# Tree assembly (flat SELECT → Python dict, never .children/.files)
# ---------------------------------------------------------------------------

def _file_to_out(row: MaterialFile, children: list[FileOut]) -> FileOut:
    """Build a `FileOut` from a single ORM row + already-built children.

    Reads only scalar columns on `row` (never a relationship attribute), so
    this is safe against `lazy="raise"`.
    """
    return FileOut(
        id=row.id,
        name=row.name,
        is_folder=row.is_folder,
        ext=row.ext,
        mime=row.mime,
        size=human_size(row.size_bytes) if not row.is_folder else None,
        size_bytes=row.size_bytes,
        url=row.url,
        children=children,
    )


def build_file_tree(rows: list[MaterialFile]) -> list[FileOut]:
    """Assemble the recursive `FileOut` tree from a flat list of rows.

    `rows` MUST already be filtered to a single resource + ``deleted=False``
    and ordered by ``sort_order`` (we preserve input order within each parent
    scope). Pure Python — no DB IO, no relationship access.
    """
    # parent_id -> ordered list of child rows. None key = root level.
    by_parent: dict[str | None, list[MaterialFile]] = {}
    for row in rows:
        by_parent.setdefault(row.parent_id, []).append(row)

    def build(parent_id: str | None) -> list[FileOut]:
        out: list[FileOut] = []
        for row in by_parent.get(parent_id, []):
            kids = build(row.id) if row.is_folder else []
            out.append(_file_to_out(row, kids))
        return out

    return build(None)


def resource_to_out(
    resource: MaterialResource, files: list[FileOut] | None = None
) -> ResourceOut:
    """Map a `MaterialResource` row (+ optional tree) to `ResourceOut`.

    Reads only scalar columns; `files` is the already-built tree (or empty for
    list views that don't embed the tree).
    """
    return ResourceOut(
        id=resource.id,
        title=resource.title,
        description=resource.description,
        tag=resource.tag,
        owner_sid=resource.owner_sid,
        update_date=resource.updated_at,
        created_at=resource.created_at,
        files=files or [],
    )


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

async def get_resource_or_404(
    db: AsyncSession, rid: str
) -> MaterialResource:
    """Fetch a non-deleted resource by id or raise 404."""
    resource = await db.get(MaterialResource, rid)
    if not resource or resource.deleted:
        raise HTTPException(status_code=404, detail="资料不存在")
    return resource


async def get_file_or_404(db: AsyncSession, file_id: str) -> MaterialFile:
    """Fetch a non-deleted file/folder by id or raise 404."""
    node = await db.get(MaterialFile, file_id)
    if not node or node.deleted:
        raise HTTPException(status_code=404, detail="文件不存在")
    return node


async def list_resource_files(
    db: AsyncSession, rid: str
) -> list[MaterialFile]:
    """Flat SELECT of all non-deleted nodes of a resource, ordered.

    Ordered by ``(sort_order, created_at)`` so siblings come out in their
    stored order and ties break deterministically.
    """
    stmt = (
        select(MaterialFile)
        .where(
            MaterialFile.resource_id == rid,
            MaterialFile.deleted == False,  # noqa: E712 - SQL boolean
        )
        .order_by(MaterialFile.sort_order, MaterialFile.created_at)
    )
    return list((await db.execute(stmt)).scalars().all())


async def resources_with_trees(
    db: AsyncSession, resources: list[MaterialResource]
) -> list[ResourceOut]:
    """Map resources → `ResourceOut` *with* their file trees in 2 queries total.

    One batched flat SELECT over all listed resources' files
    (``resource_id IN (...)``), grouped in Python, one tree per resource. Never
    touches the ``lazy="raise"`` relationships. Used by the list view so cards
    can render file count / directory preview / recent uploads (otherwise every
    card reads ``files=[]`` and shows "0 个文件").
    """
    if not resources:
        return []
    rids = [r.id for r in resources]
    stmt = (
        select(MaterialFile)
        .where(
            MaterialFile.resource_id.in_(rids),
            MaterialFile.deleted == False,  # noqa: E712 - SQL boolean
        )
        .order_by(
            MaterialFile.resource_id,
            MaterialFile.sort_order,
            MaterialFile.created_at,
        )
    )
    rows = list((await db.execute(stmt)).scalars().all())
    by_resource: dict[str, list[MaterialFile]] = {}
    for row in rows:
        by_resource.setdefault(row.resource_id, []).append(row)
    return [
        resource_to_out(r, build_file_tree(by_resource.get(r.id, [])))
        for r in resources
    ]


# ---------------------------------------------------------------------------
# Permission helper
# ---------------------------------------------------------------------------

def ensure_owner(resource: MaterialResource, user: User) -> None:
    """Authorize a write/modify/delete on `resource`.

    Materials is a shared knowledge base: any logged-in user may *read* every
    resource, but only the owner may modify it or its files (plan decision §1).
    """
    if resource.owner_sid != user.sid:
        raise HTTPException(status_code=403, detail="只能修改自己的资料")


# ---------------------------------------------------------------------------
# Duplicate-name guard
# ---------------------------------------------------------------------------

async def assert_name_free(
    db: AsyncSession,
    rid: str,
    parent_id: str | None,
    name: str,
    *,
    exclude_id: str | None = None,
) -> None:
    """Raise 409 if `name` already exists in the `(rid, parent_id)` scope.

    Root level is expressed as ``parent_id IS NULL`` explicitly (a DB
    UniqueConstraint would miss it under SQLite NULL semantics). `exclude_id`
    lets a rename skip the row being renamed.
    """
    conds = [
        MaterialFile.resource_id == rid,
        MaterialFile.deleted == False,  # noqa: E712
        MaterialFile.name == name,
    ]
    if parent_id is None:
        conds.append(MaterialFile.parent_id.is_(None))
    else:
        conds.append(MaterialFile.parent_id == parent_id)
    if exclude_id is not None:
        conds.append(MaterialFile.id != exclude_id)

    stmt = select(MaterialFile.id).where(*conds).limit(1)
    if (await db.execute(stmt)).first() is not None:
        raise HTTPException(status_code=409, detail="同目录下已存在同名文件")


async def next_sort_order(
    db: AsyncSession, rid: str, parent_id: str | None
) -> int:
    """Next ``sort_order`` (0..n) to append within a sibling scope."""
    conds = [
        MaterialFile.resource_id == rid,
        MaterialFile.deleted == False,  # noqa: E712
    ]
    if parent_id is None:
        conds.append(MaterialFile.parent_id.is_(None))
    else:
        conds.append(MaterialFile.parent_id == parent_id)
    stmt = select(MaterialFile.id).where(*conds)
    count = len((await db.execute(stmt)).all())
    return count


# ---------------------------------------------------------------------------
# Cascade soft-delete + physical unlink
# ---------------------------------------------------------------------------

def _unlink_storage(node: MaterialFile) -> None:
    """Physically remove a file's backing object from disk (best-effort).

    Folders have no `storage_path`. The path is stored relative to
    `UPLOAD_ROOT`; we never delete outside that tree.
    """
    if node.is_folder or not node.storage_path:
        return
    target = UPLOAD_ROOT / node.storage_path
    try:
        target.unlink(missing_ok=True)
    except OSError:
        # A failed unlink must not abort the soft-delete transaction; the row
        # is already flagged deleted, the worst case is a dangling blob.
        pass


async def soft_delete_subtree(
    db: AsyncSession, root: MaterialFile
) -> None:
    """Soft-delete `root` and (if a folder) its whole subtree, unlink files.

    Walks the resource's flat row set in Python (no ``.children`` traversal),
    marks every node in `root`'s subtree ``deleted=True``, and unlinks each
    file's disk object. Caller commits.
    """
    rows = await list_resource_files(db, root.resource_id)
    children_by_parent: dict[str | None, list[MaterialFile]] = {}
    for row in rows:
        children_by_parent.setdefault(row.parent_id, []).append(row)

    # Collect `root` + descendants via an explicit Python BFS.
    to_delete: list[MaterialFile] = []
    stack: list[MaterialFile] = [root]
    while stack:
        node = stack.pop()
        to_delete.append(node)
        if node.is_folder:
            stack.extend(children_by_parent.get(node.id, []))

    for node in to_delete:
        node.deleted = True
        _unlink_storage(node)


async def soft_delete_resource(
    db: AsyncSession, resource: MaterialResource
) -> None:
    """Soft-delete a resource + all its files (whole tree), unlink blobs.

    Caller commits.
    """
    resource.deleted = True
    rows = await list_resource_files(db, resource.id)
    for row in rows:
        row.deleted = True
        _unlink_storage(row)


# ---------------------------------------------------------------------------
# Reorder (with ancestor cycle guard)
# ---------------------------------------------------------------------------

async def reorder_file(
    db: AsyncSession, body_drag_id: str, body_drop_id: str, position: str
) -> None:
    """Move ``drag`` relative to ``drop`` and rewrite the target scope.

    - ``position='inside'`` re-parents ``drag`` under ``drop`` (a folder),
      appended at the end of ``drop``'s children;
    - ``before``/``after`` insert ``drag`` as a sibling of ``drop`` at the
      computed index.

    Both nodes must belong to the same resource. An **ancestor cycle guard**
    (plan-materials §2) refuses any move that would make ``drag`` its own
    ancestor (incl. ``drag == newParent``): we climb the new parent's
    ``parent_id`` chain and 400 if we ever hit ``drag``. The whole target
    sibling scope's ``sort_order`` is rewritten ``0..n`` atomically. Caller
    commits.
    """
    drag = await get_file_or_404(db, body_drag_id)
    drop = await get_file_or_404(db, body_drop_id)

    if drag.resource_id != drop.resource_id:
        raise HTTPException(status_code=400, detail="只能在同一资料内排序")
    if drag.id == drop.id:
        raise HTTPException(status_code=400, detail="不能拖到自身")

    rid = drag.resource_id
    rows = await list_resource_files(db, rid)
    by_id = {row.id: row for row in rows}

    # Resolve the new parent scope.
    if position == "inside":
        if not drop.is_folder:
            raise HTTPException(status_code=400, detail="只能拖入文件夹")
        new_parent_id = drop.id
    else:  # before | after
        new_parent_id = drop.parent_id

    # Ancestor cycle guard: climb new_parent's parent chain; if we reach
    # `drag`, the move would nest `drag` inside its own subtree.
    cursor: str | None = new_parent_id
    while cursor is not None:
        if cursor == drag.id:
            raise HTTPException(
                status_code=400,
                detail="不能把文件夹移动到自身或其子目录下",
            )
        parent = by_id.get(cursor)
        cursor = parent.parent_id if parent is not None else None

    # Ordered siblings of the *new* parent scope, excluding `drag` itself.
    siblings = [
        row
        for row in rows
        if row.parent_id == new_parent_id and row.id != drag.id
    ]

    if position == "inside":
        insert_index = len(siblings)
    else:
        # Find `drop` among the (drag-removed) siblings.
        drop_index = next(
            (i for i, row in enumerate(siblings) if row.id == drop.id), None
        )
        if drop_index is None:
            # `drop` not in this scope (shouldn't happen) — append.
            insert_index = len(siblings)
        else:
            insert_index = drop_index if position == "before" else drop_index + 1

    siblings.insert(insert_index, drag)
    drag.parent_id = new_parent_id
    for order, row in enumerate(siblings):
        row.sort_order = order


# ---------------------------------------------------------------------------
# URL / storage path composition
# ---------------------------------------------------------------------------

def public_url(sid: str, rid: str, fname: str) -> str:
    """Absolute public URL for a stored material file."""
    return f"{settings.public_base_url}/uploads/materials/{sid}/{rid}/{fname}"


def storage_rel_path(sid: str, rid: str, fname: str) -> str:
    """Relative-to-`UPLOAD_ROOT` path persisted for physical delete/locate."""
    return f"materials/{sid}/{rid}/{fname}"
