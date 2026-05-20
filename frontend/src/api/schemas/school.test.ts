import { describe, it, expect } from 'vitest'
import {
  AdvisorRowSchema,
  AdvisorDetailSchema,
  PaginatedAdvisorsSchema,
  SchoolsMetaSchema,
} from './school'

const VALID_ROW = {
  id: 1,
  school: { code: 'pku', name_cn: '北京大学' },
  departments: [{ code: 'cfcs', name_cn: '前沿计算研究中心' }],
  name_cn: '姜少峰',
  name_en: null,
  title: '助理教授',
  homepage: 'https://cfcs.pku.edu.cn/people/faculty/shaofengjiang/index.htm',
  source_url: 'https://cfcs.pku.edu.cn/people/faculty/shaofengjiang/index.htm',
  email: null,
  email_obfuscated: false,
  research_interests: ['理论计算机科学', '近似算法'],
  is_recruiting: null,
  recruiting_confidence: 0.6,
  reputation_tag: null,
  enriched_summary: null,
  last_enriched_at: null,
  note_count: 0,
  is_starred: false,
}

const VALID_DETAIL = {
  ...VALID_ROW,
  phone: null,
  photo_url: null,
  bio_text: null,
  quotas: [
    {
      year: 2025,
      degree: 'PhD' as const,
      count: 1,
      confidence: 0.9,
      raw_text: '姜少峰，招收 PhD 1 名',
      source_url: 'https://cs.pku.edu.cn/info/1069/1633.htm',
    },
  ],
  evaluations: [
    {
      source: 'web_research',
      source_url: null,
      content: '研究方向：理论计算机科学。',
      rating: null,
      posted_at: null,
    },
  ],
  trace: [],
}

describe('AdvisorRowSchema', () => {
  it('accepts a row with null-able fields set to null', () => {
    expect(() => AdvisorRowSchema.parse(VALID_ROW)).not.toThrow()
  })

  it('accepts non-null is_recruiting / reputation_tag', () => {
    expect(() =>
      AdvisorRowSchema.parse({
        ...VALID_ROW,
        is_recruiting: true,
        reputation_tag: 'positive',
      }),
    ).not.toThrow()
  })

  it('rejects unknown reputation_tag', () => {
    expect(() => AdvisorRowSchema.parse({ ...VALID_ROW, reputation_tag: 'bad-tag' })).toThrow()
  })

  it('rejects research_interests not being an array', () => {
    expect(() => AdvisorRowSchema.parse({ ...VALID_ROW, research_interests: 'foo,bar' })).toThrow()
  })

  it('requires note_count and is_starred', () => {
    const { note_count: _n, is_starred: _s, ...rest } = VALID_ROW
    expect(() => AdvisorRowSchema.parse(rest)).toThrow()
  })
})

describe('AdvisorDetailSchema', () => {
  it('accepts a detail with nested quotas/evaluations/trace', () => {
    expect(() => AdvisorDetailSchema.parse(VALID_DETAIL)).not.toThrow()
  })

  it('accepts empty trace (claw v0.4 leaves it empty)', () => {
    expect(() => AdvisorDetailSchema.parse({ ...VALID_DETAIL, trace: [] })).not.toThrow()
  })

  it('rejects unknown degree', () => {
    expect(() =>
      AdvisorDetailSchema.parse({
        ...VALID_DETAIL,
        quotas: [{ ...VALID_DETAIL.quotas[0], degree: 'MBA' }],
      }),
    ).toThrow()
  })
})

describe('PaginatedAdvisorsSchema', () => {
  it('accepts a page envelope', () => {
    expect(() =>
      PaginatedAdvisorsSchema.parse({
        items: [VALID_ROW],
        total: 1,
        page: 1,
        page_size: 50,
      }),
    ).not.toThrow()
  })

  it('rejects negative total', () => {
    expect(() =>
      PaginatedAdvisorsSchema.parse({
        items: [],
        total: -1,
        page: 1,
        page_size: 50,
      }),
    ).toThrow()
  })
})

describe('SchoolsMetaSchema', () => {
  it('accepts meta with manifest and counts', () => {
    expect(() =>
      SchoolsMetaSchema.parse({
        schools: [
          {
            code: 'pku',
            name_cn: '北京大学',
            name_en: 'Peking University',
            count: 207,
            departments: [{ code: 'ai', name_cn: '智能学院' }],
          },
        ],
        titles: ['教授', '助理教授'],
        manifest: {
          schema_version: 1,
          exported_at: '2026-05-20T11:31:09Z',
          claw_version: '0.4.0',
          schools_sqlite_sha256: 'abc',
          schools_sqlite_bytes: 966656,
          counts: { schools: 2, advisors: 212 },
        },
      }),
    ).not.toThrow()
  })

  it('accepts meta with null manifest (file missing path)', () => {
    expect(() => SchoolsMetaSchema.parse({ schools: [], titles: [], manifest: null })).not.toThrow()
  })
})
