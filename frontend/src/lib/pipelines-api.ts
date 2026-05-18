import type {
  PipelineInput,
  PipelineEvent,
  PipelineStatus,
  PipelineStageName,
} from "@nodaro/shared"
import { getAuthHeaders } from "@/lib/api"

// Pipelines API uses the same proxy convention as the rest of the frontend:
// same-origin relative paths under /v1/* are proxied to the backend by Vite's
// dev server and by the Caddy reverse proxy in production. SSE is the only
// exception (handled separately by the SSE client when streaming events).
const API_BASE = ""

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { ...(await getAuthHeaders()) },
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(await getAuthHeaders()),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export interface PipelineRecord {
  id: string
  status: PipelineStatus
  current_stage: string | null
  spent_credits: number
  reserved_credits: number
  upfront_credit_estimate: number
}

export const pipelinesApi = {
  create: (body: PipelineInput) => postJson<{ id: string }>("/v1/pipelines", body),
  get: (id: string) => getJson<PipelineRecord>(`/v1/pipelines/${id}`),
  list: () => getJson<PipelineRecord[]>("/v1/pipelines"),
  cancel: (id: string) => postJson<{ ok: true }>(`/v1/pipelines/${id}/cancel`),
  pendingApprovals: (id: string) =>
    getJson<{ stage_name: PipelineStageName; output: unknown }[]>(
      `/v1/pipelines/${id}/pending-approvals`,
    ),
  approveStage: (id: string, stage: PipelineStageName, edits?: unknown) =>
    postJson<{ ok: true }>(
      `/v1/pipelines/${id}/stages/${stage}/approve`,
      edits ? { edits } : {},
    ),
  rejectStage: (id: string, stage: PipelineStageName, feedback: string) =>
    postJson<{ ok: true }>(`/v1/pipelines/${id}/stages/${stage}/reject`, { feedback }),
  getStage: (id: string, stage: PipelineStageName) =>
    getJson<{ status: string; output: unknown; critic_feedback: unknown }>(
      `/v1/pipelines/${id}/stages/${stage}`,
    ),
  eventsUrl: (id: string) => `${API_BASE}/v1/pipelines/${id}/events`,
}

export type { PipelineEvent }
