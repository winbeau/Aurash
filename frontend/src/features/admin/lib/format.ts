import type { Role } from '@/api/schemas/admin'

/** YYYY-MM-DD (local). Empty/invalid → '—'. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Coarse Chinese relative time ("刚刚 / 3小时前 / 2天前"), falling back to date. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '从未'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diffMs = Date.now() - d.getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} 天前`
  return formatDate(iso)
}

export const ROLE_LABEL: Record<Role, string> = {
  superadmin: '超级管理员',
  admin: '管理员',
  user: '普通用户',
}
