/**
 * Studio model menu — the studio-curated subset of Nodaro's `MODEL_CATALOG`.
 *
 * The menu is fully DATA-DRIVEN: Studio owns only the tiny curation allowlists
 * (which ids, in what order, the subset the studio surface exposes) plus the
 * camera-motion / feature helpers below. Every *capability* (resolutions,
 * aspect ratios, the i2v+t2v duration union) is composed by `@nodaro/shared`'s
 * `buildModelMenu(kind, allowlist)` — the single source of truth, living next
 * to `MODEL_CATALOG` so it can't drift from the catalog it reads. We NEVER
 * hardcode a model's capability list here.
 *
 * Mirrors how Nodaro's frontend derives its picker rows from the catalog
 * rather than maintaining parallel constants.
 */
import {
  buildModelMenu,
  modelsWithFeature,
  modelIdsByKindMode,
  getModel,
  getCreditRange,
  getResolutionOptions,
  getQualityOptions,
  getMaxNegativePromptChars,
  MODIFY_IMAGE_PROVIDERS,
  NATIVE_NEGATIVE_PROMPT_MODELS,
  NATIVE_NEGATIVE_VIDEO_PROVIDERS,
  PRICING_DEFAULT_RESOLUTION,
  VIDEO_REF_LIMITS_BY_PROVIDER,
  imageReferenceLimit,
  videoModelCanSpeakDialogue,
  getVideoAudioCapability,
  buildVideoCreditModelIdentifier,
  resolveImageGenCreditIdentifier,
  videoProviderRequiresImage,
  type LabeledOption,
  type ModelMenuOption,
  type VideoAudioCapability,
} from "@nodaro/shared"
import {
  CAMERA_MOTIONS,
} from "@nodaro/prompts"

/** Re-exported so existing importers (`model-menu`) keep their type. */
export type { ModelMenuOption } from "@nodaro/shared"

/**
 * Whether a model NATIVELY accepts a `negativePrompt` field — gates the
 * Composer's "Negative prompt" input per stage. Derived from the platform's
 * own sets ({@link NATIVE_NEGATIVE_PROMPT_MODELS} for image models,
 * {@link NATIVE_NEGATIVE_VIDEO_PROVIDERS} for video providers — Kling/Wan
 * families), NEVER a hardcoded list. Deliberately native-only: the routes can
 * fold an "Avoid: …" clause into the prompt for any other model, but the field
 * is offered exactly where the model itself honors it (user decision).
 */
export function negativePromptSupported(
  kind: "image" | "video",
  provider: string,
): boolean {
  return kind === "image"
    ? NATIVE_NEGATIVE_PROMPT_MODELS.has(provider)
    : NATIVE_NEGATIVE_VIDEO_PROVIDERS.has(provider)
}

/** Per-provider negative-prompt character cap (catalog-derived) — the field's
 *  `maxLength`. Re-exported so composer code reads model policy from ONE place. */
export { getMaxNegativePromptChars }

/** Re-exported so studio reads the per-image reference cap from ONE place — the
 *  scalar image analogue of {@link videoReferenceLimits} (`> 0` = supports refs). */
export { imageReferenceLimit }

/**
 * Re-exported: whether a video model can produce lip-synced spoken DIALOGUE —
 * VEO 3.x natively, Kling 2.6/3.0 natively (toggleable, since
 * `@nodaro/shared@1.11.0`), Seedance 2 audio-driven (catalog-derived from the
 * platform's `VIDEO_AUDIO_CAPABILITY`). The single gate for the Directing
 * Character Voice feature: offer voice only for capable models + drive the
 * "won't produce voice" confirm for the rest. Ambient-only / silent models
 * return `false`.
 */
export { videoModelCanSpeakDialogue }

/**
 * Re-exported: the EXACT credit identifier the server bills a video run under
 * (model + duration + audio toggle, e.g. `kling-3.0:5s:audio`) — the Directing
 * cost preview prices this instead of the bare model id so audio-surcharged and
 * `defaultOn` models quote truthfully. A no-resolution call quotes each model's
 * real billing default via the shared `PRICING_DEFAULT_RESOLUTION` (e.g.
 * Seedance 2.5 → 720p), so the preview can't understate a 720p-default model.
 */
export { buildVideoCreditModelIdentifier }

/**
 * Re-exported: the EXACT credit identifier the server bills an image run under
 * (model + quality/resolution tier + the T2I→I2I swap when refs are attached,
 * e.g. `gpt-image-2:2K`) — the Framing cost preview prices this instead of the
 * bare model id so tiered models (Flux 2, GPT Image 2) quote truthfully. Mirrors
 * {@link buildVideoCreditModelIdentifier}'s role on the Directing side.
 */
export { resolveImageGenCreditIdentifier }

/**
 * The per-model provider field that toggles a video model's NATIVE audio —
 * `"sound"` (Kling), `"generateAudio"` (Seedance), `"audio"` (Wan 3.0), or
 * `undefined` when there is no toggle (VEO is always-on; silent models have none).
 * Catalog-derived from `VIDEO_AUDIO_CAPABILITY.field` so the Directing payload never
 * hardcodes the key: studio sends the on/off INTENT, this maps it to the right wire
 * field. `undefined` ⇒ emit no toggle (the model decides). The drift-proof half of
 * the audio payload: a new audio-capable model is covered the moment the catalog
 * lists its field — and the RETURN TYPE is the catalog's own
 * {@link VideoAudioCapability}`["field"]`, never a hand-copied union, so a platform
 * that adds a fourth lever reaches studio without an edit here.
 */
export function videoAudioField(
  provider: string,
): VideoAudioCapability["field"] {
  return getVideoAudioCapability(provider).field
}

