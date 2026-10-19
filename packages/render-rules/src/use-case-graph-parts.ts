/**
 * The node and wire shapes every use-case builder emits (one spelling, so
 * every chain hashes alike). Pure.
 */
import type { UseCaseGraphEdge, UseCaseGraphNode, UseCaseMediaSource } from "./use-case-graph"

export function usecaseNode(id: string, type: string, column: number, row: number, data: Record<string, unknown>): UseCaseGraphNode {
  return { id, type, position: { x: column * 320, y: row * 220 }, data: { fieldMappings: {}, ...data } }
}

export function usecaseEdge(source: string, sourceHandle: string, target: string, targetHandle: string, each?: true): UseCaseGraphEdge {
  return {
    id: `uc-e-${source}-${sourceHandle}-${target}-${targetHandle}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    ...(each ? { data: { outputMode: "each" as const } } : {}),
  }
}

/**
 * The recording's upload node. Its probed length rides the declared
 * `metadata.durationSeconds` (unstamped, so `editPlanSourceDurationSec` trusts
 * it) — Edit Plan's and the estimate's length come from it; unknown leaves it
 * off (the 180-minute ceiling). A one-recording chain names it "Episode
 * recording"; a multicam front names each by its place (Camera 2, Master audio).
 */
export function usecaseSourceNode(id: string, media: UseCaseMediaSource, column: number, row: number, label = "Episode recording"): UseCaseGraphNode {
  const duration = typeof media.durationSec === "number" && media.durationSec > 0 ? { metadata: { durationSeconds: media.durationSec } } : {}
  return usecaseNode(id, media.kind === "audio" ? "upload-audio" : "upload-video", column, row, {
    label, assetId: "", url: media.url, ...duration,
  })
}

/** The diarized, word-timed transcription every chain starts with (pinned lane: word timings). */
export function usecaseTranscribeNode(id: string, column: number, row: number): UseCaseGraphNode {
  return usecaseNode(id, "transcribe", column, row, { label: "Transcribe", provider: "elevenlabs-stt", language: "auto", diarize: true })
}
