/**
 * 文件树工具 —— 递归树 ↔ 拍平列表 + dnd-kit 「sortable-tree 投影」式拖拽落点计算。
 *
 * dnd-kit 的 SortableContext 要求一维 items；递归树需先 `flattenTree` 拍平成
 * 带 `depth`/`parentId` 的扁平节点（折叠的文件夹子树整段排除）。
 *
 * 拖拽落点采用 dnd-kit 官方 sortable-tree 的「投影」算法（Notion/Outliner 同款）：
 * - 用**纵向落点**（over 在去掉 drag 后的列表中的索引）定位插入行 → 得到落点的
 *   「上一个可见项 prevItem」「下一个可见项 nextItem」；
 * - 用**水平指针偏移**（`offsetX / INDENT_PX`）算出意图深度 `dragDepth`，再按
 *   `[minDepth, maxDepth]` clamp 出 `projectedDepth`：
 *     maxDepth = prevItem 是文件夹 ? prevItem.depth+1 : prevItem ? prevItem.depth : 0
 *     minDepth = nextItem ? nextItem.depth : 0
 * - `projectedDepth` 决定**新 parentId**（沿 prevItem 祖先链找到该深度的父）；
 *   于是 向右拖=进入上方文件夹(nest)、向左拖=退出到更外层(unnest)、纯上下=同级重排，
 *   **一套投影统一处理 进/出/重排**，不再有 inside 与重排冲突。
 * - 最后把投影映射回 reorder API 的 `{dragId, dropId, position}`：
 *   落点是 projectedParent 下某相邻兄弟之间 → 取前/后兄弟作 dropId + before/after；
 *   落点是某文件夹的首个子位置（含空文件夹）→ inside + dropId=该文件夹。
 *
 * 纯函数、零副作用、零依赖（不 import dnd-kit），方便单测。
 */

import type { MaterialFile, ReorderPosition } from '../types'
import type { FolderOption } from '../types'

/** 拍平后的树节点（dnd-kit SortableContext 的一维 item）。 */
export type FlatNode = {
  id: string
  name: string
  isFolder: boolean
  ext: string | null
  size: string | null
  url: string | null
  /** 树深度，根级为 0。 */
  depth: number
  /** 父节点 id；根级为 null。 */
  parentId: string | null
  /** 该文件夹是否含子节点（驱动展开箭头 / 空夹提示）。 */
  hasChildren: boolean
}

/** 每级缩进像素（指针 X 投影 depth 用，与 FileTree 渲染 marginLeft 对齐）。 */
export const INDENT_PX = 16

/**
 * 把递归树拍平成扁平列表（先序遍历）。
 * - `collapsedIds` 中的文件夹，其子树整段不进列表（折叠隐藏），但该文件夹本身仍在。
 * - 输出顺序 = 渲染顺序，可直接喂 dnd-kit SortableContext 的 items（取 id）。
 */
export function flattenTree(
  nodes: MaterialFile[],
  collapsedIds: ReadonlySet<string> = new Set(),
  depth = 0,
  parentId: string | null = null,
  out: FlatNode[] = [],
): FlatNode[] {
  for (const node of nodes) {
    const children = node.children ?? []
    out.push({
      id: node.id,
      name: node.name,
      isFolder: node.isFolder,
      ext: node.ext,
      size: node.size,
      url: node.url,
      depth,
      parentId,
      hasChildren: node.isFolder && children.length > 0,
    })
    if (node.isFolder && children.length > 0 && !collapsedIds.has(node.id)) {
      flattenTree(children, collapsedIds, depth + 1, node.id, out)
    }
  }
  return out
}

/**
 * 把扁平列表还原成递归树（按 `parentId` 链 + 数组顺序）。
 * 主要用于乐观更新后再组树；不依赖原始 `children`。
 * 缺失的字段（mime/sizeBytes/sizeBytes）置 null（FlatNode 不携带）。
 */
