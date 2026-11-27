/**
 * Provider-kind resolution for reconciliation. Maps a resolved
 * model/provider id (the value the worker handler passes into the
 * router) to the corresponding `ProviderKind` so `makeOnTaskCreated`
 * persists the right kind on the job row.
 */
import { isKling4Provider, isVeoProvider, normalizeKling4Resolution, videoRunsHdr } from "@nodaro/shared/models"
import { REPLICATE_IMAGE_EDIT_MODEL_IDS, REPLICATE_IMAGE_MODEL_IDS } from "../../providers/replicate/image.js"
import { isLongKieVideoRender } from "../../providers/kie/long-render.js"
import type { ProviderKind } from "./types.js"

// ---------------------------------------------------------------------------
// Image generation / image-to-image / edit-image
// ---------------------------------------------------------------------------

const IMAGE_REPLICATE_MODELS: ReadonlySet<string> = new Set([
  ...REPLICATE_IMAGE_MODEL_IDS,
  // Topaz image upscale (Replicate since 2026-10-25).
  ...REPLICATE_IMAGE_EDIT_MODEL_IDS,
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
  // Lightricks LTX 2.3 — predictions via `lightricks/ltx-2.3-{pro,fast}`,
  // completion via standard Replicate prediction reconcile path.
  "ltx-2.3-pro",
  "ltx-2.3-fast",
])

/**
 * `run`: the run's resolution and dynamic range, where the kind depends on
 * them — a Kling 4.0 run at 4K or in HDR renders far slower (polled up to ~45
 * min, `kling4PollAttempts`), so it is `kie-long-video`, whose threshold is past
 * that; at 720p / 1080p SDR it stays `kie-standard`. A Seedance 2.5 run at 4K
 * (decided 2026-11-25) is a long render too (`longRenderPollAttempts`, about
 * 56 min for a 30 s clip), and so `kie-long-video` as well.
 */
export function providerKindForVideoModel(model: string, run?: { resolution?: unknown; dynamicRange?: unknown }): ProviderKind {
  if (run && isLongKieVideoRender(model, run.resolution)) return "kie-long-video"
  if (isKling4Provider(model) && run) {
    const res = typeof run.resolution === "string" ? run.resolution : undefined
    if (normalizeKling4Resolution(res) === "4k" || videoRunsHdr(model, run.dynamicRange)) return "kie-long-video"
  }
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
// Suno (every Suno music function)
// ---------------------------------------------------------------------------

export function providerKindForSuno(): ProviderKind {
  return "kie-suno"
}

/** A Suno task made on KIE's market lane (Suno Speech, a cover by id): polled where it was made. */
export function providerKindForSunoMarket(): ProviderKind {
  return "kie-suno-market"
}
