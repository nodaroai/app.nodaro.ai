/**
 * Validation for trend versions (admin writes) and trend run requests.
 *
 * Limits follow Cast Swap's: person roles ≤ 6, location ≤ 1, product ≤ 3,
 * pet ≤ 3; ≤ 3 images per role; ≤ 5 fixed references of 1–3 images; ≤ 30
 * images in all; a 4–30 s clip with a 4 s preview inside it. A prompt part's
 * 4 s preview version has its full one's limit, and may be empty.
 */
import { z } from "zod"
import { LANGUAGES } from "@nodaro/shared/i18n"
import {
  CAST_SWAP_ENGINE_IDS_ACCEPTED,
  CAST_SWAP_ENGINE_WHEN_OMITTED,
  castSwapEngineFrom,
  CAST_SWAP_KLING_LENGTHS,
  TREND_PROMPT_LIMITS,
  type CastSwapEngine,
} from "@nodaro/shared/models"
import { CAST_SWAP_FACE_MASK_MARK_LIMITS, CAST_SWAP_PROMPT_PART_IDS, CAST_SWAP_PROMPT_STYLES, faceMaskMarkSlot } from "@nodaro/render-rules"
import { faceMaskingWithMarksSchema } from "../../../lib/cast-swap-face-masking.js"
import { PROMPT_PART_TEXT_MAX } from "../../../lib/cast-swap-prompt-parts-contract.js"
import type {
  Choice,
  LocalizedText,
  TrendRunRequest,
  TrendSlot,
  TrendPromptPartOverrides,
  TrendSlotKind,
  TrendVersionData,
} from "./types.js"

export const MAX_TREND_IMAGES = 30
export const MAX_IMAGES_PER_SLOT = 3
export const PREVIEW_SECONDS = 4
export const SLOT_CAPS: Readonly<Record<TrendSlotKind, number>> = { person: 6, location: 1, product: 3, pet: 3 }

/** The chips each slot kind carries (Cast Swap's per-role traits). */
export const CHIPS_BY_KIND = {
  person: ["body", "outfit", "hair"],
  pet: ["body", "coat"],
  product: ["shape", "finish"],
  location: [],
} as const satisfies Record<TrendSlotKind, readonly string[]>

export type ChipKey = (typeof CHIPS_BY_KIND)[Exclude<TrendSlotKind, "location">][number]

const SLOT_KEY_RE = /^[a-z0-9_]{1,32}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A slot key indexes plain objects (a run's `slots`, an example's images), so
 * no name `Object.prototype` already has is ever one — `__proto__` and
 * `constructor` match SLOT_KEY_RE, and as a key either would reach the
 * prototype instead of an own entry.
 */
function isOwnableKey(key: string): boolean {
  return !(key in Object.prototype)
}
const PROTOTYPE_KEY_MESSAGE = "A slot key cannot be a built-in object property name."

/** A slot key as a trend version declares it. */
const slotKeySchema = z
  .string()
  .regex(SLOT_KEY_RE, "A slot key is 1–32 of a–z, 0–9 and _.")
  .refine(isOwnableKey, PROTOTYPE_KEY_MESSAGE)

/**
 * A slot key as a run request names it. Its format is left to the trend (a key
 * the trend does not have is the route's `unknown_slot`); a built-in object
 * property name is refused here.
 */
const runSlotKeySchema = z.string().refine(isOwnableKey, PROTOTYPE_KEY_MESSAGE)

/**
 * A record keyed by slot, refusing a built-in property name among the keys it
 * is sent. The key schema alone cannot: a record drops an own `__proto__` key
 * (as `JSON.parse` makes one) before its keys are checked, so it would pass
 * silently instead of being refused.
 */
function slotRecord<T extends z.ZodType<Record<string, unknown>>>(record: T) {
  return z
    .unknown()
    .superRefine((value, ctx) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return
      for (const key of Object.keys(value)) {
        if (!isOwnableKey(key)) ctx.addIssue({ code: "custom", path: [key], message: PROTOTYPE_KEY_MESSAGE })
      }
    })
    .pipe(record)
}

const httpUrl = z.url({ protocol: /^https?$/ })
const choice = z.enum(["new", "original"] satisfies Choice[])

