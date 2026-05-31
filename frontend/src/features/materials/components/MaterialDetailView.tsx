import * as React from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { ArrowLeft, FolderPlus, Trash2, UploadCloud } from 'lucide-react'

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
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { useAuthStore } from '@/stores/authStore'
import { cn } from '@/lib/cn'

import { getTagBadge, ERROR_COPY } from '../data'
import { getAllFolders, type FlatNode } from '../lib/tree'
import type { MaterialResource, PreviewTarget, ReorderInput } from '../types'
import {
  useFiles,
  useReorder,
  useRenameFile,
  useDeleteFile,
  useDeleteFolder,
  useCreateFolder,
} from '../hooks/useMaterials'
import { useDownload } from '../hooks/useDownload'
import { FileTree } from './FileTree'
import { UploadDialog } from './UploadDialog'
import { PreviewPane } from './preview/PreviewPane'
import { useConfirm } from './ConfirmDialog'

/**
 * MaterialDetailView —— 资源详情：工具栏（返回 + 标题 + tag + owner 写操作）+
 * react-resizable-panels split-pane（左 1/4 简介 + FileTree，右 3/4 PreviewPane）。
 *
 * 设计（角色清单）：
 * - 工具栏右侧 删除 / 新建文件夹 / 上传 仅 owner（ownerSid === 当前 sid）渲染。
 * - 树数据走 useFiles(rid)（与列表 / 详情解耦，写后只刷树，见 useInvalidateTree）。
 * - 预览选中态在本层维护（selected: PreviewTarget），下传 FileTree 高亮 + PreviewPane 挂载。
 * - 文件树写操作（reorder/rename/delete/upload/建夹）走 hook 层 mutation（toast 在
 *   hook 内，不在渲染期调用，MEMORY 警示）；删除走 useConfirm。
 * - 重命名 / 新建文件夹用本地命令式 PromptDialog（无内联编辑原语，复用同一弹窗）。
 * - useFiles isError → ErrorState；isPending → 骨架，绝不白屏。
 */

type Props = {
  resource: MaterialResource
  onBack: () => void
  /** 删除整份资料（父级用 useConfirm + useDeleteResource 处理，删后回列表）。 */
  onDeleteResource: (resource: MaterialResource) => void
}

export function MaterialDetailView({ resource, onBack, onDeleteResource }: Props) {
  const sid = useAuthStore((s) => s.user?.sid ?? null)
  const isAdmin = useAuthStore((s) => s.user?.isAdmin ?? false)
  // owner 或超级管理员可写（新建文件夹 / 上传 / 重命名 / 删除 / 拖拽 reorder）。
  const canWrite = isAdmin || (sid != null && sid === resource.ownerSid)

  const filesQuery = useFiles(resource.id)
  const files = React.useMemo(() => filesQuery.data ?? [], [filesQuery.data])
  const folders = React.useMemo(() => getAllFolders(files), [files])

  // 当前预览文件。
  const [selected, setSelected] = React.useState<PreviewTarget | null>(null)

  // 选中文件若被删/移走（id 不在树里），清空预览。
  React.useEffect(() => {
    if (!selected) return
    if (!hasFile(files, selected.fileId)) setSelected(null)
  }, [files, selected])

  // 写操作 mutations。
  const reorder = useReorder()
  const rename = useRenameFile()
  const delFile = useDeleteFile()
  const delFolder = useDeleteFolder()
  const createFolder = useCreateFolder()
  const { download } = useDownload()
  const { confirm, host: confirmHost } = useConfirm()

  // 上传弹窗 + 预选目标文件夹。
  const [uploadOpen, setUploadOpen] = React.useState(false)
  const [uploadTarget, setUploadTarget] = React.useState<string | null>(null)

  // 命令式 Prompt（重命名 / 新建文件夹）。
  const { prompt, host: promptHost } = usePrompt()

  const onReorder = React.useCallback(
    (input: ReorderInput) => reorder.mutate({ rid: resource.id, ...input }),
    [reorder, resource.id],
  )

  const onPreview = React.useCallback((node: FlatNode) => {
    if (node.isFolder || !node.url) return
    setSelected({ fileId: node.id, url: node.url, name: node.name })
  }, [])

  const onDownload = React.useCallback(
    (node: FlatNode) => {
      if (node.isFolder) return
      void download(node.id, node.name)
    },
    [download],
  )

  const onRename = React.useCallback(
    async (node: FlatNode) => {
      const name = await prompt({
        title: node.isFolder ? '重命名文件夹' : '重命名文件',
        label: '名称',
        defaultValue: node.name,
        confirmText: '保存',
      })
      if (name == null) return
      const trimmed = name.trim()
      if (!trimmed || trimmed === node.name) return
      rename.mutate({ fileId: node.id, name: trimmed, rid: resource.id })
    },
    [prompt, rename, resource.id],
  )

  const onDeleteNode = React.useCallback(
    async (node: FlatNode) => {
      const ok = await confirm({
        title: node.isFolder ? `删除文件夹「${node.name}」？` : `删除文件「${node.name}」？`,
        description: node.isFolder
          ? '该文件夹及其内部所有文件都将被删除，此操作不可撤销。'
          : '此操作不可撤销。',
        tone: 'destructive',
        confirmText: '删除',
      })
      if (!ok) return
      if (selected?.fileId === node.id) setSelected(null)
      if (node.isFolder) delFolder.mutate({ folderId: node.id, rid: resource.id })
      else delFile.mutate({ fileId: node.id, rid: resource.id })
    },
    [confirm, delFolder, delFile, resource.id, selected],
  )

  const onUpload = React.useCallback((folderId: string) => {
    setUploadTarget(folderId || null)
    setUploadOpen(true)
  }, [])

  const onNewFolder = React.useCallback(async () => {
    const name = await prompt({
      title: '新建文件夹',
      label: '文件夹名称',
      placeholder: '如：第一章',
      confirmText: '创建',
    })
    if (name == null) return
    const trimmed = name.trim()
    if (!trimmed) return
    // 工具栏建夹默认在资源根（树内右键建夹场景由上传/树自理）。
    createFolder.mutate({ rid: resource.id, name: trimmed, parentId: null })
  }, [prompt, createFolder, resource.id])

  const badge = getTagBadge(resource.tag)

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col">
      {confirmHost}
      {promptHost}

      {/* 工具栏 */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-7 py-3 xl:px-10">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={onBack}
          aria-label="返回资料列表"
          title="返回"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1
          className="m-0 min-w-0 truncate font-serif text-lg font-semibold text-text"
          title={resource.title}
        >
          {resource.title}
        </h1>
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

        {canWrite ? (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onNewFolder}>
              <FolderPlus className="h-4 w-4" />
              新建文件夹
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => onUpload('')}>
              <UploadCloud className="h-4 w-4" />
              上传
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-cat-research hover:bg-tag-research hover:text-cat-research"
              onClick={() => onDeleteResource(resource)}
              aria-label="删除这份资料"
              title="删除这份资料"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </header>

      {/* split-pane：左 1/4 简介 + 树，右 3/4 预览 */}
      <PanelGroup
        direction="horizontal"
        autoSaveId="materials-detail"
        className="min-h-0 flex-1"
      >
        <Panel defaultSize={26} minSize={18} maxSize={45}>
          <div className="flex h-full min-h-0 flex-col border-r border-border">
            {resource.description ? (
              <p className="shrink-0 border-b border-border px-4 py-3 text-sm leading-relaxed text-text-muted">
                {resource.description}
              </p>
            ) : null}
            <div className="min-h-0 flex-1">
              <TreeBody
                isPending={filesQuery.isPending}
                isError={filesQuery.isError}
                errorMessage={filesQuery.error?.message}
                onRetry={() => void filesQuery.refetch()}
              >
                <FileTree
                  files={files}
                  activeFileId={selected?.fileId ?? null}
                  canWrite={canWrite}
                  onPreview={onPreview}
                  onReorder={onReorder}
                  onDownload={onDownload}
                  onRename={onRename}
                  onDelete={onDeleteNode}
                  onUpload={onUpload}
                />
              </TreeBody>
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="w-1 bg-border transition hover:bg-border-strong" />

        <Panel defaultSize={74} minSize={40}>
          <PreviewPane file={selected} className="h-full" />
        </Panel>
      </PanelGroup>

      {canWrite ? (
        <UploadDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          resourceId={resource.id}
          folders={folders}
          defaultFolderId={uploadTarget}
        />
      ) : null}
    </div>
  )
}

