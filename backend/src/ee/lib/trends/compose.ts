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
 *   trend with no example, or for a slot the example has no pictures for,
 *   which then stays as in the original — the chips and the user's raw
 *   details), also carried in
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
 * A trend whose face masking has `"erased"` marks (`faceMasking.marks`) runs
 * only on that approved mask: without one made from these settings the run
 * is refused (`face_mask_required`). The marks themselves are never sent.
 *
 * Per-person variants (decided 2026-10-27, face-mask-variants.ts): a run that
 * leaves optional people with slot marks empty (on a trend with no examples,
 * or ones the chosen example has no pictures for)
 * is sent the variant made for exactly those people (`storedFaceMask` with
 * `required: true`), so the people kept as in the clip keep their faces; a
 * variant that left nothing to cover sends no `faceMasking` and no
 * `storedFaceMask` (unmasked). No such variant, or one out of date: refused
 * (`face_mask_required`). A run that leaves no marked person empty is sent
 * exactly what it was before slot marks existed.
 *
 * A trend that prepares its clip in a depth mode (`faceMasking.source`
 * `"full-depth"` or `"keep-people"`) runs on its approved stored clip only
 * (`storedFaceMask` with `required: true`; none made from these settings:
 * `face_mask_required`), and is sent `faceMasking` as that mode reads it
 * (`faceMaskingSent`: full depth, `{ mode, source }`; keep people, all but the
 * fill, its target named). Per-person variants are a face mask's alone.
 *
 * A trend with prompt part overrides (`promptParts`, prompt-parts-store.ts)
 * sends their texts as `promptParts`; one with none sends no such key.
 *
 * Every run sends its prompt style resolved (`promptStyle`, prompt-style.ts:
 * left out = its clip preparation's default), and a full-depth run its scene
 * source resolved (`faceMasking.scene`, `faceMaskingRunSent`). Both are
 * dropped for an engine that does not declare them
 * (`withoutUnsupportedPromptStyle`, run-helpers.ts), so such an engine gets
 * exactly the body it got before.
 *
 * A full-depth run whose scene is a description, on a trend whose stored clip
 * carries the make's description (scene-description.ts), sends it as
 * `sceneDescription` with the source window it covers
 * (`sceneDescriptionWindow`): a preview run the preview's text, a full run the
 * whole clip's. Without one the keys are left out (the engine describes the
 * clip per run, as before). A run that sends one names each role as the
 * stored text does, by its full `roleName`, a preview included: one name per
 * run (`sceneRoleNames`, applied by `withoutUnsupportedSceneDescription`,
 * run-helpers.ts, once the description is known to stay).
 *
 * An empty optional slot on a FULL DEPTH trend (`faceMasking.source`
 * `"full-depth"`) is never filled from an example (an example can look nothing
 * like the original): it takes the slot's `defaultImages` when it has them
 * (`fromDefault: true` on the display slot), else it is sent with no pictures,
 * so the engine keeps that role as in the clip. The run records `example: 0`
 * (none was used); an explicit `example` must still exist. Every other clip
 * preparation fills an empty optional slot from the example as before, and its
 * display slots carry no `fromDefault` key.
 *
 * Masking off (absent, or `mode: "off"`) sends no `faceMasking` key at all, so
 * the body is exactly what it was before trends had masking. Likewise the
 * engine: a Seedance 2.5 trend (the default) sends no `engine` key; a Kling 4
 * trend sends `engine: "kling-4"` (and its `klingLength` when it sets one), renders 720p unless 1080p is asked, and
 * refuses a draft (`draft_unsupported`) and 480p (`resolution_unsupported`).
 * A Kling 4 trend that delivers Kling's own audio sends `pulseAudio: "generated"`
 * (the original audio, the default, sends no key); dropped for an engine that
 * does not declare it (`withoutUnsupportedPulseAudio`, run-helpers.ts).
 * A Prism trend whose reference video carries only the voice, or no audio, at
 * some output resolution sends `prismReferenceAudio` as those resolutions'
 * modes (`{ "720p": "none" }`; the full audio everywhere, the default, sends no
 * key); shaped for the loaded engine — the object, the run's own resolution's
 * mode, or nothing — by `withoutUnsupportedPrismReferenceAudio`
 * (run-helpers.ts).
 *
 * Every run names what it edits (`sourceAsset`, provenance the engine stamps
 * on the job): the whole source clip (`kind: "full"`, its length and, once
 * recorded, its SHA-256). A preview run of a version whose preview INPUT CLIP
 * is current (`currentPreviewClip`, preview-clip.ts) also carries that clip
 * as a CANDIDATE (`preparedPreview: { clip }`, beside the body, never in it):
 * the body itself still sends the whole source and `previewStart` as today,
 * and only `withPreparedPreview` (run-helpers.ts) — on an engine that
 * declares `castSwap.preparedPreview` — swaps the clip in (with its own cut of
 * the stored face mask) and names it as the run's `sourceAsset`. No candidate
 * when the run is sent a per-person variant of the mask (face-mask-variants.ts):
 * the clip carries a cut of the base mask only.
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
  faceMaskingRunSent,
  faceMaskingSourceOf,
  withoutMarks,
  type FaceMasking,
  type FaceMaskingSource,
  type FaceMaskingTarget,
} from "../../../lib/cast-swap-face-masking.js"
import { CHIPS_BY_KIND, engineOf, hiddenChip, misplacedChip, shownChips, type ChipKey } from "./schemas.js"
import { pickText } from "./localize.js"
import { faceMaskHasErasedMarks, faceMaskStoredRequired, storedFaceMaskFor } from "./face-mask.js"
import { faceMaskVariantFor, markedPeople } from "./face-mask-variants.js"
import { currentPreviewClip } from "./preview-clip.js"
import { withPromptsFor } from "./prompt-parts.js"
import { promptPartTexts } from "./prompt-parts-store.js"
import { promptStyleOf } from "./prompt-style.js"
import { storedSceneDescriptionFor, type SceneDescriptionWindow } from "./scene-description.js"
import type { CastSwapPromptStyle } from "@nodaro/render-rules"
import type { PromptPartTexts } from "../../../lib/cast-swap-prompt-parts-contract.js"
import {
  prismReferenceAudioByResolutionOf,
  prismReferenceAudioNotFull,
  type CastSwapPrismReferenceAudioSent,
} from "../../../lib/cast-swap-prism-reference-audio.js"
import { originalCdnImageUrls } from "../../../lib/cdn-original-url.js"
import type {
  CastSwapEngine,
  CastSwapKlingLength,
  Choice,
  TrendPreviewClip,
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
   * False with no pictures: left empty on a trend with no example, or the
   * chosen example has no pictures for it, so it stays as in the original.
   */
  fromExample: boolean
  /**
   * Present (true) only when the slot was left empty on a Full depth trend
   * and its default pictures filled it (`fromExample` is then false). Absent
   * otherwise, so a run of any other trend records exactly what it did before.
   */
  fromDefault?: true
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
  /**
   * Only on Kling 4, and only when the trend delivers Kling's own audio
   * (absent = the original audio). Dropped for an engine that does not
   * declare it (`withoutUnsupportedPulseAudio`, run-helpers.ts).
   */
  pulseAudio?: "generated"
  /**
   * Only on Prism, and only when the trend's reference video carries the
   * voice alone or no audio at some output resolution (absent = the full
   * audio). Composed as the object of those resolutions; turned into what the
   * loaded engine takes — the object, the run's own resolution's mode, or
   * nothing — by `withoutUnsupportedPrismReferenceAudio` (run-helpers.ts).
   */
  prismReferenceAudio?: CastSwapPrismReferenceAudioSent
  /**
   * The trend's prompt part overrides, text only (`{ [part]: text }`; `"-"`
   * removes a part), only when it has some. Dropped for an engine that does
   * not take them (`withoutUnsupportedPromptParts`, run-helpers.ts).
   */
  promptParts?: PromptPartTexts
  /**
   * The trend's prompt style, resolved. Dropped for an engine that does not
   * declare it (`withoutUnsupportedPromptStyle`, run-helpers.ts).
   */
  promptStyle?: CastSwapPromptStyle
  /**
   * Full depth with its scene from a description: the trend's stored
   * description (scene-description.ts) — a preview run's of the 4 s window,
   * a full run's of the whole clip — which the engine rewrites for the new
   * cast and window. Only with `sceneDescriptionWindow`; dropped, both, for
   * an engine that does not declare `castSwap.storedSceneDescription`
   * (`withoutUnsupportedSceneDescription`, run-helpers.ts).
   */
  sceneDescription?: string
  /** The window of the SOURCE clip `sceneDescription` covers (seconds). */
  sceneDescriptionWindow?: SceneDescriptionWindow
  preview: boolean
  previewStart: number
  resolution: TrendResolution
  draft: boolean
  /**
   * `videoUrl` IS the preview's prepared input clip (the 4 s window, cut
   * ahead of time), so the engine edits it as it is: `preview` true and
   * `previewStart` 0. Set only by `withPreparedPreview` (run-helpers.ts), for
   * an engine that declares `castSwap.preparedPreview`; never composed here.
   */
  preparedPreview?: boolean
  /**
   * What the run edits, for the job's record (the engine stamps it on the job
   * as it is): the whole source clip (`kind: "full"`, with its length and,
   * once recorded, its SHA-256) or the preview's prepared input clip
   * (`kind: "preview"`, its hash, where it was cut from, its length and the
   * cut's recipe). Dropped for an engine that does not declare
   * `castSwap.preparedPreview` (`withPreparedPreview`), so such an engine gets
   * exactly the body it got before.
   */
  sourceAsset?: TrendRunSourceAsset
  trendRun: { display: TrendRunDisplay }
}

