import { Crown, Shield, User as UserIcon } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { Role } from '@/api/schemas/admin'
import { ROLE_LABEL } from '../lib/format'

/** Role pill — superadmin (red/crown), admin (blue/shield), user (muted). */
const STYLE: Record<Role, { cls: string; Icon: typeof Crown }> = {
  superadmin: {
    cls: 'bg-tag-research text-cat-research border-cat-research/30',
    Icon: Crown,
  },
  admin: {
    cls: 'bg-tag-kaggle text-cat-kaggle border-cat-kaggle/30',
    Icon: Shield,
  },
  user: {
    cls: 'bg-bg-subtle text-text-muted border-border',
    Icon: UserIcon,
  },
}

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  const { cls, Icon } = STYLE[role] ?? STYLE.user
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold',
        cls,
        className,
      )}
    >
      <Icon aria-hidden className="size-3" />
      {ROLE_LABEL[role] ?? role}
    </span>
  )
}
