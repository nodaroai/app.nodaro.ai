/**
 * Silent parameter normalization for MCP tool calls.
 *
 * Design principle: a tool call should NEVER reject because the agent
 * picked a slightly-wrong value. Claude.ai is creative — it'll send "8K"
 * to a model that only supports 4K, "1x9" instead of "1:9", "ultra" for
 * quality, model ids that don't exist, etc. Rejecting any of those
 * surfaces as a hard failure in chat ("error occurred during tool
 * execution"), which is a worse user experience than silently picking
 * the closest valid alternative.
 *
 * Every normalize* function returns a value the route is guaranteed to
 * accept (or undefined when the lever genuinely doesn't apply to the
 * resolved model). Validation errors are SWALLOWED, not surfaced.
 */
import { MODEL_CATALOG, VIDEO_DURATION_AUTO, defaultImageModel, defaultResolutionFor, isAutoAspectToken, isAutoVideoDuration, type ModelCatalogEntry } from "@nodaro/shared/model-catalog"
import { IMAGE_GEN_PROVIDERS, IMAGE_TO_VIDEO_PROVIDERS, MODIFY_IMAGE_PROVIDERS, TEXT_TO_VIDEO_PROVIDERS, canonicalVideoProvider, resolveVideoProviderForMode, videoProviderRequiresImage } from "@nodaro/shared/models"
import { imageToImageAspectRatio } from "../image-auto-aspect.js"

/**
 * Resolve any model id (or freeform string) to a known catalog entry id.
 * Falls back to `fallback` when the input is empty / unknown.
 */
export function normalizeModel(
  input: string | undefined | null,
  fallback: string,
): string {
  if (!input) return fallback
  const trimmed = String(input).trim()
  if (!trimmed) return fallback
  // Exact catalog hit.
  if (MODEL_CATALOG[trimmed]) return trimmed
  // Case-insensitive lookup so "Nano-Banana-2" works too.
  const lower = trimmed.toLowerCase()
  for (const id of Object.keys(MODEL_CATALOG)) {
    if (id.toLowerCase() === lower) return id
  }
  // Last-resort: strip common prefixes some clients invent.
  const stripped = lower.replace(/^model[-_]/, "")
  for (const id of Object.keys(MODEL_CATALOG)) {
    if (id.toLowerCase() === stripped) return id
  }
  return fallback
}

/**
 * Parse a ratio string ("16:9", "16x9", "1.78:1", "1.78") into a numeric
 * width/height value. Returns null if it can't be parsed.
 */
function parseRatio(input: string): number | null {
  const trimmed = input.trim()
  // "16:9" / "16x9" / "16/9" — separator + two numeric parts.
  const parts = trimmed.split(/[:xX×\-_/\s]+/).filter((s) => s.length > 0)
  if (parts.length === 2) {
    const a = parseFloat(parts[0]!)
    const b = parseFloat(parts[1]!)
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b
  }
  // Bare decimal — treat as the ratio directly.
  const decimal = parseFloat(trimmed)
  if (Number.isFinite(decimal) && decimal > 0) return decimal
  return null
}

/**
 * Normalize an aspect-ratio string against a model's supported set.
 *
 * Resolution order (each step falls through if no match):
 * 1. Exact match in `supported` (`"16:9"` against `["16:9", ...]`).
 * 2. Separator-normalized exact match (`"16x9"` → `"16:9"`).
 * 3. Numeric-nearest: parse the request as a ratio, pick the supported
 *    value whose width/height is closest. Handles `"21:9"` against a
 *    16:9-only model (→ 16:9), `"1.78:1"` (→ 16:9), `"1x9"` typo
 *    (→ 9:16), etc.
 * 4. Hard fallback to `fallback` (or the first supported if `fallback`
 *    isn't in the set). Only reached when the input couldn't be parsed
 *    as a ratio at all.
 *
 * Returns `undefined` when the model doesn't expose aspect_ratio.
 */
