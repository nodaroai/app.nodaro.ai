/**
 * The trend editor's form model (pure): the server draft ↔ the form the
 * screen edits, the limits the server enforces (so Save is off before a 400),
 * the image count against the 30 cap, and publish blockers as sentences.
 *
 * The server's schemas are strict (backend/src/ee/lib/trends/schemas.ts): a
 * save must carry no client-only field, a slot only its own kind's chips (a
 * location none), and no optional text whose English is empty.
 */
import { LANGUAGES } from "@nodaro/shared/i18n"
import {
  CAST_SWAP_FACE_MASKING_BOUNDS,
  CAST_SWAP_FACE_MASKING_DEFAULTS,
  CAST_SWAP_POST_PROMPT_MAX,
  getMaxVideoPromptChars,
  TREND_PROMPT_LIMITS,
} from "@nodaro/shared/models"
import type {
  AdminTrendData,
  AdminTrendFaceMasking,
  AdminTrendFaceMaskingZone,
  AdminTrendReference,
  AdminTrendSlot,
  TrendChipKey,
  TrendChoice,
  TrendLocalizedText,
  TrendPublishBlocker,
  TrendSlotKind,
} from "@/lib/api"

export const MAX_TREND_IMAGES = 30
export const MAX_IMAGES_PER_SLOT = 3
export const MAX_REFERENCES = 5
export const PREVIEW_SECONDS = 4
export const MAX_TREND_PROMPT = TREND_PROMPT_LIMITS.trendPromptMax
export const MAX_PRE_PROMPT = TREND_PROMPT_LIMITS.prePromptMax

/**
 * The room a trend's prompts leave for the user's details, as the server's
 * publish check counts it (backend/src/ee/lib/trends/prompt-budget.ts), from
 * the same numbers in `@nodaro/shared`: the trend prompt shares the engine's
 * post prompt field (`CAST_SWAP_POST_PROMPT_MAX`) with the details (after a
 * blank line), and the pre and trend prompts share Seedance 2.5's
 * whole-prompt cap with the engine's own text and the details.
 */
export const TREND_DETAILS_MAX = TREND_PROMPT_LIMITS.detailsMax
const SEP = 2

export interface PromptBudget {
  /** The longest trend prompt that leaves the details their room. */
  readonly trendPromptMax: number
  /** The longest pre + trend prompt that leave the engine's text and the details their room. */
  readonly promptsMax: number
  /** Characters still free under the tighter of the two; below 0 = over. */
  readonly room: number
}

export function promptBudget(form: Pick<TrendForm, "prePrompt" | "trendPrompt">): PromptBudget {
  const trendPromptMax = CAST_SWAP_POST_PROMPT_MAX - SEP - TREND_DETAILS_MAX
  const promptsMax = getMaxVideoPromptChars("seedance-2-5") - TREND_PROMPT_LIMITS.engineTextReserve - SEP - TREND_DETAILS_MAX
  const pre = form.prePrompt.length
  const trend = form.trendPrompt.length
  return { trendPromptMax, promptsMax, room: Math.min(trendPromptMax - trend, promptsMax - pre - trend) }
}

/**
 * Face masking's engine defaults (shown as placeholders, never written into the
 * draft) and bounds (`@nodaro/shared`'s, which the server's schema reads too:
 * backend/src/lib/cast-swap-face-masking.ts).
 */
export const FACE_MASKING_DEFAULTS = CAST_SWAP_FACE_MASKING_DEFAULTS
export const FACE_MASKING_BOUNDS = CAST_SWAP_FACE_MASKING_BOUNDS
export const ZONE_SIDES = ["leftPct", "rightPct", "topPct", "bottomPct"] as const satisfies ReadonlyArray<keyof AdminTrendFaceMaskingZone>
export const SLOT_KEY_RE = /^[a-z0-9_]{1,32}$/
/** The server's slug rule (migration 549's CHECK); `runs` and `tags` are taken by the run and tag lists. */
const TREND_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const RESERVED_SLUGS: ReadonlySet<string> = new Set(["runs", "tags"])
export const isTrendSlug = (slug: string): boolean => TREND_SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug)
export const SLOT_KINDS: readonly TrendSlotKind[] = ["person", "location", "product", "pet"]
export const SLOT_CAPS: Readonly<Record<TrendSlotKind, number>> = { person: 6, location: 1, product: 3, pet: 3 }

/** The chips each kind carries (Cast Swap's per-role traits). A location has none. */
export const CHIPS_BY_KIND: Readonly<Record<TrendSlotKind, readonly TrendChipKey[]>> = {
  person: ["body", "outfit", "hair"],
  pet: ["body", "coat"],
  product: ["shape", "finish"],
  location: [],
}