/**
 * Preferred lead order for the Framing image picker (quality / popularity) — these
 * surface FIRST when present; every other image model follows in catalog order.
 * ORDER is the app's curation (CLAUDE.md); the SET is not — see
 * {@link IMAGE_MODEL_ALLOWLIST}. nano-banana-pro leads (the DEFAULT → it honors
 * reference images today, so identity-preserving entity assets and reference-based
 * composer edits work now).
 */
const PREFERRED_IMAGE_ORDER: readonly string[] = [
  "nano-banana-pro",
  "flux-2-max",
  "gpt-image-2",
  "seedream-5-lite",
  "nano-banana-2",
]

/**
 * The Framing image models — ALL of the catalog's text-to-image models (every
 * `t2i` entry; legacy/hidden ids excluded by `modelIdsByKindMode`), so new models
 * appear automatically and none are hand-maintained. The preferred ids lead; the
 * rest follow in catalog order. (Pure image-to-image / edit-only models are
 * excluded — Framing generates a still FROM A PROMPT, which needs the `t2i` mode.)
 * Reference support is per-model (Nodaro owns it); order is a quality/preference
 * choice, not a capability gate. Mirrors {@link VIDEO_MODEL_ALLOWLIST}.
 */
export const IMAGE_MODEL_ALLOWLIST: ReadonlyArray<string> = (() => {
  const all = modelIdsByKindMode("image", ["t2i"])
  const preferred = PREFERRED_IMAGE_ORDER.filter((id) => all.includes(id))
  const rest = all.filter((id) => !preferred.includes(id))
  return [...preferred, ...rest]
})()

/**
 * Preferred lead order for the Directing model picker (quality / popularity) —
 * these surface FIRST when present; every other video model follows in catalog
 * order. ORDER is the app's curation (CLAUDE.md), the SET is not — see
 * {@link VIDEO_MODEL_ALLOWLIST}.
 */
const PREFERRED_VIDEO_ORDER: readonly string[] = [
  // The Seedance family leads (2.5 is the curated default), with minimax-h3
  // third — user decision 2026-08-10; the VEO/Kling tier follows.
  "seedance-2-5",
  "seedance-2",
  "minimax-h3",
  "veo3.1",
  "veo3",
  "veo3_lite",
  "kling-3.0",
  "gemini-omni-video",
  "grok-i2v",
]

/**
 * The Directing video models — every catalog video model that can ANIMATE A STILL
 * (`i2v`) or RENDER FROM TEXT ALONE (`t2v`); legacy/hidden ids excluded by
 * `modelIdsByKindMode`. Pure text-to-video models (no `i2v`) are INCLUDED since
 * the Text input mode landed: the picker's rows badge only supported modes and
 * the Input control offers exactly {@link supportedDirectingModes}, so a
 * t2v-only model (Wan, HappyHorse) surfaces with Text alone and can never be
 * driven from a frame. New models of either mode appear
 * automatically — none are hand-maintained. Reference inputs surface per-model
 * from {@link videoReferenceLimits} (only the models the catalog maps caps for).
 * The preferred ids lead; the rest follow in catalog order.
 */
export const VIDEO_MODEL_ALLOWLIST: ReadonlyArray<string> = (() => {
  const all = modelIdsByKindMode("video", ["i2v", "t2v"])
  const preferred = PREFERRED_VIDEO_ORDER.filter((id) => all.includes(id))
  const rest = all.filter((id) => !preferred.includes(id))
  return [...preferred, ...rest]
})()

/** Shaped image-model options for the Studio framing `<select>`. */
export function imageModelOptions(): ModelMenuOption[] {
  return buildModelMenu("image", IMAGE_MODEL_ALLOWLIST)
}

/**
 * App-owned DISPLAY-label overrides for the video picker — pure curation, not
 * capability. The catalog keeps the platform-wide name; studio renders the
 * wire id for minimax-h3 (user decision 2026-08-09) so the picker matches the
 * name the model is known by.
 */
const VIDEO_MODEL_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  "minimax-h3": "minimax-h3",
}

/** Shaped video-model options for the Studio directing `<select>` (later). */
export function videoModelOptions(): ModelMenuOption[] {
  return buildModelMenu("video", VIDEO_MODEL_ALLOWLIST).map((m) => {
    const label = VIDEO_MODEL_LABEL_OVERRIDES[m.id]
    return label ? { ...m, label } : m
  })
}

/**
 * Flat `{value,label}[]` for the Studio model `<select>` — the same
 * catalog-∩-allowlist rows as {@link imageModelOptions}, projected to the
 * minimal pair the picker renders. Computed once at module load (the catalog is
 * static); a model dropping out of `MODEL_CATALOG` simply removes its row.
 */
export const IMAGE_MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  imageModelOptions().map((m) => ({ value: m.id, label: m.label }))

/**
 * Default selected image model — the first option that survived the
 * catalog-∩-allowlist intersection (the curated menu's lead model). Derived,
 * never hardcoded, so it can't point at an id the catalog no longer ships.
 * Falls back to the first allowlist id if the menu is somehow empty.
 */
export const DEFAULT_IMAGE_PROVIDER: string =
  IMAGE_MODEL_OPTIONS[0]?.value ?? IMAGE_MODEL_ALLOWLIST[0]

/**
 * The CHARACTER creator's default image model — GPT Image 2, per the reference
 * studio flow (best identity fidelity for photo→character and picker-driven
 * portraits). Seeds the creation-bar Model picker for characters ONLY (wired via
 * the studio app's `EntityApi.defaultProvider`); the user can
 * still switch. DISTINCT from {@link DEFAULT_IMAGE_PROVIDER} (the shared entity
 * default other kinds keep) and {@link DEFAULT_FRAMING_PROVIDER} (the composer's).
 * Resolved against the curated menu so it can't point at an id the catalog no
 * longer ships (falls back to the shared default).
 */
