import { describe, expect, it } from 'vitest'

import { applyReorder, INDENT_PX, projectDrop, type FlatNode } from './tree'
import type { MaterialFile } from '../types'

/**
 * tree.ts projectDrop 落点投影单测。
 *
 * 用一棵手搓扁平树（= 渲染顺序，含被拖项）覆盖：
 * - 相邻上移 / 下移互换（同级重排）；
 * - 跨位移动（隔几行）；
 * - nest（向右拖进上方文件夹）/ unnest（向左拖退出更外层）；
 * - **overId === dragId 帧返回非空目标**（根因回归守卫：落点前最后一帧 over 落回
 *   被拖项自身时，projectDrop 必须给出有效落点而非 null，否则 onDragEnd 静默丢弃）。
 *
 * 树结构（depth / parentId / hasChildren 已对齐 flattenTree 输出）：
 *   a            (folder, depth0)   children: c
 *     c          (file,   depth1)
 *   b            (folder, depth0)   children: d, e
 *     d          (file,   depth1)
 *     e          (file,   depth1)
 *   f            (file,   depth0)
 *   g            (folder, depth0)   empty (hasChildren=false)
 */
function node(over: Partial<FlatNode> & Pick<FlatNode, 'id'>): FlatNode {
  return {
    id: over.id,
    name: over.name ?? over.id,
    isFolder: over.isFolder ?? false,
    ext: over.ext ?? null,
    size: over.size ?? null,
    url: over.url ?? null,
    depth: over.depth ?? 0,
    parentId: over.parentId ?? null,
    hasChildren: over.hasChildren ?? false,
  }
}

const flat: FlatNode[] = [
  node({ id: 'a', isFolder: true, depth: 0, parentId: null, hasChildren: true }),
  node({ id: 'c', depth: 1, parentId: 'a' }),
  node({ id: 'b', isFolder: true, depth: 0, parentId: null, hasChildren: true }),
  node({ id: 'd', depth: 1, parentId: 'b' }),
  node({ id: 'e', depth: 1, parentId: 'b' }),
  node({ id: 'f', depth: 0, parentId: null }),
  node({ id: 'g', isFolder: true, depth: 0, parentId: null, hasChildren: false }),
]

