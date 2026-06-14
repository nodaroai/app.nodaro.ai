/**
 * Models-tab data source: maps each catalog model to the node it creates
 * (`modelToNodeTarget`) and groups node-creatable models into product lines
 * (`buildModelTree`). Consumed by the add-node popup's Models tab. Pure — derives
 * everything from `MODEL_CATALOG` + the provider enums, so models added to the
 * catalog/enums flow through automatically.
 */
import { MODEL_CATALOG, type ModelKind, type ModelMode } from "./model-catalog.js"
import {
  IMAGE_GEN_PROVIDERS, VIDEO_GEN_PROVIDERS, IMAGE_TO_VIDEO_PROVIDERS, TEXT_TO_VIDEO_PROVIDERS,
  UPSCALE_IMAGE_PROVIDERS, VIDEO_UPSCALE_PROVIDERS, MODIFY_IMAGE_PROVIDERS, IMAGE_EDIT_PROVIDERS,
  VIDEO_TO_VIDEO_PROVIDERS, EXTEND_VIDEO_PROVIDERS, MOTION_TRANSFER_PROVIDERS, LIP_SYNC_PROVIDERS,
  FACE_SWAP_PROVIDERS, TTS_PROVIDERS, TEXT_TO_AUDIO_PROVIDERS, TRANSCRIBE_PROVIDERS, MUSIC_PROVIDERS,
} from "./model-constants.js"

export interface ModelNodeTarget {
  nodeType: string
  field?: "provider" | "model"
  value?: string
}
export interface ModelTreeVariant extends ModelNodeTarget {
  id: string
  label: string
  kind: ModelKind
}
export interface ModelTreeLine {
  series: string
  family: string
  kind: ModelKind
  models: ModelTreeVariant[]
}

// A model id that is a valid provider-enum value gets a node + provider preset.
const ENUM_TARGETS: ReadonlyArray<readonly [readonly string[], string]> = [
  [IMAGE_GEN_PROVIDERS, "generate-image"],
  [VIDEO_GEN_PROVIDERS, "generate-video"],
  [IMAGE_TO_VIDEO_PROVIDERS, "generate-video"],
  [TEXT_TO_VIDEO_PROVIDERS, "generate-video"],
  [UPSCALE_IMAGE_PROVIDERS, "upscale-image"],
  [VIDEO_UPSCALE_PROVIDERS, "video-upscale"],
  [MODIFY_IMAGE_PROVIDERS, "modify-image"],
  [IMAGE_EDIT_PROVIDERS, "modify-image"],
  [VIDEO_TO_VIDEO_PROVIDERS, "video-to-video"],
  [EXTEND_VIDEO_PROVIDERS, "extend-video"],
  [MOTION_TRANSFER_PROVIDERS, "motion-transfer"],
  [LIP_SYNC_PROVIDERS, "lip-sync"],
  [FACE_SWAP_PROVIDERS, "face-swap"],
  [TTS_PROVIDERS, "text-to-speech"],
  [TEXT_TO_AUDIO_PROVIDERS, "text-to-audio"],
  [TRANSCRIBE_PROVIDERS, "transcribe"],
  [MUSIC_PROVIDERS, "suno-generate"],
]

// Fallback by the catalog's own `modes`, for models whose id is NOT a provider-enum
// value — single-provider utility nodes (voice-design, dubbing, …) and catalog models
// that no node exposes as a provider option. These create a bare node of the right
// type (no provider preset — the user picks the model inside the node).
const MODE_TO_NODE: Readonly<Partial<Record<ModelMode, string>>> = {
  "t2i": "generate-image", "i2i": "modify-image", "edit": "modify-image", "remove-bg": "modify-image",
  "t2v": "generate-video", "i2v": "generate-video", "v2v": "video-to-video", "extend": "extend-video",
  "upscale": "upscale-image", "video-upscale": "video-upscale", "motion-transfer": "motion-transfer",
  "lip-sync": "lip-sync", "tts": "text-to-speech", "sfx": "text-to-audio",
  "music": "suno-generate", "voice-design": "voice-design", "voice-changer": "voice-changer",
  "isolation": "audio-isolation", "dubbing": "dubbing", "forced-alignment": "forced-alignment", "stt": "transcribe",
}

// Suno catalog ids map to suno-generate `data.model` enum values (not the id).
const SUNO_MODEL_VALUE: Readonly<Record<string, string>> = { "suno": "V4", "suno-v5": "V5" }

export function modelToNodeTarget(modelId: string): ModelNodeTarget | null {
  const entry = MODEL_CATALOG[modelId]
  if (!entry) return null
  const sunoValue = SUNO_MODEL_VALUE[modelId]
  if (sunoValue) return { nodeType: "suno-generate", field: "model", value: sunoValue }
  for (const [providers, nodeType] of ENUM_TARGETS) {
    if (providers.includes(modelId)) return { nodeType, field: "provider", value: modelId }
  }
  for (const mode of entry.modes) {
    const nodeType = MODE_TO_NODE[mode]
    if (nodeType) return { nodeType }
  }
  return null
}

export function buildModelTree(): ModelTreeLine[] {
  const bySeries = new Map<string, ModelTreeLine>()
  for (const entry of Object.values(MODEL_CATALOG)) {
    const target = modelToNodeTarget(entry.id)
    if (!target || !entry.series) continue
    let line = bySeries.get(entry.series)
    if (!line) {
      line = { series: entry.series, family: entry.family, kind: entry.kind, models: [] }
      bySeries.set(entry.series, line)
    }
    line.models.push({ id: entry.id, label: entry.label, kind: entry.kind, ...target })
  }
  return [...bySeries.values()].sort((a, b) => a.series.localeCompare(b.series))
}
