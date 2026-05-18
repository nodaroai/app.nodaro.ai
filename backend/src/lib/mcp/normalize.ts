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
import { MODEL_CATALOG, type ModelCatalogEntry } from "@nodaro/shared"

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
  if (["ultra", "best", "max", "premium", "highest"].includes(lower)) return last
  if (["auto", "balanced", "default", "normal", "standard"].includes(lower)) {
    // Prefer "BALANCED" / "medium" if present; otherwise first.
    const balanced = supported.find((v) =>
      ["BALANCED", "medium", "basic"].includes(v),
    )
    return balanced ?? supported[0]
  }
  if (["fast", "quick", "speed", "turbo"].includes(lower)) {
    return supported.find((v) => v.toLowerCase().includes("turbo")) ?? supported[0]
  }
  return undefined
}

/**
 * Normalize a duration (seconds). "10s" / "10 seconds" → 10.
 * Snaps to the nearest supported value when requested duration isn't exact.
 */
export function normalizeDuration(
  input: number | string | undefined | null,
  supported: readonly number[] | undefined,
): number | undefined {
  if (!supported || supported.length === 0) return undefined
  if (input === undefined || input === null) return undefined
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
 * Compose all four image-tool normalizations against the catalog.
 * Returns guaranteed-valid values for the resolved model — caller can
 * forward straight to the route without further validation.
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

  const aspectRatio =
    normalizeAspectRatio(raw.aspect_ratio, modelEntry?.aspectRatios, "16:9")
    ?? normalizeAspectRatio(saved.aspectRatio, modelEntry?.aspectRatios, "16:9")

  const resolution =
    normalizeResolution(raw.resolution, modelEntry?.resolutions)
    ?? normalizeResolution(saved.resolution, modelEntry?.resolutions)

  const quality =
    normalizeQuality(raw.quality, modelEntry?.qualities)
    ?? normalizeQuality(saved.quality, modelEntry?.qualities)

  return { model, aspectRatio, resolution, quality, modelEntry }
}

/**
 * Like `normalizeModel` but returns undefined for empty / unknown so the
 * caller can chain to a saved-pref / catalog-default fallback.
 */
function normalizeModelStrict(input: string | undefined | null): string | undefined {
  if (!input) return undefined
  const trimmed = String(input).trim()
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
 * models care about. `aspectRatio` defaults to `16:9`; `resolution` and
 * `duration` fall through to the model's natural default if not picked.
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
  const savedModel =
    saved.model && MODEL_CATALOG[saved.model] ? saved.model : undefined
  const model = explicitModel ?? savedModel ?? fallbackModel
  const modelEntry = MODEL_CATALOG[model]

  const aspectRatio =
    normalizeAspectRatio(raw.aspect_ratio, modelEntry?.aspectRatios, "16:9")
    ?? normalizeAspectRatio(saved.aspectRatio, modelEntry?.aspectRatios, "16:9")

  const resolution =
    normalizeResolution(raw.resolution, modelEntry?.resolutions)
    ?? normalizeResolution(saved.resolution, modelEntry?.resolutions)
    // Default to the lowest catalog resolution (catalog arrays are ordered
    // low→high) so MCP video tools default to the cheapest tier when the
    // caller doesn't specify one.
    ?? modelEntry?.resolutions?.[0]

  const duration =
    normalizeDuration(raw.duration, modelEntry?.durations)
    ?? normalizeDuration(saved.duration, modelEntry?.durations)

  return { model, aspectRatio, resolution, duration, modelEntry }
}
