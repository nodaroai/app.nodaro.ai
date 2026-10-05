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
 *    with no picture, layouts, regions, a read before a source's origin). One
 *    render renders one EDL, so a list is an issue. `applyEdlRendersValidity`
 *    judges every render a run makes (a list wired into EDL or into Sources fans
 *    the render out), each with its own EDL and Sources (decided 2026-10-05).
 *
 * In STRUCTURE mode a clip list — Edit Plan's clips mode emits a bare `Edl[]`;
 * Camera Switch, run once per clip, holds its batch as one JSON STRING per clip
 * — is checked clip by clip, each item parsed like a top-level string. A blank
 * item is a clip whose run failed: the engines skip it when they fan out, so it
 * is skipped here too.
 *
 * Messages are the validators' own (English, field names quoted); the few
 * added here follow the same form. The badge shows them left-to-right.
 */
import { normalizeEdl, validateEdl, type EdlValidation } from "@nodaro/shared"
import { buildEffectiveEdl, validateEffectiveEdl } from "@nodaro/render-rules"

/** One render of a run that makes several, and what it would refuse. */
export interface EdlRenderVerdict {
  /** The row of the list it reads (a plan's clip, a List's row), from 0. */
  readonly row: number
  /** The render rule's issues for it, in its own words; never empty. */
  readonly issues: readonly string[]
}

export interface EdlValidity extends EdlValidation {
  /** One EDL, a clip list (structure mode), or the several renders a run makes. */
  readonly kind: "edl" | "clips" | "renders"
  /** The value was a string that is not JSON. `issues` is empty: there is nothing to check. */
  readonly unparseable?: true
  /** `kind: "renders"`: how many renders were judged, and each one that fails. */
  readonly renders?: { readonly total: number; readonly failing: readonly EdlRenderVerdict[] }
}

/** The node's own settings an Apply EDL render reads. */
export interface ApplyEdlRenderSettings {
  /** The node's `output`: a video render needs a picture on every segment. */
  readonly output: "video" | "audio"
  /** The node's default crossfade (ms), applied at every boundary without a
   *  transition; it shortens the output the 180-minute cap is measured on. */
  readonly crossfadeMs: number
}

/** What an Apply EDL node renders with, besides the EDL: the node's settings
 *  and its wired `sources`, applied exactly as the server applies them. */
export interface ApplyEdlRenderContext extends ApplyEdlRenderSettings {
  /** The `sources` wires' media URLs, positional onto `EdlSource[i].url`. */
  readonly sources: readonly string[]
}

/** One render a run of an Apply EDL node makes: the EDL it reads and the
 *  Sources media it gets (see `resolveApplyEdlRenders`). */
export interface ApplyEdlRenderInput {
  /** The row of the list that fans the render out; absent for a single render. */
  readonly row?: number
  readonly edl: unknown
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

/** A clip list (structure mode), clip by clip. Messages name each clip by its position in the
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
    // A render renders exactly one EDL per run: a list is not one (a list that
    // fans the render out reaches here item by item, through
    // `applyEdlRendersValidity`), and any other value — an object that is not
    // an EDL (a chapters plan), a number — is an invalid EDL, not "no EDL".
    if (Array.isArray(raw)) return { kind: "edl", ok: false, issues: [EXPECTED_ONE_EDL], warnings: [] }
    return { kind: "edl", ...validateRender(raw, render) }
  }

  if (Array.isArray(raw)) return validateClips(raw, validateOne)
  if (raw && typeof raw === "object" && looksLikeEdl(raw)) return { kind: "edl", ...validateOne(raw) }
  return null
}

/** The render-mode issue for a render whose EDL is text that is not JSON. */
const NOT_JSON = "not valid JSON"

/** The render-mode issue for one of several renders that gets no EDL: the
 *  editor's Run refuses it ("apply-edl requires an EDL") and the server finds
 *  an empty EDL (`segments is empty`). */
export const NO_EDL = "no EDL"

/**
 * The verdict on every render a run of an Apply EDL node makes (decided
 * 2026-10-05): each render judged by the render rule with its own EDL and its
 * own Sources media, and the node's settings.
 *
 *  - One render: `edlValidityOf` in render mode, unchanged (no EDL: `null`,
 *    and the Run says to connect one).
 *  - Several: `kind: "renders"`. A render with no EDL is still a render the
 *    run makes (a list wired into Sources keeps its row), and the run refuses
 *    it, so it fails with `NO_EDL`; `null` only when no render has an EDL. A
 *    failing render is named by its row (`renders.failing`), and the flat
 *    `issues` name each by its render, numbered from 1 as the panel shows it
 *    (`render 3: …`).
 */
export function applyEdlRendersValidity(
  renders: readonly ApplyEdlRenderInput[],
  settings: ApplyEdlRenderSettings,
): EdlValidity | null {
  const judge = (r: ApplyEdlRenderInput) => edlValidityOf(r.edl, { render: { ...settings, sources: r.sources } })
  if (renders.length === 0) return null
  if (renders.length === 1) return judge(renders[0]!)

  const verdicts = renders.map(judge)
  if (verdicts.every((v) => v === null)) return null
  const failing: EdlRenderVerdict[] = []
  verdicts.forEach((v, k) => {
    const issues = !v ? [NO_EDL] : v.unparseable ? [NOT_JSON] : v.issues
    if (issues.length > 0) failing.push({ row: renders[k]!.row ?? k, issues })
  })
  return {
    kind: "renders",
    ok: failing.length === 0,
    issues: failing.flatMap((f) => f.issues.map((m) => `render ${f.row + 1}: ${m}`)),
    warnings: [],
    renders: { total: renders.length, failing },
  }
}
