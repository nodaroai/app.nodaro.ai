/**
 * MCP `tasks/*` API — task lifecycle registry + JSON-RPC handlers.
 *
 * The MCP spec defines `tasks/list`, `tasks/get`, `tasks/result`, and
 * `tasks/cancel` as a side-channel for long-running tool calls (per the
 * [redacted-reference] reference review). v1.2 adds these so widgets running inside
 * Claude.ai's `<hash>.claudemcpcontent.com` iframe can poll/cancel/await
 * the BullMQ jobs we kick off on tool invocation.
 *
 * Architecture notes:
 * - The registry is in-process: each tool call (e.g. `generate_image`) calls
 *   {@link registerTask} with the BullMQ job id; later `tasks/get` and
 *   `tasks/result` consult the same Map and Supabase `jobs` row.
 * - SDK API: `McpServer` does NOT expose `setRequestHandler` directly — the
 *   method lives on `McpServer.server` (the inner `Server` instance). We
 *   register handlers via Zod *schemas* (the v1.29 `Protocol.setRequestHandler`
 *   signature is `<T extends AnyObjectSchema>(schema, handler)`, NOT a plain
 *   method-name string).
 * - Capability declaration (`capabilities.tasks`) is enforced at SDK init
 *   time — without it the SDK throws "Server does not support tasks
 *   capability" when a client invokes `tasks/*`. See `server.ts`.
 *
 * The schema parameters from the MCP spec carry an extra `_meta` envelope
 * with `progressToken` + `io.modelcontextprotocol/related-task` keys; we
 * destructure only the surface we need (taskId) and pass the rest through.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CancelTaskRequestSchema,
  GetTaskPayloadRequestSchema,
  GetTaskRequestSchema,
  ListTasksRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

export interface Task {
  taskId: string
  userId: string
  kind: "image" | "video" | "audio" | "workflow" | "component" | "app"
  startedAt: number
  abortController: AbortController
}

const REGISTRY = new Map<string, Task>()

/** Test-only escape hatch — clears all tasks. Used by the test bed. */
export function _resetRegistry(): void {
  REGISTRY.clear()
}

/**
 * Internal: snapshot the active task ids. Used by the progress emitter to
 * batch-poll Supabase. Returning `string[]` (not the iterator) lets the
 * caller hold the value across the await without worrying about iterator
 * invalidation when the registry mutates.
 */
export function _activeTaskIds(): string[] {
  return [...REGISTRY.keys()]
}

export function registerTask(opts: {
  taskId: string
  userId: string
  kind: Task["kind"]
}): Task {
  const task: Task = {
    ...opts,
    startedAt: Date.now(),
    abortController: new AbortController(),
  }
  REGISTRY.set(opts.taskId, task)
  return task
}

export function getTask(taskId: string): Task | null {
  return REGISTRY.get(taskId) ?? null
}

export function completeTask(taskId: string): void {
  REGISTRY.delete(taskId)
}

/**
 * Cancel a task. Returns `true` if cancelled by the owner, `false` otherwise
 * (unknown taskId, or different user). Aborts the in-process AbortController
 * (which blocks any waiting `tasks/result` long-poll) and flips the Supabase
 * `jobs.status` to `cancelled` so the worker's `markJobCompleted` no-op path
 * fires and the cancellation propagates downstream.
 */
export async function cancelTask(taskId: string, userId: string): Promise<boolean> {
  const t = REGISTRY.get(taskId)
  if (!t || t.userId !== userId) return false
  t.abortController.abort()
  REGISTRY.delete(taskId)
  await markJobCancelled(taskId)
  return true
}

async function markJobCancelled(jobId: string): Promise<void> {
  const { supabase } = await import("../supabase.js")
  await supabase.from("jobs").update({ status: "cancelled" }).eq("id", jobId)
}

/**
 * Maps Nodaro `jobs.status` strings onto the MCP task-status enum
 * (`working | input_required | completed | failed | cancelled`).
 *
 * Nodaro statuses include `pending`, `processing`, `completed`, `failed`,
 * `cancelled`. We collapse pending/processing → working and pass the
 * terminal three through unchanged.
 */
type McpTaskStatus = "working" | "input_required" | "completed" | "failed" | "cancelled"

function mapJobStatus(jobStatus: string | null | undefined): McpTaskStatus {
  switch (jobStatus) {
    case "completed":
      return "completed"
    case "failed":
      return "failed"
    case "cancelled":
      return "cancelled"
    case "pending":
    case "processing":
    default:
      return "working"
  }
}

/**
 * Wire MCP `tasks/*` request handlers into the server.
 *
 * Called once during {@link buildMcpServer}. The four registered methods are:
 *   - `tasks/list` — active tasks for the calling user
 *   - `tasks/get` — single-task status snapshot
 *   - `tasks/result` — long-poll until the task reaches a terminal state
 *   - `tasks/cancel` — abort an in-flight task (owner only)
 *
 * `getUserId` is a thunk so the closure stays consistent with the
 * per-request session — we never reach into `req.appAuthorization` directly
 * here; that lookup happens in the Fastify adapter layer that built this
 * server.
 *
 * Registration goes through the inner `server.server.setRequestHandler` —
 * the high-level `McpServer` does not expose `setRequestHandler` on its
 * surface in SDK v1.29. The handlers receive the parsed request payload
 * (Zod-validated) plus an `extra` arg we don't use here.
 */
