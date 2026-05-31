import { describe, it, expect } from 'vitest'
import {
  MaterialFileSchema,
  MaterialResourceSchema,
  MaterialResourceListSchema,
  MaterialFileTreeSchema,
  ResourceCreateInSchema,
  ResourceUpdateInSchema,
  ReorderInSchema,
  NoContentSchema,
} from './material'

const VALID_FILE = {
  id: 'f1',
  name: '第一章.pdf',
  isFolder: false,
  ext: 'pdf',
  mime: 'application/pdf',
  size: '1.2 MB',
  sizeBytes: 1258291,
  url: 'https://example.com/uploads/materials/sid/rid/123-abcd.pdf',
  children: [],
}

// 递归样例：文件夹 → 子文件夹 → 文件，三层嵌套，验 z.lazy 不抛。
const VALID_FOLDER_TREE = {
  id: 'd1',
  name: '课件',
  isFolder: true,
  ext: null,
  mime: null,
  size: null,
  sizeBytes: null,
  url: null,
  children: [
    {
      id: 'd2',
      name: '第一周',
      isFolder: true,
      ext: null,
      mime: null,
      size: null,
      sizeBytes: null,
      url: null,
      children: [VALID_FILE],
    },
    VALID_FILE,
  ],
}

const VALID_RESOURCE = {
  id: 'r1',
  title: '数字逻辑课程资料',
  description: '含 PPT、实验指导、参考资料。',
  tag: '专业课' as const,
  ownerSid: '20231234',
  updateDate: '2026-05-31T08:00:00Z',
  createdAt: '2026-05-01T08:00:00Z',
  files: [VALID_FOLDER_TREE, VALID_FILE],
}

describe('MaterialFileSchema (递归 z.lazy)', () => {
  it('accepts a leaf file node', () => {
    expect(() => MaterialFileSchema.parse(VALID_FILE)).not.toThrow()
  })

  it('accepts a deeply nested folder tree without throwing', () => {
    expect(() => MaterialFileSchema.parse(VALID_FOLDER_TREE)).not.toThrow()
  })

  it('accepts an empty folder with explicit nulls + empty children', () => {
    // 后端 CamelModel 总是序列化全部字段（ext=null、children=[]）。
    const parsed = MaterialFileSchema.parse({
      id: 'd0',
      name: '空夹',
      isFolder: true,
      ext: null,
      mime: null,
      size: null,
      sizeBytes: null,
      url: null,
      children: [],
    }) as { children: unknown[]; ext: string | null }
    expect(parsed.children).toEqual([])
    expect(parsed.ext).toBeNull()
  })

  it('rejects a node missing a required nullable field (ext)', () => {
    const { ext: _omit, ...rest } = VALID_FILE
    expect(() => MaterialFileSchema.parse(rest)).toThrow()
  })

  it('rejects a non-array children', () => {
    expect(() => MaterialFileSchema.parse({ ...VALID_FILE, children: 'nope' })).toThrow()
  })

  it('rejects a missing isFolder flag', () => {
    const { isFolder: _omit, ...rest } = VALID_FILE
    expect(() => MaterialFileSchema.parse(rest)).toThrow()
  })
})

describe('MaterialResourceSchema', () => {
  it('accepts a resource with a nested file tree', () => {
    expect(() => MaterialResourceSchema.parse(VALID_RESOURCE)).not.toThrow()
  })

  it('accepts a null tag + empty files (list view shape)', () => {
    expect(() =>
      MaterialResourceSchema.parse({ ...VALID_RESOURCE, tag: null, files: [] }),
    ).not.toThrow()
  })

  it('rejects an unknown tag', () => {
    expect(() => MaterialResourceSchema.parse({ ...VALID_RESOURCE, tag: 'Trending' })).toThrow()
  })

  it('rejects a resource missing required description / files', () => {
    const { description: _d, files: _f, ...rest } = VALID_RESOURCE
    expect(() => MaterialResourceSchema.parse(rest)).toThrow()
  })
})

describe('MaterialResourceListSchema / MaterialFileTreeSchema', () => {
  it('accepts a list envelope', () => {
    expect(() => MaterialResourceListSchema.parse([VALID_RESOURCE])).not.toThrow()
  })

  it('accepts a flat file tree array', () => {
    expect(() => MaterialFileTreeSchema.parse([VALID_FOLDER_TREE, VALID_FILE])).not.toThrow()
  })
})

describe('write-side schemas', () => {
  it('accepts a minimal create body', () => {
    expect(() => ResourceCreateInSchema.parse({ title: '新资料' })).not.toThrow()
  })

  it('accepts a partial update body with explicit null tag', () => {
    expect(() => ResourceUpdateInSchema.parse({ tag: null })).not.toThrow()
  })

  it('accepts a reorder body', () => {
    expect(() =>
      ReorderInSchema.parse({ dragId: 'a', dropId: 'b', position: 'inside' }),
    ).not.toThrow()
  })

  it('rejects an unknown reorder position', () => {
    expect(() =>
      ReorderInSchema.parse({ dragId: 'a', dropId: 'b', position: 'over' }),
    ).toThrow()
  })
})

describe('NoContentSchema (204 endpoints)', () => {
  it('accepts null (client.ts maps 204 → null)', () => {
    expect(() => NoContentSchema.parse(null)).not.toThrow()
  })

  it('rejects a non-null body', () => {
    expect(() => NoContentSchema.parse({})).toThrow()
  })
})
