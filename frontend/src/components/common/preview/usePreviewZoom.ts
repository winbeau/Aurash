import { useCallback, useState } from 'react'

/**
 * usePreviewZoom —— per-file 缩放比例缓存 hook（被 PdfViewer / DocxViewer / ImageViewer 复用）。
 *
 * 设计：
 * - 三级缓存。读取优先级：module 级 Map（同会话即时命中、跨 Dialog 开关保留）
 *   → localStorage（跨刷新保留）→ 入参默认值。
 * - localStorage key 形如 `aurash.preview.<kind>-zoom:<fileId>`，`kind` 区分
 *   pdf/docx/image，`fileId` 是稳定标识（资料页传 DB fileId，写作栏附件无 id 时
 *   传 url —— 同一 url 即同一文件）。
 * - `fileId` 为空（极少数无 id 又无 url 的兜底）时退化为「不持久化」：只用 React
 *   state，避免污染 localStorage（key 会变成同一个 `:`）。
 *
 * 用法：
 *   const { zoom, setZoom, zoomIn, zoomOut, reset } = usePreviewZoom('pdf', fileId, 1)
 */

export type ZoomKind = 'pdf' | 'docx' | 'image'

/** 缩放上下限与步长，与各 viewer 工具栏一致（30% ~ 300%）。 */
export const ZOOM_MIN = 0.3
export const ZOOM_MAX = 3
export const ZOOM_STEP = 0.1

/** module 级缓存：同会话内即时命中，跨 Dialog 开关、跨组件实例保留。 */
const memo = new Map<string, number>()

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

function storageKey(kind: ZoomKind, fileId: string): string {
  return `aurash.preview.${kind}-zoom:${fileId}`
}

/** 初值解析：module Map → localStorage → fallback，全部 clamp。 */
function readInitial(kind: ZoomKind, fileId: string | undefined, fallback: number): number {
  if (!fileId) return clampZoom(fallback)
  const k = storageKey(kind, fileId)
  const cached = memo.get(k)
  if (typeof cached === 'number') return clampZoom(cached)
  try {
    const raw = localStorage.getItem(k)
    if (raw != null) {
      const parsed = Number.parseFloat(raw)
      if (Number.isFinite(parsed)) {
        const v = clampZoom(parsed)
        memo.set(k, v)
        return v
      }
    }
  } catch {
    /* localStorage 不可用（隐私模式等）→ 退化为 fallback */
  }
  return clampZoom(fallback)
}

export type UsePreviewZoom = {
  /** 当前缩放比例（1 = 100%）。 */
  zoom: number
  /** 直接设值（自动 clamp + 持久化）。可传函数式 updater。 */
  setZoom: (next: number | ((prev: number) => number)) => void
  /** +ZOOM_STEP。 */
  zoomIn: () => void
  /** -ZOOM_STEP。 */
  zoomOut: () => void
  /** 重置回 100%。 */
  reset: () => void
}

export function usePreviewZoom(
  kind: ZoomKind,
  fileId: string | undefined,
  fallback = 1,
): UsePreviewZoom {
  const [zoom, setZoomState] = useState<number>(() => readInitial(kind, fileId, fallback))

  const persist = useCallback(
    (v: number) => {
      if (!fileId) return
      const k = storageKey(kind, fileId)
      memo.set(k, v)
      try {
        localStorage.setItem(k, String(v))
      } catch {
        /* 配额/隐私模式：module Map 仍生效，静默忽略 */
      }
    },
    [kind, fileId],
  )

  const setZoom = useCallback(
    (next: number | ((prev: number) => number)) => {
      setZoomState((prev) => {
        const raw = typeof next === 'function' ? next(prev) : next
        const v = clampZoom(raw)
        persist(v)
        return v
      })
    },
    [persist],
  )

  const zoomIn = useCallback(() => setZoom((z) => z + ZOOM_STEP), [setZoom])
  const zoomOut = useCallback(() => setZoom((z) => z - ZOOM_STEP), [setZoom])
  const reset = useCallback(() => setZoom(1), [setZoom])

  return { zoom, setZoom, zoomIn, zoomOut, reset }
}
