import type { NodaroClient } from "../client.js"
import { readSseStream } from "../sse.js"

/**
 * The assistant's conversation surface (`/v1/copilot/*`) — threads, and one
 * turn as a live stream.
 *
 * A thread is the conversation; a TURN is one message and everything the
 * assistant does in answer to it. `stream` is the only method that spends: it
 * POSTs the message and yields the turn's frames as they arrive, so a caller
 * renders prose, tool activity and proposals live instead of waiting for a
 * finished answer.
 *
 * Two shapes here are deliberately TOLERANT of a deployment that predates a
 * field, because the SDK ships ahead of every instance it talks to:
 *  - `surface` is optional on both {@link CopilotThread} and the `metadata`
 *    frame — absent is a value ("this deployment does not say"), never a
 *    default this package invents.
 *  - An event kind this package does not model is IGNORED, not thrown: a
 *    newer server may emit frames a caller was built before.
 */

/** How this thread runs what it proposes: ask first, or run within a budget. */
export type CopilotRunMode = "ask" | "auto"

/** The thread's model rung. Absent from a server that predates it. */
export type CopilotModelTier = "economy" | "standard" | "premium"

/**
 * Which product the conversation belongs to.
 *
 * NO deployment sends this today — nothing in the platform emits it yet — and
 * it is typed here so that the day one does, a caller reads what the server
 * said. That is why it is OPTIONAL everywhere it appears: absent is a value
 * ("this deployment does not say"), never a default this package invents.
 */
export type CopilotSurface = "studio" | "workflow"

export interface CopilotThread {
  id: string
  workflowId: string
  runMode: CopilotRunMode
  /** See {@link CopilotSurface} — absent means the server did not say. */
  surface?: CopilotSurface
  /** Whether this thread may build nodes that publish to connected accounts. */
  allowPublishing?: boolean
  modelTier?: CopilotModelTier
  autoRunLimitCredits: number
  userTurnCount: number
  lastMessageAt: string | null
  createdAt: string
  /** Only on {@link CopilotResource.get} — derived from a live turn. */
  status?: "running" | "idle"
  activeTurnId?: string | null
}

/** The workflow a thread was opened on, as `create` answers it. */
export interface CopilotThreadWorkflow {
  id: string
  projectId: string
  name: string
  version: number
}

export type CopilotMessagePart =
  | { kind: "text"; text: string }
  | { kind: "tool_call"; id: string; name: string; label: string; status: "finished" | "failed" }

export interface CopilotMessage {
  id: string
  seq: number
  turnId: string
  role: "user" | "assistant"
  createdAt: string
  parts: CopilotMessagePart[]
}

/** Open a thread on an existing workflow, or on one this call creates. */
export interface CreateCopilotThreadInput {
  /** The workflow to work on. Give this OR `prompt`. */
  workflowId?: string
  /** Start from nothing: the server creates a workflow seeded by this prompt. */
  prompt?: string
  /** Name for a workflow created by `prompt` (defaults to the prompt's head). */
  name?: string
}

export interface CopilotStreamOptions {
  /** The user's turn. */
  message: string
  /** The workflow version this message was composed against — a newer one 409s. */
  baseVersion?: number
  /** The composer's echo of the thread's rung; the thread row stays authoritative. */
  tier?: CopilotModelTier
  /**
   * Ends the stream. The client's request timeout is NOT applied to a turn.
   *
   * Aborting REJECTS the iteration — with the platform's raw `AbortError`, not
   * a `NodaroError` — whether it fires before the first frame or between two of
   * them. Wrap the loop in `try`/`catch` if a cancelled turn is an ordinary
   * ending in your UI. (`media.downloadVideoProgress` behaves the same way.)
   */
  signal?: AbortSignal
}

export interface CopilotToolCallFrameData {
  id: string
  name: string
  label: string
  status: "started" | "finished" | "failed"
  summary?: string
}

