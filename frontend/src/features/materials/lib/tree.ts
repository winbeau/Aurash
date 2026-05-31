/**
 * 文件树工具 —— 递归树 ↔ 拍平列表 + dnd-kit 拖拽落点投影。
 *
 * dnd-kit 的 SortableContext 要求一维 items；递归树需先 `flattenTree` 拍平成
 * 带 `depth`/`parentId` 的扁平节点（折叠的文件夹子树整段排除），拖拽时用
 * `projectDrop` 按指针 X（缩进深度）+ Y（三分判 before/after/inside）算出落点，
 * `onDragEnd` 把落点翻成 reorder API 的 `{dragId, dropId, position}`。
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
 * 落点投影结果：把拖拽位置翻成 reorder API 的 `{dropId, position}`。
 * `null` = 落点无效（拖到自身 / 自身子树 / 无目标）。
 */
export type DropProjection = {
  dropId: string
  position: ReorderPosition
} | null

type ProjectArgs = {
  /** 拖拽节点 id。 */
  dragId: string
  /** 悬停目标节点（FlatNode）。 */
  over: FlatNode
  /** 指针在 over 节点矩形内的纵向比例 0..1（顶=0，底=1）。 */
  overRatio: number
  /** 完整扁平列表（用于环路守卫上溯祖先）。 */
  flat: FlatNode[]
}

/**
 * 三区 + 深度投影：
 * - over 是文件夹且指针落在中间带 (25%, 75%) → `inside`（成为其子节点）。
 * - 否则上半 (<50%) → `before`，下半 (>=50%) → `after`（与 over 同级）。
 *
 * 环路守卫（与后端 reorder service 对齐）：当落点会把 dragId 放进自身或其子树
 * （inside 到自身/后代，或 before/after 的同级 parent 在 dragId 子树内）→ 返回 null。
 */
export function projectDrop({ dragId, over, overRatio, flat }: ProjectArgs): DropProjection {
  if (over.id === dragId) return null

  const inMiddle = overRatio > 0.25 && overRatio < 0.75
  let position: ReorderPosition
  if (over.isFolder && inMiddle) {
    position = 'inside'
  } else {
    position = overRatio < 0.5 ? 'before' : 'after'
  }

  // 落点的新父节点：inside → over 自身；before/after → over 的 parent。
  const newParentId = position === 'inside' ? over.id : over.parentId

  // 环路守卫：newParentId 等于 dragId，或沿 parentId 链上溯遇到 dragId → 非法。
  if (isDescendantOrSelf(flat, newParentId, dragId)) return null

  return { dropId: over.id, position }
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