export function registerTaskHandlers(server: McpServer, getUserId: () => string): void {
  const inner = (server as unknown as { server: Server }).server

  inner.setRequestHandler(ListTasksRequestSchema, async () => {
    const userId = getUserId()
    const now = new Date().toISOString()
    const tasks = [...REGISTRY.values()]
      .filter((t) => t.userId === userId)
      .map((t) => ({
        taskId: t.taskId,
        // We don't track per-task status in the in-process registry; that
        // lives in Supabase. To keep tasks/list cheap (no batched DB read on
        // every invocation), we report all known tasks as "working" — the
        // moment a task reaches a terminal state, the worker calls
        // completeTask() and it falls out of the registry on the next poll.
        // Clients that need the precise terminal status should call
        // tasks/get for the specific taskId.
        status: "working" as const,
        ttl: null,
        createdAt: new Date(t.startedAt).toISOString(),
        lastUpdatedAt: now,
      }))
    return { tasks }
  })

  inner.setRequestHandler(GetTaskRequestSchema, async (req) => {
    const { taskId } = req.params
    const t = getTask(taskId)
    if (!t) throw new Error(`Unknown taskId: ${taskId}`)
    if (t.userId !== getUserId()) throw new Error("forbidden")

    const { supabase } = await import("../supabase.js")
    const { data } = await supabase
      .from("jobs")
      .select("status, output_data, error_message, created_at, updated_at")
      .eq("id", taskId)
      .maybeSingle()

    const created = data?.created_at ?? new Date(t.startedAt).toISOString()
    const updated = data?.updated_at ?? created
    const status = mapJobStatus(data?.status)

    const result: {
      taskId: string
      status: McpTaskStatus
      ttl: number | null
      createdAt: string
      lastUpdatedAt: string
      statusMessage?: string
    } = {
      taskId: t.taskId,
      status,
      ttl: null,
      createdAt: created,
      lastUpdatedAt: updated,
    }
    if (data?.error_message) result.statusMessage = data.error_message
    return result
  })

  inner.setRequestHandler(GetTaskPayloadRequestSchema, async (req) => {
    const { taskId } = req.params
    const t = getTask(taskId)
    if (!t) throw new Error(`Unknown taskId: ${taskId}`)
    if (t.userId !== getUserId()) throw new Error("forbidden")
    return await waitForTerminal(t.taskId, t.abortController.signal)
  })

  inner.setRequestHandler(CancelTaskRequestSchema, async (req) => {
    const { taskId } = req.params
    const ok = await cancelTask(taskId, getUserId())
    if (!ok) {
      // The MCP spec demands we return CancelTaskResult shape even on
      // failure; raising here lets the SDK surface a JSON-RPC error.
      throw new Error(`Unknown or forbidden taskId: ${taskId}`)
    }
    return {
      taskId,
      status: "cancelled" as const,
      ttl: null,
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    }
  })
}

/**
 * Long-poll Supabase for a job's terminal state, up to {@link TIMEOUT_MS}.
 *
 * Returns either:
 *   - `{ taskId, status, output, error }` when terminal, or
 *   - `{ taskId, status: "in_progress", message }` on timeout.
 *
 * The 90-second cap aligns with typical proxy timeouts (most CDNs and load
 * balancers cut idle connections at 60-100s); clients that need to wait
 * longer call `tasks/result` again, which is idempotent.
 *
 * `output_data` is JSONB on the `jobs` table — we return it whole so widgets
 * can pull `imageUrl` / `videoUrl` / `audioUrl` keys directly. (The original
 * plan suggested `output_url` but per v1.1 Task 4 we standardised on
 * `output_data`.)
 */
async function waitForTerminal(jobId: string, signal: AbortSignal): Promise<{
  taskId: string
  status: string
  output?: unknown
  error?: string | null
  message?: string
}> {
  const start = Date.now()
  const TIMEOUT_MS = 90_000
  while (Date.now() - start < TIMEOUT_MS && !signal.aborted) {
    const { supabase } = await import("../supabase.js")
    const { data } = await supabase
      .from("jobs")
      .select("status, output_data, error_message")
      .eq("id", jobId)
      .maybeSingle()
    if (!data) throw new Error(`Job ${jobId} disappeared`)
    if (
      data.status === "completed" ||
      data.status === "failed" ||
      data.status === "cancelled"
    ) {
      return {
        taskId: jobId,
        status: data.status,
        output: data.output_data ?? null,
        error: data.error_message ?? null,
      }
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return {
    taskId: jobId,
    status: "in_progress",
    message: "Timed out — call again to keep waiting",
  }
}
