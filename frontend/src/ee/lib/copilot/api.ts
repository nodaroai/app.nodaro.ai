/**
 * REST surface for the Workflow Copilot. Streaming lives in `turn-engine.ts`.
 *
 * Every call is same-origin (`/v1/...`) through the Vite proxy, matching the
 * rest of the app — only the SSE turn bypasses the proxy, because the proxy
 * buffers streamed responses.
 */
import { getAuthHeaders } from "@/lib/api"
import type { CopilotRunMode, CopilotThread, DisplayMessage, CopilotModelTier } from "./types"

/** A non-2xx REST reply, carrying the backend's error code so callers can branch. */
export class CopilotApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>
  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = "CopilotApiError"
    this.status = status
    this.code = code
    this.details = details
  }
}

async function request<T>(path: string, init: { method?: string; body?: Record<string, unknown> } = {}): Promise<T> {
  const { method = "GET", body } = init
  const auth = await getAuthHeaders()
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json", ...auth } : auth,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json: { data?: T; error?: { code?: string; message?: string } & Record<string, unknown> } = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    // A proxy or gateway can answer with HTML; fall through to the generic error.
  }
  if (!res.ok) {
    const err = json.error ?? {}
    throw new CopilotApiError(res.status, err.code ?? "request_failed", err.message ?? `Request failed (${res.status})`, err)
  }
  return json.data as T
}

export interface ThreadHandshake {
  thread: CopilotThread
  workflow: { id: string; projectId: string; name: string; version: number }
}

/** Find-or-create the active thread for a workflow. */
export function createCopilotThread(input: { workflowId?: string; prompt?: string; name?: string }): Promise<ThreadHandshake> {
  return request<ThreadHandshake>("/v1/copilot/threads", { method: "POST", body: { ...input } })
}

export function findCopilotThread(workflowId: string): Promise<{ thread: CopilotThread | null }> {
  return request<{ thread: CopilotThread | null }>(`/v1/copilot/threads?workflowId=${encodeURIComponent(workflowId)}`)
}

export function getCopilotThread(threadId: string): Promise<{ thread: CopilotThread; messages: DisplayMessage[] }> {
  return request<{ thread: CopilotThread; messages: DisplayMessage[] }>(`/v1/copilot/threads/${encodeURIComponent(threadId)}`)
}

export function updateCopilotThread(
  threadId: string,
  patch: { runMode?: CopilotRunMode; autoRunLimitCredits?: number; allowPublishing?: boolean; modelTier?: CopilotModelTier },
): Promise<{ thread: CopilotThread }> {
  return request<{ thread: CopilotThread }>(`/v1/copilot/threads/${encodeURIComponent(threadId)}`, {
    method: "PATCH",
    body: { ...patch },
  })
}

export function cancelCopilotTurn(threadId: string): Promise<{ cancelled: boolean }> {
  return request<{ cancelled: boolean }>(`/v1/copilot/threads/${encodeURIComponent(threadId)}/cancel`, { method: "POST" })
}

// ---------------------------------------------------------------------------
// Memories (M1) — what the copilot remembers about this user
// ---------------------------------------------------------------------------

export interface CopilotMemory {
  id: string
  content: string
  created_at: string
}

export function listCopilotMemories(): Promise<{ memories: CopilotMemory[] }> {
  return request<{ memories: CopilotMemory[] }>("/v1/copilot/memories")
}

/** The undo on a pinned save, and the panel's delete. */
export function deleteCopilotMemory(memoryId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/v1/copilot/memories/${encodeURIComponent(memoryId)}`, { method: "DELETE" })
}