export const CHIP_LABELS: Readonly<Record<TrendChipKey, string>> = {
  body: "Body",
  outfit: "Outfit",
  hair: "Hair",
  coat: "Coat",
  shape: "Shape",
  finish: "Finish",
}

export interface FormSlot extends AdminTrendSlot {
  /** Client-only list identity (never sent). */
  uid: string
  /** Not in the saved draft yet, so its key may still change (saved keys are stable). */
  isNew: boolean
}

export interface FormReference extends AdminTrendReference {
  uid: string
}

export interface TrendForm {
  name: TrendLocalizedText
  description: TrendLocalizedText
  source: AdminTrendData["source"]
  previewStart: number | null
  slots: FormSlot[]
  references: FormReference[]
  trendPrompt: string
  prePrompt: string
  /** As stored: undefined = the draft has none (masking off). */
  faceMasking: AdminTrendFaceMasking | undefined
}

let uidSeq = 0
export const newUid = () => `u${++uidSeq}`

export function toForm(draft: AdminTrendData): TrendForm {
  return {
    name: { ...draft.name },
    description: { en: "", ...draft.description },
    source: draft.source ? { ...draft.source } : null,
    previewStart: draft.previewStart,
    slots: draft.slots.map((s) => ({ ...s, uid: newUid(), isNew: false })),
    references: draft.references.map((r) => ({ ...r, images: [...r.images], uid: newUid() })),
    trendPrompt: draft.trendPrompt ?? "",
    prePrompt: draft.prePrompt ?? "",
    faceMasking: draft.faceMasking ? structuredClone(draft.faceMasking) : undefined,
  }
}

/** Only the keys that hold a number; undefined (the default margins) when none do; null (no margins) as it is. */
function cleanZone(z: AdminTrendFaceMaskingZone | null | undefined): AdminTrendFaceMaskingZone | null | undefined {
  if (z === null) return null
  if (!z) return undefined
  const out: AdminTrendFaceMaskingZone = {}
  for (const side of ZONE_SIDES) if (typeof z[side] === "number") out[side] = z[side]
  return Object.keys(out).length > 0 ? out : undefined
}

/** Whether the setting's fill is blur (a fill left out is the engine's default). Only then does
 *  the blur strength apply: the editor shows it, checks it and saves it only then. */
export function maskingUsesBlur(m: Pick<AdminTrendFaceMasking, "fill">): boolean {
  return (m.fill ?? FACE_MASKING_DEFAULTS.fill) === "blur"
}

/** The setting as saved: the mode, then only the keys that are set (the engine fills the rest). */
function cleanMasking(m: AdminTrendFaceMasking): AdminTrendFaceMasking {
  const zone = cleanZone(m.zone)
  const num = (v: number | undefined) => typeof v === "number" && Number.isFinite(v)
  return {
    mode: m.mode,
    ...(m.fill ? { fill: m.fill } : {}),
    ...(num(m.minFaceHeightPct) ? { minFaceHeightPct: m.minFaceHeightPct } : {}),
    ...(num(m.maxFaceHeightPct) ? { maxFaceHeightPct: m.maxFaceHeightPct } : {}),
    ...(zone !== undefined ? { zone } : {}),
    ...(maskingUsesBlur(m) && num(m.blurStrengthPct) ? { blurStrengthPct: m.blurStrengthPct } : {}),
    ...(num(m.threshold) ? { threshold: m.threshold } : {}),
  }
}

/** Non-empty entries only, English first then the platform's language order (a stable shape to compare). */
function cleanText(t: TrendLocalizedText): TrendLocalizedText {
  const out: TrendLocalizedText = { en: t.en.trim() }
  for (const { id } of LANGUAGES) {
    const v = t[id]
    if (id !== "en" && typeof v === "string" && v.trim()) out[id] = v.trim()
  }
  return out
}

function cleanSource(s: AdminTrendData["source"]): AdminTrendData["source"] {
  if (!s) return null
  return {
    videoUrl: s.videoUrl,
    durationSec: s.durationSec,
    ...(s.width !== undefined ? { width: s.width } : {}),
    ...(s.height !== undefined ? { height: s.height } : {}),
  }
}

const hasAnyText = (t: TrendLocalizedText | undefined) => !!t && Object.values(t).some((v) => typeof v === "string" && v.trim())

function cleanSlot(s: FormSlot): AdminTrendSlot {
  const out: AdminTrendSlot = {
    key: s.key,
    label: cleanText(s.label),
    kind: s.kind,
    required: s.required,
    roleName: s.roleName.trim(),
  }
  if (hasAnyText(s.hint)) out.hint = cleanText(s.hint!)
  const defaults: Partial<Record<TrendChipKey, TrendChoice>> = {}
  for (const chip of CHIPS_BY_KIND[s.kind]) {
    const v = s.defaults?.[chip]
    if (v) defaults[chip] = v
  }
  if (Object.keys(defaults).length > 0) out.defaults = defaults
  return out
}

