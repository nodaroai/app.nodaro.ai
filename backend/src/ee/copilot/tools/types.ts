/** Shared shape every native copilot tool is handed. */
import type { FastifyInstance } from "fastify"
import type { WiredAsset } from "./edit-workflow.js"

export interface CopilotToolContext {
  readonly userId: string
  /**
   * Whether this THREAD may author social-publishing nodes — the user's own
   * per-conversation choice, never a default and never global. It lifts the
   * publishers only; a webhook or a scraper names its own destination and no
   * toggle reaches those.
   */
  readonly allowPublishing: boolean
  /**
   * Links the user pasted in this thread's own messages (see history.ts
   * `extractUserLinks`) — the ONLY URLs `edit_workflow` may write into a
   * `*Url` field, byte for byte.
   */
  readonly userLinks: ReadonlySet<string>
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
  /**
   * Files this turn wired onto a node, NAMED.
   *
   * Approving a run is the moment the user agrees to spend credits on this
   * graph, and a file they cannot see was wired in is a thing they did not
   * actually approve. "1 file attached" would not do it — which file.
   */
  wiredAssets: WiredAsset[]
  readonly addedNodeTypes: string[]
  readonly note?: string
}
