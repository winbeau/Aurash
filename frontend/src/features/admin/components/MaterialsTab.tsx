import * as React from 'react'
import { Trash2 } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/common/ErrorState'
import { LoadingSkeleton } from '@/components/common/LoadingSkeleton'
import { cn } from '@/lib/cn'

import { useResources, useDeleteResource } from '@/features/materials/hooks/useMaterials'
import { getTagBadge } from '@/features/materials/data'
import type { MaterialResource } from '@/features/materials/types'
import { useAdminUsers } from '../hooks/useAdmin'
import { formatDate } from '../lib/format'

/**
 * Admin material overview: every resource in the shared knowledge base with
 * owner + type + updated, plus a force-delete (admins bypass ownership via the
 * backend `ensure_owner`). Owner display names come from the cached admin
 * users query. Full file-tree management still lives on /materials itself
 * (which now also honors the admin bypass).
 */
export function MaterialsTab() {
  const { data, isPending, isError, error, refetch } = useResources()
  const usersQuery = useAdminUsers()
  const del = useDeleteResource()
  const [target, setTarget] = React.useState<MaterialResource | null>(null)

  const nameBySid = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const u of usersQuery.data ?? []) m.set(u.sid, u.nickname)
    return m
  }, [usersQuery.data])

  const resources = data ?? []

  if (isPending) return <LoadingSkeleton preset="list" count={8} />
  if (isError) {
    return <ErrorState title="加载资料失败" message={error?.message ?? ''} onRetry={() => void refetch()} />
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        共 <strong className="font-semibold text-text">{resources.length}</strong> 份资料 ·
        管理员可删除任意资料（在「资料」页可进入文件树做完整管理）。
      </p>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-subtle text-left text-xs text-text-muted">
              <th className="px-3 py-2 font-medium">标题</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">类型</th>
              <th className="hidden px-3 py-2 font-medium md:table-cell">属主</th>
              <th className="hidden px-3 py-2 font-medium lg:table-cell">更新于</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {resources.map((r) => {
              const badge = getTagBadge(r.tag)
              return (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-bg-subtle/60">
                  <td className="px-3 py-2">
                    <span className="font-medium text-text">{r.title}</span>
                  </td>
                  <td className="hidden px-3 py-2 sm:table-cell">
                    {badge ? (
                      <span
                        className={cn(
                          'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
                          badge.bgClass,
                          badge.textClass,
                          badge.borderClass,
                        )}
                      >
                        {badge.label}
                      </span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                  <td className="hidden px-3 py-2 text-text-muted md:table-cell">
                    {nameBySid.get(r.ownerSid) ?? r.ownerSid}
                  </td>
                  <td className="hidden px-3 py-2 text-text-faint lg:table-cell">
                    {formatDate(r.updateDate)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-cat-research hover:bg-tag-research hover:text-cat-research"
                      aria-label={`删除 ${r.title}`}
                      onClick={() => setTarget(r)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </td>
                </tr>
              )
            })}
            {resources.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-text-faint">
                  还没有任何资料
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <AlertDialog open={target != null} onOpenChange={(o) => (!o ? setTarget(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif">删除「{target?.title}」？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销，该资料下的所有文件将一并删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-cat-research text-white hover:bg-cat-research/90"
              onClick={() => {
                if (target) del.mutate(target.id)
                setTarget(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
