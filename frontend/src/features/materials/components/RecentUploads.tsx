import { History } from 'lucide-react'

import { FileTypeIcon } from '@/components/common/FileTypeIcon'
import { cn } from '@/lib/cn'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'

import type { PreviewTarget } from '../types'

/**
 * 最近上传横向条带 —— 最近更新的 N 个文件 chip，点击直达共享 viewer 预览。
 *
 * 数据由父级（MaterialListView）算好（资源树通常需详情才有文件，列表场景文件多为空，
 * 故 items 由父级从已缓存的详情/带树资源里聚合）；本组件只负责横向滚动展示。
 * 无数据时整块不渲染（父级判空）。
 */

export type RecentItem = PreviewTarget & {
  /** 文件扩展名（驱动图标）。 */
  ext: string | null
  /** 所属资源标题（chip 副标题）。 */
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
    <section className={cn('space-y-2', className)} aria-label="最近上传">
      <div className="flex items-center gap-1.5 text-sm font-medium text-text-muted">
        <History className="size-4" strokeWidth={1.75} aria-hidden />
        <span>最近上传</span>
      </div>
      <ScrollArea className="w-full whitespace-nowrap">
        <ul className="flex gap-2 pb-2">
          {items.map((item) => (
            <li key={item.fileId} className="shrink-0">
              <button
                type="button"
                onClick={() =>
                  onPreview({ fileId: item.fileId, url: item.url, name: item.name })
                }
                title={`${item.name} · ${item.resourceTitle}`}
                className={cn(
                  'flex max-w-[220px] items-center gap-2 rounded-md border border-border bg-bg-subtle px-2.5 py-1.5',
                  'text-left transition-colors hover:bg-bg-hover',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <FileTypeIcon ext={item.ext ?? ''} size={18} className="size-[18px] shrink-0" />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-text">{item.name}</span>
                  <span className="block truncate text-[11px] text-text-faint">
                    {item.resourceTitle}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </section>
  )
}
