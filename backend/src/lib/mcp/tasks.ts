/**
 * MCP `tasks/*` API — task lifecycle registry + JSON-RPC handlers.
 *
 * The MCP spec defines `tasks/list`, `tasks/get`, `tasks/result`, and
 * `tasks/cancel` as a side-channel for long-running tool calls. v1.2 adds
 * these so widgets running inside Claude.ai's `<hash>.claudemcpcontent.com`
 * iframe can poll/cancel/await the BullMQ jobs we kick off on tool
 * invocation.
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
import { redactPrivateJobData } from "../public-job-data.js"

export interface Task {
  taskId: string
  userId: string
  kind: "image" | "video" | "audio" | "workflow" | "component" | "app"
  startedAt: number
  abortController: AbortController
}

const REGISTRY = new Map<string, Task>()

// Containment cap for the registry. `completeTask` (the terminal-state eviction)
// is only invoked by the progress-emitter, which is currently dormant (never
// started in the live path), so absent this cap the registry grows monotonically
// for the process lifetime (one entry + AbortController per generation task) —
// a slow leak cleared only on worker restart. Evicting the OLDEST entry when
// over the cap bounds it safely: Map preserves insertion order, the cap is far
// above any realistic count of concurrently-live MCP tasks, and the oldest
// entries are overwhelmingly terminal. The fuller fix (evict on terminal
// Supabase status, or start the emitter with per-session scoping) is the MCP
// owner's call — see the audit doc.
const MAX_REGISTRY_SIZE = 2000

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

// Max time a task can stay in the registry. 90 min is beyond the 60-min
// workflow + 30-min node timeouts, so a swept entry is always terminal — and
// well beyond the seconds/minutes a client takes to poll tasks/get → call
// tasks/result. We bound growth via this lazy sweep rather than evicting on
// terminal-status observation: eager eviction in tasks/get broke the spec
// get→result sequence (the second call threw "Unknown taskId").
const TASK_TTL_MS = 90 * 60 * 1000

export function registerTask(opts: {
  taskId: string
  userId: string
  kind: Task["kind"]
}): Task {
  // Lazy TTL sweep keeps the process-global registry bounded (the
  // progress-emitter that used to drain it is intentionally disabled).
  const cutoff = Date.now() - TASK_TTL_MS
  for (const [id, t] of REGISTRY) {
    if (t.startedAt < cutoff) REGISTRY.delete(id)
  }
  const task: Task = {
    ...opts,
    startedAt: Date.now(),
    abortController: new AbortController(),
  }
  // Bound the registry: drop the oldest entry (insertion order) when at the cap.
  if (REGISTRY.size >= MAX_REGISTRY_SIZE) {
    const oldest = REGISTRY.keys().next().value
    if (oldest !== undefined) REGISTRY.delete(oldest)
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
  await markJobCancelled(taskId, userId)
  return true
}

async function markJobCancelled(jobId: string, userId: string): Promise<void> {
  const { supabase } = await import("../supabase.js")
  // Fast path, unchanged: a job still on a worker is cancelled by flipping the
  // row — the worker's own pickup / completion CAS then no-ops and refunds.
  // The status filter is the guard: without it, cancelling a taskId whose job
  // already completed would clobber a `completed` row with `cancelled` and lose
  // the finished result.
  const { data: flipped } = await supabase
    .from("jobs")
    .update({ status: "cancelled" })
    .eq("id", jobId)
    .in("status", ["pending", "processing"])
    .select("id")
  if (flipped && flipped.length > 0) return

  // Nothing flipped: the row is either already terminal (nothing to do) or
  // parked in `pending_review`. A HELD job must be cancellable (spec
  // 2026-09-03-job-policy-hook-design D17 — a reservation must not be stranded
  // behind a reviewer's SLA), but NOT by a bare status flip: there is no worker
  // left to refund it, so the row would go `cancelled` with its credits held
  // `reserved` forever, its withheld media orphaned in the bucket, and the
  // review queue holding an entry no resolution can settle. D17's cancel is
  // flip + refund + owned-object delete + a `withdrawn` decision row, and all
  // four live in `cancelOwnedJob`. Delegate rather than re-implement.
  //
  // Lazily imported so `lib/queue.js` (BullMQ + a live Redis handle) is not
  // pulled into every importer of this module, and only reached on the slow
  // path. On an already-terminal row this costs one SELECT and answers
  // `invalid_status` — a no-op, exactly as before.
  const { cancelOwnedJob } = await import("../cancel-job.js")
  await cancelOwnedJob(jobId, userId)
}

/**
 * Maps Nodaro `jobs.status` strings onto the MCP task-status enum
 * (`working | input_required | completed | failed | cancelled`).
 *
 * Nodaro statuses include `pending`, `processing`, `pending_review`,
 * `completed`, `failed`, `cancelled`. We collapse pending/processing →
 * working, map `pending_review` → `input_required`, and pass the terminal
 * three through unchanged.
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
    case "pending_review":
      // `input_required` = "this task cannot advance without a decision". The
      // decision belongs to a REVIEWER, not to the MCP caller — an agent must
      // not read this as "ask the user for more parameters", which is why
      // get_job's guidance text says so in words. The `default: working` arm
      // below would leave an agent polling a job that will never move on its
      // own (spec 2026-09-03-job-policy-hook-design §6.4).
      return "input_required"
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
        // every invocation), we report all known tasks as "working". Terminal
        // tasks are drained from the registry when tasks/get or tasks/result
        // observes their terminal Supabase status (see completeTask calls
        // below), so a finished task falls out of this list on the next poll.
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
    // NOTE: do NOT evict the task here on terminal status — a client polls
    // tasks/get until terminal, THEN calls tasks/result; evicting on the
    // terminal tasks/get would make tasks/result throw "Unknown taskId".
    // The registry is bounded by the TTL sweep in registerTask instead.

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
 *   - `{ taskId, status: "working", message }` on timeout (a valid MCP
 *     task-status enum value — clients re-call `tasks/result` to keep waiting).
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
  // Hoisted out of the loop — the dynamic import resolves the same cached
  // module every iteration; importing once avoids the repeated lookup.
  const { supabase } = await import("../supabase.js")
  while (Date.now() - start < TIMEOUT_MS && !signal.aborted) {
    const { data } = await supabase
      .from("jobs")
      .select("status, output_data, error_message")
      .eq("id", jobId)
      .maybeSingle()
    if (!data) {
      // The job row was removed mid-poll (e.g. credit-reservation cleanup
      // deletes the orphan job on a reserve failure). Return a clean terminal
      // status instead of throwing an internal error at the client. (No
      // eviction here — the TTL sweep in registerTask bounds the registry, and
      // keeping the entry lets a follow-up tasks/get/result still resolve.)
      return { taskId: jobId, status: "failed", error: "Job no longer exists" }
    }
    // Parked on a human, for an unbounded time: neither terminal nor
    // "keep waiting". Answer with the same non-working status tasks/get maps
    // to, rather than long-polling the full 90 s to say "working" — and NEVER
    // evict the task, because the review resolves later and the client's
    // follow-up tasks/result must still find it.
    if (data.status === "pending_review") {
      return {
        taskId: jobId,
        status: "input_required",
        // NULL by contract on a held row (D6) — nothing to hand back yet.
        output: null,
        error: null,
        message:
          "The output is held for human review. Call tasks/result again later — " +
          "the task completes on approval, or fails with a policy reason if it is rejected.",
      }
    }
    if (
      data.status === "completed" ||
      data.status === "failed" ||
      data.status === "cancelled"
    ) {
      return {
        taskId: jobId,
        status: data.status,
        output: redactPrivateJobData(data.output_data ?? null),
        error: data.error_message ?? null,
      }
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return {
    taskId: jobId,
    status: "working",
    message: "Timed out — call again to keep waiting",
  }
}