export function normalizeAspectRatio(
  input: string | undefined | null,
  supported: readonly string[] | undefined,
  fallback = "16:9",
): string | undefined {
  if (!supported || supported.length === 0) return undefined
  const safeFallback = supported.includes(fallback) ? fallback : supported[0]!
  if (!input) return safeFallback
  const trimmed = String(input).trim()
  if (!trimmed) return safeFallback

  // Step 1: exact hit.
  if (supported.includes(trimmed)) return trimmed

  // Step 2: separator typos ("16x9" / "16-9" / "16/9") collapse to ":".
  const colonized = trimmed.replace(/[xX×\-_/\s]+/, ":")
  if (supported.includes(colonized)) return colonized

  // Step 3: numeric-nearest match. Parse the requested ratio AND each
  // supported one, pick the smallest absolute difference. "21:9" with
  // [16:9, 4:3, 1:1] → 16:9 because 1.78 is closest to 2.33.
  const requested = parseRatio(trimmed) ?? parseRatio(colonized)
  if (requested !== null) {
    let best: string | undefined
    let bestDiff = Infinity
    for (const v of supported) {
      // Skip non-ratio values like "auto" / "adaptive" — they have no
      // numeric representation, so we can't compare them.
      const r = parseRatio(v)
      if (r === null) continue
      const diff = Math.abs(requested - r)
      if (diff < bestDiff) {
        best = v
        bestDiff = diff
      }
    }
    if (best) return best
  }

  // Step 4: couldn't parse — fall back to default.
  return safeFallback
}

/**
 * Normalize a resolution string against the model's supported set.
 * "8K" → max available (often 4K). "1080p" → 1K-equivalent if model uses
 * K-notation. Returns undefined when the model doesn't expose resolution.
 */
export function normalizeResolution(
  input: string | undefined | null,
  supported: readonly string[] | undefined,
): string | undefined {
  if (!supported || supported.length === 0) return undefined
  if (!input) return undefined
  const trimmed = String(input).trim()
  if (supported.includes(trimmed)) return trimmed
  // Case folding: "1k" / "4k" → "1K" / "4K" if model uses caps.
  const upper = trimmed.toUpperCase()
  if (supported.includes(upper)) return upper
  const lower = trimmed.toLowerCase()
  if (supported.includes(lower)) return lower
  // K-notation: parse the numeric prefix and snap to the largest supported
  // tier ≤ requested. "8K" with [1K, 2K, 4K] → 4K; "16K" → still 4K.
  const kMatch = trimmed.match(/^(\d+(?:\.\d+)?)K$/i)
  if (kMatch) {
    const requested = parseFloat(kMatch[1]!)
    let best: string | undefined
    let bestNum = -Infinity
    for (const v of supported) {
      const m = v.match(/^(\d+(?:\.\d+)?)K$/i)
      if (!m) continue
      const n = parseFloat(m[1]!)
      if (n <= requested && n > bestNum) {
        best = v
        bestNum = n
      }
    }
    if (best) return best
    // Requested smaller than smallest supported — pick smallest.
    let smallest: string | undefined
    let smallestNum = Infinity
    for (const v of supported) {
      const m = v.match(/^(\d+(?:\.\d+)?)K$/i)
      if (!m) continue
      const n = parseFloat(m[1]!)
      if (n < smallestNum) {
        smallest = v
        smallestNum = n
      }
    }
    if (smallest) return smallest
  }
  // Pixel-height fallback: 1080p → 1080P; 720p → 720P; etc.
  const heightMatch = trimmed.match(/(\d+)\s*[pP]/)
  if (heightMatch) {
    const variants = [`${heightMatch[1]}p`, `${heightMatch[1]}P`]
    for (const v of variants) if (supported.includes(v)) return v
  }
  // Couldn't normalize — let the model use its own default.
  return undefined
}

/**
 * Normalize a quality string. "ultra" / "best" → highest available;
 * "auto" / "balanced" → first option; unknowns → undefined.
 */
