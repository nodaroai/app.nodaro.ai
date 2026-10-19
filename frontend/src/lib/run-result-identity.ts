/**
 * What a landed take carries on its RESULT besides its URL (A1b): its
 * thumbnail and, for a render, what the render stamped — `quality` ("proxy" is
 * a Preview), `clipKey` (the plan clip it cut), `planBasis` (the plan value it
 * cut), `renderBasis` (its own settings) and `duration` (the cut's length, what
 * a length-priced step after it is charged by). Every lane that lands a take
 * writes it — the single-node run, the browser fan-out, a server run (live and
 * at reopen) and the job restores — so the Preview label and the latest-batch
 * reader (@nodaro/shared savedRenderBatch) see the same take whichever lane
 * landed it. `__tests__/run-result-identity-sites.test.ts` holds every lane to it.
 *
 * Result fields only: a render's `quality` must never be written onto the node,
 * where `quality` is the node's own setting.
 */
import { isRenderNodeType, renderResultStamp, type RenderQuality, type RunResultRowStamp } from "@nodaro/shared/nodes"
import { isUseCaseNodeType, usecaseListsItsResult } from "@nodaro/render-rules"

export interface RunResultIdentity {
  readonly thumbnailUrl?: string
  readonly quality?: RenderQuality
  readonly clipKey?: string
  readonly planBasis?: string
  readonly renderBasis?: string
  /** A render's cut length (a use-case node's episode length), in seconds — what the step after it is charged by (`runForwardedVideoLengthSec`). */
  readonly duration?: number
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined)

/** The identity of a take landed from a job's `output_data` or a run's node output. */
export function runResultIdentity(nodeType: string | null | undefined, output: unknown): RunResultIdentity {
  const o = (output && typeof output === "object" ? output : {}) as Record<string, unknown>
  const thumbnailUrl = str(o.thumbnailUrl)
  const durationSec = typeof o.durationSec === "number" && Number.isFinite(o.durationSec) && o.durationSec > 0 ? o.durationSec : undefined
  return {
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    // Only a render's stamps are a render's — and a use-case node's (Tighten
    // Episode): its take is its render's, "proxy" while it waits on review,
    // stamped with that render's plan and settings bases.
    ...(isRenderNodeType(nodeType) || isUseCaseNodeType(nodeType) ? renderResultStamp(o) : {}),
    // A render records the length of its cut, a use-case node its episode's;
    // on the result row it is the length a Trim / Loop / Combine Videos after
    // it is charged by.
    ...((isRenderNodeType(nodeType) || isUseCaseNodeType(nodeType)) && durationSec !== undefined ? { duration: durationSec } : {}),
  }
}

/**
 * The identity of ROW `url` of a server run's fan-out, from the run's
 * row-aligned `listResultStamps` — its own job id with it. Pairing URLs with
 * `jobIds` by position mis-paired once a row failed, finished out of order or
 * was already held; a run that published no stamps (an older execution) gives
 * no job id, and the lane then keeps its synthetic one.
 */
export function runResultRowIdentity(
  nodeType: string | null | undefined,
  output: { readonly listResults?: readonly string[]; readonly listResultStamps?: readonly RunResultRowStamp[] } | null | undefined,
  url: string,
): RunResultIdentity & { readonly jobId?: string } {
  const row = output?.listResults?.indexOf(url) ?? -1
  const stamp = row >= 0 ? output?.listResultStamps?.[row] : undefined
  if (!stamp) return {}
  const jobId = str(stamp.jobId)
  return { ...(jobId ? { jobId } : {}), ...runResultIdentity(nodeType, stamp) }
}

/**
 * Whether a node's batch rows carry stamps (its rows' quality, clip and
 * bases, and each row's own job): a render, or a use-case node whose result
 * is a list (Trailer's formats, each naming the run's wrapper).
 */
export function carriesRowStamps(nodeType: string | null | undefined): boolean {
  return isRenderNodeType(nodeType) || usecaseListsItsResult(nodeType)
}
