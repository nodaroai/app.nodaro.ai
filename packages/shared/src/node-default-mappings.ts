import {
  IMAGE_GEN_PROVIDERS,
  IMAGE_I2I_PROVIDERS,
  IMAGE_EDIT_PROVIDERS,
  UPSCALE_IMAGE_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  IMAGE_TO_VIDEO_PROVIDERS,
  LIP_SYNC_PROVIDERS,
  TTS_PROVIDERS,
  VOICE_DESIGN_MODELS,
} from "./model-constants.js"
import { LLM_MODEL_IDS } from "./llm-models.js"

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type QualityLevel = "low" | "mid" | "high"
export type SemanticAspectRatio = "auto" | "1:1" | "4:3" | "3:4" | "16:9" | "9:16"

export const NODE_DEFAULT_TYPES = [
  // Image
  "generate-image",
  "image-to-image",
  "edit-image",
  "upscale-image",
  // Video
  "text-to-video",
  "image-to-video",
  // Composition
  "lip-sync",
  // Audio / Music
  "text-to-speech",
  "generate-music",
  "voice-design",
  // LLM-driven
  "ai-writer",
  "lottie-overlay",
  "3d-title",
  "motion-graphics",
  "image-to-text",
  "qa-check",
] as const

export type NodeDefaultType = (typeof NODE_DEFAULT_TYPES)[number]

export const QUALITY_LEVELS: readonly QualityLevel[] = ["low", "mid", "high"] as const
export const SEMANTIC_ASPECT_RATIOS: readonly SemanticAspectRatio[] = [
  "auto",
  "1:1",
  "4:3",
  "3:4",
  "16:9",
  "9:16",
] as const

// ──────────────────────────────────────────────────────────────────────────
// Per-node-type registry
// ──────────────────────────────────────────────────────────────────────────

/**
 * Per-node-type metadata: which field on the node carries the admin-set value,
 * the valid value set, and which optional dimensions apply.
 *
 * `field` distinguishes nodes that use `data.provider` (image/video/audio)
 * from nodes that use `data.model` (LLM nodes, voice-design).
 */
interface NodeTypeMeta {
  field: "provider" | "model"
  validValues: readonly string[]
  hasQuality: boolean
  hasAspectRatio: boolean
}

// Music providers per the runtime: enum currently only lists "minimax", but
// `generate-music.defaultData.provider` is "suno" with a separate `modelVersion`.
// Until that mismatch is fixed, accept both values for admin defaults.
const MUSIC_PROVIDERS_FOR_VALIDATION = ["suno", "minimax"] as const

const META: Record<NodeDefaultType, NodeTypeMeta> = {
  "generate-image":   { field: "provider", validValues: IMAGE_GEN_PROVIDERS,   hasQuality: true,  hasAspectRatio: true  },
  "image-to-image":   { field: "provider", validValues: IMAGE_I2I_PROVIDERS,   hasQuality: true,  hasAspectRatio: true  },
  "edit-image":       { field: "provider", validValues: IMAGE_EDIT_PROVIDERS,  hasQuality: false, hasAspectRatio: false },
  "upscale-image":    { field: "provider", validValues: UPSCALE_IMAGE_PROVIDERS, hasQuality: false, hasAspectRatio: false },
  "text-to-video":    { field: "provider", validValues: TEXT_TO_VIDEO_PROVIDERS, hasQuality: true, hasAspectRatio: true },
  "image-to-video":   { field: "provider", validValues: IMAGE_TO_VIDEO_PROVIDERS, hasQuality: true, hasAspectRatio: true },
  "lip-sync":         { field: "provider", validValues: LIP_SYNC_PROVIDERS,    hasQuality: false, hasAspectRatio: false },
  "text-to-speech":   { field: "provider", validValues: TTS_PROVIDERS,         hasQuality: false, hasAspectRatio: false },
  "generate-music":   { field: "provider", validValues: MUSIC_PROVIDERS_FOR_VALIDATION, hasQuality: false, hasAspectRatio: false },
  "voice-design":     { field: "model",    validValues: VOICE_DESIGN_MODELS,   hasQuality: false, hasAspectRatio: false },
  "ai-writer":        { field: "model",    validValues: LLM_MODEL_IDS,         hasQuality: false, hasAspectRatio: false },
  "lottie-overlay":   { field: "model",    validValues: LLM_MODEL_IDS,         hasQuality: false, hasAspectRatio: false },
  "3d-title":         { field: "model",    validValues: LLM_MODEL_IDS,         hasQuality: false, hasAspectRatio: false },
  "motion-graphics":  { field: "model",    validValues: LLM_MODEL_IDS,         hasQuality: false, hasAspectRatio: false },
  "image-to-text":    { field: "model",    validValues: LLM_MODEL_IDS,         hasQuality: false, hasAspectRatio: false },
  "qa-check":         { field: "model",    validValues: LLM_MODEL_IDS,         hasQuality: false, hasAspectRatio: false },
}

export function getTargetField(nodeType: NodeDefaultType): "provider" | "model" {
  return META[nodeType].field
}

export function getValidValues(nodeType: NodeDefaultType): readonly string[] {
  return META[nodeType].validValues
}

export function supportedDefaultDimensions(nodeType: NodeDefaultType): {
  quality: boolean
  aspectRatio: boolean
} {
  const m = META[nodeType]
  return { quality: m.hasQuality, aspectRatio: m.hasAspectRatio }
}