export function normalizeQuality(
  input: string | undefined | null,
  supported: readonly string[] | undefined,
): string | undefined {
  if (!supported || supported.length === 0) return undefined
  if (!input) return undefined
  const trimmed = String(input).trim()
  if (supported.includes(trimmed)) return trimmed
  const lower = trimmed.toLowerCase()
  // Match by case-insensitive equality first (TURBO/BALANCED/etc. uppercase).
  for (const v of supported) {
    if (v.toLowerCase() === lower) return v
  }
  // Synonym buckets — map to the closest semantic neighbour.
  const last = supported[supported.length - 1]!
  // The first listed value, but never Auto: it is only chosen by name (the exact
  // match above), because it reserves the top price.
  const firstFixed = supported.find((v) => v.toLowerCase() !== "auto") ?? supported[0]
  if (["ultra", "best", "max", "premium", "highest"].includes(lower)) return last
  if (["auto", "balanced", "default", "normal", "standard"].includes(lower)) {
    // Prefer "BALANCED" / "medium" if present; otherwise first.
    const balanced = supported.find((v) =>
      ["BALANCED", "medium", "basic"].includes(v),
    )
    return balanced ?? firstFixed
  }
  if (["fast", "quick", "speed", "turbo"].includes(lower)) {
    return (
      supported.find((v) => v.toLowerCase().includes("turbo")) ??
      supported.find((v) => v.toLowerCase() === "low") ??
      firstFixed
    )
  }
  return undefined
}

/**
 * Normalize a duration (seconds). "10s" / "10 seconds" → 10.
 * Snaps to the nearest supported value when requested duration isn't exact.
 * `-1` / "auto" = let the model pick the length (models with `autoDuration`).
 */
export function normalizeDuration(
  input: number | string | undefined | null,
  supported: readonly number[] | undefined,
  autoDuration?: boolean,
): number | undefined {
  if (!supported || supported.length === 0) return undefined
  if (input === undefined || input === null) return undefined
  // Auto (-1 / "auto") is not a length to snap — it passes through for a model
  // that declares the capability. For any other model it is dropped (the model
  // renders its default) rather than snapped to the SHORTEST clip.
  if (isAutoVideoDuration(input) || (typeof input === "string" && input.trim().toLowerCase() === "auto")) {
    return autoDuration === true ? VIDEO_DURATION_AUTO : undefined
  }
  let n: number
  if (typeof input === "number") {
    n = input
  } else {
    const trimmed = String(input).trim()
    const match = trimmed.match(/(\d+(?:\.\d+)?)/)
    if (!match) return undefined
    n = parseFloat(match[1]!)
  }
  if (!Number.isFinite(n)) return undefined
  if (supported.includes(n)) return n
  // Snap to nearest supported.
  let nearest = supported[0]!
  let nearestDiff = Math.abs(n - nearest)
  for (const v of supported) {
    const diff = Math.abs(n - v)
    if (diff < nearestDiff) {
      nearest = v
      nearestDiff = diff
    }
  }
  return nearest
}

export interface NormalizedImageParams {
  model: string
  aspectRatio?: string
  resolution?: string
  quality?: string
  modelEntry: ModelCatalogEntry | undefined
}

/**
 * The aspect ratio an image call asks for: the one it names, else the one the
 * person saved (`save_image_defaults`), else `undefined`. A blank value names
 * nothing. `normalizeAspectRatio` never answers empty (an unset ratio is its
 * 16:9 fallback), so the saved ratio has to be chosen BEFORE it, never as its
 * `??` alternative, which is never reached.
 */
export function requestedAspectRatio(
  named: string | null | undefined,
  saved: string | null | undefined,
): string | undefined {
  const given = (v: string | null | undefined) => (typeof v === "string" && v.trim() !== "" ? v : undefined)
  return given(named) ?? given(saved)
}

/**
 * Compose all four image-tool normalizations against the catalog.
 * Returns guaranteed-valid values for the resolved model — caller can
 * forward straight to the route without further validation.
 *
 * Each lever: the value the call names, else the person's saved default,
 * else the catalog's (a ratio: `fallback` 16:9 or the model's first; a size or
 * a quality: none, so the model's own default applies).
 */
