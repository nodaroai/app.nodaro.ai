import { AUDIO_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared"

export type MergeMediaKind = "video" | "audio" | null

/**
 * Classify an incoming source for the merge-video-audio config panel as the
 * video to merge into ("video"), a mixable audio track ("audio"), or neither
 * (null — not a media producer, must never render as a track).
 *
 * Consumes the shared `AUDIO_PRODUCER_TYPES` / `VIDEO_PRODUCER_TYPES` single
 * source of truth (same sets that drive handle acceptance + the executor) so
 * this panel can never again drift behind them — the drift that silently
 * dropped voice-changer (and dubbing / voice-remix / voice-design / …) from
 * the Audio Tracks list while their audio still merged at default volume.
 *
 * `effectiveType` is the source node's type, except sub-workflow ports which
 * the caller pre-resolves to "__audio__" / "__video__" from the port mediaType.
 * `sourceHandle` is the id of the handle the wire leaves — dual-output nodes
 * (voice-changer, split-media) expose distinct `audio` / `video` source
 * handles, so the handle names the lane regardless of the node's default.
 */
export function classifyMergeSource(
  effectiveType: string,
  sourceHandle?: string,
): MergeMediaKind {
  // Dual-output media nodes name their lane on the source handle.
  if (sourceHandle === "video") return "video"
  if (sourceHandle === "audio") return "audio"

  // Sub-workflow output ports, pre-resolved by the caller.
  if (effectiveType === "__video__") return "video"
  if (effectiveType === "__audio__") return "audio"

  // Static classification via the shared single source of truth.
  if (VIDEO_PRODUCER_TYPES.has(effectiveType)) return "video"
  if (AUDIO_PRODUCER_TYPES.has(effectiveType)) return "audio"

  // split-media emits chunk lanes on `col_<id>` handles (not audio/video);
  // default its chunk stream to an audio track to preserve prior behavior.
  if (effectiveType === "split-media") return "audio"

  return null
}
