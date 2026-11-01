// backend/src/lib/concurrency-lanes/coordinator-wait.ts — time a running job
// (a coordinator: a director, a plugin coordinator, a pipeline drive) spends
// WAITING inside its handler — for a slot for one of its calls, or for a child
// job that waits in `queued` — kept off its own clocks (decided 2026-10-30:
// nothing fails for waiting).
//
// `creditCoordinatorWait(from, to)` adds the interval to the hold scope's
// in-handler wait (hold.ts — read by the pre-task heartbeat, whose cap pauses
// for it) and keeps the job's running total on its row, `lane_wait_ms`, which
// the sweeps that would otherwise call a long-waiting coordinator stuck read:
// the stuck-orchestrator sweep (`jobs`) and the pipelines reconcile
// (`pipelines`). The total is written while the wait is still going on (at
// most once per LANE_WAIT_PERSIST_MS, plus the last change), so a sweep that
// runs mid-wait already sees it.
//
// Nothing is written while nothing waits: a job that never waits makes no
// write and no read. The row's earlier total (an earlier attempt's) is read
// once, at the first wait, and the column only grows. Tolerant until migration
// 568 reaches the database (columns.ts): a missing column ends the writes for
// the life of the process. Never throws.
import { addHeldWait, currentHoldScope, heldWaitOf, type HeldWait, type HoldScope } from "./hold.js"
import { cappedQueuedMs } from "./queued-clock.js"

/**
 * True when the current code runs as a JOB under a live hold scope (a worker's
 * admission, or a pipeline drive) — not a live request (a hold with a
 * `transport`), not detached work whose scope has ended, not code under no
 * hold at all. Only then is the time an awaited job waits `queued` this
 * code's own wait, to leave off its timeout: a request that waits inline
 * keeps its plain limit (an open connection must not be held for the queue
 * timeout). Every queue-aware poll asks this first.
 */
export function waitsAsJob(): boolean {
  const scope = currentHoldScope()
  return !!scope && !scope.closed && !scope.hold.transport
}

/** The row's total is written at most this often while a wait goes on. */
export const LANE_WAIT_PERSIST_MS = 30_000

interface PersistState {
  table: "jobs" | "pipelines"
  id: string
  /** The row's total before this attempt's first wait; undefined until read. */
  base?: number
  /** False once the column is known missing (or the row could not be read): nothing more is written. */
  enabled: boolean
  written: number
  lastWriteAt: number
  timer: ReturnType<typeof setTimeout> | null
  inFlight: Promise<void> | null
}

const states = new WeakMap<HeldWait, PersistState>()

/**
 * The job the current code runs for waited during `[fromMs, toMs]` (a call
 * waiting for its slot, or a child job seen `queued`). Outside any hold, or
 * once the job's scope has ended (detached work that kept its async
 * context), nothing: a finished job's figure and row are never added to.
 * Never throws.
 */
