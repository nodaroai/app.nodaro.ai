/** Shared shape every native copilot tool is handed. */
import type { FastifyInstance } from "fastify"
import type { SurfaceTools } from "../surfaces.js"
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

/**
 * A proposal the person confirms in the studio editor.
 *
 * The studio surface writes nothing and spends nothing on its own: every tool
 * that would change the production, publish it, import into it, copy it,
 * export it or cost credits is intercepted at dispatch and comes back as one
 * of these. The turn ends here — exactly as a run proposal ends a canvas turn
 * — and the person's decision arrives as their next message.
 *
 * `kind` is the discriminant a reader uses to tell the two proposal shapes
 * apart (`"kind" in proposal`), because a run proposal deliberately has none.
 */
export type ActionProposalKind = "edit" | "run" | "export" | "publish" | "import" | "clone"

/**
 * One operation of a previewed batch, as `POST /v1/studio/productions/:id/ops`
 * describes it when it is asked for a preview instead of a write.
 *
 * `class` is the document's own vocabulary — `S` changes, `D` deletes, `P`
 * changes who can reach the work, `$` spends — and `restorable` is present
 * only when THIS operation put something in the bin. Neither is re-derived
 * here: a copilot that classified operations by name would carry a second
 * copy of a vocabulary that grows without it.
 */
export interface StudioOpsDryRunReceipt {
  readonly op: string
  readonly summary: string
  readonly ids?: string[]
  readonly impact?: { keyframeIds: string[]; shotIds: string[] }
  readonly class: "S" | "D" | "P" | "$"
  readonly restorable?: true
}

/** A previewed change to the production: what it would do, at which version. */
export interface EditPreview {
  readonly version: number
  readonly receipts: StudioOpsDryRunReceipt[]
  readonly warnings: string[]
}

/** What a generation would cost, taken without spending. `credits: null` = the model is unpriced. */
export interface RunPreview {
  readonly provider: string
  readonly count: number
  readonly credits: number | null
  readonly lane?: string
  readonly linkedQuote?: Record<string, unknown>
}

/** The ordered steps an export would run, each with its own price. */
export interface ExportPreview {
  readonly steps: { id: string; node: string; label: string; credits: number | null }[]
  /** Total credits, or `null` when any step is unpriced — a partial sum understates. */
  readonly estimate: number | null
  readonly unpriced: string[]
  readonly resultStepId: string | null
  readonly canExport: boolean
}

/** A supplied plan, checked for free before it is offered. */
export interface ImportPreview {
  readonly valid: boolean
  readonly summary: unknown
  readonly warnings: string[]
}

export interface ActionProposal {
  readonly id: string
  readonly kind: ActionProposalKind
  /** The tool the model called — what the person confirms is what it asked for. */
  readonly tool: string
  /** The model's own arguments, with everything the surface computes removed. */
  readonly args: Record<string, unknown>
  readonly preview: EditPreview | RunPreview | ExportPreview | ImportPreview | null
  /**
   * Whether every delete in this proposal can be taken back.
   *
   * Read off the preview per operation, never asserted in prose: a batch is
   * restorable only when each of its deletes named the bin entry it made.
   */
  readonly restorable: boolean
  /** Whether the whole batch only changes the document, and is small enough to read at a glance. */
  readonly safe: boolean
  readonly note: string | null
}

/**
 * What the studio branch of the dispatcher carries for the length of ONE turn.
 *
 * All three fields are per-turn state a tool call may read and move, which is
 * why they live on the turn's own dependencies rather than in a module: two
 * concurrent turns share nothing.
 */
export interface StudioTurnState {
  /**
   * What list time learned and the definitions no longer say: which tools
   * carry a confirmation mark, and which of the spending ones can be priced
   * without spending. Captured before `_meta` is dropped; never re-derived
   * from a name.
   */
  readonly tools: Pick<SurfaceTools, "confirmClasses" | "quotable">
  /**
   * Whether this assistant message already proposed something. One card per
   * message: the loop keeps the LAST proposal of a message, so a second one
   * would silently replace the offer the person is about to read.
   */
  proposed: boolean
  /**
   * Set once a preview of a document change turns out to be unavailable.
   * Nothing was sent when that happens, and nothing may be sent for the rest
   * of the turn — a second document write is refused without a call.
   */
  previewUnavailable: boolean
  /** Memo of the served schema check behind `previewUnavailable`; read once per turn. */
  previewOffered?: boolean
}
