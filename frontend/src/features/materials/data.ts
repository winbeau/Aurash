import { FolderOpen, Inbox, type LucideIcon } from 'lucide-react'
import type { ResourceTag } from './types'

/**
 * 「资料」页静态展示数据 —— TAG 徽章样式映射 + 空态文案。
 *
 * 设计要点：
 * - 角标徽章配色只用 tailwind token（cat-* 与 tag-*），禁硬编码 sky / slate：
 *   New → cat-recommend（推免绿松石）、Hot → cat-research（科研红）、
 *   Rec → cat-tools（工具绿）。底座用对应 12% tint（bg-tag-*）。
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

/** TAG → 徽章样式。仅 New/Hot/Rec 三种；null 不渲染徽章。 */
export const TAG_BADGE: Readonly<Record<ResourceTag, TagBadgeStyle>> = Object.freeze({
  New: {
    label: '新上线',
    textClass: 'text-cat-recommend',
    bgClass: 'bg-tag-recommend',
    borderClass: 'border-cat-recommend/30',
  },
  Hot: {
    label: '热门',
    textClass: 'text-cat-research',
    bgClass: 'bg-tag-research',
    borderClass: 'border-cat-research/30',
  },
  Rec: {
    label: '推荐',
    textClass: 'text-cat-tools',
    bgClass: 'bg-tag-tools',
    borderClass: 'border-cat-tools/30',
  },
})

/** 安全取 TAG 样式；未知 tag（理论上 schema 已拦）回退 null。 */
export function getTagBadge(tag: ResourceTag | null | undefined): TagBadgeStyle | null {
  if (!tag) return null
  return TAG_BADGE[tag] ?? null
}

/** 资源卡上 Select 可选的 TAG 选项（含「无」）。 */
export const TAG_OPTIONS: ReadonlyArray<{ value: ResourceTag; label: string }> = [
  { value: 'New', label: '新上线' },
  { value: 'Hot', label: '热门' },
  { value: 'Rec', label: '推荐' },
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
