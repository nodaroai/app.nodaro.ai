/**
 * A person's review of an Edit Plan, and the ONE rule that makes it win.
 *
 * The planner's output stays on `data.generatedJson`, untouched. A review edit
 * lives beside it on `data.editedEdl` (TA13, decided 2026-10-04), tagged by
 * `kind` and fingerprinted with `basis` — the hash of the plan it was made
 * against. An edit whose basis no longer matches (the plan was re-run) is
 * ignored by construction, so no writer has to remember to clear it for the
 * read to be right. The edit is run-result data (TA14, decided 2026-10-04):
 * `editedEdl` is in `EXECUTION_DATA_KEYS`, so it stays out of undo, presets,
 * templates and exports, and Clear results wipes it.
 *
 *   - Tighten: `{v:1, kind:"edl", basis, edl:{segments, dropped}}`. The resolved
 *     plan is the planner's EDL with the edit's segments and dropped spans;
 *     sources, clock and meta always come from the plan (an edit never stores
 *     sources).
 *   - Clips: `{v:1, kind:"clips", basis, clips:[{keep, hook?}]}`, index-aligned
 *     with the plan's clips, holding decisions only. The list a fan-out reads
 *     stays on the PLAN's indices, with `""` at every dropped clip (TA16,
 *     decided 2026-10-04), so an edge selector picks the same clips it picked
 *     for the preview. `json` holds the kept clips only, so a scalar read (the
 *     first item) is the first kept clip. An edited hook travels as `meta.hook`
 *     (TA20, decided 2026-10-04: text only).
 *   - Chapters have no review: an edit never applies.
 *
 * Every read of an Edit Plan's saved output calls `editPlanSavedOutput`, on
 * both engines; `extractGeneratedJsonAsList` stays generic.
 */
import { validateEdl, type Edl, type EdlDropped, type EdlSegment, type EdlValidation } from "./edl.js"

export const EDITED_EDL_VERSION = 1 as const

/** A Tighten plan's review: the kept segments and the dropped spans. */
export interface EditedEdlCut {
  readonly v: typeof EDITED_EDL_VERSION
  readonly kind: "edl"
  /** `editPlanBasis` of the `generatedJson` this edit was made against. */
  readonly basis: string
  readonly edl: {
    readonly segments: readonly EdlSegment[]
    readonly dropped: readonly EdlDropped[]
  }
}

/** One clip's review decision, at the clip's index in the plan. */
export interface EditedClipDecision {
  readonly keep: boolean
  /** The clip's hook as the person rewrote it (text only); absent = the plan's. */
  readonly hook?: string
}

/** A clip set's review: one decision per planned clip, index-aligned. */
export interface EditedClipSet {
  readonly v: typeof EDITED_EDL_VERSION
  readonly kind: "clips"
  /** `editPlanBasis` of the `generatedJson` this edit was made against. */
  readonly basis: string
  readonly clips: readonly EditedClipDecision[]
}

/** What `data.editedEdl` on an Edit Plan holds. */
export type EditedEdl = EditedEdlCut | EditedClipSet

/**
 * How the review edit stood when the plan was resolved:
 *   - `none`: there is no edit;
 *   - `applied`: the edit was made on this plan and wins;
 *   - `stale`: it was made on another plan (a re-run, including one that
 *     changed the clip count or the plan's mode) and is ignored;
 *   - `invalid`: it is malformed, or, made on this plan, it does not fit its
 *     kind or shape; it is ignored.
 */
export type EditPlanEditStatus = "none" | "applied" | "stale" | "invalid"

/** An Edit Plan's output as every reader receives it. */
export interface EditPlanSavedOutput {
  /** Tighten: the EDL. Clips: the kept clips. Chapters: the chapter set. */
  readonly json: unknown
  /** Clips only: one JSON string per PLANNED clip, `""` where a clip is dropped. */
  readonly listResults?: string[]
}

export interface ResolvedEditPlanOutput extends EditPlanSavedOutput {
  readonly status: EditPlanEditStatus
}

// ─────────────────────────────────────────────────────────────────────────
//  basis: FNV-1a-64 over the key-sorted JSON
// ─────────────────────────────────────────────────────────────────────────

