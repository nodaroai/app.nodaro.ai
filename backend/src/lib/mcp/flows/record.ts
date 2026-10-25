import { randomUUID } from "node:crypto"
import { supabase } from "../../supabase.js"
import type { McpSession } from "../session.js"
import { mcpFlowsEnabled } from "../user-preferences.js"
import { workflowEditorUrl } from "../../deployment-urls.js"
import { flowNodeFor, type FlowNodeInput, type FlowNodeSpec, type FlowOutputKey } from "./node-mappers.js"
import { countSteps, resolveConversation, type McpConversationSettings } from "./conversation-store.js"
import { applyFlowDelta, loadFlow } from "./workflow-delta.js"
import { flowNodeId, inputsToCreate, placeFlowNode, relinkImported } from "./flow-graph.js"
import { importOutsideImages } from "./import-inputs.js"
import { hydrateFlowNodeForJob } from "./hydrate.js"

/**
 * An MCP conversation becomes a flow: each call a verb makes to a mapped
 * route (`node-mappers.ts`) adds a node to the conversation's workflow.
 *
 * A failure here never fails the generation. Everything is best-effort: a
 * call whose flow cannot be resolved is dispatched exactly as before, and a
 * node that cannot be written leaves the job where it always was (the
 * user's library and "Recent from MCP").
 */

/** Where a call's node will go, decided before the job is created. */
export interface PreparedFlowNode {
  readonly userId: string
  readonly workflowId: string
  readonly nodeId: string
  readonly spec: FlowNodeSpec
  readonly tool: string | undefined
  readonly client: string
  readonly clientName: string
  readonly userRequest: string | undefined
  /** The conversation was created for this call (so it is removed again if the call is refused). */
  readonly conversationIsNew: boolean
}

/** What `/mcp` writes into the node, for "Where it came from". */
export interface McpProvenance {
  readonly tool?: string
  /** The node-data field its result lands in (read when the job finishes). */
  readonly outputKey?: FlowOutputKey
  readonly client: string
  readonly clientName: string
  readonly userRequest?: string
  readonly jobId: string
  readonly at: string
}

type Log = (message: string, err?: unknown) => void

const defaultLog: Log = (message, err) => {
  console.warn(`[mcp-flows] ${message}`, err instanceof Error ? err.message : err ?? "")
}

/**
 * Resolve the conversation and mint the node id for a call to `route`, or
 * null when this call does not become a node (not an `/mcp` session, the
 * user turned flows off, or the node could not reproduce the call).
 */
export async function prepareFlowNode(
  session: McpSession,
  route: string,
  payload: unknown,
  log: Log = defaultLog,
): Promise<PreparedFlowNode | null> {
  const identity = session.conversation
  if (!identity) return null
  // Keyed by the tool too: only the tools that take `user_request` make nodes,
  // so a node always had the chance to carry the user's words.
  const spec = flowNodeFor(route, payload, session.currentTool)
  if (!spec) return null
  try {
    if (!(await mcpFlowsEnabled(session.userId))) return null
    const conversation = await resolveConversation(session, identity, new Date(), {
      firstRequest: session.userRequest,
      prompt: spec.prompt,
    }, session.flowRequest)
    return {
      userId: session.userId,
      workflowId: conversation.workflowId,
      nodeId: flowNodeId(conversation.workflowId, randomUUID().replace(/-/g, "").slice(0, 12)),
      spec,
      tool: session.currentTool,
      client: identity.client,
      clientName: session.clientName,
      userRequest: session.userRequest,
      conversationIsNew: conversation.isNew,
    }
  } catch (err) {
    log("could not resolve the conversation", err)
    return null
  }
}

/**
 * The field that ties the job to its node (`jobs.node_id`, read by every job
 * route through `extractNodeId`). Never `workflowId`: that column cascades,
 * so the job would be deleted with the conversation (see `flowNodeId`).
 */
export function flowJobFields(prepared: PreparedFlowNode | null): Record<string, string> {
  return prepared ? { nodeId: prepared.nodeId } : {}
}

/**
 * Write the node (running, holding the job) into the conversation, then
 * check the job: one that finished before the node existed is applied now,
 * because the completion hook found no node to fill.
 */
