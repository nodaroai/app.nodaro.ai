/**
 * Which plan a Render Video node is about to render — and therefore which
 * price it is about to pay.
 *
 * A 3D scene render is priced by FRAME SIZE (`@nodaro/shared`
 * `renderVideoCreditId`), and the frame lives in the PLAN, not on the render
 * node. The plan reaches the node one of two ways: written into its own data
 * (an imported workflow, an MCP write, a template), or produced by an upstream
 * composer at run time. Both estimating surfaces have to look in both places,
 * or the canvas quotes the base price for a render it is about to charge 2.5x
 * for.
 *
 * The precedence is the ORCHESTRATOR's (`payload-builder.ts`: own data first,
 * then upstream via `COMPOSER_PLAN_MAP`), because that is the lane whose
 * answer becomes the charge.
 *
 * This is display arithmetic. It never decides what is billed: the route
 * re-resolves the identifier from the request body it is actually running.
 */
import { COMPOSER_PLAN_MAP, renderVideoCreditId } from "@nodaro/shared"

type PlanNode = { id?: string; type?: string; data?: Record<string, unknown> }
type PlanEdge = { source: string; target: string }

export interface ResolvedRenderPlan {
  planType?: string
  plan?: Record<string, unknown>
}

/** The plan the node carries, or the one its upstream composer holds. */
export function resolveRenderVideoPlan(
  node: PlanNode,
  nodes?: ReadonlyArray<PlanNode>,
  edges?: ReadonlyArray<PlanEdge>,
): ResolvedRenderPlan {
  const data = node.data ?? {}
  const ownPlan = data.plan as Record<string, unknown> | undefined
  if (ownPlan && typeof ownPlan === "object") {
    return {
      // A plan that declares its own planType wins, exactly as it does on both
      // execution engines — a composer can emit a different renderer's plan.
      planType: (ownPlan.planType as string | undefined) ?? (data.planType as string | undefined),
      plan: ownPlan,
    }
  }
  if (!nodes || !edges || !node.id) return {}
  for (const edge of edges) {
    if (edge.target !== node.id) continue
    const source = nodes.find((n) => n.id === edge.source)
    const mapping = source?.type ? COMPOSER_PLAN_MAP[source.type] : undefined
    if (!source || !mapping) continue
    const upstream = source.data?.[mapping.planField] as Record<string, unknown> | undefined
    if (upstream && typeof upstream === "object") {
      return { planType: (upstream.planType as string | undefined) ?? mapping.planType, plan: upstream }
    }
  }
  return {}
}

/** The `model_pricing` row a Render Video node should be quoted against. */
export function renderVideoCreditIdForNode(
  node: PlanNode,
  nodes?: ReadonlyArray<PlanNode>,
  edges?: ReadonlyArray<PlanEdge>,
): string {
  return renderVideoCreditId(resolveRenderVideoPlan(node, nodes, edges))
}