export function normalizeImageInput(
  raw: {
    model?: string | null
    aspect_ratio?: string | null
    resolution?: string | null
    quality?: string | null
  },
  saved: {
    model?: string
    aspectRatio?: string
    resolution?: string
    quality?: string
  },
  fallbackModel: string,
): NormalizedImageParams {
  const explicitModel = normalizeModelStrict(raw.model)
  const savedModel = saved.model && MODEL_CATALOG[saved.model] ? saved.model : undefined
  const model = explicitModel ?? savedModel ?? fallbackModel
  const modelEntry = MODEL_CATALOG[model]

  // With neither named nor saved, this is the general fallback: a caller with a
  // rule of its own for an unset ratio (`imageToImageAspectRatio`) asks
  // `requestedAspectRatio` and applies it in its place.
  const aspectRatio = normalizeAspectRatio(
    requestedAspectRatio(raw.aspect_ratio, saved.aspectRatio),
    modelEntry?.aspectRatios,
    "16:9",
  )

  // Unlike the ratio's, these helpers answer undefined for an unset value, so
  // the saved default is reached through `??`.
  const resolution =
    normalizeResolution(raw.resolution, modelEntry?.resolutions)
    ?? normalizeResolution(saved.resolution, modelEntry?.resolutions)

  const quality =
    normalizeQuality(raw.quality, modelEntry?.qualities)
    ?? normalizeQuality(saved.quality, modelEntry?.qualities)

  return { model, aspectRatio, resolution, quality, modelEntry }
}

/**
 * The saved image model (`save_image_defaults`) an edit may run on. The person
 * has ONE saved image model, which the widget's "Save as default" star fills
 * from whichever tool made the picture: a text-to-image id after
 * `generate_image`, an edit id after `modify_image`. An edit runs it only when
 * /v1/image-to-image does (`MODIFY_IMAGE_PROVIDERS`, which `modify_image`
 * snaps to as well): a text-to-image-only id (GPT Image 2, Seedream 5) is not
 * an edit model and is ignored; an edit id, or a model that does both under one
 * id (Nano Banana, Flux 2, Flux Kontext), is used.
 */
export function savedEditModel(saved: string | null | undefined): string | undefined {
  return typeof saved === "string" && (MODIFY_IMAGE_PROVIDERS as readonly string[]).includes(saved) ? saved : undefined
}

/**
 * The saved image model (`save_image_defaults`) a generation may run on: the
 * mirror of `savedEditModel`. The one saved image model is an edit id after
 * the star on a `modify_image` result (`gpt-image-2-6-flare-i2i`), which
 * /v1/generate-image refuses. A generation runs it only when that route does
 * (`IMAGE_GEN_PROVIDERS`, its provider list): an edit-only id is ignored and
 * the generation default runs; a text-to-image id, or a model that does both
 * under one id (Nano Banana, Flux 2, Flux Kontext), is used.
 */
export function savedGenerationModel(saved: string | null | undefined): string | undefined {
  return typeof saved === "string" && (IMAGE_GEN_PROVIDERS as readonly string[]).includes(saved) ? saved : undefined
}

/**
 * The saved video model (`mcpPreferences.video.model`, which PATCH
 * /v1/user/settings takes as any string) a video call may run on: the model it
 * runs as (`canonicalVideoProvider`, for a retired id) when the route the call
 * sends it to takes it — `accepted` is that route's provider list
 * (`TEXT_TO_VIDEO_PROVIDERS` for `generate_video`, whose prompt-only run goes to
 * /v1/text-to-video; `VIDEO_GEN_PROVIDERS` for `animate_image`'s
 * /v1/generate-video). Any other id (an image or a sound model saved there, an
 * image-to-video id the text-to-video route does not take) is ignored, and the
 * call's default runs.
 */
export function savedVideoModel(saved: string | null | undefined, accepted: readonly string[]): string | undefined {
  if (typeof saved !== "string") return undefined
  const runsAs = canonicalVideoProvider(saved) as string
  return accepted.includes(runsAs) ? runsAs : undefined
}

