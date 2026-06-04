import * as React from 'react'

import { cn } from '@/lib/cn'

/**
 * Dependency-free inline-SVG charts for the admin dashboard (matches the
 * project's hand-rolled, low-dependency style — no recharts/d3).
 *
 * `color` props take a CSS color string; callers pass token vars via
 * `var(--cat-kaggle)` etc. so dark-mode tokens (if added) are respected.
 */

export type Slice = { label: string; value: number; color: string }

/** Donut chart with a centered total + legend. Renders nothing if all-zero. */
export function Donut({
  slices,
  total,
  centerLabel,
  size = 132,
  thickness = 18,
}: {
  slices: Slice[]
  total: number
  centerLabel?: string
  size?: number
  thickness?: number
}) {
  const r = (size - thickness) / 2
  const c = size / 2
  const circ = 2 * Math.PI * r
  const sum = slices.reduce((a, s) => a + s.value, 0)

  let offset = 0
  const arcs = sum
    ? slices
        .filter((s) => s.value > 0)
        .map((s) => {
          const frac = s.value / sum
          const dash = frac * circ
          const seg = (
            <circle
              key={s.label}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              // start at 12 o'clock, go clockwise
              transform={`rotate(-90 ${c} ${c})`}
            />
          )
          offset += dash
          return seg
        })
    : null

  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} role="img" aria-label="角色分布">
          <circle
            cx={c}
            cy={c}
            r={r}
            fill="none"
            stroke="var(--color-bg-subtle)"
            strokeWidth={thickness}
          />
          {arcs}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-serif text-xl font-semibold tabular-nums text-text">{total}</span>
          {centerLabel ? (
            <span className="text-[11px] text-text-faint">{centerLabel}</span>
          ) : null}
        </div>
      </div>
      <ul className="flex flex-col gap-1.5">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: s.color }}
            />
            <span className="text-text-muted">{s.label}</span>
            <span className="tabular-nums font-medium text-text">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export type Bar = { label: string; value: number; title?: string }

/** Vertical bar chart (e.g. logins per day). Height-normalized to the max. */
export function BarChart({
  bars,
  color = 'var(--cat-kaggle)',
  height = 120,
  className,
}: {
  bars: Bar[]
  color?: string
  height?: number
  className?: string
}) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  const id = React.useId()
  return (
    <div className={cn('flex items-end gap-1', className)} style={{ height }}>
      {bars.map((b, i) => {
        const h = b.value === 0 ? 2 : Math.max(2, Math.round((b.value / max) * (height - 18)))
        return (
          <div
            key={`${id}-${i}`}
            className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
            title={b.title ?? `${b.label}: ${b.value}`}
          >
            <span className="text-[10px] tabular-nums text-text-faint opacity-0 transition group-hover:opacity-100">
              {b.value}
            </span>
            <div
              className="w-full max-w-[22px] rounded-t-sm transition-colors"
              style={{ height: h, backgroundColor: b.value ? color : 'var(--color-border)' }}
            />
            <span className="w-full truncate text-center text-[9px] text-text-faint">
              {b.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Horizontal labeled bars (e.g. top uploaders). */
export function HBars({
  rows,
  color = 'var(--cat-tools)',
}: {
  rows: { label: string; value: number; hint?: string }[]
  color?: string
}) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0) {
    return <p className="py-4 text-center text-sm text-text-faint">暂无数据</p>
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <li key={`${r.label}-${i}`} className="flex items-center gap-3 text-sm">
          <span className="w-24 shrink-0 truncate text-text-muted" title={r.label}>
            {r.label}
          </span>
          <div className="h-3.5 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-subtle">
            <div
              className="h-full rounded-full"
              style={{ width: `${(r.value / max) * 100}%`, backgroundColor: color }}
            />
          </div>
          <span className="w-16 shrink-0 text-right tabular-nums text-text-faint">
            {r.hint ?? r.value}
          </span>
        </li>
      ))}
    </ul>
  )
}