function localizedText(max: number): z.ZodType<LocalizedText> {
  const shape: Record<string, z.ZodType> = { en: z.string().min(1).max(max) }
  for (const { id } of LANGUAGES) {
    // An untranslated language may arrive as ""; reads fall back to English.
    if (id !== "en") shape[id] = z.string().max(max).optional()
  }
  return z.strictObject(shape) as unknown as z.ZodType<LocalizedText>
}

function chips<K extends ChipKey>(keys: readonly K[]) {
  return z.strictObject(Object.fromEntries(keys.map((k) => [k, choice.optional()])) as Record<K, z.ZodOptional<typeof choice>>)
}

/**
 * The chips a slot shows to the person: only its kind's own, each once.
 * Absent = all of them; `[]` = none.
 */
function shown<K extends ChipKey>(keys: readonly [K, ...K[]]) {
  return z.array(z.enum(keys)).refine((list) => new Set(list).size === list.length, "A chip is listed twice in `chips`.")
}

const slotBase = {
  key: slotKeySchema,
  label: localizedText(100),
  required: z.boolean(),
  hint: localizedText(500).optional(),
  hintImageUrl: httpUrl.optional(),
  roleName: z.string().min(1).max(200),
  // The 4 s preview's own wording (prompt-parts.ts): same limit, and empty is
  // allowed (it falls back to `roleName`), so clearing one never fails a save.
  previewRoleName: z.string().max(200).optional(),
}

// Strict objects: a chip that is not the slot kind's own (or any `defaults`
// or `chips` on a location) is an error, never silently dropped.
const trendSlotSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...slotBase,
    kind: z.literal("person"),
    defaults: chips(CHIPS_BY_KIND.person).optional(),
    chips: shown(CHIPS_BY_KIND.person).optional(),
  }),
  z.strictObject({
    ...slotBase,
    kind: z.literal("pet"),
    defaults: chips(CHIPS_BY_KIND.pet).optional(),
    chips: shown(CHIPS_BY_KIND.pet).optional(),
  }),
  z.strictObject({
    ...slotBase,
    kind: z.literal("product"),
    defaults: chips(CHIPS_BY_KIND.product).optional(),
    chips: shown(CHIPS_BY_KIND.product).optional(),
  }),
  z.strictObject({ ...slotBase, kind: z.literal("location") }),
])

const trendReferenceSchema = z.strictObject({
  images: z.array(httpUrl).min(1).max(MAX_IMAGES_PER_SLOT),
  line: z.string().min(1).max(500),
  previewLine: z.string().max(500).optional(),
})

const trendExampleSchema = z.strictObject({
  videoUrl: httpUrl,
  posterUrl: httpUrl.optional(),
  width: z.int().positive(),
  height: z.int().positive(),
  durationSec: z.number().positive(),
  slots: slotRecord(z.record(slotKeySchema, z.array(httpUrl).min(1).max(MAX_IMAGES_PER_SLOT))),
  sourceJobId: z.string().min(1),
})

const nonNegative = z.number().min(0)

/** Most per-person variants a mask keeps: one per non-empty set of the most marked people (2^3 − 1 = 7). */
const MAX_VARIANTS = 2 ** CAST_SWAP_FACE_MASK_MARK_LIMITS.maxMarkedPeople - 1
const emptySlotsSchema = z.array(slotKeySchema).min(1).max(SLOT_CAPS.person)

/** A per-person variant of the face mask (`TrendFaceMaskVariant`): written by the face mask routes only. */
const trendFaceMaskVariantSchema = z.strictObject({
  emptySlots: emptySlotsSchema,
  key: z.string().min(1).max(200),
  url: httpUrl.optional(),
  frames: z.int().positive(),
  jobId: z.string().min(1),
  stats: z.strictObject({ coverage: nonNegative, erasedRegions: nonNegative }),
  approvedAt: z.string().min(1),
})

/** A per-person variant in the making (`TrendFaceMaskVariantJob`): written by the face mask routes only. */
const trendFaceMaskVariantJobSchema = z.strictObject({
  emptySlots: emptySlotsSchema,
  key: z.string().min(1).max(200),
  jobId: z.string().min(1),
  eraseJobId: z.string().min(1).optional(),
  makeJobId: z.string().min(1).optional(),
  startedAt: z.string().min(1),
  error: z.strictObject({ message: z.string().max(1000), at: z.string().min(1) }).optional(),
})