/** JSON text with every object's keys sorted, at every depth. `workflows.nodes`
 *  is JSONB, which does not keep key order, so the stored plan can come back
 *  with its keys in another order; its canonical text does not. Values follow
 *  `JSON.stringify`: an undefined or function value drops its key (and is
 *  `null` inside an array), and a non-finite number is `null`. */
function canonicalJson(value: unknown): string | undefined {
  if (value === null) return "null"
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value)
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null"
    case "object": {
      const toJSON = (value as { toJSON?: unknown }).toJSON
      if (typeof toJSON === "function") return canonicalJson((value as { toJSON: () => unknown }).toJSON())
      if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item) ?? "null").join(",")}]`
      const parts: string[] = []
      for (const key of Object.keys(value).sort()) {
        const text = canonicalJson((value as Record<string, unknown>)[key])
        if (text !== undefined) parts.push(`${JSON.stringify(key)}:${text}`)
      }
      return `{${parts.join(",")}}`
    }
    default:
      return undefined
  }
}

/** FNV-1a-64 over the UTF-8 bytes of `text`, as 16 lowercase hex digits. The
 *  64-bit state is two 32-bit halves: the prime is 2^40 + 435, so
 *  `h × prime = h × 435 + (h << 40)` (mod 2^64), and every partial product
 *  stays an exact double. */
function fnv1a64(text: string): string {
  let hi = 0xcbf29ce4
  let lo = 0x84222325
  const mix = (byte: number): void => {
    lo = (lo ^ byte) >>> 0
    const loProduct = lo * 435
    const carry = Math.floor(loProduct / 0x1_0000_0000)
    hi = (hi * 435 + carry + ((lo << 8) >>> 0)) >>> 0
    lo = loProduct >>> 0
  }
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i)
    // A surrogate pair is one code point; a lone surrogate encodes as U+FFFD,
    // as TextEncoder does.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00)
        i++
      } else code = 0xfffd
    } else if (code >= 0xdc00 && code <= 0xdfff) code = 0xfffd
    if (code < 0x80) mix(code)
    else if (code < 0x800) {
      mix(0xc0 | (code >> 6))
      mix(0x80 | (code & 0x3f))
    } else if (code < 0x10000) {
      mix(0xe0 | (code >> 12))
      mix(0x80 | ((code >> 6) & 0x3f))
      mix(0x80 | (code & 0x3f))
    } else {
      mix(0xf0 | (code >> 18))
      mix(0x80 | ((code >> 12) & 0x3f))
      mix(0x80 | ((code >> 6) & 0x3f))
      mix(0x80 | (code & 0x3f))
    }
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0")
}

/**
 * The basis of every plan object already hashed. Hashing walks the whole plan
 * (about 20 ms on a large one), and both engines read the same saved plan
 * object many times: each review edit is a new `editedEdl` object over an
 * unchanged plan, and a run reads a seeded plan at every wire. Keyed by the
 * plan OBJECT, so it relies on a plan never being mutated in place: the editor
 * never mutates node data (a new plan is a new object), and the server reads
 * `generatedJson` as stored. A copy of a plan is another object and is hashed
 * on its own.
 */
const basisByPlan = new WeakMap<object, string>()

/**
 * The fingerprint of an Edit Plan's stored output (`data.generatedJson`, as
 * unwrapped): FNV-1a-64 of the UTF-8 bytes of its key-sorted JSON, as 16
 * lowercase hex digits. Equal for any key order, so a JSONB round trip keeps
 * it; any change to a value, or to array order, changes it.
 */
export function editPlanBasis(plan: unknown): string {
  if (typeof plan !== "object" || plan === null) return fnv1a64(canonicalJson(plan) ?? "")
  const cached = basisByPlan.get(plan)
  if (cached !== undefined) return cached
  const basis = fnv1a64(canonicalJson(plan) ?? "")
  basisByPlan.set(plan, basis)
  return basis
}

// ─────────────────────────────────────────────────────────────────────────
//  The envelope
// ─────────────────────────────────────────────────────────────────────────

type PlanShape = "edl" | "clips" | "other"

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

function planShape(plan: unknown): PlanShape {
  if (Array.isArray(plan)) return "clips"
  if (isRecord(plan) && Array.isArray(plan.segments)) return "edl"
  return "other"
}

type EnvelopeCheck =
  | { readonly status: "none" }
  | { readonly status: "applied"; readonly edited: EditedEdl }
  | { readonly status: "stale" | "invalid"; readonly issue: string }

/** Is `edited` an edit of THIS plan? The envelope (version, basis, kind),
 *  then the basis, then the plan's shape and the alignment. The basis comes
 *  before the shape and the clip count because a re-run that changes the clip
 *  count or the plan's mode is a re-plan (`stale`), not a malformed edit; once
 *  the basis matches, a shape or count mismatch really is `invalid`. Never
 *  looks inside the cut's segments (that is `validateEdl`'s). */
function checkEnvelope(edited: unknown, plan: unknown): EnvelopeCheck {
  if (edited === undefined || edited === null) return { status: "none" }
  if (!isRecord(edited)) return { status: "invalid", issue: "editedEdl must be an object" }
  if (edited.v !== EDITED_EDL_VERSION) return { status: "invalid", issue: `editedEdl.v must be ${EDITED_EDL_VERSION}` }
  if (typeof edited.basis !== "string" || edited.basis.length === 0) {
    return { status: "invalid", issue: "editedEdl.basis must be a non-empty string" }
  }
  if (edited.kind !== "edl" && edited.kind !== "clips") {
    return { status: "invalid", issue: `editedEdl.kind must be "edl" or "clips"` }
  }
  if (edited.basis !== editPlanBasis(plan)) {
    return { status: "stale", issue: "editedEdl.basis does not match the plan: the plan changed since this edit was made" }
  }
  const shape = planShape(plan)
  if (edited.kind === "edl") {
    if (shape !== "edl") return { status: "invalid", issue: `an "edl" edit needs a Tighten plan (one EDL); this plan is ${describeShape(shape)}` }
    const edl = edited.edl
    if (!isRecord(edl) || !Array.isArray(edl.segments) || !Array.isArray(edl.dropped)) {
      return { status: "invalid", issue: "editedEdl.edl must hold a segments array and a dropped array" }
    }
  } else if (edited.kind === "clips") {
    if (shape !== "clips") return { status: "invalid", issue: `a "clips" edit needs a clip set; this plan is ${describeShape(shape)}` }
    const clips = edited.clips
    if (!Array.isArray(clips)) return { status: "invalid", issue: "editedEdl.clips must be an array" }
    const planned = (plan as readonly unknown[]).length
    if (clips.length !== planned) {
      return { status: "invalid", issue: `editedEdl.clips holds ${clips.length} decisions; the plan has ${planned} clips` }
    }
    const bad = clips.findIndex(
      (c) => !isRecord(c) || typeof c.keep !== "boolean" || (c.hook !== undefined && typeof c.hook !== "string"),
    )
    if (bad >= 0) return { status: "invalid", issue: `editedEdl.clips[${bad}] must be {keep: boolean, hook?: string}` }
  }
  return { status: "applied", edited: edited as unknown as EditedEdl }
}

function describeShape(shape: PlanShape): string {
  return shape === "edl" ? "a Tighten plan" : shape === "clips" ? "a clip set" : "neither (a chapter list, or no plan)"
}

// ─────────────────────────────────────────────────────────────────────────
//  The resolver
// ─────────────────────────────────────────────────────────────────────────

/** The plan's clip set as one JSON string per clip — today's list output. */
function plannedList(plan: readonly unknown[]): string[] {
  return plan.map((clip) => (typeof clip === "string" ? clip : JSON.stringify(clip)))
}

function asOutput(plan: unknown): EditPlanSavedOutput {
  return Array.isArray(plan) ? { json: plan, listResults: plannedList(plan) } : { json: plan }
}

/** A clip with the person's hook, never mutating the plan's clip. */
function withHook(clip: unknown, hook: string | undefined): unknown {
  if (hook === undefined) return clip
  let value = clip
  if (typeof clip === "string") {
    try {
      value = JSON.parse(clip)
    } catch {
      return clip
    }
  }
  if (!isRecord(value)) return clip
  const meta = isRecord(value.meta) ? value.meta : {}
  return { ...value, meta: { ...meta, hook } }
}

/**
 * An Edit Plan's output with the person's review applied: what every edit-plan
 * read hands downstream, on both engines.
 *
 * The edit applies when its shape matches the plan's kind and its `basis` is
 * this plan's. It applies even when the cut it holds is not a well-formed EDL:
 * the render then refuses it with its own issues, where falling back to the
 * planner's cut would silently render what the person removed. A stale or
 * invalid edit is ignored, and the plan is read as planned.
 */
export function resolveEditPlanOutput(plan: unknown, editedEdl: unknown): ResolvedEditPlanOutput {
  const check = checkEnvelope(editedEdl, plan)
  if (check.status !== "applied") return { status: check.status, ...asOutput(plan) }
  const edited = check.edited
  if (edited.kind === "edl") {
    const json = { ...(plan as Record<string, unknown>), segments: edited.edl.segments, dropped: edited.edl.dropped }
    return { status: "applied", json }
  }
  const rows = (plan as readonly unknown[]).map((clip, i) => {
    const decision = edited.clips[i]!
    return decision.keep ? withHook(clip, decision.hook) : undefined
  })
  return {
    status: "applied",
    json: rows.filter((clip) => clip !== undefined),
    listResults: rows.map((clip) => (clip === undefined ? "" : typeof clip === "string" ? clip : JSON.stringify(clip))),
  }
}

/**
 * An Edit Plan node's SAVED output — the one read every edit-plan reader makes
 * of `data` (a node outside the run, the editor's own read of the canvas).
 * `undefined` when the node holds no plan. With no edit it is exactly the plan:
 * `{json}`, plus `listResults` (one JSON string per clip) for a clip set.
 */
export function editPlanSavedOutput(data: Readonly<Record<string, unknown>>): EditPlanSavedOutput | undefined {
  const plan = data.generatedJson
  if (plan === undefined) return undefined
  const { status: _status, ...output } = resolveEditPlanOutput(plan, data.editedEdl)
  return output
}

/**
 * What a result writer writes when a plan lands on an Edit Plan node: the plan
 * itself, and `editedEdl: undefined` ONLY when the plan is not the one the
 * person's review was made on (its `editPlanBasis` differs from
 * `editedEdl.basis`; an edit that names no plan counts as different). The same
 * plan landing again, for example a reopen while the run is still live after
 * the plan finished, keeps the review (decided 2026-10-05). On a keep the patch
 * does not name `editedEdl` at all, so a merging write leaves the review as it
 * is. Pass the review the node holds now.
 *
 * The one place a review is cleared: `frontend/src/lib/__tests__/
 * edit-plan-saved-output-sites.test.ts` fails on a clearing write anywhere else.
 */
export function editPlanResultPatch(
  plan: unknown,
  editedEdl: unknown,
): { readonly generatedJson: unknown; readonly editedEdl?: undefined } {
  const basis = isRecord(editedEdl) ? editedEdl.basis : undefined
  const madeOnThisPlan = typeof basis === "string" && basis.length > 0 && basis === editPlanBasis(plan)
  return madeOnThisPlan ? { generatedJson: plan } : { generatedJson: plan, editedEdl: undefined }
}

/**
 * Check a review edit before it is saved. The envelope (version, kind), the
 * basis, then the plan's shape and one decision per clip, and, for a Tighten edit,
 * the structural `validateEdl` of the edited cut — the Edit Plan's own
 * "well-formed" rule (TA1 a, decided 2026-10-04); what a given render can draw
 * is the render's rule, not this one. Issues are English, like `validateEdl`'s.
 */
export function validateEditedEdl(editedEdl: unknown, plan: unknown): EdlValidation {
  const check = checkEnvelope(editedEdl, plan)
  if (check.status === "none") return { ok: false, issues: ["there is no edit"], warnings: [] }
  if (check.status !== "applied") return { ok: false, issues: [check.issue], warnings: [] }
  if (check.edited.kind === "clips") return { ok: true, issues: [], warnings: [] }
  const resolved = resolveEditPlanOutput(plan, editedEdl).json as Edl
  return validateEdl(resolved)
}
