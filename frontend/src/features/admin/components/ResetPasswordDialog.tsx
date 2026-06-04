import * as React from 'react'
import { Check, Copy, KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

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

import { useResetPassword } from '../hooks/useAdmin'
import type { AdminUserRow } from '@/api/schemas/admin'

/**
 * Reset a user's password. Optional custom value (blank ⇒ server default
 * 123456). On success we *show* the password (with copy) rather than toasting
 * it, so the admin can hand it to the user — a toast would vanish too fast.
 */
export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUserRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const reset = useResetPassword()
  const [password, setPassword] = React.useState('')
  const [result, setResult] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setPassword('')
      setResult(null)
      setCopied(false)
    }
  }, [open])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!user || reset.isPending) return
    const pw = password.trim()
    if (pw && pw.length < 6) {
      toast.error('密码至少 6 位')
      return
    }
    reset.mutate(
      { sid: user.sid, ...(pw ? { password: pw } : {}) },
      { onSuccess: (data) => setResult(data.password) },
    )
  }

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result)
      setCopied(true)
      toast.success('已复制到剪贴板')
    } catch {
      toast.error('复制失败，请手动选择')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-text">
            <KeyRound className="size-4 text-cat-kaggle" aria-hidden />
            重置密码
          </DialogTitle>
          <DialogDescription className="text-text-muted">
            {user ? (
              <>
                为 <strong className="text-text">{user.nickname}</strong>（{user.sid}）设置新密码，
                留空则使用默认 <code className="rounded bg-bg-subtle px-1">123456</code>。
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-2 py-2">
            <p className="text-sm text-text-muted">新密码已生效，请转交给该用户：</p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-sm text-text">{result}</code>
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={copy}>
                {copied ? <Check className="size-4 text-cat-tools" /> : <Copy className="size-4" />}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="space-y-1.5 py-2">
              <Label htmlFor="reset-pw">新密码（可选）</Label>
              <Input
                id="reset-pw"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="留空 = 123456"
                autoComplete="new-password"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={reset.isPending}>
                {reset.isPending && <Loader2 className="size-4 animate-spin" />}
                重置密码
              </Button>
            </DialogFooter>
          </form>
        )}

        {result ? (
          <DialogFooter>
            <Button type="button" onClick={() => onOpenChange(false)}>
              完成
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