/** An approved face mask (`TrendFaceMask`): written by the face mask routes only. */
const trendFaceMaskSchema = z.strictObject({
  url: httpUrl,
  frames: z.int().positive(),
  recipe: z.strictObject({ core: z.string().min(1).max(100).nullable(), plugin: z.string().min(1).max(100) }),
  settingsKey: z.string().min(1).max(200),
  jobId: z.string().min(1),
  stats: z.strictObject({ shots: nonNegative, heldFrames: nonNegative, coverage: nonNegative, droppedRegions: nonNegative, erasedRegions: nonNegative.optional() }),
  approvedAt: z.string().min(1),
  approvedBy: z.string().min(1),
  rawMaskUrl: httpUrl.optional(),
  depthUrl: httpUrl.optional(),
  baseKey: z.string().min(1).max(200).optional(),
  baseStats: z.strictObject({ shots: nonNegative, heldFrames: nonNegative, coverage: nonNegative, droppedRegions: nonNegative }).optional(),
  fps: z.number().positive().max(1000).optional(),
  variants: z.array(trendFaceMaskVariantSchema).max(MAX_VARIANTS).optional(),
  variantJobs: z.array(trendFaceMaskVariantJobSchema).max(MAX_VARIANTS).optional(),
})

/** The face mask being made (`TrendFaceMaskJob`): written by the face mask routes only. */
const trendFaceMaskJobSchema = z.strictObject({
  jobId: z.string().min(1),
  settingsKey: z.string().min(1).max(200),
  startedAt: z.string().min(1),
})

/** The most upscales a draft keeps in the making at once (the source and its examples together). */
export const MAX_UPSCALE_JOBS = 20

/** An upscale in the making (`TrendUpscaleJob`): written by the upscale routes only. */
const trendUpscaleJobSchema = z.strictObject({
  jobId: z.string().min(1),
  target: z.enum(["source", "example"]),
  fromUrl: httpUrl,
  startedAt: z.string().min(1),
  applying: z.strictObject({ startedAt: z.string().min(1), by: z.string().min(1) }).optional(),
  error: z.strictObject({ code: z.string().min(1).max(100), message: z.string().max(1000), at: z.string().min(1) }).optional(),
})

/** A source crop in the making (`TrendSourceCrop`): written by the crop routes only. */
const trendSourceCropSchema = z.strictObject({
  aspect: z.enum(["16:9", "9:16"]),
  position: z.number().min(0).max(1),
  fromUrl: httpUrl,
  startedAt: z.string().min(1),
  by: z.string().min(1),
  error: z.strictObject({ code: z.string().min(1).max(100), message: z.string().max(1000), at: z.string().min(1) }).optional(),
})

/**
 * A trend version's engine: its own, else `"seedance-2-5"` (the engine of
 * every version saved before the choice, and of a version that names none).
 * Read through here, never `data.engine` directly, so an old version reads
 * as what it always ran on.
 */
export function engineOf(data: Pick<TrendVersionData, "engine">): CastSwapEngine {
  return data.engine ?? CAST_SWAP_ENGINE_WHEN_OMITTED
}

/** The most images a run of this version can send: 3 per slot plus every fixed reference image. */
export function maxImagesOf(data: Pick<TrendVersionData, "slots" | "references">): number {
  return MAX_IMAGES_PER_SLOT * data.slots.length + data.references.reduce((n, r) => n + r.images.length, 0)
}

/** A stored override: its text (1–2000) and the default's hash (16 hex). */
const overrideSchema = z.strictObject({
  text: z.string().min(1).max(PROMPT_PART_TEXT_MAX),
  defaultHash: z.string().regex(/^[0-9a-f]{16}$/, "A default's hash is 16 hex characters."),
})

/** `TrendVersionData.promptParts`: a strict record over the engine's part ids (prompt-parts-store.ts). */
export const trendPromptPartsSchema = z.strictObject(
  Object.fromEntries(CAST_SWAP_PROMPT_PART_IDS.map((id) => [id, overrideSchema.optional()])),
) as unknown as z.ZodType<TrendPromptPartOverrides>

