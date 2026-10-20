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
import type {
  AdminTrendData,
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
export const MAX_TREND_PROMPT = 3000
export const SLOT_KEY_RE = /^[a-z0-9_]{1,32}$/
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

  if (form.trendPrompt.length > MAX_TREND_PROMPT) out.push(`Trend prompt: at most ${MAX_TREND_PROMPT} characters.`)
  if (form.source && form.previewStart !== null && form.previewStart + PREVIEW_SECONDS > form.source.durationSec) {
    out.push(`The ${PREVIEW_SECONDS} s preview must fit inside the ${form.source.durationSec.toFixed(1)} s clip.`)
  }
  const images = imageCount(form)
  if (images > MAX_TREND_IMAGES) out.push(`${images} images: at most ${MAX_TREND_IMAGES} (3 per slot plus the reference pictures).`)
  return out
}

const NEED_LABELS: Readonly<Record<string, string>> = {
  person: "person slots",
  pet: "pet slots",
  product: "product slots",
  location: "location slots",
  fixedReferences: "fixed references",
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
