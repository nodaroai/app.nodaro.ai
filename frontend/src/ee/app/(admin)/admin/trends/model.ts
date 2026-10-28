/**
 * The trend editor's form model (pure): the server draft ↔ the form the
 * screen edits, the limits the server enforces (so Save is off before a 400),
 * the image count against the 30 cap, and publish blockers as sentences.
 *
 * The server's schemas are strict (backend/src/ee/lib/trends/schemas.ts): a
 * save must carry no client-only field, a slot only its own kind's chips (a
 * location none), and no optional text whose English is empty.
 *
 * The 4 s preview's own prompt parts (a slot's `previewRoleName`, a
 * reference's `previewLine`, `previewPrePrompt`, `previewTrendPrompt`) are
 * saved only when they have text: an empty one runs the full run's text
 * (`withPromptsFor` in `@nodaro/render-rules`, the server's rule too). They are kept while
 * the trend offers no preview, and checked against the budget only while it
 * does.
 */
import { LANGUAGES } from "@nodaro/shared/i18n"
import {
  CAST_SWAP_FACE_MASKING_BOUNDS,
  CAST_SWAP_FACE_MASKING_DEFAULTS,
  CAST_SWAP_ENGINE_WHEN_OMITTED,
  CAST_SWAP_KLING_MAX_IMAGES,
  TREND_PROMPT_LIMITS,
} from "@nodaro/shared/models"
import {
  castSwapImagesSent,
  faceMaskMarkSlot,
  promptModesOf,
  TREND_DETAILS_MAX,
  trendPromptBudget,
  withPromptsFor,
  type TrendPromptBudget,
  type TrendPromptSource,
} from "@nodaro/render-rules"
import { clipPreparationIssues, clipPreparationName, clipPreparationOf } from "./clip-preparation"
import { FULL_DEPTH_SCENES } from "./prompt-style"
import type {
  AdminTrendData,
  AdminTrendEngine,
  AdminTrendKlingLength,
  AdminTrendFaceMasking,
  AdminTrendFaceMaskingZone,
  AdminTrendPreviewClip,
  AdminTrendReference,
  AdminTrendSlot,
  TrendChipKey,
  TrendChoice,
  TrendDraftBody,
  TrendLocalizedText,
  TrendPublishBlocker,
  TrendSlotKind,
  CastSwapPromptStyleId,
  CastSwapPulseAudioId,
} from "@/lib/api"

export const MAX_TREND_IMAGES = 30
export const MAX_IMAGES_PER_SLOT = 3
export const MAX_REFERENCES = 5
export const PREVIEW_SECONDS = 4
export const MAX_TREND_PROMPT = TREND_PROMPT_LIMITS.trendPromptMax
export const MAX_PRE_PROMPT = TREND_PROMPT_LIMITS.prePromptMax

/**
 * The room a trend's prompts leave for the user's details, and the texts a 4 s
 * preview run sends: `@nodaro/render-rules`' trend-prompts.ts, the one rule
 * the server's publish check and composition run too
 * (backend/src/ee/lib/trends/prompt-budget.ts, prompt-parts.ts).
 */
export { hasOwnPreviewPrompts } from "@nodaro/render-rules"
export { TREND_DETAILS_MAX }

export type PromptBudget = TrendPromptBudget

/**
 * The budget of these texts: the trend prompt shares the engine's post prompt
 * field with the details, and the pre and trend prompts share the whole-prompt
 * cap (Kling 4's less the engine text of its own slots and references).
 */
export function promptBudget(
  form: Pick<TrendForm, "prePrompt" | "trendPrompt"> & Partial<Pick<TrendForm, "engine" | "slots" | "references">>,
): PromptBudget {
  return trendPromptBudget(form)
}

