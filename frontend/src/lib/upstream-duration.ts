import { runForwardedVideoLengthSec } from "@nodaro/render-rules"
import type { WorkflowNode, WorkflowEdge } from "@/types/nodes"

/**
 * The seconds the video on a wire runs, from the node the wire leaves. A RUN
 * reads it with {@link runWireDurationReader} (the read the server's run
 * charges by); an ESTIMATE passes its own reader (`video-utility-estimate.ts`),
 * which also follows a render's output at its estimated length.
 */
export type WireDurationReader = (sourceId: string) => number | undefined

/**
 * What a RUN hands a length-priced step (Trim, Loop, Combine Videos) for the
 * video on a wire — the length that step is charged at, read by the one rule
 * both engines share (`runForwardedVideoLengthSec`, @nodaro/render-rules): a
 * chain's passed-on length, a list row's own, a render's recorded cut, an
 * upload's recorded length (only while it is still the node's file). `url`,
 * when known, is the video the wire carries.
 */
export function runWireDurationReader(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  url?: string,
): WireDurationReader {
  return (sourceId) => runForwardedVideoLengthSec(sourceId, url, nodes, edges)
}

/** Single-input nodes (loop-video, trim-video). Returns the duration of
 *  the upstream connected via the `"in"` edge, or undefined. Read as a run
 *  reads it unless a reader is given. */
export function getUpstreamDuration(
  nodeId: string,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  durationOf: WireDurationReader = runWireDurationReader(nodes, edges),
): number | undefined {
  const incoming = edges.find((e) => e.target === nodeId)
  if (!incoming) return undefined
  return durationOf(incoming.source)
}

/** Multi-input combine-videos, one entry per incoming WIRE (an estimate's
 *  view, before a run knows each wire's clips) — clipOrder if set, else
 *  incoming edges sorted by edge id (stable). Each entry may be undefined. A
 *  run sends one length per CLIP instead: {@link combineRunUpstreamDurations}. */
export function getCombineUpstreamDurations(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  durationOf: WireDurationReader = runWireDurationReader(nodes, edges),
  /** How many clips a wire hands the node (an estimate passes `fanInClipCount`: a Bundle from a fanned-out source counts each). */
  clipsOf: (edge: WorkflowEdge) => number = () => 1,
): Array<number | undefined> {
  const data = node.data as Record<string, unknown>
  const clipOrder = data.clipOrder as string[] | undefined
  const incoming = edges.filter((e) => e.target === node.id)

  let ordered: WorkflowEdge[]
  if (clipOrder?.length) {
    ordered = clipOrder.flatMap((id) => incoming.filter((e) => e.source === id).slice(0, 1))
  } else {
    ordered = [...incoming].sort((a, b) => a.id.localeCompare(b.id))
  }

  return ordered.flatMap((e) => Array.from({ length: Math.max(1, clipsOf(e)) }, () => durationOf(e.source)))
}

/**
 * The length of each clip a Combine Videos RUN sends, aligned with its
 * `videoUrls` (decided 2026-10-13): each clip at the length its own wire
 * hands on — a Bundle's clips one by one, each at its own row's length
 * (UGC Finish's finished clips), never one length per wire. The server's run
 * builds the same list (`videoUrlsWithSourceIds[].duration`), so the route
 * charges the editor's run what it charges the server's. A clip with no
 * known source stays undefined (the route then prices every clip at the
 * fallback, as before).
 */
export function combineRunUpstreamDurations(
  videoUrls: ReadonlyArray<string>,
  entries: ReadonlyArray<{ readonly nodeId: string; readonly url: string }>,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): Array<number | undefined> {
  return videoUrls.map((url, i) => {
    const entry = entries[i]?.url === url ? entries[i] : entries.find((e) => e.url === url)
    return entry ? runForwardedVideoLengthSec(entry.nodeId, url, nodes, edges) : undefined
  })
}
