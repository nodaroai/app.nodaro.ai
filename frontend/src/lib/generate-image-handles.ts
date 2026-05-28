/**
 * Canonical handle IDs for the Generate Image node (Handles v2).
 * Order matches visual BOTTOM-to-TOP layout on the node's left edge.
 *
 * v2.1: `style` split into `look` (aesthetic/cinematography pickers) and
 * `elements` (subject / mood / props / context pickers). Identity handle
 * renamed from `subjects` → `assets`. Legacy edge handles (`style`,
 * `cinematography`, `subjects`) are migrated on load by source type.
 */
import { DYNAMIC_PRODUCER_TYPES } from "@nodaro/shared"

export const GENERATE_IMAGE_INPUT_HANDLES = ["prompt", "negative", "references", "assets", "elements", "look"] as const

export type GenerateImageInputHandle = typeof GENERATE_IMAGE_INPUT_HANDLES[number]

/** Pickers that go on the Look handle. Aligned with the existing
 *  parameter-picker-registry families: "Look" + "Camera" + look-related
 *  multi pickers (framing, lighting, exposure-settings, temporal). Same
 *  structure users already see in the global add-node popup, just
 *  filtered to this handle. */
export const LOOK_PICKER_TYPES: ReadonlyArray<string> = [
  // "Look" family singles
  "setting",
  "atmosphere",
  "style",
  "color-look",
  "mood",
  "photographer",
  "aesthetic",
  "era",
  "photo-genre",
  "backdrop",
  "render-quality",
  "composition-effects",
  "action-fx",
  "loop-subject",
  "post-process-effects",
  "tone",
  // "Camera" family singles
  "camera-motion",
  "lens",
  "camera-format",
  // Look/Camera-related multi pickers
  "framing",
  "lighting",
  "exposure-settings",
  "temporal",
  "transition",
  "character-fx",
]

/** Pickers that go on the Elements handle. Aligned with registry's
 *  "Subject / Object" family + person/styling multi pickers, plus
 *  instrumentation (a person playing/holding an instrument is valid
 *  visual content for an image). Excludes music-genre / music-mood /
 *  voice-character / voice-delivery — those don't translate visually. */
export const ELEMENTS_PICKER_TYPES: ReadonlyArray<string> = [
  // "Subject / Object" family
  "person",
  "pose",
  "animal",
  "vehicle",
  "weapon",
  "furniture",
  "material",
  "held-prop",
  "styling",
  // "Sound" family — instrumentation only (visual on a person)
  "instrumentation",
]

const LOOK_PICKER_SET: ReadonlySet<string> = new Set(LOOK_PICKER_TYPES)
const ELEMENTS_PICKER_SET: ReadonlySet<string> = new Set(ELEMENTS_PICKER_TYPES)

/** Returns "look" or "elements" for any picker source type. Unknown pickers
 *  default to "elements" (the catch-all for content). */
export function classifyPickerForGenerateImage(sourceType: string): "look" | "elements" {
  if (LOOK_PICKER_SET.has(sourceType)) return "look"
  return "elements"
}

/** Source node types whose output text feeds Prompt / Negative. Mirrors
 *  backend `TEXT_SOURCE_NODE_TYPES` in `input-resolver.ts:817` — a node
 *  type that's a text producer at runtime MUST be in this frontend set, or
 *  drag-to-connect on any `prompt` / `negative` / `text` / `transcript`
 *  handle will silently reject the source while the backend would have
 *  happily routed its output. */
export const TEXT_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  "text-prompt", "ai-writer", "llm-chat", "generate-script", "combine-text", "image-to-text", "split-text",
  // Audio/Suno text producers (added with the audio+text typed-handle migration).
  "transcribe", "suno-lyrics", "suno-style-boost",
  // List/data text producers — emit a single text string at runtime per
  // input-resolver.ts:1252 (TEXT_SOURCE_NODE_TYPES dispatch into
  // inputs.prompt). Without these, qa-check/image-critic outputs and
  // list/loop/extract-field text values can't feed any typed prompt.
  "extract-field", "qa-check", "image-critic", "forced-alignment", "list", "loop",
])