export const CHARACTER_IMAGE_PROVIDER: string =
  IMAGE_MODEL_OPTIONS.find((o) => o.value === "gpt-image-2")?.value ??
  DEFAULT_IMAGE_PROVIDER

/**
 * The default model for an entity's DERIVED shots — the angles / body /
 * expressions / poses / lighting / variation tiles generated AFTER the main
 * image is approved, for every kind. GPT Image 2, matching the character
 * creator's lead ({@link CHARACTER_IMAGE_PROVIDER}) so an entity is rendered by
 * one model end to end; it carries the catalog's `reference-image` feature, so
 * the asset routes still anchor each derived shot on the approved main image.
 * Seeds the asset-model picker in the approved panel and backs the adapters'
 * asset calls — the user can still switch per entity (the pick is persisted as
 * the row's `imageProvider`, which always wins over this).
 * DISTINCT from {@link DEFAULT_IMAGE_PROVIDER} (the shared CREATION default the
 * non-character creators keep). Resolved against the curated menu so it can't
 * point at an id the catalog no longer ships.
 */
export const DEFAULT_ASSET_IMAGE_PROVIDER: string =
  IMAGE_MODEL_OPTIONS.find((o) => o.value === "gpt-image-2")?.value ??
  DEFAULT_IMAGE_PROVIDER

/**
 * Preferred lead order for the faithful-EDIT model picker (identity-preservation
 * quality) — per the platform's own guidance: nano-banana-pro preserves
 * face/character identity best across instruction edits, while flux-kontext
 * degrades over multi-turn edits, so it survives the menu but is deliberately
 * not preferred. ORDER is the app's curation; the SET is not — see
 * {@link EDIT_IMAGE_MODEL_ALLOWLIST}.
 */
const PREFERRED_EDIT_ORDER: readonly string[] = [
  "nano-banana-pro",
  "nano-banana-2",
  "gpt-image-2-i2i",
  "qwen-edit",
  "seedream-5-lite-i2i",
]

/**
 * The faithful-edit image models — every catalog model with an instruction-edit
 * mode (`i2i` / `edit`) INTERSECTED with the platform's `MODIFY_IMAGE_PROVIDERS`
 * (the image-to-image route's own accepted enum), so the menu can never offer a
 * model the route would reject, and a new edit model appears automatically the
 * moment both the catalog and the route know it. Nothing hand-maintained; the
 * preferred ids lead, the rest follow in catalog order.
 */
export const EDIT_IMAGE_MODEL_ALLOWLIST: ReadonlyArray<string> = (() => {
  const routeAccepts = new Set<string>(MODIFY_IMAGE_PROVIDERS)
  const all = modelIdsByKindMode("image", ["i2i", "edit"]).filter((id) =>
    routeAccepts.has(id),
  )
  const preferred = PREFERRED_EDIT_ORDER.filter((id) => all.includes(id))
  const rest = all.filter((id) => !preferred.includes(id))
  return [...preferred, ...rest]
})()

/**
 * Flat `{value,label}[]` for the faithful-edit model `<select>` (RestyleChat's
 * Edit mode) — the catalog-∩-allowlist rows, projected like
 * {@link IMAGE_MODEL_OPTIONS}. Same drift-proof contract: a model leaving the
 * catalog (or the route enum) simply drops its row.
 */
export const EDIT_IMAGE_MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  buildModelMenu("image", EDIT_IMAGE_MODEL_ALLOWLIST).map((m) => ({
    value: m.id,
    label: m.label,
  }))

/**
 * Default faithful-edit model — the curated lead (nano-banana-pro) when it
 * survived the catalog-∩-route intersection, else the first surviving option.
 * Never points at an id the catalog or the image-to-image route no longer
 * accepts.
 */
export const DEFAULT_EDIT_IMAGE_PROVIDER: string =
  EDIT_IMAGE_MODEL_OPTIONS[0]?.value ?? EDIT_IMAGE_MODEL_ALLOWLIST[0]

/**
 * Coerce ANY image-model id to one the `image-to-image` route accepts — the
 * route's enum is exactly {@link EDIT_IMAGE_MODEL_ALLOWLIST}, so a general
 * text-to-image id (e.g. the panel's asset model) would 400 it. A valid edit id
 * passes; anything else falls back to {@link DEFAULT_EDIT_IMAGE_PROVIDER}.
 * Catalog-derived, so it can't drift. Used by every i2i call in entity-api AND
 * by the surfaces that DISPLAY a model for those calls (the variations form of
 * shim-backed kinds) — one function, so what's shown is what runs.
 */
export function editSafeProvider(provider: string | undefined): string {
  return provider && EDIT_IMAGE_MODEL_ALLOWLIST.includes(provider)
    ? provider
    : DEFAULT_EDIT_IMAGE_PROVIDER
}

/**
 * The Composer's FRAMING (still) default model — GPT Image 2. DISTINCT from
 * {@link DEFAULT_IMAGE_PROVIDER} (the shared image default the entity creators
 * use) so changing the framing default doesn't move entity creation. Resolved
 * against the curated menu so it can't point at a dropped id (falls back to the
 * shared default). Paired with {@link DEFAULT_FRAMING_ASPECT} +
 * {@link DEFAULT_FRAMING_RESOLUTION}.
 */
