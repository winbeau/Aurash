import { z } from 'zod'
import { request } from '../client'

const TOKEN_KEY = 'labnotes.auth.token'

const UploadedImageSchema = z.object({ url: z.string() })
export type UploadedImage = z.infer<typeof UploadedImageSchema>

const UploadedFileSchema = z.object({
  url: z.string(),
  filename: z.string(),
  size: z.number(),
})
export type UploadedFile = z.infer<typeof UploadedFileSchema>

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem(TOKEN_KEY)
  return t ? { Authorization: `Bearer ${t}` } : {}
}

/** POST /notes/images — multipart upload, returns the URL to embed
 * directly as `![](url)` in the markdown body. */
export async function uploadNoteImage(file: File): Promise<UploadedImage> {
  const form = new FormData()
  form.append('file', file)
  return request({
    method: 'POST',
    path: '/notes/images',
    body: form,
    schema: UploadedImageSchema,
    headers: authHeaders(),
  })
}

/** POST /notes/files — multipart upload of a document attachment
 * (doc/docx/ppt/pptx/xls/xlsx/pdf). Returns the (safe) display filename, the
 * public url, and the byte size, to embed as `[filename](url)` in the markdown
 * body (Markdown.tsx renders such links as a FileCard). */
export async function uploadNoteFile(file: File): Promise<UploadedFile> {
  const form = new FormData()
  form.append('file', file)
  return request({
    method: 'POST',
    path: '/notes/files',
    body: form,
    schema: UploadedFileSchema,
    headers: authHeaders(),
  })
}