/** The draft body to save (examples are never sent: only the example routes write them). */
export function fromForm(form: TrendForm): Omit<AdminTrendData, "examples"> {
  return {
    name: cleanText(form.name),
    ...(hasAnyText(form.description) ? { description: cleanText(form.description) } : {}),
    source: cleanSource(form.source),
    previewStart: form.previewStart,
    slots: form.slots.map(cleanSlot),
    references: form.references.map((r) => ({ images: [...r.images], line: r.line.trim() })),
    ...(form.trendPrompt.trim() ? { trendPrompt: form.trendPrompt } : {}),
    ...(form.prePrompt.trim() ? { prePrompt: form.prePrompt } : {}),
    ...(form.faceMasking ? { faceMasking: cleanMasking(form.faceMasking) } : {}),
  }
}

/** What a run of this form can send at most: 3 per slot plus every reference picture. */
export function imageCount(form: Pick<TrendForm, "slots" | "references">): number {
  return MAX_IMAGES_PER_SLOT * form.slots.length + form.references.reduce((n, r) => n + r.images.length, 0)
}

/** A slot kind changed: keep only the chips the new kind takes. */
export function withKind(s: FormSlot, kind: TrendSlotKind): FormSlot {
  const defaults: Partial<Record<TrendChipKey, TrendChoice>> = {}
  for (const chip of CHIPS_BY_KIND[kind]) if (s.defaults?.[chip]) defaults[chip] = s.defaults[chip]
  const rest: FormSlot = { ...s, kind }
  delete rest.defaults
  return kind === "location" || Object.keys(defaults).length === 0 ? rest : { ...rest, defaults }
}

/** The next free key for a new slot of `kind` (`person_1`, `person_2`, …). */
export function nextSlotKey(kind: TrendSlotKind, slots: readonly Pick<AdminTrendSlot, "key">[]): string {
  const taken = new Set(slots.map((s) => s.key))
  for (let i = 1; ; i++) if (!taken.has(`${kind}_${i}`)) return `${kind}_${i}`
}

export function newSlot(kind: TrendSlotKind, slots: readonly Pick<AdminTrendSlot, "key">[]): FormSlot {
  return { uid: newUid(), isNew: true, key: nextSlotKey(kind, slots), label: { en: "" }, kind, required: true, roleName: "" }
}

/** Keep the 4 s preview inside the clip after the clip changes. */
export function clampPreview(start: number | null, durationSec: number | undefined): number | null {
  if (start === null || durationSec === undefined) return start
  return Math.max(0, Math.min(start, Math.max(0, durationSec - PREVIEW_SECONDS)))
}

/** Every reason the server would refuse this form, as sentences. Empty = savable. */
export function formIssues(form: TrendForm): string[] {
  const out: string[] = []
  if (!form.name.en.trim()) out.push("Name: English is required.")
  else if (form.name.en.trim().length > 200) out.push("Name: at most 200 characters.")
  if (hasAnyText(form.description) && !form.description.en.trim()) out.push("Description: English is required when any language has text.")

  const seen = new Set<string>()
  form.slots.forEach((s, i) => {
    const n = `Slot ${i + 1}`
    if (!SLOT_KEY_RE.test(s.key)) out.push(`${n}: the key must be 1–32 of a–z, 0–9 and _.`)
    else if (seen.has(s.key)) out.push(`${n}: the key "${s.key}" is used twice.`)
    seen.add(s.key)
    if (!s.label.en.trim()) out.push(`${n}: the label needs English.`)
    else if (s.label.en.trim().length > 100) out.push(`${n}: the label is at most 100 characters.`)
    const role = s.roleName.trim()
    if (!role) out.push(`${n}: the role name is required.`)
    else if (role.length > 200) out.push(`${n}: the role name is at most 200 characters.`)
    if (hasAnyText(s.hint) && !s.hint!.en.trim()) out.push(`${n}: the hint needs English when any language has text.`)
  })
  for (const kind of SLOT_KINDS) {
    const count = form.slots.filter((s) => s.kind === kind).length
    if (count > SLOT_CAPS[kind]) out.push(`At most ${SLOT_CAPS[kind]} ${kind} slot${SLOT_CAPS[kind] === 1 ? "" : "s"}.`)
  }

  if (form.references.length > MAX_REFERENCES) out.push(`At most ${MAX_REFERENCES} fixed references.`)
  form.references.forEach((r, i) => {
    const n = `Reference ${i + 1}`
    if (r.images.length < 1 || r.images.length > MAX_IMAGES_PER_SLOT) out.push(`${n}: 1–3 pictures.`)
    const line = r.line.trim()
    if (!line) out.push(`${n}: the prompt line is required.`)
    else if (line.length > 500) out.push(`${n}: the prompt line is at most 500 characters.`)
  })

  const budget = promptBudget(form)
  if (form.trendPrompt.length > MAX_TREND_PROMPT) out.push(`Trend prompt: at most ${MAX_TREND_PROMPT} characters.`)
  else if (form.trendPrompt.length > budget.trendPromptMax) {
    out.push(`Trend prompt: at most ${budget.trendPromptMax} characters, to leave room for the user's details (up to ${TREND_DETAILS_MAX}).`)
  }
  if (form.prePrompt.length > MAX_PRE_PROMPT) out.push(`Pre prompt: at most ${MAX_PRE_PROMPT} characters.`)
  else if (form.trendPrompt.length <= budget.trendPromptMax && budget.room < 0) {
    out.push(`Pre and trend prompts: at most ${budget.promptsMax} characters together, to leave room for the engine's text and the user's details.`)
  }
  if (form.faceMasking) out.push(...maskingIssues(form.faceMasking))
  if (form.source && form.previewStart !== null && form.previewStart + PREVIEW_SECONDS > form.source.durationSec) {
    out.push(`The ${PREVIEW_SECONDS} s preview must fit inside the ${form.source.durationSec.toFixed(1)} s clip.`)
  }
  const images = imageCount(form)
  if (images > MAX_TREND_IMAGES) out.push(`${images} images: at most ${MAX_TREND_IMAGES} (3 per slot plus the reference pictures).`)
  return out
}

