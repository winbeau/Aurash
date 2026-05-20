import { describe, it, expect } from 'vitest'
import { formatPhone } from './format-phone'

describe('formatPhone', () => {
  it('formats an 11-digit mainland mobile as 3-4-4 with +86', () => {
    expect(formatPhone('18201525925')).toBe('+86 182 0152 5925')
  })

  it('keeps an already-spaced +86 mobile in canonical form', () => {
    expect(formatPhone('+86 18201525925')).toBe('+86 182 0152 5925')
    expect(formatPhone('+8618201525925')).toBe('+86 182 0152 5925')
  })

  it('reformats 86-10-xxxxxxxx as +86 10 xxxx xxxx', () => {
    expect(formatPhone('86-10-62765825')).toBe('+86 10 6276 5825')
  })

  it('rewrites a bare 010-xxxxxxxx with inferred +86', () => {
    expect(formatPhone('010-62795826')).toBe('+86 10 6279 5826')
  })

  it('treats the trailing -NNNN as an extension (转)', () => {
    expect(formatPhone('86-10-62765828-832')).toBe('+86 10 6276 5828 转 832')
    expect(formatPhone('86-10-62765825-8003')).toBe('+86 10 6276 5825 转 8003')
  })

  it('handles 021-xxxxxxxx (Shanghai) as 2-4-4', () => {
    expect(formatPhone('021-12345678')).toBe('+86 21 1234 5678')
  })

  it('handles a 3-digit area code like 0571-xxxxxxx as 3-3-4', () => {
    expect(formatPhone('0571-1234567')).toBe('+86 571 123 4567')
  })

  it('leaves masked phones (********) alone', () => {
    expect(formatPhone('86-10-********')).toBe('86-10-********')
  })

  it('returns the original string for unrecognised shapes', () => {
    expect(formatPhone('not-a-phone')).toBe('not-a-phone')
  })

  it('returns empty for null/undefined/blank', () => {
    expect(formatPhone(null)).toBe('')
    expect(formatPhone(undefined)).toBe('')
    expect(formatPhone('   ')).toBe('')
  })
})