export const DEFAULT_FRAMING_PROVIDER: string =
  IMAGE_MODEL_OPTIONS.find((o) => o.value === "gpt-image-2")?.value ??
  DEFAULT_IMAGE_PROVIDER

/**
 * Curated Composer LEVER defaults — applied by {@link useStaleSafeLever} when the
 * active model offers them, else the model's first option (a model without the
 * preferred value degrades gracefully). Framing: 2K · 16:9; Directing: 16:9.
 */
export const DEFAULT_FRAMING_ASPECT = "16:9"
export const DEFAULT_FRAMING_RESOLUTION = "2K"
export const DEFAULT_DIRECTING_ASPECT = "16:9"

/**
 * The entity creators' default image tier (characters, creatures, locations,
 * objects — creation and boards). Tal, 2026-09-06: "by default the studio is
 * generating 1k images … better to use 2k as default". Applied through
 * {@link defaultImageQuality}, catalog-driven: only a model whose RESOLUTION
 * lever offers this tier gets it; a megapixel-tier or quality-tier model keeps
 * its own default (""). Costs more credits than the 1K default it replaces —
 * a deliberate product choice (design spec decision log, D28).
 */
export const DEFAULT_ENTITY_RESOLUTION = "2K"

/**
 * The quality value an entity creator should start on for `provider`:
 * {@link DEFAULT_ENTITY_RESOLUTION} when the model's resolution lever offers
 * it, else "" (the model's own default tier — the route's behaviour and cost
 * when no tier is sent). Never a first-option guess: a model's cheapest tier
 * is not its default.
 */
export function defaultImageQuality(provider: string): string {
  const control = imageQualityControl(provider)
  if (!control || control.param !== "resolution") return ""
  return control.options.some((o) => o.value === DEFAULT_ENTITY_RESOLUTION)
    ? DEFAULT_ENTITY_RESOLUTION
    : ""
}

/**
 * The platform's declared default resolution for a video model — its
 * per-provider billing default ({@link PRICING_DEFAULT_RESOLUTION}, e.g.
 * Seedance 2.5 → 720p), `undefined` for providers without an entry. NEVER a
 * flat app-wide constant, and never a first-option guess: a provider's real
 * render default can differ from its cheapest catalog option (the Seedance 2
 * family renders 720p when the field is omitted while its first option is
 * 480p), so only a platform-declared value may be pre-selected — anything else
 * defaults to Auto (omit the field entirely; see {@link videoResolutionLever}).
 */
export function defaultVideoResolution(provider: string): string | undefined {
  return PRICING_DEFAULT_RESOLUTION[provider]
}

/**
 * The Auto sentinel for the Directing resolution lever — "let the platform
 * decide": the submit OMITS the `resolution` field entirely, so the provider
 * renders its own default and billing takes the same no-resolution path as
 * before the lever existed (render- AND price-neutral by construction).
 */
export const DIRECTING_RESOLUTION_AUTO = ""

/** The Directing resolution lever's option set + initial selection (see
 *  {@link videoResolutionLever}). */
export interface VideoResolutionLever {
  readonly options: ReadonlyArray<{ value: string; label: string }>
  readonly initial: string
}

/**
 * The Directing RESOLUTION lever for one model — the single resolver behind the
 * settings control, the breadcrumb, and the reset-on-model-switch initial:
 *   - platform-declared default ({@link defaultVideoResolution}) that the model's
 *     catalog options actually contain → the options as-is, pre-selected on it
 *     (sending it is verified price-neutral, and it IS the render default);
 *   - otherwise → an "Auto" option LEADS ({@link DIRECTING_RESOLUTION_AUTO} —
 *     omit the field; the provider's own default renders) and is the initial,
 *     so an undeclared default can never silently pick a concrete tier;
 *   - no catalog options → an empty lever (the control hides; nothing is sent).
 * The membership check also guards a bad/stale map entry (case drift, a dropped
 * option): it degrades to Auto, never to an unvalidated concrete value.
 */
export function videoResolutionLever(
  provider: string,
  resolutions: ReadonlyArray<{ value: string; label: string }>,
): VideoResolutionLever {
  if (resolutions.length === 0)
    return { options: [], initial: DIRECTING_RESOLUTION_AUTO }
  const declared = defaultVideoResolution(provider)
  if (declared && resolutions.some((o) => o.value === declared))
    return { options: [...resolutions], initial: declared }
  return {
    options: [
      { value: DIRECTING_RESOLUTION_AUTO, label: "Auto" },
      ...resolutions,
    ],
    initial: DIRECTING_RESOLUTION_AUTO,
  }
}

/**
 * An image model's user-pickable QUALITY lever, beyond the model itself. A model
 * declares EITHER resolution tiers (e.g. nano-banana-pro → 1K/2K/4K, flux →
 * MP tiers) OR a quality tier (e.g. seedream → basic/high) in `MODEL_CATALOG` —
 * `param` is the `generate-image` field the chosen value rides, so callers stay
 * catalog-driven and the route prices it (`buildCreditModelIdentifier`). `null`
 * when the model exposes neither (the picker then hides). Resolution wins when a
 * model somehow declares both — it's the finer-grained credit lever.
 */
export interface ImageQualityControl {
  readonly param: "resolution" | "quality"
  readonly options: ReadonlyArray<{ value: string; label: string }>
}

export function imageQualityControl(
  provider: string,
): ImageQualityControl | null {
  const toPairs = (opts: LabeledOption[] | null) =>
    opts && opts.length > 0
      ? opts.map((o) => ({ value: o.value, label: o.label }))
      : null
  const resolution = toPairs(getResolutionOptions(provider))
  if (resolution) return { param: "resolution", options: resolution }
  const quality = toPairs(getQualityOptions(provider))
  if (quality) return { param: "quality", options: quality }
  return null
}

