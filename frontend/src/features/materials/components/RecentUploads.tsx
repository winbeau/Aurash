import { ChevronDown, History } from 'lucide-react'

import { FileTypeIcon } from '@/components/common/FileTypeIcon'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/cn'

import type { PreviewTarget } from '../types'

/**
 * 最近上传弹出层 —— 顶部行右侧的「🕘 最近上传 N」按钮（与搜索框同行、等高 h-9），
 * 点击弹出最近文件浮层，点条目直达共享 viewer 预览。
 *
 * 数据由父级（MaterialListView）从已带树的资源里聚合；无数据时整块不渲染（按钮也不出现），
 * 故只有真有最近文件时顶部行才多出这枚按钮，平时行内保持干净。
 */

export type RecentItem = PreviewTarget & {
  /** 文件扩展名（驱动图标）。 */
  ext: string | null
  /** 所属资源标题（条目副标题）。 */
  resourceTitle: string
}

type Props = {
  items: RecentItem[]
  onPreview: (target: PreviewTarget) => void
  className?: string
}

export function RecentUploads({ items, onPreview, className }: Props) {
  if (items.length === 0) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn('h-9 shrink-0 gap-2 px-3 font-normal text-text-muted', className)}
          aria-label={`最近上传，共 ${items.length} 个文件`}
        >
          <History className="size-4" strokeWidth={1.75} aria-hidden />
          <span className="hidden sm:inline">最近上传</span>
          <span className="min-w-[1.25rem] rounded-sm bg-bg-subtle px-1 text-center text-xs font-medium tabular-nums text-text-muted">
            {items.length}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-text-faint" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 overflow-hidden p-0">
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2.5 text-sm font-medium text-text">
          <History className="size-4 text-text-muted" strokeWidth={1.75} aria-hidden />
          最近上传
        </div>
        <ul className="max-h-[min(60vh,22rem)] overflow-y-auto p-1.5">
          {items.map((item) => (
            <li key={item.fileId}>
              <button
                type="button"
                onClick={() =>
                  onPreview({ fileId: item.fileId, url: item.url, name: item.name })
                }
                title={`${item.name} · ${item.resourceTitle}`}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                  'hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none',
                )}
              >
                <FileTypeIcon ext={item.ext ?? ''} size={20} className="size-5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-text">
                    {item.name}
                  </span>
                  <span className="block truncate text-[11px] text-text-faint">
                    {item.resourceTitle}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
