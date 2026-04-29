/**
 * Bridge between Nodaro's job-progress writes and MCP `notifications/progress`.
 *
 * v1.2 design (revised after auditing the worker code):
 *
 * Workers update `jobs.progress` (an integer 0-100) and `jobs.status`
 * directly via Supabase. The orchestrator-worker emits `executionEvents`
 * keyed by `executionId` — but those don't help us here because:
 *  (a) MCP single-tool calls (e.g. `generate_image`) bypass the orchestrator
 *      entirely and queue a single BullMQ job.
 *  (b) The bus is keyed by `executionId`, not `jobId` — to find the job we'd
 *      have to subscribe to every execution and filter, which leaks across
 *      sessions.
 *
 * Cleanest path: poll Supabase. Once per second we batch-fetch the current
 * status+progress of every tracked task; when progress changes we emit
 * `notifications/progress`; when a task reaches a terminal state we emit
 * 1.0 progress and call {@link completeTask} to evict it from the registry.
 *
 * SDK API note: `McpServer` does NOT expose `notification` directly in
 * v1.29. The method lives on the inner `Server` instance (via `Protocol`).
 * We adapt at runtime — checking each surface in turn — so a future SDK
 * rev that hoists the method up to McpServer Just Works.
 *
 * MCP spec note (`ProgressNotificationParamsSchema`): `progress` is a number
 * (the spec doesn't enforce 0-1 vs 0-100), `total` is optional. We forward
 * Nodaro's percentage AS-IS (0-100) plus `total: 100` so clients can compute
 * a fraction without ambiguity.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { completeTask, _activeTaskIds } from "./tasks.js"

const POLL_INTERVAL_MS = 1000

let pollHandle: ReturnType<typeof setInterval> | null = null
const lastProgressByTask = new Map<string, number>()

/**
 * Start the polling loop bound to a single `McpServer` instance.
 *
 * This is per-request — the server is built fresh per OAuth-authenticated
 * MCP connection, so each connection owns its own emitter. Calling
 * {@link stopProgressEmitter} during connection teardown stops the loop.
 *
 * Idempotent: a second `start` on the same server is a no-op.
 */
export function startProgressEmitter(server: McpServer): void {
  if (pollHandle) return

  pollHandle = setInterval(() => {
    void runPollCycle(server)
  }, POLL_INTERVAL_MS)
  // Don't keep the Node process alive solely for this poll loop — the
  // request lifecycle should drive when we run.
  if (typeof pollHandle.unref === "function") pollHandle.unref()
}

export function stopProgressEmitter(): void {
  if (pollHandle) {
    clearInterval(pollHandle)
    pollHandle = null
  }
  lastProgressByTask.clear()
}

async function runPollCycle(server: McpServer): Promise<void> {
  const taskIds = _activeTaskIds()
  if (taskIds.length === 0) return

  const { supabase } = await import("../supabase.js")
  const { data, error } = await supabase
    .from("jobs")
    .select("id, status, progress")
    .in("id", taskIds)

  if (error || !data) return

  for (const row of data as Array<{ id: string; status: string; progress: number | null }>) {
    const lastSent = lastProgressByTask.get(row.id) ?? -1
    const isTerminal =
      row.status === "completed" ||
      row.status === "failed" ||
      row.status === "cancelled"

    if (isTerminal) {
      await sendProgress(server, {
        progressToken: row.id,
        progress: 100,
        total: 100,
        message: `Job ${row.status}`,
      })
      lastProgressByTask.delete(row.id)
      completeTask(row.id)
      continue
    }

    const current = typeof row.progress === "number" ? row.progress : 0
    if (current === lastSent) continue
    await sendProgress(server, {
      progressToken: row.id,
      progress: current,
      total: 100,
    })
    lastProgressByTask.set(row.id, current)
  }
}

/**
 * Wire-format-compatible progress emitter that adapts to whichever surface
 * the SDK exposes. v1.29 only has `Server.notification(...)` (under
 * `McpServer.server`); future revs may hoist a `sendProgress` shorthand.
 *
 * `progressToken` is the value we used when registering the task — it gets
 * echoed in every notification so clients can correlate notifications back
 * to the originating tool call.
 */
async function sendProgress(
  server: McpServer,
  params: {
    progressToken: string
    progress: number
    total?: number
    message?: string
  },
): Promise<void> {
  const direct = (server as unknown as {
    sendProgress?: (p: typeof params) => Promise<void>
  }).sendProgress
  if (typeof direct === "function") {
    await direct.call(server, params)
    return
  }

  const flatNotify = (server as unknown as {
    notification?: (n: { method: string; params: unknown }) => Promise<void>
  }).notification
  if (typeof flatNotify === "function") {
    await flatNotify.call(server, {
      method: "notifications/progress",
      params,
    })
    return
  }

  const innerNotify = (server as unknown as {
    server?: { notification?: (n: { method: string; params: unknown }) => Promise<void> }
  }).server?.notification
  if (typeof innerNotify === "function") {
    await innerNotify.call(
      (server as unknown as { server: unknown }).server,
      { method: "notifications/progress", params },
    )
    return
  }

  // Last resort: log a warning. Production should never hit this branch
  // because v1.29 ships `Server.notification`. If we ever do, silently
  // dropping the notification is the right move — progress is best-effort.
  console.warn(
    "[mcp/progress-emitter] No notification surface found on McpServer; progress dropped",
  )
}