export function unflatten(flat: FlatNode[]): MaterialFile[] {
  const byId = new Map<string, MaterialFile>()
  for (const f of flat) {
    byId.set(f.id, {
      id: f.id,
      name: f.name,
      isFolder: f.isFolder,
      ext: f.ext,
      mime: null,
      size: f.size,
      sizeBytes: null,
      url: f.url,
      children: [],
    })
  }
  const roots: MaterialFile[] = []
  for (const f of flat) {
    const node = byId.get(f.id)
    if (!node) continue
    if (f.parentId && byId.has(f.parentId)) {
      byId.get(f.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

/** 在递归树里按 id 深度查找节点（先序），找不到返回 null。 */
export function findNode(nodes: MaterialFile[], id: string): MaterialFile | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.isFolder && node.children?.length) {
      const hit = findNode(node.children, id)
      if (hit) return hit
    }
  }
  return null
}

/**
 * 收集树里所有文件夹，拼出人类可读层级路径（如 `课件 / 第一章`）。
 * 用于上传弹窗的「目标文件夹」Select 数据源。先序，含 depth 供缩进。
 */
export function getAllFolders(nodes: MaterialFile[]): FolderOption[] {
  const out: FolderOption[] = []
  const walk = (list: MaterialFile[], depth: number, prefix: string) => {
    for (const node of list) {
      if (!node.isFolder) continue
      const path = prefix ? `${prefix} / ${node.name}` : node.name
      out.push({ id: node.id, name: node.name, path, depth })
      if (node.children?.length) walk(node.children, depth + 1, path)
    }
  }
  walk(nodes, 0, '')
  return out
}

/** 统计树里文件总数（不含文件夹），递归。 */
export function countFiles(nodes: MaterialFile[]): number {
  let n = 0
  for (const node of nodes) {
    if (node.isFolder) {
      n += countFiles(node.children ?? [])
    } else {
      n += 1
    }
  }
  return n
}

/**
 * 落点投影结果（sortable-tree 投影）。
 * - `depth`：投影深度，驱动指示线的缩进位置（与渲染 marginLeft 对齐）。
 * - `parentId`：投影后的新父节点 id（root 为 null）。指示器据此给目标文件夹整行高亮。
 * - `dropId` / `position`：映射回 reorder API 的落点（`inside` 时 dropId=父文件夹）。
 * `null` = 落点无效（无目标 / 拖进自身或其子树 / 越界）。
 */
export type DropProjection = {
  depth: number
  parentId: string | null
  dropId: string
  position: ReorderPosition
} | null

type ProjectArgs = {
  /** 拖拽节点 id。 */
  dragId: string
  /** 悬停目标节点 id（dnd-kit over.id）；无 over 时传 null。 */
  overId: string | null
  /** 指针相对拖起点的水平位移（event.delta.x，向右为正）。 */
  offsetX: number
  /** 完整扁平列表（= 渲染顺序，含被拖项）。 */
  flat: FlatNode[]
}

/**
 * sortable-tree 投影：用纵向落点定位插入行、用水平偏移定意图深度，clamp 出
 * `projectedDepth` 与新父节点，再映射回 reorder API 的 `{dropId, position}`。
 *
 * 环路守卫（与后端 reorder service 对齐）：拖一个文件夹时，落点（over / 新父）
 * 落在该文件夹自身或其子树内 → 返回 null（不触发）。
 */
export function projectDrop({ dragId, overId, offsetX, flat }: ProjectArgs): DropProjection {
  if (overId == null) return null

  const dragIndex = flat.findIndex((f) => f.id === dragId)
  const overIndex = flat.findIndex((f) => f.id === overId)
  if (dragIndex < 0 || overIndex < 0) return null
  const dragNode = flat[dragIndex]!

  // 去掉被拖项后的可见列表 = 真正的落点参考序列（与 dnd-kit arrayMove 语义一致）。
  const items = flat.filter((f) => f.id !== dragId)

  // 落点行号（在去-drag 列表里的插入位）。
  let insertIndex: number
  if (overId === dragId) {
    // 自身-over 帧：dnd-kit 在指针回到被拖项原槽位时会把 over 报成 drag 自身。
    // 不能 return null（会让 onDragEnd 静默丢弃落点 → 位置不变），改用被拖项原视觉
    // 槽位推 insertIndex —— 把 dragIndex 映射到「去掉 drag 后」列表的等效位置：
    // drag 之前的项数即被拖项原本所在的等效插入槽，clamp 到 [0, items.length]。
    insertIndex = Math.max(0, Math.min(dragIndex, items.length))
  } else {
    // over 在去掉 drag 后的列表中的位置：drag 原本在 over 之前则索引左移一位。
    insertIndex = items.findIndex((f) => f.id === overId)
    if (insertIndex < 0) return null
    if (dragIndex < overIndex) insertIndex += 1
  }

  const prevItem = items[insertIndex - 1] ?? null
  const nextItem = items[insertIndex] ?? null

  // 水平偏移换算意图深度：以被拖项原深度为基准 + 偏移格数。
  const dragDepth = dragNode.depth + Math.round(offsetX / INDENT_PX)

  // clamp 边界：上界看 prevItem（文件夹才允许 +1 进入它），下界看 nextItem。
  const maxDepth = prevItem
    ? prevItem.isFolder
      ? prevItem.depth + 1
      : prevItem.depth
    : 0
  const minDepth = nextItem ? nextItem.depth : 0
  const projectedDepth = Math.max(minDepth, Math.min(dragDepth, maxDepth))

  // 沿 prevItem 祖先链找 projectedDepth 对应的父节点 id。
  const parentId = resolveParentId(items, prevItem, projectedDepth)

  // 环路守卫：拖文件夹时，新父=自身或其后代 → 非法。
  if (isDescendantOrSelf(flat, parentId, dragId)) return null

  return toReorderTarget({ items, insertIndex, parentId, projectedDepth })
}

/**
 * 沿 prevItem 的祖先链上溯，找 `depth` 这一层对应的父节点 id。
 * - prevItem 为 null（落在列表首行之前）→ root（null）。
 * - projectedDepth > prevItem.depth → 成为 prevItem 的子（prevItem 必是文件夹，见 clamp）。
 * - projectedDepth === prevItem.depth → 与 prevItem 同级，父 = prevItem.parentId。
 * - projectedDepth < prevItem.depth → 沿 prevItem 父链上溯到该深度的祖先，取其 parentId。
 */
function resolveParentId(
  items: FlatNode[],
  prevItem: FlatNode | null,
  projectedDepth: number,
): string | null {
  if (!prevItem) return null
  if (projectedDepth > prevItem.depth) return prevItem.id
  if (projectedDepth === prevItem.depth) return prevItem.parentId

  const byId = new Map(items.map((f) => [f.id, f]))
  let cur: FlatNode | null = prevItem
  const guard = new Set<string>()
  // 上溯到 depth === projectedDepth 的祖先，该祖先的 parentId 即新父。
  while (cur && cur.depth > projectedDepth) {
    if (guard.has(cur.id)) break
    guard.add(cur.id)
    cur = cur.parentId ? byId.get(cur.parentId) ?? null : null
  }
  return cur ? cur.parentId : null
}

/**
 * 把「在 items[insertIndex] 处、父为 parentId、深度 projectedDepth」的落点
 * 映射回 reorder API 的 `{dropId, position}`：
 * - 落点上方相邻同父兄弟存在 → after 该兄弟；
 * - 否则落点下方相邻同父兄弟存在 → before 该兄弟；
 * - 否则成为 parentId 文件夹的首/唯一子 → inside parentId（含空文件夹）；
 * - parentId 为 root 且找不到任何同父兄弟（理论不达）→ null。
 */
function toReorderTarget({
  items,
  insertIndex,
  parentId,
  projectedDepth,
}: {
  items: FlatNode[]
  insertIndex: number
  parentId: string | null
  projectedDepth: number
}): DropProjection {
  // 上方最近的同父兄弟（在落点之前）。
  for (let i = insertIndex - 1; i >= 0; i--) {
    const node = items[i]!
    if (node.parentId === parentId) {
      return { depth: projectedDepth, parentId, dropId: node.id, position: 'after' }
    }
    // 越过更浅层（回到更外层）后不可能再有本层兄弟。
    if (node.depth < projectedDepth) break
  }
  // 下方最近的同父兄弟（在落点及之后）。
  for (let i = insertIndex; i < items.length; i++) {
    const node = items[i]!
    if (node.parentId === parentId) {
      return { depth: projectedDepth, parentId, dropId: node.id, position: 'before' }
    }
    if (node.depth < projectedDepth) break
  }
  // 无同父兄弟 → 成为 parentId 文件夹的首子（inside）。
  if (parentId != null) {
    return { depth: projectedDepth, parentId, dropId: parentId, position: 'inside' }
  }
  return null
}

/**
 * 乐观更新：把 `dragId` 节点从树中移除，按 `position` 重插到 `dropId` 落点处，
 * 返回**全新**的树（不可变 —— 不原地改任何节点 / children 数组）。
 *
 * **必须镜像后端 `reorder_file`（services/materials.py）语义**，否则乐观态与
 * refetch 结果不一致会闪烁：
 * - `inside`：drag 成为 `dropId`（文件夹）的子，**追加到末尾**（后端
 *   `insert_index = len(siblings)`）。drop 非文件夹 → 非法，返回原树。
 * - `before` / `after`：drag 成为 `dropId` 的同级兄弟（插到 dropId 父的
 *   children 里 dropId 之**前** / 之**后**）。后端用「去掉 drag 后的兄弟列表」
 *   定位 drop_index，故同父内自移动时插入位与 dropId 的相对位置一致。
 *
 * 安全返回原树（含 `dragId === dropId` 时直接返回原 `tree` 引用）的情况：
 * - dragId / dropId 不存在；
 * - inside 落点非文件夹；
 * - dragId === dropId；
 * - 环路：dropId 落点（或其某祖先）= dragId 自身或其后代（拖文件夹进自身子树）。
 *
 * 注意：后端的同级 `before/after` 是在「移除 drag 之后」的兄弟列表上找 drop 的
 * 索引；本函数等价实现 —— 先克隆整棵树并把 drag 从原父 children 摘除，再在目标父
 * 的（已不含 drag 的）children 里按 dropId 索引插入，与后端 `sort_order` 重写后的
 * 顺序逐一对齐。
 */
export function applyReorder(
  tree: MaterialFile[],
  input: { dragId: string; dropId: string; position: ReorderPosition },
): MaterialFile[] {
  const { dragId, dropId, position } = input
  // 同节点 / 自身落点：后端 400「不能拖到自身」，乐观态原样返回。
  if (dragId === dropId) return tree

  // 先在原树里定位 drag / drop，做与后端一致的前置校验（不存在 / inside 非夹 / 环路）。
  const dragNode = findNode(tree, dragId)
  const dropNode = findNode(tree, dropId)
  if (!dragNode || !dropNode) return tree
  if (position === 'inside' && !dropNode.isFolder) return tree

  // 新父 = inside → dropId；before/after → dropId 的父（在树里查）。
  const newParentId =
    position === 'inside' ? dropId : findParentId(tree, dropId)

  // 环路守卫（对齐后端）：新父 = drag 自身或其后代 → 非法。
  if (isReorderCycle(tree, newParentId, dragId)) return tree

  // 克隆整棵树（新数组 + 新节点 + 新 children 数组），同时把 drag 从其原父摘出。
  let detached: MaterialFile | null = null
  const clone = (nodes: MaterialFile[]): MaterialFile[] => {
    const out: MaterialFile[] = []
    for (const node of nodes) {
      if (node.id === dragId) {
        // 摘除：克隆出 drag 子树留作重插（其 children 一并深克隆），不放回原父。
        detached = cloneSubtree(node)
        continue
      }
      out.push({
        ...node,
        children: node.children?.length ? clone(node.children) : [],
      })
    }
    return out
  }
  const roots = clone(tree)
  if (!detached) return tree // 理论不达（findNode 已确认存在）

  // 把摘出的 drag 重插到目标父的 children（newParentId=null → 根级 roots）。
  if (newParentId === null) {
    insertSibling(roots, detached, dropId, position)
  } else {
    const parent = findNode(roots, newParentId)
    if (!parent) return tree // 父被摘掉了（不该发生）→ 安全回原树
    if (position === 'inside') {
      // 追加到末尾（镜像后端 insert_index = len(siblings)）。
      parent.children = [...parent.children, detached]
    } else {
      insertSibling(parent.children, detached, dropId, position)
    }
  }
  return roots
}

/**
 * 深克隆一棵子树（新节点 + 新 children 数组），供 applyReorder 摘出 drag 后重插。
 */
function cloneSubtree(node: MaterialFile): MaterialFile {
  return {
    ...node,
    children: node.children?.length ? node.children.map(cloneSubtree) : [],
  }
}

/**
 * 在 `siblings`（目标父的 children，已不含 drag）里按 dropId 的位置插入 `node`：
 * `before` 插在 dropId 之前，`after` 插在 dropId 之后；dropId 不在该列表（理论不达）
 * 时追加到末尾（镜像后端 drop_index is None → append）。原地改传入的数组。
 */
function insertSibling(
  siblings: MaterialFile[],
  node: MaterialFile,
  dropId: string,
  position: ReorderPosition,
): void {
  const dropIndex = siblings.findIndex((n) => n.id === dropId)
  if (dropIndex < 0) {
    siblings.push(node)
    return
  }
  const at = position === 'before' ? dropIndex : dropIndex + 1
  siblings.splice(at, 0, node)
}

/** 在递归树里查 `id` 节点的父 id（根级返回 null；找不到也返回 null）。 */
function findParentId(nodes: MaterialFile[], id: string): string | null {
  const walk = (list: MaterialFile[], parentId: string | null): string | null | undefined => {
    for (const node of list) {
      if (node.id === id) return parentId
      if (node.isFolder && node.children?.length) {
        const hit = walk(node.children, node.id)
        if (hit !== undefined) return hit
      }
    }
    return undefined
  }
  return walk(nodes, null) ?? null
}

/**
 * 环路守卫（对齐后端 reorder_file 的 ancestor 链爬升）：从 `newParentId` 沿父链
 * 上溯，若途中（含 newParentId 自身）遇到 `dragId` → 会把 drag 嵌进自身子树，非法。
 * `newParentId === null`（根级）永不成环。
 */
function isReorderCycle(
  tree: MaterialFile[],
  newParentId: string | null,
  dragId: string,
): boolean {
  let cursor: string | null = newParentId
  const guard = new Set<string>()
  while (cursor != null) {
    if (cursor === dragId) return true
    if (guard.has(cursor)) break // 防御脏环
    guard.add(cursor)
    cursor = findParentId(tree, cursor)
  }
  return false
}

/**
 * `candidateId` 是否等于 `ancestorId` 或为其后代（沿 parentId 链上溯）。
 * 用于环路守卫：把文件夹拖进自身或其子目录非法。
 */
function isDescendantOrSelf(
  flat: FlatNode[],
  candidateId: string | null,
  ancestorId: string,
): boolean {
  if (candidateId == null) return false
  const byId = new Map(flat.map((f) => [f.id, f]))
  let cur: string | null = candidateId
  const guard = new Set<string>()
  while (cur != null) {
    if (cur === ancestorId) return true
    if (guard.has(cur)) break // 防御已存在的脏环，避免死循环
    guard.add(cur)
    cur = byId.get(cur)?.parentId ?? null
  }
  return false
}
