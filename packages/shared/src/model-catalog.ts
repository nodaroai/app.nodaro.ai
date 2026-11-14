/**
 * Model catalog — single source of truth for what each Nodaro-exposed model
 * is, who made it, what it's good for, and which knobs it accepts.
 *
 * Consumed by:
 * - Backend MCP `list_models` tool (renders the nested per-kind / per-family
 *   response so Claude can pick the right model for a user's intent)
 * - (future) Frontend config panels — today they read parallel registries
 *   in `frontend/src/components/editor/config-panels/model-options.ts`; a
 *   follow-up will migrate them to import from here.
 *
 * Authoring rules:
 * - Keep `description` to one line (≤120 chars). It's what Claude reads to
 *   decide which model to use.
 * - `useCases` is a small set of short tags (1-3 words) — verbs/nouns Claude
 *   can match against user intent ("typography", "character", "fast",
 *   "cinematic"). Stay consistent across entries: don't write "text" in one
 *   and "typography" in another.
 * - `aspectRatios` / `resolutions` / `qualities` only appear when the model
 *   actually exposes that lever (e.g., Nano Banana base has no `resolution`).
 * - `durations` is in seconds.
 * - `pricing[0]` is ALWAYS the default variant (the bare id without a
 *   composite suffix like `:4K` or `:high`).
 * - Costs are sourced from `STATIC_CREDIT_COSTS` (see backend
 *   `src/billing/credits.ts`). Keep them in sync if the table changes.
 * - After editing `MODEL_CATALOG` or `MODEL_RECOMMENDATIONS`, run
 *   `npm run gen:skills` (from `backend/`) to refresh the public
 *   `docs/choosing-models.md` guide. CI (`gen:skills:check`) fails on drift.
 */

import { isSeedanceDraftCapable, SEEDANCE_DRAFT_RESOLUTION } from "./seedance-draft.js"
import { isFlux2Model } from "./flux2-pricing.js"
import { MINIMAX_H3_IMAGE_DEFAULT_RESOLUTION, MINIMAX_H3_IMAGE_RESOLUTIONS } from "./minimax-h3-image.js"
import { isAutoVideoDuration } from "./video-duration-auto.js"
import type { DeclaredSeedanceTaskType } from "./seedance-task-type.js"
import { SEEDREAM_5_5_DEFAULT_RESOLUTION, SEEDREAM_5_5_RESOLUTIONS } from "./seedream-5-5.js"
import { FLUX_3_KLEIN_RESOLUTIONS } from "./flux-3-klein.js"
import {
  GEMINI_3_1_DEFAULT_VOICE,
  GEMINI_3_1_TTS_ACCENTS,
  GEMINI_3_1_TTS_PACES,
  GEMINI_3_1_TTS_STYLES,
  GEMINI_3_1_TTS_VOICES,
  GEMINI_3_8_DEFAULT_VOICE,
  GEMINI_3_8_TONE_TAGS,
  GEMINI_3_8_TTS_VOICES,
  GEMINI_TTS_MAX_CHARS,
  TTS_DIRECTION_MAX_CHARS,
  type TtsNamedVoice,
} from "./gemini-tts.js"

export type ModelKind = "image" | "video" | "audio"

export type ModelMode =
  // image
  | "t2i"
  | "i2i"
  | "edit"
  | "upscale"
  | "remove-bg"
  // video
  | "i2v"
  | "t2v"
  | "v2v"
  | "extend"
  | "motion-transfer"
  | "lip-sync"
  | "video-upscale"
  | "video-depth"
  // audio
  | "tts"
  | "music"
  | "sfx"
  | "stt"
  | "voice-design"
  | "voice-changer"
  | "isolation"
  | "dubbing"
  | "forced-alignment"
  // dialogue — deliberately its own mode, never "tts": the dialogue model
  // takes a multi-speaker script shape (inputs[]), not the single-text
  // generate_speech contract, so it must never appear in a TTS model list.
  | "dialogue"
  // video analysis
  | "video-analysis"
  // video audit — deliberately its own mode, never "video-analysis": the
  // video-audit node has no model picker (see model-tree.ts's MODE_TO_NODE,
  // which has no entry for this mode on purpose), so its catalog rows exist
  // for pricing/MCP-discovery only and must never leak into the
  // video-analysis node's model picker.
  | "video-audit"

export interface PriceVariant {
  /**
   * Composite identifier as it appears in `STATIC_CREDIT_COSTS` — or, for a
   * model a run is charged a multiple of a rate for, the whole-run quote id of
   * one run (`<rateId>:<units>u`, `unitQuoteCreditId`): its rate's row × the
   * units, rounded up once, as the price table and `GET
   * /v1/credits/model-cost` price it (Seedance 2.5 Extend lists its default
   * run this way). `credits` is then that run's list price.
   */
  identifier: string
  /** The catalog's list price in credits. `GET /v1/models` and the MCP
   *  `list_models` tool serve the price a run is charged on the instance,
   *  which may differ. */
  credits: number
  /** Short human-readable note describing this variant ("1K default", "4K", "with audio"). */
  note?: string
}

/**
 * The note on every speech model's `<model>:per-100-chars` pricing row. The
 * row is a rate: one started 100 characters of the text sent, at least 8 units
 * per request (`credit-estimators/speech.ts`). A request's total is rounded
 * once, so its units × the listed figure is an upper bound of what it costs;
 * the exact price of N units is the `<model>:per-100-chars:<N>u` id. An
 * instance serves the row only while it prices speech by length; a client that
 * does not see it quotes the flat row. (The ids are literals on the entries — this file cannot import
 * the speech estimator without a cycle through tts-capabilities.ts; the
 * pricing-coverage tests pin each literal to `speechUnitCreditId(id)`.)
 */
export const SPEECH_UNIT_PRICE_NOTE = "per started 100 characters, at least 8 units — where length pricing is on; a request costs at most its units × this"

/**
 * The note on a speech model's `<model>:per-1k-chars` row (`TtsCapabilities.ratePer1kChars`):
 * the same count as {@link SPEECH_UNIT_PRICE_NOTE} — started 100 characters, at
 * least 8 units — quoted per 1,000, so a request costs its hundreds × this ÷ 10,
 * rounded up once (the exact price of N hundreds is the `<model>:per-100-chars:<N>u` id).
 */
export const SPEECH_PER_1K_PRICE_NOTE = "per 1,000 characters, counted in started 100s, at least 800 — where length pricing is on; a request costs its hundreds × this ÷ 10, rounded up"

/** A voice-setting lever a speech model honours. */
export type TtsSettingLever = "stability" | "similarity" | "style" | "speed" | "speakerBoost"

/**
 * What a speech model (text-to-speech or dialogue) accepts. The ONE source for
 * every "does this model do X" decision — tag stripping, which voice settings
 * are sent and shown, the language picker, the per-request character cap. Never
 * compare a provider id by hand; read the sheet through the helpers in
 * `tts-capabilities.ts` (the text-to-speech lane) or `dialogue-capabilities.ts`
 * (the dialogue lane). Each lane's helpers answer only for its own models.
 */
export interface TtsCapabilities {
  /** Inline `[audio tags]` are performed. false ⇒ strip them before sending (the model reads them aloud). */
  audioTags: boolean
  /** SSML `<break time="…"/>` tags are honoured. */
  ssmlBreaks: boolean
  /** Voice settings the model honours. A lever not listed is never sent and never shown. */
  levers: readonly TtsSettingLever[]
  /**
   * The stability values THIS PLATFORM accepts for the model, when it offers
   * steps instead of a 0–1 range (ascending). Absent ⇒ any value from 0 to 1.
   * A product choice, not a vendor limit: ElevenLabs takes other values too on
   * some models; the steps are what our routes validate and our pickers offer.
   */
  stabilitySteps?: readonly number[]
  /** The request may carry a language code. false ⇒ the field is omitted. */
  languageCode: boolean
  /**
   * The model answers the `/with-timestamps` form of its endpoint with
   * character timings (and, for dialogue, per-line `voice_segments`). When true
   * the platform ALWAYS renders dialogue through it and the job output carries a
   * `transcript` (decided 2026-10-06); when false the plain endpoint is used
   * and the request is byte-identical to before the field existed.
   */
  timestamps: boolean
  /**
   * The model conditions a request on the text spoken before and after it
   * (`previous_text` / `next_text`), for continuous intonation across clips
   * produced separately. false ⇒ the fields are never sent: a model that does
   * not take them rejects the request (eleven_v3: 400), which would fail a paid
   * job. Values from live calls, never assumed (phase 6 plan, Task 0).
   */
  stitching: boolean
  /**
   * Per-request character cap (the total across lines for a dialogue model).
   * `getMaxTtsChars` reads it by exact id and answers {@link TTS_TEXT_MAX}'s 5,000 for
   * the legacy alias and for ids with no sheet, while the sheet lookups answer
   * with the cap of the model such a request actually runs as (turbo's 40,000).
   */
  maxChars: number
  /** Languages offered in pickers (ISO 639-1; `fil` has no two-letter code). A curated list, not the vendor's full one. */
  languages: readonly string[]
  /**
   * The model speaks only these named voices, by wire name: a request's
   * `voice` must be one of them (else a 400 before any hold), and none means
   * `defaultVoice`. Absent ⇒ the ElevenLabs voices (premade, library, clones).
   * A client offers this list in place of the ElevenLabs voice browser.
   */
  voices?: readonly TtsNamedVoice[]
  /** With `voices`: the voice a request that names none runs with. */
  defaultVoice?: string
  /**
   * With `audioTags`: the tags are written `<in angle brackets>`, from the
   * closed list `tags`. The platform's `[square]` tags are rewritten to them
   * where they match and the rest are taken out before sending
   * (`@nodaro/prompts` `toAngleTags`). Absent ⇒ `[square]` tags, sent as written.
   */
  tagSyntax?: "angle"
  /** With `tagSyntax: "angle"`: the tags the model performs, by their own names (`laugh`, `short pause`). */
  tags?: readonly string[]
  /**
   * Style direction the model takes beside the text — never spoken, never
   * billed. Absent ⇒ none (the request's direction fields are not sent).
   */
  direction?: TtsDirectionSheet
  /**
   * Dialogue lane only: at most this many speakers (distinct voices) in one
   * script. Absent ⇒ the lane's own limit (ElevenLabs dialogue: 10).
   */
  dialogueSpeakers?: number
  /**
   * Dialogue lane only: the model can add natural filler words ("um", "you
   * know") between two speakers when asked (`fillerWords` on a request).
   */
  fillerWords?: true
  /**
   * Dialogue lane only: the model delivers every speech file format
   * (`TTS_OUTPUT_FORMATS`) — it renders a WAV the platform keeps as it is or
   * encodes to MP3. Absent ⇒ the default MP3 only (the ElevenLabs dialogue
   * endpoint, as the platform calls it).
   */
  dialogueAnyOutputFormat?: true
  /**
   * The model clones a speaker's voice for one request from two recordings
   * (`replica`: a reference and a consent recording, `TtsReplica`), in place of
   * a named voice; nothing is saved as a voice. Gemini 3.8 Flash only: KIE's
   * 3.8 Flash-Lite refuses it ("Inline voice sample replication is not
   * supported", probed 2026-11-13).
   */
  replica?: true
  /**
   * The model's length-price row is quoted per 1,000 characters
   * (`<id>:per-1k-chars`) instead of per started 100 (`<id>:per-100-chars`).
   * The count is the same — started 100 characters, at least 8 — and a
   * request costs its hundreds × the row ÷ 10, rounded up once
   * (`speechRowCredits`). For a rate below one credit per 100 characters,
   * which a whole-credit row cannot hold.
   */
  ratePer1kChars?: true
}

/**
 * The style direction a speech model takes (`styleDirection`, `pace`,
 * `accent`, `audioProfile` on a request). A field the sheet does not name is
 * never sent.
 */
export interface TtsDirectionSheet {
  /** `styleDirection` is free text — tone, emotion, pace in the person's own words — up to this many characters. */
  styleMaxChars?: number
  /** `styleDirection` is one of these (the model's own names). */
  styles?: readonly string[]
  /** `pace` is one of these. */
  paces?: readonly string[]
  /** `accent` is one of these. */
  accents?: readonly string[]
  /** `audioProfile` (who is speaking, in words) is free text up to this many characters. */
  audioProfileMaxChars?: number
}

/**
 * The companies that make the catalog's models: ONE id per company, and the id
 * is a public fact (the company's name, lowercased and hyphenated). Part of the
 * `GET /v1/models` wire contract (`maker: { id, name }`), and the key a
 * deployment publishes a maker's mark under (`logoUrl`), so an id never changes
 * once shipped — a client may key its own assets on it.
 *
 * `maker` is not `family`: the family is the grouping label clients filter on,
 * and a few name a lab, a product line or a cloud brand rather than the company
 * (Tongyi-MAI and HappyHorse are Alibaba's, Depth Anything and Volcengine are
 * ByteDance's, InfiniTalk is Meituan's). Every model of one family has one
 * maker (`model-makers.test.ts`), and every maker here makes at least one model.
 */
export const MODEL_MAKERS = {
  alibaba: { name: "Alibaba" },
  "black-forest-labs": { name: "Black Forest Labs" },
  bytedance: { name: "ByteDance" },
  elevenlabs: { name: "ElevenLabs" },
  google: { name: "Google" },
  heygen: { name: "HeyGen" },
  ideogram: { name: "Ideogram" },
  kuaishou: { name: "Kuaishou" },
  lightricks: { name: "Lightricks" },
  luma: { name: "Luma AI" },
  meituan: { name: "Meituan" },
  minimax: { name: "MiniMax" },
  nodaro: { name: "Nodaro" },
  nvidia: { name: "NVIDIA" },
  openai: { name: "OpenAI" },
  pixverse: { name: "PixVerse" },
  recraft: { name: "Recraft" },
  runway: { name: "Runway" },
  shengshu: { name: "ShengShu" },
  suno: { name: "Suno" },
  "sync-labs": { name: "Sync Labs" },
  "topaz-labs": { name: "Topaz Labs" },
  xai: { name: "xAI" },
} as const satisfies Readonly<Record<string, { readonly name: string }>>

/** A company id from {@link MODEL_MAKERS}. */
export type ModelMakerId = keyof typeof MODEL_MAKERS

/** A model's maker as `GET /v1/models` serves it: the stable id and the company's name. */
export interface ModelMaker {
  id: ModelMakerId
  name: string
}

/** True for an id of {@link MODEL_MAKERS} (and nothing it inherits). */
export function isModelMakerId(value: unknown): value is ModelMakerId {
  return typeof value === "string" && Object.hasOwn(MODEL_MAKERS, value)
}

/**
 * The maker of a catalog entry, in its wire shape — undefined for a model
 * offered under the deployment's own label (`ownLabel`, which names none —
 * even an entry built at run time, or by a JavaScript caller, that also names a
 * maker) and when its `maker` is not a registry id (an entry built at run time
 * without one). Never throws, so one bad entry cannot fail a whole model
 * listing.
 */
export function modelMakerOf(entry: Pick<ModelCatalogEntry, "maker" | "ownLabel">): ModelMaker | undefined {
  if (entry.ownLabel === true) return undefined
  return isModelMakerId(entry.maker) ? { id: entry.maker, name: MODEL_MAKERS[entry.maker].name } : undefined
}

/** Every field of a catalog entry but who it is offered under (`maker` / `ownLabel`, {@link ModelCatalogEntry}). */
export interface ModelCatalogEntryFields {
  id: string
  kind: ModelKind
  /**
   * Operations this model supports. Many video models (minimax, veo3,
   * seedance) support BOTH i2v AND t2v under the same id — the route handler
   * picks which KIE endpoint to hit based on whether an image was supplied.
   * For those, list both modes here so MCP filters and frontend pickers see
   * the model in either context.
   */
  modes: readonly ModelMode[]
  /** Vendor / lab that produced the model. Used for UI grouping. */
  family: string
  /** Display name (NOT the id — the id is the API enum value). */
  label: string
  /**
   * Model LINE for the add-node Models tab — the brand-agnostic product line a
   * user thinks in ("Nano Banana", "Flux", "VEO", "Kling", "ElevenLabs").
   * Distinct from `family` (the lab: Google covers Nano Banana + Imagen + VEO).
   * REQUIRED on every entry, so every model can be filtered by its line. The
   * Models tab lists only node-creatable models (`buildModelTree`), so a
   * series on an entry with no node (AI Audit) never shows up there.
   */
  series: string
  /**
   * The value written into the creating node's data field when this model is
   * picked from the Models tab, for models whose catalog id differs from the
   * stored value. Only `suno-generate` diverges today (id `suno-v5` → `data.model`
   * "V5"). Omit when the id IS the stored value (the common case).
   */
  dataValue?: string
  /** One-liner. Visible to Claude in MCP `list_models` output. */
  description: string
  /** Short tags Claude matches against user intent. */
  useCases: readonly string[]
  /**
   * Capabilities flags: "reference-image", "end-frame", "audio", etc.
   *
   * `"video-reference"` (video models only) means the model accepts a
   * reference VIDEO as a CONDITIONING clip — the r2v transport that
   * `resolveSeedance2Inputs` builds and that KIE receives as
   * `reference_video_urls`. It is what generate-video-pro's `extend` render
   * method needs (a continuation tail off the previous segment), and
   * `GVP_EXTEND_PROVIDERS` derives from it.
   *
   * It is deliberately NOT set on `gemini-omni-video`: that model's
   * `video_list` input is a V2V SOURCE clip with a trim window, an
   * auto-determined duration and flat per-generation pricing (see
   * `runGeminiOmni` in `backend/src/providers/kie/video.ts`) — a different
   * transport, not a continuation reference.
    *
   * `"reference-to-video"` (video models only) means the model's provider
   * endpoint RUNS FROM REFERENCE IMAGES ALONE — no start frame. Declared only
   * where the provider's own contract accepts a call with reference images and
   * no frame (KIE spec evidence per model). It is what lets a references-only
   * run reach a model on every surface (editor gate, browser DAG, orchestrator,
   * API): `resolveVideoModeForInputs` routes such a run to the image-to-video
   * lane for a model with no text-to-video mode, instead of the text-to-video
   * lane, whose "image required" gate would refuse it. Requires
   * `"reference-image"` (guarded by `video-reference-only.test.ts`).
   *
   * `"keyframes"` (video models only) means the model's Image References are
   * IN-BETWEEN FRAMES, in order, between the start and end frame — not loose
   * references (Kling 4.0 Keyframes: KIE `keyframe_urls`). The editor names the
   * tray and the mode after it, and generate-video-pro leaves such a model out
   * (its segments would send cast references as frames).
   *
   * `"character-subjects"` (video models only) means a wired Character node
   * reaches the model as a NAMED SUBJECT built from several of its images
   * (`characterReferencesFromWired` → `characterReferences`), not only as a
   * reference image (Kling 4.0: KIE `elements`, `@Name` in the prompt).
   *
   * `"voice-references"` (video models only) means the model takes each
   * reference AUDIO clip as a VOICE sample — who speaks and how they sound —
   * and makes its own soundtrack, rather than conditioning on the audio itself
   * (Kling 4.0: KIE `voices`, `@VoiceN` in the prompt; Kling 4.0 Flash: each
   * clip is a wired character's voice, KIE `elements[].voice_url` — see
   * `audioBindsToCharacters`). The editor names that input "Voice Refs" for
   * such a model.
   *
   * `"audio-soundtrack"` (video models only) means the platform can play the
   * model's FIRST reference audio clip as the result's soundtrack: it sends
   * that clip as a reference video (a still frame carrying the audio) with the
   * video's own sound kept, so the scene is performed to the exact track (see
   * `audio-soundtrack.ts`). On unless a run sets `audioSoundtrack: false`.
   *
   * `"audio-to-video"` (video models only) means ONE reference audio clip
   * drives the generation — the picture is made to that audio (LTX 2.3 Pro's
   * `audio_to_video` task). The node's Audio Refs input then takes one clip.
   */
  features?: readonly string[]
  /**
   * How this video model's provider addresses its images in the prompt, by
   * array order — the syntax its frame / identity binding sentences are written
   * in (`videoProviderReferenceSyntax`). Absent ⇒ the platform's `@image_N`.
   * Declared only where the provider documents its own form: Grok Imagine's
   * `@image(n)` (docs.kie.ai/market/grok-imagine/image-to-video) and
   * HappyHorse's `[Image N]` (docs.kie.ai/market/happyhorse-1-1/reference-to-video).
   * Gemini Omni Flash 1.2 documents none and is written plain `image N`, the
   * form of KIE's own example; beside references its frames only guide the
   * clip, in either wording.
   */
  referenceSyntax?: "@image(n)" | "[Image N]" | "image N"
  aspectRatios?: readonly string[]
  /**
   * The model lists "auto", but its own auto does not keep the photo's shape
   * (GPT Image 2.6 renders a portrait square). "auto" with a photo is then
   * resolved as on a model without a native auto: to the listed ratio nearest
   * the photo (`autoAspectNeedsSourceImage`, `normalizeModelInput`). With no
   * photo, or one whose size cannot be read, the model's own "auto" is sent,
   * as before. "auto" stays in `aspectRatios`, so every menu still offers it.
   */
  autoAspectFromSourceImage?: true
  /**
   * The provider's endpoint refuses an aspect ratio this model does not list.
   * Set only when that was read from the provider's own schema: a ratio field
   * marked required, with a closed list (Seedream 5.5: text to image requires
   * one of its eight ratios and has no "auto"; its edit takes "auto" and the
   * same eight; docs.kie.ai/market/seedream/5-5-text-to-image.md and
   * 5-5-image-to-image.md). FLUX 3 Klein's schemas give the same evidence: a
   * closed list of nine ratios on text to image, with no "auto", and the same
   * nine plus "auto" on the edit (docs.kie.ai/market/flux3/klein-text-to-image.md
   * and klein-edit-image.md). The lanes that pass a stored ratio straight on (a
   * Scene, a surround continuation) move a ratio such a model does not list to
   * the nearest one it does, checked against the model the request reaches
   * (`aspectRatioForStrictModel` in the backend), and send every other model's
   * ratio exactly as stored.
   *
   * A ratio missing from `aspectRatios` is NOT evidence the provider refuses
   * it. Measured 2026-11-11: the provider rendered 21:9 (1916×821) and 4:5
   * (1122×1402) for GPT Image 2, whose list names neither. Do not set this flag
   * from a catalog list alone, and do not snap those lanes for every model.
   */
  strictAspectRatios?: true
  /**
   * The pixel size (width, height) this model renders at each aspect ratio and
   * size, from the provider's own table, for a PNG, JPEG or WebP. Read where a
   * run's size is chosen from its photo's size (`maskEditMatchesSource`).
   */
  outputSizes?: Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>>
  /**
   * A masked edit on this model follows its photo: the result is pasted back
   * onto the photo at the photo's own size, so the run keeps the photo's shape
   * ("auto", whatever ratio it names) and renders at the size of `outputSizes`
   * whose long side is nearest the photo's, priced at that size
   * (`normalizeModelInput` with `context.masked`; `resolutionNearestSource`).
   * With the photo's size unknown, the size asked is kept.
   */
  maskEditMatchesSource?: true
  resolutions?: readonly string[]
  /**
   * The aspect ratios at which this model renders fewer sizes than
   * `resolutions`: each one names the sizes it renders, in the catalog's own
   * spelling. A ratio not listed renders every entry of `resolutions`.
   * `normalizeModelInput` moves a size such a ratio does not render to the
   * largest one it does at or below it, and says so, before the run is priced;
   * a menu reads the sizes on offer with `resolutionsAtAspectRatio`.
   */
  resolutionsByAspectRatio?: Readonly<Record<string, readonly string[]>>
  /** The resolution a caller who names none lands on when it is not the
   *  cheapest entry (see `defaultResolutionFor`). */
  defaultResolution?: string
  /**
   * What this model actually RENDERS for a resolution outside `resolutions`.
   *
   * Most providers honour whatever band they are sent, so an off-list value is
   * best snapped to the NEAREST supported one — a 4k request on a 1080p-max
   * model renders 1080p. A few instead COLLAPSE anything unrecognised to a
   * fixed default (MiniMax H3 → 2K, Wan 3.0 → 720p), and for those the nearest
   * band is the wrong answer in the most expensive direction: snapping a stale
   * "720p" to H3's cheap 768P would send a value the provider ignores, so we
   * would bill the 768P tier against a 2K render, and `commit_credits` never
   * collects the shortfall.
   *
   * Declare it in the catalog's own spelling. `normalizeVideoRequestParams`
   * uses it in place of the nearest-band snap; `video-collapse-parity.test.ts`
   * pins each declaration to what the provider normalizer actually returns, so
   * the two cannot drift.
   */
  unlistedResolutionRendersAs?: string
  /**
   * The resolutions (catalog spelling) at which this video model takes a start
   * frame ONLY: no end frame, no loop and no in-between frames beside it. A run
   * that would send any of them at such a resolution is refused before any
   * credits are held, with one sentence (`videoStartFrameOnlyProblem`), on the
   * API routes, the workflow run and the editor's Run; the editor offers the
   * resolution only while nothing but a start frame is wired. Declared from the
   * provider's own refusal, never guessed.
   */
  startFrameOnlyResolutions?: readonly string[]
  qualities?: readonly string[]
  /**
   * The quality a run renders at when none is named, where that is not the
   * first listed. A value the model does not take snaps to it, as does a panel.
   */
  defaultQuality?: string
  /**
   * The image background settings this model takes (`auto`, `opaque`,
   * `transparent`). Absent: no such setting, and a value sent is dropped.
   */
  backgrounds?: readonly string[]
  /**
   * The one resolution a transparent background renders at, where the provider
   * limits it. `normalizeModelInput` moves the size there and says so.
   */
  transparentResolution?: string
  /**
   * The provider takes the background setting, whatever its value, only at
   * `transparentResolution`. Above it nothing is sent.
   */
  backgroundOnlyAtTransparentResolution?: true
  /**
   * The files this image model can write (`png`, `jpeg`, `webp`, `gif`, `svg`),
   * the first being what it writes when none is named. Absent: a single format,
   * not a setting, and a value sent is dropped. With `gif` the aspect ratio and
   * size do not apply (a GIF is square, `IMAGE_GIF_FRAME_SIZE` a frame), and a
   * transparent background is only kept with `png` and `webp`
   * (`TRANSPARENT_OUTPUT_FORMATS`); `normalizeModelInput` says what it moved.
   */
  outputFormats?: readonly string[]
  /**
   * How many frames a GIF of this model can have: a whole number from `min` to
   * `max`, or one of `values` when the provider takes only some. Read only when
   * `outputFormats` lists `gif`.
   */
  gifFrames?: { readonly min: number; readonly max: number; readonly default: number; readonly values?: readonly number[] }
  /** How long each frame of a GIF shows, in ms: `min` to `max` in steps of `step`. */
  gifFrameDurationMs?: { readonly min: number; readonly max: number; readonly step: number; readonly default: number }
  /** The levels of detail an SVG of this model is drawn at (`standard`, `detailed`, `max`), the first the default. Read only when `outputFormats` lists `svg`. */
  svgLevels?: readonly string[]
  durations?: readonly number[]
  /**
   * The length (seconds) this model renders when the request names no duration
   * — a capability fact, and the length an unset duration is CHARGED at
   * (`pricedOutputDurationSec`). A member of `durations`. REQUIRED on every
   * video model priced by length (`pricing-default-duration-sync.test.ts`), and
   * where the KIE config pins `extraParams.duration` it must equal that pin.
   */
  defaultDuration?: number
  /**
   * The model accepts an AUTO duration (`duration: -1`, see
   * `VIDEO_DURATION_AUTO`): it picks the clip length itself — the source clip's
   * length on a video edit, a length within `durations` otherwise. A capability,
   * not a member of `durations` (which stay real seconds). Runs are reserved at
   * the longest clip and settled on the delivered one.
   */
  autoDuration?: boolean
  /**
   * The reference task types this model accepts as a declaration (see
   * `SEEDANCE_REFERENCE_TASK_TYPES`): what the request's reference media is for
   * — a `reference`, an `edit` of the reference video, or an `extend` of it.
   * The list is what is honoured: `resolveSeedanceTaskType` declares only a
   * value listed here, and anything else runs as Auto. Absent or empty: the
   * model takes no such declaration and the provider guesses from the prompt.
   * `supportsReferenceTaskType` says whether the list is non-empty.
   */
  referenceTaskTypes?: readonly DeclaredSeedanceTaskType[]
  /**
   * The model takes NO seed: its provider schema has none, so a seed the
   * request carries is dropped before the provider call and repeat runs vary.
   * Absent means a seed is forwarded as usual. Read through
   * {@link modelTakesSeed} — the editor hides its Seed field off it and clears
   * a stale `data.seed` when the provider switches. Pinned to the KIE configs'
   * `omitSeed` in both directions by `seed-capability-parity.test.ts`.
   */
  noSeed?: boolean
  /**
   * Generate Video Pro may use this video model although it takes no reference
   * images (decided 2026-11-12, PixVerse V6 Max). The pro engine's bar is a
   * model that takes a start still AND reference images (it attaches identity
   * and continuity references to every segment), so a model without
   * `"reference-image"` is out unless it says so here. With it, each segment
   * runs from its start anchor or from text alone: the references a segment
   * carries are not sent, the "reference" anchor choice is not offered
   * (`gvpAnchorChoicesFor`, `@nodaro/render-rules`), and the run is keyframes only. Never set it on a
   * model that has `"reference-image"` (`gvp-supported-providers.test.ts`).
   */
  gvpWithoutReferences?: true
  pricing: readonly PriceVariant[]
  /** Editorial highlight — "best in tier". Surfaces in MCP output as a ⭐. */
  featured?: boolean
  /**
   * Per-model overrides for the global value label decorations (e.g. Hailuo
   * 2.3 Pro labels its 1080P resolution as "1080P (6s max)" because the
   * model caps long durations at lower resolution). Falls back to
   * `MODEL_VALUE_LABELS` for values not listed here.
   */
  valueLabels?: Record<string, string>
  /**
   * Hide from MCP `list_models` output and tool model enums. Used for legacy
   * model versions superseded by newer entries — they remain in the catalog
   * (and accessible via direct API / frontend pickers for back-compat) but
   * stop showing up in Claude.ai's model picker, which keeps the surface
   * tight and steers the agent to the current generation.
   *
   * Frontend pickers ignore this flag.
   */
  mcpHidden?: boolean
  /**
   * Left out of the public docs' model tables and the model lists in the MCP
   * tool descriptions, while a provider can't serve this model. Not an
   * availability switch: what hides a model from every menu and refuses a run
   * is the admin's `model_pricing.is_enabled` (backend lib/model-switch.ts).
   */
  docsHidden?: boolean
  /**
   * Never picked: the platform runs this model on its own, never because a
   * person or a client chose it (a trained character's model, which a Generate
   * Image run switches to when its one character has one). It is listed
   * nowhere a model is offered — `listModels` (so `GET /v1/models` and MCP
   * `list_models`), the editor's Models tab and add-node search
   * (`buildModelTree`), the MCP tool model enums (`modelIdsByKindMode`), the
   * docs' model tables and the recommendations — and is still a model a
   * deployment's restriction can name: it counts in the gateable model ids and
   * Admin → Availability shows it.
   */
  pickerHidden?: true
  /**
   * The provider's safety filter is known to be non-deterministic on this
   * model — the platform retries a blocked request once; `fallback` names
   * the catalog model to offer when it blocks again.
   */
  safetyFilter?: { stochastic: true; fallback?: string }
  /**
   * Capability sheet of a speech model. REQUIRED on every entry whose `modes`
   * include "tts" or "dialogue" — `tts-capabilities.test.ts` fails otherwise.
   */
  tts?: TtsCapabilities
}

/**
 * Who a model is offered under — exactly one of:
 *
 * - `maker`: the company that made it (see {@link MODEL_MAKERS}). Every model
 *   names one unless it is marked `ownLabel`, so a new model cannot ship
 *   without saying whose it is; every model of a `family` names the same maker.
 * - `ownLabel: true`: the model is offered under the deployment's own label and
 *   names no maker (decided 2026-11-11). `GET /v1/models` leaves `maker` out
 *   for it and returns `logoUrl: null`; MCP `list_models` leaves `maker` out (it
 *   never carries `logoUrl`); a client shows no maker. Such a model may not
 *   carry a `maker` (`model-makers.test.ts`).
 */
export type ModelCatalogEntry = ModelCatalogEntryFields & (
  | { maker: ModelMakerId; ownLabel?: never }
  | { ownLabel: true; maker?: never }
)

/**
 * Editorial recommendations — short "best for X" picks Claude can echo back
 * to the user when they don't know which model to use. Surfaces as a "Quick
 * recommendations" footer in MCP `list_models` output.
 */
export interface ModelRecommendation {
  intent: string
  modelIds: readonly string[]
  note: string
}

export const MODEL_RECOMMENDATIONS: readonly ModelRecommendation[] = [
  // image
  { intent: "best for typography / logos / text-heavy", modelIds: ["gpt-image-2", "gpt-image-2-6-flare"], note: "GPT Image 2 for exact copy, labels and non-Latin text; GPT Image 2.6 Flare for posters and layouts, and faster." },
  // Notes name the RANKING, not the price — the price sits in the generated
  // table directly below them and in `pricing`, so restating it here just
  // creates a copy that rots (this one said "1 credit" long after it was 2).
  { intent: "cheapest realistic image", modelIds: ["z-image", "qwen", "imagen4-fast"], note: "Z-Image is the cheapest. Qwen / Imagen4 Fast for slightly higher quality." },
  { intent: "highest fidelity image", modelIds: ["gpt-image-2", "gpt-image-2-6-sunburst", "imagen4-ultra"], note: "GPT Image 2 for characters and identity; GPT Image 2.6 Sunburst for wide or in-between ratios GPT Image 2 can't draw." },
  { intent: "image edit / restyle", modelIds: ["gpt-image-2-6-flare-i2i", "gpt-image-2-i2i", "seedream-5-pro-i2i"], note: "GPT Image 2.6 Flare changes what you ask and keeps the rest; GPT Image 2 i2i for identity-critical edits; Seedream 5 Pro for instruction-based edits." },
  { intent: "highest-resolution image", modelIds: ["topaz-image-upscale", "gpt-image-2", "gpt-image-2-6-sunburst"], note: "Generate at the model's top tier, then Topaz upscale 4x (Topaz's only lever is the 1x/2x/4x factor)." },
  { intent: "upscale an image with text, labels or logos", modelIds: ["nodaro-image-upscale"], note: "Keeps lettering exactly as written. 1x enhances at the same size; up to 8x. Priced by the output's size, so a small picture costs little." },
  { intent: "background removal / cutout", modelIds: ["recraft-remove-bg"], note: "Cheap, no prompt needed." },
  // video
  { intent: "best cinematic video", modelIds: ["veo3", "kling-3.0", "seedance-2"], note: "VEO 3.1 Quality for premium narrative; Kling 3.0 for music-synced motion; Seedance 2 for reference-driven consistency." },
  { intent: "cheap batch video clips", modelIds: ["veo3.1", "wan-turbo", "bytedance-lite"], note: "VEO 3.1 Fast is the best price/quality balance with native audio." },
  { intent: "video with start + end frame", modelIds: ["veo3", "veo3.1", "kling-turbo", "minimax", "hailuo-standard", "seedance-2"], note: "All listed support an end frame; VEO uses imageUrls[start, end]." },
  { intent: "music / song generation", modelIds: ["suno-v6", "suno-v6_wild", "suno-v6_mini", "suno-v5_5"], note: "V6 is the default flagship; V6 Wild for bolder, less predictable results; V6 Mini when speed matters; v5.5 / v5 / v4 keep their own character. Same price." },
  { intent: "voice over / narration", modelIds: ["elevenlabs-v4", "elevenlabs-v3", "elevenlabs-v4-turbo", "elevenlabs-turbo"], note: "v4 is the default: [audio tags] for emotion and up to 10,000 characters per request. v3 is the previous expressive model, still selectable. v4 Turbo keeps v4's tags at Turbo's credit price; Turbo v2.5 is the cheapest for plain narration without tags." },
  { intent: "low-cost narration with a named voice", modelIds: ["gemini-3-8-flash-lite-tts", "gemini-3-8-flash-tts", "gemini-3-1-flash-tts", "gemini-2-5-pro-tts"], note: "Google's Gemini voices cost far less per character than ElevenLabs. Each speaks only its own named voices (no clones or library voices) and no language is set: the text decides. 3.8 Flash-Lite is the cheapest; 3.8 Flash is the larger 3.8 model; both take their own tone tags (laugh, sigh, short pause…) and a free-text style. 3.1 Flash and 2.5 Pro take [audio tags] and a style, pace, accent and audio profile." },
  { intent: "lip-sync a portrait to audio", modelIds: ["kling-avatar-pro", "kling-avatar", "infinitalk"], note: "Pro for best mouth shape; InfiniTalk for resolution control." },
  { intent: "transcription / captions", modelIds: ["elevenlabs-stt", "incredibly-fast-whisper", "whisper", "nemotron-3-5-transcribe"], note: "Captions need WORD timestamps: ElevenLabs STT (always), Incredibly Fast Whisper or Nemotron 3.5 Transcribe (on request, with a speaker per word). Plain Whisper returns phrase segments only. To translate the speech (to or from English) instead of transcribing it, use Nemotron 3.5 Transcribe with a target language; a translation carries no word timings." },
  { intent: "motion transfer (drive a subject by another video)", modelIds: ["motion-transfer", "kling-3.0-motion"], note: "Kling 2.6 base is cheap; Kling 3.0 is premium." },
] as const