/** 树区加载/错误兜底包装。 */
function TreeBody({
  isPending,
  isError,
  errorMessage,
  onRetry,
  children,
}: {
  isPending: boolean
  isError: boolean
  errorMessage?: string | undefined
  onRetry: () => void
  children: React.ReactNode
}) {
  if (isPending) {
    return <LoadingSkeleton preset="list" count={6} className="p-3" />
  }
  if (isError) {
    return (
      <ErrorState
        title={ERROR_COPY.files}
        message={errorMessage ?? ''}
        onRetry={onRetry}
        className="py-10"
      />
    )
  }
  return <>{children}</>
}

/** 树里是否存在该文件 id（递归）。 */
function hasFile(
  nodes: { id: string; isFolder: boolean; children?: unknown[] }[],
  id: string,
): boolean {
  for (const n of nodes) {
    if (n.id === id) return true
    const children = (n.children ?? []) as typeof nodes
    if (children.length && hasFile(children, id)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// 命令式输入 Prompt（重命名 / 新建文件夹）—— 返回 Promise<string | null>。
// hook + 私有组件同居（同 useConfirm 模式）；resolve null = 取消。
// ---------------------------------------------------------------------------

type PromptOptions = {
  title: string
  label: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
}

type PromptState = PromptOptions & { open: boolean }

function usePrompt() {
  const [state, setState] = React.useState<PromptState>({ open: false, title: '', label: '' })
  const resolverRef = React.useRef<((v: string | null) => void) | null>(null)

  const prompt = React.useCallback((opts: PromptOptions): Promise<string | null> => {
    setState({ ...opts, open: true })
    return new Promise<string | null>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const settle = React.useCallback((value: string | null) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setState((s) => ({ ...s, open: false }))
  }, [])

  const host = <PromptDialog state={state} onCancel={() => settle(null)} onConfirm={settle} />

  return { prompt, host }
}

function PromptDialog({
  state,
  onCancel,
  onConfirm,
}: {
  state: PromptState
  onCancel: () => void
  onConfirm: (value: string) => void
}) {
  const [value, setValue] = React.useState('')

  React.useEffect(() => {
    if (state.open) setValue(state.defaultValue ?? '')
  }, [state.open, state.defaultValue])

  const trimmed = value.trim()
  const canSubmit = trimmed.length > 0

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    onConfirm(value)
  }

  return (
    <Dialog open={state.open} onOpenChange={(o) => (!o ? onCancel() : undefined)}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="font-serif text-text">{state.title}</DialogTitle>
            <DialogDescription className="sr-only">{state.label}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="material-prompt">{state.label}</Label>
            <Input
              id="material-prompt"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={state.placeholder}
              maxLength={200}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {state.confirmText ?? '确定'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
