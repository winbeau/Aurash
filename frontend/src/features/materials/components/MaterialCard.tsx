import * as React from 'react'
import { Folder, MoreVertical, Pencil, Trash2 } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FileTypeIcon } from '@/components/common/FileTypeIcon'
import { cn } from '@/lib/cn'
import { useAuthStore } from '@/stores/authStore'

import { getTagBadge } from '../data'
import { countFiles } from '../lib/tree'
import type { MaterialResource } from '../types'

/**
 * 资源卡片 —— Card + tag/文件数 Badge + updateDate + 目录预览(前 3) + group-hover
 * 操作菜单（编辑/删除，仅 owner 可见）。点击卡片进详情。token 配色，去 KnoHub 渐变。
 *
 * 设计：
 * - 整卡可点（进详情）；操作按钮绝对定位卡片右上（`absolute right-2 top-2`），
 *   group-hover 浮现，仅 owner/admin 渲染——不占独立头部行，无 tag 时也无留白。
 * - 课程类型角标与标题同行（badge shrink-0 + h3 min-w-0 flex-1 truncate）；无 tag 不渲染占位。
 * - 操作走 DropdownMenu（已装 ui/dropdown-menu），避免在卡片上堆按钮；删除走
 *   消费侧传入的 onDelete（由父级用 useConfirm + useDeleteResource 处理）。
 * - 目录预览：列表场景 `files` 通常为空（后端省略树）→ 该区按需渲染，无文件时省略。
 */

type Props = {
  resource: MaterialResource
  onOpen: (resource: MaterialResource) => void
  onEdit: (resource: MaterialResource) => void
  onDelete: (resource: MaterialResource) => void
}

export function MaterialCard({ resource, onOpen, onEdit, onDelete }: Props) {
  const sid = useAuthStore((s) => s.user?.sid ?? null)
  const isAdmin = useAuthStore((s) => s.user?.isAdmin ?? false)
  // 资源 owner 或超级管理员可管理（编辑/删除）。
  const canManage = isAdmin || (sid != null && sid === resource.ownerSid)

  const badge = getTagBadge(resource.tag)
  const fileCount = countFiles(resource.files)
  // 顶层目录预览（前 3 个），仅在列表带树时（详情缓存命中）展示。
  const topLevel = resource.files.slice(0, 3)

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen(resource)
    }
  }

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpen(resource)}
      onKeyDown={onKeyDown}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-3 rounded-lg border-border p-4',
        'shadow-card transition-colors hover:bg-bg-hover focus-visible:outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {/* 操作菜单：绝对定位卡片右上，group-hover 浮现，仅 owner/admin 可见。 */}
      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label="资料操作"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              onSelect={() => onEdit(resource)}
              className="gap-2"
            >
              <Pencil className="h-4 w-4" />
              编辑
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => onDelete(resource)}
              className="gap-2 text-cat-research focus:text-cat-research"
            >
              <Trash2 className="h-4 w-4" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {/* 标题（角标同行）+ 简介；pr-7 给右上绝对操作按钮留位，避免 hover 时遮标题。 */}
      <div className="min-w-0 space-y-1 pr-7">
        <div className="flex items-center gap-2 min-w-0">
          {badge ? (
            <span
              className={cn(
                'inline-flex shrink-0 items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
                badge.bgClass,
                badge.textClass,
                badge.borderClass,
              )}
            >
              {badge.label}
            </span>
          ) : null}
          <h3
            className="min-w-0 flex-1 truncate font-serif text-base font-semibold text-text"
            title={resource.title}
          >
            {resource.title}
          </h3>
        </div>
        {resource.description ? (
          <p className="line-clamp-2 text-sm text-text-muted">{resource.description}</p>
        ) : null}
      </div>

      {/* 目录预览（前 3，仅有树时） */}
      {topLevel.length > 0 ? (
        <ul className="space-y-1">
          {topLevel.map((node) => (
            <li key={node.id} className="flex items-center gap-1.5 text-xs text-text-muted">
              {node.isFolder ? (
                <Folder className="size-3.5 shrink-0 text-cat-course" strokeWidth={1.75} aria-hidden />
              ) : (
                <FileTypeIcon ext={node.ext ?? ''} size={14} className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{node.name}</span>
            </li>
          ))}
          {fileCount > topLevel.length ? (
            <li className="text-xs text-text-faint">…等共 {fileCount} 个文件</li>
          ) : null}
        </ul>
      ) : null}

      {/* 底部：文件数 + 更新时间 */}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1 text-xs text-text-muted">
        <span>{fileCount} 个文件</span>
        <time dateTime={resource.updateDate}>更新于 {formatDate(resource.updateDate)}</time>
      </div>
    </Card>
  )
}

/** ISO → 本地化短日期（YYYY-MM-DD）。无效时回退原串。 */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