/** What the server would refuse in a face masking setting, as sentences. */
function maskingIssues(m: AdminTrendFaceMasking): string[] {
  const out: string[] = []
  const outside = (v: number | undefined, [lo, hi]: readonly [number, number]) => v !== undefined && !(v >= lo && v <= hi)
  const range = ([lo, hi]: readonly [number, number]) => `${lo}–${hi}`
  const { faceHeightPct, zonePct, blurStrengthPct, threshold } = FACE_MASKING_BOUNDS
  if (outside(m.minFaceHeightPct, faceHeightPct)) out.push(`Face masking: the smallest face height is ${range(faceHeightPct)} %.`)
  if (outside(m.maxFaceHeightPct, faceHeightPct)) out.push(`Face masking: the largest face height is ${range(faceHeightPct)} %.`)
  else if (m.maxFaceHeightPct !== undefined && m.maxFaceHeightPct > 0) {
    const min = m.minFaceHeightPct ?? FACE_MASKING_DEFAULTS.minFaceHeightPct
    if (!outside(m.minFaceHeightPct, faceHeightPct) && m.maxFaceHeightPct < min) {
      out.push(`Face masking: the largest face height must be at least the smallest (${min} %), or 0 for no limit.`)
    }
  }
  if (ZONE_SIDES.some((side) => outside(m.zone?.[side], zonePct))) out.push(`Face masking: each margin is ${range(zonePct)} %.`)
  if (maskingUsesBlur(m) && outside(m.blurStrengthPct, blurStrengthPct)) out.push(`Face masking: the blur strength is ${range(blurStrengthPct)} %.`)
  if (outside(m.threshold, threshold)) out.push(`Face masking: the detection threshold is ${range(threshold)}.`)
  return out
}

const NEED_LABELS: Readonly<Record<string, string>> = {
  person: "person slots",
  pet: "pet slots",
  product: "product slots",
  location: "location slots",
  fixedReferences: "fixed references",
  faceMasking: "face masking",
  trendPrePrompt: "pre prompts",
  fullQuality: "Full Quality",
  trendRun: "trend runs",
  castSwap: "Cast Swap",
}

/** One publish blocker as a sentence ("production: pet slots not supported yet"). */
export function describeBlocker(r: TrendPublishBlocker): string {
  switch (r.code) {
    case "source_missing":
      return "No source clip yet."
    case "no_required_slot":
      return "At least one slot must be required."
    case "no_example":
      return "Add at least one example."
    case "example_slots_incomplete":
      return `Example ${r.example ?? "?"} has no pictures for: ${(r.slots ?? []).join(", ")}.`
    case "invalid_data":
      return `The draft is not valid: ${r.message ?? "unknown problem"}.`
    case "engine_unknown":
      return `${r.env ?? "?"}: engine not reported yet`
    case "engine_unsupported": {
      const need = r.need ?? "?"
      return `${r.env ?? "?"}: ${NEED_LABELS[need] ?? need} not supported yet`
    }
    default:
      return r.message ?? r.code
  }
}

export function formatSeconds(s: number): string {
  return `${s.toFixed(1)} s`
}