/** The video lanes a call can take, each with the route it is sent to. */
export type VideoLane = "image-to-video" | "text-to-video"

/** The provider list of the route each lane is sent to (the image-to-video route runs only image-to-video ids). */
const VIDEO_LANE_PROVIDERS: Readonly<Record<VideoLane, readonly string[]>> = {
  "text-to-video": TEXT_TO_VIDEO_PROVIDERS,
  "image-to-video": IMAGE_TO_VIDEO_PROVIDERS,
}

/**
 * The id a video call sends for the lane it takes. A model with one id per mode
 * (`VIDEO_MODE_ALIASES`: Grok Imagine, Wan, Wan 2.7, HappyHorse) is named by
 * either id, so the named one may be its other mode's: `grok-i2v` on a
 * prompt-only `generate_video` runs as `grok`, `grok` with a frame on
 * `animate_image` as `grok-i2v` (`resolveVideoProviderForMode`). Undefined when
 * the lane's route does not run the result (an image or a lip-sync model, a
 * video edit), so the call can say so instead of sending it.
 */
export function videoModelForLane(model: string, lane: VideoLane): string | undefined {
  const sent = resolveVideoProviderForMode(model, lane)
  return VIDEO_LANE_PROVIDERS[lane].includes(sent) ? sent : undefined
}

/**
 * The refusal for a named model the lane's route does not run, naming the
 * models that do: on the text-to-video lane those that run from a prompt alone.
 */
export function videoModelRefusal(tool: string, model: string, lane: VideoLane): string {
  const works = VIDEO_LANE_PROVIDERS[lane].filter((id) =>
    MODEL_CATALOG[id]?.mcpHidden !== true &&
    (lane === "image-to-video" || !videoProviderRequiresImage(id)),
  )
  const mode = lane === "image-to-video" ? "i2v" : "t2v"
  const what = lane === "image-to-video" ? "from an image" : "from a prompt"
  return `${tool} cannot run "${model}": it is not a model that makes a video ${what}. ` +
    `Use one of: ${works.join(", ")}. Call list_models { kind: "video", mode: "${mode}" } for what each one does.`
}

/** The levers `image_to_image` sends /v1/image-to-image; each absent one is left out. */
export interface ImageToImageLevers {
  provider: string
  aspectRatio?: string
  resolution?: string
  quality?: string
}

/**
 * `image_to_image`'s model, ratio, size and quality: what the call names, else
 * the person's saved image defaults, else the model's own rule.
 *
 * A value the call names is sent as it is, as before: the route fits it to the
 * model and reports what it changed. A saved value is fitted to the model here,
 * because it may have been saved for another model.
 *
 * - The model: the one named, else the saved one when an edit runs it
 *   (`savedEditModel`), else the platform's edit default for the ratio.
 * - The ratio: the one named, else the saved one (a saved "auto" handed on as
 *   "auto", as a named one is). With neither, "auto" on the GPT Image 2, 2.5
 *   and 2.6 edit models (`imageToImageAspectRatio`, the route's own rule), and on any
 *   other model none, so it keeps its own default.
 * - Size and quality: the ones named, else the saved ones where the model
 *   lists them, else none (the model's default).
 */
export function imageToImageLevers(
  named: {
    model?: string | null
    aspect_ratio?: string | null
    resolution?: string | null
    quality?: string | null
  },
  saved: {
    model?: string
    aspectRatio?: string
    resolution?: string
    quality?: string
  },
): ImageToImageLevers {
  const given = (v: string | null | undefined) => (typeof v === "string" && v.trim() !== "" ? v : undefined)
  const requestedRatio = requestedAspectRatio(named.aspect_ratio, saved.aspectRatio)
  const provider = given(named.model) ?? savedEditModel(saved.model) ?? defaultImageModel("edit", requestedRatio)
  const entry = MODEL_CATALOG[provider]

  const savedRatio = given(saved.aspectRatio)
  const fittedSavedRatio = isAutoAspectToken(savedRatio)
    ? "auto"
    : savedRatio !== undefined
      ? normalizeAspectRatio(savedRatio, entry?.aspectRatios, "16:9")
      : undefined
  const aspectRatio =
    given(named.aspect_ratio) ?? fittedSavedRatio ?? imageToImageAspectRatio(provider, undefined)

  const resolution = given(named.resolution) ?? normalizeResolution(saved.resolution, entry?.resolutions)
  const quality = given(named.quality) ?? normalizeQuality(saved.quality, entry?.qualities)

  return {
    provider,
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    ...(resolution !== undefined ? { resolution } : {}),
    ...(quality !== undefined ? { quality } : {}),
  }
}