// =============================================================================
// Aspect ratio presets (mirrored from frontend's model-options.ts so backend
// can consume them. Keep in sync when adding a new ratio set.)
// =============================================================================
const NANO_BANANA_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9"] as const
// Nano Banana 2 Lite only — the model's full documented enum incl. `auto`
// (native default) and extreme banner ratios (docs.kie.ai/market/google/
// nano-banana-2-lite). Kept separate so the wider set can't leak to the
// rest of the family.
const NANO_BANANA_2_LITE_RATIOS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9", "4:1", "1:4", "8:1", "1:8"] as const
// Nano Banana 2.1 — its own documented enum, the same fifteen ratios as Lite
// (docs.kie.ai/market/google/nanobanana-2-1). Declared separately so a change to
// either model's set cannot silently move the other.
const NANO_BANANA_2_1_RATIOS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9", "4:1", "1:4", "8:1", "1:8"] as const
// Note: these arrays are synchronized with the frontend's
// `model-options.ts` constants of the same names. The frontend now imports
// them via the `getAspectRatioOptions(modelId)` helper; if you update one
// you no longer need to touch the other.
const FLUX_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const
const KONTEXT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9"] as const
const GROK_RATIOS = ["1:1", "16:9", "9:16", "3:2", "2:3"] as const
const GPT_IMAGE_RATIOS = ["1:1", "3:2", "2:3"] as const
// GPT Image 2 (text-to-image and image-to-image) renders every one of these
// ratios at 1K, 2K and 4K, "auto" and 1:1 included (checked 2026-11-10: 1:1 at
// 4K came back 2880x2880, "auto" at 2K 2048x2048, and an edit at "auto" and 2K
// kept a 768x1024 photo's shape at 1536x2048), so it declares no
// `resolutionsByAspectRatio`. The provider's docs limit 2K and 4K only at ratios
// it does not offer here (5:4, 4:5, 3:1, 1:3, 9:21).
const GPT_IMAGE_2_RATIOS = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4"] as const
// GPT Image 2.5 (Flare + Sunburst) widen the set to thirteen — the GPT Image 2
// six plus 3:2/2:3, ultra-wide 21:9/27:16, ultra-tall 16:27 and near-square
// 9:8/8:9 (docs.kie.ai/market/gpt/gpt-image-2-5-*).
const GPT_IMAGE_2_5_RATIOS = [
  "auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16",
  "21:9", "27:16", "16:27", "9:8", "8:9",
] as const
// GPT Image 2.5 renders 27:16, 16:27, 9:8 and 8:9 at 1K only; 2K and 4K are for
// its other ratios (the aspect_ratio field of every 2.5 page: Flare and
// Sunburst, text-to-image and image-to-image). `normalizeModelInput` moves a
// larger size there to 1K before the run is priced.
const GPT_IMAGE_2_5_RESOLUTIONS_BY_RATIO = {
  "27:16": ["1K"], "16:27": ["1K"], "9:8": ["1K"], "8:9": ["1K"],
} as const
// GPT Image 2.6 Flare and Sunburst: auto plus fifteen ratios, Economy a shorter
// list of its own (docs.kie.ai/market/gpt/gpt-image-2-6-*). Every 2.6 entry
// carries `autoAspectFromSourceImage`: 2.6's own auto renders a portrait photo
// square (measured 2026-11-10: 768x1024 in, 1024x1024 out; 2.5's auto kept
// it at 3:4), so "auto" with a photo is sent as the ratio nearest the photo.
const GPT_IMAGE_2_6_RATIOS = [
  "auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16",
  "2:1", "1:2", "21:9", "9:21", "3:1", "1:3",
] as const
const GPT_IMAGE_2_6_ECONOMY_RATIOS = ["auto", "1:1", "16:9", "9:16", "3:2", "2:3", "21:9", "4:3"] as const
// What GPT Image 2.6 Flare and Sunburst render at each ratio and size, for a
// PNG, JPEG or WebP (the `resolution` table of docs.kie.ai/market/gpt/
// gpt-image-2-6-{flare,sunburst}-image-to-image, fetched 2026-11-11).
const GPT_IMAGE_2_6_OUTPUT_SIZES = {
  "1:1": { "1K": [1024, 1024], "2K": [2048, 2048], "4K": [2880, 2880] },
  "3:2": { "1K": [1536, 1024], "2K": [2048, 1360], "4K": [3520, 2336] },
  "2:3": { "1K": [1024, 1536], "2K": [1360, 2048], "4K": [2336, 3520] },
  "4:3": { "1K": [1024, 768], "2K": [2048, 1536], "4K": [3312, 2480] },
  "3:4": { "1K": [768, 1024], "2K": [1536, 2048], "4K": [2480, 3312] },
  "5:4": { "1K": [1280, 1024], "2K": [2560, 2048], "4K": [3216, 2576] },
  "4:5": { "1K": [1024, 1280], "2K": [2048, 2560], "4K": [2576, 3216] },
  "16:9": { "1K": [1536, 864], "2K": [2048, 1152], "4K": [3840, 2160] },
  "9:16": { "1K": [864, 1536], "2K": [1152, 2048], "4K": [2160, 3840] },
  "2:1": { "1K": [2048, 1024], "2K": [2688, 1344], "4K": [3840, 1920] },
  "1:2": { "1K": [1024, 2048], "2K": [1344, 2688], "4K": [1920, 3840] },
  "21:9": { "1K": [2016, 864], "2K": [2688, 1152], "4K": [3840, 1648] },
  "9:21": { "1K": [864, 2016], "2K": [1152, 2688], "4K": [1648, 3840] },
  "3:1": { "1K": [1536, 512], "2K": [3072, 1024], "4K": [3840, 1280] },
  "1:3": { "1K": [512, 1536], "2K": [1024, 3072], "4K": [1280, 3840] },
} as const satisfies Record<string, Record<string, readonly [number, number]>>
const GPT_IMAGE_2_6_VALUE_LABELS = {
  "3:2": "3:2 (Landscape)", "2:3": "2:3 (Portrait)",
  "5:4": "5:4 (Near-square)", "4:5": "4:5 (Near-square)",
  "2:1": "2:1 (Wide)", "1:2": "1:2 (Vertical)",
  "9:21": "9:21 (Ultra-tall)", "3:1": "3:1 (Banner)", "1:3": "1:3 (Vertical banner)",
  // Auto takes the shared label; it is an aspect ratio on these models too.
  "low": "Low", "medium": "Medium", "high": "High", "xhigh": "Extra High", "max": "Max",
} as const
// The GPT Image background setting. KIE renders a transparent one at 1K only
// (`transparentResolution`), which normalizeModelInput enforces.
const GPT_IMAGE_BACKGROUNDS = ["auto", "opaque", "transparent"] as const
// GPT Image 2.6's files (docs.kie.ai/market/gpt/gpt-image-2-6-*). Flare and
// Sunburst write PNG, JPEG, WebP, an animated GIF or an SVG, from a prompt and
// from an edit; a GIF has 2 to 16 frames (KIE's cap, not the 64 of the model's
// own guide), each shown 20 to 2000 ms in steps of 10. Economy writes a PNG or
// a GIF from a prompt and a PNG from an edit, and takes a GIF's frames only as
// 4, 9, 16, 25, 36 or 64: the platform offers those up to 16.
const GPT_IMAGE_2_6_FORMATS = ["png", "jpeg", "webp", "gif", "svg"] as const
const GPT_IMAGE_2_6_GIF_FRAMES = { min: 2, max: 16, default: 9 } as const
const GPT_IMAGE_2_6_GIF_FRAME_DURATION = { min: 20, max: 2000, step: 10, default: 200 } as const
const GPT_IMAGE_2_6_ECONOMY_GIF_FRAMES = { min: 4, max: 16, default: 9, values: [4, 9, 16] } as const
const GPT_IMAGE_2_6_SVG_LEVELS = ["standard", "detailed", "max"] as const
const IMAGEN4_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const
const IDEOGRAM_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const
const SEEDREAM_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] as const
// MiniMax H3 Image: ten fixed ratios at every size, and "auto" — listed last, so
// a fallback that takes the first ratio never lands on it
// (docs.kie.ai/market/minimax-h3/text-to-image + image-edit).
const MINIMAX_H3_IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "auto"] as const
// Seedream 5.5 (docs.kie.ai/market/seedream/5-5-{text,image}-to-image): the
// text-to-image endpoint REQUIRES a real ratio, the eight above; the edit
// endpoint takes the same eight plus `auto`, its own default (listed first, as
// on the GPT Image edits, so a stale ratio on an edit falls back to keeping the
// photo's shape rather than to a fixed one).
const SEEDREAM_5_5_I2I_RATIOS = ["auto", ...SEEDREAM_RATIOS] as const
// Its sizes (KIE's `size`), the default being 2K (`SEEDREAM_5_5_DEFAULT_RESOLUTION`),
// a background setting (transparent only with PNG: TRANSPARENT_OUTPUT_FORMATS
// moves it to auto with JPEG), and PNG (its default) or JPEG.
const SEEDREAM_5_5_BACKGROUNDS = ["auto", "opaque", "transparent"] as const
const SEEDREAM_5_5_FORMATS = ["png", "jpeg"] as const
// FLUX 3 Klein (docs.kie.ai/market/flux3/klein-text-to-image + klein-edit-image):
// both endpoints list the same nine ratios, 1:1 first (the text-to-image
// default). The edit adds "auto", its own default (the first image's shape),
// listed LAST so a fallback that takes the first ratio lands on 1:1.
const FLUX_3_KLEIN_RATIOS = ["1:1", "4:3", "3:4", "3:2", "2:3", "16:9", "9:16", "21:9", "9:21"] as const
const FLUX_3_KLEIN_I2I_RATIOS = [...FLUX_3_KLEIN_RATIOS, "auto"] as const
// Its files: PNG (its default) or JPEG, the same price (decided 2026-11-12).
const FLUX_3_KLEIN_FORMATS = ["png", "jpeg"] as const
const Z_IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const

const VIDEO_RATIOS_HV = ["16:9", "9:16"] as const
const VIDEO_RATIOS_HVS = ["16:9", "9:16", "1:1"] as const
const WAN_27_IMAGE_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "8:1", "1:8"] as const
const VIDEO_RATIOS_HVS345 = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const
// Seedance 2.x only — KIE accepts the full fixed-ratio set incl. 21:9
// (docs.kie.ai/market/bytedance/seedance-2); MiniMax H3 shares the same
// seven-ratio set (t2v enum + r2v adaptive default per docs.kie.ai/market/minimax-h3).
// Kept separate from HVS so the
// wider set can't leak to models that don't support it.
const VIDEO_RATIOS_SEEDANCE_2 = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"] as const
// HappyHorse 1.1 (t2v + ref2v) — the model's full 9-ratio set incl. 4:5/5:4
// portrait-social and 21:9/9:21 cinematic (docs.kie.ai/market/happyhorse-1-1).
// Kept separate so the wider set can't leak to models that don't support it.
const VIDEO_RATIOS_HAPPYHORSE_11 = ["16:9", "9:16", "1:1", "4:3", "3:4", "4:5", "5:4", "21:9", "9:21"] as const
// Wan 3.0 (standard + Prime) — the model's own six-ratio enum, `adaptive` first
// because that is the KIE default ("automatically selects the ratio based on the
// input media and intent"). Deliberately NO 21:9 — the Wan 3.0 enum rejects it,
// so VIDEO_RATIOS_SEEDANCE_2 must NOT be reused here
// (docs.kie.ai/market/wan/3-0-video and /3-0-video-prime — identical schemas).
const VIDEO_RATIOS_WAN_3 = ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"] as const
// Vidu Q4 — the reference-to-video enum (docs.kie.ai/market/vidu-q4/reference-to-video,
// default 16:9). The image-to-video endpoint takes NO aspect ratio: its output
// inherits the start frame's shape, so these apply to reference runs only.
const VIDEO_RATIOS_VIDU_Q4 = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const
// Kling 4.0 — both endpoints share the enum (docs.kie.ai/market/kling/v4-reference-to-video,
// /v4-keyframe-to-video). `auto` follows the materials; with none it renders 16:9.
// The keyframe endpoint ignores the ratio once any frame is attached.
const VIDEO_RATIOS_KLING_4 = ["auto", "16:9", "9:16", "1:1", "21:9"] as const
// PixVerse V6 Max — the text-to-video enum, in KIE's own order
// (docs.kie.ai/market/pixverse/v6-max-text-to-video). The image-to-video
// endpoint takes NO aspect ratio: its output follows the start frame, so these
// apply to text-only runs.
const VIDEO_RATIOS_PIXVERSE_V6_MAX = ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"] as const

