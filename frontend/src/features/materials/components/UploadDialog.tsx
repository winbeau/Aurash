import * as React from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  UploadCloud,
  X,
} from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FileTypeIcon } from '@/components/common/FileTypeIcon'
import { extOf, formatBytes, MAX_UPLOAD_BYTES } from '@/lib/fileTypes'
import { cn } from '@/lib/cn'
import type { UploadProgress } from '@/api/upload'

import { useUploadFiles } from '../hooks/useMaterials'
import type { FolderOption } from '../types'

/**
 * UploadDialog —— 多文件上传弹窗（映射 KnoHub UploadModal.vue）。
 *
 * 设计（角色清单 + plan-materials-integration.md「上传」）：
 * - 拖拽 / 点选多文件 → pendingFiles 网格（改 baseName / 移除 / 总大小，扩展名后缀只读）。
 * - 目标文件夹 Select（getAllFolders 拼好的层级 path；根级为「资源根目录」）。
 * - idle / uploading / success / error 四态 + ui/progress。上传走 XHR（api/upload），
 *   出**真实逐字节进度**：uploading 显示百分比；字节发完后 phase='processing'，进度条
 *   转**不确定态**（固定一段 + animate-pulse）+ 文案「服务器接收中…」——此时数据正经
 *   CF 隧道传到源站、服务器接收/落盘，故不满条以免给「已完成」错觉；success 后 100%。
 * - 上传走 hook 层 useUploadFiles（toast 在 hook 内，不在本渲染期调用，MEMORY 警示）。
 * - 单文件超 MAX_UPLOAD_BYTES（50MB）前端先拦（标红 + 禁上传），后端再兜底 413。
 * - 上传成功自动关闭；失败保留弹窗（保留待传清单）+ 错误态供重试。
 */

type Status = 'idle' | 'uploading' | 'success' | 'error'

/** 待传文件项：原 File + 可编辑的 baseName（不含扩展名）。 */
type PendingFile = {
  /** 稳定 key（列表渲染 / 移除）。 */
  uid: string
  file: File
  /** 用户可改的主名（不含扩展名）。 */
  baseName: string
  /** 小写扩展名（含点，只读后缀，如 `.pdf`）；无扩展名为 ''。 */
  ext: string
  /** 超 50MB → 标红、阻止上传。 */
  tooBig: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 目标资源 id。 */
  resourceId: string
  /** 可选目标文件夹（getAllFolders 结果）。 */
  folders: FolderOption[]
  /** 预选目标文件夹 id（右键文件夹「上传到此」时带入）；null/undefined = 资源根。 */
  defaultFolderId?: string | null
  /** 打开时预填的待传文件（左栏拖拽落入时带入）；null/空 = 空清单（点选/工具栏路径）。 */
  initialFiles?: File[] | null
}

/** Select 里「资源根目录」的哨兵值（Radix Select value 不接受空串）。 */
const ROOT_VALUE = '__root__'

let uidSeq = 0
function nextUid(): string {
  uidSeq += 1
  return `pf_${uidSeq}_${Date.now()}`
}

/** 把 File 列表归一成 PendingFile（拆 baseName / ext，标记超限）。 */
function toPending(files: File[]): PendingFile[] {
  return files.map((file) => {
    const ext = extOf(file.name)
    const base = ext ? file.name.slice(0, file.name.length - ext.length) : file.name
    return {
      uid: nextUid(),
      file,
      baseName: base,
      ext,
      tooBig: file.size > MAX_UPLOAD_BYTES,
    }
  })
}