/** The form with the texts a 4 s preview run sends in the full run's fields (the preview's own, else the full run's). */
export function withPreviewPrompts<F extends TrendPromptSource>(form: F): F {
  return withPromptsFor(form, "preview")
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
  /** The 4 s preview's own trend prompt; "" = the trend prompt. */
  previewTrendPrompt: string
  /** The 4 s preview's own pre prompt; "" = the pre prompt. */
  previewPrePrompt: string
  /** As stored: undefined = the draft has none (masking off). */
  faceMasking: AdminTrendFaceMasking | undefined
  /** As stored: undefined = the draft names none (Seedance 2.5), so loading an old draft is no change. */
  engine: AdminTrendEngine | undefined
  /** As stored: undefined = none set ("cut-end"). Saved only while the engine is Kling 4. */
  klingLength: AdminTrendKlingLength | undefined
  /** As stored: undefined = none set ("original"). Saved only while the engine is Kling 4. */
  pulseAudio: CastSwapPulseAudioId | undefined
  /** As stored: undefined = the clip preparation's default (prompt-style.ts). */
  promptStyle: CastSwapPromptStyleId | undefined
  /**
   * The 4 s preview's input clip as loaded, READ-ONLY: server-owned (made on
   * save), never sent by `fromForm`, so it never makes the form dirty. Read
   * it through `previewClipStatus`.
   */
  previewClip: AdminTrendPreviewClip | undefined
}

let uidSeq = 0
export const newUid = () => `u${++uidSeq}`

export function toForm(draft: AdminTrendData): TrendForm {
  return {
    name: { ...draft.name },
    description: { en: "", ...draft.description },
    source: draft.source ? { ...draft.source } : null,
    previewStart: draft.previewStart,
    slots: draft.slots.map((s) => ({ ...s, ...(s.defaultImages ? { defaultImages: [...s.defaultImages] } : {}), uid: newUid(), isNew: false })),
    references: draft.references.map((r) => ({ ...r, images: [...r.images], uid: newUid() })),
    trendPrompt: draft.trendPrompt ?? "",
    prePrompt: draft.prePrompt ?? "",
    previewTrendPrompt: draft.previewTrendPrompt ?? "",
    previewPrePrompt: draft.previewPrePrompt ?? "",
    faceMasking: draft.faceMasking ? structuredClone(draft.faceMasking) : undefined,
    engine: draft.engine,
    klingLength: draft.klingLength,
    pulseAudio: draft.pulseAudio,
    promptStyle: draft.promptStyle,
    previewClip: draft.previewClip ? { ...draft.previewClip } : undefined,
  }
}

/**
 * The 4 s preview's input clip against this draft: `"current"` = the stored
 * clip was cut from this source at this preview start, so a preview run of
 * the draft as it is edits it; `"stale"` = one is stored, but from another
 * source clip or start (remade on save); `"none"` = none stored, or no
 * preview offered. The server's `previewClipState` (backend preview-clip.ts),
 * less what only it knows: the cut's recipe and the face mask's pin (a
 * publish blocker says those).
 */
export type PreviewClipStatus = "none" | "current" | "stale"

export function previewClipStatus(form: Pick<AdminTrendData, "source" | "previewStart" | "previewClip">): PreviewClipStatus {
  const clip = form.previewClip
  if (!clip || form.previewStart === null || !form.source) return "none"
  return clip.sourceVideoUrl === form.source.videoUrl && clip.startSec === form.previewStart ? "current" : "stale"
}

