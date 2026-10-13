/**
 * What the Speaker Frames panel and node face say (P3.6), as pure functions so
 * the components only choose words:
 *  - the per-source tick list (P3-5 (a)): every camera the wired edit samples,
 *    with its frame count, from the plugin's own scope (`@nodaro/render-rules`);
 *  - the result: tracks per camera and who they are, AFTER the node's manual
 *    corrections (`trackAssignments`, P3-18 (a)), with any correction whose
 *    track a re-run no longer has listed, never dropped. Names read through the
 *    speaker-rename map of the transcript wired into Speaker Frames (decided
 *    2026-10-10), by the same funnel Speaker View labels its tracks with.
 * Reads what the canvas holds (saved outputs); never runs anything.
 */
import {
  coerceSpeakerFramesEdits,
  labelSpeakerViewTracks,
  speakerFramesSourceRows,
  type SpeakerFramesSourceRow,
  type SpeakerTrackAssignment,
} from "@nodaro/render-rules"
import { normalizeSpeakerTrackSetDescriptor } from "@nodaro/shared"
import { speakerViewEdits } from "@/lib/speaker-view-context"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

export interface SpeakerFramesPanelSource extends SpeakerFramesSourceRow {
  /** The camera's canvas label (an edit's source id is its node id), else the id. */
  readonly label: string
}

/** The cameras the edit wired into `nodeId` samples, ticked or not. Empty when
 *  nothing is wired yet or the edit cannot be read. */
export function speakerFramesSourcesOf(
  nodeId: string,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): SpeakerFramesPanelSource[] {
  const edits = speakerViewEdits(nodeId, nodes, edges)
  if (edits.length === 0) return []
  const coerced = coerceSpeakerFramesEdits(edits)
  if (!coerced.ok) return []
  const node = nodes.find((n) => n.id === nodeId)
  const exclude = (node?.data as { excludeSourceIds?: unknown } | undefined)?.excludeSourceIds
  const rows = speakerFramesSourceRows(coerced.edits, Array.isArray(exclude) ? (exclude as string[]) : [])
  return rows.map((r) => {
    const label = (nodes.find((n) => n.id === r.sourceId)?.data as { label?: unknown } | undefined)?.label
    return { ...r, label: typeof label === "string" && label.trim() ? label : r.sourceId }
  })
}

/** A bare video on the Video input with no edit on the EDL input: Speaker
 *  Frames samples that whole video as its one camera, so there is no camera to
 *  choose (an edit and a video together are refused at the run). */
export function speakerFramesBareVideoWired(nodeId: string, edges: ReadonlyArray<WorkflowEdge>): boolean {
  const into = edges.filter((e) => e.target === nodeId)
  return into.some((e) => e.targetHandle === "video") && !into.some((e) => e.targetHandle === "edl")
}

/** The untick list after (un)ticking one camera: a copy, in a stable order. */
export function toggleSpeakerFramesSource(exclude: readonly string[] | undefined, sourceId: string, ticked: boolean): string[] {
  const rest = (exclude ?? []).filter((id) => id !== sourceId)
  return ticked ? rest : [...rest, sourceId]
}

export interface SpeakerFramesResultSource {
  readonly sourceId: string
  readonly tracks: number
  /** Distinct speakers its tracks are attributed to, in first-seen order. */
  readonly speakers: string[]
  readonly unattributed: number
}

export interface SpeakerFramesResultSummary {
  readonly sources: SpeakerFramesResultSource[]
  readonly unmatched: SpeakerTrackAssignment[]
}

/**
 * The saved result, read after the node's corrections and through the rename
 * map of `transcript` (the one wired into Speaker Frames): an auto label and a
 * correction both show today's name (P3-4). `null` with no result.
 */
export function speakerFramesResultSummary(
  generatedJson: unknown,
  assignments: readonly SpeakerTrackAssignment[] | undefined,
  transcript?: unknown,
): SpeakerFramesResultSummary | null {
  if (!generatedJson || typeof generatedJson !== "object" || Array.isArray(generatedJson)) return null
  const { descriptor, unmatched } = labelSpeakerViewTracks(normalizeSpeakerTrackSetDescriptor(generatedJson), { trackAssignments: assignments, transcript })
  return {
    sources: descriptor.sources.map((s) => {
      const speakers: string[] = []
      let unattributed = 0
      for (const t of s.tracks) {
        if (typeof t.speaker === "string" && t.speaker) {
          if (!speakers.includes(t.speaker)) speakers.push(t.speaker)
        } else unattributed++
      }
      return { sourceId: s.sourceId, tracks: s.tracks.length, speakers, unattributed }
    }),
    unmatched,
  }
}