/** A run's `sourceAsset`: which input it edits (provenance only, visible on the job). */
export interface TrendRunSourceAsset {
  kind: "preview" | "full"
  /** SHA-256 (hex) of the file; absent on a source clip stored before hashes were recorded. */
  sha256?: string
  /** Where the preview clip was cut from in the source (s). */
  startSec?: number
  durationSec?: number
  /** The preview clip's cut recipe (`PREVIEW_CLIP_RECIPE`). */
  recipe?: string
}

export interface ComposedTrendRun {
  body: TrendRunBody
  display: TrendRunDisplay
  /**
   * A preview run's prepared input clip, when the version has a current one
   * (`currentPreviewClip`) and the run's stored face mask, if any, is the
   * base mask the clip was cut with (never a per-person variant). A candidate
   * only: `withPreparedPreview` (run-helpers.ts) puts it on the wire for an
   * engine that declares `castSwap.preparedPreview`, and leaves the body as
   * today for one that does not. Never sent as such.
   */
  preparedPreview?: { clip: TrendPreviewClip }
  needs: {
    roleKinds: Set<TrendSlotKind>
    fixedReferences: boolean
    faceMasking: boolean
    /** What the masks cover (left out = the head; keep people, the whole person), or null when the trend does not mask, or masks no one (full depth). */
    faceMaskTarget: FaceMaskingTarget | null
    /** How the clip is prepared (`"faces"` when it names none), or null when the trend does not mask. */
    faceMaskSource: FaceMaskingSource | null
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
  /**
   * Each role's name as the stored scene description names it (each slot's
   * full `roleName`, in `body.roles` order), when the body carries one
   * (`sceneDescription`). A run sends one name per role: while the
   * description stays on the wire, a preview run's roles are sent these
   * names, never their `previewRoleName`, so the engine finds each role of
   * the stored text by the name it is sent (`withoutUnsupportedSceneDescription`,
   * run-helpers.ts, decides once the description is known to stay). Never sent.
   */
  sceneRoleNames?: string[]
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
  // optional slot takes the chosen example's pictures (Example 1 by default),
  // or none (kept as in the clip) when that example has none for it.
  const noExample = req.example === undefined && data.examples.length === 0
  const requested = noExample ? 0 : (req.example ?? 1)
  const exampleInRange = Number.isInteger(requested) && requested >= 1 && requested <= data.examples.length
  // An explicit example must exist, on a trend with none too (and on a Full depth trend, which uses none).
  if (req.example !== undefined && !exampleInRange) {
    throw new TrendRunError("example_out_of_range", `This trend has no example ${req.example}.`)
  }
  // Full depth never fills an empty slot from an example (an example can look nothing like the
  // original): its default pictures, else none (kept as in the clip). So it records example 0.
  const fullDepth = faceMaskingOn(data.faceMasking) && faceMaskingSourceOf(data.faceMasking) === "full-depth"
  const example = fullDepth ? 0 : requested

  const slots: TrendRunDisplaySlot[] = []
  const roles: unknown[] = []
  for (const slot of texts.slots) {
    const entry = entryOf(req, slot.key)
    const own = entry?.images ?? []
    let images: string[]
    let fromExample = false
    let fromDefault = false
    if (own.length > 0) {
      images = [...own]
    } else if (slot.required) {
      throw new TrendRunError("missing_slot", `"${pickText(slot.label, "en")}" needs a picture.`, slot.key)
    } else if (fullDepth) {
      images = [...(slot.defaultImages ?? [])]
      fromDefault = images.length > 0
    } else if (noExample) {
      images = []
    } else {
      // Unreachable today (an out-of-range example is refused above, and no example is `noExample`):
      // kept so the index below can never read past `examples`.
      if (!exampleInRange) throw new TrendRunError("example_out_of_range", `This trend has no example ${example}.`)
      const fill = data.examples[example - 1]!.slots
      const picked = Object.hasOwn(fill, slot.key) ? fill[slot.key] : undefined
      // An example may have no pictures for an optional slot: the slot is then sent with none,
      // so the engine keeps that role as in the clip (as on a trend with no example).
      images = picked ? [...picked] : []
      fromExample = images.length > 0
    }

    // The original files, never a CDN display rendition a client showed (lib/cdn-original-url.ts):
    // whether the picture came from the person, the slot's defaults or an example.
    images = originalCdnImageUrls(images)

    const chips = chipsOf(slot, entry, allowHiddenChips)
    roles.push({ kind: slot.kind, name: slot.roleName, images, ...chips })
    slots.push({
      key: slot.key,
      label: pickText(slot.label, "en")!,
      kind: slot.kind,
      images: [...images],
      fromExample,
      // Only when a default filled it: every other run's record keeps exactly its old keys.
      ...(fromDefault ? { fromDefault: true as const } : {}),
      ...chips,
    })
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
  // A trend with erased marks runs on its approved mask, made with them, and nothing else: masking per
  // run would mask the faces the marks leave out (decided 2026-10-26). A depth mode's clip likewise:
  // it is made once and approved, never per run.
  if (faceMaskStoredRequired(data) && !stored) {
    throw new TrendRunError(
      "face_mask_required",
      faceMaskHasErasedMarks(data)
        ? "This trend leaves some faces unmasked: make and approve its face mask first."
        : "This trend prepares its clip ahead of time: make and approve it first.",
    )
  }
  // The marked optional people this run leaves empty (with examples, only those the chosen example
  // has no pictures for). Each one stays as in the clip, so the run is sent the variant
  // made for exactly them, never the mask that covers their faces (decided 2026-10-27).
  const marked = new Set(markedPeople(data))
  const emptyPeople = slots.filter((s) => s.images.length === 0 && marked.has(s.key)).map((s) => s.key)
  const variant = emptyPeople.length > 0 && stored ? faceMaskVariantFor(data, emptyPeople) : undefined
  if (emptyPeople.length > 0 && !variant) {
    throw new TrendRunError("face_mask_required", "This trend keeps some people as in the clip: make its person masks first.")
  }
  // The variant left nothing to cover: the run goes unmasked (no masking, no stored mask).
  const unmasked = variant === "unmasked"
  const runMasking = unmasked ? undefined : masking
  const storedFaceMask =
    variant && variant !== "unmasked"
      ? { ...variant, required: true as const }
      : variant === undefined && stored
        ? faceMaskStoredRequired(data) ? { ...stored, required: true as const } : stored
        : undefined
  // A preview's prepared input clip (preview-clip.ts), as a candidate for `withPreparedPreview`:
  // only with a current clip, and never beside a per-person variant (the clip carries a cut of
  // the BASE mask alone); a run that sends the base mask needs the clip's cut of it.
  const variantSent = variant !== undefined && variant !== "unmasked"
  const clip = req.preview === true && !variantSent ? currentPreviewClip(data) : undefined
  const preparedPreview = clip && (!storedFaceMask || clip.faceMask) ? { clip } : undefined
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

  const parts = promptPartTexts(data.promptParts)
  const prismAudio = prismReferenceAudioNotFull(prismReferenceAudioByResolutionOf(data.prismReferenceAudio))
  // The stored description belongs to the stored clip: sent only beside it (a full-depth run always is).
  const scene = storedFaceMask ? storedSceneDescriptionFor(data, runMasking, req.preview === true) : undefined

  const display: TrendRunDisplay = {
    trend: { id: trend.id, slug: trend.slug, version: trend.version, name: pickText(data.name, "en")! },
    example,
    slots,
    ...(details ? { details } : {}),
  }

  const body: TrendRunBody = {
    videoUrl: data.source.videoUrl,
    roles,
    references: texts.references.map((r) => ({ images: originalCdnImageUrls(r.images), line: r.line })),
    ...(texts.prePrompt ? { prePrompt: texts.prePrompt } : {}),
    ...(postPrompt ? { postPrompt } : {}),
    // The zone resolved here (left out = the default margins), so the estimate and the run send
    // the margins the trend means. A run that follows its masked preview takes the preview's
    // zone instead when the trend leaves it out (`maskingZoneLeftOut`, followPreviewMasking).
    // A depth mode is sent what it reads (`faceMaskingRunSent`: full depth with its scene, resolved);
    // faces exactly as before modes existed.
    ...(runMasking ? { faceMasking: faceMaskingRunSent(structuredClone(runMasking)) } : {}),
    // A trend with erased marks, or a person variant: the run must use it — the engine fails rather
    // than masks per run.
    ...(storedFaceMask ? { storedFaceMask } : {}),
    ...(engine !== CAST_SWAP_ENGINE_WHEN_OMITTED ? { engine } : {}),
    // Kling 4's length fit, as the trend sets it (Seedance never gets it).
    ...(engine === "kling-4" && data.klingLength ? { klingLength: data.klingLength } : {}),
    // Kling 4's own audio, when the trend asks for it (the original audio sends no key).
    ...(engine === "kling-4" && data.pulseAudio === "generated" ? { pulseAudio: "generated" as const } : {}),
    // Prism's reference audio, per output resolution, where the trend asks for the voice alone or none
    // (the full audio everywhere sends no key). A plain mode stored earlier reads as every resolution.
    ...(engine === "seedance-2-5" && prismAudio ? { prismReferenceAudio: prismAudio } : {}),
    // The admin's overrides of the engine's prompt parts, the texts only (the hashes are the editor's).
    ...(parts ? { promptParts: parts } : {}),
    promptStyle: promptStyleOf(data),
    ...(scene ?? {}),
    preview: req.preview ?? false,
    previewStart: data.previewStart ?? 0,
    resolution,
    draft,
    // What the run edits: the whole source (a prepared preview swaps the clip in, run-helpers.ts).
    sourceAsset: {
      kind: "full",
      ...(data.source.sha256 ? { sha256: data.source.sha256 } : {}),
      durationSec: data.source.durationSec,
    },
    trendRun: { display },
  }

  return {
    body,
    display,
    ...(preparedPreview ? { preparedPreview } : {}),
    needs: {
      roleKinds: new Set(data.slots.map((s) => s.kind)),
      fixedReferences: data.references.length > 0,
      faceMasking: runMasking !== undefined,
      faceMaskTarget: runMasking ? faceMaskTargetOf(runMasking) : null,
      faceMaskSource: runMasking ? faceMaskingSourceOf(runMasking) : null,
      storedFaceMask: storedFaceMask !== undefined && "required" in storedFaceMask,
      trendPrePrompt: !!texts.prePrompt,
      engine,
    },
    // Full depth reads no zone at all.
    maskingZoneLeftOut: runMasking !== undefined && runMasking.zone === undefined && faceMaskingSourceOf(runMasking) !== "full-depth",
    // The names the stored text uses (sceneMakeFields' roleName): applied only if the description stays on the wire.
    ...(scene ? { sceneRoleNames: data.slots.map((s) => s.roleName) } : {}),
  }
}
