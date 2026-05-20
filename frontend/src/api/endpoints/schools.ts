import type { QueryValue } from '../client'
import { request } from '../client'
import {
  AdvisorDetailSchema,
  PaginatedAdvisorsSchema,
  SchoolsMetaSchema,
  type AdvisorDetail,
  type ListAdvisorsParams,
  type PaginatedAdvisors,
  type SchoolsMeta,
} from '../schemas/school'

const TOKEN_KEY = 'labnotes.auth.token'

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem(TOKEN_KEY)
  return t ? { Authorization: `Bearer ${t}` } : {}
}

function buildListQuery(p: ListAdvisorsParams): Record<string, QueryValue> {
  const q: Record<string, QueryValue> = {}
  if (p.school && p.school.length > 0) q['school'] = p.school
  if (p.dept && p.dept.length > 0) q['dept'] = p.dept
  if (p.title && p.title.length > 0) q['title'] = p.title
  if (p.recruit && p.recruit.length > 0) q['recruit'] = p.recruit
  if (p.rep && p.rep.length > 0) q['rep'] = p.rep
  if (p.q && p.q.trim()) q['q'] = p.q.trim()
  if (p.has_email !== undefined) q['has_email'] = p.has_email
  if (p.has_summary !== undefined) q['has_summary'] = p.has_summary
  if (p.sort_key) q['sort_key'] = p.sort_key
  if (p.sort_dir) q['sort_dir'] = p.sort_dir
  if (p.page) q['page'] = p.page
  if (p.page_size) q['page_size'] = p.page_size
  return q
}

export async function getSchoolsMeta(): Promise<SchoolsMeta> {
  return request({
    method: 'GET',
    path: '/schools/meta',
    schema: SchoolsMetaSchema,
    headers: authHeaders(),
  })
}

export async function listAdvisors(params: ListAdvisorsParams = {}): Promise<PaginatedAdvisors> {
  return request({
    method: 'GET',
    path: '/schools/list',
    schema: PaginatedAdvisorsSchema,
    headers: authHeaders(),
    query: buildListQuery(params),
  })
}

export async function getAdvisor(id: number): Promise<AdvisorDetail> {
  return request({
    method: 'GET',
    path: `/schools/${id}`,
    schema: AdvisorDetailSchema,
    headers: authHeaders(),
  })
}