export function UploadDialog({
  open,
  onOpenChange,
  resourceId,
  folders,
  defaultFolderId,
  initialFiles,
}: Props) {
  const upload = useUploadFiles()

  const [pending, setPending] = React.useState<PendingFile[]>([])
  const [target, setTarget] = React.useState<string>(ROOT_VALUE)
  const [status, setStatus] = React.useState<Status>('idle')
  const [errorMsg, setErrorMsg] = React.useState('')
  const [progress, setProgress] = React.useState<UploadProgress | null>(null)
  const [dragActive, setDragActive] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const dragDepth = React.useRef(0)

  // 打开时重置（预选目标文件夹 / 回到 idle）。待传清单：左栏拖拽落入时带入
  // initialFiles 直接预填（「拖完即弹窗」无需再点选）；点选/工具栏路径则清空。
  // initialFiles 仅随「打开」一同变更（拖放/工具栏同帧 set），开着时不会变 → 不会
  // 覆盖用户在弹窗内的改名/增删（弹窗为 modal，开时树/工具栏不可点）。
  React.useEffect(() => {
    if (!open) return
    setPending(initialFiles && initialFiles.length > 0 ? toPending(initialFiles) : [])
    setStatus('idle')
    setErrorMsg('')
    setProgress(null)
    setDragActive(false)
    dragDepth.current = 0
    setTarget(defaultFolderId ?? ROOT_VALUE)
  }, [open, defaultFolderId, initialFiles])

  const addFiles = React.useCallback((files: FileList | File[] | null) => {
    if (!files) return
    const arr = Array.from(files)
    if (arr.length === 0) return
    setPending((prev) => [...prev, ...toPending(arr)])
    setStatus('idle')
    setErrorMsg('')
  }, [])

  const removeOne = (uid: string) =>
    setPending((prev) => prev.filter((p) => p.uid !== uid))

  const renameOne = (uid: string, baseName: string) =>
    setPending((prev) => prev.map((p) => (p.uid === uid ? { ...p, baseName } : p)))

  const totalBytes = React.useMemo(
    () => pending.reduce((sum, p) => sum + p.file.size, 0),
    [pending],
  )
  const hasTooBig = pending.some((p) => p.tooBig)
  const canSubmit = pending.length > 0 && !hasTooBig && status !== 'uploading'

  const onSubmit = () => {
    if (!canSubmit) return
    // 用 baseName + 只读后缀重建 File（保留扩展名与 MIME）。
    const files = pending.map((p) => {
      const finalName = `${p.baseName.trim() || p.file.name.replace(p.ext, '')}${p.ext}`
      if (finalName === p.file.name) return p.file
      return new File([p.file], finalName, {
        type: p.file.type,
        lastModified: p.file.lastModified,
      })
    })
    const folderId = target === ROOT_VALUE ? null : target
    setStatus('uploading')
    setErrorMsg('')
    setProgress({ loaded: 0, total: 0, ratio: 0, phase: 'uploading' })
    upload.mutate(
      {
        rid: resourceId,
        files,
        folderId,
        // 进度回调（onProgress 在回调里 setState，不在渲染期；toast 仍在 hook 层）。
        onProgress: (p) => setProgress(p),
      },
      {
        onSuccess: () => {
          setStatus('success')
          // 短暂展示成功态后关闭（hook 层已弹 toast）。
          window.setTimeout(() => onOpenChange(false), 600)
        },
        onError: (e) => {
          setStatus('error')
          setErrorMsg(e instanceof Error ? e.message : '上传失败')
        },
      },
    )
  }

  // 拖拽区事件（计数避免子元素 dragleave 抖动）。
  const onDragEnter = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    dragDepth.current += 1
    setDragActive(true)
  }
  const onDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault()
  }
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragActive(false)
    addFiles(e.dataTransfer.files)
  }

  const uploading = status === 'uploading'

  return (
    <Dialog open={open} onOpenChange={(o) => (!uploading ? onOpenChange(o) : undefined)}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-text">上传文件</DialogTitle>
          <DialogDescription className="text-text-muted">
            支持拖拽或点选多个文件，单个文件最大 {formatBytes(MAX_UPLOAD_BYTES)}。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2">
          {/* 拖拽 / 点选区 */}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              dragActive
                ? 'border-cat-kaggle bg-tag-kaggle/40'
                : 'border-border-strong bg-bg-subtle hover:bg-bg-hover',
            )}
            aria-label="选择或拖入文件"
          >
            <UploadCloud
              aria-hidden
              size={28}
              strokeWidth={1.5}
              className={dragActive ? 'text-cat-kaggle' : 'text-text-muted'}
            />
            <span className="text-sm font-medium text-text">点击选择文件，或拖拽到此处</span>
            <span className="text-xs text-text-muted">可一次选择多个文件</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files)
              // 清空 value 以便再次选择相同文件触发 change。
              e.target.value = ''
            }}
          />

          {/* 目标文件夹 Select */}
          <div className="space-y-1.5">
            <Label htmlFor="upload-target">目标文件夹</Label>
            <Select value={target} onValueChange={setTarget} disabled={uploading}>
              <SelectTrigger id="upload-target">
                <SelectValue placeholder="资源根目录" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ROOT_VALUE}>资源根目录</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    <span style={{ paddingLeft: f.depth * 12 }}>{f.path}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 待传文件网格 */}
          {pending.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>
                  待上传 <strong className="font-semibold text-text">{pending.length}</strong> 个文件
                </span>
                <span className={cn('tabular-nums', hasTooBig && 'text-cat-research')}>
                  共 {formatBytes(totalBytes)}
                </span>
              </div>
              <ul className="space-y-1.5">
                {pending.map((p) => (
                  <li
                    key={p.uid}
                    className={cn(
                      'flex items-center gap-2 rounded-md border bg-bg-subtle px-2.5 py-1.5',
                      p.tooBig ? 'border-cat-research/40' : 'border-border',
                    )}
                  >
                    <FileTypeIcon ext={p.ext} size={18} className="size-[18px] shrink-0" />
                    <div className="flex min-w-0 flex-1 items-center">
                      <Input
                        value={p.baseName}
                        onChange={(e) => renameOne(p.uid, e.target.value)}
                        disabled={uploading}
                        aria-label={`重命名 ${p.file.name}`}
                        className="h-7 min-w-0 flex-1 rounded-r-none border-r-0 text-xs"
                      />
                      <span className="shrink-0 rounded-r-md border border-l-0 border-input bg-bg px-1.5 py-1 text-xs text-text-faint">
                        {p.ext || '—'}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 text-xs tabular-nums',
                        p.tooBig ? 'font-medium text-cat-research' : 'text-text-faint',
                      )}
                      title={p.tooBig ? `超过 ${formatBytes(MAX_UPLOAD_BYTES)} 上限` : undefined}
                    >
                      {formatBytes(p.file.size)}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => removeOne(p.uid)}
                      disabled={uploading}
                      aria-label={`移除 ${p.file.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
              {hasTooBig ? (
                <p className="flex items-center gap-1.5 text-xs text-cat-research">
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden />
                  存在超过 {formatBytes(MAX_UPLOAD_BYTES)} 的文件，请移除后再上传。
                </p>
              ) : null}
            </div>
          ) : null}

          {/* 四态反馈 */}
          {uploading ? (
            <div className="space-y-1.5" aria-live="polite">
              {/* 真实进度：uploading 且 ratio 已知 → 百分比。
                  processing 阶段（字节已发完、经 CF 隧道传到源站、服务器接收/落盘中）→
                  不确定态：固定一段(66%) + animate-pulse 脉动，既显「仍在进行」又不满条
                  给「已完成」错觉。ratio 仍为 null（lengthComputable=false）→ 同样退回不确定动画条。 */}
              <Progress
                value={
                  progress?.phase === 'processing' || progress?.ratio == null
                    ? 66
                    : Math.round(progress.ratio * 100)
                }
                className={
                  progress?.phase === 'processing' || progress?.ratio == null
                    ? 'animate-pulse'
                    : undefined
                }
              />
              {progress?.phase === 'processing' ? (
                <p className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                  服务器接收中…
                </p>
              ) : (
                <p className="flex items-center justify-between gap-1.5 text-xs text-text-muted">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                    正在上传 {pending.length} 个文件…
                  </span>
                  {progress?.ratio != null ? (
                    <span className="tabular-nums">{Math.round(progress.ratio * 100)}%</span>
                  ) : null}
                </p>
              )}
            </div>
          ) : null}
          {status === 'success' ? (
            <p className="flex items-center gap-1.5 text-xs text-cat-tools" aria-live="polite">
              <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
              上传成功
            </p>
          ) : null}
          {status === 'error' ? (
            <p className="flex items-center gap-1.5 text-xs text-cat-research" role="alert">
              <AlertCircle className="size-3.5 shrink-0" aria-hidden />
              {errorMsg || '上传失败，请重试'}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={uploading}
          >
            取消
          </Button>
          <Button type="button" onClick={onSubmit} disabled={!canSubmit}>
            {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
            {status === 'error' ? '重试上传' : `上传${pending.length > 0 ? ` (${pending.length})` : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
