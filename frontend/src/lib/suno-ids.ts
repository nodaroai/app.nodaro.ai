import { SUNO_TRACK_SOURCE_TYPES } from "@nodaro/shared/models"
import { bypassTeleports, sunoSeparateSourceLane } from "@nodaro/render-rules"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * Suno chaining ids (#819).
 *
 * A Suno generation returns TWO tracks. The worker writes track #1's id to the
 * node-level `sunoTrackId` and every track's id to `output_data.sunoTracks[]`;
 * the node keeps one `GeneratedResult` per track and the user picks one with
 * the result switcher. A downstream Suno node (extend / replace / separate /
 * …) must chain off the track the user is LOOKING AT — the contract documented
 * on `GeneratedResult` — so:
 *
 *   - `sunoVariantFields` stamps each variant with its OWN id when results are
 *     built (poll, orchestrator, reconcile all go through it);
 *   - `readSunoIds` reads the active result first and the node-level fields
 *     only as the fallback (pre-#819 data carries nothing per result);
 *   - `findUpstreamSunoIds` walks the incoming edges the way both resolvers
 *     do (same source gate, same last-wins order), so the id the panel shows
 *     IS the id the run sends.
 */

export interface SunoIds {
  readonly trackId?: string
  readonly taskId?: string
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/**
 * Per-variant fields from a Suno job's `output_data`. A variant is matched to
 * its track by URL first (`sunoTracks[i].audioUrl` is the same R2 URL the
 * worker puts in `audioUrls`), by position as the fallback — a caller may have
 * filtered the URL list before indexing it. Undefined when the output carries
 * no per-track list: every variant then falls back to the shared
 * `extraFields`, as before.
 */
export function sunoVariantFields(
  output: Record<string, unknown> | null | undefined,
): ((index: number, url?: string) => Record<string, unknown> | undefined) | undefined {
  const tracks = output?.sunoTracks
  if (!Array.isArray(tracks)) return undefined
  const asTrack = (t: unknown): Record<string, unknown> | undefined =>
    t && typeof t === "object" ? (t as Record<string, unknown>) : undefined
  return (index, url) => {
    const byUrl = url ? tracks.map(asTrack).find((t) => t?.audioUrl === url) : undefined
    const track = byUrl ?? asTrack(tracks[index])
    const id = str(track?.id)
    return id ? { sunoTrackId: id } : undefined
  }
}

/** The ids a downstream Suno node chains off: the ACTIVE result first, then the node-level fields. */
export function readSunoIds(srcData: Record<string, unknown>): SunoIds {
  const results = srcData.generatedResults as ReadonlyArray<Record<string, unknown>> | undefined
  const activeIndex = typeof srcData.activeResultIndex === "number" ? srcData.activeResultIndex : 0
  const active = activeIndex >= 0 ? results?.[activeIndex] : undefined
  return {
    trackId: str(active?.sunoTrackId) ?? str(srcData.sunoTrackId),
    taskId: str(active?.sunoTaskId) ?? str(srcData.sunoTaskId),
  }
}

export interface UpstreamSunoIds extends SunoIds {
  readonly sourceId: string
  readonly sourceLabel?: string
}

/** The slice of a canvas node the upstream walk reads — `WorkflowNode` satisfies it. */
type SunoSourceNode = Pick<WorkflowNode, "id" | "data"> & { readonly type?: string }

/**
 * The ids the run hands this node, read the way BOTH resolvers read them:
 * every incoming edge in edge order, Suno-track sources only
 * (`SUNO_TRACK_SOURCE_TYPES`), a later source overriding an earlier one field
 * by field. Null when nothing upstream carries an id — the manual fields then
 * stand.
 */
export function findUpstreamSunoIds(
  nodeId: string | undefined,
  nodes: ReadonlyArray<SunoSourceNode>,
  edges: ReadonlyArray<Pick<WorkflowEdge, "source" | "target">> | undefined,
): UpstreamSunoIds | null {
  if (!nodeId || !edges) return null
  let found = null as UpstreamSunoIds | null
  // A Suno source sent through a Teleport pair is inherited as the run inherits
  // it (@nodaro/render-rules teleport-bypass.ts). Idempotent on carried edges.
  for (const edge of bypassTeleports(nodes, edges)) {
    if (edge.target !== nodeId) continue
    const src = nodes.find((n) => n.id === edge.source)
    if (!src || !SUNO_TRACK_SOURCE_TYPES.has(src.type ?? "")) continue
    const data = src.data as Record<string, unknown>
    const ids = readSunoIds(data)
    if (!ids.trackId && !ids.taskId) continue
    found = {
      trackId: ids.trackId ?? found?.trackId,
      taskId: ids.taskId ?? found?.taskId,
      sourceId: src.id,
      sourceLabel: str(data.label),
    }
  }
  return found
}

/** The source a Suno Separate run separates: a Suno track by its ids, or any other audio by its URL. */
export type SunoSeparateLane = "suno" | "upload"

/**
 * Which lane a Suno Separate run takes, by the rule execute-node and the
 * server apply (`sunoSeparateSourceLane`, @nodaro/render-rules): a task id (a
 * wired Suno source's, else the typed one) separates the Suno track;
 * otherwise a wired audio source separates by URL. A track id alone does not
 * make the Suno lane — the run then sends the audio URL. A wired Suno source
 * that has not run yet reads as the Suno lane: a workflow run runs it first
 * and it hands its ids on. Null when nothing is wired and no task id is typed.
 */
export function sunoSeparateLane(
  nodeId: string | undefined,
  nodes: ReadonlyArray<SunoSourceNode>,
  edges: ReadonlyArray<Pick<WorkflowEdge, "source" | "target">> | undefined,
  manualTaskId?: string,
): SunoSeparateLane | null {
  const upstream = findUpstreamSunoIds(nodeId, nodes, edges)
  let wired = false
  let pendingSunoSource = false
  if (nodeId && edges) {
    for (const edge of bypassTeleports(nodes, edges)) {
      if (edge.target !== nodeId) continue
      wired = true
      const src = nodes.find((n) => n.id === edge.source)
      if (!src || !SUNO_TRACK_SOURCE_TYPES.has(src.type ?? "")) continue
      const ids = readSunoIds(src.data as Record<string, unknown>)
      if (!ids.trackId && !ids.taskId) pendingSunoSource = true
    }
  }
  const lane = sunoSeparateSourceLane({ taskIds: [upstream?.taskId, manualTaskId], hasAudio: wired })
  if (lane === "suno" || pendingSunoSource) return "suno"
  return lane === "url" ? "upload" : null
}
