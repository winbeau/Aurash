/**
 * Dev-mode mock for /schools/* endpoints. Reuses features/schools/data.ts
 * ADVISORS so the page behaves identically with or without VITE_API_BASE.
 *
 * Filter/sort semantics intentionally mirror the backend SQL in
 * app/services/schools_query.py — so swapping to real API is a no-op for
 * the page UI.
 */
import { ApiError, registerMock, type MockReq } from '../client'
import { ADVISORS, SCHOOLS } from '@/features/schools/data'
import { applyFilters } from '@/features/schools/filter'
import { sortAdvisors } from '@/features/schools/sort'
import type {
  Advisor,
  FilterState,
  RecruitFilterValue,
  Reputation,
  SortKey,
  SortState,
} from '@/features/schools/types'

// Strip nested detail bits to produce a row-shaped object.
type AdvisorRowMock = Omit<Advisor, 'quotas' | 'evaluations' | 'trace'> & {
  note_count: number
  is_starred: boolean
}

function toRow(a: Advisor): AdvisorRowMock {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { quotas, evaluations, trace, ...rest } = a
  return { ...rest, note_count: 0, is_starred: false }
}

function parseListQuery(req: MockReq): {
  schools: string[]
  filters: FilterState
  sort: SortState
  page: number
  pageSize: number
} {
  const schools = req.query.getAll('school')
  const dept = req.query.getAll('dept')
  const title = req.query.getAll('title')
  const recruit = req.query.getAll('recruit') as RecruitFilterValue[]
  const rep = req.query.getAll('rep') as Reputation[]
  const q = req.query.get('q') ?? ''
  const hasEmail = req.query.get('has_email') === 'true'
  const hasSummary = req.query.get('has_summary') === 'true'
  const sortKey = (req.query.get('sort_key') ?? 'default') as SortKey
  const sortDir = (req.query.get('sort_dir') ?? 'desc') as 'asc' | 'desc'
  const page = Math.max(1, Number(req.query.get('page') ?? 1) || 1)
  const pageSize = Math.max(1, Math.min(200, Number(req.query.get('page_size') ?? 50) || 50))
  const filters: FilterState = {
    dept,
    title,
    recruit,
    rep,
    q,
    hasEmail,
    hasSummary,
  }
  return { schools, filters, sort: { key: sortKey, dir: sortDir }, page, pageSize }
}

registerMock('GET', '/schools/list', async (req: MockReq) => {
  const { schools, filters, sort, page, pageSize } = parseListQuery(req)
  let pool: Advisor[] = ADVISORS
  if (schools.length > 0) {
    const wanted = new Set(schools)
    pool = pool.filter((a) => wanted.has(a.school.code))
  }
  const { rows: filtered } = applyFilters(pool, filters)
  const sorted = sortAdvisors(filtered, sort)
  const start = (page - 1) * pageSize
  const slice = sorted.slice(start, start + pageSize)
  return {
    items: slice.map(toRow),
    total: sorted.length,
    page,
    page_size: pageSize,
  }
})

registerMock('GET', '/schools/meta', async () => {
  // Group counts by school code.
  const counts = new Map<string, number>()
  ADVISORS.forEach((a) => counts.set(a.school.code, (counts.get(a.school.code) ?? 0) + 1))

  // Departments per school — deduplicate by (school, dept code).
  const deptIndex = new Map<string, Map<string, string>>()
  ADVISORS.forEach((a) => {
    let bucket = deptIndex.get(a.school.code)
    if (!bucket) {
      bucket = new Map<string, string>()
      deptIndex.set(a.school.code, bucket)
    }
    a.departments.forEach((d) => {
      if (!bucket!.has(d.code)) bucket!.set(d.code, d.name_cn)
    })
  })

  const schools = (Object.keys(SCHOOLS) as Array<keyof typeof SCHOOLS>)
    .map((code) => {
      const meta = SCHOOLS[code]
      const dmap = deptIndex.get(code) ?? new Map()
      const departments = Array.from(dmap.entries()).map(([c, name]) => ({
        code: c,
        name_cn: name,
      }))
      return {
        code: meta.code,
        name_cn: meta.name_cn,
        name_en: null,
        count: counts.get(code) ?? 0,
        departments,
      }
    })
    .filter((s) => s.count > 0 || true) // keep all 7 schools so chip layout is stable

  // Distinct titles sorted by frequency (mirrors backend).
  const titleCount = new Map<string, number>()
  ADVISORS.forEach((a) => {
    if (a.title) titleCount.set(a.title, (titleCount.get(a.title) ?? 0) + 1)
  })
  const titles = [...titleCount.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([t]) => t)

  return {
    schools,
    titles,
    manifest: {
      schema_version: 1,
      exported_at: new Date().toISOString(),
      claw_version: 'mock',
      schools_sqlite_sha256: null,
      schools_sqlite_bytes: null,
      counts: {
        schools: schools.length,
        advisors: ADVISORS.length,
      },
    },
  }
})

registerMock('GET', '/schools/:id', async (req: MockReq) => {
  const m = req.path.match(/^\/schools\/(\d+)$/)
  if (!m) throw new ApiError('bad path', 400, req.path)
  const id = Number(m[1])
  const found = ADVISORS.find((a) => a.id === id)
  if (!found) throw new ApiError('advisor not found', 404, req.path)
  return {
    ...found,
    note_count: 0,
    is_starred: false,
    trace: found.trace ?? [],
  }
})