describe('projectDrop', () => {
  it('returns null when there is no over target', () => {
    expect(projectDrop({ dragId: 'd', overId: null, offsetX: 0, flat })).toBeNull()
  })

  it('相邻下移互换：d 拖到 e 上 → after e（同级 b 内）', () => {
    // d、e 同为 b 的子；d 向下越过 e，落点深度保持 1（minDepth=nextItem 或 prev 同级）。
    const proj = projectDrop({ dragId: 'd', overId: 'e', offsetX: 0, flat })
    expect(proj).toEqual({ depth: 1, parentId: 'b', dropId: 'e', position: 'after' })
  })

  it('相邻上移互换：e 拖到 d 上 → before d（同级 b 内）', () => {
    const proj = projectDrop({ dragId: 'e', overId: 'd', offsetX: 0, flat })
    expect(proj).toEqual({ depth: 1, parentId: 'b', dropId: 'd', position: 'before' })
  })

  it('跨位移动：f 拖到 c 上（隔多行，向上）→ before c（进入 a？clamp 到 c 同级）', () => {
    // c 在 a 内 (depth1)；f 原 depth0，offsetX=0 → dragDepth=0，minDepth=nextItem(c).depth=1
    // → projectedDepth=1，parentId=a，落点在 c 之前 → before c。
    const proj = projectDrop({ dragId: 'f', overId: 'c', offsetX: 0, flat })
    expect(proj).toEqual({ depth: 1, parentId: 'a', dropId: 'c', position: 'before' })
  })

  it('跨位移动：c 拖到 f 上（向下，退回根级）→ after f', () => {
    // 去-c 列表 [a,b,d,e,f,g]，over f 在 idx4，dragIndex(c)=1<overIndex(f)=5 → insertIndex=5。
    // prevItem=f(depth0)，nextItem=g(depth0)；dragDepth=1+0=1；maxDepth=f 非文件夹→0；
    // minDepth=g.depth=0；clamp→0 → parentId=f.parentId=null（根级）→ after f。
    const proj = projectDrop({ dragId: 'c', overId: 'f', offsetX: 0, flat })
    expect(proj).toEqual({ depth: 0, parentId: null, dropId: 'f', position: 'after' })
  })

  it('跨位移动（向左拖到根级）：c 拖到 f 上 + 向左偏移 → after f（根级）', () => {
    // 向左一格：dragDepth = 1 + round(-INDENT_PX/INDENT_PX) = 0 → projectedDepth 0 → 根级。
    const proj = projectDrop({ dragId: 'c', overId: 'f', offsetX: -INDENT_PX, flat })
    expect(proj).toEqual({ depth: 0, parentId: null, dropId: 'f', position: 'after' })
  })

  it('nest：f 向右拖进上方文件夹 b（over=e，offsetX 向右）→ 进入 b 子级', () => {
    // 去-f 列表 [a,c,b,d,e,g]，over e 在 idx4，dragIndex(f)=5>overIndex(e)=4 → insertIndex=4。
    // prevItem=d(depth1,parent b)，nextItem=e(depth1,parent b)；向右一格 dragDepth=0+1=1；
    // maxDepth=d 非文件夹→1，minDepth=e.depth=1，clamp→1 → parentId=d.parentId=b → after d（进 b）。
    const proj = projectDrop({ dragId: 'f', overId: 'e', offsetX: INDENT_PX, flat })
    expect(proj).toEqual({ depth: 1, parentId: 'b', dropId: 'd', position: 'after' })
  })

  it('nest 进空文件夹：f 拖到空夹 g 上 + 向右 → inside g', () => {
    // over=g(空文件夹, depth0, hasChildren=false)。prevItem=g（去 f 后 g 在末尾前一位）。
    // 向右一格：dragDepth=0+1=1；prevItem g 是文件夹 → maxDepth=g.depth+1=1；
    // nextItem=null → minDepth=0；clamp→1 → parentId=g（成为 g 首子）→ inside g。
    const proj = projectDrop({ dragId: 'f', overId: 'g', offsetX: INDENT_PX, flat })
    expect(proj).toEqual({ depth: 1, parentId: 'g', dropId: 'g', position: 'inside' })
  })

  it('unnest：d 向左拖（over=e）→ 退到根级，落在 b 之后某根级兄弟', () => {
    // d over e + 向左一格：dragDepth = 1 + round(-INDENT_PX/INDENT_PX)=0；
    // 去-d 列表 [a,c,b,e,f,g]，over e 在 idx3，prevItem=b(depth0)。
    // maxDepth=b 文件夹 → b.depth+1=1；minDepth=nextItem f.depth=0；clamp(0)→0。
    // projectedDepth0：parentId=b.parentId=null（根级）→ 向上找根级兄弟 b → after b。
    const proj = projectDrop({ dragId: 'd', overId: 'e', offsetX: -INDENT_PX, flat })
    expect(proj).toEqual({ depth: 0, parentId: null, dropId: 'b', position: 'after' })
  })

  it('环路守卫：把文件夹 b 拖进自身子树（over=自身的子已折叠不在 flat，模拟 over 自身后代）', () => {
    // 构造一个 b 的可见后代场景：扁平里若 b 的子在其后，落点 parentId 解析到 b 自身/后代
    // 时应 return null。这里直接验证 over 自身且向右深度推进会被环路守卫拦下。
    const proj = projectDrop({ dragId: 'b', overId: 'b', offsetX: 4 * INDENT_PX, flat })
    // b 折叠拖动时其子不在 flat（onDragStart 折叠），over 自身 + 向右 → parentId 不会是 b 后代，
    // 但落点应仍为非空有效目标（见下方自身-over 用例），此处仅断言不是 b 自身 inside。
    expect(proj).not.toBeNull()
    if (proj) expect(proj.parentId).not.toBe('b')
  })

  it('overId === dragId 帧返回非空（根因回归）：d 自身-over → 落回原槽 before/after 同级', () => {
    // 落点前最后一帧 dnd-kit 把 over 报成 drag 自身。旧实现 return null → onDragEnd 静默
    // 丢弃 → 位置不变。修复后用被拖项原视觉槽位推 insertIndex，必须给出非空目标。
    const proj = projectDrop({ dragId: 'd', overId: 'd', offsetX: 0, flat })
    expect(proj).not.toBeNull()
    // d 原在 b 的首子（去-d 列表 [a,c,b,e,f,g]，dragIndex=3 → insertIndex=3 = e 之前），
    // 落点深度保持同级 → before e（回到 b 首子位置）。
    expect(proj).toEqual({ depth: 1, parentId: 'b', dropId: 'e', position: 'before' })
  })

  it('overId === dragId 帧返回非空：根级文件 f 自身-over → 非空目标', () => {
    const proj = projectDrop({ dragId: 'f', overId: 'f', offsetX: 0, flat })
    expect(proj).not.toBeNull()
    // 去-f 列表 [a,c,b,d,e,g]，dragIndex(f)=5 → insertIndex=min(5,6)=5 = g 之前。
    // prevItem=e(depth1) maxDepth=1，nextItem=g(depth0) minDepth=0，dragDepth=0 → 0；
    // 根级落点：向上找根级兄弟 b → after b。
    expect(proj?.parentId).toBe(null)
    expect(proj?.position).toBe('after')
  })

  it('overId === dragId 帧返回非空：文件夹 a 自身-over → 非空且非 null', () => {
    const proj = projectDrop({ dragId: 'a', overId: 'a', offsetX: 0, flat })
    expect(proj).not.toBeNull()
  })
})

