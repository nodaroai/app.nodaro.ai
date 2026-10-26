/**
 * A trend run → the Cast Swap engine body (pure; no I/O).
 *
 * The public and admin run routes call this with the trend version a run uses
 * (published for users, the draft for admin test runs) and the user's
 * validated request (`trendRunRequestSchema`). It returns:
 *
 * - `body`: what the engine reads — the hidden source clip, roles named by
 *   their hidden `roleName`, the fixed references, the trend prompt, and the
 *   trend's pre prompt and face masking (top-level fields; the engine refuses
 *   either inside `display`);
 * - `display`: the public record of the run (English labels, the user's own
 *   pictures, the example's pictures for empty optional slots — none on a
 *   trend with no example, whose empty optional slots stay as in the
 *   original — the chips and the user's raw details), also carried in
 *   `body.trendRun.display`;
 * - `needs`: what the engine must support for this run.
 *
 * HIDDEN data (source, roleName, references, trendPrompt, prePrompt,
 * faceMasking, and their 4 s preview versions) goes only into the engine's
 * own fields, never into `display`.
 *
 * A preview run (`preview: true`) sends the trend's preview prompt parts —
 * each slot's `previewRoleName`, each reference's `previewLine`, the
 * `previewPrePrompt` and `previewTrendPrompt` — each falling back to the full
 * run's text when it has none (`withPromptsFor`, prompt-parts.ts). A full run
 * sends the full run's texts only, a full run that follows a preview too.
 *
 * A masked trend whose approved face mask was made from these exact settings
 * (`storedFaceMaskFor`, face-mask.ts) also sends `storedFaceMask: { url,
 * frames }`: the engine cuts and pads that masked clip like the source and
 * masks nothing per run. Out of date or absent, the key is left out and the
 * run masks per run. (An engine that does not take it gets the body without
 * it: `withoutUnsupportedStoredMask`, run-helpers.ts.)
 *
 * A trend whose face masking has marks (`faceMasking.marks`) runs only on
 * that approved mask: without one made from these settings the run is refused
 * (`face_mask_required`). The marks themselves are never sent.
 *
 * Masking off (absent, or `mode: "off"`) sends no `faceMasking` key at all, so
 * the body is exactly what it was before trends had masking. Likewise the
 * engine: a Seedance 2.5 trend (the default) sends no `engine` key; a Kling 4
 * trend sends `engine: "kling-4"` (and its `klingLength` when it sets one), renders 720p unless 1080p is asked, and
 * refuses a draft (`draft_unsupported`) and 480p (`resolution_unsupported`).
 */
import {
  CAST_SWAP_ENGINE_WHEN_OMITTED,
  CAST_SWAP_KLING_MAX_IMAGES,
  CAST_SWAP_POST_PROMPT_MAX,
  CAST_SWAP_RESOLUTIONS_BY_ENGINE,
  castSwapEngineHasDraft,
} from "@nodaro/shared/models"
import { castSwapImagesSent } from "@nodaro/render-rules"
import {
  faceMaskTargetOf,
  faceMaskingOn,
  withResolvedZone,
  withoutMarks,
  type FaceMasking,
  type FaceMaskingTarget,
} from "../../../lib/cast-swap-face-masking.js"
import { CHIPS_BY_KIND, engineOf, hiddenChip, misplacedChip, shownChips, type ChipKey } from "./schemas.js"
import { pickText } from "./localize.js"
import { faceMaskHasMarks, storedFaceMaskFor } from "./face-mask.js"
import { withPromptsFor } from "./prompt-parts.js"
import type {
  CastSwapEngine,
  CastSwapKlingLength,
  Choice,
  TrendReference,
  TrendResolution,
  TrendRunRequest,
  TrendRunSlot,
  TrendSlot,
  TrendSlotKind,
  TrendVersionData,
} from "./types.js"

export type TrendRunErrorCode =
  | "missing_slot"
  | "unknown_slot"
  | "invalid_choice"
  | "chip_not_offered"
  | "example_out_of_range"
  | "preview_unavailable"
  | "invalid_slot_mention"
  | "source_missing"
  | "prompt_too_long"
  | "draft_unsupported"
  | "resolution_unsupported"
  | "too_many_images"
  | "face_mask_required"
  | "validation_error"

export class TrendRunError extends Error {
  constructor(
    readonly code: TrendRunErrorCode,
    message: string,
    readonly slot?: string,
    /** The chip, for `chip_not_offered`. */
    readonly chip?: string,
  ) {
    super(message)
    this.name = "TrendRunError"
  }
}

