/**
 * Reconcile a workflow's per-node `generatedResults` against the backend
 * `jobs.output_data` of record.
 *
 * Why this exists
 * ---------------
 * The normal path: user clicks Run → `pollJobWithNodeUpdate` polls the job →
 * on `status="completed"` it calls `handleJobCompleted` which reads
 * `output_data.{imageUrls|audioUrls}` and writes the full variant set to
 * `node.data.generatedResults`.
 *
 * The broken path (this fixes): the worker dies mid-poll → the row sits
 * `processing` → the user reloads the workflow → the frontend's `setInterval`
 * poll is dead → the backend's reconcile cron finalizes the row later with the
 * full `audioUrls` / `imageUrls` / `sunoTracks` → the frontend never sees the
 * completion. (Or: the frontend polled at a moment when `audioUrls` was
 * missing from `output_data`, wrote a single result, never re-checked.)
 *
 * What this does
 * --------------
 * On workflow load, for every node with `executionStatus === "completed"`
 * and at least one entry in `generatedResults` carrying a `jobId`:
 *   1. Refetch the job (stripping any `-v<n>` suffix from the variant jobId).
 *   2. Extract the canonical variant URL list from `output_data` (imageUrls,
 *      audioUrls, or sunoTracks[].audioUrl).
 *   3. If that list has MORE entries than what's saved in `generatedResults`,
 *      rebuild via `buildVariantResults` and write back.
 *
 * Best-effort: fetch failures are silently skipped (the node keeps its current
 * results). Idempotent: re-running over an up-to-date workflow is a no-op
 * because the length check shortcircuits.
 */

import { getJobStatusLean } from "./api"
import { isValidUuid } from "./uuid"
import { buildVariantResults } from "@/components/editor/workflow-editor/variant-results"
import type { WorkflowNode } from "@/types/nodes"
import type { GeneratedResult } from "@/types/nodes"

export interface NodeResultsUpdate {
  nodeId: string
  generatedResults: GeneratedResult[]
}

/**
 * Strip a `-v<n>` variant suffix from a job id. Variant ids are produced by
 * `variantJobId(base, i)` which appends `-v1`, `-v2`, ... (index 0 keeps the
 * base id unchanged). The reverse strip is regex-safe because base job ids are
 * UUIDs (no `-v\d+$` substring naturally).
 */
function stripVariantSuffix(jobId: string): string {
  return jobId.replace(/-v\d+$/, "")
}

/** Pull a string-array variant list out of `output_data`. */
function extractVariantUrls(output: Record<string, unknown> | null): string[] | null {
  if (!output) return null
  // Image: imageUrls (e.g., Grok 4-tile, GPT-Image n=4).
  const imgs = output.imageUrls
  if (Array.isArray(imgs)) {
    const filtered = imgs.filter((u): u is string => typeof u === "string" && u.length > 0)
    if (filtered.length > 0) return filtered
  }
  // Audio: audioUrls (Suno 2-track, etc).
  const auds = output.audioUrls
  if (Array.isArray(auds)) {
    const filtered = auds.filter((u): u is string => typeof u === "string" && u.length > 0)
    if (filtered.length > 0) return filtered
  }
  // Suno fallback: sunoTracks[].audioUrl. The shape is { id, title, duration,
  // imageUrl, audioUrl } per track — we only need audioUrl for the variant
  // list (it points at the same R2 keys as `audioUrls`).
  const suno = output.sunoTracks
  if (Array.isArray(suno)) {
    const urls = suno
      .map((t) => (t as { audioUrl?: unknown }).audioUrl)
      .filter((u): u is string => typeof u === "string" && u.length > 0)
    if (urls.length > 0) return urls
  }
  return null
}

/** Suno extra fields (sunoTrackId / sunoTaskId) get merged into each result so
 *  downstream Suno nodes can chain off the trackId / taskId. */
function extractExtraFields(
  nodeType: string | undefined,
  output: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!output) return {}
  if (nodeType && nodeType.startsWith("suno-")) {
    return {
      sunoTrackId: output.sunoTrackId,
      sunoTaskId: output.sunoTaskId,
    }
  }
  return {}
}

/**
 * For each node that needs reconciliation, compute the new `generatedResults`
 * array (or return null if it's already up-to-date). Returns the list of
 * updates so callers can apply them in their preferred way (updateNodeData
 * loop, batched setState, etc.).
 */
export async function computeReconciledNodeResults(
  nodes: readonly WorkflowNode[],
): Promise<NodeResultsUpdate[]> {
  const updates: NodeResultsUpdate[] = []

  // Sequential, not parallel — most workflows have <5 completed nodes and
  // parallel fans-out can stampede the API. Cheap and predictable.
  for (const node of nodes) {
    const data = node.data as Record<string, unknown> | undefined
    if (!data) continue
    if (data.executionStatus !== "completed") continue

    const gr = data.generatedResults as ReadonlyArray<GeneratedResult> | undefined
    if (!gr || gr.length === 0) continue

    const firstJobId = gr[0]?.jobId
    if (typeof firstJobId !== "string" || firstJobId.length === 0) continue

    const baseJobId = stripVariantSuffix(firstJobId)

    // Only real backend jobs (UUIDs) can be polled. Synthetic local ids —
    // `exec-<nodeId>` (orchestrator/SSE results that never got a job UUID) and
    // `upload-url-<ts>` (pasted external URLs) — would 404 on every workflow
    // load (the "404 storm"). Skip them. `syncNodeResultsFromDB` guards the
    // same way (shared `isValidUuid`).
    if (!isValidUuid(baseJobId)) continue

    let job: Awaited<ReturnType<typeof getJobStatusLean>>
    try {
      job = await getJobStatusLean(baseJobId)
    } catch {
      continue
    }
    if (job.status !== "completed") continue

    const output = (job.output_data ?? null) as Record<string, unknown> | null
    const variantUrls = extractVariantUrls(output)
    if (!variantUrls || variantUrls.length <= gr.length) continue

    // The node has fewer results than the backend says there are. Rebuild
    // the full variant list. `buildVariantResults` uses `variantJobId(base, i)`
    // internally so the new ids line up with the worker's R2 keys.
    const extraFields = extractExtraFields(node.type, output)
    const thumbnailUrl = typeof output?.thumbnailUrl === "string" ? output.thumbnailUrl : undefined

    const rebuilt = buildVariantResults(variantUrls, baseJobId, { thumbnailUrl, extraFields })
    updates.push({ nodeId: node.id, generatedResults: rebuilt })
  }

  return updates
}

/**
 * One-shot apply helper. Called by the workflow load path. Fetches reconciled
 * updates and writes them via `updateNodeData`. Errors are swallowed (best-
 * effort recovery — the workflow shouldn't fail to load just because one job
 * lookup hiccuped).
 */
export async function reconcileWorkflowNodeResults(
  nodes: readonly WorkflowNode[],
  updateNodeData: (nodeId: string, updates: Record<string, unknown>) => void,
): Promise<void> {
  try {
    const updates = await computeReconciledNodeResults(nodes)
    for (const u of updates) {
      updateNodeData(u.nodeId, {
        generatedResults: u.generatedResults,
        // Keep activeResultIndex at 0 — the primary URL doesn't change.
        activeResultIndex: 0,
      })
    }
  } catch {
    // Whole-batch failure — keep the workflow loaded, log to devtools so the
    // operator notices.
    console.warn("[reconcile-node-results] reconcile batch failed; node generatedResults may be stale until next run")
  }
}
