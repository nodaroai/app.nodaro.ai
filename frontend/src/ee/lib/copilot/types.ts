/**
 * Wire types for the Workflow Copilot.
 *
 * The SSE union mirrors `backend/src/ee/routes/copilot.ts` + `turn-runner.ts`
 * VERBATIM and is deliberately NOT the shared `StreamEvent` from
 * `@/lib/sse-client`: the copilot's `token` carries `{ text }` while the shared
 * union's `token` carries a bare string. Widening the shared union to fit would
 * make every other consumer's `event.data` a union it does not want, so the
 * copilot passes this type as `streamRequest`'s generic instead.
 */
import { ENTITY_NODE_KINDS, type EntityNodeKind } from "@nodaro/shared"

export type CopilotRunMode = "ask" | "auto"

/** The thread's model ladder rung — mirrors the backend enum verbatim. */
export type CopilotModelTier = "economy" | "standard" | "premium"

export interface CopilotThread {
  id: string
  workflowId: string
  runMode: CopilotRunMode
  /**
   * This conversation may build nodes that post to the user's connected
   * accounts. Off unless they say otherwise, and optional so a thread from a
   * server that predates the column reads as off rather than undefined.
   */
  allowPublishing?: boolean
  /** The model ladder rung. Absent from a server that predates it — standard. */
  modelTier?: CopilotModelTier
  autoRunLimitCredits: number
  userTurnCount: number
  lastMessageAt: string | null
  createdAt: string
  /** Only present on GET /threads/:id — derived from a live turn's heartbeat. */
  status?: "running" | "idle"
  activeTurnId?: string | null
}

export type DisplayPart =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; name: string; label: string; status: "finished" | "failed" }

