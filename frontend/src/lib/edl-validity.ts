/**
 * What an EDL validity badge reports for an EDL value held on the canvas. Two
 * modes, split by surface (decided 2026-10-04):
 *
 *  - STRUCTURE (the default; the Edit Plan badge, "Well-formed EDL"). The value
 *    is checked the way every server ingress starts: a JSON string is parsed,
 *    `normalizeEdl` coerces (defaults, clamping), then the shared validator
 *    reports what is still wrong. It answers "is this a well-formed EDL", not
 *    "will Apply EDL render it".
 *  - RENDER (`options.render`; the Apply EDL panel badge, "Ready to render").
 *    The value is judged as what an Apply EDL node renders, with Apply EDL's own
 *    render rule from `@nodaro/render-rules` — the code every server ingress
 *    refuses with: the effective EDL (the node's default crossfade and its wired
 *    source overrides applied), then everything that renderer refuses on top of
 *    structure (over 180 minutes of output, an unknown role, a video segment
 *    with no picture, layouts, regions, a read before a source's origin).
 *
 * A clip list — Edit Plan's clips mode emits a bare `Edl[]`; Camera Switch, run
 * once per clip, holds its batch as one JSON STRING per clip — is checked clip
 * by clip, each item parsed like a top-level string. A blank item is a clip
 * whose run failed: the engines skip it when they fan out, so it is skipped
 * here too.
 *
 * Messages are the validators' own (English, field names quoted); the few
 * added here follow the same form. The badge shows them left-to-right.
 */
import { normalizeEdl, validateEdl, type EdlValidation } from "@nodaro/shared"
import { buildEffectiveEdl, validateEffectiveEdl } from "@nodaro/render-rules"

export interface EdlValidity extends EdlValidation {
  /** One EDL, or a clip list. */
  readonly kind: "edl" | "clips"
  /** The value was a string that is not JSON. `issues` is empty: there is nothing to check. */
  readonly unparseable?: true
}

/** What an Apply EDL node renders with, besides the EDL: the node's settings
 *  and its wired `sources`, applied exactly as the server applies them. */
export interface ApplyEdlRenderContext {
  /**
   * The value is a clip list when it is a list: it came over a wire that fans
   * the render out (a plan's clips, a Camera Switch batch, a List's rows,
   * Generate Text's items), one item per run, so each item is one render and
   * every item is checked. Otherwise a list renders whole, as ONE EDL, which
   * it is not (an inline list, or a Text node holding one).
   */
  readonly clipList: boolean
  /** The node's `output`: a video render needs a picture on every segment. */
  readonly output: "video" | "audio"
  /** The node's default crossfade (ms), applied at every boundary without a
   *  transition; it shortens the output the 180-minute cap is measured on. */
  readonly crossfadeMs: number
  /** The `sources` wires' media URLs, positional onto `EdlSource[i].url`. */
  readonly sources: readonly string[]
}

export interface EdlValidityOptions {
  /** Judge the value as what an Apply EDL node renders, with its render rule. */
  readonly render?: ApplyEdlRenderContext
}

/** The render-mode issue for a list that renders as one EDL. */
export const EXPECTED_ONE_EDL = "expected one EDL, got a list"

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

/** One EDL, judged as Apply EDL renders it: the effective EDL every ingress
 *  builds, then the render rule. The rule has no warnings — what it does not
 *  refuse renders. */
function validateRender(value: unknown, render: ApplyEdlRenderContext): EdlValidation {
  const effective = buildEffectiveEdl(value, { crossfadeMs: render.crossfadeMs, sourceOverrides: render.sources })
  const { ok, issues } = validateEffectiveEdl(effective, render.output)
  return { ok, issues, warnings: [] }
}

/** A clip list, clip by clip. Messages name each clip by its position in the
 *  list as held (blank items keep their slot), like `validateEdlClipSet` does. */
function validateClips(items: readonly unknown[], check: (value: unknown) => EdlValidation): EdlValidity {
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
    const r = check(parsed.value)
    issues.push(...r.issues.map((m) => `clip[${i}]: ${m}`))
    warnings.push(...r.warnings.map((m) => `clip[${i}]: ${m}`))
  })
  if (clips === 0) issues.push("clipset has no clips")
  return { kind: "clips", ok: issues.length === 0, issues, warnings }
}

/** The badge's verdict for `value`, or `null` when there is nothing to judge
 *  (nothing held yet, an empty field; for a plan, a chapters plan). */
export function edlValidityOf(value: unknown, options: EdlValidityOptions = {}): EdlValidity | null {
  if (isBlank(value)) return null
  const parsed = parse(value)
  if (!parsed.ok) return { kind: "edl", ok: false, issues: [], warnings: [], unparseable: true }
  const raw = parsed.value
  const { render } = options

  if (render) {
    const check = (v: unknown) => validateRender(v, render)
    if (Array.isArray(raw)) {
      return render.clipList ? validateClips(raw, check) : { kind: "edl", ok: false, issues: [EXPECTED_ONE_EDL], warnings: [] }
    }
    // A render renders exactly one EDL per run: any other value — an object
    // that is not an EDL (a chapters plan), a number — is an invalid EDL, not
    // "no EDL".
    return { kind: "edl", ...check(raw) }
  }

  if (Array.isArray(raw)) return validateClips(raw, validateOne)
  if (raw && typeof raw === "object" && looksLikeEdl(raw)) return { kind: "edl", ...validateOne(raw) }
  return null
}
