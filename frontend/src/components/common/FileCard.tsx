import { useState } from 'react'
import { Eye, Download, ExternalLink, Loader2 } from 'lucide-react'
import { FileTypeIcon } from '@/components/common/FileTypeIcon'
import { FilePreviewDialog } from '@/components/common/FilePreviewDialog'
import { extOf, kindOf, previewKind, isPreviewable } from '@/lib/fileTypes'
import { cn } from '@/lib/cn'

/**
 * FileCard —— 正文里的文档附件卡片。Markdown `components.a` 命中 `isAttachmentHref`
 * 的链接（`[文件名.ext](/uploads/...)`）时渲染本组件，预览面板与发布详情页两处生效。
 *
 * 关键约束（plan-file-upload.md「关键修订」）：
 * - 根节点是块级 `<span data-filecard>`（**非** `<a>`，也不嵌套 `<a>`，避免在 prose
 *   链接上下文里产生非法 `<a><a>`；`data-filecard` 让评论锚点 walker 跳过整棵子树，
 *   见 useAnchorMarks.ts FILTER_REJECT）。
 * - 仿 NoteCard 容器风格：rounded-md border bg-bg，hover bg-bg-subtle。
 * - 左侧 size-9 tile：`bg-tag-*` 12% tint 底 + `FileTypeIcon`（currentColor 取 `text-cat-*`）。
 * - 预览按钮仅 `isPreviewable` 时显示（PDF/docx/xlsx/图片/代码可预），点开 FilePreviewDialog。
 * - 下载用 fetch→blob→a[download]，跨源（dev 5173↔8000）也能真正触发下载。
 * - 三个按钮都 `e.stopPropagation()`，避免冒泡到外层容器（如卡片所在的链接区域）。
 */

type Props = {
  /** 附件 url（来自 markdown 链接 href，可能相对 `/uploads/...` 或绝对）。 */
  href: string
  /** 展示文件名（markdown 链接文本；为空时由调用方回退成 url 末段）。 */
  filename: string
}

export function FileCard({ href, filename }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const name = filename || lastSegment(href)
  const ext = extOf(name) || extOf(href)
  const info = kindOf(ext)
  const canPreview = isPreviewable(previewKind(ext))

  const stop = (e: React.MouseEvent) => e.stopPropagation()

  const onDownload = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setDownloading(true)
    try {
      const res = await fetch(href)
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = name || 'download'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      // 兜底：直接打开（同源/blob 触发下载，跨源至少不静默失败）。
      window.open(href, '_blank', 'noopener,noreferrer')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <span
        data-filecard
        className="my-2 flex max-w-md items-center gap-3 rounded-md border border-border bg-bg p-3 no-underline transition hover:bg-bg-subtle"
      >
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md',
            info.tileBgClass,
          )}
        >
          <FileTypeIcon ext={ext} className="size-5" />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-text" title={name}>
            {name}
          </span>
          <span className="text-xs text-text-faint">{info.label}</span>
        </span>

        <span className="flex shrink-0 items-center gap-0.5">
          {canPreview && (
            <CardButton
              aria-label="预览"
              title="预览"
              onMouseDown={stop}
              onClick={(e) => {
                e.stopPropagation()
                setPreviewOpen(true)
              }}
            >
              <Eye size={15} aria-hidden />
            </CardButton>
          )}
          <CardButton
            aria-label="下载"
            title="下载"
            disabled={downloading}
            onMouseDown={stop}
            onClick={onDownload}
          >
            {downloading ? (
              <Loader2 size={15} aria-hidden className="animate-spin" />
            ) : (
              <Download size={15} aria-hidden />
            )}
          </CardButton>
          <CardButton
            aria-label="在新窗口打开"
            title="在新窗口打开"
            onMouseDown={stop}
            onClick={(e) => {
              e.stopPropagation()
              window.open(href, '_blank', 'noopener,noreferrer')
            }}
          >
            <ExternalLink size={15} aria-hidden />
          </CardButton>
        </span>
      </span>

      {canPreview && (
        <FilePreviewDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          url={href}
          name={name}
        />
      )}
    </>
  )
}

function CardButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="inline-flex size-7 items-center justify-center rounded-sm text-text-muted transition hover:bg-border hover:text-text disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  )
}

/** url 末段路径作为文件名兜底（去 query/hash）。 */
function lastSegment(href: string): string {
  const s = (href.split('#')[0] ?? '').split('?')[0] ?? ''
  const lastSlash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  const seg = lastSlash >= 0 ? s.slice(lastSlash + 1) : s
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}