export async function commitFlowNode(prepared: PreparedFlowNode, jobId: string, log: Log = defaultLog): Promise<boolean> {
  try {
    const at = new Date().toISOString()
    const provenance: McpProvenance = {
      ...(prepared.tool ? { tool: prepared.tool } : {}),
      outputKey: prepared.spec.outputKey,
      client: prepared.client,
      clientName: prepared.clientName,
      ...(prepared.userRequest ? { userRequest: prepared.userRequest } : {}),
      jobId,
      at,
    }
    const data = {
      ...prepared.spec.data,
      executionStatus: "running",
      currentJobId: jobId,
      mcpProvenance: provenance,
    }
    // Inputs the flow does not send yet: they become upload nodes, showing the
    // link the call used. Outside ones are stored in the user's files after the
    // reply (`storeOutsideInputs`), so an import never holds up the answer.
    let created: FlowNodeInput[] = []
    const landed = await applyFlowDelta(prepared.workflowId, prepared.userId, (flow) => {
      // Decided again on every attempt: only the attempt that writes creates anything.
      created = []
      // A client retry with the same retry token gets the same job back: one node per job.
      if (flow.nodes.some((n) => ((n.data as Record<string, unknown> | undefined)?.mcpProvenance as McpProvenance | undefined)?.jobId === jobId)) {
        return null
      }
      created = inputsToCreate(flow.nodes, prepared.spec)
      const placed = placeFlowNode(flow.nodes, prepared.nodeId, prepared.spec, data)
      const conversation = flow.settings.mcpConversation as McpConversationSettings | undefined
      return {
        upsertNodes: placed.upsertNodes,
        upsertEdges: placed.upsertEdges,
        ...(conversation
          ? {
              settings: {
                mcpConversation: {
                  ...conversation,
                  lastActivityAt: at,
                  steps: countSteps(flow.nodes) + 1,
                  ...(!conversation.firstRequest && prepared.userRequest ? { firstRequest: prepared.userRequest } : {}),
                },
              },
            }
          : {}),
      }
    })
    if (!landed) {
      log(`could not write node ${prepared.nodeId} into workflow ${prepared.workflowId}`)
      return false
    }
    await hydrateFlowNodeForJob(jobId)
    if (created.length > 0) void storeOutsideInputs(prepared, created, log)
    return true
  } catch (err) {
    log("could not write the node", err)
    return false
  }
}

/**
 * Store the outside images a step's new upload nodes show in the user's
 * files, then point those nodes at the stored copies. Runs after the reply;
 * a failed import leaves the node on the link it was. Not awaited by the caller.
 */
export async function storeOutsideInputs(prepared: PreparedFlowNode, inputs: readonly FlowNodeInput[], log: Log = defaultLog): Promise<void> {
  try {
    const imported = await importOutsideImages(prepared.userId, inputs)
    if (imported.size === 0) return
    const landed = await applyFlowDelta(prepared.workflowId, prepared.userId, (flow) => {
      const relinked = relinkImported(flow.nodes, imported)
      return relinked.length > 0 ? { upsertNodes: relinked } : null
    })
    if (!landed) log(`could not point the upload nodes of ${prepared.nodeId} at their stored copies`)
  } catch (err) {
    log("could not store the outside images", err)
  }
}

/**
 * The call was refused (402, a validation error…): a conversation created for
 * it alone is removed again, so a refused first call leaves no empty flow. One
 * that holds a step stays. The check waits {@link ABANDON_DELAY_MS} first: a
 * call sent beside this one may have joined the conversation already and not
 * written its step yet. Not awaited by the caller.
 */
export async function abandonFlowNode(prepared: PreparedFlowNode, log: Log = defaultLog, delayMs: number = ABANDON_DELAY_MS): Promise<void> {
  if (!prepared.conversationIsNew) return
  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs).unref?.())
  try {
    const flow = await loadFlow(prepared.workflowId, prepared.userId)
    if (!flow || flow.nodes.length > 0) return
    // Only the version read: a step another call wrote in between keeps it.
    await supabase.from("workflows").delete().eq("id", prepared.workflowId).eq("user_id", prepared.userId).eq("version", flow.version)
  } catch (err) {
    log("could not remove an empty conversation", err)
  }
}

/** How long a refused call's new conversation is kept before it is checked for steps. */
export const ABANDON_DELAY_MS = 60_000

/** The line the assistant can quote: where the user sees this call as a node. */
export function flowLinkText(prepared: PreparedFlowNode): string {
  // The flow is the source of truth: the user may pick another result or change
  // a setting there, and the next step should build on that, not on memory.
  return (
    `This step was added to the conversation's flow in Nodaro — open it in the editor: ${workflowEditorUrl(prepared.workflowId)} (flow id ${prepared.workflowId}). ` +
    `If the user changed the flow there, read it with get_workflow_json before the next step and build on the result selected in each node.`
  )
}