/**
 * Flat `{value,label}[]` for the Studio directing (video) model `<select>` —
 * the catalog-∩-{@link VIDEO_MODEL_ALLOWLIST} rows, projected to the picker's
 * minimal pair. Same drift-proof contract as {@link IMAGE_MODEL_OPTIONS}: a
 * model leaving `MODEL_CATALOG` simply drops its row.
 */
export const VIDEO_MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  videoModelOptions().map((m) => ({ value: m.id, label: m.label }))

/**
 * Directing camera-motion options — the full {@link CAMERA_MOTIONS} catalog
 * (data-driven, not a hardcoded list), as the Directing panel's "Camera Motion"
 * picker. The selected motion's `promptHint` is folded into the directing prompt
 * at animate (see Composer). `auto` (empty hint) = let the model choose.
 */
export const CAMERA_MOTION_OPTIONS: ReadonlyArray<LabeledOption> =
  CAMERA_MOTIONS.map((m) => ({ value: m.id, label: m.label }))

/** The prompt phrase for a camera-motion id (empty for `auto`/unknown). */
export function cameraMotionHint(id: string | undefined): string {
  return CAMERA_MOTIONS.find((m) => m.id === id)?.promptHint ?? ""
}

/**
 * Default selected video model for the Directing step. The curated lead is
 * `seedance-2-5` (up to 30s in one shot, 30/10/10 multimodal references —
 * user decision 2026-08-08); we honor it only if it actually survived the
 * catalog-∩-allowlist intersection, else fall back to the first surviving
 * option (then the raw allowlist head). Never points at an id the catalog no
 * longer ships.
 */
const CURATED_VIDEO_DEFAULT = "seedance-2-5"
export const DEFAULT_VIDEO_PROVIDER: string =
  VIDEO_MODEL_OPTIONS.find((o) => o.value === CURATED_VIDEO_DEFAULT)?.value ??
  VIDEO_MODEL_OPTIONS[0]?.value ??
  VIDEO_MODEL_ALLOWLIST[0]

/**
 * The Directing default for a STORYBOARD hand-off ("Directing →" on a segment):
 * Seedance 2 in References mode. Storyboard continuity drives the next shot from
 * the PREVIOUS shot's last frame as a reference image (not start/end keyframes), so
 * the hand-off pins a reference-driven model + References mode regardless of the
 * user's last-used Directing prefs. A SEPARATE requirement from the general default
 * (it must stay Seedance 2 even if that changes); drift-proof — falls back to the
 * general default if the catalog drops `seedance-2`. (`references` is validity-
 * checked downstream by the Studio mode clamp, and seedance-2 supports it.)
 */
export const STORYBOARD_DIRECTING_PROVIDER: string =
  VIDEO_MODEL_OPTIONS.find((o) => o.value === "seedance-2")?.value ??
  DEFAULT_VIDEO_PROVIDER
export const STORYBOARD_DIRECTING_MODE: DirectingMode = "references"

/** Per-provider video duration levers, derived from the shared model menu
 *  (`buildModelMenu` already merges the i2v+t2v duration sets per model). */
const VIDEO_DURATIONS_BY_ID: ReadonlyMap<string, ReadonlyArray<{ value: number; label: string }>> =
  new Map(videoModelOptions().map((m) => [m.id, m.durations]))

/**
 * Duration `{value,label}` options for one video model (`[]` when the model has
 * no duration lever). Returns a fresh array — never the cached reference — so
 * callers can't mutate the module-level map.
 */
export function videoDurationOptions(
  provider: string,
): ReadonlyArray<{ value: number; label: string }> {
  return [...(VIDEO_DURATIONS_BY_ID.get(provider) ?? [])]
}

/**
 * The offered duration CLOSEST to `target` seconds — used to carry a storyboard
 * segment's length (1–15) onto the directing model's available clip lengths (e.g. a
 * 7s segment → 7 on Seedance 2, which offers 4–15; a 2s segment → its nearest, 4).
 * Returns undefined when the model offers no durations. Ties pick the shorter.
 */
export function nearestDuration(
  target: number,
  options: ReadonlyArray<{ value: number }>,
): number | undefined {
  if (options.length === 0) return undefined
  return options.reduce((best, o) =>
    Math.abs(o.value - target) < Math.abs(best.value - target) ? o : best,
  ).value
}

/**
 * Allowlisted ids of a given kind that declare a capability flag, derived from
 * `modelsWithFeature` (catalog-driven). Lets the UI gate e.g. end-frame /
 * reference-image affordances without a hand-maintained provider list.
 */
export function allowlistedModelsWithFeature(
  kind: "image" | "video",
  feature: string,
): string[] {
  const allowlist =
    kind === "image" ? IMAGE_MODEL_ALLOWLIST : VIDEO_MODEL_ALLOWLIST
  const withFeature = new Set(modelsWithFeature(feature))
  return allowlist.filter((id) => withFeature.has(id))
}

/**
 * The two recognized parenthetical label variants the Framing picker surfaces —
 * parsed from the catalog label SUFFIX the platform itself ships ("Flux 2 Klein
 * (Open)", "Flux 2 Max (Safety Tolerance)"). NOT a hardcoded per-model list: any
 * model whose label carries such a suffix is classified automatically, and an
 * unrecognized suffix leaves the base label intact.
 */
export type ImageVariantTag = "open" | "safety"

const IMAGE_VARIANT_PATTERNS: ReadonlyArray<{ re: RegExp; tag: ImageVariantTag }> = [
  { re: /open/i, tag: "open" },
  { re: /safety|toleran/i, tag: "safety" },
]