type Chips = { body?: Choice; outfit?: Choice; hair?: Choice; coat?: Choice; shape?: Choice; finish?: Choice }

export interface TrendRunDisplaySlot extends Chips {
  key: string
  /** English. */
  label: string
  kind: TrendSlotKind
  images: string[]
  /**
   * True when the slot was left empty and the example's pictures filled it.
   * False with no pictures: left empty on a trend with no example, so it
   * stays as in the original.
   */
  fromExample: boolean
}

export interface TrendRunDisplay {
  trend: { id: string; slug: string; version: number; /** English. */ name: string }
  /** 1-based example used for empty optional slots; 0 = the trend had no example (none was used). */
  example: number
  slots: TrendRunDisplaySlot[]
  /** The user's own details, as sent (`{slot:<key>}` mentions unmapped). */
  details?: string
}

export interface TrendRunBody {
  videoUrl: string
  roles: unknown[]
  references: TrendReference[]
  prePrompt?: string
  postPrompt?: string
  faceMasking?: FaceMasking
  /**
   * The trend's approved face mask, while it matches the masking sent (never
   * without `faceMasking`). `required: true` (a trend with marks): the engine
   * fails the run rather than masking per run (`castSwap.storedFaceMaskRequired`).
   */
  storedFaceMask?: { url: string; frames: number; required?: true }
  /** Only for an engine other than Seedance 2.5 (which a body without it runs on). */
  engine?: CastSwapEngine
  /** Only on Kling 4, and only when the trend sets it (absent = "cut-end"). */
  klingLength?: CastSwapKlingLength
  preview: boolean
  previewStart: number
  resolution: TrendResolution
  draft: boolean
  trendRun: { display: TrendRunDisplay }
}

export interface ComposedTrendRun {
  body: TrendRunBody
  display: TrendRunDisplay
  needs: {
    roleKinds: Set<TrendSlotKind>
    fixedReferences: boolean
    faceMasking: boolean
    /** What the masks cover (left out = the head), or null when the trend does not mask. */
    faceMaskTarget: FaceMaskingTarget | null
    /**
     * The run must carry its stored face mask (the trend has marks): an engine
     * that takes none would mask per run and cover the faces the marks leave
     * out, so it is refused rather than sent the body without it.
     */
    storedFaceMask: boolean
    trendPrePrompt: boolean
    /** The trend's video engine (Seedance 2.5 when it names none). */
    engine: CastSwapEngine
  }
  /**
   * The trend's masking leaves `zone` out, so `body.faceMasking.zone` is the
   * default margins. A full run that follows a masked preview then takes the
   * zone the preview ran with instead (`followPreviewMasking`). Never sent.
   */
  maskingZoneLeftOut: boolean
}

/**
 * The Cast Swap engine's `postPrompt` cap (the cast-swap plugin's input
 * schema: `postPrompt: z.string().max(4000)`; the number is
 * `@nodaro/shared`'s). The trend prompt, a blank line and the user's details
 * share it. New versions are held to a 2998-character trend prompt so the
 * details (≤ 1000) always fit: prompt-budget.ts has the numbers, publishing
 * refuses a longer one (publish-check.ts) and the admin screen holds Save.
 * Versions published before that may still carry up to 3000, so a run can
 * still pass the cap: composeTrendRun refuses it (`prompt_too_long`) before
 * the engine would.
 */
export { CAST_SWAP_POST_PROMPT_MAX }

const SLOT_MENTION_RE = /\{slot:([^}]*)\}/g

function entryOf(req: TrendRunRequest, key: string): TrendRunSlot | undefined {
  return Object.hasOwn(req.slots, key) ? req.slots[key] : undefined
}

/**
 * The slot kind's chips: a chip the request may set (shown to the person, or
 * any chip on an admin test run) is the request's, else the slot's default,
 * else "new"; a chip hidden from the person is fixed at the default, else "new".
 */
function chipsOf(slot: TrendSlot, entry: TrendRunSlot | undefined, allowHiddenChips: boolean): Chips {
  const defaults = (slot.defaults ?? {}) as Chips
  const shown: readonly ChipKey[] = shownChips(slot)
  const out: Chips = {}
  for (const chip of CHIPS_BY_KIND[slot.kind]) {
    const settable = allowHiddenChips || shown.includes(chip)
    out[chip] = (settable ? entry?.[chip] : undefined) ?? defaults[chip] ?? "new"
  }
  return out
}

