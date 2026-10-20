/**
 * Whether a recording wired into Edit Plan's `sources` is a camera (`video`)
 * or sound only (`audio`) — the ONE rule both run engines build the plan's
 * sources with and the Speaker Frames estimate counts cameras by (the run
 * samples only `video` sources, so the estimate must never call a camera
 * sound-only). The producer's type decides (a video producer is video, an
 * audio producer audio, anything else video), unless the plan's own source
 * settings set the kind. Pure.
 */
import { AUDIO_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared/nodes"

export type EditPlanSourceKind = "video" | "audio"

/** The kind a producer of `type` hands Edit Plan. */
export function editPlanProducerKind(type: string | null | undefined): EditPlanSourceKind {
  const t = type ?? ""
  return VIDEO_PRODUCER_TYPES.has(t) ? "video" : AUDIO_PRODUCER_TYPES.has(t) ? "audio" : "video"
}

/** A source's kind in the plan: the kind its source settings set, when it is one, else the producer's. */
export function editPlanSourceKind(configured: unknown, producerKind: EditPlanSourceKind): EditPlanSourceKind {
  return configured === "audio" || configured === "video" ? configured : producerKind
}