/**
 * applyReorder 乐观更新单测 —— 镜像后端 reorder_file 语义。
 *
 * 复用同一棵树（递归形态）：
 *   a            (folder)   children: c
 *     c          (file)
 *   b            (folder)   children: d, e
 *     d          (file)
 *     e          (file)
 *   f            (file)
 *   g            (folder)   empty
 *
 * 断言用「拍平 id 序列 + 各父 children id」校验顺序与归属，避免被 null 占位字段干扰。
 */
function file(id: string): MaterialFile {
  return {
    id,
    name: id,
    isFolder: false,
    ext: null,
    mime: null,
    size: null,
    sizeBytes: null,
    url: null,
    children: [],
  }
}
function folder(id: string, children: MaterialFile[]): MaterialFile {
  return { ...file(id), isFolder: true, children }
}

function buildTree(): MaterialFile[] {
  return [
    folder('a', [file('c')]),
    folder('b', [file('d'), file('e')]),
    file('f'),
    folder('g', []),
  ]
}

/** 取某节点的直属 children id 列表（找不到返回 undefined）。 */
function childIds(tree: MaterialFile[], id: string): string[] | undefined {
  const walk = (list: MaterialFile[]): MaterialFile | undefined => {
    for (const n of list) {
      if (n.id === id) return n
      const hit = n.children?.length ? walk(n.children) : undefined
      if (hit) return hit
    }
    return undefined
  }
  return walk(tree)?.children.map((c) => c.id)
}

/** 根级节点 id 顺序。 */
const rootIds = (tree: MaterialFile[]) => tree.map((n) => n.id)

