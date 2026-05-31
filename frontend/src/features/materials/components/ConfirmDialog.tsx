/* eslint-disable react-refresh/only-export-components --
 * 本文件导出命令式确认 hook `useConfirm`（返回 Promise<boolean> + 渲染 host）
 * 与其内部私有组件 `ConfirmDialog`；hook + 组件同居一文件是该模式的核心，
 * fast-refresh 对此的限制不适用（同 router.tsx 先例）。 */
import * as React from 'react'

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
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/cn'

/**
 * useConfirm() —— 命令式确认对话框，返回 `Promise<boolean>`，替代原生
 * window.confirm（替 KnoHub 手写 ConfirmDialog.vue）。
 *
 * 用法：
 *   const confirm = useConfirm()
 *   const ok = await confirm({
 *     title: '删除资料？',
 *     description: '此操作不可撤销，文件将被一并删除。',
 *     tone: 'destructive',
 *     confirmText: '删除',
 *   })
 *   if (ok) del.mutate(...)
 *
 * 设计：
 * - 把 `<ConfirmDialogHost />` 挂在子树（hook 返回的 host 节点必须渲染一次）。
 * - 三型 tone：`default` / `warn` / `destructive`，仅 destructive 走红色按钮。
 * - a11y 走 Radix AlertDialog（焦点陷阱 + Esc 取消 + Title/Description 关联）。
 *   注意 toast 不在此渲染期触发（消费侧 mutation 自理）。
 */

export type ConfirmTone = 'default' | 'warn' | 'destructive'

export type ConfirmOptions = {
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  tone?: ConfirmTone
}

type Resolver = (value: boolean) => void

type ConfirmState = ConfirmOptions & { open: boolean }

const DEFAULT_STATE: ConfirmState = {
  open: false,
  title: '',
}

export function useConfirm() {
  const [state, setState] = React.useState<ConfirmState>(DEFAULT_STATE)
  const resolverRef = React.useRef<Resolver | null>(null)

  const confirm = React.useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setState({ ...opts, open: true })
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
    })
  }, [])

  const settle = React.useCallback((value: boolean) => {
    resolverRef.current?.(value)
    resolverRef.current = null
    setState((s) => ({ ...s, open: false }))
  }, [])

  const onOpenChange = React.useCallback(
    (open: boolean) => {
      // 关闭（Esc / 点遮罩 / 取消）视为拒绝。
      if (!open) settle(false)
    },
    [settle],
  )

  const tone: ConfirmTone = state.tone ?? 'default'

  const host = (
    <ConfirmDialog
      state={state}
      tone={tone}
      onOpenChange={onOpenChange}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )

  return { confirm, host }
}

function ConfirmDialog({
  state,
  tone,
  onOpenChange,
  onConfirm,
  onCancel,
}: {
  state: ConfirmState
  tone: ConfirmTone
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  const actionClass = cn(
    buttonVariants({ variant: tone === 'destructive' ? 'destructive' : 'default' }),
    tone === 'warn' && 'bg-cat-course text-white hover:bg-cat-course/90',
  )

  return (
    <AlertDialog open={state.open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-serif text-text">{state.title}</AlertDialogTitle>
          {state.description ? (
            <AlertDialogDescription className="text-text-muted">
              {state.description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            {state.cancelText ?? '取消'}
          </AlertDialogCancel>
          <AlertDialogAction className={actionClass} onClick={onConfirm}>
            {state.confirmText ?? '确认'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
