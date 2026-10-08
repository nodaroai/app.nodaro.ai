import {
  DEFAULT_TRANSCRIBE_NODE_PROVIDER,
  transcribeLaneSupportsWordTimestamps,
  transcribeProvidersWithWordTimestamps,
} from "./model-constants.js"
import { renderTranscriptOutputOf } from "./render-nodes.js"

/**
 * Pre-run checks for the transcribe → captions chain.
 *
 * A transcription lane that cannot return per-word timings (`whisper`) still
 * RUNS and BILLS — it just hands back phrase segments with `words: []`. Anything
 * downstream that needs words then fails AFTER the transcription was paid for.
 * These helpers let every run surface (the editor's DAG, the backend
 * orchestrator, single-node Run) refuse BEFORE any spend, with one message.
 * Pure: no I/O, no framework types — callers pass plain nodes/edges.
 */

/** The refusal for a lane that can't return word timings; `null` when it can.
 *  An absent provider resolves to the transcribe NODE default. */
export function transcribeWordTimestampsRefusal(provider: string | null | undefined): string | null {
  const lane = provider || DEFAULT_TRANSCRIBE_NODE_PROVIDER
  if (transcribeLaneSupportsWordTimestamps(lane)) return null
  return `the "${lane}" engine does not return word timings — pick ${transcribeProvidersWithWordTimestamps().join(" or ")}`
}

export interface PreflightGraphNode {
  readonly id: string
  readonly type?: string | null
  readonly data?: Record<string, unknown> | null
}
export interface PreflightGraphEdge {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

export interface WordlessTranscriptFeed {
  readonly transcribeNodeId: string
  /** The add-captions node that would receive a transcript with no words. */
  readonly consumerNodeId: string
  readonly provider: string
  readonly message: string
}

// Handle ids (generated map: backend/src/lib/mcp/generated/node-handles.ts).
const TRANSCRIBE_JSON_OUT = "json"
const TRANSCRIPT_IN = "transcript"

/**
 * Every transcribe node on a word-INCAPABLE lane whose `json` output reaches an
 * add-captions `transcript` input — directly, or through apply-edl, which remaps
 * the transcript and re-emits it on its own `json` handle (or any render, by
 * its registry `transcriptOutput`: Speaker View's `transcript`). add-captions rejects a
 * transcript with no words, so such a run can only fail, after paying for the
 * transcription. Skipped nodes are ignored on both ends.
 *
 * The engine is read from node data and nothing else can change it: `provider`
 * is not a mappable field on transcribe, so what this check sees IS what runs.
 * add-captions' own "transcript has no words" guard stays as defence in depth
 * for a transcript that arrives from anywhere other than a transcribe node.
 */
export function findWordlessTranscriptFeeds(
  nodes: readonly PreflightGraphNode[],
  edges: readonly PreflightGraphEdge[],
): WordlessTranscriptFeed[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const isSkipped = (n: PreflightGraphNode | undefined): boolean => !n || n.data?.skipped === true
  const out: WordlessTranscriptFeed[] = []

  for (const node of nodes) {
    if (node.type !== "transcribe" || isSkipped(node)) continue
    const provider = (typeof node.data?.provider === "string" && node.data.provider) || DEFAULT_TRANSCRIBE_NODE_PROVIDER
    const refusal = transcribeWordTimestampsRefusal(provider)
    if (!refusal) continue

    // Walk the transcript's path: transcribe.json → [render.transcript → its transcript output]* → add-captions.transcript,
    // out of every render on the pip its registry names (RENDER_NODE_TYPES transcriptOutput)
    const seen = new Set<string>()
    const frontier: Array<{ id: string; outHandle: string }> = [{ id: node.id, outHandle: TRANSCRIBE_JSON_OUT }]
    while (frontier.length > 0) {
      const { id, outHandle } = frontier.pop()!
      for (const e of edges) {
        if (e.source !== id || (e.sourceHandle ?? null) !== outHandle || e.targetHandle !== TRANSCRIPT_IN) continue
        const target = byId.get(e.target)
        if (isSkipped(target)) continue
        if (target!.type === "add-captions") {
          out.push({
            transcribeNodeId: node.id,
            consumerNodeId: target!.id,
            provider,
            message: `Captions need word timings, but ${refusal}.`,
          })
        } else if (!seen.has(target!.id)) {
          const remapped = renderTranscriptOutputOf(target!.type)
          if (remapped) {
            seen.add(target!.id)
            frontier.push({ id: target!.id, outHandle: remapped.handle })
          }
        }
      }
    }
  }
  return out
}