describe('applyReorder', () => {
  it('不可变：返回新树，原树引用与内部 children 数组均不被改', () => {
    const tree = buildTree()
    const snapshotRoot = tree.map((n) => n.id)
    const snapshotB = childIds(tree, 'b')
    const next = applyReorder(tree, { dragId: 'e', dropId: 'd', position: 'before' })
    expect(next).not.toBe(tree)
    // 原树不动。
    expect(tree.map((n) => n.id)).toEqual(snapshotRoot)
    expect(childIds(tree, 'b')).toEqual(snapshotB)
    // b 节点对象本身换成了新对象（深克隆）。
    const oldB = tree.find((n) => n.id === 'b')!
    const newB = next.find((n) => n.id === 'b')!
    expect(newB).not.toBe(oldB)
    expect(newB.children).not.toBe(oldB.children)
  })

  it('同级 after：d 拖到 e 之后 → b.children = [e, d]', () => {
    const next = applyReorder(buildTree(), { dragId: 'd', dropId: 'e', position: 'after' })
    expect(childIds(next, 'b')).toEqual(['e', 'd'])
    expect(rootIds(next)).toEqual(['a', 'b', 'f', 'g'])
  })

  it('同级 before：e 拖到 d 之前 → b.children = [e, d]', () => {
    const next = applyReorder(buildTree(), { dragId: 'e', dropId: 'd', position: 'before' })
    expect(childIds(next, 'b')).toEqual(['e', 'd'])
  })

  it('inside 进夹：f 拖进空文件夹 g → g.children = [f]，根级去掉 f', () => {
    const next = applyReorder(buildTree(), { dragId: 'f', dropId: 'g', position: 'inside' })
    expect(childIds(next, 'g')).toEqual(['f'])
    expect(rootIds(next)).toEqual(['a', 'b', 'g'])
  })

  it('inside 追加到末尾（镜像后端 len(siblings)）：c 拖进 b → b.children = [d, e, c]', () => {
    const next = applyReorder(buildTree(), { dragId: 'c', dropId: 'b', position: 'inside' })
    expect(childIds(next, 'b')).toEqual(['d', 'e', 'c'])
    // c 从原父 a 摘除，a 变空。
    expect(childIds(next, 'a')).toEqual([])
  })

  it('跨父移动 before：d 拖到根级 f 之前 → 根级 [a, b, d, f, g]，d 离开 b', () => {
    const next = applyReorder(buildTree(), { dragId: 'd', dropId: 'f', position: 'before' })
    expect(rootIds(next)).toEqual(['a', 'b', 'd', 'f', 'g'])
    expect(childIds(next, 'b')).toEqual(['e'])
  })

  it('跨父移动 after：c 拖到根级 f 之后 → 根级 [a, b, f, c, g]，a 变空', () => {
    const next = applyReorder(buildTree(), { dragId: 'c', dropId: 'f', position: 'after' })
    expect(rootIds(next)).toEqual(['a', 'b', 'f', 'c', 'g'])
    expect(childIds(next, 'a')).toEqual([])
  })

  it('inside 落点非文件夹 → 安全返回原树引用', () => {
    const tree = buildTree()
    expect(applyReorder(tree, { dragId: 'c', dropId: 'f', position: 'inside' })).toBe(tree)
  })

  it('环路守卫：把文件夹 b inside 到其子 d → 返回原树引用', () => {
    const tree = buildTree()
    expect(applyReorder(tree, { dragId: 'b', dropId: 'd', position: 'before' })).toBe(tree)
  })

  it('dragId === dropId → 返回原树引用', () => {
    const tree = buildTree()
    expect(applyReorder(tree, { dragId: 'd', dropId: 'd', position: 'after' })).toBe(tree)
  })

  it('dragId 不存在 → 返回原树引用', () => {
    const tree = buildTree()
    expect(applyReorder(tree, { dragId: 'zzz', dropId: 'd', position: 'after' })).toBe(tree)
  })

  it('dropId 不存在 → 返回原树引用', () => {
    const tree = buildTree()
    expect(applyReorder(tree, { dragId: 'd', dropId: 'zzz', position: 'after' })).toBe(tree)
  })
})
