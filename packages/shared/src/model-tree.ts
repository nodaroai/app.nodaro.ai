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
  "video-analysis": "video-analysis",
}

export function modelToNodeTarget(modelId: string): ModelNodeTarget | null {
  const entry = MODEL_CATALOG[modelId]
  if (!entry) return null
  // Resolve the target node: a valid provider-enum value wins, else the catalog's modes.
  const enumMatch = ENUM_TARGETS.find(([providers]) => providers.includes(modelId))
  const nodeType = enumMatch?.[1] ?? entry.modes.map((m) => MODE_TO_NODE[m]).find(Boolean)
  if (!nodeType) return null
  // suno-generate stores its model in `data.model` (a V-code carried on the catalog
  // entry as `dataValue`), not as a `provider` id. Every other node takes a `provider`
  // preset when the id is a valid enum value, and a bare node otherwise.
  if (nodeType === "suno-generate") {
    return entry.dataValue ? { nodeType, field: "model", value: entry.dataValue } : { nodeType }
  }
  return enumMatch ? { nodeType, field: "provider", value: modelId } : { nodeType }
}

/**
 * Flat, query-filtered model variants for the add-node search. The single source
 * of truth shared by the Models tab/category browser and every tab's search
 * (image/video/audio narrow by `kind`; models/all/common pass no kind). Filters
 * by label/id substring; a blank query returns `[]`. Derived from
 * `buildModelTree`, so only node-creatable models appear and new catalog entries
 * flow through automatically.
 */
// MODEL_CATALOG + the provider enums are static module constants, so the tree
// never changes at runtime — build it once and reuse for every search keystroke.
let _modelTree: ModelTreeLine[] | null = null
function getModelTree(): ModelTreeLine[] {
  return (_modelTree ??= buildModelTree())
}

export function searchModelVariants(query: string, kind?: ModelKind): ModelTreeVariant[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return getModelTree()
    .flatMap((l) => l.models)
    .filter((m) => (!kind || m.kind === kind) && (m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)))
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
