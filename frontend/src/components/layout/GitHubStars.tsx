import { useEffect, useState } from 'react'
import { Github, Star, Eye } from 'lucide-react'

const REPO = 'XjuSelab/xju-feiyue'
const API = `https://api.github.com/repos/${REPO}`
const CACHE_KEY = 'feiyue.ghstats'
const TTL = 60 * 60 * 1000 // 1h —— GitHub 匿名 API 限 60 次/小时，缓存避免每次访问都打

type Stats = { stars: number; watchers: number }

function fmt(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/**
 * 顶栏右上角的 GitHub 仓库链接，显示 star 与 watch 数（实时取自 GitHub API，localStorage 缓存 1h）。
 * 风格与 GitHub Pages 发展历程页的 GitHub 角标一致（octicon + 描边图标 pill）。
 */
export function GitHubStars() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY)
      if (raw) {
        const c = JSON.parse(raw) as { ts: number; stats: Stats }
        if (Date.now() - c.ts < TTL) {
          setStats(c.stats)
          return
        }
      }
    } catch {
      /* ignore corrupt cache */
    }
    let alive = true
    fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('gh'))))
      .then((d: { stargazers_count?: number; subscribers_count?: number }) => {
        if (!alive) return
        const s: Stats = {
          stars: d.stargazers_count ?? 0,
          watchers: d.subscribers_count ?? 0,
        }
        setStats(s)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), stats: s }))
        } catch {
          /* ignore quota */
        }
      })
      .catch(() => {
        /* 离线 / 限流：保持只显示链接 */
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <a
      href={`https://github.com/${REPO}`}
      target="_blank"
      rel="noreferrer"
      aria-label="GitHub 仓库 XjuSelab/xju-feiyue"
      title="在 GitHub 上查看 / Star / Watch"
      className="hidden h-8 items-center gap-2 rounded-md border border-border bg-bg px-2.5 text-xs font-medium text-text-muted transition hover:bg-bg-subtle hover:text-text md:inline-flex"
    >
      <Github size={15} strokeWidth={1.75} aria-hidden />
      <span className="inline-flex items-center gap-1">
        <Star size={13} strokeWidth={1.75} aria-hidden />
        {stats ? fmt(stats.stars) : '–'}
      </span>
      <span className="inline-flex items-center gap-1">
        <Eye size={13} strokeWidth={1.75} aria-hidden />
        {stats ? fmt(stats.watchers) : '–'}
      </span>
    </a>
  )
}