/** Source node types whose output image feeds References (mirrors backend
 *  `imageSourceTypes` in payload-builder.ts:1328). */
export const IMAGE_PRODUCER_TYPES: ReadonlySet<string> = new Set([
  "upload-image", "generate-image", "edit-image", "image-to-image", "modify-image", "upscale-image", "remove-background",
  // extract-frame produces a single still image extracted from a video source.
  // Without this entry, its typed source pip's popover returned zero target
  // candidates and downstream image consumers couldn't enumerate it as a
  // valid producer.
  "extract-frame",
  // generate-mask emits the source image AND a mask PNG. Its `image` source
  // pip is the passthrough (same image as the input) — included here so
  // downstream image consumers (Generate Image References, etc.) enumerate it
  // as a valid candidate.
  "generate-mask",
])

/** Identity-locking source node types that feed Subjects. */
export const IDENTITY_TYPES: ReadonlySet<string> = new Set([
  "character", "location", "object", "face",
])

/**
 * Classifies a source node type for migration routing. Returns the target
 * handle ID on the Generate Image node:
 *  - text producer → "prompt"
 *  - image producer → "references"
 *  - identity (Character/Location/Object/Face) → "assets"
 *  - picker → "look" or "elements" depending on family (gives the picker
 *    real runtime effect via tail-append; matches the v2.1 split).
 *  - anything else → "prompt" as a safe default
 */
export function classifyUpstreamForGenerateImage(sourceNodeType: string): GenerateImageInputHandle {
  if (TEXT_PRODUCER_TYPES.has(sourceNodeType)) return "prompt"
  if (IMAGE_PRODUCER_TYPES.has(sourceNodeType)) return "references"
  if (IDENTITY_TYPES.has(sourceNodeType)) return "assets"
  if (LOOK_PICKER_SET.has(sourceNodeType)) return "look"
  if (ELEMENTS_PICKER_SET.has(sourceNodeType)) return "elements"
  return "prompt"
}

/**
 * Connection-time validator: returns true if a source node type is allowed
 * to connect into the given Generate Image target handle. Mirrors the
 * filter logic in `node-compatibility.ts::getCompatibleNodes` for the v2
 * handles. Pickers can connect to Prompt (variable mode) AND Look/Scene
 * (tail-append mode); the wire determines the role.
 *
 * Legacy "style" handle ID accepts BOTH look and scene pickers so legacy
 * single-handle workflows keep working until migration runs.
 */
export function isValidGenerateImageConnection(
  targetHandleId: string,
  sourceNodeType: string,
  isPickerType: (t: string) => boolean,
): boolean {
  switch (targetHandleId) {
    case "prompt":
      // Dynamic producers (loop / list / sub-workflow iterating text columns,
      // reduce returning a string) can emit text at runtime. Accept at canvas
      // to match orchestrator's runtime routing.
      return TEXT_PRODUCER_TYPES.has(sourceNodeType) || isPickerType(sourceNodeType) || DYNAMIC_PRODUCER_TYPES.has(sourceNodeType)
    case "negative":
      return TEXT_PRODUCER_TYPES.has(sourceNodeType) || DYNAMIC_PRODUCER_TYPES.has(sourceNodeType)
    case "references":
      return IMAGE_PRODUCER_TYPES.has(sourceNodeType) || DYNAMIC_PRODUCER_TYPES.has(sourceNodeType)
    case "assets":
      return IDENTITY_TYPES.has(sourceNodeType)
    case "subjects":
      // Legacy alias for "assets" pre-v2.1 rename — keep accepting until migration runs.
      return IDENTITY_TYPES.has(sourceNodeType)
    case "look":
      return LOOK_PICKER_SET.has(sourceNodeType)
    case "elements":
      return ELEMENTS_PICKER_SET.has(sourceNodeType) || (isPickerType(sourceNodeType) && !LOOK_PICKER_SET.has(sourceNodeType))
    case "style":
      // Legacy: accept any picker (pre-migration backwards compat).
      return isPickerType(sourceNodeType)
    default:
      // Unknown handle (legacy or external) — let it through; other validators
      // may still reject. Defensive default.
      return true
  }
}
