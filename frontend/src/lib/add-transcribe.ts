/**
 * "Add Transcribe" on a Speaker View fed a bare video (D3, decided 2026-10-11):
 * the transcript is required in video mode, so the panel offers one click that
 * inserts a Transcribe node with speaker detection, wires the video into it and
 * its transcript into Speaker View. Pure: the graph in, the next graph out;
 * `addTranscribeOnCanvas` applies it to the live canvas as ONE undo step.
 *
 * Speaker detection comes only from the ElevenLabs provider, so the node is
 * written with that provider and `diarize: true` whatever the default is.
 */
import { speakerViewVideoModeLive, type SpeakerViewVideoGateFlags } from "@nodaro/render-rules"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

export type AddTranscribeRefusal =
  /** The node is not a Speaker View. */
  | "not-speaker-view"
  /** A transcript is already wired. */
  | "already-wired"
  /** No video is wired: there is nothing to transcribe. */
  | "no-video"
  /** Video mode is not open yet (R15: Speaker View AND Speaker Frames priced). */
  | "video-mode-not-live"

export type AddTranscribeResult =
  | { readonly ok: true; readonly nodes: WorkflowNode[]; readonly edges: WorkflowEdge[]; readonly transcribeId: string }
  | { readonly ok: false; readonly reason: AddTranscribeRefusal }

/** Where the new node lands, relative to Speaker View: up and to the left, beside its inputs. */
export const ADD_TRANSCRIBE_OFFSET = { x: -380, y: -240 } as const

const lastWire = (nodeId: string, handle: string, edges: readonly WorkflowEdge[]) =>
  edges.filter((e) => e.target === nodeId && e.targetHandle === handle).at(-1)

export function planAddTranscribe(
  graph: { readonly nodes: readonly WorkflowNode[]; readonly edges: readonly WorkflowEdge[] },
  nodeId: string,
  transcribe: { readonly id: string; readonly data: Record<string, unknown> },
  /** The price flags the video-mode gate reads; none = the real ones. */
  gate: SpeakerViewVideoGateFlags = {},
): AddTranscribeResult {
  const view = graph.nodes.find((n) => n.id === nodeId)
  if (!view || view.type !== "speaker-view") return { ok: false, reason: "not-speaker-view" }
  if (!speakerViewVideoModeLive(gate)) return { ok: false, reason: "video-mode-not-live" }
  if (lastWire(nodeId, "transcript", graph.edges)) return { ok: false, reason: "already-wired" }
  const videoWire = lastWire(nodeId, "video", graph.edges)
  if (!videoWire) return { ok: false, reason: "no-video" }

  const wire = (source: string, sourceHandle: string | null | undefined, target: string, targetHandle: string): WorkflowEdge => ({
    id: `edge-${source}-${sourceHandle ?? "out"}-${target}-${targetHandle}`,
    source,
    target,
    ...(sourceHandle ? { sourceHandle } : {}),
    targetHandle,
  })
  const node = {
    id: transcribe.id,
    type: "transcribe",
    position: { x: view.position.x + ADD_TRANSCRIBE_OFFSET.x, y: view.position.y + ADD_TRANSCRIBE_OFFSET.y },
    data: { ...transcribe.data, provider: "elevenlabs-stt", diarize: true },
  } as WorkflowNode
  const edges: WorkflowEdge[] = [
    ...graph.edges,
    wire(videoWire.source, videoWire.sourceHandle, transcribe.id, "audio"),
    wire(transcribe.id, "json", nodeId, "transcript"),
  ]
  return { ok: true, nodes: [...graph.nodes, node], edges, transcribeId: transcribe.id }
}
