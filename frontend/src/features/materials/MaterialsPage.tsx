import * as React from 'react'

import { ErrorState } from '@/components/common/ErrorState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'

import { ERROR_COPY } from './data'
import type { MaterialResource } from './types'
import { useResource, useDeleteResource } from './hooks/useMaterials'
import { MaterialListView } from './components/MaterialListView'
import { MaterialDetailView } from './components/MaterialDetailView'
import { useConfirm } from './components/ConfirmDialog'

/**
 * MaterialsPage —— 「资料」页根（共享课程资料知识库）。
 *
 * 设计（角色清单）：
 * - useState `selectedResourceId` 切「列表 / 详情」两态（轻量、无需路由参与）。
 * - 列表态：MaterialListView 自带 useResources / 搜索 / FAB / 卡片 / 最近上传 / 表单 / 预览，
 *   本层只接 `onOpenResource` 进详情。
 * - 详情态：MaterialDetailView。资源对象优先用 useResource(rid)（含组好的树），
 *   未就绪时用列表点开时缓存的 `MaterialResource` 兜底，避免详情闪空。
 * - 删除整份资料走 useConfirm + useDeleteResource（toast 在 hook 层），删后回列表。
 * - useResource isError → 页面级 ErrorState；isPending 且无兜底 → 骨架，绝不白屏。
 *
 * 列表态外壳沿用 SchoolsPage 范式（`<main>` + font-serif h1「资料」）；详情态由
 * MaterialDetailView 自带工具栏 + split-pane，全屏铺满（不复用列表外壳）。
 */

export function MaterialsPage() {
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  // 列表点开时带入的资源对象，作为详情数据未就绪前的兜底。
  const [opened, setOpened] = React.useState<MaterialResource | null>(null)

  const onOpenResource = React.useCallback((resource: MaterialResource) => {
    setOpened(resource)
    setSelectedId(resource.id)
  }, [])

  const onBack = React.useCallback(() => {
    setSelectedId(null)
    setOpened(null)
  }, [])

  if (selectedId == null) {
    return <MaterialListView onOpenResource={onOpenResource} />
  }

  return (
    <DetailRoute
      rid={selectedId}
      fallbackResource={opened?.id === selectedId ? opened : null}
      onBack={onBack}
    />
  )
}

/** 详情路由：拉 useResource(rid)，错误/加载兜底，删后回列表。 */
function DetailRoute({
  rid,
  fallbackResource,
  onBack,
}: {
  rid: string
  fallbackResource: MaterialResource | null
  onBack: () => void
}) {
  const resourceQuery = useResource(rid)
  const del = useDeleteResource()
  const { confirm, host: confirmHost } = useConfirm()

  // 优先用 fresh 详情数据；未就绪用列表兜底（避免闪空）。
  const resource = resourceQuery.data ?? fallbackResource

  const onDeleteResource = React.useCallback(
    async (target: MaterialResource) => {
      const ok = await confirm({
        title: `删除「${target.title}」？`,
        description: '此操作不可撤销，该资料下的所有文件将一并删除。',
        tone: 'destructive',
        confirmText: '删除',
      })
      if (!ok) return
      del.mutate(target.id, { onSuccess: () => onBack() })
    },
    [confirm, del, onBack],
  )

  if (resourceQuery.isError && !resource) {
    return (
      <main className="w-full px-7 pb-16 pt-7 xl:px-10">
        <ErrorState
          title={ERROR_COPY.detail}
          message={resourceQuery.error?.message ?? ''}
          onRetry={() => void resourceQuery.refetch()}
        />
      </main>
    )
  }

  if (!resource) {
    return (
      <main className="w-full px-7 pb-16 pt-7 xl:px-10">
        <LoadingSkeleton preset="list" count={6} />
      </main>
    )
  }

  return (
    <>
      {confirmHost}
      <MaterialDetailView
        resource={resource}
        onBack={onBack}
        onDeleteResource={(r) => void onDeleteResource(r)}
      />
    </>
  )
}

export default MaterialsPage
