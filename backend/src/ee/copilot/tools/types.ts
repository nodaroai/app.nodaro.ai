/** Shared shape every native copilot tool is handed. */
import type { FastifyInstance } from "fastify"

export interface CopilotToolContext {
  readonly userId: string
  readonly workflowId: string
  readonly projectId: string
  readonly threadId: string
  readonly turnId: string
  readonly fastify: FastifyInstance
  /** Emit an SSE side-effect event (workflow_updated, run_proposed, …). */
  readonly emit: (event: { type: string; data: Record<string, unknown> }) => void
}

/**
 * What a run proposal records for the client. Never executed server-side, and
 * deliberately carries NO per-node overrides — those would be a write path
 * around `edit_workflow`'s guards.
 */
export interface RunProposal {
  readonly addedNodeTypes: string[]
  readonly note?: string
}
