import type { LucideIcon } from 'lucide-react'

import { cn } from '@/lib/cn'

/** A single headline metric tile. `accent` is a `text-*` token class. */
export function StatCard({
  label,
  value,
  sub,
  Icon,
  accent = 'text-text',
}: {
  label: string
  value: string | number
  sub?: string
  Icon: LucideIcon
  accent?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-bg p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-muted">{label}</span>
        <Icon aria-hidden className={cn('size-4', accent)} />
      </div>
      <span className="font-serif text-2xl font-semibold tabular-nums text-text">{value}</span>
      {sub ? <span className="text-xs text-text-faint">{sub}</span> : null}
    </div>
  )
}