/**
 * Like `normalizeModel` but returns undefined for empty / unknown so the
 * caller can chain to a saved-pref / catalog-default fallback.
 */
function normalizeModelStrict(input: string | undefined | null): string | undefined {
  if (!input) return undefined
  // A retired model id (Seedance 1.5) is the model it now runs as, not an unknown id.
  const trimmed = canonicalVideoProvider(String(input).trim()) as string
  if (!trimmed) return undefined
  if (MODEL_CATALOG[trimmed]) return trimmed
  const lower = trimmed.toLowerCase()
  for (const id of Object.keys(MODEL_CATALOG)) {
    if (id.toLowerCase() === lower) return id
  }
  return undefined
}

export interface NormalizedVideoParams {
  model: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  modelEntry: ModelCatalogEntry | undefined
}

/**
 * Compose video-tool normalizations. Mirrors `normalizeImageInput` but
 * with `duration` instead of `quality` since that's the lever video
 * models care about. Each lever: the value the call names, else the person's
 * saved video default (`mcp_preferences.video`; a caller hands the model on
 * through `savedVideoModel`, so only one its route takes), else the catalog's. The ratio
 * is chosen before it is fitted to the model (`requestedAspectRatio`), so a
 * saved one is reached; with neither it is `16:9`, or the model's first listed
 * ratio. `resolution` and `duration` fall through to the model's natural
 * default if not picked.
 */
export function normalizeVideoInput(
  raw: {
    model?: string | null
    aspect_ratio?: string | null
    resolution?: string | null
    duration?: number | string | null
  },
  saved: {
    model?: string
    aspectRatio?: string
    resolution?: string
    duration?: number
  },
  fallbackModel: string,
): NormalizedVideoParams {
  const explicitModel = normalizeModelStrict(raw.model)
  const savedRunsAs = saved.model ? (canonicalVideoProvider(saved.model) as string) : undefined
  const savedModel =
    savedRunsAs && MODEL_CATALOG[savedRunsAs] ? savedRunsAs : undefined
  const model = explicitModel ?? savedModel ?? fallbackModel
  const modelEntry = MODEL_CATALOG[model]

  // `normalizeAspectRatio` never answers empty for a model with ratios (an unset
  // value is its 16:9 fallback), so a `?? saved` after it would never be
  // reached: the saved ratio is picked first, then fitted.
  const aspectRatio = normalizeAspectRatio(
    requestedAspectRatio(raw.aspect_ratio, saved.aspectRatio),
    modelEntry?.aspectRatios,
    "16:9",
  )

  const resolution =
    normalizeResolution(raw.resolution, modelEntry?.resolutions)
    ?? normalizeResolution(saved.resolution, modelEntry?.resolutions)
    // Default to the lowest catalog resolution (catalog arrays are ordered
    // low→high) so MCP video tools default to the cheapest tier when the
    // caller doesn't specify one, unless the model declares otherwise.
    ?? defaultResolutionFor(model)
    ?? modelEntry?.resolutions?.[0]

  const duration =
    normalizeDuration(raw.duration, modelEntry?.durations, modelEntry?.autoDuration)
    ?? normalizeDuration(saved.duration, modelEntry?.durations, modelEntry?.autoDuration)

  return { model, aspectRatio, resolution, duration, modelEntry }
}
