/**
 * The row stamps of the browser's own fan-out batch, row-aligned with its
 * `__listResults` — the editor's twin of the server's `assembleFanOutResult`
 * stamps (`listResultStamps`), written to the node as `__listResultStamps`.
 *
 * A landed row carries what its take landed with (`runResultIdentity`: its
 * thumbnail and, for a render, `quality`, `clipKey`, `planBasis` and
 * `renderBasis`) and its real job id. EVERY row of a render's batch also says
 * what it was sent for (`rowSent`, `browserRenderRowSentStamps`: the run's
 * quality and the row's clip), a failed or cancelled row too, so a reader
 * matches the batch's rows (one per run, not one per plan clip) to clips by
 * key, never by position (decided 2026-10-06). A landed take's own stamp wins.
 * A row that never ran (`cancelledRows`: a Stop, or the fail-fast after another
 * row failed) is marked `cancelled`, so it never reads as a failed render.
 */
import type { RunResultRowStamp } from "@nodaro/shared"
import { runResultIdentity } from "@/lib/run-result-identity"

/** A landed take as the poll lane wrote it on the node's results. */
export type LandedTake = object & { readonly jobId?: unknown }

export function fanOutRowStamps(
  nodeType: string | null | undefined,
  results: readonly string[],
  landed: ReadonlyMap<string, LandedTake>,
  rowSent?: ReadonlyArray<RunResultRowStamp | undefined>,
  cancelledRows: ReadonlySet<number> = new Set(),
): RunResultRowStamp[] {
  return results.map((url, i) => {
    const take = url ? landed.get(url) : undefined
    const jobId = typeof take?.jobId === "string" && take.jobId.length > 0 ? take.jobId : undefined
    return {
      ...rowSent?.[i],
      ...(jobId ? { jobId } : {}),
      ...(take ? runResultIdentity(nodeType, take) : {}),
      ...(!url && rowSent && cancelledRows.has(i) ? { cancelled: true as const } : {}),
    }
  })
}