export function validateProviderForNodeType(
  nodeType: NodeDefaultType,
  value: string,
): string | null {
  const valid = META[nodeType].validValues
  if (!valid.includes(value)) {
    return `value "${value}" is not valid for node type "${nodeType}"`
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────────
// Semantic mappings — quality + aspect ratio per provider
// ──────────────────────────────────────────────────────────────────────────

/**
 * Each provider stores its quality lever on a different field of node data:
 *  - `resolution` (1K/2K/4K, 720p/1080p, …) — most image + video providers
 *  - `quality` (medium/high, basic/high) — gpt-image, seedream
 *
 * Mapping a semantic level (low/mid/high) to a concrete value is meaningless
 * without knowing WHICH field it belongs to, because writing "medium" into
 * `resolution` (or "2K" into `quality`) trips the route's Zod enum at
 * generate-time. Each entry pairs the field with the per-level values built
 * from frontend/src/components/editor/config-panels/model-options.ts.
 *
 * Providers absent from this table return `undefined` from `mapQuality`,
 * letting the caller fall back to the factory default value.
 *
 * When a provider has fewer than 3 levels, semantic levels collapse onto
 * the closest concrete value (e.g. gpt-image only has medium/high → low maps
 * to medium).
 */
export type QualityField = "resolution" | "quality"

interface QualityMapping {
  field: QualityField
  values: Partial<Record<QualityLevel, string>>
}

const QUALITY_MAP: Record<string, QualityMapping> = {
  // Image gen — resolution-style (1K/2K/4K)
  "nano-banana-pro":     { field: "resolution", values: { low: "1K", mid: "2K", high: "4K" } },
  "nano-banana-2":       { field: "resolution", values: { low: "1K", mid: "2K", high: "4K" } },
  "flux":                { field: "resolution", values: { low: "1K", mid: "2K", high: "2K" } },
  "flux-flex":           { field: "resolution", values: { low: "1K", mid: "2K", high: "2K" } },
  "flux-i2i":            { field: "resolution", values: { low: "1K", mid: "2K", high: "2K" } },
  "flux-pro-i2i":        { field: "resolution", values: { low: "1K", mid: "2K", high: "2K" } },
  "gpt-image-2":         { field: "resolution", values: { low: "1K", mid: "2K", high: "4K" } },
  "gpt-image-2-i2i":     { field: "resolution", values: { low: "1K", mid: "2K", high: "4K" } },
  // Image gen — quality-style (medium/high or basic/high)
  "gpt-image":           { field: "quality",    values: { low: "medium", mid: "medium", high: "high" } },
  "gpt-image-i2i":       { field: "quality",    values: { low: "medium", mid: "medium", high: "high" } },
  "seedream":            { field: "quality",    values: { low: "basic",  mid: "basic",  high: "high" } },
  "seedream-edit":       { field: "quality",    values: { low: "basic",  mid: "basic",  high: "high" } },
  "seedream-5-lite":     { field: "quality",    values: { low: "basic",  mid: "basic",  high: "high" } },
  "seedream-5-lite-i2i": { field: "quality",    values: { low: "basic",  mid: "basic",  high: "high" } },
  // Video gen — resolution-style (720p/1080p)
  "veo3":                { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
  "veo3.1":              { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
  "kling":               { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
  "kling-3.0":           { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
  "seedance-2-fast":     { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
  "wan-2.7-i2v":         { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
  "wan-2.7-t2v":         { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
  "happyhorse":          { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
  "happyhorse-i2v":      { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
  "happyhorse-ref2v":    { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
  "happyhorse-edit":     { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
  "kling-3-omni":        { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
  "wan-videoedit":       { field: "resolution", values: { low: "720p", mid: "1080p", high: "1080p" } },
}

const ASPECT_PASSTHROUGH_PROVIDERS = new Set([
  ...IMAGE_GEN_PROVIDERS,
  ...IMAGE_I2I_PROVIDERS,
  ...TEXT_TO_VIDEO_PROVIDERS,
  ...IMAGE_TO_VIDEO_PROVIDERS,
])

export interface MappedQuality {
  field: QualityField
  value: string
}

export function mapQuality(provider: string, level: QualityLevel): MappedQuality | undefined {
  const m = QUALITY_MAP[provider]
  const value = m?.values[level]
  return value === undefined ? undefined : { field: m!.field, value }
}

export function mapAspectRatio(
  provider: string,
  ratio: SemanticAspectRatio,
): string | undefined {
  if (ratio === "auto") return undefined
  if (!ASPECT_PASSTHROUGH_PROVIDERS.has(provider as never)) return ratio
  return ratio
}

// ──────────────────────────────────────────────────────────────────────────
// Linked field derivation
// ──────────────────────────────────────────────────────────────────────────

/**
 * When admin sets `provider` for a node that has linked fields (e.g.
 * generate-image stores both `provider` AND `model`), derive the linked
 * fields so the resolver writes a coherent snapshot.
 *
 * For unmapped providers, returns `{}` — the runtime config panel applies
 * its own defaulting when needed.
 */
const GENERATE_IMAGE_PROVIDER_TO_MODEL: Record<string, string> = {
  "nano-banana": "gemini-2.5-flash-image",
  "nano-banana-pro": "gemini-2.5-flash-image",
  "nano-banana-2": "gemini-2.5-flash-image",
}

export function deriveLinkedFields(
  nodeType: NodeDefaultType,
  value: string,
): Record<string, unknown> {
  if (nodeType === "generate-image") {
    const model = GENERATE_IMAGE_PROVIDER_TO_MODEL[value]
    return model ? { model } : {}
  }
  return {}
}