export interface DisplayMessage {
  id: string
  seq: number
  turnId: string
  role: "user" | "assistant"
  createdAt: string
  parts: DisplayPart[]
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

export interface CopilotToolCallEvent {
  id: string
  name: string
  label: string
  status: "started" | "finished" | "failed"
  summary?: string
}

export interface CopilotWorkflowUpdate {
  workflowId: string
  version: number
  updatedAt?: string
  note?: string | null
  addedNodeIds: string[]
  updatedNodeIds: string[]
  removedNodeIds: string[]
  addedNodeTypes: string[]
  nodeCount: number
  edgeCount: number
  adjustments: string[]
}

/** A file this turn wired onto a node. Named on the run card, never counted. */
export interface CopilotWiredAsset {
  id: string
  kind: MediaMentionKind
  filename: string
  nodeId: string
}

/** Mirrors the backend's `RunProposalNode` verbatim. */
export interface CopilotRunProposalNode {
  id: string
  type: string
  graphVersion: number
  label: string
}

/**
 * A workflow the copilot created — a DIFFERENT one from the open canvas.
 *
 * Its own event rather than a `workflow_updated` with a foreign id: the two
 * mean opposite things to this panel. An update says "reconcile the canvas";
 * this says "something new exists elsewhere, here is the way to it".
 */
export interface CopilotWorkflowCreated {
  workflowId: string
  name: string
  projectId: string
}

export interface CopilotRunProposal {
  workflowId: string
  addedNodeTypes: string[]
  /**
   * Files the copilot attached while building this graph.
   *
   * On the card because approving a run is the moment the user agrees to spend
   * credits on THIS graph — and a file they cannot see was wired in is a thing
   * they did not actually approve.
   */
  wiredAssets?: CopilotWiredAsset[]
  note: string | null
  /** Present when the copilot proposed ONE node rather than the whole graph. */
  node?: CopilotRunProposalNode | null
}

/**
 * One memory the copilot saved THIS turn. Visibility is the consent control:
 * every save renders a pinned line with a one-tap undo, so there is no such
 * thing as a silent write into what the copilot remembers.
 */
export interface CopilotMemorySave {
  id: string
  content: string
}

export type CopilotStreamEvent =
  | {
      type: "metadata"
      data: {
        threadId: string
        turnId: string
        jobId: string
        model: string
        baseVersion: number | null
        runMode: CopilotRunMode
        autoRunLimitCredits: number
        /** Absent from a server that predates it — reads as "leave it alone". */
        allowPublishing?: boolean
        modelTier?: CopilotModelTier
      }
    }
  | { type: "token"; data: { text: string } }
  | { type: "tool_call"; data: CopilotToolCallEvent }
  | { type: "workflow_updated"; data: CopilotWorkflowUpdate }
  | { type: "workflow_created"; data: CopilotWorkflowCreated }
  | { type: "run_proposed"; data: CopilotRunProposal }
  | { type: "memory_saved"; data: CopilotMemorySave }
  | {
      type: "usage"
      data: { inputTokens: number; outputTokens: number; cacheReadTokens: number; creditsCharged: number | null }
    }
  | {
      type: "done"
      data: {
        turnId: string
        messageId: string | null
        status: "completed" | "capped" | "cancelled"
        finalVersion: number | null
      }
    }
  | { type: "error"; data: { code: string; message: string } }

// ---------------------------------------------------------------------------
// Panel state
// ---------------------------------------------------------------------------

/** One activity row under the assistant's prose. */
export interface CopilotActivity {
  id: string
  label: string
  note: string
  status: "started" | "finished" | "failed"
}

export type CopilotRunPhase = "idle" | "proposed" | "running" | "succeeded" | "failed"

export interface CopilotTurnState {
  /** null until the first `metadata` event. */
  turnId: string | null
  status: "idle" | "streaming" | "completed" | "capped" | "cancelled" | "failed"
  /** The message the user sent — echoed locally so the bubble appears instantly. */
  userText: string
  /**
   * When the turn was started, client-side, for the live timer.
   *
   * Not the server's clock: this counts from the moment the user pressed send,
   * which includes the save flush and the thread handshake — the part of the
   * wait that has no other visible signal, and the part that made people think
   * the panel had hung.
   */
  startedAt: number | null
  /** Streamed assistant prose. */
  text: string
  activities: CopilotActivity[]
  update: CopilotWorkflowUpdate | null
  proposal: CopilotRunProposal | null
  /** Memories saved this turn — each renders as a pinned line with undo. */
  memorySaves: CopilotMemorySave[]
  /** Workflows created this turn — each renders as a link out to it. */
  createdWorkflows: CopilotWorkflowCreated[]
  creditsCharged: number | null
  error: { code: string; message: string } | null
}

export const EMPTY_TURN: CopilotTurnState = {
  turnId: null,
  status: "idle",
  userText: "",
  startedAt: null,
  text: "",
  activities: [],
  update: null,
  proposal: null,
  memorySaves: [],
  createdWorkflows: [],
  creditsCharged: null,
  error: null,
}

/** A picked entity in the composer. Wire form is plain text (`@Name`) — see `mentions.ts`. */
/**
 * The entity kinds a mention can carry, in the order the picker lists them.
 *
 * Same list the canvas and the run-time hydrator use, deliberately: `@` reaching
 * fewer kinds than the library holds is exactly how this surface sat at two
 * while there were four. Every per-kind table is a `Record<MentionKind, …>`, so
 * a fifth kind is a compiler error in each place that must handle it — and the
 * picker groups by kind rather than taking a prop per kind.
 */
/**
 * Files, as opposed to saved entities.
 *
 * A different family with a different destination: an entity id goes on the
 * entity node that owns it, a file id goes into `assetId` on an upload node and
 * the server fills in the rest. Same journey to the model — a name and an id,
 * never an address.
 */
export const MEDIA_MENTION_KINDS = ["image", "video", "audio"] as const

export type MediaMentionKind = (typeof MEDIA_MENTION_KINDS)[number]

export const MENTION_KINDS = [...ENTITY_NODE_KINDS, ...MEDIA_MENTION_KINDS] as const

export type MentionKind = EntityNodeKind | MediaMentionKind

/**
 * One selectable variant of a character — an angle, an expression, a pose.
 *
 * Carried on the mention so the picker can drill in with ZERO extra fetches
 * (the characters list endpoint already returns every bucket). Picking one
 * changes only the inserted PROSE — the wire format stays name+id, and the
 * doctrine (since the variant-knowledge PR) translates "the \"back\" angle"
 * into an `@slug:N:back` prompt token itself.
 */
export interface CopilotMentionVariant {
  /** Bucket key on the character row (angles, expressions, …). */
  bucket: string
  /** The singular noun the inserted prose uses ("angle", "expression"). */
  bucketNoun: string
  name: string
  imageUrl: string | null
}

export interface CopilotMention {
  id: string
  name: string
  kind: MentionKind
  imageUrl?: string | null
  /** Characters only; absent or empty elsewhere. */
  variants?: CopilotMentionVariant[]
}
