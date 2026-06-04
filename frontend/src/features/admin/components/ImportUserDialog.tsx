import * as React from 'react'
import { Loader2, UserPlus } from 'lucide-react'

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

import { useCreateUser } from '../hooks/useAdmin'

/**
 * Import a single user (sid + name, optional preferred-name + password).
 * Server applies the default password 123456 when blank. Closes on success;
 * the hook toasts (incl. 409「已存在」on error, dialog stays open to retry).
 */
export function ImportUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateUser()
  const [sid, setSid] = React.useState('')
  const [name, setName] = React.useState('')
  const [preferredName, setPreferredName] = React.useState('')
  const [password, setPassword] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setSid('')
      setName('')
      setPreferredName('')
      setPassword('')
    }
  }, [open])

  const sidValid = /^\d{11}$/.test(sid)
  const pwValid = password === '' || password.length >= 6
  const canSubmit = sidValid && name.trim().length > 0 && pwValid && !create.isPending

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    create.mutate(
      {
        sid,
        name: name.trim(),
        ...(preferredName.trim() ? { preferredName: preferredName.trim() } : {}),
        ...(password ? { password } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-serif text-text">
              <UserPlus className="size-4 text-cat-tools" aria-hidden />
              导入用户
            </DialogTitle>
            <DialogDescription className="text-text-muted">
              新建一个账号；密码留空则为默认 <code className="rounded bg-bg-subtle px-1">123456</code>。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="imp-sid">学号</Label>
              <Input
                id="imp-sid"
                value={sid}
                onChange={(e) => setSid(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder="11 位学号"
                inputMode="numeric"
                autoFocus
              />
              {sid && !sidValid ? (
                <p className="text-xs text-cat-research">学号需 11 位纯数字</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imp-name">姓名</Label>
              <Input
                id="imp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="真实姓名"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imp-pref">称呼（可选）</Label>
              <Input
                id="imp-pref"
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
                placeholder="留空按姓名自动派生"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="imp-pw">初始密码（可选）</Label>
              <Input
                id="imp-pw"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="留空 = 123456"
                autoComplete="new-password"
              />
              {password && !pwValid ? (
                <p className="text-xs text-cat-research">密码至少 6 位</p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              导入
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
