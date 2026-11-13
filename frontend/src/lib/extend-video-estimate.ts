import { ltxExtendDurationSec } from "@nodaro/shared/credits"
import { canonicalVideoProvider } from "@nodaro/shared/models"
import { withWiredSettings } from "@nodaro/shared/nodes"
import { EXTEND_VIDEO_DEFAULT_PROVIDER, extendSourceEstimateSec, isSeedanceExtendPricedBySecondsSent, seedanceExtendPrice } from "@nodaro/render-rules"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * How many of its price row an Extend Video run is charged:
 * - LTX 2.3 Pro: the seconds it adds (its row, `ltx-2.3-pro-extend:per-second`,
 *   is per second — the same product the route and a workflow run reserve);
 * - Seedance 2.5: (seconds sent + seconds added) ÷ 2 of its resolution's
 *   two-second row (`seedanceExtendPrice`, the rule the route, the workflow
 *   run and the server's run estimate read): the source's last 10 s at the
 *   length the graph knows it (`extendSourceEstimateSec`: an upload's, a made
 *   generation's recorded length), the whole window while it does not — the
 *   run measures the source before it holds anything;
 * - every other provider: one.
 * A wired Settings node can set the model, the length and the resolution, so
 * they are read the way the run reads them.
 */
export function extendVideoPricingUnits(
  node: WorkflowNode,
  allNodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number {
  const data = (withWiredSettings(node, allNodes, edges).data ?? {}) as Record<string, unknown>
  if (data.provider === "ltx-2.3-pro") return ltxExtendDurationSec(data.duration)
  const provider = canonicalVideoProvider(typeof data.provider === "string" ? data.provider : EXTEND_VIDEO_DEFAULT_PROVIDER)
  if (isSeedanceExtendPricedBySecondsSent(provider)) {
    const sourceSec = extendSourceEstimateSec(node, allNodes, edges, rerunIds)
    return seedanceExtendPrice({ duration: data.duration, resolution: data.resolution, sourcePictureSec: sourceSec }).units
  }
  return 1
}
