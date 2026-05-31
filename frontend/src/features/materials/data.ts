import { FolderOpen, Inbox, type LucideIcon } from 'lucide-react'
import type { ResourceTag } from './types'

/**
 * 「资料」页静态展示数据 —— TAG 徽章样式映射 + 空态文案。
 *
 * 设计要点：
 * - 角标配色只用 tailwind token（cat-* 与 tag-*），禁硬编码 sky / slate：
 *   专业课 → cat-research（科研红）、通识课 → cat-kaggle（蓝）、
 *   实验课 → cat-tools（工具绿）。底座用对应 12% tint（bg-tag-*）。
 * - 文件类型图标统一走共享 `@/components/common/FileTypeIcon`（kindOf 驱动），
 *   这里不重复造图标，只给 TAG 角标与空态文案。
 */

export type TagBadgeStyle = {
  label: string
  /** 文字 token class（如 text-cat-research）。 */
  textClass: string
  /** 12% tint 底座 token class（如 bg-tag-research）。 */
  bgClass: string
  /** 边框 token class（与文字同色系，弱化）。 */
  borderClass: string
}

/** 课程类型 → 角标样式。专业课/通识课/实验课；null 不渲染角标。 */
export const TAG_BADGE: Readonly<Record<ResourceTag, TagBadgeStyle>> = Object.freeze({
  专业课: {
    label: '专业课',
    textClass: 'text-cat-research',
    bgClass: 'bg-tag-research',
    borderClass: 'border-cat-research/30',
  },
  通识课: {
    label: '通识课',
    textClass: 'text-cat-kaggle',
    bgClass: 'bg-tag-kaggle',
    borderClass: 'border-cat-kaggle/30',
  },
  实验课: {
    label: '实验课',
    textClass: 'text-cat-tools',
    bgClass: 'bg-tag-tools',
    borderClass: 'border-cat-tools/30',
  },
})

/** 安全取课程类型样式；未知值（理论上 schema 已拦）回退 null。 */
export function getTagBadge(tag: ResourceTag | null | undefined): TagBadgeStyle | null {
  if (!tag) return null
  return TAG_BADGE[tag] ?? null
}

/** 资源卡上 Select 可选的课程类型（另有「无」哨兵 TAG_NONE）。 */
export const TAG_OPTIONS: ReadonlyArray<{ value: ResourceTag; label: string }> = [
  { value: '专业课', label: '专业课' },
  { value: '通识课', label: '通识课' },
  { value: '实验课', label: '实验课' },
]

/** 「无徽章」在 Select 里的哨兵值（Radix Select 不接受空串 value）。 */
export const TAG_NONE = '__none__' as const

export type EmptyCopy = {
  icon: LucideIcon
  title: string
  description: string
}

/** 列表整体空态（一条资源都没有）。 */
export const EMPTY_RESOURCES: EmptyCopy = {
  icon: Inbox,
  title: '还没有任何资料',
  description: '点击右下角按钮，创建第一份课程资料卡，开始上传与共享。',
}

/** 搜索无结果空态。 */
export const EMPTY_SEARCH: EmptyCopy = {
  icon: Inbox,
  title: '没有匹配的资料',
  description: '换个关键词试试，或清空搜索查看全部资料。',
}

/** 资源详情内文件树为空时的空态。 */
export const EMPTY_FILES: EmptyCopy = {
  icon: FolderOpen,
  title: '这份资料还没有文件',
  description: '上传文件或新建文件夹来组织内容（仅作者可操作）。',
}

/** 列表加载/操作失败的统一文案前缀。 */
export const ERROR_COPY = {
  list: '加载资料列表失败',
  detail: '加载资料详情失败',
  files: '加载文件树失败',
} as const
