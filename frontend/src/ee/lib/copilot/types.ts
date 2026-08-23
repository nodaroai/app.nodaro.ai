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

export type CopilotRunMode = "ask" | "auto"

export interface CopilotThread {
  id: string
  workflowId: string
  runMode: CopilotRunMode
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

export interface CopilotRunProposal {
  workflowId: string
  addedNodeTypes: string[]
  note: string | null
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
      }
    }
  | { type: "token"; data: { text: string } }
  | { type: "tool_call"; data: CopilotToolCallEvent }
  | { type: "workflow_updated"; data: CopilotWorkflowUpdate }
  | { type: "run_proposed"; data: CopilotRunProposal }
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
  /** Streamed assistant prose. */
  text: string
  activities: CopilotActivity[]
  update: CopilotWorkflowUpdate | null
  proposal: CopilotRunProposal | null
  creditsCharged: number | null
  error: { code: string; message: string } | null
}

export const EMPTY_TURN: CopilotTurnState = {
  turnId: null,
  status: "idle",
  userText: "",
  text: "",
  activities: [],
  update: null,
  proposal: null,
  creditsCharged: null,
  error: null,
}

/** A picked entity in the composer. Wire form is plain text (`@Name`) — see `mentions.ts`. */
export interface CopilotMention {
  id: string
  name: string
  kind: "character" | "location"
  imageUrl?: string | null
}