export function creditCoordinatorWait(fromMs: number, toMs: number): void {
  const scope = currentHoldScope()
  if (!scope || scope.closed || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return
  addHeldWait(fromMs, toMs)
  schedulePersist(scope)
}

function schedulePersist(scope: HoldScope): void {
  const { hold, wait } = scope
  if (!hold.waitTable || !hold.jobId) return
  let state = states.get(wait)
  if (!state) {
    state = { table: hold.waitTable, id: hold.jobId, enabled: true, written: 0, lastWriteAt: -Infinity, timer: null, inFlight: null }
    states.set(wait, state)
  }
  if (!state.enabled || state.timer) return
  const due = state.lastWriteAt + LANE_WAIT_PERSIST_MS - Date.now()
  const s = state
  if (due <= 0 && !s.inFlight) {
    void persist(s, wait)
    return
  }
  s.timer = setTimeout(() => {
    s.timer = null
    void persist(s, wait)
  }, Math.max(0, due))
  s.timer.unref?.()
}

type Columns = typeof import("./columns.js")
type Supa = typeof import("../supabase.js")

async function persist(state: PersistState, wait: HeldWait): Promise<void> {
  // One write at a time; a later call writes what has accrued since.
  while (state.inFlight) await state.inFlight
  state.inFlight = (async () => {
    try {
      const [{ laneColumnsAbsent, noteLaneColumnError }, { supabase }]: [Columns, Supa] = await Promise.all([
        import("./columns.js"), import("../supabase.js"),
      ])
      if (laneColumnsAbsent(state.table)) {
        state.enabled = false
        return
      }
      if (state.base === undefined) {
        const { data, error } = (await supabase.from(state.table).select("lane_wait_ms").eq("id", state.id).maybeSingle()) ?? {}
        if (error) {
          if (!noteLaneColumnError(state.table, error)) warn(`could not read the queued time of ${state.table} row ${state.id}`, error)
          state.enabled = false
          return
        }
        const prior = Number((data as { lane_wait_ms?: unknown } | null)?.lane_wait_ms ?? 0)
        state.base = Number.isFinite(prior) && prior > 0 ? prior : 0
      }
      const total = Math.round(state.base + heldWaitOf(wait))
      if (total <= state.written) return
      state.lastWriteAt = Date.now()
      let q = supabase.from(state.table).update({ lane_wait_ms: total }).eq("id", state.id).lt("lane_wait_ms", total)
      if (state.table === "jobs") q = q.eq("status", "processing")
      const { error } = (await q) ?? {}
      if (error) {
        if (noteLaneColumnError(state.table, error)) state.enabled = false
        else warn(`could not record the queued time of ${state.table} row ${state.id}`, error)
        return
      }
      state.written = total
    } catch (err) {
      warn(`could not record the queued time of ${state.table} row ${state.id}`, err)
    } finally {
      state.inFlight = null
    }
  })()
  await state.inFlight
}

function warn(what: string, err: unknown): void {
  const e = err as { message?: string; code?: string } | null
  console.warn(`[concurrency-lanes] ${what}: ${e?.message ?? e?.code ?? String(err)}`)
}

/** For tests: the write in flight (or about to be, from a pending timer) for the current job's wait, run now. */
export async function flushCoordinatorWaitForTests(): Promise<void> {
  const scope = currentHoldScope()
  if (!scope) return
  const state = states.get(scope.wait)
  if (!state) return
  if (state.timer) {
    clearTimeout(state.timer)
    state.timer = null
    await persist(state, scope.wait)
  }
  if (state.inFlight) await state.inFlight
}

// ------------------------------------------------- a run's own wait, at admission

type RunWaitClient = {
  from(table: "pipelines"): {
    update(values: { lane_wait_ms: number }): {
      eq(column: "id", value: string): {
        eq(column: "lane_wait_ms", value: number): PromiseLike<{ error: { code?: string | null; message?: string } | null } | null>
      }
    }
  }
}

/**
 * A pipeline its drive is about to start, as its row was read (`select("*")`):
 * when it waited for its run slot (still `queued`, with `lane_queued_at` — a
 * row that never parked has none), add that wait — `lane_queued_at` → now,
 * capped at the queue timeout's bound — to its `lane_wait_ms`, so the clocks
 * measured from its `created_at` (the pipelines reconcile's 6-hour abandon)
 * leave it out. A compare-and-set on the figure read, so two drives never add
 * it twice. A row that never waited (or a database without the columns, whose
 * row has no `lane_queued_at` at all) makes no write. Never throws.
 */
export async function creditAdmittedPipelineWait(client: RunWaitClient, row: Record<string, unknown>, nowMs = Date.now()): Promise<void> {
  const id = row.id
  if (row.status !== "queued" || typeof id !== "string" || typeof row.lane_queued_at !== "string") return
  const queuedAt = Date.parse(row.lane_queued_at)
  if (!Number.isFinite(queuedAt)) return
  const waited = Math.round(cappedQueuedMs(nowMs - queuedAt))
  if (waited <= 0) return
  const prior = Number(row.lane_wait_ms ?? 0)
  const before = Number.isFinite(prior) && prior > 0 ? prior : 0
  try {
    const { error } = (await client.from("pipelines").update({ lane_wait_ms: before + waited }).eq("id", id).eq("lane_wait_ms", before)) ?? {}
    if (error) warn(`could not record the wait of pipeline ${id} for its run slot`, error)
  } catch (err) {
    warn(`could not record the wait of pipeline ${id} for its run slot`, err)
  }
}