/** Split a "Base (Suffix)" label into base + recognized variant. An unrecognized
 *  parenthetical is left ON the base — we never drop information we can't classify. */
function parseImageVariant(label: string): {
  base: string
  variant: ImageVariantTag | null
} {
  const m = label.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (!m) return { base: label, variant: null }
  const [, base, inner] = m
  const hit = IMAGE_VARIANT_PATTERNS.find((p) => p.re.test(inner))
  return hit ? { base, variant: hit.tag } : { base: label, variant: null }
}

/**
 * A Framing image-model row — the reference cap (the picker's hero criterion) plus
 * the catalog facts the capability-first picker renders.
 */
export interface FramingImageOption {
  readonly value: string
  /** Full catalog label, e.g. "Flux 2 Max (Safety Tolerance)". */
  readonly label: string
  /** Label minus a recognized "(…)" suffix, e.g. "Flux 2 Max". */
  readonly baseLabel: string
  /** Reference-image cap (`imageReferenceLimit`). */
  readonly referenceImages: number
  /** Brand line for labeling, e.g. "Flux", "Nano Banana". */
  readonly series: string
  /** Producing lab, e.g. "Black Forest Labs". */
  readonly family: string
  /** Recognized label variant, or null for the base model. */
  readonly variant: ImageVariantTag | null
  /** Catalog editorial highlight ("best in tier"). */
  readonly featured: boolean
  /** Min/max credits across pricing variants, or null for a single price point. */
  readonly credits: { readonly min: number; readonly max: number } | null
}

/**
 * EVERY curated Framing image model, enriched for the capability-first picker
 * — including PROMPT-ONLY models with no reference-image support (user
 * decision 2026-08-18, admitting Grok Imagine 2 and the Imagen tier; the old
 * `referenceImages > 0` gate is gone). The cap comes from `@nodaro/shared`'s
 * {@link imageReferenceLimit} (the scalar image analogue of
 * {@link videoReferenceLimits}; it already resolves t2i→i2i variants so the
 * count matches what `generate-image` enforces) — `0` renders as an explicit
 * "Prompt only" tile in the picker, and the composer's existing per-model
 * gates (`supportsReferenceImages`) keep every reference affordance inert for
 * such a model. The remaining fields are derived from the SAME catalog so they
 * can't drift: `series`/`family`/`featured`/credit range straight from
 * `getModel` / {@link getCreditRange}, and `variant` parsed from the label
 * suffix.
 */
export const FRAMING_IMAGE_MODEL_OPTIONS: ReadonlyArray<FramingImageOption> =
  IMAGE_MODEL_OPTIONS.map((o) => {
    const m = getModel(o.value)
    const { base, variant } = parseImageVariant(o.label)
    return {
      value: o.value,
      label: o.label,
      baseLabel: base,
      referenceImages: imageReferenceLimit(o.value),
      series: m?.series ?? m?.family ?? "Other",
      family: m?.family ?? "—",
      variant,
      featured: m?.featured ?? false,
      credits: getCreditRange(o.value),
    }
  })

/** The three reference media kinds a video model can accept. */
export type VideoReferenceKind = "images" | "videos" | "audio"

/**
 * A video model's reference caps per TYPE (0 when it doesn't accept that type).
 * Normalizes the catalog's `VIDEO_REF_LIMITS_BY_PROVIDER` so every field is a
 * concrete number.
 */
export interface VideoReferenceLimits {
  readonly images: number
  readonly videos: number
  readonly audio: number
}

/**
 * The per-type reference caps a video model accepts — the SINGLE source is the
 * catalog's `VIDEO_REF_LIMITS_BY_PROVIDER` (e.g. Seedance 2 → 9 img · 3 video · 3
 * audio; Gemini Omni → 7 img · 1 video; most i2v models → 1 img). 0 for a type the
 * model doesn't accept; all-zero for a non-reference model (absent from the map).
 * Drives which reference inputs show + the N/cap counters; the server still
 * enforces the real caps.
 */
export function videoReferenceLimits(provider: string): VideoReferenceLimits {
  const lim = VIDEO_REF_LIMITS_BY_PROVIDER[provider]
  return {
    images: lim?.images ?? 0,
    videos: lim?.videos ?? 0,
    audio: lim?.audio ?? 0,
  }
}

/**
 * Whether a video model accepts ANY reference type — the gate for the Directing
 * "References" input mode. Catalog-derived (any non-zero per-type cap), so it
 * covers image- AND video-/audio-reference models alike (not just an image-feature
 * approximation).
 */
export function videoReferenceSupported(provider: string): boolean {
  const { images, videos, audio } = videoReferenceLimits(provider)
  return images > 0 || videos > 0 || audio > 0
}

/** How many reference IMAGES a video model accepts (0 = none) — convenience over
 *  {@link videoReferenceLimits}. */
export function videoReferenceCap(provider: string): number {
  return videoReferenceLimits(provider).images
}

/**
 * Video models that accept a START frame — i.e. image-to-video (the catalog `i2v`
 * mode). A pure text-to-video model has no `i2v` mode, so it can't animate an
 * input still: the Start-frame slot must be DISABLED (and `imageUrl` dropped at
 * submit) for it. Catalog-derived; never a hand-maintained list.
 */
const VIDEO_START_FRAME_MODELS = new Set(modelIdsByKindMode("video", ["i2v"]))
export function videoSupportsStartFrame(provider: string): boolean {
  return VIDEO_START_FRAME_MODELS.has(provider)
}