export interface CopilotWorkflowUpdateFrameData {
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

/** A file the turn wired onto a node — named on the run card, never counted. */
export interface CopilotWiredAsset {
  id: string
  kind: string
  filename: string
  nodeId: string
}

export interface CopilotRunProposalNode {
  id: string
  type: string
  graphVersion: number
  label: string
}

export interface CopilotRunProposalFrameData {
  workflowId: string
  addedNodeTypes: string[]
  wiredAssets?: CopilotWiredAsset[]
  note: string | null
  /** Present when ONE node was proposed rather than the whole graph. */
  node?: CopilotRunProposalNode | null
}

/** A workflow the turn created — a different one from the open canvas. */
export interface CopilotWorkflowCreatedFrameData {
  workflowId: string
  name: string
  projectId: string
}

/** One thing the assistant saved to memory this turn. */
export interface CopilotMemorySavedFrameData {
  id: string
  content: string
}

export interface CopilotMetadataFrameData {
  threadId: string
  turnId: string
  jobId: string
  model: string
  baseVersion: number | null
  runMode: CopilotRunMode
  autoRunLimitCredits: number
  allowPublishing?: boolean
  modelTier?: CopilotModelTier
  /** See {@link CopilotSurface} — absent means the server did not say. */
  surface?: CopilotSurface
}

/**
 * One frame of a turn.
 *
 * The union covers the frame KINDS; a frame's `data` is passed through
 * untouched, so a field this package does not model still reaches the caller
 * rather than being stripped on the way.
 */
export type CopilotStreamFrame =
  | { type: "metadata"; data: CopilotMetadataFrameData }
  | { type: "token"; data: { text: string } }
  | { type: "tool_call"; data: CopilotToolCallFrameData }
  | { type: "workflow_updated"; data: CopilotWorkflowUpdateFrameData }
  | { type: "workflow_created"; data: CopilotWorkflowCreatedFrameData }
  | { type: "run_proposed"; data: CopilotRunProposalFrameData }
  | { type: "memory_saved"; data: CopilotMemorySavedFrameData }
  | { type: "usage"; data: { inputTokens: number; outputTokens: number; cacheReadTokens: number; creditsCharged: number | null } }
  | { type: "done"; data: { turnId: string; messageId: string | null; status: "completed" | "capped" | "cancelled"; finalVersion: number | null } }
  | { type: "error"; data: { code: string; message: string } }

/** The kinds above, as the wire spells them — the whole of what `stream` yields. */
const COPILOT_FRAME_TYPES: ReadonlySet<string> = new Set([
  "metadata",
  "token",
  "tool_call",
  "workflow_updated",
  "workflow_created",
  "run_proposed",
  "memory_saved",
  "usage",
  "done",
  "error",
])

function isCopilotFrame(value: unknown): value is CopilotStreamFrame {
  if (typeof value !== "object" || value === null) return false
  const type = (value as { type?: unknown }).type
  return typeof type === "string" && COPILOT_FRAME_TYPES.has(type)
}

export class CopilotResource {
  constructor(private client: NodaroClient) {}

  /**
   * Open a conversation (`POST /v1/copilot/threads`) — on `workflowId`, or on
   * a workflow the server creates from `prompt`. Re-opening a workflow that
   * already has an active thread answers THAT thread rather than a second one.
   */
  create(input: CreateCopilotThreadInput): Promise<{ data: { thread: CopilotThread; workflow: CopilotThreadWorkflow } }> {
    return this.client.request("POST", "/v1/copilot/threads", { body: input })
  }

  /**
   * The active thread for a workflow (`GET /v1/copilot/threads?workflowId=…`),
   * or `null` when the user has none open on it.
   */
  list(params: { workflowId: string }): Promise<{ data: { thread: CopilotThread | null } }> {
    return this.client.request("GET", "/v1/copilot/threads", { query: { workflowId: params.workflowId } })
  }

  /**
   * One thread with its messages (`GET /v1/copilot/threads/:id`). `after` reads
   * only what followed that sequence number (the panel's catch-up); `limit`
   * caps the page at the server's own ceiling.
   */
  get(
    id: string,
    opts: { after?: number; limit?: number } = {},
  ): Promise<{ data: { thread: CopilotThread; messages: CopilotMessage[] } }> {
    return this.client.request("GET", `/v1/copilot/threads/${encodeURIComponent(id)}`, {
      query: { ...(opts.after !== undefined ? { after: opts.after } : {}), ...(opts.limit !== undefined ? { limit: opts.limit } : {}) },
    })
  }

  /**
   * Close a conversation (`DELETE /v1/copilot/threads/:id`). Archival, not
   * deletion — the messages stay readable. Refused while a turn is running.
   */
  archive(id: string): Promise<{ data: { archived: true } }> {
    return this.client.request("DELETE", `/v1/copilot/threads/${encodeURIComponent(id)}`)
  }

  /**
   * Stop the running turn (`POST /v1/copilot/threads/:id/cancel`). Answers the
   * turn it asked to stop; the turn's own stream ends with a `done` frame.
   */
  cancel(id: string): Promise<{ data: { cancelling: true; turnId: string } }> {
    return this.client.request("POST", `/v1/copilot/threads/${encodeURIComponent(id)}/cancel`)
  }

  /**
   * Send one message and iterate the turn's frames
   * (`POST /v1/copilot/threads/:id/messages`, server-sent events).
   *
   * Deliberately NOT routed through `client.request`: that path arms an abort
   * timer around the whole exchange, and a turn legitimately runs for minutes —
   * inheriting `timeoutMs` would cut the assistant off mid-answer. The caller
   * owns the lifetime instead: pass `signal` to end the stream, or stop
   * iterating (the reader cancels the body, which ends the request).
   *
   * A frame kind this package does not model is skipped rather than thrown, so
   * a newer server cannot break an older caller.
   */
  async *stream(threadId: string, opts: CopilotStreamOptions): AsyncGenerator<CopilotStreamFrame, void, undefined> {
    const url = `${this.client.baseUrl}/v1/copilot/threads/${encodeURIComponent(threadId)}/messages`
    const token = await this.client.auth.getToken()
    const res = await this.client.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message: opts.message,
        ...(opts.baseVersion !== undefined ? { baseVersion: opts.baseVersion } : {}),
        ...(opts.tier ? { tier: opts.tier } : {}),
      }),
      signal: opts.signal,
    })
    for await (const value of readSseStream<unknown>(res, { label: "copilot stream" })) {
      if (isCopilotFrame(value)) yield value
    }
  }
}