/** The engine a run of this form uses: its own, else Seedance 2.5 (the server's `engineOf`). */
export function engineOfForm(form: Pick<TrendForm, "engine">): AdminTrendEngine {
  return form.engine ?? CAST_SWAP_ENGINE_WHEN_OMITTED
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

/** The setting as saved: the mode, then only the keys that are set (the engine fills the rest). Also Admin → Nodaro Motion's. */
export function cleanMasking(m: AdminTrendFaceMasking): AdminTrendFaceMasking {
  const zone = cleanZone(m.zone)
  const num = (v: number | undefined) => typeof v === "number" && Number.isFinite(v)
  return {
    mode: m.mode,
    // A trend's clip preparation; Faces hidden (the default) is saved as no key, as before it existed.
    ...(m.source && m.source !== "faces" ? { source: m.source } : {}),
    // Full depth's scene source (left out = a description); no other preparation takes it.
    ...(m.source === "full-depth" && m.scene ? { scene: m.scene } : {}),
    ...(m.target ? { target: m.target } : {}),
    ...(m.fill ? { fill: m.fill } : {}),
    ...(num(m.minFaceHeightPct) ? { minFaceHeightPct: m.minFaceHeightPct } : {}),
    ...(num(m.maxFaceHeightPct) ? { maxFaceHeightPct: m.maxFaceHeightPct } : {}),
    ...(zone !== undefined ? { zone } : {}),
    ...(maskingUsesBlur(m) && num(m.blurStrengthPct) ? { blurStrengthPct: m.blurStrengthPct } : {}),
    ...(num(m.threshold) ? { threshold: m.threshold } : {}),
    // The trend's face mask marks, kept as they are (none = no key, as before marks existed).
    ...(m.marks && m.marks.length > 0 ? { marks: m.marks.map((mark) => ({ ...mark })) } : {}),
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

/** The source as saved; its display copy (what users see) is kept field by field, as the server's strict schema takes it. */
function cleanSource(s: AdminTrendData["source"]): AdminTrendData["source"] {
  if (!s) return null
  const d = s.display
  return {
    videoUrl: s.videoUrl,
    durationSec: s.durationSec,
    ...(s.width !== undefined ? { width: s.width } : {}),
    ...(s.height !== undefined ? { height: s.height } : {}),
    ...(s.sha256 !== undefined ? { sha256: s.sha256 } : {}),
    ...(d
      ? { display: { videoUrl: d.videoUrl, posterUrl: d.posterUrl, width: d.width, height: d.height, durationSec: d.durationSec } }
      : {}),
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
  const previewRole = s.previewRoleName?.trim()
  if (previewRole) out.previewRoleName = previewRole
  if (hasAnyText(s.hint)) out.hint = cleanText(s.hint!)
  if (s.hintImageUrl) out.hintImageUrl = s.hintImageUrl
  // Saved as they are (a required slot with some is refused by the server, and named by `formIssues`), never empty.
  if (s.defaultImages && s.defaultImages.length > 0) out.defaultImages = [...s.defaultImages]
  const defaults: Partial<Record<TrendChipKey, TrendChoice>> = {}
  for (const chip of CHIPS_BY_KIND[s.kind]) {
    const v = s.defaults?.[chip]
    if (v) defaults[chip] = v
  }
  if (Object.keys(defaults).length > 0) out.defaults = defaults
  const shown = shownChips(s)
  // Every chip shown is saved as none listed (the server's default), so a trend nobody limited stays as it was.
  if (shown.length < CHIPS_BY_KIND[s.kind].length) out.chips = shown
  return out
}

/** The chips a slot shows to people, in its kind's order: its `chips`, else all of its kind's. */
export function shownChips(s: Pick<AdminTrendSlot, "kind" | "chips">): TrendChipKey[] {
  const all = CHIPS_BY_KIND[s.kind]
  return s.chips ? all.filter((c) => s.chips!.includes(c)) : [...all]
}

/** Show (or hide) one chip of a slot to people. All shown again = none listed. */
export function withChipShown(s: FormSlot, chip: TrendChipKey, show: boolean): FormSlot {
  const all = CHIPS_BY_KIND[s.kind]
  const shown = shownChips(s)
  const next = all.filter((c) => (c === chip ? show : shown.includes(c)))
  const rest: FormSlot = { ...s }
  delete rest.chips
  return next.length === all.length ? rest : { ...rest, chips: next }
}

/**
 * The draft body to save (examples are never sent: only the example routes
 * write them; nor the preview input clip, which the server makes on save).
 */
export function fromForm(form: TrendForm): TrendDraftBody {
  return {
    name: cleanText(form.name),
    ...(hasAnyText(form.description) ? { description: cleanText(form.description) } : {}),
    source: cleanSource(form.source),
    previewStart: form.previewStart,
    slots: form.slots.map(cleanSlot),
    references: form.references.map((r) => {
      const previewLine = r.previewLine?.trim()
      return { images: [...r.images], line: r.line.trim(), ...(previewLine ? { previewLine } : {}) }
    }),
    ...(form.trendPrompt.trim() ? { trendPrompt: form.trendPrompt } : {}),
    ...(form.prePrompt.trim() ? { prePrompt: form.prePrompt } : {}),
    // Kept while the trend offers no preview, so turning it back on finds them again.
    ...(form.previewTrendPrompt.trim() ? { previewTrendPrompt: form.previewTrendPrompt } : {}),
    ...(form.previewPrePrompt.trim() ? { previewPrePrompt: form.previewPrePrompt } : {}),
    ...(form.faceMasking ? { faceMasking: cleanMasking(form.faceMasking) } : {}),
    ...(form.engine ? { engine: form.engine } : {}),
    // Read only on Kling 4: kept out of a Seedance draft.
    ...(form.engine === "kling-4" && form.klingLength ? { klingLength: form.klingLength } : {}),
    ...(form.engine === "kling-4" && form.pulseAudio ? { pulseAudio: form.pulseAudio } : {}),
    // Left out = the clip preparation's default, so loading an old draft is no change.
    ...(form.promptStyle ? { promptStyle: form.promptStyle } : {}),
  }
}

/** The most images a run of this form may send: 10 on Kling 4, else 30. */
export function maxImagesFor(form: Pick<TrendForm, "engine">): number {
  return form.engine === "kling-4" ? CAST_SWAP_KLING_MAX_IMAGES : MAX_TREND_IMAGES
}

/**
 * What a run of this form can send at most, as the engine's route counts it.
 * Kling 4: a person, pet or product slot sends its ONE prepared picture (a
 * trend run prepares them), a location its 3, plus the reference pictures.
 * Seedance 2.5: 3 per slot plus every reference picture (`imageCount`).
 */
export function imagesSentAtMost(form: Pick<TrendForm, "engine" | "slots" | "references">): number {
  if (form.engine !== "kling-4") return imageCount(form)
  return castSwapImagesSent(
    form.slots.map((s) => ({ kind: s.kind, images: MAX_IMAGES_PER_SLOT })),
    form.references.reduce((n, r) => n + r.images.length, 0),
  )
}

/** What a run of this form can send at most: 3 per slot plus every reference picture. */
export function imageCount(form: Pick<TrendForm, "slots" | "references">): number {
  return MAX_IMAGES_PER_SLOT * form.slots.length + form.references.reduce((n, r) => n + r.images.length, 0)
}

/** A slot kind changed: keep only the defaults the new kind takes, and show all of its chips again. */
export function withKind(s: FormSlot, kind: TrendSlotKind): FormSlot {
  const defaults: Partial<Record<TrendChipKey, TrendChoice>> = {}
  for (const chip of CHIPS_BY_KIND[kind]) if (s.defaults?.[chip]) defaults[chip] = s.defaults[chip]
  const rest: FormSlot = { ...s, kind }
  delete rest.defaults
  delete rest.chips
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
    if ((s.previewRoleName?.trim().length ?? 0) > 200) out.push(`${n}: the role name in the 4 s preview is at most 200 characters.`)
    if (hasAnyText(s.hint) && !s.hint!.en.trim()) out.push(`${n}: the hint needs English when any language has text.`)
    const defaults = s.defaultImages?.length ?? 0
    if (defaults > 0 && s.required) out.push(`${n}: a required slot cannot have a default image. Remove its default images, or make it optional.`)
    if (defaults > MAX_IMAGES_PER_SLOT) out.push(`${n}: at most ${MAX_IMAGES_PER_SLOT} default images.`)
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
    if ((r.previewLine?.trim().length ?? 0) > 500) out.push(`${n}: the prompt line in the 4 s preview is at most 500 characters.`)
  })

  out.push(...promptIssues(form, ""))
  if (form.previewTrendPrompt.length > MAX_TREND_PROMPT) out.push(`Trend prompt in the 4 s preview: at most ${MAX_TREND_PROMPT} characters.`)
  if (form.previewPrePrompt.length > MAX_PRE_PROMPT) out.push(`Pre prompt in the 4 s preview: at most ${MAX_PRE_PROMPT} characters.`)
  // The preview's texts are held to the budget only while the trend offers a preview and has
  // text of its own (else it sends the full run's): the server's publish check (`promptModesOf`).
  if (promptModesOf(form).includes("preview")) out.push(...promptIssues(withPreviewPrompts(form), " in the 4 s preview"))
  if (form.faceMasking) out.push(...clipPreparationIssues(form.faceMasking), ...maskingIssues(form.faceMasking), ...personMarkIssues(form))
  if (form.source && form.previewStart !== null && form.previewStart + PREVIEW_SECONDS > form.source.durationSec) {
    out.push(`The ${PREVIEW_SECONDS} s preview must fit inside the ${form.source.durationSec.toFixed(1)} s clip.`)
  }
  const images = imagesSentAtMost(form)
  const most = maxImagesFor(form)
  if (images > most) {
    out.push(
      form.engine === "kling-4"
        ? `${images} images: at most ${most} on Nodaro Motion Pulse (Kling 4) (1 prepared picture per person, pet or product slot, 3 per location, plus the reference pictures).`
        : `${images} images: at most ${most} (3 per slot plus the reference pictures).`,
    )
  }
  return out
}

/** The prompt length and budget issues of these texts (the full run's, or the preview's with `where`). */
function promptIssues(form: TrendForm, where: string): string[] {
  const out: string[] = []
  const budget = promptBudget(form)
  if (form.trendPrompt.length > MAX_TREND_PROMPT) {
    if (!where) out.push(`Trend prompt: at most ${MAX_TREND_PROMPT} characters.`)
  } else if (form.trendPrompt.length > budget.trendPromptMax) {
    out.push(`Trend prompt${where}: at most ${budget.trendPromptMax} characters, to leave room for the user's details (up to ${TREND_DETAILS_MAX}).`)
  }
  if (form.prePrompt.length > MAX_PRE_PROMPT) {
    if (!where) out.push(`Pre prompt: at most ${MAX_PRE_PROMPT} characters.`)
  } else if (form.trendPrompt.length <= budget.trendPromptMax && budget.room < 0) {
    const on = form.engine === "kling-4" ? " on Nodaro Motion Pulse (Kling 4)" : ""
    out.push(
      `Pre and trend prompts${where}: at most ${Math.max(0, budget.promptsMax)} characters together${on}, to leave room for the engine's text and the user's details.`,
    )
  }
  return out
}

/**
 * A face mark for a person whose slot is no longer an optional person (made
 * required, made another kind, or removed — a rename is a removal), as
 * sentences: the server refuses such a save rather than dropping the marks,
 * so the editor says why first (Save is held).
 */
export function personMarkIssues(form: Pick<TrendForm, "slots" | "faceMasking">): string[] {
  const out: string[] = []
  const counted = new Set<string>()
  for (const mark of form.faceMasking?.marks ?? []) {
    const key = faceMaskMarkSlot(mark)
    if (key === null || counted.has(key)) continue
    counted.add(key)
    const slot = form.slots.find((s) => s.key === key)
    if (slot && slot.kind === "person" && !slot.required) continue
    const name = slot?.label.en || key
    const why = !slot ? "is no longer a slot" : slot.kind !== "person" ? "is no longer a person" : "is now required"
    out.push(`Face masking: "${name}" ${why}, but has face marks. Remove that person's face marks first (6. Face masking).`)
  }
  return out
}

/** What the server would refuse in a face masking setting, as sentences. */
/** A face masking setting's out-of-range values, as sentences (Save is held on any). Also Admin → Nodaro Motion's. */
export function maskingIssues(m: AdminTrendFaceMasking): string[] {
  const out: string[] = []
  // Full depth reads the mode only: whatever else is kept (from Faces hidden) is neither shown nor sent.
  if (clipPreparationOf(m) === "full-depth") return out
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
  // Keep people has no fill (outside the people is always depth): no blur strength either.
  if (clipPreparationOf(m) !== "keep-people" && maskingUsesBlur(m) && outside(m.blurStrengthPct, blurStrengthPct)) out.push(`Face masking: the blur strength is ${range(blurStrengthPct)} %.`)
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
  storedFaceMask: "stored face masks",
  storedFaceMaskRequired: "stored face masks a run must use (marks, person masks)",
  "faceMaskTarget:face": "face-only masks",
  "faceMaskTarget:body": "whole-person masks (Keep people)",
  promptParts: "engine prompt changes",
  trendPrePrompt: "pre prompts",
  "kling-4": "Nodaro Motion Pulse (Kling 4)",
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
    case "source_display_missing":
      return "The source clip has no display copy (the copy users see). Upload the clip again to make one."
    case "preview_clip_missing":
      return "The 4 s preview's input clip is not prepared yet. Save the draft, or publish again, to make it (1. Source clip → Preview input)."
    case "preview_clip_out_of_date":
      return `The 4 s preview's input clip is out of date: ${describePreviewClipOutOfDate(r.why)}. Save the draft, or publish again, to make it again (1. Source clip → Preview input).`
    case "example_slots_incomplete":
      return `Example ${r.example ?? "?"} has no pictures for: ${(r.slots ?? []).join(", ")}.`
    case "invalid_data":
      return `The draft is not valid: ${r.message ?? "unknown problem"}.`
    case "face_mask_missing":
      return "This trend masks faces: make its face mask and approve it (6. Face masking)."
    case "face_mask_out_of_date":
      return `The face mask is out of date: ${describeFaceMaskOutOfDate({ why: r.why ?? "settings", env: r.env ?? "?" })}`
    case "face_mask_people_over_cap":
      return `More than 3 people have face marks (${(r.slots ?? []).join(", ")}): remove some of their marks (6. Face masking).`
    case "face_mask_variant_missing":
      return r.slots?.length
        ? `The person mask for runs without ${r.slots.join(", ")} is not made yet: make the person masks (6. Face masking).`
        : (r.message ?? "Make the person masks (6. Face masking).")
    case "face_mask_variant_out_of_date":
      return `The person mask for runs without ${(r.slots ?? []).join(", ")} is out of date: make the person masks again (6. Face masking).`
    case "face_mask_source_unsupported":
      return `${r.env ?? "?"}: the clip preparation ${clipPreparationName(r.need ?? "?")} not supported yet. Choose Faces hidden, or wait for the engine (6. Face masking).`
    case "prompt_style_unsupported":
      return `${r.env ?? "?"}: the ${r.need === "promptStyle:flexible" ? "Flexible" : "Precise"} prompt style not supported yet for this clip preparation. Choose the default, or wait for the engine (4. Prompts).`
    case "full_depth_scene_unsupported":
      return `${r.env ?? "?"}: the Full depth scene "${FULL_DEPTH_SCENES.find((s) => `scene:${s.value}` === r.need)?.label ?? r.need ?? "?"}" not supported yet. Choose another scene, or wait for the engine (6. Face masking).`
    case "full_depth_clip_too_long":
      return r.message ?? "The clip is too long to send the original as a second video: use a shorter clip, or take the scene from a description (6. Face masking)."
    case "prompt_parts_invalid": {
      const problems = (r.problems ?? []).map((p) => `${p.mode === "preview" ? "4 s preview: " : ""}${p.part ? `${p.part}: ` : ""}${p.message}`)
      return `The engine prompt changes no longer fit this trend${problems.length ? `: ${problems.join(" ")}` : "."} Change or reset them (4. Prompts → Engine prompt).`
    }
    case "prompt_parts_unsupported":
      return `${r.env ?? "?"}: engine prompt changes not supported yet. Reset them (4. Prompts → Engine prompt), or wait for the engine.`
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

/** Why a stored face mask is out of date, as a sentence. */
export function describeFaceMaskOutOfDate(r: { why: string; env?: string }): string {
  switch (r.why) {
    case "settings":
      return "the source clip or the face masking settings changed since it was made. Make it again."
    case "core_recipe":
      return "Video Mask changed how it masks since it was made. Make it again."
    case "plugin_recipe":
      return `${r.env ?? "?"}'s Cast Swap engine masks faces differently since it was made. Make it again.`
    default:
      return "make it again."
  }
}

/** Why the 4 s preview's input clip is out of date (`preview_clip_out_of_date`'s `why`), as a clause. */
function describePreviewClipOutOfDate(why: string | undefined): string {
  switch (why) {
    case "source":
      return "the source clip changed since it was cut"
    case "start":
      return "the preview start moved since it was cut"
    case "recipe":
      return "clips are cut differently since it was made"
    case "face_mask":
      return "the face mask changed since it was cut"
    default:
      return "the draft changed since it was cut"
  }
}

export function formatSeconds(s: number): string {
  return `${s.toFixed(1)} s`
}
