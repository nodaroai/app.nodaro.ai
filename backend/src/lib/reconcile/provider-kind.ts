/**
 * Provider-kind resolution for reconciliation. Maps a resolved
 * model/provider id (the value the worker handler passes into the
 * router) to the corresponding `ProviderKind` so `makeOnTaskCreated`
 * persists the right kind on the job row.
 */
import { isVeoProvider } from "@nodaro/shared"
import { REPLICATE_IMAGE_MODEL_IDS } from "../../providers/replicate/image.js"
import type { ProviderKind } from "./types.js"

// ---------------------------------------------------------------------------
// Image generation / image-to-image / edit-image
// ---------------------------------------------------------------------------

const IMAGE_REPLICATE_MODELS: ReadonlySet<string> = new Set([
  ...REPLICATE_IMAGE_MODEL_IDS,
  // Synthetic identifier — Character LoRA inference via Replicate. NOT in
  // the IMAGE_MODELS map (the version is resolved per-request from the
  // character's stored `lora_replicate_version`).
  "flux-lora-character",
])

const IMAGE_KIE_KONTEXT_MODELS: ReadonlySet<string> = new Set([
  "flux-kontext",
  "flux-kontext-max",
])

export function providerKindForImageModel(model: string): ProviderKind {
  if (IMAGE_REPLICATE_MODELS.has(model)) return "replicate-prediction"
  if (IMAGE_KIE_KONTEXT_MODELS.has(model)) return "kie-kontext"
  return "kie-standard"
}

// ---------------------------------------------------------------------------
// Video (image-to-video + text-to-video)
// ---------------------------------------------------------------------------

const VIDEO_REPLICATE_MODELS: ReadonlySet<string> = new Set([
  "runway",
  "pika",
])

export function providerKindForVideoModel(model: string): ProviderKind {
  if (isVeoProvider(model)) return "kie-veo"
  if (model === "kling-3.0") return "kie-kling3"
  if (model === "runway-kie") return "kie-runway"
  if (VIDEO_REPLICATE_MODELS.has(model)) return "replicate-prediction"
  return "kie-standard"
}

// ---------------------------------------------------------------------------
// Video — special (lip-sync, video-to-video, motion-transfer, video-upscale)
// ---------------------------------------------------------------------------

export function providerKindForLipSyncModel(_model: string): ProviderKind {
  return "kie-lip-sync"
}

export function providerKindForVideoToVideoModel(model: string): ProviderKind {
  if (model === "luma-modify") return "kie-luma"
  // Runway Aleph polls `/api/v1/aleph/record-info`, NOT the standard
  // `/api/v1/jobs/recordInfo`. Without this branch the reconciler hit the
  // wrong endpoint and force-failed every stuck Aleph row.
  if (model === "runway-aleph") return "kie-aleph"
  return "kie-standard"
}

// ---------------------------------------------------------------------------
// Audio (text-to-speech, text-to-audio, etc.)
// ---------------------------------------------------------------------------

export function providerKindForTtsModel(model: string): ProviderKind {
  if (model === "elevenlabs-v3") return "elevenlabs-sync"
  return "kie-standard"
}

// ---------------------------------------------------------------------------
// Suno (every Suno music function)
// ---------------------------------------------------------------------------

export function providerKindForSuno(): ProviderKind {
  return "kie-suno"
}
