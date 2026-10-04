/**
 * What the EDL validity badge reports for an EDL value held on the canvas.
 *
 * The value is checked the way every server ingress checks it: a JSON string is
 * parsed, `normalizeEdl` coerces (defaults, clamping), then the shared validator
 * reports what is still wrong. A clip list — Edit Plan's clips mode emits a bare
 * `Edl[]`; Camera Switch, run once per clip, holds its batch as one JSON STRING
 * per clip — is checked clip by clip, each item parsed like a top-level string.
 * A blank item is a clip whose run failed: the engines skip it when they fan
 * out, so it is skipped here too.
 *
 * It answers "is this a well-formed EDL", not "will Apply EDL render it": the
 * render also refuses what it cannot draw (`validateEffectiveEdl`). Surfaces
 * anchored at a render judge with the render's own rule instead (decided
 * 2026-10-04: the badge is split by surface).
 *
 * Messages are the shared validator's own (English, field names quoted); the
 * few added here follow the same form. The badge shows them left-to-right.
 */
import { normalizeEdl, validateEdl, type EdlValidation } from "@nodaro/shared"

export interface EdlValidity extends EdlValidation {
  /** One EDL, or a clip list. */
  readonly kind: "edl" | "clips"
  /** The value was a string that is not JSON. `issues` is empty: there is nothing to check. */
  readonly unparseable?: true
}

const looksLikeEdl = (v: object): boolean => "segments" in v || "sources" in v

const isBlank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && !v.trim())

type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

function parse(value: unknown): Parsed {
  if (typeof value !== "string") return { ok: true, value }
  try {
    return { ok: true, value: JSON.parse(value) }
  } catch {
    return { ok: false }
  }
}

/** One EDL: normalized, then validated. */
function validateOne(value: unknown): EdlValidation {
  return validateEdl(normalizeEdl(value))
}

/** A clip list, clip by clip. Messages name each clip by its position in the
 *  list as held (blank items keep their slot), like `validateEdlClipSet` does. */
function validateClips(items: readonly unknown[]): EdlValidity {
  const issues: string[] = []
  const warnings: string[] = []
  let clips = 0
  items.forEach((item, i) => {
    if (isBlank(item)) return
    clips++
    const parsed = parse(item)
    if (!parsed.ok) {
      issues.push(`clip[${i}]: not valid JSON`)
      return
    }
    const r = validateOne(parsed.value)
    issues.push(...r.issues.map((m) => `clip[${i}]: ${m}`))
    warnings.push(...r.warnings.map((m) => `clip[${i}]: ${m}`))
  })
  if (clips === 0) issues.push("clipset has no clips")
  return { kind: "clips", ok: issues.length === 0, issues, warnings }
}

/** The badge's verdict for `value`, or `null` when there is nothing to judge
 *  (nothing held yet, an empty field, a chapters plan). */
export function edlValidityOf(value: unknown): EdlValidity | null {
  if (isBlank(value)) return null
  const parsed = parse(value)
  if (!parsed.ok) return { kind: "edl", ok: false, issues: [], warnings: [], unparseable: true }
  const raw = parsed.value
  if (Array.isArray(raw)) return validateClips(raw)
  if (raw && typeof raw === "object" && looksLikeEdl(raw)) return { kind: "edl", ...validateOne(raw) }
  return null
}
