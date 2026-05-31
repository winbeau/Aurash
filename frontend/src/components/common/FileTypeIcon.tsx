import {
  File as FileIcon,
  FileImage,
  FileCode,
  FileArchive,
  Folder,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { kindOf, type FileKind } from '@/lib/fileTypes'

/**
 * FileTypeIcon —— 文件类型图标，单一来源由 `lib/fileTypes.kindOf` 驱动。
 *
 * 设计（无 AI 味四原则，见 plan-file-upload.md「图标规范」）：
 * - word/excel/ppt/pdf 用自写极简彩色 SVG：24×24 折角文档轮廓 + 底部品牌色
 *   类型标签（DOC/XLS/PPT/PDF 白字）。
 * - 单 `currentColor`：文档轮廓 + 底部色条都取 currentColor，颜色由外层
 *   `text-cat-*` token 决定（kindOf 给出对应 class），白字标签是 knockout，
 *   不引入第二种品牌色，无渐变。
 * - 图片/代码/压缩包 与「文件夹 / 未知」走 lucide 线性单色图标（同站笔触）。
 *
 * 用法：
 *   <FileTypeIcon ext=".docx" />                 // 折角 Word 图标，自带 cat-kaggle 蓝
 *   <FileTypeIcon ext="pdf" className="size-6" />
 *   <FileTypeIcon folder />                       // lucide Folder
 *   <FileTypeIcon folder open />                  // lucide FolderOpen
 */

type Props = {
  /** 扩展名（带或不带前导点、大小写不敏感）。`folder` 为 true 时忽略。 */
  ext?: string
  /** 文件夹模式：渲染 lucide Folder / FolderOpen。 */
  folder?: boolean
  /** 文件夹展开态（仅 folder 模式生效）。 */
  open?: boolean
  /**
   * 尺寸（px），同时作用于 lucide size 与 SVG 宽高。默认 24。
   * 也可只用 className（如 `size-6`）控制尺寸，size 控制 lucide stroke。
   */
  size?: number
  className?: string
}

/** 折角文档 + 底部色条标签的内置 kind。 */
const TILE_LABEL: Partial<Record<FileKind, string>> = {
  word: 'DOC',
  excel: 'XLS',
  ppt: 'PPT',
  pdf: 'PDF',
}

/** 走 lucide 的 kind → 图标映射。 */
const LUCIDE_BY_KIND: Partial<Record<FileKind, LucideIcon>> = {
  image: FileImage,
  code: FileCode,
  archive: FileArchive,
  other: FileIcon,
}

export function FileTypeIcon({
  ext = '',
  folder = false,
  open = false,
  size = 24,
  className,
}: Props) {
  if (folder) {
    const Icon = open ? FolderOpen : Folder
    return (
      <Icon
        size={size}
        strokeWidth={1.75}
        aria-hidden
        className={cn('text-cat-course', className)}
      />
    )
  }

  const info = kindOf(ext)
  const label = TILE_LABEL[info.kind]

  // word/excel/ppt/pdf → 自写折角文档 SVG。
  if (label) {
    return (
      <DocGlyph
        label={label}
        size={size}
        className={cn(info.iconColorClass, className)}
      />
    )
  }

  // 图片/代码/压缩包/未知 → lucide 单色。
  const Icon = LUCIDE_BY_KIND[info.kind] ?? FileIcon
  return (
    <Icon
      size={size}
      strokeWidth={1.75}
      aria-hidden
      className={cn(info.iconColorClass, className)}
    />
  )
}

type GlyphProps = {
  label: string
  size: number
  className?: string
}

/**
 * 24×24 折角文档轮廓 + 底部 currentColor 色条 + 白字类型标签。
 * - 文档外形为单色描边（currentColor），与 lucide 1.75 stroke 同笔触。
 * - 折角（右上）用一条斜线 + 三角内填示意。
 * - 底部色条 fill=currentColor、白字 knockout，不引入第二品牌色。
 */
function DocGlyph({ label, size, className }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-hidden
      className={className}
    >
      {/* 文档主体轮廓（左上起，右上折角，到底）。 */}
      <path
        d="M6 2.75h7.5L19 8.25V21a0.5 0.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V3.25A.5.5 0 0 1 6 2.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      {/* 折角：从顶边折点到右侧折点的对角线 + 角内淡填。 */}
      <path
        d="M13.5 2.75V8.25H19"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* 底部色条（currentColor 实心），承载白字类型标签。 */}
      <rect x="5.5" y="13.5" width="13.5" height="6" rx="1" fill="currentColor" />
      <text
        x="12.25"
        y="18"
        textAnchor="middle"
        fontSize="4.4"
        fontWeight="700"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        letterSpacing="0.1"
        fill="#fff"
      >
        {label}
      </text>
    </svg>
  )
}
