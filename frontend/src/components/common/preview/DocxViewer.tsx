import type * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'

import { resolveAssetUrl } from '@/api/client'
import { Button } from '@/components/ui/button'
import { FileTypeIcon } from '@/components/common/FileTypeIcon'
import { extOf } from '@/lib/fileTypes'
import { useDragScroll } from './useDragScroll'
import { usePreviewZoom } from './usePreviewZoom'

/**
 * DocxViewer —— docx-preview `renderAsync` 高保真渲染（仅 `.docx`，旧版 `.doc` 走降级卡）。
 *
 * 关键实现（已拍板预览栈：docx-preview 自渲染，不用 mammoth / dompurify）：
 * - `renderAsync(buffer, container)` 把 OOXML 渲染进 ref 容器（自带 wrapper / 分页 / 样式）。
 * - 缩放用 CSS `transform: scale()`（docx-preview 输出固定像素页面，scale 不重排、零重渲染）。
 * - 渲染失败直接 throw → 交给 FilePreviewDialog 的 ErrorBoundary / catch 降级，绝不白屏。
 * - 500ms 延迟 spinner：快文件不闪 Loader2。
 * - 竞态：换文件 / 卸载时 token 自增让旧批次回调自我放弃，并清空容器。
 */

type Props = {
  url: string
  name: string
  fileId?: string | undefined
  /** 头部右侧动作槽（下载 / 新窗口等，由父级注入）。 */
  headerActions?: React.ReactNode
}

export default function DocxViewer({ url, name, fileId, headerActions }: Props) {
  const { zoom, setZoom, zoomIn, zoomOut } = usePreviewZoom('docx', fileId ?? url, 1)
  // 追踪当前 zoom 供 [url] effect 的测量 rAF 读取（effect 闭包里的 zoom 是挂载时旧值）。
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const [loading, setLoading] = useState(true)
  const [showSpinner, setShowSpinner] = useState(false)
  // 渲染后测得的「自然（未缩放）」页宽高：用于撑出 scaled 包裹层 + 适应宽度计算。
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const token = useRef(0)

  // 延迟 spinner。
  useEffect(() => {
    if (!loading) {
      setShowSpinner(false)
      return
    }
    const t = window.setTimeout(() => setShowSpinner(true), 500)
    return () => window.clearTimeout(t)
  }, [loading])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const my = ++token.current
    const abort = new AbortController()
    setLoading(true)
    setNatural(null)
    container.replaceChildren()

    ;(async () => {
      const res = await fetch(resolveAssetUrl(url), { signal: abort.signal })
      if (!res.ok) throw new Error(`文档加载失败（${res.status}）`)
      const blob = await res.blob()
      if (my !== token.current) return
      const { renderAsync } = await import('docx-preview')
      if (my !== token.current) return
      await renderAsync(blob, container, undefined, {
        className: 'docx',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,
        experimental: true,
        useBase64URL: true,
      })
      if (my !== token.current) return
      setLoading(false)
      // 等字体/布局沉降后再测（双 rAF 避开 pre-layout 0）。
      // offsetWidth/offsetHeight 不受 transform 影响 → 直接拿到自然未缩放尺寸。
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (my !== token.current) return
          // 用「整个渲染块」(.docx-wrapper，含左右 gutter) 的**真实已绘制几何**反推
          // 自然(未缩放)尺寸：getBoundingClientRect 反映 transform 缩放后的真实宽高，
          // 除以当时 zoom 即得未缩放真值——比 offsetWidth 更稳（含 padding、避开瞬时布局/
          // 滚动条误差，消除适宽残余溢出）。此刻 natural=null → scaledW 未约束。
          const wrapper = container.querySelector('.docx-wrapper') as HTMLElement | null
          const target = wrapper ?? container
          const z = zoomRef.current || 1
          const rect = target.getBoundingClientRect()
          const w = rect.width / z
          const h = rect.height / z
          if (w > 0) setNatural({ w, h })
        }),
      )
    })().catch((err) => {
      if (abort.signal.aborted) return
      if (my !== token.current) return
      throw err
    })

    return () => {
      abort.abort()
      // token 自增让上面的 async 回调全部失效。
      token.current += 1
      container.replaceChildren()
    }
  }, [url])

  // 真·适应宽度：按自然(未缩放)块宽算绝对 zoom，使内容铺满容器内宽（减 p-4=16*2）。
  // 容器已 max-content（不二次放大），natural.w 与实际绘制一致 → 此式两个方向都准
  // （内容过宽→缩小、过窄→放大填满）。setZoom 内部 clamp 30%~300%。
  const onFitWidth = useCallback(() => {
    const host = scrollRef.current
    if (!host || !natural || natural.w <= 0) return
    const avail = host.clientWidth - 32
    if (avail <= 0) return
    setZoom(avail / natural.w)
  }, [natural, setZoom])

  // 拖拽平移：4px 阈值保留 docx 文本选区（小位移点击/选区透传给浏览器）。
  useDragScroll(scrollRef, { enabled: true })

  // 包裹层尺寸 = 自然尺寸 × zoom：让滚动盒 scrollWidth/Height 反映 scaled 后大小
  // （transform:scale 本身不更新父级 scroll 尺寸）。
  const scaledW = natural ? natural.w * zoom : undefined
  const scaledH = natural ? natural.h * zoom : undefined

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* 单行头部：图标 + 文件名 + 缩放组 + 动作槽（下载/新窗口由父级注入）。 */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border-strong bg-bg-subtle px-3 py-2 pr-10">
        <FileTypeIcon ext={extOf(name) || extOf(url)} className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text" title={name}>
          {name}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={zoomOut}
            aria-label="缩小"
            title="缩小"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-11 text-center text-xs tabular-nums text-text-muted">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={zoomIn}
            aria-label="放大"
            title="放大"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onFitWidth}
            aria-label="适应宽度"
            title="适应宽度"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
        {headerActions}
      </div>

      {/* 滚动区（暖近白衬底，衬托白色文档页）。 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-bg-subtle p-4">
        {/* 与 PDF 同款 w-max + min-w-full 居中：w-max=取内容(包裹层)宽、min-w-full≥容器；
            窄于视口时 items-center 水平居中，宽于视口时 host 从滚动原点起、两端都可滚到——
            不用滚动盒上的 items-center（超宽内容会被居中裁掉左侧，正是要修的 bug）。 */}
        <div className="flex w-max min-w-full flex-col items-center">
          {/* 包裹层显式占 scaled 尺寸 → 撑大滚动盒；transform-origin top left 让缩放内容原点可达。 */}
          <div style={{ width: scaledW, height: scaledH }}>
            <div
              ref={containerRef}
              aria-label={`${name} 文档预览`}
              style={{
                // max-content：容器取**自然内容宽**（不被 scaledW 父级拉伸填满）。否则容器
                // 先填满 sizer(=natural*zoom) 再被 transform 二次缩放 → 双重放大、scrollWidth
                // 暴涨（且内层 .docx-wrapper 被挤窄、section 溢出）。取 max-content 后：容器
                // = 自然宽，缩放一次恰好铺满 sizer，scrollWidth 与 sizer 一致。
                width: 'max-content',
                transform: `scale(${zoom})`,
                transformOrigin: 'top left',
              }}
            />
          </div>
        </div>
      </div>

      {showSpinner && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      )}
    </div>
  )
}
