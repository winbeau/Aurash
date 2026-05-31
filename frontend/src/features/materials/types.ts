/**
 * 「资料」页（共享课程资料知识库）的前端类型契约 —— 列表场景 + 详情场景共用。
 *
 * 设计要点：
 * - 这里是**契约层**：详情阶段（FileTree / PreviewPane / UploadDialog）与列表阶段
 *   （MaterialCard / MaterialListView / RecentUploads）都从这里取类型，单一来源。
 * - 字段与后端 CamelModel（app/schemas/material.py）一一对应，wire 即 camelCase。
 * - 类型由 zod schema（`@/api/schemas/material`）推导，避免手写漂移：MaterialFile /
 *   MaterialResource = `z.infer<...>`，运行时由 zod 在 API 边界校验。
 * - `ReorderPosition` 是 dnd-kit 拖拽落点语义（before/after/inside），同时是
 *   reorder API body 的字段值。
 *
 * 「资料」= 共享知识库（拍板决策 §1）：列表/详情对所有登录用户可见；写操作需登录，
 * 且改/删某资源及其文件仅 `ownerSid === 当前用户` 才允许（403）。
 */

import type {
  MaterialFileSchema,
  MaterialResourceSchema,
  ResourceTagSchema,
  ReorderPositionSchema,
} from '@/api/schemas/material'
import type { z } from 'zod'

/** 资源卡角标徽章：New / Hot / Rec；null = 无徽章。 */
export type ResourceTag = z.infer<typeof ResourceTagSchema>

/** 拖拽落点：before/after 同级互为兄弟，inside 成为目标（文件夹）的子节点。 */
export type ReorderPosition = z.infer<typeof ReorderPositionSchema>

/**
 * 文件树节点（递归）—— 文件与文件夹同型，`isFolder` 区分。
 * - 文件夹：`isFolder=true`，带 `children`，无 ext/mime/size/url。
 * - 文件：`isFolder=false`，带 `ext`/`mime`/`size`(可读字符串)/`sizeBytes`(原始字节)/`url`，
 *   `children` 为空数组。
 */
export type MaterialFile = z.infer<typeof MaterialFileSchema>

/**
 * 资源卡片 + （详情时）其组好的文件树。
 * - 列表场景 `files` 为空数组（后端省略树，详情/files 端点懒加载）。
 * - `updateDate` 是卡片「更新于」时间戳；`ownerSid` 用于前端判定是否显示删除/编辑入口。
 */
export type MaterialResource = z.infer<typeof MaterialResourceSchema>

/** 新建资源卡的入参（ResourceFormDialog → createResource）。 */
export type ResourceCreateInput = {
  title: string
  description?: string | undefined
  tag?: ResourceTag | null | undefined
}

/**
 * 编辑资源卡的入参（ResourceFormDialog → updateResource）。
 * 字段全可选；省略某字段 = 不改，显式传 `tag: null` = 清除徽章。
 */
export type ResourceUpdateInput = {
  title?: string | undefined
  description?: string | undefined
  tag?: ResourceTag | null | undefined
}

/** 拖拽 reorder 的请求体（FileTree onDragEnd → reorder）。 */
export type ReorderInput = {
  dragId: string
  dropId: string
  position: ReorderPosition
}

/**
 * getAllFolders 返回的「可选目标文件夹」选项 —— 上传弹窗的目标 Select 数据源。
 * `path` 是拼好的人类可读层级路径（如 `课件 / 第一章`）；根级用 `depth=0`。
 */
export type FolderOption = {
  id: string
  name: string
  /** 拼好的父/子层级路径（含自身名），如 `课件 / 第一章`。 */
  path: string
  /** 树深度（根级文件夹为 0），用于 Select 缩进。 */
  depth: number
}

/**
 * RecentUploads / FileTree 点击文件时回调的载荷 —— 直达共享 viewer 预览。
 * 列表场景与详情场景共用，故抽进契约层。
 */
export type PreviewTarget = {
  fileId: string
  url: string
  name: string
}