/**
 * Video models that can run PROMPT-ONLY — a pure text-to-video generation with
 * no still, no references. Catalog-derived twice over: the model must declare
 * the `t2v` mode AND not be on the platform's own image-required route guard
 * (`videoProviderRequiresImage`), so the CTA can never green-light a run the
 * server would reject. Gates the "just describe the shot" Directing path.
 */
const VIDEO_PROMPT_ONLY_MODELS = new Set(
  modelIdsByKindMode("video", ["t2v"]).filter(
    (id) => !videoProviderRequiresImage(id),
  ),
)
export function videoSupportsPromptOnly(provider: string): boolean {
  return VIDEO_PROMPT_ONLY_MODELS.has(provider)
}

/**
 * The Motion-tab provider menu — video models that can animate a still (i2v),
 * since creature / object motion is image-to-video FROM the approved main image.
 * Derived from {@link VIDEO_MODEL_OPTIONS} ∩ start-frame capability, so it stays
 * catalog-driven (a model that drops i2v support drops out automatically).
 */
export const MOTION_MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  VIDEO_MODEL_OPTIONS.filter((o) => videoSupportsStartFrame(o.value))

/**
 * Default Motion provider — the creature / object route's own server default
 * (`kling-turbo`) when it survives the i2v menu, else the curated i2v video
 * default, else the first motion option. Never points at a non-i2v id.
 */
const CURATED_MOTION_DEFAULT = "kling-turbo"
export const MOTION_DEFAULT_PROVIDER: string =
  MOTION_MODEL_OPTIONS.find((o) => o.value === CURATED_MOTION_DEFAULT)?.value ??
  MOTION_MODEL_OPTIONS.find((o) => o.value === DEFAULT_VIDEO_PROVIDER)?.value ??
  MOTION_MODEL_OPTIONS[0]?.value ??
  DEFAULT_VIDEO_PROVIDER

/**
 * The Emotion-videos model menu — video models that can CARRY THE CHARACTER'S
 * IDENTITY into the clip: an image-reference cap (identity conditioned across
 * the whole performance) or at least a start frame (frame-0 seed) — the same
 * two anchors the generator's submit resolves, in that order. A text-only model
 * (no references, no `i2v`) would render a generic person, so it's filtered
 * OUT. Catalog-derived like {@link MOTION_MODEL_OPTIONS}.
 */
export const EMOTION_VIDEO_MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> =
  VIDEO_MODEL_OPTIONS.filter(
    (o) =>
      videoReferenceLimits(o.value).images > 0 ||
      videoSupportsStartFrame(o.value),
  )

/**
 * Default video model for the character Emotion-videos generator — curated to
 * Seedance 2.0 Fast (`seedance-2-fast`): a cheaper multimodal variant with image
 * + audio references and native audio, which suits short performance / dialogue
 * clips. Resolved against the identity-capable emotion menu (drift-proof); falls
 * back to {@link DEFAULT_VIDEO_PROVIDER} if the catalog no longer ships it.
 */
const CURATED_EMOTION_VIDEO_DEFAULT = "seedance-2-fast"
export const EMOTION_VIDEO_DEFAULT_PROVIDER: string =
  EMOTION_VIDEO_MODEL_OPTIONS.find(
    (o) => o.value === CURATED_EMOTION_VIDEO_DEFAULT,
  )?.value ?? DEFAULT_VIDEO_PROVIDER

/**
 * Video models that accept an END frame (the catalog `end-frame` interpolation
 * feature). The End-frame slot is disabled (and a stale end frame dropped at
 * submit) for models without it.
 */
const VIDEO_END_FRAME_MODELS = new Set(
  allowlistedModelsWithFeature("video", "end-frame"),
)
export function videoSupportsEndFrame(provider: string): boolean {
  return VIDEO_END_FRAME_MODELS.has(provider)
}

/* ────────────────────────────────────────────────────────────────────────────
 * Rich capability CARDS for the Directing model picker
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * A directing model's INPUT capabilities — pre-resolved from the catalog helpers
 * so the picker renders "what supports what" without re-deriving anything (the
 * single source of truth stays {@link videoSupportsStartFrame} / {@link
 * videoSupportsEndFrame} / {@link videoReferenceLimits} / {@link
 * videoSupportsPromptOnly}). A t2v-only row has `startFrame` false — it surfaces
 * under the Text tab alone, never on a frame track.
 */
export interface VideoModelCapabilities {
  /** Accepts a START frame to animate (an `i2v`-mode model). */
  readonly startFrame: boolean
  /** Interpolates toward an END frame (the catalog `end-frame` feature). */
  readonly endFrame: boolean
  /** Per-kind reference caps (0 for a kind the model doesn't accept). */
  readonly references: VideoReferenceLimits
  /** Convenience: the model accepts at least one reference kind. */
  readonly referencesSupported: boolean
  /** Renders from the PROMPT ALONE — text-to-video with no still and no
   *  references ({@link videoSupportsPromptOnly}). */
  readonly promptOnly: boolean
}

/**
 * A rich Directing-model option: id/label plus structured {@link
 * VideoModelCapabilities}. This carries DATA only — the picker ({@link
 * ModelSelect}) owns every pixel of presentation (the Start → End track, the
 * per-kind reference breakdown, the Text badge) — so capabilities can't drift
 * from `MODEL_CATALOG` and the visual language lives in exactly one place.
 */
export interface VideoModelCard {
  readonly value: string
  readonly label: string
  readonly capabilities: VideoModelCapabilities
}

/**
 * The Directing picker rows as rich capability cards — one per {@link
 * VIDEO_MODEL_OPTIONS} entry, in the same curated order. Pure, catalog-derived
 * data: each row's frame + reference support is composed from the helpers above;
 * how it's drawn is the picker's job.
 */
