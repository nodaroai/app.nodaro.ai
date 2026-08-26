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
/**
 * A proposal to run ONE node instead of the whole graph.
 *
 * All three fields are the same guard from different angles: the card must
 * run the node the copilot MEANT, and a proposal outlives the graph it was
 * made against. `edit_workflow` can change an existing node's type, and a
 * user can edit or delete a node between the proposal and the click — so the
 * client re-reads the live graph and refuses unless the version is untouched
 * AND the node still has the type the copilot saw. Without the type check, an
 * old card could run a node that is no longer the one it names.
 */
export interface RunProposalNode {
  readonly id: string
  readonly type: string
  /** The workflow version the graph was at when this was proposed. */
  readonly graphVersion: number
  /** What the user calls it, for the card. */
  readonly label: string
}

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
  /** Present when the copilot proposed ONE node rather than the whole graph. */
  readonly node?: RunProposalNode
}