export interface ComposeOptions {
  /**
   * The admin's test run: every chip of the slot's kind may be set, including
   * the ones the trend hides from people, so each variant can be tried before
   * choosing what to show. Off (the default) for everyone else: a chip the
   * slot hides is refused (`chip_not_offered`).
   */
  allowHiddenChips?: boolean
}

export function composeTrendRun(
  trend: { id: string; slug: string; version: number; data: TrendVersionData },
  req: TrendRunRequest,
  options: ComposeOptions = {},
): ComposedTrendRun {
  const allowHiddenChips = options.allowHiddenChips === true
  const { data } = trend
  // The prompt texts this run sends: a preview's own where it has them, else the full run's.
  const texts = withPromptsFor(data, req.preview === true ? "preview" : "full")

  if (!data.source) throw new TrendRunError("source_missing", "This trend has no source clip yet.")

  const slotKeys = new Set(data.slots.map((s) => s.key))
  for (const key of Object.keys(req.slots)) {
    if (!slotKeys.has(key)) throw new TrendRunError("unknown_slot", `This trend has no slot "${key}".`, key)
  }

  const misplaced = misplacedChip(req, data)
  if (misplaced) {
    throw new TrendRunError("invalid_choice", `Slot "${misplaced.slot}" does not take "${misplaced.chip}".`, misplaced.slot)
  }

  if (!allowHiddenChips) {
    const hidden = hiddenChip(req, data)
    if (hidden) {
      throw new TrendRunError(
        "chip_not_offered",
        `Slot "${hidden.slot}" does not offer the "${hidden.chip}" chip: this trend fixes it.`,
        hidden.slot,
        hidden.chip,
      )
    }
  }

  // A trend may have no example (only its original). Leaving `example` out
  // then means "no example": an empty optional slot is sent with no pictures,
  // so the original's person stays (the engine keeps a role with none as in
  // the clip), and the run records example 0. With examples, an empty
  // optional slot takes the chosen example's pictures (Example 1 by default).
  const noExample = req.example === undefined && data.examples.length === 0
  const example = noExample ? 0 : (req.example ?? 1)
  const exampleInRange = Number.isInteger(example) && example >= 1 && example <= data.examples.length
  // An explicit example must exist, on a trend with none too.
  if (req.example !== undefined && !exampleInRange) {
    throw new TrendRunError("example_out_of_range", `This trend has no example ${req.example}.`)
  }

  const slots: TrendRunDisplaySlot[] = []
  const roles: unknown[] = []
  for (const slot of texts.slots) {
    const entry = entryOf(req, slot.key)
    const own = entry?.images ?? []
    let images: string[]
    let fromExample = false
    if (own.length > 0) {
      images = [...own]
    } else if (slot.required) {
      throw new TrendRunError("missing_slot", `"${pickText(slot.label, "en")}" needs a picture.`, slot.key)
    } else if (noExample) {
      images = []
    } else {
      // Unreachable today (an out-of-range example is refused above, and no example is `noExample`):
      // kept so the index below can never read past `examples`.
      if (!exampleInRange) throw new TrendRunError("example_out_of_range", `This trend has no example ${example}.`)
      const fill = data.examples[example - 1]!.slots
      const picked = Object.hasOwn(fill, slot.key) ? fill[slot.key] : undefined
      if (!picked || picked.length === 0) {
        throw new TrendRunError("missing_slot", `"${pickText(slot.label, "en")}" needs a picture.`, slot.key)
      }
      images = [...picked]
      fromExample = true
    }

    const chips = chipsOf(slot, entry, allowHiddenChips)
    roles.push({ kind: slot.kind, name: slot.roleName, images, ...chips })
    slots.push({ key: slot.key, label: pickText(slot.label, "en")!, kind: slot.kind, images: [...images], fromExample, ...chips })
  }

  if (req.preview && data.previewStart === null) {
    throw new TrendRunError("preview_unavailable", "This trend has no preview.")
  }

  const details = req.details ?? ""
  const mapped = details.replace(SLOT_MENTION_RE, (_m, key: string) => {
    const i = data.slots.findIndex((s) => s.key === key)
    if (i < 0) throw new TrendRunError("invalid_slot_mention", `Details mention an unknown slot "${key}".`, key)
    return `{role:${i + 1}}`
  })
  const postPrompt = [texts.trendPrompt, mapped].filter(Boolean).join("\n\n")
  if (postPrompt.length > CAST_SWAP_POST_PROMPT_MAX) {
    throw new TrendRunError(
      "prompt_too_long",
      `The trend prompt and details come to ${postPrompt.length} characters; the most is ${CAST_SWAP_POST_PROMPT_MAX}.`,
    )
  }

  // The run's masking never carries the marks: they shape the STORED mask only (face-mask.ts).
  const masking = faceMaskingOn(data.faceMasking) ? withoutMarks(data.faceMasking) : undefined
  const stored = masking ? storedFaceMaskFor(data) : undefined
  // A trend with marks runs on its approved mask, made with them, and nothing else: masking per
  // run would mask the faces the marks leave out (decided 2026-10-26).
  if (faceMaskHasMarks(data) && !stored) {
    throw new TrendRunError("face_mask_required", "This trend leaves some faces unmasked: make and approve its face mask first.")
  }
  const engine = engineOf(data)
  const offered: readonly TrendResolution[] = CAST_SWAP_RESOLUTIONS_BY_ENGINE[engine]
  if (req.draft === true && !castSwapEngineHasDraft(engine)) {
    throw new TrendRunError("draft_unsupported", "This trend has no draft: run it at 720p or 1080p.")
  }
  if (req.draft === true && req.resolution !== undefined && req.resolution !== "480p") {
    throw new TrendRunError("validation_error", "Draft is only available at 480p.")
  }
  if (req.resolution !== undefined && !offered.includes(req.resolution)) {
    throw new TrendRunError("resolution_unsupported", `This trend runs at ${offered.join(" or ")}, not ${req.resolution}.`)
  }
  if (engine === "kling-4") {
    // What the run sends, as the route counts it: a trend run prepares its references (the
    // default), so a person, pet or product counts one picture; a location its own; the references theirs.
    const images = castSwapImagesSent(
      slots.map((s) => ({ kind: s.kind, images: s.images.length })),
      data.references.reduce((n, r) => n + r.images.length, 0),
    )
    if (images > CAST_SWAP_KLING_MAX_IMAGES) {
      throw new TrendRunError(
        "too_many_images",
        // No count: it would tell how many hidden reference pictures the trend has.
        `This trend's model takes at most ${CAST_SWAP_KLING_MAX_IMAGES} pictures in one run: use fewer pictures per slot.`,
      )
    }
  }
  // The engine's default resolution comes first: Seedance's 480p draft, Kling's 720p.
  const resolution: TrendResolution = req.resolution ?? offered[0]!
  const draft = castSwapEngineHasDraft(engine) && resolution === "480p" && (req.draft ?? true)

  const display: TrendRunDisplay = {
    trend: { id: trend.id, slug: trend.slug, version: trend.version, name: pickText(data.name, "en")! },
    example,
    slots,
    ...(details ? { details } : {}),
  }

  const body: TrendRunBody = {
    videoUrl: data.source.videoUrl,
    roles,
    references: texts.references.map((r) => ({ images: [...r.images], line: r.line })),
    ...(texts.prePrompt ? { prePrompt: texts.prePrompt } : {}),
    ...(postPrompt ? { postPrompt } : {}),
    // The zone resolved here (left out = the default margins), so the estimate and the run send
    // the margins the trend means. A run that follows its masked preview takes the preview's
    // zone instead when the trend leaves it out (`maskingZoneLeftOut`, followPreviewMasking).
    ...(masking ? { faceMasking: withResolvedZone(structuredClone(masking)) } : {}),
    // A trend with marks: the run must use it — the engine fails rather than masks per run.
    ...(stored ? { storedFaceMask: faceMaskHasMarks(data) ? { ...stored, required: true as const } : stored } : {}),
    ...(engine !== CAST_SWAP_ENGINE_WHEN_OMITTED ? { engine } : {}),
    // Kling 4's length fit, as the trend sets it (Seedance never gets it).
    ...(engine === "kling-4" && data.klingLength ? { klingLength: data.klingLength } : {}),
    preview: req.preview ?? false,
    previewStart: data.previewStart ?? 0,
    resolution,
    draft,
    trendRun: { display },
  }

  return {
    body,
    display,
    needs: {
      roleKinds: new Set(data.slots.map((s) => s.kind)),
      fixedReferences: data.references.length > 0,
      faceMasking: masking !== undefined,
      faceMaskTarget: masking ? faceMaskTargetOf(masking) : null,
      storedFaceMask: faceMaskHasMarks(data),
      trendPrePrompt: !!texts.prePrompt,
      engine,
    },
    maskingZoneLeftOut: masking !== undefined && masking.zone === undefined,
  }
}