export function videoModelCards(): VideoModelCard[] {
  return VIDEO_MODEL_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
    capabilities: {
      startFrame: videoSupportsStartFrame(o.value),
      endFrame: videoSupportsEndFrame(o.value),
      references: videoReferenceLimits(o.value),
      referencesSupported: videoReferenceSupported(o.value),
      promptOnly: videoSupportsPromptOnly(o.value),
    },
  }))
}

/* ────────────────────────────────────────────────────────────────────────────
 * Directing INPUT MODES (the picker's per-model mode options)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The four ways to drive a directing render. The picker is MODEL-FIRST (user
 * decision 2026-08-18): you pick the model, then the Input control offers ONLY
 * the modes that model supports — an unsupported mode is absent, never disabled.
 * The mode DECLARES INTENT — which inputs the submit collects; it does NOT pick
 * the endpoint. `lib/video-lane`'s `chooseVideoLane` reads what was actually
 * collected and picks the lane (D27), and frames and references ride TOGETHER
 * when the user set both (the platform folds them server-side):
 *   - "start"      → animate from a single START frame (every i2v model can).
 *   - "start-end"  → interpolate START → END frame (end-frame models only).
 *   - "references" → drive from reference media (reference-capable models only),
 *                    PLUS any start/end frame the user set explicitly.
 *   - "text"       → render from the PROMPT ALONE — no still, no references
 *                    (prompt-only-capable models; {@link videoSupportsPromptOnly}).
 */
export type DirectingMode = "start" | "start-end" | "references" | "text"

/** Canonical mode order — Start + End frame → References → Start frame → Text.
 *  Drives the Input control's option order AND the positional default fallback
 *  ({@link defaultDirectingModeFor}). */
export const DIRECTING_MODES: ReadonlyArray<DirectingMode> = [
  "start-end",
  "references",
  "start",
  "text",
]
const DIRECTING_MODE_LABEL: Record<DirectingMode, string> = {
  start: "Start frame",
  "start-end": "Start + End frame",
  references: "References",
  text: "Text",
}

/** Whether a video model (by id) supports a given directing mode — the gate the
 *  Studio submit uses to keep a (provider, mode) pair valid across model changes. */
export function videoSupportsMode(provider: string, mode: DirectingMode): boolean {
  switch (mode) {
    case "start":
      return videoSupportsStartFrame(provider)
    case "start-end":
      return videoSupportsEndFrame(provider)
    case "references":
      return videoReferenceSupported(provider)
    case "text":
      return videoSupportsPromptOnly(provider)
  }
}

/**
 * The directing modes a model can drive, in canonical {@link DIRECTING_MODES}
 * order — the Input control's option set for the MODEL-FIRST picker (a model
 * without Text simply has no Text option; nothing is shown disabled).
 * Catalog-derived via {@link videoSupportsMode} — nothing hand-maintained.
 */
export function supportedDirectingModes(provider: string): DirectingMode[] {
  return DIRECTING_MODES.filter((m) => videoSupportsMode(provider, m))
}

/** The label for a directing mode (trigger summary / Input control / badges). */
export function directingModeLabel(mode: DirectingMode): string {
  return DIRECTING_MODE_LABEL[mode]
}

/** A render in this mode sends an END frame (only "start-end"). */
export function modeUsesEndFrame(mode: DirectingMode): boolean {
  return mode === "start-end"
}

/** A render in this mode sends REFERENCE media instead of frames. */
export function modeUsesReferences(mode: DirectingMode): boolean {
  return mode === "references"
}

/** A render in this mode animates FROM frame input (start / start + end) — false
 *  for the reference- and prompt-driven modes, which must never send a frame
 *  (Text mode stays a pure t2v run even when the shot HAS a still). */
export function modeUsesFrames(mode: DirectingMode): boolean {
  return mode === "start" || mode === "start-end"
}

/**
 * Curated per-model DEFAULT input-mode overrides, consulted before the
 * positional {@link DIRECTING_MODES} fallback. Seedance 2.5 leads in
 * References mode (user decision 2026-08-08: the default directing experience
 * is reference-driven, not keyframed — the framed still rides as a reference,
 * not a locked start frame). Each override is validated against the model's
 * LIVE capabilities below, so a catalog change can never pin an impossible
 * (model, mode) pair.
 */
const CURATED_DIRECTING_MODE: Partial<Record<string, DirectingMode>> = {
  "seedance-2-5": "references",
}

/**
 * The default directing mode for a GIVEN model — its {@link
 * CURATED_DIRECTING_MODE} override when it still supports it, else the FIRST
 * {@link DIRECTING_MODES} (Start + End frame → References → Start frame → Text)
 * the model supports (a t2v-only model lands on Text), else "start". The one resolver
 * behind both {@link DEFAULT_DIRECTING_MODE} and the persisted "last used"
 * fallback, so a restored / last-used model always lands on a mode it can
 * actually drive (never an impossible (model, mode) pair).
 */
export function defaultDirectingModeFor(provider: string): DirectingMode {
  const curated = CURATED_DIRECTING_MODE[provider]
  if (curated && videoSupportsMode(provider, curated)) return curated
  return DIRECTING_MODES.find((m) => videoSupportsMode(provider, m)) ?? "start"
}

/**
 * The default directing mode — {@link defaultDirectingModeFor} the curated default
 * video model. With the curated default (Seedance 2.5, curated to References)
 * this resolves to "references" — but it degrades gracefully: without the
 * curated override it falls to the model's first supported mode, and a
 * start-only default model resolves to "start".
 */
export const DEFAULT_DIRECTING_MODE: DirectingMode =
  defaultDirectingModeFor(DEFAULT_VIDEO_PROVIDER)