export const trendVersionDataSchema: z.ZodType<TrendVersionData> = z
  .strictObject({
    name: localizedText(200),
    description: localizedText(2000).optional(),
    source: z
      .strictObject({
        videoUrl: httpUrl,
        durationSec: z.number().min(4).max(30),
        width: z.int().positive().optional(),
        height: z.int().positive().optional(),
        // The re-encoded copy can run a frame past the source's 30 s: any length.
        display: z
          .strictObject({
            videoUrl: httpUrl,
            posterUrl: httpUrl,
            width: z.int().positive(),
            height: z.int().positive(),
            durationSec: z.number().positive(),
          })
          .optional(),
      })
      .nullable(),
    previewStart: z.number().min(0).nullable(),
    slots: z.array(trendSlotSchema),
    references: z.array(trendReferenceSchema).max(5),
    trendPrompt: z.string().max(TREND_PROMPT_LIMITS.trendPromptMax).optional(),
    prePrompt: z.string().max(TREND_PROMPT_LIMITS.prePromptMax).optional(),
    // The 4 s preview's own versions (prompt-parts.ts), held to the same limits.
    previewTrendPrompt: z.string().max(TREND_PROMPT_LIMITS.trendPromptMax).optional(),
    previewPrePrompt: z.string().max(TREND_PROMPT_LIMITS.prePromptMax).optional(),
    faceMasking: faceMaskingWithMarksSchema.optional(),
    faceMask: trendFaceMaskSchema.optional(),
    faceMaskJob: trendFaceMaskJobSchema.optional(),
    upscaleJobs: z.array(trendUpscaleJobSchema).max(MAX_UPSCALE_JOBS).optional(),
    sourceCrop: trendSourceCropSchema.optional(),
    promptParts: trendPromptPartsSchema.optional(),
    // Absent = the clip preparation's default (prompt-style.ts); stored as given.
    promptStyle: z.enum(CAST_SWAP_PROMPT_STYLES).optional(),
    // Absent = Seedance 2.5 (`engineOf`). Stored as given: a version that
    // names none is kept without the key, so re-saving an old draft is no change.
    // Nodaro Motion's public ids are taken too and stored as the internal id
    // they name (`castSwapEngineFrom`), the vocabulary every stored version uses.
    engine: z
      .enum(CAST_SWAP_ENGINE_IDS_ACCEPTED)
      .transform((id): CastSwapEngine => castSwapEngineFrom(id)!)
      .optional(),
    // Absent = "cut-end". Read only on a Kling 4 trend.
    klingLength: z.enum(CAST_SWAP_KLING_LENGTHS).optional(),
    examples: z.array(trendExampleSchema),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<string>()
    d.slots.forEach((s, i) => {
      if (seen.has(s.key)) ctx.addIssue({ code: "custom", path: ["slots", i, "key"], message: `Duplicate slot key "${s.key}".` })
      seen.add(s.key)
    })

    for (const kind of Object.keys(SLOT_CAPS) as TrendSlotKind[]) {
      const n = d.slots.filter((s) => s.kind === kind).length
      if (n > SLOT_CAPS[kind]) ctx.addIssue({ code: "custom", path: ["slots"], message: `At most ${SLOT_CAPS[kind]} ${kind} slots.` })
    }

    if (d.source?.display && d.source.display.videoUrl === d.source.videoUrl) {
      ctx.addIssue({ code: "custom", path: ["source", "display", "videoUrl"], message: "The display copy must be its own file, never the uploaded clip." })
    }

    if (d.source && d.previewStart !== null && d.previewStart + PREVIEW_SECONDS > d.source.durationSec) {
      ctx.addIssue({ code: "custom", path: ["previewStart"], message: `The ${PREVIEW_SECONDS} s preview must fit inside the source clip.` })
    }

    d.examples.forEach((ex, i) => {
      for (const key of Object.keys(ex.slots)) {
        if (!seen.has(key)) ctx.addIssue({ code: "custom", path: ["examples", i, "slots", key], message: `Example ${i + 1} names an unknown slot "${key}".` })
      }
    })

    // A slot mark (decided 2026-10-27) names an OPTIONAL PERSON slot of this very version: a slot made
    // required, deleted, made another kind or renamed is refused while it still has marks (never dropped).
    ;(d.faceMasking?.marks ?? []).forEach((mark, i) => {
      const key = faceMaskMarkSlot(mark)
      if (key === null) return
      const slot = d.slots.find((s) => s.key === key)
      if (slot && slot.kind === "person" && !slot.required) return
      const why = !slot ? "names no slot of this trend" : slot.kind !== "person" ? "names a slot that is not a person" : "names a required person"
      ctx.addIssue({
        code: "custom",
        path: ["faceMasking", "marks", i, "label"],
        message: `Face mask box ${i + 1} ${why} ("${key}"): face marks belong to optional people only. Remove that person's face marks first.`,
      })
    })

    if (maxImagesOf(d) > MAX_TREND_IMAGES) {
      ctx.addIssue({ code: "custom", path: [], message: `At most ${MAX_TREND_IMAGES} images.` })
    }
  })

