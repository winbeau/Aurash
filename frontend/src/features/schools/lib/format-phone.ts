/**
 * Normalise the messy phone strings from claw exports into the canonical
 * `+86 182 0152 5925` / `+86 10 6276 5825 转 8003` shape.
 *
 * Inputs we've seen in the wild:
 *   "86-10-62765825"
 *   "86-10-62765825-8003"
 *   "010-62795826"
 *   "+86 18201525925"
 *   "18201525925"
 *   "86-10-********"         ← masked, leave alone
 *   "86-10-6275 7160"        ← partially-spaced, leave alone
 *
 * The function is conservative: if the digits don't fit a known China
 * pattern, the original string is returned untouched.
 */

const MOBILE = /^1\d{10}$/
const BEIJING_SHANGHAI = /^(10|2[0-9])(\d{8})$/ // 010/021 area codes, 8-digit local
const THREE_DIGIT_AREA = /^(\d{3})(\d{7,8})$/ // most other mainland area codes

export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  // Bail on masked numbers — `********` should not be reformatted into a
  // misleading partial.
  if (trimmed.includes('*')) return trimmed

  // Separator: split off an "extension" segment iff the trailing piece
  // looks like 1–6 digits hung off a `-`. (Avoids consuming the local
  // segment of `86-10-62765825`.)
  let main = trimmed
  let ext = ''
  const lastDash = trimmed.lastIndexOf('-')
  if (lastDash > 0) {
    const tail = trimmed.slice(lastDash + 1).trim()
    if (/^\d{1,6}$/.test(tail) && trimmed.slice(0, lastDash).replace(/[^\d]/g, '').length >= 10) {
      main = trimmed.slice(0, lastDash)
      ext = tail
    }
  }

  // Strip the leading + so we can match `86` vs `+86` uniformly.
  const noPlus = main.replace(/^\+/, '')
  // Pull out a leading country code, then keep just digits in the body.
  let country = ''
  let body: string
  if (/^86[-\s]/.test(noPlus) || /^86\d/.test(noPlus)) {
    country = '+86'
    body = noPlus.replace(/^86/, '').replace(/\D/g, '')
  } else {
    body = main.replace(/\D/g, '')
    // Bare "010xxxxxxxx" → infer +86 from the leading 0 + area code.
    if (/^0\d/.test(body)) {
      country = '+86'
      body = body.slice(1)
    }
  }

  const withExt = (s: string) => (ext ? `${s} 转 ${ext}` : s)

  if (MOBILE.test(body)) {
    // Mainland mobiles all start with 1 — safe to default-stamp +86 even
    // when the source didn't carry an explicit country code.
    return withExt(`+86 ${body.slice(0, 3)} ${body.slice(3, 7)} ${body.slice(7)}`)
  }

  const prefix = country ? `${country} ` : ''

  const bj = body.match(BEIJING_SHANGHAI)
  if (bj && bj[1] && bj[2]) {
    const local = bj[2]
    return withExt(`${prefix}${bj[1]} ${local.slice(0, 4)} ${local.slice(4)}`)
  }

  const other = body.match(THREE_DIGIT_AREA)
  if (other && other[1] && other[2]) {
    const local = other[2]
    const localFmt =
      local.length === 8
        ? `${local.slice(0, 4)} ${local.slice(4)}`
        : `${local.slice(0, 3)} ${local.slice(3)}`
    return withExt(`${prefix}${other[1]} ${localFmt}`)
  }

  // Unknown shape — return original (already trimmed but no normalisation).
  return raw
}
