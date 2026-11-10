/**
 * A node the server creates starts on a model the deployment offers (decided
 * 2026-11-10): the editor's new-node rule (`@nodaro/render-rules`
 * `node-model-levers.ts`, over the same menu rows in the same order) applied
 * where the server writes a node — MCP workflow writes, Copilot edits, template
 * instantiation, the API's workflow writes and the paths that build a node from
 * its defaults. Every server path that writes a workflow's nodes calls this, or
 * is listed with its reason in `__tests__/new-node-models-paths.test.ts`.
 *
 *  - Only where the deployment RESTRICTS models (`modelRestrictionConfigured`):
 *    elsewhere the nodes are returned as they came, the very same array.
 *  - Only a node NEW to the stored graph (its id is not among `storedIds`): a
 *    saved node keeps its model.
 *  - Only a lever whose model the node does not name — it would run its
 *    default. A model the writer named is kept (and refused at run when it is
 *    withheld), as a saved node keeps its model.
 *  - The first offered row the USER can run: one the account's free-credit
 *    video limits lock is skipped; when every offered row is locked, the first
 *    offered row, as in the editor. A menu that offers nothing keeps the
 *    default.
 */
import { freeVideoModelLock, nodeModelLevers, planNodeModels, type FreeVideoLimits, type NodeModelJudge } from "@nodaro/render-rules"
import type { BillingContext } from "./billing-context.js"
import { hasCredits } from "./config.js"
import { isModelDenied, modelRestrictionConfigured } from "./surface-deny.js"

/** One model the rule moved: the node, the lever's field, the withheld default and the row it now holds. */
export interface ServerNodeModelMove {
  readonly nodeId: string
  readonly type: string
  readonly field: string
  readonly from: string
  readonly to: string
}

interface NodeLike {
  readonly id?: unknown
  readonly type?: unknown
  readonly data?: unknown
}

export interface ServerNodeModelsOptions {
  /** Who the nodes are created for: whose free-credit video limits apply. */
  readonly userId: string | null | undefined
  /**
   * The ids of the graph as stored before this write (none: every node is new),
   * or a reader of them — called only when some node would move, so a write
   * that moves nothing reads nothing more.
   */
  readonly storedIds?: Iterable<string> | (() => Promise<Iterable<string>>) | null
  /** The request's billing context (a workspace payer is not on free credits). */
  readonly billingContext?: BillingContext
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v)

/** The free-credit video limits of `userId`, when they apply (Cloud only). */
async function freeVideoLimitsOf(userId: string | null | undefined, billingContext: BillingContext | undefined): Promise<FreeVideoLimits | null> {
  if (!userId || !hasCredits()) return null
  try {
    const { freeVideoLimitsFor } = await import("../ee/lib/free-video-limits-for.js")
    return await freeVideoLimitsFor(userId, billingContext)
  } catch (err) {
    // The locks only order the choice: without them the first offered row is taken, as before.
    console.error("[new-node-models] free-credit video limits could not be read; no row is skipped:", (err as Error).message)
    return null
  }
}

function judgeOf(limits: FreeVideoLimits | null): NodeModelJudge {
  return {
    restricted: true,
    withheld: isModelDenied,
    ...(limits ? { locked: (model: string) => freeVideoModelLock(model, limits) !== null } : {}),
  }
}

/** The node ids a stored workflow's graph holds (for `storedIds`); none when it cannot be read. */
export function storedWorkflowNodeIds(read: () => PromiseLike<{ data: unknown; error: unknown }>): () => Promise<string[]> {
  return async () => {
    const { data, error } = await read()
    if (error) throw new Error("the stored graph could not be read")
    const nodes = isRecord(data) && Array.isArray(data.nodes) ? data.nodes : []
    return nodes.flatMap((n) => (isRecord(n) && typeof n.id === "string" ? [n.id] : []))
  }
}

/**
 * `nodes` with every new node on models the deployment offers, and what moved.
 * The very same array (and nothing moved) where nothing is restricted or
 * nothing a new node runs by default is withheld.
 */
export async function withOfferedServerNodeModels<N extends NodeLike>(
  nodes: readonly N[],
  opts: ServerNodeModelsOptions,
): Promise<{ nodes: readonly N[]; moved: readonly ServerNodeModelMove[] }> {
  if (!modelRestrictionConfigured() || nodes.length === 0) return { nodes, moved: [] }
  const candidates = nodes.flatMap((node, index) => {
    if (typeof node.type !== "string" || !isRecord(node.data)) return []
    const levers = nodeModelLevers(node.type)
    return levers.length > 0 ? [{ index, node, type: node.type, data: node.data, levers }] : []
  })
  if (candidates.length === 0) return { nodes, moved: [] }
  // Would anything move at all? Only then is the stored graph, and the account's locks, read.
  const unlocked = judgeOf(null)
  const wouldMove = candidates.filter((c) => planNodeModels(c.levers, c.data, unlocked, { onlyUnnamed: true }).moved.length > 0)
  if (wouldMove.length === 0) return { nodes, moved: [] }
  let storedIds: Iterable<string>
  try {
    storedIds = typeof opts.storedIds === "function" ? await opts.storedIds() : (opts.storedIds ?? [])
  } catch (err) {
    // Which nodes are new cannot be told: none is moved (the write goes on as it came).
    console.error("[new-node-models] the stored graph could not be read; no node is moved:", (err as Error).message)
    return { nodes, moved: [] }
  }
  const stored = new Set(storedIds)
  const moving = wouldMove.filter((c) => !(typeof c.node.id === "string" && stored.has(c.node.id)))
  if (moving.length === 0) return { nodes, moved: [] }
  const judge = judgeOf(await freeVideoLimitsOf(opts.userId, opts.billingContext))
  const next = [...nodes]
  const moved: ServerNodeModelMove[] = []
  for (const c of moving) {
    const plan = planNodeModels(c.levers, c.data, judge, { onlyUnnamed: true })
    if (plan.moved.length === 0) continue
    next[c.index] = { ...c.node, data: plan.data }
    const nodeId = typeof c.node.id === "string" ? c.node.id : String(c.index)
    for (const m of plan.moved) moved.push({ nodeId, type: c.type, ...m })
  }
  return moved.length > 0 ? { nodes: next, moved } : { nodes, moved: [] }
}

/** One line per move, for an MCP or Copilot answer: what the server changed and why. */
export function describeServerNodeModelMoves(moved: readonly ServerNodeModelMove[]): string | undefined {
  if (moved.length === 0) return undefined
  const lines = moved.map((m) => `node ${m.nodeId} (${m.type}): ${m.field} "${m.to}" — its default "${m.from}" is not offered on this deployment`)
  return `Started ${moved.length === 1 ? "a new node" : "new nodes"} on an offered model:\n${lines.join("\n")}`
}
