/**
 * Render final for agents (decided 2026-10-06): the SERVER derives what a
 * Render final runs, so an agent never assembles the set itself. One request
 * field, `renderFinal: { renderNodeId }`, on POST /v1/workflows/:id/run (the
 * SDK's `workflows.renderFinal` and MCP `render_final` send it), and its quote
 * (POST /v1/workflows/:id/render-final/estimate) read the saved graph through
 * the rule the editor's Render final runs — `renderFinalRunSet` and
 * `renderRunOverrides` from `@nodaro/render-rules` — so the two sets cannot
 * drift (parity: `routes/__tests__/render-final-run-set-parity.test.ts`).
 *
 * A Render final for an agent always CONTINUES an earlier execution
 * (`continueFromExecutionId`, A6.2): the nodes outside the set hand on what
 * that run produced. It sends nothing else: the server names the nodes and
 * the one override (the render at Final, for this run only).
 */
import { z } from "zod"
import { renderFinalRunSet, renderRunOverrides } from "@nodaro/render-rules"
import { PREVIEW_RENDER_NODE_TYPES, RENDER_FINAL_NODE_NOT_FOUND, RENDER_FINAL_NOT_A_RENDER, withRunOverrides } from "@nodaro/shared"
import { hasCredits } from "./config.js"
import type { BillingContext } from "./billing-context.js"

/** The request field: which render to finalize. */
export const renderFinalRequestSchema = z.object({ renderNodeId: z.string().min(1) }).strict()

/** What the run executes and the override it runs with. */
export interface RenderFinalRun {
  readonly renderNodeId: string
  /** The nodes the run executes, in canvas order. */
  readonly nodeIds: string[]
  /** `{ [renderNodeId]: { quality: "final" } }` — a one-shot override. */
  readonly inputOverrides: Record<string, Record<string, unknown>>
}

export interface RenderFinalRefusal {
  readonly status: 400
  readonly code: string
  readonly message: string
}

type GraphNode = { readonly id: string; readonly type?: string | null; readonly data?: unknown; readonly parentId?: string | null }
type GraphEdge = { readonly source: string; readonly target: string; readonly sourceHandle?: string | null; readonly targetHandle?: string | null; readonly data?: unknown }

const validation = (message: string): RenderFinalRefusal => ({ status: 400, code: "validation_error", message })

/**
 * Check a run body that carries `renderFinal`: it may not also name the nodes
 * or send overrides (the server derives both), and it continues an execution.
 * Returns the render's id, or the refusal. Pure.
 */
export function parseRenderFinalBody(body: Readonly<Record<string, unknown>>): { renderNodeId: string } | RenderFinalRefusal {
  const parsed = renderFinalRequestSchema.safeParse(body.renderFinal)
  if (!parsed.success) return validation("renderFinal must be { renderNodeId: <the render node's id> }")
  if (body.nodeIds !== undefined && body.nodeIds !== null) {
    return validation("renderFinal derives the nodes the run executes: do not send nodeIds with it")
  }
  if (body.inputOverrides !== undefined && body.inputOverrides !== null) {
    return validation("renderFinal sets the render to Final for this run: do not send inputOverrides with it")
  }
  if (body.continueFromExecutionId === undefined || body.continueFromExecutionId === null) {
    return validation("renderFinal continues an earlier execution: send continueFromExecutionId (the run that stopped at the preview)")
  }
  return { renderNodeId: parsed.data.renderNodeId }
}

/** The Render final of `renderNodeId` on the saved graph, or why it cannot run. Pure. */
export function deriveRenderFinalRun(
  renderNodeId: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): RenderFinalRun | RenderFinalRefusal {
  const render = nodes.find((n) => n.id === renderNodeId)
  if (!render) {
    return { status: 400, code: RENDER_FINAL_NODE_NOT_FOUND, message: `The workflow has no node "${renderNodeId}".` }
  }
  if (!PREVIEW_RENDER_NODE_TYPES.has(render.type ?? "")) {
    return {
      status: 400,
      code: RENDER_FINAL_NOT_A_RENDER,
      message: `Node "${renderNodeId}" is not a render: Render final runs an Apply EDL render.`,
    }
  }
  const set = renderFinalRunSet(renderNodeId, nodes, edges)
  return {
    renderNodeId,
    nodeIds: nodes.filter((n) => set.has(n.id)).map((n) => n.id),
    inputOverrides: renderRunOverrides(renderNodeId, "final", set),
  }
}

export function isRenderFinalRefusal(value: unknown): value is RenderFinalRefusal {
  return typeof value === "object" && value !== null && "code" in value && "status" in value
}

/** What a Render final will be charged, and whether its payer can cover it. */
export interface RenderFinalCredits {
  readonly estimatedCredits: number
  readonly sufficient: boolean
  /** What the payer can spend; `null` when it is not the caller's to see (a deployment payer) or not what pays (a workspace budget). */
  readonly available: number | null
  /** Why it cannot be covered; only when `sufficient` is false. */
  readonly message?: string
}

/**
 * The price of a Render final and the payer's verdict on it — ONE funnel for
 * the quote and the run, so the run is refused (402, before any execution row
 * exists) on exactly the figure the quote showed. Priced on the graph the run
 * executes: `overrides` is the merged map the orchestrator applies (the
 * earlier run's pin with the render's Final over it), and only the nodes the
 * run executes count. The verdict is balance-only (`checkRunSetCredits`);
 * model availability, daily caps and allowances stay with each node's own
 * preflight. `null` in an edition without credits.
 */
export async function renderFinalCredits(input: {
  readonly userId: string
  readonly nodes: readonly GraphNode[]
  readonly edges: readonly GraphEdge[]
  readonly runNodeIds: readonly string[]
  readonly overrides: Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined
  readonly surface: { readonly billingContext?: BillingContext; readonly webFreeMode?: boolean }
}): Promise<RenderFinalCredits | null> {
  if (!hasCredits()) return null
  const { estimateRunSetCredits, checkRunSetCredits } = await import("../ee/billing/credits.js")
  const priced = withRunOverrides(input.nodes as Array<GraphNode & { type?: string }>, input.overrides)
  const estimatedCredits = await estimateRunSetCredits(
    priced as unknown as Parameters<typeof estimateRunSetCredits>[0],
    input.edges as unknown as Parameters<typeof estimateRunSetCredits>[1],
    new Set(input.runNodeIds),
  )
  const check = await checkRunSetCredits(input.userId, estimatedCredits, {
    billingContext: input.surface.billingContext,
    webFreeMode: input.surface.webFreeMode ?? false,
  })
  return {
    estimatedCredits,
    sufficient: check.sufficient,
    available: check.available,
    ...(check.message !== undefined ? { message: check.message } : {}),
  }
}