// =============================================================================
// IMAGE MODELS
// =============================================================================
const IMAGE_MODELS: Record<string, ModelCatalogEntry> = {
  // ── Google Nano Banana ──
  "nano-banana": {
    id: "nano-banana",
    kind: "image",
    // Accepts a reference image via image_input — works as both t2i (no
    // ref) and i2i (with ref) under the same id, so list in both modes.
    modes: ["t2i", "i2i"] as const,
    family: "Google",
    maker: "google",
    label: "Nano Banana",
    series: "Nano Banana",
    description: "Budget-friendly realistic generation. Wide aspect-ratio support up to 21:9.",
    useCases: ["realistic", "general", "fast"],
    features: ["reference-image"],
    aspectRatios: NANO_BANANA_RATIOS,
    pricing: [{ identifier: "nano-banana", credits: 10, note: "1K" }],
    mcpHidden: true,
  },
  "nano-banana-2": {
    id: "nano-banana-2",
    kind: "image",
    // Accepts reference images via image_input — same as the rest of the
    // Nano Banana family — so reachable for both t2i and i2i.
    modes: ["t2i", "i2i"] as const,
    family: "Google",
    maker: "google",
    label: "Nano Banana 2",
    series: "Nano Banana",
    description: "Newer Nano Banana with native resolution control (1K/2K/4K) and Google Search context.",
    useCases: ["realistic", "high-res", "factual"],
    features: ["reference-image", "google-search"],
    aspectRatios: NANO_BANANA_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "nano-banana-2", credits: 20, note: "1K default" },
      { identifier: "nano-banana-2:2K", credits: 50, note: "2K" },
      { identifier: "nano-banana-2:4K", credits: 50, note: "4K" },
    ],
  },
  "nano-banana-2-1": {
    id: "nano-banana-2-1",
    kind: "image",
    // Single id for both modes, like nano-banana-2: optional input images via
    // image_input (up to 10) on the one endpoint.
    modes: ["t2i", "i2i"] as const,
    family: "Google",
    maker: "google",
    label: "Nano Banana 2.1",
    series: "Nano Banana",
    description: "Google's high-efficiency image model for generation and editing — sharper quality, prompt adherence, character consistency and text rendering, up to 10 references and 4K output.",
    useCases: ["realistic", "character", "typography", "high-res"],
    features: ["reference-image"],
    aspectRatios: NANO_BANANA_2_1_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "nano-banana-2-1", credits: 10, note: "1K default" },
      { identifier: "nano-banana-2-1:2K", credits: 20, note: "2K" },
      { identifier: "nano-banana-2-1:4K", credits: 30, note: "4K" },
    ],
  },
  "nano-banana-2-lite": {
    id: "nano-banana-2-lite",
    kind: "image",
    // Same single-id shape as nano-banana-2: optional input images on the one
    // endpoint (via image_urls, up to 10), so reachable for both t2i and i2i.
    modes: ["t2i", "i2i"] as const,
    family: "Google",
    maker: "google",
    label: "Nano Banana 2 Lite",
    series: "Nano Banana",
    description: "Lightweight Nano Banana 2 (Gemini 3.1 Flash-Lite) — fast, low-cost 1K generation and editing.",
    useCases: ["realistic", "drafts", "iteration"],
    features: ["reference-image"],
    aspectRatios: NANO_BANANA_2_LITE_RATIOS,
    // 1K only — no resolution lever, flat pricing.
    pricing: [{ identifier: "nano-banana-2-lite", credits: 10, note: "1K flat" }],
  },
  "nano-banana-pro": {
    id: "nano-banana-pro",
    kind: "image",
    modes: ["t2i", "i2i"] as const,
    family: "Google",
    maker: "google",
    label: "Nano Banana Pro",
    series: "Nano Banana",
    description: "Top-tier Nano Banana — best for text rendering, diagrams, and complex compositions.",
    useCases: ["typography", "diagrams", "premium", "text-heavy"],
    features: ["reference-image"],
    aspectRatios: NANO_BANANA_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "nano-banana-pro", credits: 45, note: "1K / 2K" },
      { identifier: "nano-banana-pro:4K", credits: 60, note: "4K" },
    ],
  },
  "nano-banana-edit": {
    id: "nano-banana-edit",
    kind: "image",
    modes: ["edit"] as const,
    family: "Google",
    maker: "google",
    label: "Nano Banana Edit",
    series: "Nano Banana",
    description: "Image-to-image edits via Google's Nano Banana family. Good general-purpose editor.",
    useCases: ["edit", "remix", "general"],
    features: ["reference-image"],
    aspectRatios: NANO_BANANA_RATIOS,
    pricing: [{ identifier: "nano-banana-edit", credits: 10 }],
  },

  // ── Black Forest Labs (Flux) ──
  "flux": {
    id: "flux",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "Flux 2 Pro",
    series: "Flux",
    description: "Flux 2 Pro text-to-image. Strong realism, fast. Resolution lever to 2K.",
    useCases: ["realistic", "general"],
    features: ["reference-image"],
    aspectRatios: FLUX_RATIOS,
    resolutions: ["1K", "2K"],
    pricing: [
      { identifier: "flux", credits: 13, note: "1K default" },
      { identifier: "flux:2K", credits: 20, note: "2K" },
    ],
  },
  "flux-flex": {
    id: "flux-flex",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "Flux 2 Flex",
    series: "Flux",
    description: "Flux 2 Flex — premium fidelity, more flexible composition. Pricier than Pro.",
    useCases: ["premium", "fidelity", "realistic"],
    features: ["reference-image"],
    aspectRatios: FLUX_RATIOS,
    resolutions: ["1K", "2K"],
    pricing: [
      { identifier: "flux-flex", credits: 35, note: "1K default" },
      { identifier: "flux-flex:2K", credits: 60, note: "2K" },
    ],
  },
  "flux-i2i": {
    id: "flux-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "Flux 2 Flex (I2I)",
    series: "Flux",
    description: "Image-to-image with Flux Flex. Honors source image structure while applying prompt.",
    useCases: ["edit", "restyle", "transform"],
    features: ["reference-image"],
    aspectRatios: FLUX_RATIOS,
    resolutions: ["1K", "2K"],
    pricing: [
      { identifier: "flux-i2i", credits: 60, note: "1K default" },
      { identifier: "flux-i2i:2K", credits: 60, note: "2K" },
    ],
  },
  "flux-pro-i2i": {
    id: "flux-pro-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "Flux 2 Pro (I2I)",
    series: "Flux",
    description: "Image-to-image with Flux Pro. Cheaper than Flex variant, good general edits.",
    useCases: ["edit", "restyle"],
    features: ["reference-image"],
    aspectRatios: FLUX_RATIOS,
    resolutions: ["1K", "2K"],
    pricing: [
      { identifier: "flux-pro-i2i", credits: 13, note: "1K default" },
      { identifier: "flux-pro-i2i:2K", credits: 20, note: "2K" },
    ],
  },
  "flux-kontext": {
    id: "flux-kontext",
    kind: "image",
    // Kontext supports both pure t2i (no input image) and edit (with input).
    modes: ["t2i", "edit"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "Flux Kontext Pro",
    series: "Flux",
    description: "Context-aware editing and style transfer. Strong at preserving subject identity through edits.",
    useCases: ["edit", "style-transfer", "preserve-identity"],
    features: ["reference-image"],
    aspectRatios: KONTEXT_RATIOS,
    pricing: [{ identifier: "flux-kontext", credits: 13 }],
  },
  "flux-kontext-max": {
    id: "flux-kontext-max",
    kind: "image",
    modes: ["t2i", "edit"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "Flux Kontext Max",
    series: "Flux",
    description: "Premium Kontext — highest fidelity context-aware edits.",
    useCases: ["edit", "style-transfer", "premium"],
    features: ["reference-image"],
    aspectRatios: KONTEXT_RATIOS,
    pricing: [{ identifier: "flux-kontext-max", credits: 25 }],
  },
  // ── FLUX 3 Klein ──
  // The light model of Black Forest Labs' FLUX 3 (KIE `flux-3/klein-text-to-image`
  // and `flux-3/klein-edit-image`). A different model from FLUX 2 Klein
  // (`flux-2-klein`, below). A prompt runs the text-to-image id; with reference
  // images the run moves to the edit id (`T2I_TO_I2I_VARIANT`). Priced by size
  // alone, the same on both ids: reference images cost nothing
  // (`flux3KleinCreditId`). Both schemas list a closed set of ratios and text to
  // image has no "auto", so both entries declare `strictAspectRatios`. PNG (the
  // default) or JPEG, as its siblings write (decided 2026-11-12); KIE's WebP is
  // not offered. KIE's prompt enhancement is left on (never sent), and its
  // custom width/height and several pictures per request are not offered.
  // See: docs.kie.ai/market/flux3/klein-text-to-image.md
  //      docs.kie.ai/market/flux3/klein-edit-image.md
  "flux-3-klein": {
    id: "flux-3-klein",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "FLUX 3 Klein",
    series: "Flux",
    description: "FLUX 3 Klein - the light model of FLUX 3: fast and low cost, at 1K by default, 2K or 4K, in nine shapes, PNG or JPEG. Add images and it edits from up to 10 references, at the same price.",
    useCases: ["fast", "drafts", "iteration", "realistic"],
    features: ["reference-image"],
    aspectRatios: FLUX_3_KLEIN_RATIOS,
    strictAspectRatios: true,
    resolutions: FLUX_3_KLEIN_RESOLUTIONS,
    outputFormats: FLUX_3_KLEIN_FORMATS,
    pricing: [
      { identifier: "flux-3-klein", credits: 4, note: "1K default" },
      { identifier: "flux-3-klein:1K", credits: 4, note: "1K" },
      { identifier: "flux-3-klein:2K", credits: 7, note: "2K" },
      { identifier: "flux-3-klein:4K", credits: 17, note: "4K" },
    ],
  },
  "flux-3-klein-i2i": {
    id: "flux-3-klein-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "FLUX 3 Klein (I2I)",
    series: "Flux",
    description: "FLUX 3 Klein edits - fast, low-cost changes from 1 to 10 reference images, which cost nothing extra. 1K by default, 2K or 4K, PNG or JPEG; auto keeps the first image's shape.",
    useCases: ["edit", "iteration", "multi-reference", "fast"],
    features: ["reference-image"],
    aspectRatios: FLUX_3_KLEIN_I2I_RATIOS,
    strictAspectRatios: true,
    resolutions: FLUX_3_KLEIN_RESOLUTIONS,
    outputFormats: FLUX_3_KLEIN_FORMATS,
    pricing: [
      { identifier: "flux-3-klein-i2i", credits: 4, note: "1K default" },
      { identifier: "flux-3-klein-i2i:1K", credits: 4, note: "1K" },
      { identifier: "flux-3-klein-i2i:2K", credits: 7, note: "2K" },
      { identifier: "flux-3-klein-i2i:4K", credits: 17, note: "4K" },
    ],
  },
  // ── Replicate "Open" (uncensored) — run direct via Replicate, not KIE ──
  "flux-2-klein": {
    id: "flux-2-klein",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "Flux 2 Klein (Open)",
    series: "Flux",
    description: "Open Flux 2 9B from BFL — fast. Runs direct on Replicate.",
    useCases: ["realistic", "fast"],
    features: ["reference-image"],
    aspectRatios: FLUX_RATIOS,
    resolutions: ["0.5 MP", "1 MP", "2 MP", "4 MP"],
    pricing: [
      { identifier: "flux-2-klein",       credits: 3 },  // 1MP 0ref (default)
      { identifier: "flux-2-klein:1MP:0ref", credits: 3 },  // min — same point on the grid as the bare default
      { identifier: "flux-2-klein:4MP:8ref", credits: 108 }, // max
    ],
  },
  "kontext-multi": {
    id: "kontext-multi",
    kind: "image",
    modes: ["i2i", "edit"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "Kontext Multi (Open)",
    series: "Flux",
    description: "Multi-image Flux Kontext Pro via Replicate — up to 4 input images.",
    useCases: ["edit", "multi-reference"],
    features: ["reference-image"],
    aspectRatios: KONTEXT_RATIOS,
    pricing: [{ identifier: "kontext-multi", credits: 30 }],
  },
  "flux-2-pro": {
    id: "flux-2-pro",
    kind: "image",
    modes: ["t2i", "i2i"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "Flux 2 Pro (Safety Tolerance)",
    series: "Flux",
    description: "BFL Flux 2 Pro flagship via Replicate. Accepts up to 4 reference images.",
    useCases: ["realistic", "high-quality", "reference"],
    features: ["reference-image"],
    aspectRatios: FLUX_RATIOS,
    resolutions: ["0.5 MP", "1 MP", "2 MP", "4 MP"],
    pricing: [
      { identifier: "flux-2-pro",        credits: 23 },  // 2MP 0ref (default)
      { identifier: "flux-2-pro:0.5MP:0ref", credits: 12 },  // min
      { identifier: "flux-2-pro:4MP:8ref",   credits: 278 }, // max
    ],
  },
  "flux-2-max": {
    id: "flux-2-max",
    kind: "image",
    modes: ["t2i", "i2i"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "Flux 2 Max (Safety Tolerance)",
    series: "Flux",
    description: "BFL Flux 2 Max — even larger sibling of Pro via Replicate, up to 8 reference images. Variable pricing by MP and ref count.",
    useCases: ["realistic", "high-quality", "multi-reference"],
    features: ["reference-image"],
    aspectRatios: FLUX_RATIOS,
    resolutions: ["0.5 MP", "1 MP", "2 MP", "4 MP"],
    pricing: [
      { identifier: "flux-2-max",            credits: 70 },  // 2MP 0ref (default)
      { identifier: "flux-2-max:0.5MP:0ref", credits: 18 },  // min
      { identifier: "flux-2-max:4MP:8ref",   credits: 620 }, // max
    ],
  },
  // A catalog entry so a deployment's model restriction can name it (decided
  // 2026-11-12): before it, `models.allow` could not withhold it while the
  // Modify Image node and /v1/image-to-image kept running it. It repaints the
  // mask's white area of the image it is given, and its result is that image's
  // size, so it takes no aspect ratio, size or quality: none is listed, and a
  // value a request carries for one is dropped with an adjustment (as for
  // Ideogram Edit). It never read one, so what it is sent is unchanged
  // (backend flux-fill-requests-parity.test.ts). One input image, no
  // reference images: no "reference-image" feature.
  "flux-fill": {
    id: "flux-fill",
    kind: "image",
    modes: ["edit"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "FLUX Fill Pro",
    series: "Flux",
    description: "Masked inpainting from BFL via Replicate: repaints the mask's white area; the result keeps the image's size.",
    useCases: ["edit", "inpaint"],
    features: ["mask"],
    pricing: [{ identifier: "flux-fill", credits: 30 }],
  },
  // A trained character's model (decided 2026-11-12): FLUX.1 [dev] with the
  // character's own LoRA, which a Generate Image run switches to when the one
  // character it names has a succeeded trained model. Never picked
  // (`pickerHidden`): listed here so a deployment's restriction can name it.
  // Where a deployment withholds it, a run does not switch and uses the
  // character's reference pictures, as for a character with no trained model.
  // Its levers are not listed: nothing snaps a request against this entry.
  "flux-lora-character": {
    id: "flux-lora-character",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Black Forest Labs",
    maker: "black-forest-labs",
    label: "Trained character (FLUX LoRA)",
    series: "Flux",
    description: "A trained character's own model (FLUX.1 [dev] with its LoRA), run when a prompt names that one character.",
    useCases: ["character"],
    pricing: [{ identifier: "flux-lora-character", credits: 20 }],
    pickerHidden: true,
  },

  // ── OpenAI (GPT Image) ──
  "gpt-image": {
    id: "gpt-image",
    kind: "image",
    modes: ["t2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 1.5",
    series: "GPT Image",
    description: "Best for text rendering, typography, logos, and graphic design. Limited aspect ratios.",
    useCases: ["typography", "logo", "graphic-design", "text-heavy"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_RATIOS,
    qualities: ["medium", "high"],
    pricing: [
      { identifier: "gpt-image", credits: 10, note: "medium default" },
      { identifier: "gpt-image:high", credits: 60, note: "high quality" },
    ],
    valueLabels: { "3:2": "3:2 (Landscape)", "2:3": "2:3 (Portrait)" },
    mcpHidden: true,
  },
  "gpt-image-i2i": {
    id: "gpt-image-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 1.5 (I2I)",
    series: "GPT Image",
    description: "Image-to-image with GPT Image 1.5. Good text-aware edits.",
    useCases: ["edit", "typography", "remix"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_RATIOS,
    qualities: ["medium", "high"],
    pricing: [
      { identifier: "gpt-image-i2i", credits: 10, note: "medium default" },
      { identifier: "gpt-image-i2i:high", credits: 60, note: "high quality" },
    ],
    valueLabels: { "3:2": "3:2 (Landscape)", "2:3": "2:3 (Portrait)" },
    mcpHidden: true,
  },
  "gpt-image-2": {
    id: "gpt-image-2",
    kind: "image",
    modes: ["t2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 2",
    series: "GPT Image",
    description: "Next-gen GPT Image — broader aspect ratios, resolution-based pricing (1K/2K/4K).",
    useCases: ["typography", "high-res", "general"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_2_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "gpt-image-2", credits: 15, note: "1K default" },
      { identifier: "gpt-image-2:2K", credits: 25, note: "2K" },
      { identifier: "gpt-image-2:4K", credits: 40, note: "4K" },
    ],
    safetyFilter: { stochastic: true, fallback: "nano-banana-pro" },
    featured: true,
  },
  "gpt-image-2-i2i": {
    id: "gpt-image-2-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 2 (I2I)",
    series: "GPT Image",
    description: "Image-to-image with GPT Image 2.",
    safetyFilter: { stochastic: true, fallback: "nano-banana-pro" },
    useCases: ["edit", "high-res"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_2_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "gpt-image-2-i2i", credits: 15, note: "1K default" },
      { identifier: "gpt-image-2-i2i:2K", credits: 25, note: "2K" },
      { identifier: "gpt-image-2-i2i:4K", credits: 40, note: "4K" },
    ],
  },

  "gpt-image-2-5-flare": {
    id: "gpt-image-2-5-flare",
    kind: "image",
    modes: ["t2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 2.5 Flare",
    series: "GPT Image",
    description: "Fast everyday GPT Image 2.5 - higher quality than GPT Image 2 at about half the latency. The default of the pair: social and creator content, campaign variants, thumbnails, rapid iteration, high-volume work.",
    useCases: ["typography", "high-res", "general", "draft"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_2_5_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    resolutionsByAspectRatio: GPT_IMAGE_2_5_RESOLUTIONS_BY_RATIO,
    backgrounds: GPT_IMAGE_BACKGROUNDS,
    transparentResolution: "1K",
    backgroundOnlyAtTransparentResolution: true,
    pricing: [
      { identifier: "gpt-image-2-5-flare", credits: 15, note: "1K default" },
      { identifier: "gpt-image-2-5-flare:2K", credits: 25, note: "2K" },
      { identifier: "gpt-image-2-5-flare:4K", credits: 40, note: "4K" },
    ],
    valueLabels: {
      "3:2": "3:2 (Landscape)", "2:3": "2:3 (Portrait)",
      "27:16": "27:16 (Ultra-wide)", "16:27": "16:27 (Ultra-tall)",
      "9:8": "9:8 (Near-square)", "8:9": "8:9 (Near-square)",
    },
    safetyFilter: { stochastic: true, fallback: "nano-banana-pro" },
  },
  "gpt-image-2-5-flare-i2i": {
    id: "gpt-image-2-5-flare-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 2.5 Flare (I2I)",
    series: "GPT Image",
    description: "Fast GPT Image 2.5 edits (up to 16 source images) - the default when you are iterating rather than finishing.",
    useCases: ["edit", "high-res"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_2_5_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    resolutionsByAspectRatio: GPT_IMAGE_2_5_RESOLUTIONS_BY_RATIO,
    backgrounds: GPT_IMAGE_BACKGROUNDS,
    transparentResolution: "1K",
    backgroundOnlyAtTransparentResolution: true,
    pricing: [
      { identifier: "gpt-image-2-5-flare-i2i", credits: 15, note: "1K default" },
      { identifier: "gpt-image-2-5-flare-i2i:2K", credits: 25, note: "2K" },
      { identifier: "gpt-image-2-5-flare-i2i:4K", credits: 40, note: "4K" },
    ],
    valueLabels: {
      "3:2": "3:2 (Landscape)", "2:3": "2:3 (Portrait)",
      "27:16": "27:16 (Ultra-wide)", "16:27": "16:27 (Ultra-tall)",
      "9:8": "9:8 (Near-square)", "8:9": "8:9 (Near-square)",
    },
    safetyFilter: { stochastic: true, fallback: "nano-banana-pro" },
  },
  "gpt-image-2-5-sunburst": {
    id: "gpt-image-2-5-sunburst",
    kind: "image",
    modes: ["t2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 2.5 Sunburst",
    series: "GPT Image",
    description: "Precision GPT Image 2.5 - trades generation time for tighter control and detail fidelity. Pick it for brand-sensitive and production work: packaging, diagrams, ecommerce retouching, polished campaign creative.",
    useCases: ["typography", "high-res", "general"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_2_5_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    resolutionsByAspectRatio: GPT_IMAGE_2_5_RESOLUTIONS_BY_RATIO,
    backgrounds: GPT_IMAGE_BACKGROUNDS,
    transparentResolution: "1K",
    backgroundOnlyAtTransparentResolution: true,
    pricing: [
      { identifier: "gpt-image-2-5-sunburst", credits: 15, note: "1K default" },
      { identifier: "gpt-image-2-5-sunburst:2K", credits: 25, note: "2K" },
      { identifier: "gpt-image-2-5-sunburst:4K", credits: 40, note: "4K" },
    ],
    valueLabels: {
      "3:2": "3:2 (Landscape)", "2:3": "2:3 (Portrait)",
      "27:16": "27:16 (Ultra-wide)", "16:27": "16:27 (Ultra-tall)",
      "9:8": "9:8 (Near-square)", "8:9": "8:9 (Near-square)",
    },
    safetyFilter: { stochastic: true, fallback: "nano-banana-pro" },
  },
  "gpt-image-2-5-sunburst-i2i": {
    id: "gpt-image-2-5-sunburst-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 2.5 Sunburst (I2I)",
    series: "GPT Image",
    description: "Precision GPT Image 2.5 edits (up to 16 source images) - the most controlled edit in the GPT family, at the cost of a longer run.",
    useCases: ["edit", "high-res"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_2_5_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    resolutionsByAspectRatio: GPT_IMAGE_2_5_RESOLUTIONS_BY_RATIO,
    backgrounds: GPT_IMAGE_BACKGROUNDS,
    transparentResolution: "1K",
    backgroundOnlyAtTransparentResolution: true,
    pricing: [
      { identifier: "gpt-image-2-5-sunburst-i2i", credits: 15, note: "1K default" },
      { identifier: "gpt-image-2-5-sunburst-i2i:2K", credits: 25, note: "2K" },
      { identifier: "gpt-image-2-5-sunburst-i2i:4K", credits: 40, note: "4K" },
    ],
    valueLabels: {
      "3:2": "3:2 (Landscape)", "2:3": "2:3 (Portrait)",
      "27:16": "27:16 (Ultra-wide)", "16:27": "16:27 (Ultra-tall)",
      "9:8": "9:8 (Near-square)", "8:9": "8:9 (Near-square)",
    },
    safetyFilter: { stochastic: true, fallback: "nano-banana-pro" },
  },
  "gpt-image-2-6-flare": {
    id: "gpt-image-2-6-flare",
    kind: "image",
    modes: ["t2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 2.6 Flare",
    series: "GPT Image",
    description: "Fast GPT Image 2.6 - pick it for speed: posters, product shots and quick iteration, with stronger layouts. Up to 4K, quality from low to max or auto (priced up to the max), a transparent background at 1K. Writes PNG, JPEG, WebP, an animated GIF or an SVG.",
    useCases: ["typography", "high-res", "general", "draft"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_2_6_RATIOS,
    autoAspectFromSourceImage: true,
    resolutions: ["1K", "2K", "4K"],
    qualities: ["auto", "low", "medium", "high", "xhigh", "max"],
    defaultQuality: "medium",
    backgrounds: GPT_IMAGE_BACKGROUNDS,
    transparentResolution: "1K",
    outputFormats: GPT_IMAGE_2_6_FORMATS,
    gifFrames: GPT_IMAGE_2_6_GIF_FRAMES,
    gifFrameDurationMs: GPT_IMAGE_2_6_GIF_FRAME_DURATION,
    svgLevels: GPT_IMAGE_2_6_SVG_LEVELS,
    pricing: [
      { identifier: "gpt-image-2-6-flare", credits: 20, note: "medium, 1K default" },
      { identifier: "gpt-image-2-6-flare:low:1K", credits: 12, note: "low, 1K" },
      { identifier: "gpt-image-2-6-flare:low:2K", credits: 23, note: "low, 2K" },
      { identifier: "gpt-image-2-6-flare:low:4K", credits: 38, note: "low, 4K" },
      { identifier: "gpt-image-2-6-flare:medium:1K", credits: 20, note: "medium, 1K" },
      { identifier: "gpt-image-2-6-flare:medium:2K", credits: 40, note: "medium, 2K" },
      { identifier: "gpt-image-2-6-flare:medium:4K", credits: 67, note: "medium, 4K" },
      { identifier: "gpt-image-2-6-flare:high:1K", credits: 24, note: "high, 1K" },
      { identifier: "gpt-image-2-6-flare:high:2K", credits: 49, note: "high, 2K" },
      { identifier: "gpt-image-2-6-flare:high:4K", credits: 81, note: "high, 4K" },
      { identifier: "gpt-image-2-6-flare:xhigh:1K", credits: 43, note: "extra high, 1K" },
      { identifier: "gpt-image-2-6-flare:xhigh:2K", credits: 86, note: "extra high, 2K" },
      { identifier: "gpt-image-2-6-flare:xhigh:4K", credits: 143, note: "extra high, 4K" },
      { identifier: "gpt-image-2-6-flare:max:1K", credits: 96, note: "max, 1K" },
      { identifier: "gpt-image-2-6-flare:max:2K", credits: 193, note: "max, 2K" },
      { identifier: "gpt-image-2-6-flare:max:4K", credits: 321, note: "max, 4K" },
      { identifier: "gpt-image-2-6-flare:auto:1K", credits: 96, note: "auto, 1K: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-flare:auto:2K", credits: 193, note: "auto, 2K: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-flare:auto:4K", credits: 321, note: "auto, 4K: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-flare:low:gif-2-8", credits: 8, note: "GIF, low, 2 to 8 frames" },
      { identifier: "gpt-image-2-6-flare:low:gif-9-12", credits: 17, note: "GIF, low, 9 to 12 frames" },
      { identifier: "gpt-image-2-6-flare:low:gif-13-16", credits: 23, note: "GIF, low, 13 to 16 frames" },
      { identifier: "gpt-image-2-6-flare:medium:gif-2-8", credits: 14, note: "GIF, medium, 2 to 8 frames" },
      { identifier: "gpt-image-2-6-flare:medium:gif-9-12", credits: 29, note: "GIF, medium, 9 to 12 frames" },
      { identifier: "gpt-image-2-6-flare:medium:gif-13-16", credits: 41, note: "GIF, medium, 13 to 16 frames" },
      { identifier: "gpt-image-2-6-flare:high:gif-2-8", credits: 17, note: "GIF, high, 2 to 8 frames" },
      { identifier: "gpt-image-2-6-flare:high:gif-9-12", credits: 35, note: "GIF, high, 9 to 12 frames" },
      { identifier: "gpt-image-2-6-flare:high:gif-13-16", credits: 49, note: "GIF, high, 13 to 16 frames" },
      { identifier: "gpt-image-2-6-flare:xhigh:gif-2-8", credits: 29, note: "GIF, extra high, 2 to 8 frames" },
      { identifier: "gpt-image-2-6-flare:xhigh:gif-9-12", credits: 61, note: "GIF, extra high, 9 to 12 frames" },
      { identifier: "gpt-image-2-6-flare:xhigh:gif-13-16", credits: 86, note: "GIF, extra high, 13 to 16 frames" },
      { identifier: "gpt-image-2-6-flare:max:gif-2-8", credits: 65, note: "GIF, max, 2 to 8 frames" },
      { identifier: "gpt-image-2-6-flare:max:gif-9-12", credits: 136, note: "GIF, max, 9 to 12 frames" },
      { identifier: "gpt-image-2-6-flare:max:gif-13-16", credits: 194, note: "GIF, max, 13 to 16 frames" },
      { identifier: "gpt-image-2-6-flare:auto:gif-2-8", credits: 65, note: "GIF, auto, 2 to 8 frames: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-flare:auto:gif-9-12", credits: 136, note: "GIF, auto, 9 to 12 frames: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-flare:auto:gif-13-16", credits: 194, note: "GIF, auto, 13 to 16 frames: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-flare:medium:1K:svg-standard", credits: 25, note: "SVG standard, medium, 1K" },
      { identifier: "gpt-image-2-6-flare:medium:2K:svg-standard", credits: 45, note: "SVG standard, medium, 2K" },
      { identifier: "gpt-image-2-6-flare:medium:4K:svg-standard", credits: 72, note: "SVG standard, medium, 4K" },
      { identifier: "gpt-image-2-6-flare:medium:1K:svg-detailed", credits: 64, note: "SVG detailed, medium, 1K" },
      { identifier: "gpt-image-2-6-flare:medium:2K:svg-detailed", credits: 84, note: "SVG detailed, medium, 2K" },
      { identifier: "gpt-image-2-6-flare:medium:4K:svg-detailed", credits: 111, note: "SVG detailed, medium, 4K" },
      { identifier: "gpt-image-2-6-flare:medium:1K:svg-max", credits: 81, note: "SVG max, medium, 1K" },
      { identifier: "gpt-image-2-6-flare:medium:2K:svg-max", credits: 101, note: "SVG max, medium, 2K" },
      { identifier: "gpt-image-2-6-flare:medium:4K:svg-max", credits: 128, note: "SVG max, medium, 4K" },
    ],
    valueLabels: GPT_IMAGE_2_6_VALUE_LABELS,
    safetyFilter: { stochastic: true, fallback: "nano-banana-pro" },
  },
  "gpt-image-2-6-flare-i2i": {
    id: "gpt-image-2-6-flare-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 2.6 Flare (I2I)",
    series: "GPT Image",
    description: "Fast GPT Image 2.6 edits - up to 16 input images, priced per image. Writes PNG, JPEG, WebP, an animated GIF or an SVG. Takes an inpainting mask (PNG, JPEG or WebP; the rest of the picture is kept as it was). Pick it while iterating.",
    useCases: ["edit", "inpaint", "high-res"],
    features: ["reference-image", "mask"],
    aspectRatios: GPT_IMAGE_2_6_RATIOS,
    autoAspectFromSourceImage: true,
    outputSizes: GPT_IMAGE_2_6_OUTPUT_SIZES,
    maskEditMatchesSource: true,
    resolutions: ["1K", "2K", "4K"],
    qualities: ["auto", "low", "medium", "high", "xhigh", "max"],
    defaultQuality: "medium",
    backgrounds: GPT_IMAGE_BACKGROUNDS,
    transparentResolution: "1K",
    outputFormats: GPT_IMAGE_2_6_FORMATS,
    gifFrames: GPT_IMAGE_2_6_GIF_FRAMES,
    gifFrameDurationMs: GPT_IMAGE_2_6_GIF_FRAME_DURATION,
    svgLevels: GPT_IMAGE_2_6_SVG_LEVELS,
    pricing: [
      { identifier: "gpt-image-2-6-flare-i2i", credits: 20, note: "medium, 1K default" },
      { identifier: "gpt-image-2-6-flare-i2i:low:1K:1ref", credits: 17, note: "low, 1K, one input image (the least)" },
      { identifier: "gpt-image-2-6-flare-i2i:medium:1K:1ref", credits: 26, note: "medium, 1K, one input image" },
      { identifier: "gpt-image-2-6-flare-i2i:high:4K:16ref", credits: 169, note: "high, 4K, sixteen input images" },
      { identifier: "gpt-image-2-6-flare-i2i:max:4K:16ref", credits: 409, note: "max, 4K, sixteen input images (the most)" },
      { identifier: "gpt-image-2-6-flare-i2i:auto:1K:1ref", credits: 101, note: "auto, 1K, one input image: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-flare-i2i:medium:gif-9-12:1ref", credits: 34, note: "GIF, medium, 9 to 12 frames, one input image" },
      { identifier: "gpt-image-2-6-flare-i2i:medium:1K:svg-standard:1ref", credits: 31, note: "SVG standard, medium, 1K, one input image" },
    ],
    valueLabels: GPT_IMAGE_2_6_VALUE_LABELS,
    safetyFilter: { stochastic: true, fallback: "nano-banana-pro" },
  },
  "gpt-image-2-6-sunburst": {
    id: "gpt-image-2-6-sunburst",
    kind: "image",
    modes: ["t2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 2.6 Sunburst",
    series: "GPT Image",
    description: "Precision GPT Image 2.6 - pick it when every detail counts: the strongest consistency across edits and the finest detail. Up to 4K, quality from low to max or auto (priced up to the max), a transparent background at 1K. Writes PNG, JPEG, WebP, an animated GIF or an SVG.",
    useCases: ["typography", "high-res", "general"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_2_6_RATIOS,
    autoAspectFromSourceImage: true,
    resolutions: ["1K", "2K", "4K"],
    qualities: ["auto", "low", "medium", "high", "xhigh", "max"],
    defaultQuality: "medium",
    backgrounds: GPT_IMAGE_BACKGROUNDS,
    transparentResolution: "1K",
    outputFormats: GPT_IMAGE_2_6_FORMATS,
    gifFrames: GPT_IMAGE_2_6_GIF_FRAMES,
    gifFrameDurationMs: GPT_IMAGE_2_6_GIF_FRAME_DURATION,
    svgLevels: GPT_IMAGE_2_6_SVG_LEVELS,
    pricing: [
      { identifier: "gpt-image-2-6-sunburst", credits: 20, note: "medium, 1K default" },
      { identifier: "gpt-image-2-6-sunburst:low:1K", credits: 12, note: "low, 1K" },
      { identifier: "gpt-image-2-6-sunburst:low:2K", credits: 23, note: "low, 2K" },
      { identifier: "gpt-image-2-6-sunburst:low:4K", credits: 38, note: "low, 4K" },
      { identifier: "gpt-image-2-6-sunburst:medium:1K", credits: 20, note: "medium, 1K" },
      { identifier: "gpt-image-2-6-sunburst:medium:2K", credits: 40, note: "medium, 2K" },
      { identifier: "gpt-image-2-6-sunburst:medium:4K", credits: 67, note: "medium, 4K" },
      { identifier: "gpt-image-2-6-sunburst:high:1K", credits: 24, note: "high, 1K" },
      { identifier: "gpt-image-2-6-sunburst:high:2K", credits: 49, note: "high, 2K" },
      { identifier: "gpt-image-2-6-sunburst:high:4K", credits: 81, note: "high, 4K" },
      { identifier: "gpt-image-2-6-sunburst:xhigh:1K", credits: 43, note: "extra high, 1K" },
      { identifier: "gpt-image-2-6-sunburst:xhigh:2K", credits: 86, note: "extra high, 2K" },
      { identifier: "gpt-image-2-6-sunburst:xhigh:4K", credits: 143, note: "extra high, 4K" },
      { identifier: "gpt-image-2-6-sunburst:max:1K", credits: 96, note: "max, 1K" },
      { identifier: "gpt-image-2-6-sunburst:max:2K", credits: 193, note: "max, 2K" },
      { identifier: "gpt-image-2-6-sunburst:max:4K", credits: 321, note: "max, 4K" },
      { identifier: "gpt-image-2-6-sunburst:auto:1K", credits: 96, note: "auto, 1K: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-sunburst:auto:2K", credits: 193, note: "auto, 2K: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-sunburst:auto:4K", credits: 321, note: "auto, 4K: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-sunburst:low:gif-2-8", credits: 8, note: "GIF, low, 2 to 8 frames" },
      { identifier: "gpt-image-2-6-sunburst:low:gif-9-12", credits: 17, note: "GIF, low, 9 to 12 frames" },
      { identifier: "gpt-image-2-6-sunburst:low:gif-13-16", credits: 23, note: "GIF, low, 13 to 16 frames" },
      { identifier: "gpt-image-2-6-sunburst:medium:gif-2-8", credits: 14, note: "GIF, medium, 2 to 8 frames" },
      { identifier: "gpt-image-2-6-sunburst:medium:gif-9-12", credits: 29, note: "GIF, medium, 9 to 12 frames" },
      { identifier: "gpt-image-2-6-sunburst:medium:gif-13-16", credits: 41, note: "GIF, medium, 13 to 16 frames" },
      { identifier: "gpt-image-2-6-sunburst:high:gif-2-8", credits: 17, note: "GIF, high, 2 to 8 frames" },
      { identifier: "gpt-image-2-6-sunburst:high:gif-9-12", credits: 35, note: "GIF, high, 9 to 12 frames" },
      { identifier: "gpt-image-2-6-sunburst:high:gif-13-16", credits: 49, note: "GIF, high, 13 to 16 frames" },
      { identifier: "gpt-image-2-6-sunburst:xhigh:gif-2-8", credits: 29, note: "GIF, extra high, 2 to 8 frames" },
      { identifier: "gpt-image-2-6-sunburst:xhigh:gif-9-12", credits: 61, note: "GIF, extra high, 9 to 12 frames" },
      { identifier: "gpt-image-2-6-sunburst:xhigh:gif-13-16", credits: 86, note: "GIF, extra high, 13 to 16 frames" },
      { identifier: "gpt-image-2-6-sunburst:max:gif-2-8", credits: 65, note: "GIF, max, 2 to 8 frames" },
      { identifier: "gpt-image-2-6-sunburst:max:gif-9-12", credits: 136, note: "GIF, max, 9 to 12 frames" },
      { identifier: "gpt-image-2-6-sunburst:max:gif-13-16", credits: 194, note: "GIF, max, 13 to 16 frames" },
      { identifier: "gpt-image-2-6-sunburst:auto:gif-2-8", credits: 65, note: "GIF, auto, 2 to 8 frames: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-sunburst:auto:gif-9-12", credits: 136, note: "GIF, auto, 9 to 12 frames: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-sunburst:auto:gif-13-16", credits: 194, note: "GIF, auto, 13 to 16 frames: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-sunburst:medium:1K:svg-standard", credits: 25, note: "SVG standard, medium, 1K" },
      { identifier: "gpt-image-2-6-sunburst:medium:2K:svg-standard", credits: 45, note: "SVG standard, medium, 2K" },
      { identifier: "gpt-image-2-6-sunburst:medium:4K:svg-standard", credits: 72, note: "SVG standard, medium, 4K" },
      { identifier: "gpt-image-2-6-sunburst:medium:1K:svg-detailed", credits: 64, note: "SVG detailed, medium, 1K" },
      { identifier: "gpt-image-2-6-sunburst:medium:2K:svg-detailed", credits: 84, note: "SVG detailed, medium, 2K" },
      { identifier: "gpt-image-2-6-sunburst:medium:4K:svg-detailed", credits: 111, note: "SVG detailed, medium, 4K" },
      { identifier: "gpt-image-2-6-sunburst:medium:1K:svg-max", credits: 81, note: "SVG max, medium, 1K" },
      { identifier: "gpt-image-2-6-sunburst:medium:2K:svg-max", credits: 101, note: "SVG max, medium, 2K" },
      { identifier: "gpt-image-2-6-sunburst:medium:4K:svg-max", credits: 128, note: "SVG max, medium, 4K" },
    ],
    valueLabels: GPT_IMAGE_2_6_VALUE_LABELS,
    safetyFilter: { stochastic: true, fallback: "nano-banana-pro" },
  },
  "gpt-image-2-6-sunburst-i2i": {
    id: "gpt-image-2-6-sunburst-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 2.6 Sunburst (I2I)",
    series: "GPT Image",
    description: "Precision GPT Image 2.6 edits - up to 16 input images, priced per image. Writes PNG, JPEG, WebP, an animated GIF or an SVG. Takes an inpainting mask (PNG, JPEG or WebP; the rest of the picture is kept as it was). Pick it for finished, detail-critical edits.",
    useCases: ["edit", "inpaint", "high-res"],
    features: ["reference-image", "mask"],
    aspectRatios: GPT_IMAGE_2_6_RATIOS,
    autoAspectFromSourceImage: true,
    outputSizes: GPT_IMAGE_2_6_OUTPUT_SIZES,
    maskEditMatchesSource: true,
    resolutions: ["1K", "2K", "4K"],
    qualities: ["auto", "low", "medium", "high", "xhigh", "max"],
    defaultQuality: "medium",
    backgrounds: GPT_IMAGE_BACKGROUNDS,
    transparentResolution: "1K",
    outputFormats: GPT_IMAGE_2_6_FORMATS,
    gifFrames: GPT_IMAGE_2_6_GIF_FRAMES,
    gifFrameDurationMs: GPT_IMAGE_2_6_GIF_FRAME_DURATION,
    svgLevels: GPT_IMAGE_2_6_SVG_LEVELS,
    pricing: [
      { identifier: "gpt-image-2-6-sunburst-i2i", credits: 20, note: "medium, 1K default" },
      { identifier: "gpt-image-2-6-sunburst-i2i:low:1K:1ref", credits: 17, note: "low, 1K, one input image (the least)" },
      { identifier: "gpt-image-2-6-sunburst-i2i:medium:1K:1ref", credits: 26, note: "medium, 1K, one input image" },
      { identifier: "gpt-image-2-6-sunburst-i2i:high:4K:16ref", credits: 169, note: "high, 4K, sixteen input images" },
      { identifier: "gpt-image-2-6-sunburst-i2i:max:4K:16ref", credits: 409, note: "max, 4K, sixteen input images (the most)" },
      { identifier: "gpt-image-2-6-sunburst-i2i:auto:1K:1ref", credits: 101, note: "auto, 1K, one input image: the most it can cost, settled on what it really cost" },
      { identifier: "gpt-image-2-6-sunburst-i2i:medium:gif-9-12:1ref", credits: 34, note: "GIF, medium, 9 to 12 frames, one input image" },
      { identifier: "gpt-image-2-6-sunburst-i2i:medium:1K:svg-standard:1ref", credits: 31, note: "SVG standard, medium, 1K, one input image" },
    ],
    valueLabels: GPT_IMAGE_2_6_VALUE_LABELS,
    safetyFilter: { stochastic: true, fallback: "nano-banana-pro" },
  },
  // Economy is withheld since 2026-11-09: KIE answers every Economy request with
  // an internal error, on its own playground too. Migration 611 switched the two
  // ids off (`model_pricing.is_enabled`), which hides them from every menu and
  // refuses a run. Turning the two rows on at /admin/models brings them back;
  // `docsHidden` keeps them out of the docs until it is removed here.
  "gpt-image-2-6-economy": {
    id: "gpt-image-2-6-economy",
    kind: "image",
    modes: ["t2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 2.6 Economy",
    docsHidden: true,
    series: "GPT Image",
    description: "The same GPT Image 2.6 at a flat low price, 1K only - pick it for volume.",
    useCases: ["general", "draft"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_2_6_ECONOMY_RATIOS,
    autoAspectFromSourceImage: true,
    backgrounds: GPT_IMAGE_BACKGROUNDS,
    // A GIF is priced at the flat row for now: check its price on a real run
    // before Economy is switched back on (backend gpt-image-2-6-pricing.ts).
    outputFormats: ["png", "gif"],
    gifFrames: GPT_IMAGE_2_6_ECONOMY_GIF_FRAMES,
    gifFrameDurationMs: GPT_IMAGE_2_6_GIF_FRAME_DURATION,
    pricing: [{ identifier: "gpt-image-2-6-economy", credits: 13, note: "1K flat" }],
    valueLabels: GPT_IMAGE_2_6_VALUE_LABELS,
    safetyFilter: { stochastic: true, fallback: "nano-banana-pro" },
  },
  "gpt-image-2-6-economy-i2i": {
    id: "gpt-image-2-6-economy-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "GPT Image 2.6 Economy (I2I)",
    docsHidden: true,
    series: "GPT Image",
    description: "Flat-price GPT Image 2.6 edits, 1K only, up to 16 input images - pick it for volume.",
    useCases: ["edit", "draft"],
    features: ["reference-image"],
    aspectRatios: GPT_IMAGE_2_6_ECONOMY_RATIOS,
    autoAspectFromSourceImage: true,
    backgrounds: GPT_IMAGE_BACKGROUNDS,
    outputFormats: ["png"],
    pricing: [{ identifier: "gpt-image-2-6-economy-i2i", credits: 13, note: "1K flat" }],
    valueLabels: GPT_IMAGE_2_6_VALUE_LABELS,
    safetyFilter: { stochastic: true, fallback: "nano-banana-pro" },
  },

  // ── Ideogram ──
  // Ideogram models use a `rendering_speed` (TURBO / BALANCED / QUALITY)
  // dimension that's distinct from the `quality` lever — frontend exposes
  // it via a separate dropdown — so we don't model it under `qualities`.
  // The composite pricing identifiers (`ideogram-v3:TURBO`, etc.) capture
  // the per-tier credit cost without claiming Claude can pick it from
  // the MCP tool's `quality` enum.
  "ideogram-v3": {
    id: "ideogram-v3",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Ideogram",
    maker: "ideogram",
    label: "Ideogram V3",
    series: "Ideogram",
    description: "Strong typography and stylized illustration. Speed/quality tiered (TURBO/BALANCED/QUALITY).",
    useCases: ["typography", "illustration", "stylized"],
    aspectRatios: IDEOGRAM_RATIOS,
    pricing: [
      { identifier: "ideogram-v3", credits: 18, note: "BALANCED default" },
      { identifier: "ideogram-v3:TURBO", credits: 18, note: "fastest" },
      { identifier: "ideogram-v3:QUALITY", credits: 18, note: "best quality" },
    ],
  },
  "ideogram-edit": {
    id: "ideogram-edit",
    kind: "image",
    modes: ["edit"] as const,
    family: "Ideogram",
    maker: "ideogram",
    label: "Ideogram Edit",
    series: "Ideogram",
    description: "Inpainting / mask-based editing with Ideogram. Pair with a mask URL.",
    useCases: ["edit", "inpaint", "typography"],
    features: ["reference-image", "mask"],
    // No aspectRatios — Ideogram Edit takes output dimensions from the input
    // image + mask. Backend strips aspect_ratio for this provider.
    pricing: [
      { identifier: "ideogram-edit", credits: 45, note: "BALANCED default" },
      { identifier: "ideogram-edit:TURBO", credits: 30, note: "fastest" },
      { identifier: "ideogram-edit:QUALITY", credits: 60, note: "best quality" },
    ],
  },
  "ideogram-remix": {
    id: "ideogram-remix",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Ideogram",
    maker: "ideogram",
    label: "Ideogram Remix",
    series: "Ideogram",
    description: "Ideogram remix — character-aware restyling driven by reference images.",
    useCases: ["remix", "character", "stylized"],
    features: ["reference-image"],
    aspectRatios: IDEOGRAM_RATIOS,
    pricing: [
      { identifier: "ideogram-remix", credits: 45, note: "BALANCED default" },
      { identifier: "ideogram-remix:TURBO", credits: 30, note: "fastest" },
      { identifier: "ideogram-remix:QUALITY", credits: 60, note: "best quality" },
    ],
  },
  // `ideogram-reframe` was retired 2026-09-15 — KIE's `ideogram/v3-reframe`
  // fails every task upstream (#1331); see IDEOGRAM_PROVIDERS in model-constants.

  // ── Google Imagen ──
  "imagen4": {
    id: "imagen4",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Google",
    maker: "google",
    label: "Imagen 4",
    series: "Imagen",
    description: "Google's Imagen 4 — strong photographic quality and prompt fidelity.",
    useCases: ["photographic", "realistic"],
    aspectRatios: IMAGEN4_RATIOS,
    pricing: [{ identifier: "imagen4", credits: 20 }],
  },
  "imagen4-fast": {
    id: "imagen4-fast",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Google",
    maker: "google",
    label: "Imagen 4 Fast",
    series: "Imagen",
    description: "Cheaper / quicker Imagen 4 tier.",
    useCases: ["fast", "realistic", "general"],
    aspectRatios: IMAGEN4_RATIOS,
    pricing: [{ identifier: "imagen4-fast", credits: 10 }],
  },
  "imagen4-ultra": {
    id: "imagen4-ultra",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Google",
    maker: "google",
    label: "Imagen 4 Ultra",
    series: "Imagen",
    description: "Premium Imagen 4 — highest fidelity, slower / more credits.",
    useCases: ["premium", "photographic"],
    aspectRatios: IMAGEN4_RATIOS,
    pricing: [{ identifier: "imagen4-ultra", credits: 30 }],
  },

  // ── Bytedance Seedream ──
  "seedream": {
    id: "seedream",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedream 4.5",
    series: "Seedream",
    description: "Bytedance's Seedream 4.5 — precise control, high resolution at 4K via :high.",
    useCases: ["realistic", "high-res", "control"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    qualities: ["basic", "high"],
    pricing: [
      { identifier: "seedream", credits: 16, note: "basic / 2K default" },
      { identifier: "seedream:high", credits: 40, note: "high / 4K" },
    ],
    mcpHidden: true,
  },
  "seedream-edit": {
    id: "seedream-edit",
    kind: "image",
    modes: ["edit"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedream 4.5 Edit",
    series: "Seedream",
    description: "Image editing / transforms via Seedream 4.5.",
    useCases: ["edit", "transform"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    qualities: ["basic", "high"],
    pricing: [
      { identifier: "seedream-edit", credits: 16, note: "basic default" },
      { identifier: "seedream-edit:high", credits: 40, note: "high quality" },
    ],
    mcpHidden: true,
  },
  "seedream-5-lite": {
    id: "seedream-5-lite",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedream 5 Lite",
    series: "Seedream",
    description: "Newer Seedream 5 Lite — instruction-based generation, visual reasoning.",
    useCases: ["realistic", "instruction"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    qualities: ["basic", "high"],
    pricing: [
      { identifier: "seedream-5-lite", credits: 14, note: "basic default" },
      { identifier: "seedream-5-lite:high", credits: 50, note: "high quality" },
    ],
  },
  "seedream-5-lite-i2i": {
    id: "seedream-5-lite-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedream 5 Lite (I2I)",
    series: "Seedream",
    description: "Image-to-image with Seedream 5 Lite.",
    useCases: ["edit", "instruction"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    qualities: ["basic", "high"],
    pricing: [
      { identifier: "seedream-5-lite-i2i", credits: 14, note: "basic default" },
      { identifier: "seedream-5-lite-i2i:high", credits: 50, note: "high quality" },
    ],
  },
  "seedream-5-pro": {
    id: "seedream-5-pro",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedream 5 Pro",
    series: "Seedream",
    description: "Flagship Seedream 5 Pro — strongest instruction following and visual reasoning. Basic = 1K, high = 2K.",
    useCases: ["realistic", "instruction"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    qualities: ["basic", "high"],
    pricing: [
      { identifier: "seedream-5-pro", credits: 18, note: "basic / 1K default" },
      { identifier: "seedream-5-pro:high", credits: 60, note: "high / 2K" },
    ],
  },
  "seedream-5-pro-i2i": {
    id: "seedream-5-pro-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedream 5 Pro (I2I)",
    series: "Seedream",
    description: "Image-to-image with Seedream 5 Pro — multi-reference instruction edits. Basic = 1K, high = 2K.",
    useCases: ["edit", "instruction"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    qualities: ["basic", "high"],
    pricing: [
      { identifier: "seedream-5-pro-i2i", credits: 19, note: "basic / 1K default" },
      { identifier: "seedream-5-pro-i2i:high", credits: 60, note: "high / 2K" },
    ],
  },
  // Seedream 5 Flash — fast, low-cost Seedream 5. Its lever is KIE's `size`
  // (1K / 1.5K / 2K), NOT the siblings' `quality`: declared as `resolutions`
  // (the KIE config renames it to `size` on the wire). Flat price at every
  // offered size. 1.5K is not offered yet: no other image model or route enum
  // carries it, and its price has not been confirmed.
  // See: docs.kie.ai/market/seedream/5-flash-text-to-image.md
  "seedream-5-flash": {
    id: "seedream-5-flash",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedream 5 Flash",
    series: "Seedream",
    description: "Fast, low-cost Seedream 5 — quick generations at 1K or 2K, same price at either size.",
    useCases: ["realistic", "drafts", "iteration"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    resolutions: ["1K", "2K"],
    pricing: [{ identifier: "seedream-5-flash", credits: 10, note: "1K / 2K flat" }],
  },
  "seedream-5-flash-i2i": {
    id: "seedream-5-flash-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedream 5 Flash (I2I)",
    series: "Seedream",
    description: "Image-to-image with Seedream 5 Flash — fast edits from up to 10 input images at 1K or 2K, same price at either size.",
    useCases: ["edit", "iteration"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    resolutions: ["1K", "2K"],
    pricing: [{ identifier: "seedream-5-flash-i2i", credits: 10, note: "1K / 2K flat" }],
  },
  // Seedream 5.5 — a different model from Seedream 5 Lite, Pro and Flash, priced
  // by its size (1K and 1.5K the same, 2K dearer) and, on an edit, by each input
  // image (the rows are `ee/billing/seedream-5-5-pricing.ts`).
  // See: docs.kie.ai/market/seedream/5-5-text-to-image.md
  //      docs.kie.ai/market/seedream/5-5-image-to-image.md
  "seedream-5-5": {
    id: "seedream-5-5",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedream 5.5",
    series: "Seedream",
    description: "Seedream 5.5 - more natural light, materials and skin, and dense small text that stays readable. A transparent background in one step, PNG or JPEG, at 1K, 1.5K or 2K (the default); 1K and 1.5K cost the same.",
    useCases: ["realistic", "typography", "product", "transparent"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_RATIOS,
    strictAspectRatios: true,
    resolutions: SEEDREAM_5_5_RESOLUTIONS,
    defaultResolution: SEEDREAM_5_5_DEFAULT_RESOLUTION,
    backgrounds: SEEDREAM_5_5_BACKGROUNDS,
    outputFormats: SEEDREAM_5_5_FORMATS,
    pricing: [
      { identifier: "seedream-5-5", credits: 16, note: "2K default" },
      { identifier: "seedream-5-5:1K", credits: 9, note: "1K" },
      { identifier: "seedream-5-5:1.5K", credits: 9, note: "1.5K, the same as 1K" },
      { identifier: "seedream-5-5:2K", credits: 16, note: "2K" },
    ],
  },
  "seedream-5-5-i2i": {
    id: "seedream-5-5-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedream 5.5 (I2I)",
    series: "Seedream",
    description: "Seedream 5.5 edits - change what you ask, round after round, and the rest of the picture stays as it was. Up to 10 input images, priced per image; a transparent background, PNG or JPEG, at 1K, 1.5K or 2K (the default).",
    useCases: ["edit", "iteration", "transparent"],
    features: ["reference-image"],
    aspectRatios: SEEDREAM_5_5_I2I_RATIOS,
    strictAspectRatios: true,
    resolutions: SEEDREAM_5_5_RESOLUTIONS,
    defaultResolution: SEEDREAM_5_5_DEFAULT_RESOLUTION,
    backgrounds: SEEDREAM_5_5_BACKGROUNDS,
    outputFormats: SEEDREAM_5_5_FORMATS,
    pricing: [
      { identifier: "seedream-5-5-i2i", credits: 20, note: "2K, one input image (the default)" },
      { identifier: "seedream-5-5-i2i:1K:1ref", credits: 13, note: "1K, one input image (the least)" },
      { identifier: "seedream-5-5-i2i:1.5K:1ref", credits: 13, note: "1.5K, one input image" },
      { identifier: "seedream-5-5-i2i:2K:1ref", credits: 20, note: "2K, one input image" },
      { identifier: "seedream-5-5-i2i:1K:10ref", credits: 45, note: "1K, ten input images" },
      { identifier: "seedream-5-5-i2i:2K:10ref", credits: 52, note: "2K, ten input images (the most)" },
    ],
  },

  // ── MiniMax H3 Image ──
  // MiniMax's H3 image model (KIE `minimax-h3/text-to-image` and
  // `minimax-h3/image-edit`). Not the H3 video model `minimax-h3`. A prompt
  // runs the text-to-image id; with reference images the run moves to the
  // edit id (`T2I_TO_I2I_VARIANT`). Priced by size, 1K and 2K the same, and an
  // edit by its reference images (`minimaxH3ImageCreditId`). "auto" is listed
  // LAST so a fallback that takes the first ratio lands on a real one: from a
  // prompt KIE's rewriter picks the ratio, in an edit it follows the first
  // reference image. KIE's prompt expansion is left on and its custom
  // width/height is not offered.
  // See: docs.kie.ai/market/minimax-h3/text-to-image.md
  //      docs.kie.ai/market/minimax-h3/image-edit.md
  "minimax-h3-image": {
    id: "minimax-h3-image",
    kind: "image",
    modes: ["t2i"] as const,
    family: "MiniMax",
    maker: "minimax",
    label: "MiniMax H3 Image",
    series: "MiniMax Image",
    description: "MiniMax H3 Image: detailed pictures up to about 16 MP at 4K, with readable text inside the picture. Ten shapes plus auto, the same price at 1K and 2K (2K by default), PNG or JPEG.",
    useCases: ["typography", "high-res", "general"],
    features: ["reference-image"],
    aspectRatios: MINIMAX_H3_IMAGE_RATIOS,
    resolutions: MINIMAX_H3_IMAGE_RESOLUTIONS,
    defaultResolution: MINIMAX_H3_IMAGE_DEFAULT_RESOLUTION,
    outputFormats: ["png", "jpeg"],
    pricing: [
      { identifier: "minimax-h3-image", credits: 5, note: "2K default" },
      { identifier: "minimax-h3-image:1K", credits: 5, note: "1K" },
      { identifier: "minimax-h3-image:2K", credits: 5, note: "2K" },
      { identifier: "minimax-h3-image:4K", credits: 14, note: "4K" },
    ],
  },
  "minimax-h3-image-i2i": {
    id: "minimax-h3-image-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "MiniMax",
    maker: "minimax",
    label: "MiniMax H3 Image (I2I)",
    series: "MiniMax Image",
    description: "MiniMax H3 Image edits: change or combine up to 16 reference images in one edit, with readable text, up to about 16 MP at 4K. Priced by size and by reference image; auto keeps the first image's shape.",
    useCases: ["edit", "typography", "multi-reference"],
    features: ["reference-image"],
    aspectRatios: MINIMAX_H3_IMAGE_RATIOS,
    resolutions: MINIMAX_H3_IMAGE_RESOLUTIONS,
    defaultResolution: MINIMAX_H3_IMAGE_DEFAULT_RESOLUTION,
    outputFormats: ["png", "jpeg"],
    pricing: [
      { identifier: "minimax-h3-image-i2i", credits: 6, note: "2K, one reference image" },
      { identifier: "minimax-h3-image-i2i:1K:1ref", credits: 6, note: "1K, one reference image (the least)" },
      { identifier: "minimax-h3-image-i2i:2K:1ref", credits: 6, note: "2K, one reference image" },
      { identifier: "minimax-h3-image-i2i:2K:4ref", credits: 10, note: "2K, four reference images" },
      { identifier: "minimax-h3-image-i2i:4K:1ref", credits: 15, note: "4K, one reference image" },
      { identifier: "minimax-h3-image-i2i:2K:16ref", credits: 25, note: "2K, sixteen reference images" },
      { identifier: "minimax-h3-image-i2i:4K:16ref", credits: 34, note: "4K, sixteen reference images (the most)" },
    ],
  },

  // ── Alibaba Qwen ──
  "qwen": {
    id: "qwen",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Qwen",
    series: "Qwen",
    description: "Cheap, fast, decent quality. Native negative-prompt support.",
    useCases: ["fast", "cheap", "general"],
    features: ["reference-image"],
    aspectRatios: IDEOGRAM_RATIOS,
    pricing: [{ identifier: "qwen", credits: 10 }],
  },
  "qwen-i2i": {
    id: "qwen-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Qwen (I2I)",
    series: "Qwen",
    description: "Image-to-image with Qwen.",
    useCases: ["edit", "fast", "cheap"],
    features: ["reference-image"],
    aspectRatios: IDEOGRAM_RATIOS,
    pricing: [{ identifier: "qwen-i2i", credits: 10 }],
  },
  "qwen-edit": {
    id: "qwen-edit",
    kind: "image",
    modes: ["edit"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Qwen Edit",
    series: "Qwen",
    description: "Qwen image edit endpoint with native negative prompt.",
    useCases: ["edit", "cheap"],
    features: ["reference-image"],
    aspectRatios: IDEOGRAM_RATIOS,
    pricing: [{ identifier: "qwen-edit", credits: 13 }],
  },

  // ── Tongyi-MAI Z-Image ──
  "z-image": {
    id: "z-image",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Tongyi-MAI",
    maker: "alibaba",
    label: "Z-Image",
    series: "Z-Image",
    description: "Cheapest model in catalog. Fast, stylized output. Limited aspect ratios.",
    useCases: ["cheap", "fast", "stylized"],
    aspectRatios: Z_IMAGE_RATIOS,
    pricing: [{ identifier: "z-image", credits: 2 }],
    featured: true,
  },

  // ── xAI Grok ──
  "grok": {
    id: "grok",
    // Grok serves both t2i (image) and t2v (video) under the same id —
    // backend route resolves which by entry point. We classify the catalog
    // entry by primary kind (image) but list both modes so MCP filters and
    // frontend pickers find it under either context.
    kind: "image",
    modes: ["t2i", "t2v"] as const,
    family: "xAI",
    maker: "xai",
    label: "Grok Imagine",
    series: "Grok",
    description: "Expressive, high-contrast output. Supports both image and video.",
    useCases: ["stylized", "expressive", "general"],
    features: ["reference-image"],
    aspectRatios: GROK_RATIOS,
    pricing: [{ identifier: "grok", credits: 10 }],
  },
  "grok-i2i": {
    id: "grok-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "xAI",
    maker: "xai",
    label: "Grok Imagine (I2I)",
    series: "Grok",
    description: "Image-to-image with Grok.",
    useCases: ["edit", "stylized"],
    features: ["reference-image"],
    pricing: [{ identifier: "grok-i2i", credits: 10 }],
  },
  // `grok-upscale` was retired 2026-10-29 — it never upscaled an image: the
  // provider endpoint it was wired to upscales a Grok VIDEO task, and the
  // provider offers no Grok image upscale. See IMAGE_EDIT_PROVIDERS in
  // model-constants. No entry: a stored or sent id is refused by the route.
  // Grok Imagine Image 2.0 — t2i plus task-chained region editing. The edit
  // and segment-map endpoints take a PRIOR grok-2 generation's task id (the
  // job's `kieTaskId` output), not an image URL (see
  // TASK_CHAINED_EDIT_PROVIDERS in model-constants).
  "grok-2": {
    id: "grok-2",
    kind: "image",
    modes: ["t2i"] as const,
    family: "xAI",
    maker: "xai",
    label: "Grok Imagine 2",
    series: "Grok",
    description:
      "Grok Imagine Image 2.0 — expressive, high-contrast t2i. Generations chain into grok-2-segment (free named region masks) and grok-2-edit (region-targeted edits).",
    useCases: ["stylized", "expressive", "general"],
    // Refs auto-route to grok-2-i2i (segment-map → image-edit chain); ONE
    // reference (REF_IMAGE_MAX_LIMITS).
    features: ["reference-image"],
    aspectRatios: GROK_RATIOS,
    pricing: [{ identifier: "grok-2", credits: 10 }],
  },
  "grok-2-edit": {
    id: "grok-2-edit",
    kind: "image",
    modes: ["edit"] as const,
    family: "xAI",
    maker: "xai",
    label: "Grok Imagine 2 Edit",
    series: "Grok",
    description:
      "Prompt-edit a prior grok-2 generation by task id. Optional mask indexes (from grok-2-segment) restrict the edit to named regions.",
    useCases: ["edit", "region-edit"],
    pricing: [{ identifier: "grok-2-edit", credits: 10 }],
  },
  // Auto-selected when references are attached to grok-2 (T2I_TO_I2I_VARIANT):
  // the t2i endpoint takes no image, so the FREE segment-map mints a task id
  // from the reference URL and image-edit consumes it. Single reference.
  "grok-2-i2i": {
    id: "grok-2-i2i",
    kind: "image",
    modes: ["i2i"] as const,
    family: "xAI",
    maker: "xai",
    label: "Grok Imagine 2 (reference)",
    series: "Grok",
    description:
      "grok-2 guided by ONE reference image via the segment-map → image-edit chain — preserves the reference's composition while applying the prompt.",
    useCases: ["restyle", "edit", "reference"],
    features: ["reference-image"],
    pricing: [{ identifier: "grok-2-i2i", credits: 10 }],
  },
  "grok-2-segment": {
    id: "grok-2-segment",
    kind: "image",
    modes: ["edit"] as const,
    family: "xAI",
    maker: "xai",
    label: "Grok Imagine 2 Segment Map",
    series: "Grok",
    description:
      "FREE semantic segment map of a prior grok-2 generation — named region masks whose indexes feed grok-2-edit's region targeting.",
    useCases: ["segmentation", "region-edit"],
    pricing: [{ identifier: "grok-2-segment", credits: 0, note: "free" }],
  },

  // ── Utilities ──
  "recraft-remove-bg": {
    id: "recraft-remove-bg",
    kind: "image",
    modes: ["remove-bg"] as const,
    family: "Recraft",
    maker: "recraft",
    label: "Recraft Remove BG",
    series: "Recraft",
    description: "Remove image background. Cheap utility.",
    useCases: ["background-removal", "utility"],
    features: ["reference-image"],
    pricing: [{ identifier: "recraft-remove-bg", credits: 3 }],
  },
  "recraft-upscale": {
    id: "recraft-upscale",
    kind: "image",
    modes: ["upscale"] as const,
    family: "Recraft",
    maker: "recraft",
    label: "Recraft Crisp Upscale",
    series: "Recraft",
    description: "Light-weight image upscale (Recraft Crisp).",
    useCases: ["upscale", "utility"],
    features: ["reference-image"],
    pricing: [{ identifier: "recraft-upscale", credits: 2 }],
  },
  "topaz-image-upscale": {
    id: "topaz-image-upscale",
    kind: "image",
    modes: ["upscale"] as const,
    family: "Topaz",
    maker: "topaz-labs",
    label: "Topaz Image Upscale",
    series: "Topaz",
    description: "High-quality image upscale at 1x (enhance only), 2x or 4x. Best for production-ready output.",
    useCases: ["upscale", "high-res", "premium"],
    features: ["reference-image"],
    // No `resolutions`: the provider's only quality lever is `upscale_factor`
    // (1/2/4) — see resolveTopazUpscale. The 2K/4K/8K menu this used to
    // advertise had no provider parameter behind it.
    pricing: [
      { identifier: "topaz-image-upscale", credits: 25, note: "1x / 2x" },
      { identifier: "topaz-image-upscale:4K", credits: 50, note: "4x (legacy identifier)" },
    ],
  },
  "nodaro-image-upscale": {
    id: "nodaro-image-upscale",
    kind: "image",
    modes: ["upscale"] as const,
    family: "Nodaro Upscale",
    ownLabel: true,
    label: "Nodaro Image Upscale",
    series: "Nodaro Upscale",
    description: "Image upscale at 1x (enhance only), 2x, 4x or 8x. Restores detail and keeps lettering exactly as written; the output is the input times the factor, nothing cropped. Priced by the output's size.",
    useCases: ["upscale", "high-res", "typography", "utility"],
    features: ["reference-image"],
    // No `resolutions`: the one lever is the upscale factor (`NODARO_IMAGE_UPSCALE_FACTORS`).
    // The price follows the OUTPUT's total pixels (`@nodaro/render-rules`
    // nodaro-image-upscale-pricing.ts); the bare id is the hold when the image's size
    // cannot be read before the run, settled to the delivered output's tier.
    pricing: [
      { identifier: "nodaro-image-upscale:2K", credits: 4, note: "output up to 4,194,304 pixels (2048 × 2048)" },
      { identifier: "nodaro-image-upscale:4K", credits: 10, note: "output up to 16,777,216 pixels (4096 × 4096)" },
      { identifier: "nodaro-image-upscale:8K", credits: 30, note: "output up to 67,108,864 pixels (8192 × 8192)" },
      { identifier: "nodaro-image-upscale", credits: 30, note: "held when the image's size cannot be read before the run; the output's tier is charged" },
    ],
  },
}

// =============================================================================
// VIDEO MODELS
// =============================================================================
const VIDEO_MODELS: Record<string, ModelCatalogEntry> = {
  // ── Hailuo / MiniMax ──
  "minimax": {
    id: "minimax",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "MiniMax",
    maker: "minimax",
    label: "Hailuo 02 I2V Pro",
    series: "Hailuo",
    description: "Hailuo 02 Pro — strong photoreal motion, fixed 5-second clips. Supports end frame.",
    useCases: ["realistic", "motion", "narrative"],
    features: ["end-frame"],
    durations: [5],
    defaultDuration: 5,
    pricing: [{ identifier: "minimax", credits: 143, note: "5s, 1080p" }],
  },
  // MiniMax H3 (KIE "minimax-h3") — t2v / i2v (first and/or last frame) /
  // reference-to-video (9 images / 3 videos ≤15s total / 3 audios ≤15s total;
  // audio refs require an image or video ref alongside). Two-rate resolution
  // lever (768P added 2026-08-03): 2K (KIE default) at 36.5 KIE cr/s, 768P at
  // 22.5 KIE cr/s — billed on output + input-video seconds at the SELECTED
  // resolution's rate; input images beyond the first 5 add 11 KIE cr each,
  // reference audio free. Bare duration composites stay the 2K rate (identical
  // to the pre-lever seeded rows); 768P appends ":768p". Mirrors the Seedance 2
  // multimodal surface.
  // docs.kie.ai/market/minimax-h3/{text,image,reference}-to-video.
  "minimax-h3": {
    id: "minimax-h3",
    unlistedResolutionRendersAs: "2K",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "MiniMax",
    maker: "minimax",
    label: "minimax-h3",
    series: "Hailuo",
    description: "MiniMax H3 — premium multimodal tier: first/last frame + image/video/audio references, native audio, 2K (default) or 768P output, 4-15s per-second pricing.",
    useCases: ["premium", "narrative"],
    features: ["end-frame", "audio", "reference-image", "video-reference", "reference-to-video"],
    aspectRatios: VIDEO_RATIOS_SEEDANCE_2,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 6,
    // First entry = default (the UI dropdown + fail-safe snap use opts[0], and
    // 2K is the KIE-side default). Uppercase values are the exact KIE wire enum.
    resolutions: ["2K", "768P"],
    valueLabels: { "2K": "2K (default)" },
    pricing: [
      { identifier: "minimax-h3", credits: 550, note: "default 6s @2K — see :Ns variants" },
      { identifier: "minimax-h3:4s", credits: 370, note: "4s @2K (min)" },
      { identifier: "minimax-h3:8s", credits: 730, note: "8s @2K" },
      { identifier: "minimax-h3:15s", credits: 1370, note: "15s @2K (max)" },
      { identifier: "minimax-h3:4s:768p", credits: 230, note: "4s @768P (min)" },
      { identifier: "minimax-h3:8s:768p", credits: 450, note: "8s @768P" },
      { identifier: "minimax-h3:15s:768p", credits: 850, note: "15s @768P (max)" },
    ],
  },
  "hailuo-2.3-pro": {
    id: "hailuo-2.3-pro",
    kind: "video",
    modes: ["i2v"] as const,
    family: "MiniMax",
    maker: "minimax",
    valueLabels: { "1080P": "1080P (6s max)" },
    label: "Hailuo 2.3 Pro",
    series: "Hailuo",
    description: "Hailuo 2.3 Pro — newer Hailuo with 768P / 1080P resolutions.",
    useCases: ["realistic", "motion"],
    durations: [6, 10],
    defaultDuration: 6,
    resolutions: ["768P", "1080P"],
    pricing: [
      { identifier: "hailuo-2.3-pro", credits: 200, note: "10s default" },
      { identifier: "hailuo-2.3-pro:6s", credits: 130, note: "6s" },
      { identifier: "hailuo-2.3-pro:10s", credits: 200, note: "10s" },
    ],
  },
  "hailuo-2.3": {
    id: "hailuo-2.3",
    kind: "video",
    modes: ["i2v"] as const,
    family: "MiniMax",
    maker: "minimax",
    resolutions: ["768P", "1080P"],
    valueLabels: { "1080P": "1080P (6s max)" },
    label: "Hailuo 2.3 Standard",
    series: "Hailuo",
    description: "Cheaper Hailuo 2.3 tier — good baseline quality.",
    useCases: ["realistic", "cheap"],
    durations: [6, 10],
    defaultDuration: 6,
    pricing: [
      { identifier: "hailuo-2.3", credits: 75, note: "6s default" },
      { identifier: "hailuo-2.3:6s", credits: 80, note: "6s" },
      { identifier: "hailuo-2.3:10s", credits: 130, note: "10s" },
    ],
  },
  "hailuo-standard": {
    id: "hailuo-standard",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "MiniMax",
    maker: "minimax",
    label: "Hailuo 02 Standard",
    series: "Hailuo",
    description: "Hailuo 02 Standard — economical option with end-frame support.",
    useCases: ["cheap", "motion"],
    features: ["end-frame"],
    durations: [6, 10],
    defaultDuration: 6,
    resolutions: ["512P", "768P"],
    pricing: [
      { identifier: "hailuo-standard", credits: 75, note: "6s default" },
      { identifier: "hailuo-standard:6s", credits: 80, note: "6s" },
      { identifier: "hailuo-standard:10s", credits: 130, note: "10s" },
    ],
  },

  // ── Google VEO ──
  "veo3": {
    id: "veo3",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Google",
    maker: "google",
    label: "VEO 3.1 Quality",
    series: "VEO",
    description: "Google VEO 3.1 Quality — premium cinematic video. 4/6/8s clips, optional end frame, native audio. No reference-to-video mode (Fast/Lite only). Flat per-generation pricing across durations.",
    useCases: ["cinematic", "premium", "narrative"],
    // NO "reference-image": KIE serves REFERENCE_2_VIDEO on the Fast and Lite
    // SKUs only. Its own words, on a production job (2026-09-04, app-reports
    // lane G): "Reference to video only supports the Veo Fast model and Veo
    // Lite model." Until 2026-09-15 this entry claimed the feature, so the
    // editor offered the reference handles, the adapter sent
    // generationType: "REFERENCE_2_VIDEO", and the call came back 422 every
    // time — after credits were reserved. `veo3.1` (KIE `veo3_fast`) and
    // `veo3_lite` DO serve it and keep the flag.
    features: ["end-frame", "audio"],
    durations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: VIDEO_RATIOS_HV,
    // 720p (default) + 1080p inline. 4K generates the base at 1080p then chains
    // KIE's /api/v1/veo/get-4k-video endpoint (worker handleImageToVideo / handleTextToVideo).
    resolutions: ["720p", "1080p", "4k"],
    pricing: [
      { identifier: "veo3", credits: 1000, note: "4/6/8s with audio (flat per-generation)" },
      { identifier: "veo3:4k", credits: 1300, note: "4K (base 1080p → get-4k-video)" },
    ],
    featured: true,
  },
  "veo3.1": {
    id: "veo3.1",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Google",
    maker: "google",
    label: "VEO 3.1 Fast",
    series: "VEO",
    description: "VEO 3.1 Fast — cheaper VEO 3.1 tier, 4/6/8s with audio. Good balance for most uses. Flat per-generation pricing across durations.",
    useCases: ["cinematic", "fast", "general"],
    features: ["end-frame", "audio", "reference-image", "reference-to-video"],
    durations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: VIDEO_RATIOS_HV,
    resolutions: ["720p", "1080p", "4k"],
    pricing: [
      { identifier: "veo3.1", credits: 150, note: "4/6/8s with audio @ 720p (flat)" },
      { identifier: "veo3.1:1080p", credits: 170, note: "4/6/8s with audio @ 1080p (flat)" },
      { identifier: "veo3.1:4k", credits: 450, note: "4K (base 1080p → get-4k-video)" },
    ],
    featured: true,
  },
  "veo3_lite": {
    id: "veo3_lite",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Google",
    maker: "google",
    label: "VEO 3.1 Lite",
    series: "VEO",
    description: "VEO 3.1 Lite — most cost-effective VEO tier for high-volume generation. 4/6/8s with audio, supports first+last frame.",
    useCases: ["cinematic", "cheap", "high-volume"],
    features: ["end-frame", "audio", "reference-image", "reference-to-video"],
    durations: [4, 6, 8],
    defaultDuration: 8,
    aspectRatios: VIDEO_RATIOS_HV,
    resolutions: ["720p", "1080p", "4k"],
    pricing: [
      { identifier: "veo3_lite", credits: 75, note: "4/6/8s with audio @ 720p (flat)" },
      { identifier: "veo3_lite:1080p", credits: 90, note: "4/6/8s with audio @ 1080p (flat)" },
      { identifier: "veo3_lite:4k", credits: 380, note: "4K (base 1080p → get-4k-video)" },
    ],
    featured: false,
  },
  "gemini-omni-video": {
    id: "gemini-omni-video",
    kind: "video",
    modes: ["i2v", "t2v"] as const,   // V2V is served via the i2v handle, not a catalog mode
    family: "Google",
    maker: "google",
    label: "Gemini Omni",
    series: "Gemini",
    description: "Google multimodal video with native audio; text/image-to-video + video-edit.",
    useCases: ["cinematic", "narrative"],
    features: ["audio", "reference-image", "reference-to-video"],
    aspectRatios: VIDEO_RATIOS_HV,
    resolutions: ["720p", "1080p", "4k"],
    durations: [4, 6, 8, 10],
    defaultDuration: 8,
    pricing: [
      { identifier: "gemini-omni-video", credits: 315, note: "default — 720p/1080p 4s" },
      { identifier: "gemini-omni-video:4", credits: 230, note: "720p/1080p 4s" },
      { identifier: "gemini-omni-video:6", credits: 300, note: "720p/1080p 6s" },
      { identifier: "gemini-omni-video:8", credits: 380, note: "720p/1080p 8s" },
      { identifier: "gemini-omni-video:10", credits: 450, note: "720p/1080p 10s" },
      { identifier: "gemini-omni-video:4k:4", credits: 530, note: "4K 4s" },
      { identifier: "gemini-omni-video:4k:6", credits: 600, note: "4K 6s" },
      { identifier: "gemini-omni-video:4k:8", credits: 680, note: "4K 8s" },
      { identifier: "gemini-omni-video:4k:10", credits: 750, note: "4K 10s" },
      { identifier: "gemini-omni-video:vref", credits: 600, note: "video-edit 720p/1080p" },
      { identifier: "gemini-omni-video:4k:vref", credits: 900, note: "video-edit 4K" },
    ],
  },
  // Gemini Omni Flash 1.1 — the faster/cheaper Omni SKU (KIE
  // `google/gemini-omni-flash-1-1`). Identical request surface to
  // gemini-omni-video, so every capability below is deliberate PARITY with the
  // sibling: same 4/6/8/10s ladder, same 720p/1080p + 4K bands, same
  // features (the KIE schema also exposes first/last frame, but the pro
  // sibling's frame path is unwired here too — no "end-frame" until it is).
  // 360p is on the KIE enum but NOT exposed: it sits in the same credit band as
  // 720p/1080p, so it could only hand the user a worse render at the same price.
  "gemini-omni-flash": {
    id: "gemini-omni-flash",
    kind: "video",
    modes: ["i2v", "t2v"] as const,   // V2V is served via the i2v handle, not a catalog mode
    family: "Google",
    maker: "google",
    label: "Gemini Omni Flash",
    series: "Gemini",
    description: "Google Gemini Omni Flash — faster/cheaper Omni tier: multimodal video with native audio, text/image-to-video + video-edit.",
    useCases: ["cinematic", "fast"],
    features: ["audio", "reference-image", "reference-to-video"],
    aspectRatios: VIDEO_RATIOS_HV,
    resolutions: ["720p", "1080p", "4k"],
    durations: [4, 6, 8, 10],
    defaultDuration: 8,
    pricing: [
      { identifier: "gemini-omni-flash", credits: 270, note: "default — 8s 720p/1080p (the credit builder's duration fallback)" },
      { identifier: "gemini-omni-flash:4", credits: 160, note: "720p/1080p 4s" },
      { identifier: "gemini-omni-flash:6", credits: 210, note: "720p/1080p 6s" },
      { identifier: "gemini-omni-flash:8", credits: 270, note: "720p/1080p 8s" },
      { identifier: "gemini-omni-flash:10", credits: 320, note: "720p/1080p 10s" },
      { identifier: "gemini-omni-flash:4k:4", credits: 370, note: "4K 4s" },
      { identifier: "gemini-omni-flash:4k:6", credits: 420, note: "4K 6s" },
      { identifier: "gemini-omni-flash:4k:8", credits: 480, note: "4K 8s" },
      { identifier: "gemini-omni-flash:4k:10", credits: 530, note: "4K 10s" },
      { identifier: "gemini-omni-flash:vref", credits: 420, note: "video-edit 720p/1080p" },
      { identifier: "gemini-omni-flash:4k:vref", credits: 630, note: "video-edit 4K" },
    ],
  },
  "gemini-omni-flash-1-2": {
    id: "gemini-omni-flash-1-2",
    kind: "video",
    modes: ["i2v", "t2v"] as const,   // V2V is served via the i2v handle, not a catalog mode
    family: "Google",
    maker: "google",
    label: "Gemini Omni Flash 1.2",
    series: "Gemini",
    description: "Google Gemini Omni Flash 1.2 — 3–15s video with native sound, from 360p to 4K: from text, up to 6 reference images, exact first and last frames, or a video edit. Priced per second.",
    useCases: ["cinematic", "fast"],
    features: ["audio", "reference-image", "reference-to-video", "end-frame"],
    referenceSyntax: "image N",
    aspectRatios: ["16:9", "9:16", "auto"],
    resolutions: ["360p", "720p", "1080p", "4k"],
    defaultResolution: "720p",
    unlistedResolutionRendersAs: "720p",
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 8,
    pricing: [
      { identifier: "gemini-omni-flash-1-2", credits: 180, note: "default 8s 720p — see :Ns:res variants" },
      { identifier: "gemini-omni-flash-1-2:3s:360p", credits: 30, note: "3s 360p (min)" },
      { identifier: "gemini-omni-flash-1-2:8s:720p", credits: 180, note: "8s 720p (the default tier)" },
      { identifier: "gemini-omni-flash-1-2:8s:1080p", credits: 200, note: "8s 1080p" },
      { identifier: "gemini-omni-flash-1-2:8s:4k", credits: 440, note: "8s 4K" },
      { identifier: "gemini-omni-flash-1-2:15s:4k", credits: 830, note: "15s 4K (max)" },
    ],
  },

  // ── Kling ──
  "kling": {
    id: "kling",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling 2.6",
    series: "Kling",
    description: "Kling 2.6 I2V — strong motion realism. 5s/10s, optional native audio.",
    useCases: ["realistic", "motion", "dance"],
    features: ["audio"],
    aspectRatios: VIDEO_RATIOS_HVS,
    durations: [5, 10],
    defaultDuration: 5,
    pricing: [
      { identifier: "kling", credits: 280, note: "10s no audio default" },
      { identifier: "kling:5s", credits: 138, note: "5s no audio" },
      { identifier: "kling:10s", credits: 275, note: "10s no audio" },
      { identifier: "kling:5s:audio", credits: 275, note: "5s with audio" },
      { identifier: "kling:10s:audio", credits: 550, note: "10s with audio" },
    ],
  },
  "kling-turbo": {
    id: "kling-turbo",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling 2.5 Turbo Pro",
    series: "Kling",
    description: "Faster Kling — good quality at lower cost. Supports end frame.",
    useCases: ["fast", "motion", "cheap"],
    features: ["end-frame"],
    durations: [5, 10],
    defaultDuration: 5,
    pricing: [
      { identifier: "kling-turbo", credits: 125, note: "5s default" },
      { identifier: "kling-turbo:5s", credits: 110 },
      { identifier: "kling-turbo:10s", credits: 210 },
    ],
  },
  "kling-3.0": {
    id: "kling-3.0",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling 3.0",
    series: "Kling",
    description: "Premium Kling 3.0 — variable 3-15s duration, native audio, 720P/1080P.",
    useCases: ["premium", "narrative", "cinematic"],
    features: ["end-frame", "audio"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ["720P", "1080P"],
    pricing: [
      { identifier: "kling-3.0", credits: 500, note: "5s 1080p with audio" },
      { identifier: "kling-3.0:5s", credits: 270, note: "5s 1080p no audio" },
      { identifier: "kling-3.0:10s", credits: 680, note: "10s 1080p no audio" },
      { identifier: "kling-3.0:15s", credits: 1020, note: "15s 1080p no audio" },
      { identifier: "kling-3.0:5s:audio", credits: 338, note: "5s 1080p with audio" },
      { identifier: "kling-3.0:10s:audio", credits: 1000, note: "10s 1080p with audio" },
      { identifier: "kling-3.0:15s:audio", credits: 1500, note: "15s 1080p with audio" },
    ],
    featured: true,
  },
  "kling-master": {
    id: "kling-master",
    kind: "video",
    modes: ["i2v"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling 2.1 Master",
    series: "Kling",
    description: "Master tier I2V — strong cinematic quality.",
    useCases: ["cinematic", "premium"],
    durations: [5, 10],
    defaultDuration: 5,
    pricing: [
      { identifier: "kling-master", credits: 400, note: "5s default" },
      { identifier: "kling-master:5s", credits: 400 },
      { identifier: "kling-master:10s", credits: 800 },
    ],
  },
  "kling-3-omni": {
    id: "kling-3-omni",
    kind: "video",
    modes: ["i2v"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling 3 Omni",
    series: "Kling",
    description: "Kling 3 Omni via Replicate — 3-15s, 720p/1080p, end frame + reference images, native audio.",
    useCases: ["motion", "cinematic", "reference"],
    features: ["end-frame", "reference-image"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    aspectRatios: VIDEO_RATIOS_HVS,
    pricing: [
      { identifier: "kling-3-omni", credits: 250, note: "5s 720p default" },
      { identifier: "kling-3-omni:5s", credits: 250 },
      { identifier: "kling-3-omni:10s", credits: 500 },
      { identifier: "kling-3-omni:15s", credits: 750 },
    ],
  },
  // Kling 4.0 — two KIE endpoints, two ids (one per entry in the model list).
  // Reference: docs.kie.ai/market/kling/v4-reference-to-video — text plus up to
  // 10 reference images, 5 reference videos (2-30s each), 7 subjects and 3
  // voices (15 materials in all); with none it is plain text-to-video. A wired
  // start frame joins the reference images. Keyframes:
  // docs.kie.ai/market/kling/v4-keyframe-to-video — start frame, up to 8
  // in-between frames (the node's Image References, in order) and an end
  // frame; with no frame it is text-to-video. Both: 3-30s, 720p/1080p, native
  // audio always on, no seed. Per-second billing; a reference-video run bills
  // its input seconds too (ee/billing/ref-video-billing.ts).
  "kling-4": {
    id: "kling-4",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling 4.0",
    series: "Kling",
    description: "Kling 4.0 — up to 30s with native audio and lip-sync; reference images, videos, characters and voices, or plain text.",
    useCases: ["premium", "narrative", "cinematic", "reference"],
    // Reference VIDEOS are taken (VIDEO_REF_LIMITS_BY_PROVIDER `videos: 5`) but
    // `video-reference` is NOT declared: like wan-3, the generate-video-pro
    // extend chain (a continuation tail sent as a reference video) is unwired
    // for it, so the pro node offers it in keyframes mode only.
    features: ["audio", "reference-image", "reference-to-video", "character-subjects", "voice-references", "audio-soundtrack"],
    aspectRatios: VIDEO_RATIOS_KLING_4,
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    unlistedResolutionRendersAs: "720p",
    noSeed: true,  // neither Kling 4.0 schema has a `seed` (additionalProperties: false)
    pricing: [
      { identifier: "kling-4", credits: 360, note: "default 5s 720p — see :Ns:res variants for exact" },
      { identifier: "kling-4:5s:720p", credits: 360, note: "5s 720p (the default tier)" },
      { identifier: "kling-4:5s:1080p", credits: 540, note: "5s 1080p" },
      { identifier: "kling-4:3s:720p", credits: 220, note: "3s 720p (min)" },
      { identifier: "kling-4:30s:1080p", credits: 3190, note: "30s 1080p (max)" },
      { identifier: "kling-4:8s:720p-ref", credits: 340, note: "per-second anchor with a reference video: billed × (output + max(output, input seconds)) ÷ 8" },
    ],
  },
  "kling-4-keyframes": {
    id: "kling-4-keyframes",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling 4.0 Keyframes",
    series: "Kling",
    description: "Kling 4.0 Keyframes — start frame, up to 8 in-between frames and an end frame; up to 30s with native audio.",
    useCases: ["premium", "narrative", "keyframes"],
    // `reference-to-video`: in-between frames alone (no start frame) run —
    // KIE takes `keyframe_urls` without `first_frame_url`.
    features: ["end-frame", "audio", "reference-image", "reference-to-video", "keyframes"],
    aspectRatios: VIDEO_RATIOS_KLING_4,
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    unlistedResolutionRendersAs: "720p",
    noSeed: true,
    pricing: [
      { identifier: "kling-4-keyframes", credits: 360, note: "default 5s 720p — see :Ns:res variants for exact" },
      { identifier: "kling-4-keyframes:5s:720p", credits: 360, note: "5s 720p (the default tier)" },
      { identifier: "kling-4-keyframes:5s:1080p", credits: 540, note: "5s 1080p" },
      { identifier: "kling-4-keyframes:3s:720p", credits: 220, note: "3s 720p (min)" },
      { identifier: "kling-4-keyframes:30s:1080p", credits: 3190, note: "30s 1080p (max)" },
    ],
  },
  // Kling 4.0 Flash — ONE id over KIE's two Flash endpoints, picked by what is
  // wired (backend kie/kling4.ts): a start frame alone runs on
  // docs.kie.ai/market/kling/v4-flash-keyframe-to-video, where it is the exact
  // opening frame; everything else (text, reference images, videos,
  // characters, or a start frame beside any of them) runs on
  // docs.kie.ai/market/kling/v4-flash-reference-to-video, where a start frame
  // joins the reference images as on kling-4. Reference: up to 10 images, 5
  // videos (2-20s together) and 7 characters (15 in all). No standalone voices:
  // audio clip N becomes wired character N's voice when that character has 2-4
  // images (otherwise the clip is dropped). No end
  // frame, no 1080p, no seed. 3-20s, 720p, native audio always on. Per-second
  // billing; a reference-video run bills its input seconds too.
  "kling-4-flash": {
    id: "kling-4-flash",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling 4.0 Flash",
    series: "Kling",
    description: "Kling 4.0 Flash — the faster, lower-cost Kling 4.0 at 720p, up to 20s with native audio; a start frame, reference images, videos and characters (each can carry a voice clip), or plain text.",
    useCases: ["fast", "cheap", "narrative", "reference"],
    // No `voices` array on Flash: a reference audio clip is a character's voice
    // (`voice-references` names that input "Voice Refs"). No `audio-soundtrack`
    // (the clips are voices, never a soundtrack), no `end-frame`, no
    // `video-reference` (the generate-video-pro extend chain is unwired, as on
    // kling-4).
    features: ["audio", "reference-image", "reference-to-video", "character-subjects", "voice-references"],
    aspectRatios: VIDEO_RATIOS_KLING_4,
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    defaultDuration: 5,
    resolutions: ["720p"],
    unlistedResolutionRendersAs: "720p",
    noSeed: true,  // neither Flash schema has a `seed` (additionalProperties: false)
    pricing: [
      { identifier: "kling-4-flash", credits: 220, note: "default 5s 720p — see :Ns:720p variants for exact" },
      { identifier: "kling-4-flash:5s:720p", credits: 220, note: "5s 720p (the default tier)" },
      { identifier: "kling-4-flash:3s:720p", credits: 130, note: "3s 720p (min)" },
      { identifier: "kling-4-flash:10s:720p", credits: 430, note: "10s 720p" },
      { identifier: "kling-4-flash:20s:720p", credits: 850, note: "20s 720p (max)" },
      { identifier: "kling-4-flash:8s:720p-ref", credits: 230, note: "per-second anchor with a reference video: billed × (output + max(output, input seconds)) ÷ 8" },
    ],
  },

  // ── xAI Grok video ──
  "grok-i2v": {
    id: "grok-i2v",
    kind: "video",
    modes: ["i2v"] as const,
    features: ["reference-image", "reference-to-video"],
    referenceSyntax: "@image(n)",
    family: "xAI",
    maker: "xai",
    label: "Grok Imagine (I2V)",
    series: "Grok",
    description: "Grok image-to-video — stylized motion. Up to 15s.",
    useCases: ["stylized", "motion"],
    durations: [6, 10],
    defaultDuration: 6,
    resolutions: ["480p", "720p"],
    pricing: [
      { identifier: "grok-i2v", credits: 150, note: "6s default" },
      { identifier: "grok-i2v:6s", credits: 50 },
      { identifier: "grok-i2v:10s", credits: 80 },
      { identifier: "grok-i2v:15s", credits: 100 },
    ],
  },
  // xAI Grok Imagine Video 1.5 — KIE image-to-video
  // (docs.kie.ai/market/grok-imagine/1-5-preview), built by the backend's
  // bespoke runner (kie/grok-video-15.ts). The start frame is the exact first
  // frame and an end frame the exact last frame; one picture wired as both is a
  // seamless loop (KIE `loop_url`). The Image References are up to 4
  // in-between frames (KIE `keyframes`), spread evenly over the clip at whole
  // seconds — frames only, never loose references, so `keyframes` is declared
  // (it also keeps the model out of generate-video-pro, whose segments would
  // send cast references as frames). modes:["i2v"] and no `reference-to-video`:
  // every run needs its start image, in-between frames included. It is also
  // surfaced in the text-to-video dropdown for the unified node, where the t2v
  // route returns a clean "requires an input image" 400. Per-second billing by
  // resolution, with no per-image part.
  "grok-imagine-video-1.5": {
    id: "grok-imagine-video-1.5",
    kind: "video",
    modes: ["i2v"] as const,
    features: ["end-frame", "reference-image", "keyframes"],
    family: "xAI",
    maker: "xai",
    label: "Grok Imagine Video 1.5",
    series: "Grok",
    description: "Grok Imagine Video 1.5 — 1–15s at 480p, 720p or 1080p, per-second pricing. An exact first and last frame (the same image as both makes a seamless loop) and up to 4 in-between frames. Requires an input image.",
    useCases: ["stylized", "motion"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4"],
    durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 8,
    resolutions: ["480p", "720p", "1080p"],
    // normalizeGrokVideo15Resolution sends 480p for anything off the list.
    unlistedResolutionRendersAs: "480p",
    // KIE refuses 1080p beside anything but a lone start frame ("1080p is only
    // supported for text-to-video or a single image used as the first frame",
    // a staging run 2026-11-12): no end frame, loop or in-between frames.
    startFrameOnlyResolutions: ["1080p"],
    noSeed: true,  // the KIE schema has no `seed` (additionalProperties: false)
    pricing: [
      { identifier: "grok-imagine-video-1.5", credits: 50, note: "default 8s 480p — see :Ns:res variants" },
      { identifier: "grok-imagine-video-1.5:8s:480p", credits: 50, note: "8s 480p" },
      { identifier: "grok-imagine-video-1.5:8s:720p", credits: 90, note: "8s 720p" },
      { identifier: "grok-imagine-video-1.5:8s:1080p", credits: 160, note: "8s 1080p" },
      { identifier: "grok-imagine-video-1.5:15s:480p", credits: 90, note: "15s 480p (max)" },
      { identifier: "grok-imagine-video-1.5:15s:720p", credits: 170, note: "15s 720p (max)" },
      { identifier: "grok-imagine-video-1.5:15s:1080p", credits: 300, note: "15s 1080p (max)" },
    ],
  },

  // ── Bytedance Seedance ──
  // `seedance` (Seedance 1.5 Pro) was retired upstream 2026-10-25 — KIE answers
  // 410. No entry: a stored or sent "seedance" runs as Seedance 2 Mini through
  // RETIRED_VIDEO_PROVIDERS (model-constants).
  "seedance-2": {
    id: "seedance-2",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedance 2",
    series: "Seedance",
    description: "Seedance 2 — premium tier with native audio. Per-second pricing by resolution.",
    useCases: ["premium", "narrative"],
    features: ["end-frame", "audio", "reference-image", "video-reference", "reference-to-video"],
    aspectRatios: VIDEO_RATIOS_SEEDANCE_2,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 8,
    autoDuration: true,
    resolutions: ["480p", "720p", "1080p", "4k"],
    pricing: [
      { identifier: "seedance-2", credits: 380, note: "default — see :NsR variants for exact" },
      { identifier: "seedance-2:8s:480p", credits: 380, note: "8s 480p" },
      { identifier: "seedance-2:8s:720p", credits: 820, note: "8s 720p" },
      { identifier: "seedance-2:8s:1080p", credits: 2040, note: "8s 1080p" },
      { identifier: "seedance-2:8s:480p-ref", credits: 230, note: "8s 480p with reference" },
      { identifier: "seedance-2:8s:720p-ref", credits: 500, note: "8s 720p with reference" },
      { identifier: "seedance-2:8s:1080p-ref", credits: 1240, note: "8s 1080p with reference" },
      { identifier: "seedance-2:8s:4k", credits: 4160, note: "8s 4k" },
      { identifier: "seedance-2:8s:4k-ref", credits: 2560, note: "8s 4k with reference" },
    ],
  },
  "seedance-2-fast": {
    id: "seedance-2-fast",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedance 2 Fast",
    series: "Seedance",
    description: "Cheaper / quicker Seedance 2 tier.",
    useCases: ["fast", "motion"],
    features: ["end-frame", "audio", "reference-image", "video-reference", "reference-to-video"],
    aspectRatios: VIDEO_RATIOS_SEEDANCE_2,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 8,
    autoDuration: true,
    resolutions: ["480p", "720p"],
    pricing: [
      { identifier: "seedance-2-fast", credits: 310, note: "default — see :NsR variants" },
      { identifier: "seedance-2-fast:8s:480p", credits: 310 },
      { identifier: "seedance-2-fast:8s:720p", credits: 660 },
      { identifier: "seedance-2-fast:8s:480p-ref", credits: 180 },
      { identifier: "seedance-2-fast:8s:720p-ref", credits: 400 },
    ],
  },
  "seedance-2-mini": {
    id: "seedance-2-mini",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedance 2 Mini",
    series: "Seedance",
    description: "Budget Seedance 2 tier — 480p/720p only, per-second pricing by resolution.",
    useCases: ["fast", "motion"],
    features: ["end-frame", "audio", "reference-image", "video-reference", "reference-to-video"],
    aspectRatios: VIDEO_RATIOS_SEEDANCE_2,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 8,
    autoDuration: true,
    resolutions: ["480p", "720p"],
    pricing: [
      { identifier: "seedance-2-mini", credits: 190, note: "default — see :NsR variants" },
      { identifier: "seedance-2-mini:8s:480p", credits: 190 },
      { identifier: "seedance-2-mini:8s:720p", credits: 410 },
      { identifier: "seedance-2-mini:8s:480p-ref", credits: 120 },
      { identifier: "seedance-2-mini:8s:720p-ref", credits: 250 },
    ],
  },
  // Seedance 2.5 — the next Seedance generation, not a tier of the 2.0 ladder.
  // Two levers differ from every 2.0 SKU and drive its own entries throughout:
  // durations run to 30s (2.0 caps at 15s) and there is NO 4K tier (1080p
  // arrived on KIE 2026-08-17 — probe-verified; 4k/2k/1440p still rejected).
  // Reference caps are also wider (30 images / 10 videos / 10 audio) — see
  // SEEDANCE_2_5_REF_LIMITS in model-constants.
  "seedance-2-5": {
    id: "seedance-2-5",
    kind: "video",
    // `v2v`: it edits a clip by instruction on the same route as the other edit
    // models (/v1/video-to-video, through its reference lane, in the clip's own
    // ratio and length). It still makes a clip from words or a picture.
    modes: ["i2v", "t2v", "v2v"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedance 2.5",
    series: "Seedance",
    description: "Seedance 2.5 — up to 30s in one shot, native audio, wide multimodal references. 480p/720p/1080p.",
    useCases: ["premium", "narrative", "long-form"],
    features: ["end-frame", "audio", "reference-image", "video-reference", "reference-to-video"],
    aspectRatios: VIDEO_RATIOS_SEEDANCE_2,
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    defaultDuration: 8,
    autoDuration: true,
    referenceTaskTypes: ["reference", "edit", "extend"],
    resolutions: ["480p", "720p", "1080p"],
    // KIE refuses a seed on Seedance 2.5 (422) — the provider config omits it.
    noSeed: true,
    pricing: [
      { identifier: "seedance-2-5", credits: 1260, note: "default 8s 720p — see :Ns:res variants for exact" },
      { identifier: "seedance-2-5:8s:480p", credits: 560, note: "8s 480p" },
      { identifier: "seedance-2-5:8s:720p", credits: 1260, note: "8s 720p" },
      { identifier: "seedance-2-5:8s:1080p", credits: 3160, note: "8s 1080p" },
      { identifier: "seedance-2-5:8s:480p-ref", credits: 340, note: "8s 480p with reference video" },
      { identifier: "seedance-2-5:8s:720p-ref", credits: 760, note: "8s 720p with reference video" },
      { identifier: "seedance-2-5:8s:1080p-ref", credits: 1900, note: "8s 1080p with reference video" },
      { identifier: "seedance-2-5:30s:480p", credits: 2100, note: "30s 480p (max)" },
      { identifier: "seedance-2-5:30s:720p", credits: 4730, note: "30s 720p (max)" },
      { identifier: "seedance-2-5:30s:1080p", credits: 11850, note: "30s 1080p (max)" },
    ],
  },

  // ── Wan ──
  // Wan 3.0 (standard + Prime) — a NEW generation, not a tier of the 2.x ladder.
  // One id per SKU serves BOTH modes (no t2v twin, no alias): first/last frame
  // OR an all-purpose reference mode (images/videos/audio, bound in the prompt
  // as Image1/Video1/Audio1 — no space, unlike Wan 2.x), native audio behind a
  // boolean `audio` lever, 2-30s at 480p/720p/1080p.
  // `video-reference` is deliberately NOT declared: KIE accepts reference videos,
  // but the extend chain is unwired and KIE caps input-video + output at 30s,
  // which the segment bounds cannot express. Precedent: gemini-omni-video carries
  // ref limits without the feature. The ref CAPS still live in
  // VIDEO_REF_LIMITS_BY_PROVIDER (model-constants).
  // `resolutions` is ascending (repo convention); the DEFAULT tier (720p) is
  // declared explicitly in PRICING_DEFAULT_RESOLUTION, never by array position.
  "wan-3": {
    id: "wan-3",
    unlistedResolutionRendersAs: "720p",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan 3.0",
    series: "Wan",
    description: "Wan 3.0 — multimodal: first/last frame or image/video/audio references, native audio, 2-30s at 480p/720p/1080p.",
    useCases: ["motion", "narrative", "long-form"],
    features: ["end-frame", "audio", "reference-image", "reference-to-video"],
    aspectRatios: VIDEO_RATIOS_WAN_3,
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    defaultDuration: 5,
    resolutions: ["480p", "720p", "1080p"],
    pricing: [
      { identifier: "wan-3", credits: 200, note: "default 5s 720p — see :Ns:res variants for exact" },
      { identifier: "wan-3:5s:720p", credits: 200, note: "5s 720p (the default tier)" },
      { identifier: "wan-3:8s:480p", credits: 160, note: "8s 480p" },
      { identifier: "wan-3:8s:720p", credits: 320, note: "8s 720p" },
      { identifier: "wan-3:8s:1080p", credits: 640, note: "8s 1080p" },
      { identifier: "wan-3:30s:480p", credits: 600, note: "30s 480p (max)" },
      { identifier: "wan-3:30s:720p", credits: 1200, note: "30s 720p (max)" },
      { identifier: "wan-3:30s:1080p", credits: 2400, note: "30s 1080p (max)" },
    ],
  },
  "wan-3-prime": {
    id: "wan-3-prime",
    unlistedResolutionRendersAs: "720p",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan 3.0 Prime",
    series: "Wan",
    description: "Wan 3.0 Prime — Alibaba's high-speed Wan 3.0 tier: same multimodal surface and 2-30s range, faster turnaround at a higher per-second rate.",
    useCases: ["fast", "motion", "narrative"],
    features: ["end-frame", "audio", "reference-image", "reference-to-video"],
    aspectRatios: VIDEO_RATIOS_WAN_3,
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    defaultDuration: 5,
    resolutions: ["480p", "720p", "1080p"],
    pricing: [
      { identifier: "wan-3-prime", credits: 320, note: "default 5s 720p — see :Ns:res variants for exact" },
      { identifier: "wan-3-prime:5s:720p", credits: 320, note: "5s 720p (the default tier)" },
      { identifier: "wan-3-prime:8s:480p", credits: 250, note: "8s 480p" },
      { identifier: "wan-3-prime:8s:720p", credits: 510, note: "8s 720p" },
      { identifier: "wan-3-prime:8s:1080p", credits: 1010, note: "8s 1080p" },
      { identifier: "wan-3-prime:30s:480p", credits: 920, note: "30s 480p (max)" },
      { identifier: "wan-3-prime:30s:720p", credits: 1890, note: "30s 720p (max)" },
      { identifier: "wan-3-prime:30s:1080p", credits: 3780, note: "30s 1080p (max)" },
    ],
  },
  "wan-i2v": {
    id: "wan-i2v",
    kind: "video",
    modes: ["i2v"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan 2.6 I2V",
    series: "Wan",
    description: "Wan 2.6 image-to-video — 5/10/15s at 720p/1080p.",
    useCases: ["motion", "narrative"],
    durations: [5, 10, 15],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "wan-i2v", credits: 175, note: "5s 720p default" },
      { identifier: "wan-i2v:5s", credits: 180 },
      { identifier: "wan-i2v:10s", credits: 350 },
      { identifier: "wan-i2v:15s", credits: 530 },
    ],
  },
  "wan-turbo": {
    id: "wan-turbo",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan 2.2 Turbo",
    series: "Wan",
    description: "Cheap, fast Wan turbo — 5s. Serves both i2v and t2v under one id.",
    useCases: ["cheap", "fast"],
    aspectRatios: VIDEO_RATIOS_HVS,
    durations: [5],
    defaultDuration: 5,
    resolutions: ["480p", "720p"],
    // Different KIE endpoints (i2v vs t2v) → different costs under
    // composite ids. Route picks endpoint based on whether image was supplied.
    pricing: [
      { identifier: "wan-turbo", credits: 100, note: "i2v 5s 480p" },
      { identifier: "wan-turbo-t2v", credits: 200, note: "t2v 5s 720p" },
    ],
  },
  "wan": {
    id: "wan",
    kind: "video",
    // "wan" id covers v2v AND t2v under different KIE endpoints; the
    // pricing variants tag which mode each cost belongs to.
    modes: ["v2v", "t2v"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan 2.6",
    series: "Wan",
    description: "Wan 2.6 — text-to-video and video-to-video under a single id.",
    useCases: ["v2v", "t2v", "restyle"],
    durations: [5],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "wan", credits: 175, note: "v2v 5s 720p" },
      { identifier: "wan-t2v", credits: 270, note: "t2v 5s 1080p" },
    ],
  },
  "wan-flash": {
    id: "wan-flash",
    kind: "video",
    modes: ["v2v"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan Flash V2V",
    series: "Wan",
    description: "Faster Wan V2V variant.",
    useCases: ["v2v", "fast"],
    pricing: [{ identifier: "wan-flash", credits: 100 }],
  },
  "wan-videoedit": {
    id: "wan-videoedit",
    kind: "video",
    modes: ["v2v"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan 2.7 VideoEdit",
    series: "Wan",
    description: "Guided video editing with optional reference image, audio control, and prompt expansion.",
    useCases: ["v2v", "restyle", "reference"],
    resolutions: ["720p", "1080p"],
    pricing: [{ identifier: "wan-videoedit", credits: 320 }],
  },
  // ── Wan 2.7 ──
  "wan-2.7": {
    id: "wan-2.7",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan 2.7",
    series: "Wan",
    description: "Wan 2.7 text-to-image — 1K/2K/4K, up to 9 optional style/character reference images.",
    useCases: ["photorealistic", "stylized", "reference"],
    features: ["reference-image"] as const,
    aspectRatios: WAN_27_IMAGE_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "wan-2.7",    credits: 20,  note: "1K base" },
      { identifier: "wan-2.7:2K", credits: 40,  note: "2K" },
      { identifier: "wan-2.7:4K", credits: 80, note: "4K" },
    ],
  },
  "wan-2.7-pro": {
    id: "wan-2.7-pro",
    kind: "image",
    modes: ["t2i"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan 2.7 Pro",
    series: "Wan",
    description: "Wan 2.7 Pro text-to-image — higher quality, 1K/2K/4K, no image input.",
    useCases: ["photorealistic", "premium"],
    aspectRatios: WAN_27_IMAGE_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    pricing: [
      { identifier: "wan-2.7-pro",    credits: 120,  note: "1K base" },
      { identifier: "wan-2.7-pro:2K", credits: 60,  note: "2K" },
      { identifier: "wan-2.7-pro:4K", credits: 120, note: "4K" },
    ],
  },
  "wan-2.7-i2v": {
    id: "wan-2.7-i2v",
    kind: "video",
    modes: ["i2v"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan 2.7 I2V",
    series: "Wan",
    description: "Wan 2.7 image-to-video — 2–15s at 720p/1080p, supports start+end frame.",
    useCases: ["motion", "narrative"],
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    features: ["end-frame"],
    pricing: [
      { identifier: "wan-2.7-i2v", credits: 188, note: "5s 720p default" },
    ],
  },
  "wan-2.7-t2v": {
    id: "wan-2.7-t2v",
    kind: "video",
    modes: ["t2v"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan 2.7 T2V",
    series: "Wan",
    description: "Wan 2.7 text-to-video — 2–15s at 720p/1080p.",
    useCases: ["motion", "narrative"],
    aspectRatios: VIDEO_RATIOS_HVS345,
    durations: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "wan-2.7-t2v", credits: 188, note: "5s 720p default" },
    ],
  },
  // Lightricks LTX 2.3 (Replicate, not KIE). Both variants run one endpoint per
  // variant and switch behaviour with a `task` discriminator, so t2v and i2v are
  // the SAME id — no VIDEO_MODE_ALIASES row. `extend` / `retake` are separate
  // priced ops on the same model (ids below) but are NOT listed in `modes`:
  // they are driven by the Extend Video / Video Retake nodes' own pickers, and
  // adding the mode here would duplicate LTX in those menus.
  // Bands are lowercase to match LTX_DURATION_TIERS' keys in credit-identifiers.ts
  // and QUALITY_MAP in node-default-mappings.ts.
  "ltx-2.3-pro": {
    id: "ltx-2.3-pro",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Lightricks",
    maker: "lightricks",
    label: "LTX 2.3 Pro",
    series: "LTX",
    description: "Lightricks LTX 2.3 Pro — text/image/audio→video up to 4K, 6/8/10s, end-frame interpolation.",
    useCases: ["premium", "high-res", "narrative"],
    features: ["end-frame", "audio-to-video"],
    aspectRatios: ["16:9", "9:16"] as const,
    resolutions: ["1080p", "2k", "4k"] as const,
    durations: [6, 8, 10],
    defaultDuration: 6,
    pricing: [
      { identifier: "ltx-2.3-pro", credits: 240, note: "default 1080p 6s" },
      { identifier: "ltx-2.3-pro:1080p:6s", credits: 240 },
      { identifier: "ltx-2.3-pro:1080p:8s", credits: 320 },
      { identifier: "ltx-2.3-pro:1080p:10s", credits: 400 },
      { identifier: "ltx-2.3-pro:2k:6s", credits: 480 },
      { identifier: "ltx-2.3-pro:2k:8s", credits: 640 },
      { identifier: "ltx-2.3-pro:2k:10s", credits: 800 },
      { identifier: "ltx-2.3-pro:4k:6s", credits: 960 },
      { identifier: "ltx-2.3-pro:4k:8s", credits: 1280 },
      { identifier: "ltx-2.3-pro:4k:10s", credits: 1600 },
      { identifier: "ltx-2.3-pro-extend:per-second", credits: 40, note: "extend, per second of new footage" },
      { identifier: "ltx-2.3-pro-retake:per-second", credits: 40, note: "retake, per second re-rendered" },
    ],
  },
  "ltx-2.3-fast": {
    id: "ltx-2.3-fast",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Lightricks",
    maker: "lightricks",
    label: "LTX 2.3 Fast",
    series: "LTX",
    description: "Lightricks LTX 2.3 Fast — text/image→video up to 20s at 1080p (6/8/10s at 2K and 4K). No audio input, no extend.",
    useCases: ["long-form", "fast", "narrative"],
    features: ["end-frame"],
    aspectRatios: ["16:9", "9:16"] as const,
    resolutions: ["1080p", "2k", "4k"] as const,
    // Flat union across bands — 12–20s exist only at 1080p (LTX_DURATION_TIERS
    // in credit-identifiers.ts is the per-band authority and snaps a 2k/4k
    // request back onto 6/8/10s, so the reservation is always a real tier).
    durations: [6, 8, 10, 12, 14, 16, 18, 20],
    defaultDuration: 6,
    pricing: [
      { identifier: "ltx-2.3-fast", credits: 180, note: "default 1080p 6s" },
      { identifier: "ltx-2.3-fast:1080p:6s", credits: 180 },
      { identifier: "ltx-2.3-fast:1080p:8s", credits: 240 },
      { identifier: "ltx-2.3-fast:1080p:10s", credits: 300 },
      { identifier: "ltx-2.3-fast:1080p:12s", credits: 360 },
      { identifier: "ltx-2.3-fast:1080p:14s", credits: 420 },
      { identifier: "ltx-2.3-fast:1080p:16s", credits: 480 },
      { identifier: "ltx-2.3-fast:1080p:18s", credits: 540 },
      { identifier: "ltx-2.3-fast:1080p:20s", credits: 600 },
      { identifier: "ltx-2.3-fast:2k:6s", credits: 360 },
      { identifier: "ltx-2.3-fast:2k:8s", credits: 480 },
      { identifier: "ltx-2.3-fast:2k:10s", credits: 600 },
      { identifier: "ltx-2.3-fast:4k:6s", credits: 720 },
      { identifier: "ltx-2.3-fast:4k:8s", credits: 960 },
      { identifier: "ltx-2.3-fast:4k:10s", credits: 1200 },
    ],
  },
  // ── HappyHorse (1.1 — ids kept version-less; repointed in place when KIE
  // delisted 1.0, same param surface, so saved workflows keep working) ──
  "happyhorse": {
    id: "happyhorse",
    kind: "video",
    modes: ["t2v"] as const,
    family: "HappyHorse",
    maker: "alibaba",
    label: "HappyHorse 1.1",
    series: "HappyHorse",
    description: "HappyHorse 1.1 text-to-video — 3–15s at 720p/1080p, 9 aspect ratios incl. 21:9/9:21, per-second pricing.",
    useCases: ["motion", "creative"],
    aspectRatios: VIDEO_RATIOS_HAPPYHORSE_11,
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    noSeed: true,  // HappyHorse 1.1 dropped `seed` from its schema
    pricing: [
      { identifier: "happyhorse", credits: 282, note: "5s 720p default — per-second: ~5.7 cr/s @720p, ~7.3 cr/s @1080p" },
    ],
  },
  "happyhorse-i2v": {
    id: "happyhorse-i2v",
    kind: "video",
    modes: ["i2v"] as const,
    family: "HappyHorse",
    maker: "alibaba",
    label: "HappyHorse 1.1 I2V",
    series: "HappyHorse",
    description: "HappyHorse 1.1 image-to-video — 3–15s at 720p/1080p, aspect ratio inferred from input image, per-second pricing.",
    useCases: ["motion", "creative"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    noSeed: true,  // HappyHorse 1.1 dropped `seed` from its schema
    pricing: [
      { identifier: "happyhorse-i2v", credits: 282, note: "5s 720p default — per-second: ~5.7 cr/s @720p, ~7.3 cr/s @1080p" },
    ],
  },
  "happyhorse-ref2v": {
    id: "happyhorse-ref2v",
    kind: "video",
    modes: ["i2v"] as const,
    family: "HappyHorse",
    maker: "alibaba",
    label: "HappyHorse 1.1 Ref2V",
    series: "HappyHorse",
    description: "HappyHorse 1.1 reference-to-video — 1–9 reference images, 3–15s at 720p/1080p, per-second pricing.",
    useCases: ["motion", "reference"],
    aspectRatios: VIDEO_RATIOS_HAPPYHORSE_11,
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    features: ["reference-image", "reference-to-video"],
    referenceSyntax: "[Image N]",
    noSeed: true,  // HappyHorse 1.1 dropped `seed` from its schema
    pricing: [
      { identifier: "happyhorse-ref2v", credits: 282, note: "5s 720p default — per-second: ~5.7 cr/s @720p, ~7.3 cr/s @1080p" },
    ],
  },
  "happyhorse-edit": {
    id: "happyhorse-edit",
    kind: "video",
    modes: ["v2v"] as const,
    family: "HappyHorse",
    maker: "alibaba",
    label: "HappyHorse Edit",
    series: "HappyHorse",
    description: "HappyHorse video-edit — video-to-video transformation, up to 60s input, 720p/1080p output.",
    useCases: ["v2v", "restyle"],
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "happyhorse-edit", credits: 350, note: "720p default (5s-equivalent flat rate)" },
    ],
  },
  // ── Vidu (ShengShu Technology) ──
  // Vidu Q4 — ONE id over two KIE endpoints, chosen by what is wired:
  // image-to-video (a start frame, no references; the output inherits the
  // frame's shape) and reference-to-video (1-15 reference images + up to 3
  // MP3 reference audio clips; a wired start frame joins the reference images).
  // KIE has NO text-to-video and NO start/end mode for Q4, so `modes` is i2v
  // only — VIDEO_PROVIDERS_REQUIRING_IMAGE derives the friendly "image
  // required" 400 from that — and there is no "end-frame" feature. Native audio
  // behind a boolean `audio` lever, 3-16s, 540p-4k. `resolutions` is ascending
  // (repo convention); the DEFAULT tier (720p) is declared explicitly in
  // PRICING_DEFAULT_RESOLUTION, never by array position.
  "vidu-q4": {
    id: "vidu-q4",
    unlistedResolutionRendersAs: "720p",
    kind: "video",
    modes: ["i2v"] as const,
    family: "Vidu",
    maker: "shengshu",
    label: "Vidu Q4",
    series: "Vidu",
    description: "Vidu Q4 — start-frame or reference-driven video (up to 15 reference images + 3 MP3 voice/sound clips), native audio, 3-16s at 540p to 4K.",
    useCases: ["motion", "reference"],
    features: ["audio", "reference-image", "reference-to-video"],
    aspectRatios: VIDEO_RATIOS_VIDU_Q4,
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    defaultDuration: 5,
    resolutions: ["540p", "720p", "1080p", "2k", "4k"],
    noSeed: true,  // neither Q4 schema has a `seed` (additionalProperties: false)
    pricing: [
      { identifier: "vidu-q4", credits: 190, note: "default 5s 720p — see :Ns:res variants for exact" },
      { identifier: "vidu-q4:5s:720p", credits: 190, note: "5s 720p (the default tier)" },
      { identifier: "vidu-q4:5s:540p", credits: 90, note: "5s 540p" },
      { identifier: "vidu-q4:5s:1080p", credits: 240, note: "5s 1080p" },
      { identifier: "vidu-q4:5s:2k", credits: 380, note: "5s 2K" },
      { identifier: "vidu-q4:5s:4k", credits: 780, note: "5s 4K" },
      { identifier: "vidu-q4:3s:540p", credits: 60, note: "3s 540p (min)" },
      { identifier: "vidu-q4:16s:4k", credits: 2500, note: "16s 4K (max)" },
    ],
  },
  // ── PixVerse ──
  // PixVerse V6 Max — ONE id over two KIE endpoints, picked by what is wired
  // (backend kie/pixverse-v6-max.ts): a start frame runs on
  // docs.kie.ai/market/pixverse/v6-max-image-to-video, where it is the exact
  // first frame and the output takes its shape (no aspect ratio is sent); no
  // image runs on docs.kie.ai/market/pixverse/v6-max-text-to-video, with one of
  // eight aspect ratios. No end frame, no reference images, videos or audio.
  // 1-15s, 360p-1080p (`quality` on the wire). Native audio behind the
  // `generate_audio_switch` lever: the price depends on it, so it bills on the
  // `:audio` rows (AUDIO_ADDON_PROVIDERS), and a request that names no audio
  // setting renders and bills audio ON (decided 2026-11-11). `resolutions` is
  // ascending (repo convention); the default tier (720p) is declared, never
  // carried by array position — 360p is the cheapest preview tier.
  "pixverse-v6-max": {
    id: "pixverse-v6-max",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "PixVerse",
    maker: "pixverse",
    label: "PixVerse V6 Max",
    series: "PixVerse",
    description: "PixVerse V6 Max — cinematic video from text or from an exact first frame, 1–15s at 360p to 1080p, with optional native audio (on by default; it changes the price). Strong prompt following, camera control and on-screen text.",
    useCases: ["cinematic", "narrative", "typography", "motion"],
    features: ["audio"],
    aspectRatios: VIDEO_RATIOS_PIXVERSE_V6_MAX,
    durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ["360p", "540p", "720p", "1080p"],
    defaultResolution: "720p",
    // normalizePixverseV6MaxQuality sends 720p for anything off the list.
    unlistedResolutionRendersAs: "720p",
    // Generate Video Pro runs it from a start anchor or text (decided 2026-11-12).
    gvpWithoutReferences: true,
    pricing: [
      { identifier: "pixverse-v6-max", credits: 150, note: "default 5s 720p with audio — see :Ns:res and :Ns:res:audio variants for exact" },
      { identifier: "pixverse-v6-max:5s:720p:audio", credits: 150, note: "5s 720p with audio (the default tier)" },
      { identifier: "pixverse-v6-max:5s:720p", credits: 110, note: "5s 720p, no audio" },
      { identifier: "pixverse-v6-max:5s:360p", credits: 60, note: "5s 360p, no audio" },
      { identifier: "pixverse-v6-max:5s:1080p:audio", credits: 280, note: "5s 1080p with audio" },
      { identifier: "pixverse-v6-max:1s:360p", credits: 20, note: "1s 360p, no audio (min)" },
      { identifier: "pixverse-v6-max:15s:1080p:audio", credits: 840, note: "15s 1080p with audio (max)" },
    ],
  },
  // ── Bytedance video lite/pro ──
  "bytedance-lite": {
    id: "bytedance-lite",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Bytedance Lite I2V",
    series: "Bytedance",
    description: "Cheapest Bytedance video tier with end-frame support.",
    useCases: ["cheap", "motion"],
    features: ["end-frame"],
    aspectRatios: VIDEO_RATIOS_HVS,
    durations: [5, 10],
    defaultDuration: 5,
    resolutions: ["480p", "720p", "1080p"],
    pricing: [{ identifier: "bytedance-lite", credits: 57 }],
  },
  "bytedance-pro": {
    id: "bytedance-pro",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Bytedance Pro I2V",
    series: "Bytedance",
    description: "Pro Bytedance video tier — better quality.",
    useCases: ["motion", "narrative"],
    aspectRatios: VIDEO_RATIOS_HVS,
    durations: [5, 10],
    defaultDuration: 5,
    resolutions: ["480p", "720p", "1080p"],
    pricing: [{ identifier: "bytedance-pro", credits: 175 }],
  },
  "bytedance-pro-fast": {
    id: "bytedance-pro-fast",
    kind: "video",
    modes: ["i2v"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Bytedance Pro Fast I2V",
    series: "Bytedance",
    description: "Faster Bytedance Pro variant.",
    useCases: ["fast", "motion"],
    durations: [5, 10],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    pricing: [{ identifier: "bytedance-pro-fast", credits: 90 }],
  },

  // ── OpenAI Sora ──
  // (Sora2 / Sora2-Pro are listed in KIE models but not in STATIC_CREDIT_COSTS;
  // they're priced at runtime via the per-second tracker, so we omit pricing
  // arrays with composite entries — `list_models` will fall back to whatever
  // base entry exists.)

  // ── Runway ──
  "runway-kie": {
    id: "runway-kie",
    kind: "video",
    modes: ["i2v", "t2v"] as const,
    family: "Runway",
    maker: "runway",
    label: "Runway (via KIE)",
    series: "Runway",
    description: "Runway Gen-3 routed through KIE. 5/10s at 720p/1080p.",
    useCases: ["motion", "narrative"],
    durations: [5, 10],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    pricing: [{ identifier: "runway-kie", credits: 30, note: "5s 720p" }],
  },
  "runway-aleph": {
    id: "runway-aleph",
    kind: "video",
    modes: ["v2v"] as const,
    family: "Runway",
    maker: "runway",
    label: "Runway Aleph V2V",
    series: "Runway",
    description: "Runway Aleph — video-to-video conversion.",
    useCases: ["v2v", "restyle"],
    pricing: [{ identifier: "runway-aleph", credits: 350, note: "5s clip" }],
  },
  "luma-modify": {
    id: "luma-modify",
    kind: "video",
    modes: ["v2v"] as const,
    family: "Luma",
    maker: "luma",
    label: "Luma Modify",
    series: "Luma",
    description: "Luma Modify — changes or restyles an existing video from a prompt.",
    useCases: ["v2v", "restyle"],
    pricing: [{ identifier: "luma-modify", credits: 320, note: "per clip" }],
  },

  // ── Extend / Upscale ──
  "veo-extend": {
    id: "veo-extend",
    kind: "video",
    modes: ["extend"] as const,
    family: "Google",
    maker: "google",
    label: "VEO Extend",
    series: "VEO",
    description: "Extend an existing VEO 3.1 clip by another segment.",
    useCases: ["extend"],
    pricing: [
      { identifier: "veo-extend", credits: 190, note: "VEO 3.1 Fast default" },
      { identifier: "veo-extend:quality", credits: 790, note: "VEO 3.1 Quality" },
    ],
  },
  "runway-extend": {
    id: "runway-extend",
    kind: "video",
    modes: ["extend"] as const,
    family: "Runway",
    maker: "runway",
    label: "Runway Extend",
    series: "Runway",
    description: "Extend a Runway video by another clip.",
    useCases: ["extend"],
    pricing: [{ identifier: "runway-extend", credits: 320 }],
  },
  // Seedance extends ANY video, one provider per model. Seedance 2.5 is charged
  // per second of video sent (the source's last 10 s, all of a shorter one)
  // and added, at its resolution's row, the price of two seconds (decided
  // 2026-11-12). Seedance 2.0 is priced on its own rows
  // (`tailExtendCreditId`), one per second added and resolution.
  // The earlier single id `seedance-2-extend` is retired and runs as Seedance 2.5.
  "seedance-2-5-extend": {
    id: "seedance-2-5-extend",
    kind: "video",
    modes: ["extend"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedance 2.5 Extend",
    series: "Seedance",
    description: "Extend ANY video with Seedance 2.5: a 4–30s continuation (audio included) of the source's last 10 seconds, joined onto it. Charged per second of video sent and added; the figure is the default run, 8s added at 720p to a source of 10s or more.",
    useCases: ["extend"],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    defaultDuration: 8,
    resolutions: ["480p", "720p", "1080p"],
    pricing: [
      // The default run (8 s added to a source of 10 s or more: 18 s sent and
      // added, 9 units of the two-second row) at each resolution. A run is
      // charged its own seconds: `seedance-2-5-extend:<res>:per-2s` × (sent + added) ÷ 2.
      { identifier: "seedance-2-5-extend:720p:per-2s:9u", credits: 1710, note: "default run: 8s added at 720p to a source of 10s or more — priced per second sent and added" },
      { identifier: "seedance-2-5-extend:480p:per-2s:9u", credits: 765, note: "8s added at 480p to a source of 10s or more" },
      { identifier: "seedance-2-5-extend:1080p:per-2s:9u", credits: 4275, note: "8s added at 1080p to a source of 10s or more" },
    ],
  },
  "seedance-2-0-extend": {
    id: "seedance-2-0-extend",
    kind: "video",
    modes: ["extend"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedance 2.0 Extend",
    series: "Seedance",
    description: "Extend ANY video with Seedance 2.0: 4–15s continuation (audio included), stitched into one seamless clip.",
    useCases: ["extend"],
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 8,
    resolutions: ["480p", "720p", "1080p"],
    pricing: [
      { identifier: "seedance-2-0-extend:8s:720p", credits: 625, note: "default 8s 720p — see :Ns:res variants for exact" },
      { identifier: "seedance-2-0-extend:8s:480p", credits: 288, note: "8s 480p" },
      { identifier: "seedance-2-0-extend:8s:1080p", credits: 1550, note: "8s 1080p" },
    ],
  },
  // Kling 4 extends ANY video with the same tail recipe, generated on Kling
  // 4.0 (`kling-4`, reference-to-video): its own entry, so a deployment can
  // withhold or release it apart from Kling 4.0 generation, and its own rows
  // (`tailExtendCreditId`), one per second added and resolution. Its sound is
  // always on (Kling 4.0 has no switch).
  "kling-4-extend": {
    id: "kling-4-extend",
    kind: "video",
    modes: ["extend"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling 4 Extend",
    series: "Kling",
    description: "Extend ANY video with Kling 4: 3–30s continuation (audio included), stitched into one seamless clip.",
    useCases: ["extend"],
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
    defaultDuration: 5,
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "kling-4-extend:5s:720p", credits: 425, note: "default 5s 720p — see :Ns:res variants for exact" },
      { identifier: "kling-4-extend:5s:1080p", credits: 638, note: "5s 1080p" },
    ],
  },
  // PixVerse V6 extends ANY video natively (no tail recipe): the whole source
  // goes to its extend, which returns it with the new seconds joined on; the
  // run keeps the user's own source and joins only the new seconds to it. Its
  // own entry, so a deployment can withhold it apart from PixVerse V6 Max, and
  // its own rows (`pixverseExtendCreditId`): one per second added and quality,
  // `:audio` with sound (on unless turned off). `resolutions` is ascending
  // (repo convention); the default quality (720p) is the extend's own, as on
  // the other extend entries (`pixverseExtendQuality`), never declared here.
  "pixverse-v6-extend": {
    id: "pixverse-v6-extend",
    kind: "video",
    modes: ["extend"] as const,
    family: "PixVerse",
    maker: "pixverse",
    label: "PixVerse V6 Extend",
    series: "PixVerse",
    description: "Extend ANY video with PixVerse V6: 1–15s continuation at 360p to 1080p, with optional sound, joined onto your original clip.",
    useCases: ["extend"],
    durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    defaultDuration: 5,
    resolutions: ["360p", "540p", "720p", "1080p"],
    pricing: [
      { identifier: "pixverse-v6-extend:5s:720p:audio", credits: 120, note: "default 5s 720p with sound — see :Ns:quality and :Ns:quality:audio variants for exact" },
      { identifier: "pixverse-v6-extend:5s:720p", credits: 90, note: "5s 720p, no sound" },
      { identifier: "pixverse-v6-extend:5s:540p:audio", credits: 90, note: "5s 540p with sound" },
      { identifier: "pixverse-v6-extend:1s:360p", credits: 10, note: "1s 360p, no sound (min)" },
      { identifier: "pixverse-v6-extend:15s:1080p:audio", credits: 690, note: "15s 1080p with sound (max)" },
    ],
  },
  // Grok extends only its OWN clips: a completed Grok Imagine text-to-video
  // or image-to-video run of the same user, named by its task (KIE takes no
  // clip URL and no other model's task). It adds 6 or 10 s and returns the
  // source with them joined on, delivered as it is. Billed at the SOURCE's
  // resolution, which is never a lever — so no `resolutions` here: the run is
  // priced on the row the source check answers (`grokExtendCreditId`), and a
  // run whose source is not known yet is quoted at the dearer 720p row, the
  // row this entry leads with. Its own entry, so a deployment can withhold it
  // apart from Grok Imagine.
  "grok-extend": {
    id: "grok-extend",
    kind: "video",
    modes: ["extend"] as const,
    family: "xAI",
    maker: "xai",
    label: "Grok Imagine Extend",
    series: "Grok",
    description: "Extend a Grok Imagine video you made here (from text or an image) by 6 or 10 seconds, at the video's own resolution (480p or 720p).",
    useCases: ["extend"],
    durations: [6, 10],
    defaultDuration: 6,
    pricing: [
      { identifier: "grok-extend:6s:720p", credits: 70, note: "6s from a 720p source (the quote while the source is not known)" },
      { identifier: "grok-extend:6s:480p", credits: 40, note: "6s from a 480p source" },
      { identifier: "grok-extend:10s:480p", credits: 60, note: "10s from a 480p source" },
      { identifier: "grok-extend:10s:720p", credits: 120, note: "10s from a 720p source" },
    ],
  },
  "veo-1080p": {
    id: "veo-1080p",
    kind: "video",
    modes: ["video-upscale"] as const,
    family: "Google",
    maker: "google",
    label: "VEO 1080p Upscale",
    series: "VEO",
    description: "Upscale VEO output to 1080p.",
    useCases: ["upscale"],
    pricing: [{ identifier: "veo-1080p", credits: 20 }],
  },
  "veo-4k": {
    id: "veo-4k",
    kind: "video",
    modes: ["video-upscale"] as const,
    family: "Google",
    maker: "google",
    label: "VEO 4K Upscale",
    series: "VEO",
    description: "Upscale VEO output to 4K.",
    useCases: ["upscale", "high-res"],
    pricing: [{ identifier: "veo-4k", credits: 380 }],
  },
  // Seedance 2.5 Draft finalize (seedance-draft.ts): re-renders a Seedance 2.5
  // DRAFT as the same take at 1080p. Priced per output second of the draft; a
  // draft made with a reference VIDEO bills its `-ref` rate on input + output
  // seconds. Only works on a completed Seedance 2.5 draft.
  "seedance-2-5-hd": {
    id: "seedance-2-5-hd",
    kind: "video",
    modes: ["video-upscale"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "Seedance 2.5 HD (from draft)",
    series: "Seedance",
    description: "Finalize a Seedance 2.5 draft: the same take, frame for frame, re-rendered at 1080p.",
    useCases: ["upscale", "high-res"],
    pricing: [
      { identifier: "seedance-2-5-hd", credits: 3160, note: "default 8s — see :Ns variants for exact" },
      { identifier: "seedance-2-5-hd:4s", credits: 1580, note: "4s draft" },
      { identifier: "seedance-2-5-hd:8s", credits: 3160, note: "8s draft" },
      { identifier: "seedance-2-5-hd:30s", credits: 11850, note: "30s draft (max)" },
      { identifier: "seedance-2-5-hd:8s-ref", credits: 1900, note: "per-second rate of a draft made with a reference video; billed on input + output seconds" },
    ],
  },
  "topaz-video": {
    id: "topaz-video",
    kind: "video",
    modes: ["video-upscale"] as const,
    family: "Topaz",
    maker: "topaz-labs",
    label: "Topaz Video Upscale",
    series: "Topaz",
    description: "High-quality video upscale and enhancement to 720p, 1080p or 4K at 15–60 fps (frames are interpolated). Metered: the price is per Topaz unit, and a run uses a few units per output gigapixel.",
    useCases: ["upscale", "premium"],
    // Metered: a run holds its output-gigapixel ceiling and is charged the
    // Topaz units the provider reports, never above the hold.
    pricing: [{ identifier: "topaz-video:per-unit", credits: 40, note: "per Topaz unit (metered)" }],
  },
  // Nodaro Video Upscale (decided 2026-11-11): offered under the deployment's
  // own label, so it names no maker, and only where the deployment serves it
  // (the backend's house-model seam). Priced per second of the clip
  // (the clip's length rounded up to a whole second): each tier's row is the
  // price of FOUR seconds, so a per-second rate that is not a whole credit
  // still fits a whole-credit row, and a run is charged row × seconds ÷ 4,
  // rounded up once (`@nodaro/render-rules` nodaro-video-upscale-pricing.ts).
  "nodaro-video-upscale": {
    id: "nodaro-video-upscale",
    kind: "video",
    modes: ["video-upscale"] as const,
    family: "Nodaro Upscale",
    ownLabel: true,
    label: "Nodaro Video Upscale",
    series: "Nodaro Upscale",
    description: "Upscale any clip of up to 60 seconds and 50 MB into a 1080p, 2K or 4K frame. It keeps the clip's shape (nothing is cropped), frame rate, length and sound. Priced per second of the clip; the listed price is four seconds at 1080p.",
    useCases: ["upscale", "high-res"],
    // An output box (1920×1080, 2560×1440, 3840×2160; turned for a portrait clip).
    resolutions: ["1080p", "2k", "4k"],
    defaultResolution: "1080p",
    pricing: [
      { identifier: "nodaro-video-upscale:1080p:per-4s", credits: 15, note: "per 4 seconds of the clip at 1080p; charged per whole second" },
      { identifier: "nodaro-video-upscale:2k:per-4s", credits: 30, note: "per 4 seconds of the clip at 2K; charged per whole second" },
      { identifier: "nodaro-video-upscale:4k:per-4s", credits: 60, note: "per 4 seconds of the clip at 4K; charged per whole second" },
    ],
  },

  // ── Motion transfer ──
  "motion-transfer": {
    id: "motion-transfer",
    kind: "video",
    modes: ["motion-transfer"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling 2.6 Motion Transfer",
    series: "Kling",
    description: "Transfer the motion from a driving video onto a still subject. Kling 2.6 base.",
    useCases: ["motion-transfer"],
    durations: [5, 10, 15, 30],
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "motion-transfer", credits: 150, note: "10s 720p default" },
      { identifier: "motion-transfer:5s", credits: 80 },
      { identifier: "motion-transfer:10s", credits: 150 },
      { identifier: "motion-transfer:15s", credits: 230 },
      { identifier: "motion-transfer:30s", credits: 450 },
      { identifier: "motion-transfer:1080p:10s", credits: 230 },
    ],
  },
  "kling-3.0-motion": {
    id: "kling-3.0-motion",
    kind: "video",
    modes: ["motion-transfer"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling 3.0 Motion Transfer",
    series: "Kling",
    description: "Premium motion transfer via Kling 3.0.",
    useCases: ["motion-transfer", "premium"],
    durations: [5, 10, 15, 30],
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "kling-3.0-motion", credits: 300, note: "10s 720p default" },
      { identifier: "kling-3.0-motion:5s", credits: 150 },
      { identifier: "kling-3.0-motion:10s", credits: 300 },
      { identifier: "kling-3.0-motion:1080p:10s", credits: 500 },
    ],
  },
  // Wan Animate (decided 2026-11-12): catalog entries so a deployment's model
  // restriction can name them. Before, `models.allow` could not withhold them
  // while the Motion Transfer node and /v1/motion-transfer kept running them
  // beside the Kling models. The sizes are the three each runs at and is priced
  // on today (one flat row per size, any clip length); a size it does not have
  // (the route's 1080p) runs, and is charged, as 720p — `defaultResolution`, the
  // size `normalizeModelInput` moves it to (`motionTransferResolution`), and
  // the size a request naming none has always run at.
  "wan-animate-move": {
    id: "wan-animate-move",
    kind: "video",
    modes: ["motion-transfer"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan Animate Move",
    series: "Wan",
    description: "Wan 2.2 Animate: moves the subject of a still image with the motion of a driving video.",
    useCases: ["motion-transfer", "cheap"],
    resolutions: ["480p", "580p", "720p"],
    defaultResolution: "720p",
    pricing: [
      { identifier: "wan-animate-move", credits: 255, note: "480p" },
      { identifier: "wan-animate-move:580p", credits: 330, note: "580p" },
      { identifier: "wan-animate-move:720p", credits: 410, note: "720p" },
    ],
  },
  "wan-animate-replace": {
    id: "wan-animate-replace",
    kind: "video",
    modes: ["motion-transfer"] as const,
    family: "Alibaba",
    maker: "alibaba",
    label: "Wan Animate Replace",
    series: "Wan",
    description: "Wan 2.2 Animate: replaces the person in a driving video with the subject of a still image, keeping the motion.",
    useCases: ["motion-transfer", "character-swap"],
    resolutions: ["480p", "580p", "720p"],
    defaultResolution: "720p",
    pricing: [
      { identifier: "wan-animate-replace", credits: 255, note: "480p" },
      { identifier: "wan-animate-replace:580p", credits: 330, note: "580p" },
      { identifier: "wan-animate-replace:720p", credits: 410, note: "720p" },
    ],
  },

  // ── Lip sync / talking-head ──
  "kling-avatar": {
    id: "kling-avatar",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling Avatar Standard",
    series: "Kling",
    description: "Lip-sync a still portrait to driving audio. Standard quality.",
    useCases: ["lip-sync", "talking-head"],
    pricing: [{ identifier: "kling-avatar", credits: 280, note: "~14s default" }],
  },
  "kling-avatar-pro": {
    id: "kling-avatar-pro",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "Kuaishou",
    maker: "kuaishou",
    label: "Kling Avatar Pro",
    series: "Kling",
    description: "Premium lip-sync — better mouth shape and timing.",
    useCases: ["lip-sync", "talking-head", "premium"],
    pricing: [{ identifier: "kling-avatar-pro", credits: 560 }],
  },
  "infinitalk": {
    id: "infinitalk",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "InfiniTalk",
    maker: "meituan",
    label: "InfiniTalk",
    series: "InfiniTalk",
    description: "Audio-driven talking-head from a still image. 480p / 720p.",
    useCases: ["lip-sync", "talking-head"],
    resolutions: ["480p", "720p"],
    pricing: [
      { identifier: "infinitalk", credits: 420, note: "720p default" },
      { identifier: "infinitalk:480p", credits: 110 },
      { identifier: "infinitalk:720p", credits: 420 },
    ],
  },
  "omnihuman-1-5": {
    id: "omnihuman-1-5",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "OmniHuman 1.5",
    series: "OmniHuman",
    description: "Premium prompt-directed talking avatar from a still image + audio. 720p / 1080p, up to 60s. People, pets, anime.",
    useCases: ["lip-sync", "talking-head", "premium"],
    resolutions: ["720p", "1080p"],
    pricing: [
      { identifier: "omnihuman-1-5", credits: 4050, note: "60s ceiling (no duration given)" },
      { identifier: "omnihuman-1-5:15s", credits: 1020 },
      { identifier: "omnihuman-1-5:30s", credits: 2030 },
      { identifier: "omnihuman-1-5:60s", credits: 4050 },
    ],
  },
  // A different model from 1.5, offered beside it (decided 2026-11-11): one
  // image, 4 to 300 seconds of audio, 720p output, an optional prompt. It has
  // none of 1.5's levers — no speaker mask, no resolution, no fast mode, no
  // seed — so it declares no `resolutions` (`normalizeModelInput` drops one).
  // Charged per second of its audio at one rate (LIP_SYNC_AUDIO_RATES).
  "omnihuman-2-0": {
    id: "omnihuman-2-0",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "Bytedance",
    maker: "bytedance",
    label: "OmniHuman 2.0",
    series: "OmniHuman",
    description: "Talking avatar from one still image + audio, driven by the voice with an optional prompt for the scene, motion and camera. 720p, 4 seconds to 5 minutes, charged per second of audio.",
    useCases: ["lip-sync", "talking-head", "long-form"],
    pricing: [
      { identifier: "omnihuman-2-0:per-second", credits: 35, note: "per second of audio, rounded up; at least 4 seconds" },
    ],
  },
  "hailuo-avatar": {
    id: "hailuo-avatar",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "MiniMax",
    maker: "minimax",
    label: "Hailuo Avatar",
    series: "Hailuo",
    description: "MiniMax avatar lip-sync.",
    useCases: ["lip-sync", "talking-head"],
    pricing: [{ identifier: "hailuo-avatar", credits: 190 }],
    // Not wired in any provider / not in LIP_SYNC_PROVIDERS — hide from MCP
    // list_models so the lip_sync tool can't advertise a model its route
    // rejects with a 400. Re-expose when the provider lands.
    mcpHidden: true,
  },
  "sync-lipsync-v3": {
    id: "sync-lipsync-v3",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "Sync",
    maker: "sync-labs",
    label: "Sync Lipsync v3",
    series: "Sync",
    description: "Dub existing footage — re-syncs lips to a new audio track. Video input, billed per second.",
    useCases: ["lip-sync", "dubbing", "video-to-video"],
    pricing: [
      { identifier: "sync-lipsync-v3", credits: 20000, note: "5-min ceiling (no duration given)" },
      { identifier: "sync-lipsync-v3:15s", credits: 1000 },
      { identifier: "sync-lipsync-v3:30s", credits: 2000 },
      { identifier: "sync-lipsync-v3:60s", credits: 4000 },
      { identifier: "sync-lipsync-v3:120s", credits: 8000 },
      { identifier: "sync-lipsync-v3:300s", credits: 20000, note: "5-min ceiling" },
    ],
  },
  "volcengine-lipsync": {
    id: "volcengine-lipsync",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "Volcengine",
    maker: "bytedance",
    label: "Volcengine Lip Sync",
    series: "Volcengine",
    description: "Video-to-video AI dubbing — re-syncs lips to a new vocal track. Multi-speaker (scene detection + speaker ID) in basic mode. Video input, billed per second.",
    useCases: ["lip-sync", "dubbing", "video-to-video"],
    pricing: [
      { identifier: "volcengine-lipsync", credits: 6000, note: "5-min ceiling (no duration given)" },
      { identifier: "volcengine-lipsync:15s", credits: 300 },
      { identifier: "volcengine-lipsync:30s", credits: 600 },
      { identifier: "volcengine-lipsync:60s", credits: 1200 },
      { identifier: "volcengine-lipsync:120s", credits: 2400 },
      { identifier: "volcengine-lipsync:300s", credits: 6000, note: "5-min ceiling" },
    ],
  },
  // LatentSync, HeyGen Lipsync Precision and Lipsync 2 Pro run on Replicate
  // (providers/replicate/lip-sync.ts). Listed so a deployment's model
  // restriction can name them (decided 2026-11-12); what they are sent and
  // charged did not change. They take no size: the result keeps the size of the
  // video they are given.
  "latentsync": {
    id: "latentsync",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "LatentSync",
    maker: "bytedance",
    label: "LatentSync",
    series: "LatentSync",
    description: "Diffusion lip sync on an existing video — strong on singing and expressive vocals. Video input.",
    useCases: ["lip-sync", "dubbing", "video-to-video"],
    pricing: [{ identifier: "latentsync", credits: 7 }],
  },
  "heygen-lipsync-precision": {
    id: "heygen-lipsync-precision",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "HeyGen",
    maker: "heygen",
    label: "HeyGen Lipsync Precision",
    series: "HeyGen",
    description: "Dub existing footage with precise lip sync to a new audio track. Video input, billed per second.",
    useCases: ["lip-sync", "dubbing", "video-to-video"],
    pricing: [
      { identifier: "heygen-lipsync-precision", credits: 10010, note: "5-min ceiling (no duration given)" },
      { identifier: "heygen-lipsync-precision:15s", credits: 510 },
      { identifier: "heygen-lipsync-precision:30s", credits: 1010 },
      { identifier: "heygen-lipsync-precision:60s", credits: 2010 },
      { identifier: "heygen-lipsync-precision:120s", credits: 4010 },
      { identifier: "heygen-lipsync-precision:300s", credits: 10010, note: "5-min ceiling" },
    ],
  },
  "lipsync-2-pro": {
    id: "lipsync-2-pro",
    kind: "video",
    modes: ["lip-sync"] as const,
    family: "Sync",
    maker: "sync-labs",
    label: "Lipsync 2 Pro",
    series: "Sync",
    description: "Studio-grade lip sync on existing footage, re-synced to a new audio track. Video input, billed per second.",
    useCases: ["lip-sync", "dubbing", "video-to-video", "premium"],
    pricing: [
      { identifier: "lipsync-2-pro", credits: 12490, note: "5-min ceiling (no duration given)" },
      { identifier: "lipsync-2-pro:15s", credits: 630 },
      { identifier: "lipsync-2-pro:30s", credits: 1250 },
      { identifier: "lipsync-2-pro:60s", credits: 2500 },
      { identifier: "lipsync-2-pro:120s", credits: 5000 },
      { identifier: "lipsync-2-pro:300s", credits: 12490, note: "5-min ceiling" },
    ],
  },
  // ── Video Depth ── (video-depth node; priced by the input clip's length via
  // videoDepthCreditId in video-depth.ts — `<provider>:<n>s`, one row per whole
  // second of the clip (`pricedClipSeconds`), representative rows below: `:1s` …
  // `:300s` on Video Depth Anything, `:1s` … `:80s` on Depth Anything per frame.
  // Bare row = the provider's longest clip: 300 s and 80 s.)
  "video-depth-anything": {
    id: "video-depth-anything",
    kind: "video",
    modes: ["video-depth"] as const,
    family: "Depth Anything",
    maker: "bytedance",
    label: "Video Depth Anything",
    series: "Depth Anything",
    description: "Temporally consistent depth video from any clip. Grayscale or colormapped, up to 2,400 frames or 300 seconds.",
    useCases: ["depth", "video-to-video", "compositing"],
    pricing: [
      { identifier: "video-depth-anything", credits: 6000, note: "5-min ceiling (no duration given)" },
      { identifier: "video-depth-anything:1s", credits: 20, note: "1s (min) — priced per second of the clip at this row's credits, the length rounded up after ignoring up to 0.05 s past a whole second" },
      { identifier: "video-depth-anything:15s", credits: 300, note: "15s" },
      { identifier: "video-depth-anything:60s", credits: 1200, note: "1 min" },
      { identifier: "video-depth-anything:300s", credits: 6000, note: "5-min ceiling (max)" },
    ],
  },
  "depth-anything-frames": {
    id: "depth-anything-frames",
    kind: "video",
    modes: ["video-depth"] as const,
    family: "Depth Anything",
    maker: "bytedance",
    label: "Depth Anything (per frame)",
    series: "Depth Anything",
    description: "Depth Anything v1 run on each frame. Grayscale or inferno colormap; may flicker between frames. Up to 80 s.",
    useCases: ["depth", "video-to-video"],
    pricing: [
      { identifier: "depth-anything-frames", credits: 160, note: "80s ceiling (no duration given)" },
      { identifier: "depth-anything-frames:1s", credits: 2, note: "1s (min) — priced per second of the clip at this row's credits, the length rounded up after ignoring up to 0.05 s past a whole second" },
      { identifier: "depth-anything-frames:15s", credits: 30, note: "15s" },
      { identifier: "depth-anything-frames:60s", credits: 120, note: "1 min" },
      { identifier: "depth-anything-frames:80s", credits: 160, note: "80s ceiling (max)" },
    ],
  },
  // ── Gemini video analysis ── (Gemini-only; billed per duration bucket — the
  // structural credit formula lives in video-analysis-pricing.ts. Composite id
  // shape `video-analysis:<model>:<bucket>s` mirrors volcengine-lipsync: bare
  // row = per-model namespace root at the 10-min ceiling, plus one row per bucket.)
  "gemini-3.8-flash-video-analysis": {
    id: "gemini-3.8-flash-video-analysis",
    kind: "video",
    modes: ["video-analysis"] as const,
    family: "Nodaro",
    maker: "nodaro",
    label: "Video Analysis (Fast)",
    series: "Video Analysis",
    description: "Analyze a video into a structured shot list (scenes, camera, audio) — fast, economy tier. Billed per duration bucket.",
    useCases: ["video-analysis", "shot-list", "fast"],
    pricing: [
      { identifier: "video-analysis:gemini-3.8-flash", credits: 880, note: "10-min ceiling (no duration given)" },
      { identifier: "video-analysis:gemini-3.8-flash:60s", credits: 186 },
      { identifier: "video-analysis:gemini-3.8-flash:180s", credits: 193 },
      { identifier: "video-analysis:gemini-3.8-flash:360s", credits: 534 },
      { identifier: "video-analysis:gemini-3.8-flash:600s", credits: 880, note: "10-min ceiling" },
    ],
  },
  "gemini-3-flash-video-analysis": {
    id: "gemini-3-flash-video-analysis",
    kind: "video",
    modes: ["video-analysis"] as const,
    family: "Nodaro",
    maker: "nodaro",
    label: "Video Analysis (Fast — previous)",
    series: "Video Analysis",
    description: "Previous fast-tier analysis model (backed the fast tier until 2026-11-13). Kept so stored raw-model configs keep running and keep pricing under their own identifier; their runs are served by the current fast model.",
    useCases: ["video-analysis", "shot-list", "fast"],
    pricing: [
      { identifier: "video-analysis:gemini-3-flash", credits: 848, note: "10-min ceiling (no duration given)" },
      { identifier: "video-analysis:gemini-3-flash:60s", credits: 181 },
      { identifier: "video-analysis:gemini-3-flash:180s", credits: 185 },
      { identifier: "video-analysis:gemini-3-flash:360s", credits: 515 },
      { identifier: "video-analysis:gemini-3-flash:600s", credits: 848, note: "10-min ceiling" },
    ],
  },
  "gemini-3.6-flash-video-analysis": {
    id: "gemini-3.6-flash-video-analysis",
    kind: "video",
    modes: ["video-analysis"] as const,
    family: "Nodaro",
    maker: "nodaro",
    label: "Video Analysis (Fast — legacy)",
    series: "Video Analysis",
    description: "Legacy fast-tier analysis model (backed the fast tier from 2026-07 until 2026-07-29). Kept so stored raw-model configs keep running and keep pricing under their own identifier; new fast-tier runs use the current fast model.",
    useCases: ["video-analysis", "shot-list", "fast"],
    pricing: [
      { identifier: "video-analysis:gemini-3.6-flash", credits: 992, note: "10-min ceiling (no duration given)" },
      { identifier: "video-analysis:gemini-3.6-flash:60s", credits: 204 },
      { identifier: "video-analysis:gemini-3.6-flash:180s", credits: 219 },
      { identifier: "video-analysis:gemini-3.6-flash:360s", credits: 602 },
      { identifier: "video-analysis:gemini-3.6-flash:600s", credits: 992, note: "10-min ceiling" },
    ],
  },
  "gemini-3.1-pro-video-analysis": {
    id: "gemini-3.1-pro-video-analysis",
    kind: "video",
    modes: ["video-analysis"] as const,
    family: "Nodaro",
    maker: "nodaro",
    label: "Video Analysis (Pro)",
    series: "Video Analysis",
    description: "Analyze a video into a structured shot list (scenes, camera, audio) — higher-fidelity, default tier. Billed per duration bucket.",
    useCases: ["video-analysis", "shot-list", "cinematic"],
    pricing: [
      { identifier: "video-analysis:gemini-3.1-pro", credits: 1056, note: "10-min ceiling (no duration given)" },
      { identifier: "video-analysis:gemini-3.1-pro:60s", credits: 216 },
      { identifier: "video-analysis:gemini-3.1-pro:180s", credits: 232 },
      { identifier: "video-analysis:gemini-3.1-pro:360s", credits: 640 },
      { identifier: "video-analysis:gemini-3.1-pro:600s", credits: 1056, note: "10-min ceiling" },
    ],
  },
  // ULTRA (since 2026-11-13) — the deepest-reasoning analysis model reading
  // every window, at the same frame sampling as the other single-model tiers.
  // Priced between the mixed tiers and smart.
  "gemini-4-carbon-video-analysis": {
    id: "gemini-4-carbon-video-analysis",
    kind: "video",
    modes: ["video-analysis"] as const,
    family: "Nodaro",
    maker: "nodaro",
    label: "Video Analysis (Ultra)",
    series: "Video Analysis",
    description: "Deep-reasoning analysis — the most thorough model reads every window of the video. Better on fast cuts and on scenes with many people, and it does not invent cuts. Billed per duration bucket.",
    // Not `most-accurate`: that tag is Smart's (hand-counted edit list, always
    // refined). Ultra's strengths are the footage that trips the other tiers.
    useCases: ["video-analysis", "shot-list", "premium", "fast-cuts", "many-people", "no-invented-cuts"],
    pricing: [
      { identifier: "video-analysis:gemini-4-carbon", credits: 1745, note: "10-min ceiling (no duration given)" },
      { identifier: "video-analysis:gemini-4-carbon:60s", credits: 349 },
      { identifier: "video-analysis:gemini-4-carbon:180s", credits: 375 },
      { identifier: "video-analysis:gemini-4-carbon:360s", credits: 1054 },
      { identifier: "video-analysis:gemini-4-carbon:600s", credits: 1745, note: "10-min ceiling" },
    ],
  },
  // Both mixed tiers are variants of the same advanced multi-engine analysis
  // and share this ONE credit family (videoAnalysisCreditSegment maps both;
  // plan internals live in the private analysis plugin).
  "mixed-video-analysis": {
    id: "mixed-video-analysis",
    kind: "video",
    modes: ["video-analysis"] as const,
    family: "Nodaro",
    maker: "nodaro",
    label: "Video Analysis (Mixed)",
    series: "Video Analysis",
    description: "Our most advanced analysis tier — multiple analysis engines combined into one result for maximum completeness and accuracy. Billed per duration bucket.",
    useCases: ["video-analysis", "shot-list", "premium", "most-complete"],
    pricing: [
      { identifier: "video-analysis:mixed", credits: 1209, note: "10-min ceiling (no duration given)" },
      { identifier: "video-analysis:mixed:60s", credits: 275 },
      { identifier: "video-analysis:mixed:180s", credits: 298 },
      { identifier: "video-analysis:mixed:360s", credits: 748 },
      { identifier: "video-analysis:mixed:600s", credits: 1209, note: "10-min ceiling" },
    ],
  },
  // SMART — the accuracy tier. Since the 2026-08-03 hybrid re-plan it is a
  // multi-roll plan like the others: a native skeleton pass blended with
  // several donor analysis rolls, with the merged result always refined
  // (it ignores `selectionMode` — see video-analysis-pricing.ts). Priced
  // well above them because it genuinely costs more to run.
  "smart-video-analysis": {
    id: "smart-video-analysis",
    kind: "video",
    modes: ["video-analysis"] as const,
    family: "Nodaro",
    maker: "nodaro",
    label: "Video Analysis (Smart)",
    series: "Video Analysis",
    description: "Highest-accuracy analysis — a hybrid pass that blends a native skeleton read with several donor analysis rolls, then always refines the merged result to find shot boundaries and identify the cast by appearance. Best choice when the shot list will drive regeneration. Billed per duration bucket.",
    useCases: ["video-analysis", "shot-list", "premium", "most-accurate"],
    pricing: [
      { identifier: "video-analysis:smart", credits: 2097, note: "10-min ceiling (no duration given)" },
      { identifier: "video-analysis:smart:60s", credits: 416 },
      { identifier: "video-analysis:smart:180s", credits: 508 },
      { identifier: "video-analysis:smart:360s", credits: 1280 },
      { identifier: "video-analysis:smart:600s", credits: 2097, note: "10-min ceiling" },
    ],
  },
  // ── AI Audit (`video-audit`) ── a SEPARATE node from video-analysis (own
  // node type, own route in the private plugin): it re-watches a clip
  // against its analysis (auto-running a fast analysis first when none is
  // wired), applies video-verified corrections under guards, and returns a
  // disclosed report of what was checked, fixed, and left open. These two
  // rows exist for pricing/MCP-discovery visibility only — the node has no
  // model picker in V1, so their `modes` has no Models-tab mapping (see
  // model-tree.ts's MODE_TO_NODE) — they must never appear as selectable
  // "video-analysis" models. Their `series` ("AI Audit", their own line) only
  // names the line for filtering; the Models tab lists node-creatable models
  // alone, so it never surfaces them. Two credit families, chosen by
  // whether an analysis is wired into the node; the structural formula lives
  // in video-analysis-pricing.ts.
  "video-audit": {
    id: "video-audit",
    kind: "video",
    modes: ["video-audit"] as const,
    family: "Nodaro",
    maker: "nodaro",
    label: "AI Audit",
    series: "AI Audit",
    description: "Re-watches a clip against a wired analysis, applies video-verified corrections under guards, and returns a disclosed report of what changed. Billed per duration bucket.",
    useCases: ["video-audit", "qa", "shot-list", "verification"],
    pricing: [
      { identifier: "video-audit", credits: 1073, note: "10-min ceiling (no duration given)" },
      { identifier: "video-audit:60s", credits: 215 },
      { identifier: "video-audit:180s", credits: 290 },
      { identifier: "video-audit:360s", credits: 663 },
      { identifier: "video-audit:600s", credits: 1073, note: "10-min ceiling" },
    ],
  },
  "video-audit-auto": {
    id: "video-audit-auto",
    kind: "video",
    modes: ["video-audit"] as const,
    family: "Nodaro",
    maker: "nodaro",
    label: "AI Audit (with analysis run)",
    series: "AI Audit",
    description: "Same video-verified audit as AI Audit, but auto-runs a fast analysis first when none is wired in, then applies corrections under guards and returns a disclosed report. Billed per duration bucket.",
    useCases: ["video-audit", "qa", "shot-list", "verification", "auto-analysis"],
    pricing: [
      { identifier: "video-audit:auto", credits: 1953, note: "10-min ceiling (no duration given)" },
      { identifier: "video-audit:auto:60s", credits: 401 },
      { identifier: "video-audit:auto:180s", credits: 483 },
      { identifier: "video-audit:auto:360s", credits: 1197 },
      { identifier: "video-audit:auto:600s", credits: 1953, note: "10-min ceiling" },
    ],
  },
}

// =============================================================================
// AUDIO MODELS
// =============================================================================
// Languages each speech model is offered in. The three lists nest: Multilingual
// v2 ⊂ Flash v2.5 ⊂ v3.
const TTS_LANGS_MULTILINGUAL_V2 = [
  "en", "ja", "zh", "de", "hi", "fr", "ko", "pt", "it", "es", "id", "nl", "tr", "fil", "pl",
  "sv", "bg", "ro", "ar", "cs", "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "ru",
] as const
const TTS_LANGS_FLASH_V25 = [...TTS_LANGS_MULTILINGUAL_V2, "hu", "no", "vi"] as const
const TTS_LANGS_V3 = [
  ...TTS_LANGS_FLASH_V25,
  "he", "th", "bn", "ur", "fa", "sr", "lt", "lv", "et", "ka", "is", "ca", "af", "sw",
] as const
// Every lever the v2 families are sent today.
const TTS_LEVERS_V2 = ["stability", "similarity", "style", "speed", "speakerBoost"] as const
/**
 * ElevenLabs Dialogue v4's total-character cap across lines — ONE constant, so
 * the live probe's answer lands in one place. Measured 2026-10-06: a
 * 10,000-character v4 dialogue returned 200, voiced its last line and finished
 * whole in 130 s, well inside the funnel's 300 s timeout
 * (`DIALOGUE_GENERATION_TIMEOUT_MS`); decided 2026-10-07 to raise the cap to
 * that number, twice v3 dialogue's 5,000. Length pricing charges
 * `min(total, cap)`, so the same unit rows reach 10,000 characters without a
 * new row. ElevenLabs recommends ≤ 2,000 for quality on either model.
 */
const DIALOGUE_V4_MAX_CHARS = 10000
/**
 * ElevenLabs v4 Turbo's per-request character cap — ONE constant, so a change
 * of the owner's rule lands in one place. The vendor declares 10,000, the same
 * as v4 (`maximum_text_length_per_request`, measured 2026-10-07); live, both a
 * 10,000- and a 10,001-character request returned 200 (the vendor accepts over
 * its declared figure), so the platform clamps at the declared figure — the
 * smaller of the two. Decided 2026-10-07: the model takes that whole cap because
 * it ships priced per started 100 characters. An instance that still prices
 * speech flat charges the flat row for any length (the Text to Speech docs say so).
 */
const V4_TURBO_MAX_CHARS = 10000

/**
 * Gemini 3.8 (Flash-Lite, Flash) speech, one speaker: its own 70 voices, its
 * closed list of `<angle>` tone tags, a free-text style per line. No language
 * field, no timings, no neighbour text, no ElevenLabs levers. From the
 * provider's schema (2026-11-12); whether each tag is performed rather than
 * read aloud is to be checked on staging.
 */
const GEMINI_3_8_TTS_SHEET: TtsCapabilities = {
  audioTags: true,
  tagSyntax: "angle",
  tags: GEMINI_3_8_TONE_TAGS,
  ssmlBreaks: false,
  levers: [],
  languageCode: false,
  timestamps: false,
  stitching: false,
  maxChars: GEMINI_TTS_MAX_CHARS,
  // No picker: the language follows the text.
  languages: [],
  voices: GEMINI_3_8_TTS_VOICES,
  defaultVoice: GEMINI_3_8_DEFAULT_VOICE,
  direction: { styleMaxChars: TTS_DIRECTION_MAX_CHARS },
  ratePer1kChars: true,
  // Two-speaker dialogue (decided 2026-11-12): one or two voices, a style per line, filler words on request.
  dialogueSpeakers: 2,
  fillerWords: true,
  // A dialogue's file is chosen as one speaker's is: MP3 or the WAV as rendered (decided 2026-11-13).
  dialogueAnyOutputFormat: true,
}

/**
 * Gemini 3.1 Flash and 2.5 Pro speech, one speaker: 30 voices, `[square]`
 * tone tags written freely (sent as written), and the speaker's style, pace,
 * accent and audio profile. Otherwise as the 3.8 sheet.
 */
const GEMINI_3_1_TTS_SHEET: TtsCapabilities = {
  audioTags: true,
  ssmlBreaks: false,
  levers: [],
  languageCode: false,
  timestamps: false,
  stitching: false,
  maxChars: GEMINI_TTS_MAX_CHARS,
  languages: [],
  voices: GEMINI_3_1_TTS_VOICES,
  defaultVoice: GEMINI_3_1_DEFAULT_VOICE,
  direction: {
    styles: GEMINI_3_1_TTS_STYLES,
    paces: GEMINI_3_1_TTS_PACES,
    accents: GEMINI_3_1_TTS_ACCENTS,
    audioProfileMaxChars: TTS_DIRECTION_MAX_CHARS,
  },
  ratePer1kChars: true,
  // Two-speaker dialogue (decided 2026-11-12): one or two voices, the style, pace, accent and profile per speaker.
  dialogueSpeakers: 2,
  // A dialogue's file is chosen as one speaker's is: MP3 or the WAV as rendered (decided 2026-11-13).
  dialogueAnyOutputFormat: true,
}

const AUDIO_MODELS: Record<string, ModelCatalogEntry> = {
  // ── ElevenLabs TTS ──
  "elevenlabs-v3": {
    id: "elevenlabs-v3",
    kind: "audio",
    modes: ["tts"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs v3",
    series: "ElevenLabs",
    description: "Expressive ElevenLabs TTS — supports [audio tags] for emotion / pacing. Direct API.",
    useCases: ["tts", "voice-over", "narration", "expressive"],
    features: ["audio-tags", "voice-cloning"],
    pricing: [
      { identifier: "elevenlabs-v3", credits: 30 },
      { identifier: "elevenlabs-v3:per-100-chars", credits: 4, note: SPEECH_UNIT_PRICE_NOTE },
    ],
    tts: {
      audioTags: true,
      ssmlBreaks: false,
      levers: ["stability"],
      languageCode: true,
      timestamps: true, // measured 2026-10-06: /with-timestamps answers 200 at the same character cost
      // Rejects previous_text / next_text with a 400 (probed 2026-10-04).
      stitching: false,
      maxChars: 5000, // official cap (probed: 5,200 chars accepted; keep the clamp)
      languages: TTS_LANGS_V3,
    },
  },
  "elevenlabs-v4": {
    id: "elevenlabs-v4",
    kind: "audio",
    modes: ["tts"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs v4",
    series: "ElevenLabs",
    description: "Newest ElevenLabs TTS — [audio tags], stability and similarity control, up to 10,000 characters per request. Direct API.",
    useCases: ["tts", "voice-over", "narration", "expressive", "long-form"],
    features: ["audio-tags", "voice-cloning"],
    pricing: [
      { identifier: "elevenlabs-v4", credits: 30 },
      { identifier: "elevenlabs-v4:per-100-chars", credits: 4, note: SPEECH_UNIT_PRICE_NOTE },
    ],
    // The default speech model (DEFAULT_TTS_PROVIDER) carries the star.
    featured: true,
    tts: {
      audioTags: true,
      ssmlBreaks: false,
      levers: ["stability", "similarity"],
      languageCode: true,
      timestamps: true, // measured 2026-10-06: /with-timestamps answers 200 at the same character cost
      // Accepts previous_text / next_text (probed 2026-10-04).
      stitching: true,
      maxChars: 10000,
      // The curated picker, the same 46 as v3. The model itself lists 85
      // (it adds e.g. Cantonese, Maltese, Mongolian, Burmese, Uzbek); widening
      // the picker is its own change — it needs a name and a translation per language.
      languages: TTS_LANGS_V3,
    },
  },
  "elevenlabs-v4-turbo": {
    id: "elevenlabs-v4-turbo",
    kind: "audio",
    modes: ["tts"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs v4 Turbo",
    series: "ElevenLabs",
    description: "Faster, cheaper ElevenLabs v4 at lower fidelity — [audio tags], stability and similarity control, at Turbo's credit price. Prefer v4 when quality matters. Direct API.",
    useCases: ["tts", "voice-over", "narration", "expressive", "fast"],
    features: ["audio-tags", "voice-cloning"],
    // Flat per request at parity with Turbo v2.5 (what a run costs where length
    // pricing is off); per started 100 characters at Turbo's rate where it is on
    // (decided 2026-10-06).
    pricing: [
      { identifier: "elevenlabs-v4-turbo", credits: 15 },
      { identifier: "elevenlabs-v4-turbo:per-100-chars", credits: 2, note: SPEECH_UNIT_PRICE_NOTE },
    ],
    tts: {
      // Every value below was measured 2026-10-07 from live calls to eleven_v4_turbo.
      audioTags: true, // measured 2026-10-07: a tagged line → 200; Scribe hears no tag word spoken and lists [chuckles] as an audio event
      ssmlBreaks: false,
      levers: ["stability", "similarity"], // measured 2026-10-07: /v1/models can_use_style / can_use_speaker_boost both false, as v4; stability + similarity_boost → 200
      languageCode: true, // measured 2026-10-07: language_code "he" with Hebrew text → 200
      timestamps: true, // measured 2026-10-07: /with-timestamps answers 200 at the same character cost as the plain call
      stitching: true, // measured 2026-10-07: previous_text / next_text → 200, at the same character cost (context not billed)
      maxChars: V4_TURBO_MAX_CHARS,
      // The curated picker, the same 46 as v4 and v3 (the model lists 85; widening is its own change).
      languages: TTS_LANGS_V3, // measured 2026-10-07: all 46 present in the model's 85-language list
    },
  },
  "elevenlabs-turbo": {
    id: "elevenlabs-turbo",
    kind: "audio",
    modes: ["tts"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs Turbo v2.5",
    series: "ElevenLabs",
    description: "Fast, cheap ElevenLabs TTS via the direct ElevenLabs API. Good for narration.",
    useCases: ["tts", "narration", "fast"],
    // The flat row carries no note (a "per 1K chars" note once described a
    // scaling that never existed; the minimum under length pricing is 8 units, 16).
    pricing: [
      { identifier: "elevenlabs-turbo", credits: 15 },
      { identifier: "elevenlabs-turbo:per-100-chars", credits: 2, note: SPEECH_UNIT_PRICE_NOTE },
    ],
    tts: {
      audioTags: false,
      ssmlBreaks: true,
      levers: TTS_LEVERS_V2,
      languageCode: true,
      timestamps: true, // measured 2026-10-06: /with-timestamps answers 200 at the same character cost
      // Measured 2026-10-06: the direct API accepts previous_text / next_text on this model (200).
      stitching: true,
      maxChars: 40000, // == eleven_flash_v2_5 (functionally equivalent)
      languages: TTS_LANGS_FLASH_V25,
    },
  },
  "elevenlabs-multilingual": {
    id: "elevenlabs-multilingual",
    kind: "audio",
    modes: ["tts"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs Multilingual v2",
    series: "ElevenLabs",
    description: "Multi-language ElevenLabs TTS via the direct ElevenLabs API.",
    useCases: ["tts", "multilingual"],
    // The flat row carries no note (the old "per 1K chars" described a scaling that never existed).
    pricing: [
      { identifier: "elevenlabs-multilingual", credits: 30 },
      { identifier: "elevenlabs-multilingual:per-100-chars", credits: 4, note: SPEECH_UNIT_PRICE_NOTE },
    ],
    tts: {
      audioTags: false,
      ssmlBreaks: true,
      levers: TTS_LEVERS_V2,
      // The API reference: "This parameter is not supported for multilingual_v2 models."
      languageCode: false,
      timestamps: true, // measured 2026-10-06: /with-timestamps answers 200 at the same character cost
      // Measured 2026-10-06: the direct API accepts previous_text / next_text on this model (200).
      stitching: true,
      maxChars: 10000,
      languages: TTS_LANGS_MULTILINGUAL_V2,
    },
  },

  // ── Google Gemini TTS (through KIE) ──
  // One id per model for both lanes: the same KIE model takes one speaker
  // (Text to Speech) and two (Text to Dialogue), and dialogue costs the same per
  // character as one speaker (decided 2026-11-12) — so `tts` AND `dialogue`,
  // one sheet and one price row, the same rate by construction.
  // Named voices of their own (never ElevenLabs'), no language field (the
  // language follows the text), no timings, no neighbour text. Priced per
  // 1,000 characters on the same count as every speech model (decided
  // 2026-11-12, provisional until measured on staging); the flat row is the
  // price of 1,000 characters.
  "gemini-3-8-flash-lite-tts": {
    id: "gemini-3-8-flash-lite-tts",
    kind: "audio",
    modes: ["tts", "dialogue"] as const,
    family: "Google",
    maker: "google",
    label: "Gemini 3.8 Flash-Lite TTS",
    series: "Gemini",
    description: "Google's lightest Gemini speech model and the cheapest speech on the platform — 70 named voices grouped by use, its own tone tags (laugh, sigh, short pause and more) and a free-text style direction. The language follows the text; up to 10,000 characters per request. Also voices a dialogue of two speakers.",
    useCases: ["tts", "voice-over", "narration", "fast", "budget"],
    features: ["audio-tags"],
    pricing: [
      { identifier: "gemini-3-8-flash-lite-tts", credits: 4 },
      { identifier: "gemini-3-8-flash-lite-tts:per-1k-chars", credits: 4, note: SPEECH_PER_1K_PRICE_NOTE },
    ],
    tts: GEMINI_3_8_TTS_SHEET,
  },
  "gemini-3-8-flash-tts": {
    id: "gemini-3-8-flash-tts",
    kind: "audio",
    modes: ["tts", "dialogue"] as const,
    family: "Google",
    maker: "google",
    label: "Gemini 3.8 Flash TTS",
    series: "Gemini",
    description: "Google's Gemini 3.8 speech model — the same 70 voices, tone tags and free-text style direction as Flash-Lite, from the larger model of the generation. The language follows the text; up to 10,000 characters per request. Also voices a dialogue of two speakers.",
    useCases: ["tts", "voice-over", "narration", "expressive"],
    features: ["audio-tags"],
    pricing: [
      { identifier: "gemini-3-8-flash-tts", credits: 6 },
      { identifier: "gemini-3-8-flash-tts:per-1k-chars", credits: 6, note: SPEECH_PER_1K_PRICE_NOTE },
    ],
    // A one-off clone (`replica`, decided 2026-11-13) on 3.8 Flash alone: its Flash-Lite sibling refuses it.
    tts: { ...GEMINI_3_8_TTS_SHEET, replica: true },
  },
  "gemini-3-1-flash-tts": {
    id: "gemini-3-1-flash-tts",
    kind: "audio",
    modes: ["tts", "dialogue"] as const,
    family: "Google",
    maker: "google",
    label: "Gemini 3.1 Flash TTS",
    series: "Gemini",
    description: "Google's Gemini 3.1 speech model — 30 named voices, [audio tags] written freely, and a speaking style, pace, accent and audio profile for the speaker. The language follows the text; up to 10,000 characters per request. Also voices a dialogue of two speakers.",
    useCases: ["tts", "voice-over", "narration", "expressive"],
    features: ["audio-tags"],
    pricing: [
      { identifier: "gemini-3-1-flash-tts", credits: 13 },
      { identifier: "gemini-3-1-flash-tts:per-1k-chars", credits: 13, note: SPEECH_PER_1K_PRICE_NOTE },
    ],
    tts: GEMINI_3_1_TTS_SHEET,
  },
  "gemini-2-5-pro-tts": {
    id: "gemini-2-5-pro-tts",
    kind: "audio",
    modes: ["tts", "dialogue"] as const,
    family: "Google",
    maker: "google",
    label: "Gemini 2.5 Pro TTS",
    series: "Gemini",
    description: "Google's Gemini 2.5 Pro speech model — the same 30 voices, [audio tags] and speaker controls (style, pace, accent, audio profile) as Gemini 3.1 Flash TTS, from the Pro model. The language follows the text; up to 10,000 characters per request. Also voices a dialogue of two speakers.",
    useCases: ["tts", "voice-over", "narration", "expressive", "long-form"],
    features: ["audio-tags"],
    pricing: [
      { identifier: "gemini-2-5-pro-tts", credits: 16 },
      { identifier: "gemini-2-5-pro-tts:per-1k-chars", credits: 16, note: SPEECH_PER_1K_PRICE_NOTE },
    ],
    tts: GEMINI_3_1_TTS_SHEET,
  },
  "elevenlabs-dialogue": {
    id: "elevenlabs-dialogue",
    kind: "audio",
    // Its own mode, never "tts": the script shape (inputs[]) doesn't fit the
    // single-text generate_speech contract, so list_models must never offer
    // it there. The dialogue-capable MCP verb is `generate_dialogue`.
    modes: ["dialogue"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs Dialogue v3",
    series: "ElevenLabs",
    description: "Multi-speaker dialogue via the direct ElevenLabs API — give it a script, it voices each role (any voice: premade, library, or cloned).",
    useCases: ["tts", "dialogue", "multi-speaker"],
    features: ["audio-tags", "voice-cloning"],
    // Flat per request, whatever the length (decided 2026-10-06: the old
    // "per 1K chars" note described a scaling that never existed).
    pricing: [
      { identifier: "elevenlabs-dialogue", credits: 25 },
      { identifier: "elevenlabs-dialogue:per-100-chars", credits: 4, note: SPEECH_UNIT_PRICE_NOTE },
    ],
    tts: {
      audioTags: true,
      ssmlBreaks: false,
      levers: ["stability"],
      // The dialogue route has offered exactly these three since it shipped
      // (routes/text-to-dialogue.ts). Kept as the platform's v3 dialogue contract.
      stabilitySteps: [0, 0.5, 1],
      languageCode: true,
      timestamps: true, // measured 2026-10-06: /with-timestamps answers 200 at the same character cost
      // The dialogue funnel does not read this field (its own lane; phase 2 declares
      // the v4 dialogue model's value). v3 underneath.
      stitching: false,
      // Total across lines. The documented 2,000 is a recommendation, not a
      // limit (2,500 and 5,000 both probed 200); capped like v3, the model underneath.
      maxChars: 5000,
      languages: TTS_LANGS_V3,
    },
  },
  "elevenlabs-dialogue-v4": {
    id: "elevenlabs-dialogue-v4",
    kind: "audio",
    // Its own mode, never "tts" — the same reason as v3 dialogue above.
    modes: ["dialogue"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs Dialogue v4",
    series: "ElevenLabs",
    description: "Multi-speaker dialogue on ElevenLabs v4 — [audio tags], stability and similarity control. Direct API.",
    useCases: ["tts", "dialogue", "multi-speaker"],
    features: ["audio-tags", "voice-cloning"],
    // Flat per request, the same as v3 dialogue (decided 2026-10-06).
    pricing: [
      { identifier: "elevenlabs-dialogue-v4", credits: 25 },
      { identifier: "elevenlabs-dialogue-v4:per-100-chars", credits: 4, note: SPEECH_UNIT_PRICE_NOTE },
    ],
    tts: {
      audioTags: true,
      ssmlBreaks: false,
      levers: ["stability", "similarity"],
      languageCode: true,
      timestamps: true, // measured 2026-10-06: /with-timestamps answers 200 at the same character cost
      // Dialogue models never stitch neighbour text (the funnel does not read this).
      stitching: false,
      maxChars: DIALOGUE_V4_MAX_CHARS,
      // The curated picker, v3's 46 (v4 lists 85; widening is its own change).
      languages: TTS_LANGS_V3,
    },
  },

  // ── ElevenLabs voice utilities ──
  // (voice cloning was retired platform-wide on 2026-09-15 — no catalog entry,
  //  no price, no MCP tool; existing clones still resolve as TTS voice ids.)
  "elevenlabs-voice-design": {
    id: "elevenlabs-voice-design",
    kind: "audio",
    modes: ["voice-design"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs Voice Design",
    series: "ElevenLabs",
    description: "Design a synthetic voice from a description (no reference clip needed).",
    useCases: ["voice-design", "synthetic"],
    pricing: [{ identifier: "elevenlabs-voice-design", credits: 50 }],
  },
  "elevenlabs-voice-changer": {
    id: "elevenlabs-voice-changer",
    kind: "audio",
    modes: ["voice-changer"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs Voice Changer",
    series: "ElevenLabs",
    description: "Speech-to-speech: convert one voice to another while preserving prosody.",
    useCases: ["voice-conversion", "dubbing"],
    pricing: [{ identifier: "elevenlabs-voice-changer", credits: 40 }],
  },
  "elevenlabs-stt": {
    id: "elevenlabs-stt",
    kind: "audio",
    modes: ["stt"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs STT",
    series: "ElevenLabs",
    description: "Speech-to-text with WORD-level timestamps (always on), speaker diarization and audio-event tags. The engine to use when the transcript feeds captions.",
    useCases: ["transcription", "stt", "captions"],
    features: ["word-timestamps", "diarization", "audio-events"],
    pricing: [{ identifier: "elevenlabs-stt", credits: 22 }],
  },
  "incredibly-fast-whisper": {
    id: "incredibly-fast-whisper",
    kind: "audio",
    modes: ["stt"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "Incredibly Fast Whisper",
    series: "Whisper",
    description: "Fast Whisper speech-to-text. Returns WORD-level timestamps when asked, so its transcript can feed captions.",
    useCases: ["transcription", "stt", "captions"],
    features: ["word-timestamps"],
    pricing: [{ identifier: "incredibly-fast-whisper", credits: 40 }],
  },
  "whisper": {
    id: "whisper",
    kind: "audio",
    modes: ["stt"] as const,
    family: "OpenAI",
    maker: "openai",
    label: "Whisper",
    series: "Whisper",
    description: "Whisper speech-to-text — PHRASE-level segments only, NO word timestamps. Fine for a transcript or a static subtitle; not for word-timed (kinetic) captions.",
    useCases: ["transcription", "stt"],
    pricing: [{ identifier: "whisper", credits: 40 }],
  },
  // NVIDIA's speech-to-text on KIE, priced per started minute of the file. Its
  // per-minute base fits no whole-credit row, so the row prices FOUR
  // minutes and a run is charged row × minutes ÷ 4, rounded up once
  // (`@nodaro/shared` credit-estimators/nemotron-transcribe.ts).
  "nemotron-3-5-transcribe": {
    id: "nemotron-3-5-transcribe",
    kind: "audio",
    modes: ["stt"] as const,
    family: "NVIDIA",
    maker: "nvidia",
    label: "Nemotron 3.5 Transcribe",
    series: "Nemotron",
    description: "NVIDIA speech-to-text in 40 languages, detected automatically, with a low word error rate. On request it returns WORD-level timestamps with a speaker label per word, so its transcript can feed captions; or it translates the speech instead (to or from English: other speech into English, or English speech into one of 31 languages), with no word timings. Files up to 60 minutes and 200 MB. Priced per started minute of the file, whatever the options; the listed price is four minutes.",
    useCases: ["transcription", "stt", "captions", "translation"],
    features: ["word-timestamps", "diarization", "translation"],
    pricing: [{ identifier: "nemotron-3-5-transcribe:per-4m", credits: 3, note: "per 4 minutes of the file; charged per started minute, the whole run rounded up" }],
  },
  "elevenlabs-isolation": {
    id: "elevenlabs-isolation",
    kind: "audio",
    modes: ["isolation"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs Voice Isolation",
    series: "ElevenLabs",
    description: "Strip background noise / music from a vocal track.",
    useCases: ["cleanup", "isolation"],
    pricing: [{ identifier: "elevenlabs-isolation", credits: 74, note: "variable per second" }],
  },
  "elevenlabs-dubbing": {
    id: "elevenlabs-dubbing",
    kind: "audio",
    modes: ["dubbing"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs Dubbing",
    series: "ElevenLabs",
    description: "Translate + dub audio or a whole video into a new language — video in, dubbed video out. Async.",
    useCases: ["dubbing", "multilingual"],
    pricing: [{ identifier: "elevenlabs-dubbing", credits: 40, note: "per minute of the dubbed span (min 1)" }],
  },
  "elevenlabs-dubbing-v2": {
    id: "elevenlabs-dubbing-v2",
    kind: "audio",
    modes: ["dubbing"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs Dubbing v2",
    series: "ElevenLabs",
    description: "Translate + dub audio or a whole video into a new language — video in, dubbed video out. Async.",
    useCases: ["dubbing", "multilingual"],
    pricing: [{ identifier: "elevenlabs-dubbing-v2", credits: 1100, note: "per minute of the dubbed span (min 1)" }],
  },
  "elevenlabs-forced-alignment": {
    id: "elevenlabs-forced-alignment",
    kind: "audio",
    modes: ["forced-alignment"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs Forced Alignment",
    series: "ElevenLabs",
    description: "Align an existing transcript to audio with word-level timestamps.",
    useCases: ["alignment", "captions"],
    pricing: [{ identifier: "elevenlabs-forced-alignment", credits: 30 }],
  },

  // ── ElevenLabs SFX ──
  "elevenlabs-sfx": {
    id: "elevenlabs-sfx",
    kind: "audio",
    modes: ["sfx"] as const,
    family: "ElevenLabs",
    maker: "elevenlabs",
    label: "ElevenLabs Sound Effects",
    series: "ElevenLabs",
    description: "Generate short sound effects from a text prompt.",
    useCases: ["sfx", "ambient"],
    // Priced per whole second asked for (`elevenlabs-sfx:<n>s`, 1–30 s, rounded
    // up — textToAudioCreditId); representative rows, every second has its own.
    // First row = the default variant (a request with no duration bills 5 s).
    pricing: [
      { identifier: "elevenlabs-sfx:5s", credits: 5, note: "5s — also the price when no duration is set; 1 credit per second, rounded up" },
      { identifier: "elevenlabs-sfx:1s", credits: 1, note: "1s (min)" },
      { identifier: "elevenlabs-sfx:10s", credits: 10, note: "10s" },
      { identifier: "elevenlabs-sfx:30s", credits: 30, note: "30s (max)" },
    ],
  },

  // ── Suno music ──
  "suno": {
    id: "suno",
    kind: "audio",
    modes: ["music"] as const,
    family: "Suno",
    maker: "suno",
    label: "Suno v4",
    series: "Suno",
    dataValue: "V4",
    description: "Suno v4 music generation — full songs with vocals, multiple genres.",
    useCases: ["music", "song", "vocals"],
    pricing: [{ identifier: "suno", credits: 30, note: "per generation" }],
  },
  // Suno v4.5, v4.5 All and v4.5+ (decided 2026-11-12): listed so a
  // deployment's model restriction can name them, each with a price row of its
  // own (SUNO_VERSION_CREDIT_KEYS) at the price those runs were charged before.
  "suno-v4_5": {
    id: "suno-v4_5",
    kind: "audio",
    modes: ["music"] as const,
    family: "Suno",
    maker: "suno",
    label: "Suno v4.5",
    series: "Suno",
    dataValue: "V4_5",
    description: "Suno v4.5 — improved quality and coherence over v4.",
    useCases: ["music", "song", "vocals"],
    pricing: [{ identifier: "suno-v4_5", credits: 30, note: "per generation" }],
  },
  "suno-v4_5all": {
    id: "suno-v4_5all",
    kind: "audio",
    modes: ["music"] as const,
    family: "Suno",
    maker: "suno",
    label: "Suno v4.5 All",
    series: "Suno",
    dataValue: "V4_5ALL",
    description: "Suno v4.5 All — full instrument and vocal generation.",
    useCases: ["music", "song", "vocals"],
    pricing: [{ identifier: "suno-v4_5all", credits: 30, note: "per generation" }],
  },
  "suno-v4_5plus": {
    id: "suno-v4_5plus",
    kind: "audio",
    modes: ["music"] as const,
    family: "Suno",
    maker: "suno",
    label: "Suno v4.5 Plus",
    series: "Suno",
    dataValue: "V4_5PLUS",
    description: "Suno v4.5 Plus — richer production than v4.5.",
    useCases: ["music", "song", "vocals"],
    pricing: [{ identifier: "suno-v4_5plus", credits: 30, note: "per generation" }],
  },
  "suno-v5": {
    id: "suno-v5",
    kind: "audio",
    modes: ["music"] as const,
    family: "Suno",
    maker: "suno",
    label: "Suno v5",
    series: "Suno",
    dataValue: "V5",
    description: "Suno v5 — better vocal quality than v4, more genres. Same price.",
    useCases: ["music", "song", "vocals", "premium"],
    pricing: [{ identifier: "suno-v5", credits: 30, note: "per generation" }],
  },
  "suno-v5_5": {
    id: "suno-v5_5",
    kind: "audio",
    modes: ["music"] as const,
    family: "Suno",
    maker: "suno",
    label: "Suno v5.5",
    series: "Suno",
    dataValue: "V5_5",
    description: "Suno v5.5 — improved audio quality and expressiveness over v5.",
    useCases: ["music", "song", "vocals", "premium"],
    pricing: [{ identifier: "suno-v5_5", credits: 30, note: "per generation" }],
  },
  "suno-v6": {
    id: "suno-v6",
    kind: "audio",
    modes: ["music"] as const,
    family: "Suno",
    maker: "suno",
    label: "Suno V6",
    series: "Suno",
    dataValue: "V6",
    description: "Suno V6 — greater musical expression with more natural vocals and richer details. The flagship and the default.",
    useCases: ["music", "song", "vocals", "premium"],
    pricing: [{ identifier: "suno-v6", credits: 30, note: "per generation" }],
    featured: true,
  },
  "suno-v6_wild": {
    id: "suno-v6_wild",
    kind: "audio",
    modes: ["music"] as const,
    family: "Suno",
    maker: "suno",
    label: "Suno V6 Wild",
    series: "Suno",
    dataValue: "V6_WILD",
    description: "Suno V6 Wild — pushes creative boundaries for bolder, more distinctive musical expression; more varied, less predictable results.",
    useCases: ["music", "song", "vocals", "experimental"],
    pricing: [{ identifier: "suno-v6_wild", credits: 30, note: "per generation" }],
  },
  "suno-v6_mini": {
    id: "suno-v6_mini",
    kind: "audio",
    modes: ["music"] as const,
    family: "Suno",
    maker: "suno",
    label: "Suno V6 Mini",
    series: "Suno",
    dataValue: "V6_MINI",
    description: "Suno V6 Mini — lightweight and fast, balancing quality and speed for effortless creation.",
    useCases: ["music", "song", "vocals", "fast"],
    pricing: [{ identifier: "suno-v6_mini", credits: 30, note: "per generation" }],
  },
}

// =============================================================================
// COMBINED CATALOG
// =============================================================================
export const MODEL_CATALOG: Record<string, ModelCatalogEntry> = {
  ...IMAGE_MODELS,
  ...VIDEO_MODELS,
  ...AUDIO_MODELS,
}

/**
 * Lookup helpers for MCP and the future frontend migration.
 */
export function listModels(filter?: {
  kind?: ModelKind
  mode?: ModelMode
  family?: string
}): ModelCatalogEntry[] {
  // A model the platform runs on its own is offered nowhere (`pickerHidden`).
  const all = Object.values(MODEL_CATALOG).filter((m) => m.pickerHidden !== true)
  if (!filter) return all
  return all.filter((m) => {
    if (filter.kind && m.kind !== filter.kind) return false
    if (filter.mode && !m.modes.includes(filter.mode)) return false
    if (filter.family && m.family.toLowerCase() !== filter.family.toLowerCase()) return false
    return true
  })
}

/**
 * Group entries by family, returning a stable order.
 * Returns Array<{ family: string; models: ModelCatalogEntry[] }>.
 */
export function groupByFamily(
  entries: ModelCatalogEntry[],
): Array<{ family: string; models: ModelCatalogEntry[] }> {
  const groups = new Map<string, ModelCatalogEntry[]>()
  for (const m of entries) {
    const list = groups.get(m.family)
    if (list) list.push(m)
    else groups.set(m.family, [m])
  }
  return Array.from(groups.entries()).map(([family, models]) => ({ family, models }))
}

export const MODEL_KINDS = ["image", "video", "audio"] as const satisfies readonly ModelKind[]

/**
 * The Image / Video / Audio envelope every model-discovery surface renders
 * (`GET /v1/models`, MCP `list_models`): each model is filed under ITS OWN
 * kind, then by vendor family within that kind — so a vendor that ships more
 * than one kind (Google: Imagen + VEO, ByteDance: Seedream + Seedance, …)
 * appears once per kind it actually ships.
 *
 * This is the ONE grouping both surfaces call. Grouping by family first and
 * letting the family's first model pick the section filed every VEO, Seedance,
 * Wan and ByteDance video model under "image" whenever the call carried no
 * `kind` filter (#1332) — an explicit `kind` pre-filtered the list and hid it.
 * Empty sections are omitted; section order is fixed image → video → audio.
 */
export function groupByKindAndFamily(
  entries: ModelCatalogEntry[],
): Array<{ kind: ModelKind; families: Array<{ family: string; models: ModelCatalogEntry[] }> }> {
  return MODEL_KINDS
    .map((kind) => ({ kind, families: groupByFamily(entries.filter((m) => m.kind === kind)) }))
    .filter((section) => section.families.length > 0)
}

export function getModel(id: string): ModelCatalogEntry | undefined {
  return MODEL_CATALOG[id]
}

// =============================================================================
// Per-model input validation
// =============================================================================
export type ValidationField =
  | "aspectRatio"
  | "resolution"
  | "quality"
  | "duration"

export interface ModelValidationIssue {
  field: ValidationField
  message: string
  allowed: readonly (string | number)[] | null
}

/**
 * Validate that the user's lever values are supported by the chosen model.
 *
 * Returns null on success or the FIRST issue found. We surface a single issue
 * rather than collecting all so the agent doesn't get a wall of complaints —
 * fix one thing, retry. Order: aspectRatio → resolution → quality → duration.
 *
 * Semantics:
 * - If the field is undefined, it's never an issue.
 * - If the catalog entry doesn't list a corresponding lever (e.g. base
 *   nano-banana has no `resolutions`), passing that field IS an issue —
 *   silently dropping it has caused two bugs already.
 * - If the value is in the allow list, it's valid.
 *
 * Unknown model ids are NOT flagged here — the route handler / Zod model
 * enum is the right gate for that. We just skip validation.
 */
export function validateModelInput(
  modelId: string,
  input: {
    aspectRatio?: string
    resolution?: string
    quality?: string
    duration?: number
  },
): ModelValidationIssue | null {
  const m = MODEL_CATALOG[modelId]
  if (!m) return null

  if (input.aspectRatio !== undefined) {
    if (!m.aspectRatios) {
      return {
        field: "aspectRatio",
        message: `Model "${modelId}" does not have an aspect_ratio lever — omit it.`,
        allowed: null,
      }
    }
    if (!m.aspectRatios.includes(input.aspectRatio)) {
      return {
        field: "aspectRatio",
        message: `Model "${modelId}" does not support aspect_ratio "${input.aspectRatio}". Supported: ${m.aspectRatios.join(", ")}.`,
        allowed: m.aspectRatios,
      }
    }
  }

  if (input.resolution !== undefined) {
    if (!m.resolutions) {
      return {
        field: "resolution",
        message: `Model "${modelId}" does not have a resolution lever — omit it.`,
        allowed: null,
      }
    }
    if (!m.resolutions.includes(input.resolution)) {
      return {
        field: "resolution",
        message: `Model "${modelId}" does not support resolution "${input.resolution}". Supported: ${m.resolutions.join(", ")}.`,
        allowed: m.resolutions,
      }
    }
  }

  if (input.quality !== undefined) {
    if (!m.qualities) {
      return {
        field: "quality",
        message: `Model "${modelId}" does not have a quality lever — omit it.`,
        allowed: null,
      }
    }
    if (!m.qualities.includes(input.quality)) {
      return {
        field: "quality",
        message: `Model "${modelId}" does not support quality "${input.quality}". Supported: ${m.qualities.join(", ")}.`,
        allowed: m.qualities,
      }
    }
  }

  if (input.duration !== undefined) {
    if (!m.durations) {
      return {
        field: "duration",
        message: `Model "${modelId}" does not have a duration lever — omit it.`,
        allowed: null,
      }
    }
    // Auto (-1) is a legal value for the providers that accept it — it is a
    // capability of the model, not a member of its seconds list.
    const isAuto = m.autoDuration === true && isAutoVideoDuration(input.duration)
    if (!isAuto && !m.durations.includes(input.duration)) {
      return {
        field: "duration",
        message: `Model "${modelId}" does not support duration ${input.duration}s. Supported: ${m.durations.join(", ")}s.`,
        allowed: m.durations,
      }
    }
  }

  return null
}

/**
 * The resolution a Flux 2 model should land on when its stored value is absent
 * or invalid. Flux 2 exposes ascending megapixel options ("0.5 MP"…"4 MP"), so
 * snapping to `options[0]` would silently downgrade every node to the cheapest
 * tier; each variant has a sensible mid default instead. A model can also
 * declare one (`defaultResolution`, Gemini Omni Flash 1.2: its cheapest tier is
 * a 360p preview). Returns undefined for every other model (they snap to
 * `options[0]` normally).
 */
export function defaultResolutionFor(modelId: string): string | undefined {
  const declared = MODEL_CATALOG[modelId]?.defaultResolution
  if (declared) return declared
  if (!isFlux2Model(modelId)) return undefined
  return modelId === "flux-2-klein" ? "1 MP" : "2 MP"
}

/**
 * True when two option values denote the same setting written differently.
 * Handles case/whitespace ("4k" vs "4K") and the megapixel form Flux 2 stores
 * as a bare count ("1") against the catalog's display form ("1 MP").
 */
function sameOptionValue(a: string | number, b: string | number): boolean {
  if (a === b) return true
  const norm = (v: string | number) =>
    String(v).trim().toLowerCase().replace(/\s*mp$/, "").replace(/\s+/g, "")
  const na = norm(a)
  const nb = norm(b)
  if (na === nb) return true
  // Numeric equivalence so "1" matches "1.0" and " 1 MP".
  const fa = Number(na)
  const fb = Number(nb)
  return Number.isFinite(fa) && Number.isFinite(fb) && fa === fb
}

/** Every lever `normalizeModelInput` can correct, as an adjustment names it. */
export const MODEL_INPUT_ADJUSTMENT_FIELDS = [
  "aspectRatio", "resolution", "quality", "duration", "background",
  "outputFormat", "gifFrames", "gifFrameDurationMs", "svgLevel",
] as const
export type ModelInputAdjustmentField = (typeof MODEL_INPUT_ADJUSTMENT_FIELDS)[number]

/** The pixel size of every frame of a GIF the platform asks for: a GIF is square. */
export const IMAGE_GIF_FRAME_SIZE = 512

/** The output formats that take no inpainting mask: the image routes refuse a mask with them (a 400). */
export const MASKLESS_OUTPUT_FORMATS: readonly string[] = ["gif", "svg"]

/** The output formats that keep a transparent background; with any other a transparent one becomes `auto`. */
export const TRANSPARENT_OUTPUT_FORMATS: readonly string[] = ["png", "webp"]

/** One correction `normalizeModelInput` made, for disclosure to the user. */
export interface ModelInputAdjustment {
  field: ModelInputAdjustmentField
  /** The value that was asked for. */
  from: string | number
  /** What it became — `undefined` means the lever was dropped entirely. */
  to: string | number | undefined
  reason: string
}

export interface NormalizedModelInput {
  aspectRatio?: string
  resolution?: string
  quality?: string
  duration?: number
  background?: string
  outputFormat?: string
  gifFrames?: number
  gifFrameDurationMs?: number
  svgLevel?: string
  /** Empty when the input was already valid. */
  adjustments: ModelInputAdjustment[]
}

/** A source image's pixel size as it is DISPLAYED (EXIF orientation applied). */
export interface SourceImageSize {
  width: number
  height: number
}

/** What a request knows beyond its own levers. */
export interface ModelInputContext {
  /**
   * The image an image-to-image or edit request transforms. Only read to
   * resolve "auto" on a model without a native auto, or whose own auto does
   * not keep the photo's shape (`autoAspectFromSourceImage`); absent or
   * unusable means the size is unknown and "auto" snaps the way it always has.
   * Also read by a masked edit on a model whose result follows its photo
   * (`maskEditMatchesSource`): it decides the ratio and the size.
   */
  sourceImage?: SourceImageSize
  /** The request carries an inpainting mask (`maskUrl`). */
  masked?: boolean
}

/**
 * True when a masked request on `modelId` follows its photo
 * (`maskEditMatchesSource`): its ratio and size come from the photo's size.
 */
export function maskEditMatchesSource(modelId: string | undefined, masked: unknown): boolean {
  return masked === true && !!modelId && MODEL_CATALOG[modelId]?.maskEditMatchesSource === true
}

/**
 * True when the photo's size can change what a request on `modelId` sends:
 * "auto" that keeps the photo's shape (`autoAspectNeedsSourceImage`), or a
 * masked edit that follows its photo (`maskEditMatchesSource`). A caller that
 * has to fetch the size asks this first.
 */
export function sourceImageSizeNeeded(modelId: string | undefined, aspectRatio: unknown, masked: unknown): boolean {
  return autoAspectNeedsSourceImage(modelId, aspectRatio) || maskEditMatchesSource(modelId, masked)
}

/**
 * The size a MASKED request on `modelId` runs, and is priced, at once its
 * photo's size is known — what `normalizeModelInput` sends for it. For an
 * estimate that knows the photo's size (the editor's badge, a workflow
 * estimate). `undefined` when the model does not follow its photo
 * (`maskEditMatchesSource`) or the size is unusable: the caller keeps its own.
 */
export function maskedEditResolution(
  modelId: string,
  levers: { aspectRatio?: unknown; resolution?: unknown; background?: unknown; outputFormat?: unknown },
  sourceImage: SourceImageSize | undefined,
): string | undefined {
  if (!maskEditMatchesSource(modelId, true) || !usableSize(sourceImage)) return undefined
  const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)
  return normalizeModelInput(
    modelId,
    { aspectRatio: str(levers.aspectRatio), resolution: str(levers.resolution), background: str(levers.background), outputFormat: str(levers.outputFormat) },
    { sourceImage, masked: true },
  ).resolution
}

/**
 * The size of `modelId` whose rendered long side, at `aspectRatio`, is nearest
 * the photo's long side (`outputSizes`; nearest by ratio, so 1500 px is nearer
 * 2048 than 1024; a tie goes to the larger size). `undefined` when the model
 * has no size table for that ratio or the photo's size is unusable.
 */
export function resolutionNearestSource(
  modelId: string,
  aspectRatio: unknown,
  source: SourceImageSize | undefined,
): string | undefined {
  const m = MODEL_CATALOG[modelId]
  const table = m?.outputSizes
  if (!table || typeof aspectRatio !== "string" || !usableSize(source)) return undefined
  // Own keys only: a ratio such as "constructor" must not read the prototype.
  if (!Object.prototype.hasOwnProperty.call(table, aspectRatio)) return undefined
  const sizes = table[aspectRatio]!
  const long = Math.max(source.width, source.height)
  let best: string | undefined
  let bestDist = Infinity
  for (const resolution of m.resolutions ?? Object.keys(sizes)) {
    const px = Object.prototype.hasOwnProperty.call(sizes, resolution) ? sizes[resolution] : undefined
    if (!px) continue
    const dist = Math.abs(Math.log(Math.max(px[0], px[1]) / long))
    if (dist <= bestDist + ASPECT_TIE_EPSILON) { bestDist = dist; best = resolution }
  }
  return best
}

/** True for the "auto" aspect token in any case or padding. */
export function isAutoAspectToken(value: unknown): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "auto"
}

/**
 * True for the video request's "Auto" ratio — the unified node's
 * provider-agnostic token — in exactly the spellings a video provider adapter
 * receives it as (`"Auto"`, `"auto"`). Narrower than {@link isAutoAspectToken}
 * on purpose: it is the wire rule's own match, so a reader of it agrees with
 * what is sent.
 */
export function isVideoAutoAspectToken(value: string | undefined): boolean {
  return value === "Auto" || value === "auto"
}

/**
 * The ratio a video model runs the "Auto" token ({@link isVideoAutoAspectToken})
 * at: `"adaptive"` (match the input) when the request has a visual input to
 * match — a frame, a reference image or a reference video — and the model's
 * catalog lists `"adaptive"`; otherwise `undefined`, and the provider adapter
 * sends its own fixed default. The ONE mapping: the KIE adapter sends what it
 * says, and the Seedance reference task type resolver reads it to tell a ratio
 * it would replace from one that already runs at the ratio it forces.
 */
export function videoAutoAspectRunsAt(modelId: string | undefined, hasVisualInput: boolean): "adaptive" | undefined {
  if (!hasVisualInput || !modelId) return undefined
  return MODEL_CATALOG[modelId]?.aspectRatios?.includes("adaptive") ? "adaptive" : undefined
}

function usableSize(size: SourceImageSize | undefined): size is SourceImageSize {
  return (
    size !== undefined &&
    Number.isFinite(size.width) && size.width > 0 &&
    Number.isFinite(size.height) && size.height > 0
  )
}

/**
 * Log-space distances closer than this are a tie. Mirror pairs that are
 * mathematically equidistant (4:3 and 3:4 from a square) differ in the last
 * bit once `Math.log` rounds them, so an exact comparison would let rounding,
 * not the catalog's order, pick between them. Real catalog ratios sit at least
 * ~1e-2 apart, far above this.
 *
 * Source-size path ONLY. The ratio-TOKEN fit (`nearestAspectRatio` behind
 * `fitAspectRatioToModel`) keeps its strict comparison on purpose: it mirrors
 * the video adapters' `snapAspectRatioToken` exactly (pinned by
 * `video-normalizer-totality.test.ts`), and a request must snap to one ratio
 * whichever door it came through.
 */
const ASPECT_TIE_EPSILON = 1e-9

/**
 * The ratio in `ratios` nearest a `sourceWidth` x `sourceHeight` image:
 * minimises |ln(w/h) - ln(rw/rh)|, so a portrait and its landscape mirror are
 * equally far from a square. Entries that are not ratios ("auto", "adaptive",
 * "match_input_image") are skipped, and a tie goes to the ratio listed first
 * (`ASPECT_TIE_EPSILON`). `undefined` for unusable dimensions or a list
 * without a single ratio.
 */
export function nearestCatalogAspectRatio(
  sourceWidth: number,
  sourceHeight: number,
  ratios: readonly string[],
): string | undefined {
  if (!usableSize({ width: sourceWidth, height: sourceHeight })) return undefined
  const target = Math.log(sourceWidth / sourceHeight)
  let best: string | undefined
  let bestDist = Infinity
  for (const ratio of ratios) {
    const [rw, rh] = ratio.split(":").map(Number)
    if (!rw || !rh || rw < 0 || rh < 0) continue
    const dist = Math.abs(Math.log(rw / rh) - target)
    if (dist < bestDist - ASPECT_TIE_EPSILON) { bestDist = dist; best = ratio }
  }
  return best
}

/**
 * True when `aspectRatio` is "auto" and `modelId`'s catalog ratio list does not
 * carry "auto", or carries it but the model's own auto does not keep the
 * photo's shape (`autoAspectFromSourceImage`) — the cases where the source
 * image's size decides the ratio. A caller that has to fetch the size asks
 * this first, so a request that will not use it never pays for the read.
 */
export function autoAspectNeedsSourceImage(modelId: string | undefined, aspectRatio: unknown): boolean {
  if (!modelId || !isAutoAspectToken(aspectRatio)) return false
  const entry = MODEL_CATALOG[modelId]
  const ratios = entry?.aspectRatios
  if (ratios === undefined || ratios.length === 0) return false
  return entry?.autoAspectFromSourceImage === true || !ratios.some(isAutoAspectToken)
}

/**
 * The sizes `modelId` renders at `aspectRatio`, in the catalog's order: its
 * `resolutions`, narrowed where `resolutionsByAspectRatio` lists that ratio.
 * `undefined` for an unknown model or one with no size setting. What a menu
 * offers once a ratio is chosen.
 */
export function resolutionsAtAspectRatio(modelId: string, aspectRatio: unknown): readonly string[] | undefined {
  const m = MODEL_CATALOG[modelId]
  const all = m?.resolutions
  if (!all || all.length === 0) return undefined
  const byRatio = m.resolutionsByAspectRatio
  const ratio = typeof aspectRatio === "string" ? aspectRatio.trim() : undefined
  // Own keys only: a ratio such as "constructor" must not read the prototype.
  const only = byRatio && ratio !== undefined && Object.prototype.hasOwnProperty.call(byRatio, ratio)
    ? byRatio[ratio]
    : undefined
  return only ? all.filter((r) => only.includes(r)) : all
}

/**
 * The size `modelId` renders `resolution` at, at `aspectRatio`: the same size
 * where that ratio renders it (or the model limits no ratio), else the largest
 * size the ratio renders at or below it, else its smallest. A size the model
 * does not list comes back as it is: snapping the lever itself is
 * `normalizeModelInput`'s. A route that prices a run without that function
 * prices and sends the size this returns, so the two agree.
 */
export function resolutionAtAspectRatio(
  modelId: string,
  aspectRatio: unknown,
  resolution: string | undefined,
): string | undefined {
  if (resolution === undefined) return undefined
  const all = MODEL_CATALOG[modelId]?.resolutions
  const offered = resolutionsAtAspectRatio(modelId, aspectRatio)
  if (!all || !offered || offered.length === 0 || offered.includes(resolution)) return resolution
  const at = all.indexOf(resolution)
  if (at < 0) return resolution
  const atOrBelow = offered.filter((r) => all.indexOf(r) <= at)
  return atOrBelow.length > 0 ? atOrBelow[atOrBelow.length - 1]! : offered[0]!
}

/**
 * Coerce a model's parameters into a combination the model actually accepts.
 *
 * The correcting twin of `validateModelInput`. Validation is right when a
 * human/agent is composing a single call and can retry (MCP verbs do this).
 * It is the WRONG answer at a persistence or execution boundary: rejecting
 * there turns a fixable typo into a failed run — and a failed run takes every
 * already-generated, already-billed sibling node down with it. Incident
 * 2026-08-09: one node carrying `gpt-image` + `16:9` (a pair the config panel
 * cannot produce, written straight into workflow JSON by a non-UI author)
 * aborted a run whose five other nodes had already produced images.
 *
 * Rules, mirroring the config panels' provider-change snap:
 *  - Model has no such lever → drop the value (sending it 400s upstream).
 *  - "auto" on a model whose list lacks it, or whose own auto does not keep
 *    the photo's shape (`autoAspectFromSourceImage`), with a known
 *    `context.sourceImage` → the listed ratio nearest the source's shape
 *    (`nearestCatalogAspectRatio`). "auto" asks to keep the source photo's
 *    shape; the first listed ratio would reframe every source of another shape.
 *  - Value outside the model's allow-list → snap to the model's default
 *    (`defaultResolutionFor`) or the first valid option.
 *  - Then apply the cross-field constraints the catalog declares: a size the
 *    ratio does not render (`resolutionsByAspectRatio`), and the size a
 *    background setting renders at (`transparentResolution`).
 *
 * Unknown model ids pass through untouched — the route's Zod model enum is the
 * right gate for those, exactly as in `validateModelInput`.
 *
 * Every correction is reported in `adjustments` so callers can disclose what
 * changed rather than silently handing back something else.
 */
export function normalizeModelInput(
  modelId: string,
  input: {
    aspectRatio?: string
    resolution?: string
    quality?: string
    duration?: number
    background?: string
    outputFormat?: string
    gifFrames?: number
    gifFrameDurationMs?: number
    svgLevel?: string
  },
  context: ModelInputContext = {},
): NormalizedModelInput {
  const m = MODEL_CATALOG[modelId]
  const adjustments: ModelInputAdjustment[] = []
  if (!m) return { ...input, adjustments }

  const out: NormalizedModelInput = { ...input, adjustments }

  const snap = <T extends string | number>(
    field: ModelInputAdjustment["field"],
    value: T | undefined,
    allowed: readonly T[] | undefined,
    preferred?: T,
  ): T | undefined => {
    if (value === undefined) return undefined
    if (!allowed || allowed.length === 0) {
      adjustments.push({
        field,
        from: value,
        to: undefined,
        reason: `${m.label} has no ${field} setting — the value was dropped.`,
      })
      return undefined
    }
    if (allowed.includes(value)) return value
    // Same value, different spelling — canonicalize instead of "correcting".
    // Stored data is not uniform with the catalog's display form: Flux 2 bills
    // off a bare megapixel count ("1") while the catalog lists "1 MP", and "4k"
    // appears alongside "4K". Treating those as invalid would snap a perfectly
    // good value to a DIFFERENT tier — i.e. silently re-price the node — which
    // is worse than the bug this function exists to fix.
    const canonical = allowed.find((a) => sameOptionValue(a, value))
    if (canonical !== undefined) return canonical
    const next = preferred !== undefined && allowed.includes(preferred) ? preferred : allowed[0]
    adjustments.push({
      field,
      from: value,
      to: next,
      reason: `${m.label} does not support ${field} "${value}" — using "${next}" instead. Supported: ${allowed.join(", ")}.`,
    })
    return next
  }

  // The file first: a GIF's ratio and size, and every format's background, follow it.
  const format = normalizeOutputFormat(m, input, adjustments)
  out.outputFormat = format.levers.outputFormat
  out.gifFrames = format.levers.gifFrames
  out.gifFrameDurationMs = format.levers.gifFrameDurationMs
  out.svgLevel = format.levers.svgLevel
  const gif = format.levers.outputFormat === "gif"
  // A masked edit that follows its photo runs at "auto" whatever ratio it
  // names, and at the size nearest the photo (`maskEditMatchesSource`).
  const followsSource = !gif && maskEditMatchesSource(modelId, context.masked)
  const askedRatio = followsSource ? "auto" : input.aspectRatio

  const sourceRatio =
    !gif && autoAspectNeedsSourceImage(modelId, askedRatio) && usableSize(context.sourceImage)
      ? nearestCatalogAspectRatio(context.sourceImage.width, context.sourceImage.height, m.aspectRatios ?? [])
      : undefined
  if (followsSource && input.aspectRatio !== undefined && !isAutoAspectToken(input.aspectRatio)) {
    const to = sourceRatio ?? "auto"
    if (to !== input.aspectRatio) {
      adjustments.push({
        field: "aspectRatio",
        from: input.aspectRatio,
        to,
        reason: sourceRatio !== undefined
          ? `A masked edit on ${m.label} keeps the photo's shape — using "${sourceRatio}", the supported ratio closest to the source image (${context.sourceImage!.width}x${context.sourceImage!.height}).`
          : `A masked edit on ${m.label} keeps the photo's shape — using "auto".`,
      })
    }
    out.aspectRatio = to
  } else if (followsSource && input.aspectRatio === undefined) {
    out.aspectRatio = sourceRatio ?? "auto"
  } else if (gif) {
    // A GIF is square, IMAGE_GIF_FRAME_SIZE a frame: neither lever applies.
    // "auto" leaves the shape to the model, and square is its answer.
    if (input.aspectRatio !== undefined && input.aspectRatio !== "1:1" && !isAutoAspectToken(input.aspectRatio)) {
      adjustments.push({
        field: "aspectRatio",
        from: input.aspectRatio,
        to: "1:1",
        reason: `A GIF from ${m.label} is square (${IMAGE_GIF_FRAME_SIZE}x${IMAGE_GIF_FRAME_SIZE} a frame), so the aspect ratio does not apply.`,
      })
    }
    out.aspectRatio = input.aspectRatio === undefined ? undefined : "1:1"
  } else if (sourceRatio !== undefined && askedRatio !== undefined) {
    const { width, height } = context.sourceImage!
    const why = m.autoAspectFromSourceImage === true
      ? `${m.label}'s own "auto" does not keep the photo's shape`
      : `${m.label} has no "auto" aspect ratio`
    adjustments.push({
      field: "aspectRatio",
      from: input.aspectRatio ?? askedRatio,
      to: sourceRatio,
      reason: `${why} — using "${sourceRatio}", the supported ratio closest to the source image's shape (${width}x${height}).`,
    })
    out.aspectRatio = sourceRatio
  } else {
    out.aspectRatio = snap("aspectRatio", input.aspectRatio, m.aspectRatios)
  }
  if (followsSource) {
    // The size whose long side is nearest the photo's: the result is the
    // photo's own size, so the run is rendered, and priced, near it.
    const asked = snap("resolution", input.resolution, m.resolutions, defaultResolutionFor(modelId))
    const nearest = resolutionNearestSource(modelId, out.aspectRatio, context.sourceImage)
    const from = asked ?? m.defaultResolution ?? m.resolutions?.[0]
    if (nearest !== undefined && from !== undefined && nearest !== from) {
      const { width, height } = context.sourceImage!
      adjustments.push({
        field: "resolution",
        from,
        to: nearest,
        reason: `A masked edit on ${m.label} is delivered at the photo's own size (${width}x${height}) — rendering at ${nearest}, the size nearest it.`,
      })
    }
    out.resolution = nearest ?? asked
  } else if (gif) {
    if (input.resolution !== undefined) {
      adjustments.push({
        field: "resolution",
        from: input.resolution,
        to: undefined,
        reason: `A GIF from ${m.label} is ${IMAGE_GIF_FRAME_SIZE}x${IMAGE_GIF_FRAME_SIZE} a frame, so the size does not apply.`,
      })
    }
    out.resolution = undefined
  } else {
    out.resolution = snap(
      "resolution",
      input.resolution,
      m.resolutions,
      defaultResolutionFor(modelId),
    )
  }
  out.quality = snap("quality", input.quality, m.qualities, m.defaultQuality)
  out.background = snap("background", input.background, m.backgrounds)
  // A transparent background is kept only by a format with an alpha channel the
  // provider fills (PNG, WebP); an SVG takes no background setting at all.
  const writes = format.levers.outputFormat
  if (writes !== undefined && out.background !== undefined && out.background !== "auto") {
    const dropped = writes === "svg" || (out.background === "transparent" && !TRANSPARENT_OUTPUT_FORMATS.includes(writes))
    if (dropped) {
      adjustments.push({
        field: "background",
        from: out.background,
        to: "auto",
        reason: writes === "svg"
          ? `An SVG from ${m.label} takes no background setting.`
          : `${m.label} only keeps a transparent background in PNG or WebP, not ${writes.toUpperCase()}.`,
      })
      out.background = "auto"
    }
  }
  out.duration =
    m.autoDuration === true && isAutoVideoDuration(input.duration)
      ? input.duration
      : snap("duration", input.duration, m.durations)

  // A size the chosen ratio does not render (`resolutionsByAspectRatio`: GPT
  // Image 2.5's four 1K-only ratios) moves to the largest one it does at or
  // below it. After the snaps above, so it sees the
  // ratio and size as they will be sent; before the background rules below,
  // which read the size this leaves, and before any price is built.
  const sized = resolutionAtAspectRatio(modelId, out.aspectRatio, out.resolution)
  if (out.resolution !== undefined && sized !== undefined && sized !== out.resolution) {
    const offered = resolutionsAtAspectRatio(modelId, out.aspectRatio) ?? [sized]
    adjustments.push({
      field: "resolution",
      from: out.resolution,
      to: sized,
      reason: `${m.label} only renders ${offered.join(" or ")} at the "${out.aspectRatio}" aspect ratio.`,
    })
    out.resolution = sized
  }

  // A transparent background only renders at the size the provider allows it.
  // Priced after this, so the run pays for the size it renders.
  if (
    out.background === "transparent" &&
    m.transparentResolution !== undefined &&
    out.resolution !== undefined &&
    out.resolution !== m.transparentResolution
  ) {
    adjustments.push({
      field: "resolution",
      from: out.resolution,
      to: m.transparentResolution,
      reason: `${m.label} only renders a transparent background at ${m.transparentResolution}.`,
    })
    out.resolution = m.transparentResolution
  }

  // Above that size such a model takes no background setting at all. `auto` is
  // what it does anyway, so only `opaque` is a change worth saying.
  if (
    m.backgroundOnlyAtTransparentResolution &&
    out.background !== undefined &&
    out.resolution !== undefined &&
    out.resolution !== m.transparentResolution
  ) {
    if (out.background !== "auto") {
      adjustments.push({
        field: "background",
        from: out.background,
        to: undefined,
        reason: `${m.label} only takes a background setting at ${m.transparentResolution}.`,
      })
    }
    out.background = undefined
  }

  return out
}

/** The format levers of a request after `normalizeOutputFormat`: a GIF's and an SVG's only when that is the file written. */
interface NormalizedFormatLevers {
  outputFormat?: string
  gifFrames?: number
  gifFrameDurationMs?: number
  svgLevel?: string
}

/**
 * The file a request writes, snapped to what the model writes, and the levers
 * of that file: a GIF's frames and speed, an SVG's level. Each takes its
 * default when the file is written and it is not named (so what is sent and
 * priced is what is recorded), and is left out for any other file, a value
 * the canvas keeps on a node for when GIF is chosen again. No format named is
 * the model's own (PNG), and nothing is set.
 */
function normalizeOutputFormat(
  m: ModelCatalogEntry,
  input: { outputFormat?: string; gifFrames?: number; gifFrameDurationMs?: number; svgLevel?: string },
  adjustments: ModelInputAdjustment[],
): { levers: NormalizedFormatLevers } {
  if (input.outputFormat === undefined) return { levers: {} }
  const asked = input.outputFormat.trim().toLowerCase()
  const value = asked === "jpg" ? "jpeg" : asked
  const formats = m.outputFormats
  if (!formats || formats.length === 0) {
    adjustments.push({
      field: "outputFormat",
      from: input.outputFormat,
      to: undefined,
      reason: `${m.label} has no outputFormat setting — the value was dropped.`,
    })
    return { levers: {} }
  }
  let outputFormat = formats.find((f) => f === value)
  if (outputFormat === undefined) {
    outputFormat = formats[0]!
    adjustments.push({
      field: "outputFormat",
      from: input.outputFormat,
      to: outputFormat,
      reason: `${m.label} does not write "${input.outputFormat}" — using "${outputFormat}" instead. Supported: ${formats.join(", ")}.`,
    })
  }
  if (outputFormat === "gif") {
    return { levers: { outputFormat, gifFrames: gifFramesFor(m, input.gifFrames, adjustments), gifFrameDurationMs: gifFrameDurationFor(m, input.gifFrameDurationMs, adjustments) } }
  }
  if (outputFormat === "svg") {
    const levels = m.svgLevels ?? []
    const askedLevel = input.svgLevel?.trim().toLowerCase()
    let svgLevel = askedLevel === undefined ? levels[0] : levels.find((l) => l === askedLevel)
    if (input.svgLevel !== undefined && svgLevel === undefined && levels.length > 0) {
      svgLevel = levels[0]
      adjustments.push({
        field: "svgLevel",
        from: input.svgLevel,
        to: svgLevel,
        reason: `${m.label} does not draw an SVG at level "${input.svgLevel}" — using "${svgLevel}" instead. Supported: ${levels.join(", ")}.`,
      })
    }
    return { levers: { outputFormat, ...(svgLevel !== undefined && { svgLevel }) } }
  }
  return { levers: { outputFormat } }
}

/** A GIF's frames on `m`: the default when none, else a whole number in its range, or the nearest it takes. */
function gifFramesFor(m: ModelCatalogEntry, asked: number | undefined, adjustments: ModelInputAdjustment[]): number | undefined {
  const spec = m.gifFrames
  if (!spec) return asked
  if (asked === undefined || !Number.isFinite(asked)) return spec.default
  const inRange = Math.min(Math.max(Math.round(asked), spec.min), spec.max)
  const frames = spec.values && spec.values.length > 0
    ? spec.values.reduce((best, v) => (Math.abs(v - inRange) < Math.abs(best - inRange) ? v : best), spec.values[0]!)
    : inRange
  if (frames !== asked) {
    adjustments.push({
      field: "gifFrames",
      from: asked,
      to: frames,
      reason: spec.values && spec.values.length > 0
        ? `A GIF from ${m.label} has ${spec.values.join(", ")} frames — using ${frames}.`
        : `A GIF from ${m.label} has ${spec.min} to ${spec.max} frames — using ${frames}.`,
    })
  }
  return frames
}

/** How long each GIF frame shows on `m`: the default when none, else inside its range, rounded to its step. */
function gifFrameDurationFor(m: ModelCatalogEntry, asked: number | undefined, adjustments: ModelInputAdjustment[]): number | undefined {
  const spec = m.gifFrameDurationMs
  if (!spec) return asked
  if (asked === undefined || !Number.isFinite(asked)) return spec.default
  const ms = Math.min(Math.max(Math.round(asked / spec.step) * spec.step, spec.min), spec.max)
  if (ms !== asked) {
    adjustments.push({
      field: "gifFrameDurationMs",
      from: asked,
      to: ms,
      reason: `${m.label} shows each GIF frame ${spec.min} to ${spec.max} ms, in steps of ${spec.step} — using ${ms}.`,
    })
  }
  return ms
}

/** Aspect tokens that mean "match the input" or "let the provider decide". They
 *  are NOT concrete ratios, so snapping them onto one is always wrong — the
 *  provider adapter (applySeedance2Params, applyMinimaxH3Params) resolves them
 *  once it knows the run's mode. */
const PASSTHROUGH_ASPECT_TOKENS = new Set(["auto", "adaptive"])

/** Approximate vertical pixel count per band token, for nearest-band matching.
 *  Anything of the form `<N>p` is parsed directly; these are the named bands
 *  the catalogs use that do not follow that form. */
const RESOLUTION_BAND_PIXELS: Record<string, number> = {
  "2k": 1440,
  "4k": 2160,
  "8k": 4320,
}

function bandPixels(token: string): number | undefined {
  const t = token.trim().toLowerCase()
  if (RESOLUTION_BAND_PIXELS[t] !== undefined) return RESOLUTION_BAND_PIXELS[t]
  const m = /^(\d+)p$/.exec(t)
  return m ? Number(m[1]) : undefined
}

/** Nearest member of `allowed` to `token` by vertical pixels. An UNPARSEABLE
 *  request falls back to the highest declared band — never the cheapest, which
 *  is what a catalog-order fallback would give (R7). Highest is computed from
 *  the pixel counts, not from the array position: most video catalogs list
 *  ascending but not all do (minimax-h3 is `["2K", "768P"]`), and an ordering
 *  convention is not something a money path should depend on. */
function nearestResolutionBand(token: string, allowed: readonly string[]): string {
  let highest = allowed[allowed.length - 1]!
  let highestPx = -Infinity
  for (const a of allowed) {
    const px = bandPixels(a)
    if (px !== undefined && px > highestPx) { highestPx = px; highest = a }
  }
  const want = bandPixels(token)
  if (want === undefined) return highest
  let best = highest
  let bestDist = Infinity
  for (const a of allowed) {
    const px = bandPixels(a)
    if (px === undefined) continue
    const d = Math.abs(px - want)
    if (d < bestDist) { bestDist = d; best = a }
  }
  return best
}

/** Nearest aspect ratio in log space. Mirrors
 *  `backend/src/providers/video/aspect-ratio.ts` exactly — that helper cannot
 *  be imported here (wrong package), and the totality test in
 *  `backend/src/lib/mcp/__tests__/video-normalizer-totality.test.ts` pins the
 *  two implementations to the same answer for every catalogued model. */
function nearestAspectRatio(token: string, allowed: readonly string[]): string | undefined {
  const [w, h] = token.split(":").map(Number)
  if (!w || !h) return undefined
  const target = Math.log(w / h)
  let best: string | undefined
  let bestDist = Infinity
  for (const c of allowed) {
    const [cw, ch] = c.split(":").map(Number)
    if (!cw || !ch) continue
    const d = Math.abs(Math.log(cw / ch) - target)
    if (d < bestDist) { bestDist = d; best = c }
  }
  return best
}

/**
 * `ratio` as `modelId` renders it: the catalog's own spelling when the model
 * lists it (any case), else the nearest ratio it lists (log space — a portrait
 * request stays portrait). "auto" / "adaptive", an empty token, a model without
 * a ratio list and an unknown model pass through unchanged. The ONE fitting
 * rule: the video lane's normalizer applies it, and so does a node's Settings
 * input for a wired Aspect Ratio (settings-input.ts), image models included.
 */
export function fitAspectRatioToModel(modelId: string, ratio: string): string {
  const token = ratio.trim()
  const allowed = MODEL_CATALOG[modelId]?.aspectRatios
  if (!allowed?.length || token === "" || PASSTHROUGH_ASPECT_TOKENS.has(token.toLowerCase())) return token
  const exact = allowed.find((a) => a === token) ?? allowed.find((a) => a.toLowerCase() === token.toLowerCase())
  if (exact !== undefined) return exact
  return nearestAspectRatio(token, allowed.filter((a) => !PASSTHROUGH_ASPECT_TOKENS.has(a.toLowerCase()))) ?? allowed[0]!
}

/**
 * Read a catalog lever off an UNVALIDATED input as a trimmed string.
 *
 * `normalizeVideoRequestParams` runs in both routes' creditGuard preHandler —
 * which fires BEFORE the route's Zod parse — and in all four `buildPayload`
 * branches, whose `data` is persisted workflow JSON that an agent/import/
 * FieldMapping can write any JSON type into. A bare `.trim()` therefore throws
 * `TypeError` on `{"resolution": 1080}`: a 500 where the route used to return a
 * clean Zod 400, and in the DAG a thrown lever takes the WHOLE run down after
 * sibling nodes have already reserved and generated. So coerce rather than
 * assume — same posture as `sameOptionValue`, which has always used `String(v)`.
 *
 * `null`/`undefined`/blank mean "absent" (there is nothing to snap) and read as
 * `undefined`, so the priced fill downstream supplies the band the identifier
 * assumes — price and wire still agree. Everything else is stringified: a
 * numeric `1080` becomes `"1080"` and snaps like its string form.
 */
function readOptionToken(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const s = (typeof value === "string" ? value : String(value)).trim()
  return s === "" ? undefined : s
}

export interface NormalizedVideoRequest {
  aspectRatio?: string
  resolution?: string
  adjustments: ModelInputAdjustment[]
}

/**
 * The video lane's LIMITED normalizer: `aspectRatio` + `resolution` only, and
 * only when the catalog actually declares the option list.
 *
 * Three deliberate differences from `normalizeModelInput`:
 *   1. It never DROPS a lever. `normalizeModelInput` removes a value whose list
 *      the catalog doesn't declare; on the video lane `resolution` is a pricing
 *      input, so dropping it would lower the reserved tier and `commit_credits`
 *      never collects an upward delta — a params fix would become a money bug.
 *   2. "Auto" / "adaptive" pass through (see PASSTHROUGH_ASPECT_TOKENS).
 *   3. It snaps to the NEAREST option, not to `allowed[0]`. `normalizeModelInput`
 *      would turn a portrait 9:21 into landscape 16:9 and a 4k request into the
 *      cheapest 480p; nearest matches what the provider adapters and the MCP
 *      normalizer already do, so all three give ONE answer. Its snap policy is
 *      deliberately left alone — it is shared with the image lane and the
 *      copilot, and PR 4 defers changing it.
 *
 * `duration` is deliberately NOT normalized here: the LTX bands make duration
 * legality resolution-dependent, which a flat catalog list can't express, and
 * `buildVideoCreditModelIdentifier` already snaps duration onto a seeded tier.
 * Carrying THAT tier to the wire is `pricedVideoSelection`'s job
 * (`credit-identifiers.ts`), which runs after this one, once resolution is known.
 *
 * An OMITTED lever stays omitted here — filling it is a pricing decision, not a
 * catalog one, and likewise belongs to `pricedVideoSelection`.
 *
 * Case is canonicalised to the catalog's own spelling — the credit identifiers
 * key their tables case-SENSITIVELY (LTX_DURATION_TIERS), so this is the single
 * place a "4K" becomes "4k", and it runs before every identifier site.
 *
 * Pure — so the credit-identifier preHandler, `computeCredits`, the reservation
 * site and the payload build can all call it and cannot disagree (spec §4).
 */
export function normalizeVideoRequestParams(
  modelId: string,
  input: { aspectRatio?: string; resolution?: string; draft?: boolean },
): NormalizedVideoRequest {
  const m = MODEL_CATALOG[modelId]
  // Seeded from the COERCED tokens, never the raw input: this function's own
  // return type promises `string | undefined`, and its callers feed it straight
  // to the credit identifier and the provider wire. Handing back the caller's
  // `1080` or `[]` verbatim would break that promise at exactly the sites that
  // must agree on one value.
  const aspect = readOptionToken(input.aspectRatio)
  const requestedRes = readOptionToken(input.resolution)
  // Seedance Draft renders at 480p only (the provider rejects anything else),
  // so a draft is PRICED and SENT at 480p whatever resolution came with it — an
  // agent, an import or a FieldMapping can pair `draft` with 720p, and the
  // reservation must not follow the stale value. An omitted resolution is a
  // fill, not a correction, so it reports nothing.
  const draft = input.draft === true && isSeedanceDraftCapable(modelId)
  const res = draft ? SEEDANCE_DRAFT_RESOLUTION : requestedRes
  const out: NormalizedVideoRequest = { aspectRatio: aspect, resolution: res, adjustments: [] }
  if (draft && requestedRes !== undefined && requestedRes.toLowerCase() !== SEEDANCE_DRAFT_RESOLUTION) {
    out.adjustments.push({
      field: "resolution", from: requestedRes, to: SEEDANCE_DRAFT_RESOLUTION,
      reason: `A Seedance draft renders at ${SEEDANCE_DRAFT_RESOLUTION} only — using "${SEEDANCE_DRAFT_RESOLUTION}" instead of "${requestedRes}". Finalize the draft to get the same take at 1080p.`,
    })
  }
  if (!m) return out

  if (m.aspectRatios?.length && aspect && !PASSTHROUGH_ASPECT_TOKENS.has(aspect.toLowerCase())) {
    const next = fitAspectRatioToModel(modelId, aspect)
    // A case-only difference is the same ratio canonicalised, not a correction.
    if (next.toLowerCase() !== aspect.toLowerCase()) {
      out.adjustments.push({
        field: "aspectRatio", from: aspect, to: next,
        reason: `${m.label} does not support aspect ratio "${aspect}" — using "${next}" instead. Supported: ${m.aspectRatios.join(", ")}.`,
      })
    }
    out.aspectRatio = next
  }

  if (m.resolutions?.length && res) {
    const allowed = m.resolutions
    const exact = allowed.find((a) => a === res) ?? allowed.find((a) => a.toLowerCase() === res.toLowerCase())
    if (exact !== undefined) {
      out.resolution = exact
    } else {
      // A provider that COLLAPSES an unrecognised band renders its declared
      // default no matter what we send, so that default — not the nearest band
      // — is the value the wire and the price must both carry.
      const next = m.unlistedResolutionRendersAs ?? nearestResolutionBand(res, allowed)
      out.adjustments.push({
        field: "resolution", from: res, to: next,
        reason: `${m.label} does not support resolution "${res}" — using "${next}" instead. Supported: ${allowed.join(", ")}.`,
      })
      out.resolution = next
    }
  }

  return out
}

// =============================================================================
// Frontend picker helpers — return `{value, label}[]` shapes that the
// existing config-panel components expect, derived from the catalog so we
// don't duplicate registries between backend and frontend.
// =============================================================================

/**
 * Global value-label decorations. Per-model overrides live on
 * `ModelCatalogEntry.valueLabels` (e.g. Hailuo's "1080P (6s max)").
 *
 * Add entries here when a value should render with a richer human label.
 * Plain values (3:2, 4:3, 720p, etc.) can stay undecorated — the value
 * itself is the label and we fall back to `value` automatically.
 */
const MODEL_VALUE_LABELS: Record<string, string> = {
  // aspect ratios
  "1:1": "1:1 (Square)",
  "16:9": "16:9 (Landscape)",
  "9:16": "9:16 (Portrait)",
  "21:9": "21:9 (Ultra-wide)",
  "9:21": "9:21 (Tall ultra-wide)",
  "auto": "Auto",
  "adaptive": "Adaptive",
  // image resolutions
  "1K": "1K (Standard)",
  // Only Seedream 5.5 lists it.
  "1.5K": "1.5K (Medium)",
  "2K": "2K (High)",
  "4K": "4K (Ultra)",
  "4k": "4K",
  "2k": "2K",
  "8K": "8K (Ultra)",
  // qualities
  "low": "Low (Fast)",
  "medium": "Medium (Balanced)",
  "high": "High (Detailed)",
  "basic": "Basic (2K)",
  "TURBO": "Turbo (fast)",
  "BALANCED": "Balanced",
  "QUALITY": "Quality (best)",
}

function decorateLabel(model: ModelCatalogEntry, value: string): string {
  return model.valueLabels?.[value] ?? MODEL_VALUE_LABELS[value] ?? value
}

export interface LabeledOption {
  value: string
  label: string
}

/** Return `{value, label}[]` for the model's aspect ratios, or `null` if none. */
export function getAspectRatioOptions(modelId: string): LabeledOption[] | null {
  const m = MODEL_CATALOG[modelId]
  if (!m?.aspectRatios) return null
  return m.aspectRatios.map((v) => ({ value: v, label: decorateLabel(m, v) }))
}

/** Return `{value, label}[]` for the model's resolution lever, or `null` if none. */
export function getResolutionOptions(modelId: string): LabeledOption[] | null {
  const m = MODEL_CATALOG[modelId]
  if (!m?.resolutions) return null
  return m.resolutions.map((v) => ({ value: v, label: decorateLabel(m, v) }))
}

/** Return `{value, label}[]` for the model's quality lever, or `null` if none. */
export function getQualityOptions(modelId: string): LabeledOption[] | null {
  const m = MODEL_CATALOG[modelId]
  if (!m?.qualities) return null
  return m.qualities.map((v) => ({ value: v, label: decorateLabel(m, v) }))
}

/** Return the model's allowed durations (in seconds), or `null` if none. */
export function getDurationsForModel(modelId: string): number[] | null {
  const m = MODEL_CATALOG[modelId]
  if (!m?.durations) return null
  return [...m.durations]
}

/**
 * Min/max credits across all pricing variants — used by the frontend's
 * "5–8 cr" range badge in the model dropdown. `null` for models with a
 * single price point.
 */
export function getCreditRange(modelId: string): { min: number; max: number } | null {
  const m = MODEL_CATALOG[modelId]
  if (!m || m.pricing.length < 2) return null
  let min = Infinity
  let max = -Infinity
  for (const p of m.pricing) {
    if (p.credits < min) min = p.credits
    if (p.credits > max) max = p.credits
  }
  return { min, max }
}

/** Whether the model declares a given capability flag in its `features` array. */
export function hasFeature(modelId: string, feature: string): boolean {
  return MODEL_CATALOG[modelId]?.features?.includes(feature) ?? false
}

/**
 * Whether a seed on this model does anything — false only for a catalog entry
 * that declares `noSeed`. An unknown or missing id answers true, so a surface
 * never hides a Seed field for a model it knows nothing about.
 */
export function modelTakesSeed(modelId: string | undefined): boolean {
  if (!modelId) return true
  return MODEL_CATALOG[modelId]?.noSeed !== true
}

/**
 * All ids in the catalog whose `features` includes the given flag. Used by
 * frontend to build PROVIDERS_WITH_END_FRAME / PROVIDERS_WITH_REFERENCES
 * lists derived from the catalog.
 */
export function modelsWithFeature(feature: string): string[] {
  return Object.values(MODEL_CATALOG)
    .filter((m) => m.features?.includes(feature))
    .map((m) => m.id)
}

/**
 * Map of `{modelId: durations[]}` for every catalog entry whose `modes`
 * includes the given mode. Used to derive KIE_VIDEO_DURATIONS (mode i2v)
 * and KIE_T2V_DURATIONS (mode t2v) on the frontend.
 */
export function durationsByMode(mode: ModelMode): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    if (!m.modes.includes(mode)) continue
    if (!m.durations) continue
    out[m.id] = [...m.durations]
  }
  return out
}

/**
 * Map of `{modelId: LabeledOption[]}` for every catalog entry of the given
 * kind that exposes a resolution lever. Used to derive
 * IMAGE_RESOLUTION_OPTIONS / VIDEO_RESOLUTION_OPTIONS on the frontend.
 */
export function resolutionOptionsByKind(kind: ModelKind): Record<string, LabeledOption[]> {
  const out: Record<string, LabeledOption[]> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    if (m.kind !== kind) continue
    if (!m.resolutions) continue
    out[m.id] = m.resolutions.map((v) => ({ value: v, label: decorateLabel(m, v) }))
  }
  return out
}

/**
 * Map of `{modelId: LabeledOption[]}` for every catalog entry of the given
 * kind that exposes an aspect_ratio lever.
 */
export function aspectRatioOptionsByKind(kind: ModelKind): Record<string, LabeledOption[]> {
  const out: Record<string, LabeledOption[]> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    if (m.kind !== kind) continue
    if (!m.aspectRatios) continue
    out[m.id] = m.aspectRatios.map((v) => ({ value: v, label: decorateLabel(m, v) }))
  }
  return out
}

/** Same shape as `aspectRatioOptionsByKind` but for `qualities`. */
export function qualityOptionsByKind(kind: ModelKind): Record<string, LabeledOption[]> {
  const out: Record<string, LabeledOption[]> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    if (m.kind !== kind) continue
    if (!m.qualities) continue
    out[m.id] = m.qualities.map((v) => ({ value: v, label: decorateLabel(m, v) }))
  }
  return out
}

/** Same shape as `qualityOptionsByKind` but for `backgrounds`. */
export function backgroundOptionsByKind(kind: ModelKind): Record<string, LabeledOption[]> {
  const out: Record<string, LabeledOption[]> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    if (m.kind !== kind) continue
    if (!m.backgrounds) continue
    out[m.id] = m.backgrounds.map((v) => ({ value: v, label: decorateLabel(m, v) }))
  }
  return out
}

/** How an output format is named in a menu. */
export const IMAGE_OUTPUT_FORMAT_LABELS: Readonly<Record<string, string>> = {
  png: "PNG",
  jpeg: "JPEG",
  webp: "WebP",
  gif: "GIF (animated)",
  svg: "SVG (vector)",
}

/** How an SVG level of detail is named in a menu (its own table: `max` is also a quality). */
export const IMAGE_SVG_LEVEL_LABELS: Readonly<Record<string, string>> = {
  standard: "SVG Standard",
  detailed: "SVG Detailed",
  max: "SVG Max",
}

/** The output formats per model of a kind, the model's default first. No entry: a single format, not a setting. */
export function outputFormatOptionsByKind(kind: ModelKind): Record<string, LabeledOption[]> {
  const out: Record<string, LabeledOption[]> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    if (m.kind !== kind || !m.outputFormats || m.outputFormats.length < 2) continue
    out[m.id] = m.outputFormats.map((v) => ({ value: v, label: IMAGE_OUTPUT_FORMAT_LABELS[v] ?? v }))
  }
  return out
}

/** The SVG levels per model of a kind that writes SVG. */
export function svgLevelOptionsByKind(kind: ModelKind): Record<string, LabeledOption[]> {
  const out: Record<string, LabeledOption[]> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    if (m.kind !== kind || !m.outputFormats?.includes("svg") || !m.svgLevels) continue
    out[m.id] = m.svgLevels.map((v) => ({ value: v, label: IMAGE_SVG_LEVEL_LABELS[v] ?? v }))
  }
  return out
}

/** One shaped model row for a picker — capabilities derived from the catalog. */
export interface ModelMenuOption {
  /** Catalog id (the API enum value). */
  id: string
  /** Human-readable display name from the catalog. */
  label: string
  /** Resolution levers, `[]` when the model exposes none. */
  resolutions: LabeledOption[]
  /** Aspect-ratio levers, `[]` when the model exposes none. */
  aspectRatios: LabeledOption[]
  /** Duration levers in seconds (union of i2v+t2v modes); `[]` for image / fixed-duration models. */
  durations: { value: number; label: string }[]
}

/**
 * Build shaped picker rows for one catalog `kind` from a caller-supplied id
 * allowlist (the curation — which ids, in what order, stays the caller's). Every
 * CAPABILITY is derived from the catalog accessors, never hardcoded, so the menu
 * can't drift as the catalog evolves. Ids absent from the catalog or of the
 * wrong kind are skipped (so a stale allowlist entry drops out cleanly). Pure;
 * returns fresh arrays (never aliases the accessor maps).
 */
export function buildModelMenu(
  kind: ModelKind,
  allowlist: readonly string[],
): ModelMenuOption[] {
  const resByModel = resolutionOptionsByKind(kind)
  const arByModel = aspectRatioOptionsByKind(kind)
  const i2v = durationsByMode("i2v")
  const t2v = durationsByMode("t2v")
  const out: ModelMenuOption[] = []
  for (const id of allowlist) {
    const entry = MODEL_CATALOG[id]
    if (!entry || entry.kind !== kind) continue
    const durations = Array.from(new Set([...(i2v[id] ?? []), ...(t2v[id] ?? [])]))
      .sort((a, b) => a - b)
      .map((n) => ({ value: n, label: `${n}s` }))
    out.push({
      id: entry.id,
      label: entry.label,
      resolutions: [...(resByModel[id] ?? [])],
      aspectRatios: [...(arByModel[id] ?? [])],
      durations,
    })
  }
  return out
}

/** All `{modelId: {min, max}}` entries that have variable pricing (>1 variant). */
export function creditRangesAll(): Record<string, { min: number; max: number }> {
  const out: Record<string, { min: number; max: number }> = {}
  for (const m of Object.values(MODEL_CATALOG)) {
    const range = getCreditRange(m.id)
    if (range) out[m.id] = range
  }
  return out
}

/**
 * Tuple of model ids for a given kind + one or more modes. Built for use as
 * a Zod `z.enum()` argument so MCP tool input schemas stay in sync with the
 * catalog without manual maintenance.
 *
 * Filters out `mcpHidden: true` entries by default — pass `includeHidden`
 * to surface legacy versions (used internally by validators that still need
 * to recognize older ids forwarded by direct API callers).
 *
 * Pass `kind: null` to skip the kind filter — useful for cross-kind ids
 * like "grok" (catalog kind=image, modes include both t2i and t2v).
 */
export function modelIdsByKindMode(
  kind: ModelKind | null,
  modes: readonly ModelMode[],
  opts: { includeHidden?: boolean } = {},
): [string, ...string[]] {
  const includeHidden = opts.includeHidden === true
  const ids = Object.values(MODEL_CATALOG)
    .filter((m) => (kind === null ? true : m.kind === kind))
    .filter((m) => m.modes.some((md) => modes.includes(md)))
    .filter((m) => includeHidden || !m.mcpHidden)
    .filter((m) => !m.docsHidden && m.pickerHidden !== true)
    .map((m) => m.id)
    .sort()
  if (ids.length === 0) {
    throw new Error(
      `modelIdsByKindMode: no models match kind=${kind ?? "*"} modes=[${modes.join(",")}]`,
    )
  }
  return ids as [string, ...string[]]
}
