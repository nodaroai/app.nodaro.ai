/**
 * The credit id a run ESTIMATE quotes for a render node in its graph (C4): the
 * registry's own `creditId` (`RENDER_NODE_TYPES`, `@nodaro/shared`) given the
 * node's quality and output and — for a render priced in tiers — the tier its
 * graph tells. Both estimators (the editor's `getModelIdentifier` and the
 * server's run estimate / listing) read this, so a render node never needs a
 * literal branch of its own there.
 */
import { renderNodeOf, type SpeakerViewPriceTier } from "@nodaro/shared"
import type { EditPlanOutputReader, EstimateGraphEdge, EstimateGraphNode } from "./apply-edl-estimate.js"
import { resolveSpeakerViewEstimateTier } from "./speaker-view-pricing.js"

/** A node as either estimator holds it; one with no id has no place in its graph. */
type RenderEstimateNode = Omit<EstimateGraphNode, "id"> & { readonly id?: string }

type TierResolver = (
  node: RenderEstimateNode,
  nodes: readonly EstimateGraphNode[] | undefined,
  edges: readonly EstimateGraphEdge[] | undefined,
  rerunIds: ReadonlySet<string>,
  planOutputOf?: EditPlanOutputReader,
) => SpeakerViewPriceTier

/** The renders priced in tiers, and how an estimate reads a node's tier. A
 *  render missing here is priced by quality (and output) alone. */
const RENDER_PRICE_TIER_RESOLVERS: Readonly<Record<string, TierResolver>> = Object.freeze({
  "speaker-view": resolveSpeakerViewEstimateTier,
})

/** The render types an estimate reads a price tier for. */
export const TIER_PRICED_RENDER_TYPES: readonly string[] = Object.freeze(Object.keys(RENDER_PRICE_TIER_RESOLVERS))

/**
 * The credit id an estimate quotes for `node` — `undefined` for a node that is
 * not a render. `nodes`/`edges` undefined = the graph is not known: a tiered
 * render then quotes from its own data (its inline edit, else its settings).
 */
export function renderEstimateCreditId(
  node: RenderEstimateNode,
  nodes: readonly EstimateGraphNode[] | undefined,
  edges: readonly EstimateGraphEdge[] | undefined,
  rerunIds: ReadonlySet<string>,
  planOutputOf?: EditPlanOutputReader,
): string | undefined {
  const render = renderNodeOf(node.type)
  if (!render) return undefined
  const data = (node.data as Record<string, unknown> | undefined) ?? {}
  const resolver = Object.hasOwn(RENDER_PRICE_TIER_RESOLVERS, node.type as string) ? RENDER_PRICE_TIER_RESOLVERS[node.type as string] : undefined
  const priceTier = resolver?.(node, nodes, edges, rerunIds, planOutputOf)
  return render.creditId(data.quality, data.output, priceTier)
}
