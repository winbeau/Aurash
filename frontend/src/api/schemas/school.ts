import { z } from 'zod'

/**
 * Schools 域走 snake_case wire（站点其它接口是 camelCase）。理由：
 * - 后端 sqlite 字段全 snake_case，复用 frontend/src/features/schools/types.ts
 *   原型零改动
 * - 后端用 SnakeModel 而非 CamelModel 对齐
 *
 * 字段顺序与 features/schools/types.ts 对齐；这里是 runtime 校验层。
 */

export const ReputationSchema = z.enum(['positive', 'neutral', 'negative', 'unknown'])
export const DegreeSchema = z.enum(['PhD', 'MS', 'Postdoc'])
export const RecruitFilterSchema = z.enum(['yes', 'no', 'unk'])
export const SortKeySchema = z.enum(['default', 'name', 'recruit', 'rep', 'updated'])
export const SortDirSchema = z.enum(['asc', 'desc'])

export const SchoolRefSchema = z.object({
  code: z.string(),
  name_cn: z.string(),
})

export const DeptRefSchema = z.object({
  code: z.string(),
  name_cn: z.string(),
})

export const QuotaSchema = z.object({
  year: z.number().int().nullable(),
  degree: DegreeSchema.nullable(),
  count: z.number().int().nullable(),
  confidence: z.number().nullable(),
  raw_text: z.string(),
  source_url: z.string().nullable(),
})

export const EvaluationSchema = z.object({
  source: z.string(),
  source_url: z.string().nullable(),
  content: z.string(),
  rating: z.number().nullable(),
  posted_at: z.string().nullable(),
})

export const TraceItemSchema = z.object({
  kind: z.string(),
  label: z.string(),
  detail: z.string(),
})

const AdvisorBaseShape = {
  id: z.number().int(),
  school: SchoolRefSchema,
  departments: z.array(DeptRefSchema),
  name_cn: z.string(),
  name_en: z.string().nullable(),
  title: z.string().nullable(),
  homepage: z.string(),
  source_url: z.string(),
  email: z.string().nullable(),
  email_obfuscated: z.boolean(),
  research_interests: z.array(z.string()),
  is_recruiting: z.boolean().nullable(),
  recruiting_confidence: z.number().nullable(),
  reputation_tag: ReputationSchema.nullable(),
  enriched_summary: z.string().nullable(),
  last_enriched_at: z.string().nullable(),
  note_count: z.number().int(),
  is_starred: z.boolean(),
}

export const AdvisorRowSchema = z.object(AdvisorBaseShape)
export type AdvisorRow = z.infer<typeof AdvisorRowSchema>

export const AdvisorDetailSchema = z.object({
  ...AdvisorBaseShape,
  phone: z.string().nullable(),
  photo_url: z.string().nullable(),
  bio_text: z.string().nullable(),
  quotas: z.array(QuotaSchema),
  evaluations: z.array(EvaluationSchema),
  trace: z.array(TraceItemSchema),
})
export type AdvisorDetail = z.infer<typeof AdvisorDetailSchema>

export const PaginatedAdvisorsSchema = z.object({
  items: z.array(AdvisorRowSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
})
export type PaginatedAdvisors = z.infer<typeof PaginatedAdvisorsSchema>

export const SchoolMetaItemSchema = z.object({
  code: z.string(),
  name_cn: z.string(),
  name_en: z.string().nullable(),
  count: z.number().int().nonnegative(),
  departments: z.array(DeptRefSchema),
})

export const ManifestSchema = z.object({
  schema_version: z.number().int().nullable(),
  exported_at: z.string().nullable(),
  claw_version: z.string().nullable(),
  schools_sqlite_sha256: z.string().nullable(),
  schools_sqlite_bytes: z.number().int().nullable(),
  counts: z.record(z.string(), z.number()).nullable(),
})

export const SchoolsMetaSchema = z.object({
  schools: z.array(SchoolMetaItemSchema),
  titles: z.array(z.string()),
  manifest: ManifestSchema.nullable(),
})
export type SchoolsMeta = z.infer<typeof SchoolsMetaSchema>

export const ReloadResultSchema = z.object({
  ok: z.boolean(),
  manifest: ManifestSchema.nullable(),
})

export interface ListAdvisorsParams {
  school?: string[]
  dept?: string[]
  title?: string[]
  recruit?: Array<z.infer<typeof RecruitFilterSchema>>
  rep?: Array<z.infer<typeof ReputationSchema>>
  q?: string
  has_email?: boolean
  has_summary?: boolean
  sort_key?: z.infer<typeof SortKeySchema>
  sort_dir?: z.infer<typeof SortDirSchema>
  page?: number
  page_size?: number
}
