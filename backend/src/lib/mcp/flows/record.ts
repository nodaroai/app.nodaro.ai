import { randomUUID } from "node:crypto"
import type { McpSession } from "../session.js"
import { mcpFlowsEnabled } from "../user-preferences.js"
import { workflowEditorUrl } from "../../deployment-urls.js"
import { flowNodeFor, type FlowNodeSpec } from "./node-mappers.js"
import { resolveConversation, type McpConversationSettings } from "./conversation-store.js"
import { applyFlowDelta } from "./workflow-delta.js"
import { flowNodeId, placeFlowNode } from "./flow-graph.js"
import { hydrateFlowNodeForJob } from "./hydrate.js"
import { USER_REQUEST_TOOLS } from "./user-request.js"

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
}

/** What `/mcp` writes into the node, for "Where it came from". */
export interface McpProvenance {
  readonly tool?: string
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
  // Only the tools that take `user_request` make nodes, so a node always had the
  // chance to carry the user's words (one list, user-request.ts).
  if (!session.currentTool || !USER_REQUEST_TOOLS.has(session.currentTool)) return null
  const spec = flowNodeFor(route, payload)
  if (!spec) return null
  try {
    if (!(await mcpFlowsEnabled(session.userId))) return null
    const conversation = await resolveConversation(session, identity, new Date(), {
      firstRequest: session.userRequest,
      prompt: spec.prompt,
    })
    return {
      userId: session.userId,
      workflowId: conversation.workflowId,
      nodeId: flowNodeId(conversation.workflowId, randomUUID().replace(/-/g, "").slice(0, 12)),
      spec,
      tool: session.currentTool,
      client: identity.client,
      clientName: session.clientName,
      userRequest: session.userRequest,
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
    const landed = await applyFlowDelta(prepared.workflowId, prepared.userId, (flow) => {
      // A client retry with the same retry token gets the same job back: one node per job.
      if (flow.nodes.some((n) => ((n.data as Record<string, unknown> | undefined)?.mcpProvenance as McpProvenance | undefined)?.jobId === jobId)) {
        return null
      }
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
    return true
  } catch (err) {
    log("could not write the node", err)
    return false
  }
}

/** The line the assistant can quote: where the user sees this call as a node. */
export function flowLinkText(prepared: PreparedFlowNode): string {
  return `This step was added to the conversation's flow in Nodaro — open it in the editor: ${workflowEditorUrl(prepared.workflowId)} (flow id ${prepared.workflowId}).`
}