// A run names chips by key; which chips a slot takes depends on its kind, so
// that check needs the trend (see `misplacedChip`).
const trendRunSlotSchema = z.strictObject({
  images: z.array(httpUrl).min(1).max(MAX_IMAGES_PER_SLOT).optional(),
  body: choice.optional(),
  outfit: choice.optional(),
  hair: choice.optional(),
  coat: choice.optional(),
  shape: choice.optional(),
  finish: choice.optional(),
})

export const trendRunRequestSchema: z.ZodType<TrendRunRequest> = z
  .object({
    slots: slotRecord(z.record(runSlotKeySchema, trendRunSlotSchema)),
    example: z.int().min(1).optional(),
    details: z.string().max(TREND_PROMPT_LIMITS.detailsMax).optional(),
    preview: z.boolean().optional(),
    resolution: z.enum(["480p", "720p", "1080p"]).optional(),
    draft: z.boolean().optional(),
    sessionId: z.string().min(1).max(200).optional(),
    projectId: z.string().min(1).max(200).optional(),
    previewJobId: z.string().regex(UUID_RE, "previewJobId must be a job id (uuid).").optional(),
  })
// `draft: true` above 480p is refused by the composition, which knows the trend's
// engine: Seedance 2.5 answers `validation_error` (draft is 480p only), Kling 4
// `draft_unsupported` (it has no draft at all).

/**
 * The first chip in a run request that the slot's kind does not take (a
 * `coat` on a person, any chip on a location), or null. Slot keys the trend
 * does not have are left to the caller (an unknown-slot error).
 */
export function misplacedChip(
  req: Pick<TrendRunRequest, "slots">,
  data: Pick<TrendVersionData, "slots">,
): { slot: string; chip: string } | null {
  for (const slot of data.slots) {
    const entry = Object.hasOwn(req.slots, slot.key) ? req.slots[slot.key] : undefined
    if (!entry) continue
    const allowed: readonly string[] = CHIPS_BY_KIND[slot.kind]
    for (const [k, v] of Object.entries(entry)) {
      if (k !== "images" && v !== undefined && !allowed.includes(k)) return { slot: slot.key, chip: k }
    }
  }
  return null
}

/**
 * The chips a slot shows to the person, in its kind's order: its `chips`, or
 * every chip of its kind when it has none listed. A location shows none.
 */
export function shownChips(slot: Pick<TrendSlot, "kind" | "chips">): ChipKey[] {
  const kindChips: readonly ChipKey[] = CHIPS_BY_KIND[slot.kind]
  if (!slot.chips) return [...kindChips]
  const listed: readonly string[] = slot.chips
  return kindChips.filter((c) => listed.includes(c))
}

/**
 * The first chip in a run request that the trend's slot takes but hides from
 * the person (it is fixed at the slot's value), or null. A chip that is not
 * the kind's own is `misplacedChip`'s.
 */
export function hiddenChip(
  req: Pick<TrendRunRequest, "slots">,
  data: Pick<TrendVersionData, "slots">,
): { slot: string; chip: ChipKey } | null {
  for (const slot of data.slots) {
    const entry = Object.hasOwn(req.slots, slot.key) ? req.slots[slot.key] : undefined
    if (!entry) continue
    const shownList = shownChips(slot)
    for (const chip of CHIPS_BY_KIND[slot.kind] as readonly ChipKey[]) {
      if (entry[chip] !== undefined && !shownList.includes(chip)) return { slot: slot.key, chip }
    }
  }
  return null
}
