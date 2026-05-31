import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import { downloadUrl, materialsAuthHeaders } from '@/api/endpoints/materials'

/**
 * 文件下载 hook —— fetch + ReadableStream 读真实进度 + a[download] 触发保存。
 *
 * 为什么不用裸 `<a download>`：跨源（dev 5173↔8000）`download` 属性被忽略会退化为
 * 导航打开；fetch→blob→objectURL 是同源 blob，`download` 一定生效。同时 stream
 * 读 reader 可累计 `loaded/total` 算真实进度（Content-Length 缺失时退化为不确定）。
 *
 * 进度按 fileId 维度维护，支持同时多文件下载各自一条进度。toast 在 hook 层调用。
 */

export type DownloadProgress = {
  /** 0..1；total 未知时为 null（不确定进度，UI 显示转圈）。 */
  ratio: number | null
  loaded: number
  total: number | null
  done: boolean
}

const INITIAL: DownloadProgress = { ratio: null, loaded: 0, total: null, done: false }

export function useDownload() {
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({})
  // 进行中的 fileId，避免重复点击重复下载。
  const inflight = useRef<Set<string>>(new Set())

  const setOne = useCallback((fileId: string, p: DownloadProgress) => {
    setProgress((prev) => ({ ...prev, [fileId]: p }))
  }, [])

  const clearOne = useCallback((fileId: string) => {
    setProgress((prev) => {
      const next = { ...prev }
      delete next[fileId]
      return next
    })
  }, [])

  /**
   * 下载某文件。`name` 用于 `a.download` 的保存名（后端响应头也带
   * Content-Disposition，blob 下载以此 name 为准）。
   */
  const download = useCallback(
    async (fileId: string, name: string): Promise<void> => {
      if (inflight.current.has(fileId)) return
      inflight.current.add(fileId)
      setOne(fileId, { ...INITIAL })

      let objectUrl: string | null = null
      try {
        const res = await fetch(downloadUrl(fileId), {
          headers: materialsAuthHeaders(),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        const lenHeader = res.headers.get('Content-Length')
        const total = lenHeader ? Number(lenHeader) : null

        let blob: Blob
        if (res.body && typeof res.body.getReader === 'function') {
          const reader = res.body.getReader()
          const chunks: Uint8Array[] = []
          let loaded = 0
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
              chunks.push(value)
              loaded += value.length
              setOne(fileId, {
                loaded,
                total,
                ratio: total && total > 0 ? Math.min(loaded / total, 1) : null,
                done: false,
              })
            }
          }
          blob = new Blob(chunks as BlobPart[])
        } else {
          // 退化路径（无 stream 支持）：一次性读 blob，无进度。
          blob = await res.blob()
        }

        objectUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objectUrl
        a.download = name || 'download'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setOne(fileId, {
          loaded: blob.size,
          total: blob.size,
          ratio: 1,
          done: true,
        })
      } catch (e) {
        // 兜底：直接打开（同源/blob 触发下载，跨源至少不静默失败）+ toast。
        toast.error(e instanceof Error ? `下载失败：${e.message}` : '下载失败')
        try {
          window.open(downloadUrl(fileId), '_blank', 'noopener,noreferrer')
        } catch {
          /* ignore */
        }
        clearOne(fileId)
      } finally {
        inflight.current.delete(fileId)
        if (objectUrl) URL.revokeObjectURL(objectUrl)
      }
    },
    [setOne, clearOne],
  )

  return { download, progress, clearProgress: clearOne }
}
