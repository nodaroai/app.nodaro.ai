/**
 * Persistence for copilot threads, turns and messages.
 *
 * Everything here runs under the service-role client: the tables are
 * SELECT-only for their owner under RLS, and every write goes through a
 * function in this file that has already been handed an ownership-checked
 * user id by the route.
 */
import { supabase } from "../../lib/supabase.js"
import { THREAD_CAPS, TURN_HEARTBEAT_STALE_MS } from "./constants.js"

export type TurnStatus = "running" | "completed" | "failed" | "cancelled" | "capped"
export type RunMode = "ask" | "auto"

/**
 * Which assistant a thread belongs to.
 *
 * The canvas assistant and the studio editor's assistant talk about the SAME
 * workflow, so a live thread is unique per (user, workflow, SURFACE) — see
 * migration 404. Declared here, beside the row type it types.
 */
export const THREAD_SURFACES = ["workflow", "studio"] as const
export type CopilotSurface = (typeof THREAD_SURFACES)[number]

/**
 * The canvas assistant's surface, and the column's own DEFAULT.
 *
 * Also what an ABSENT value means: a row written before migration 404 carries
 * no surface at all, and every one of those is a canvas thread.
 */
export const DEFAULT_THREAD_SURFACE: CopilotSurface = "workflow"

/**
 * The surface column is not on this database yet.
 *
 * Named and distinct because the route layer has to turn it into an honest
 * "not promoted yet" answer: this code knows about a second assistant, the
 * database it is pointed at does not, and service-unavailable is the only true
 * reply. The soft alternatives are both wrong — retrying without the column
 * would file the second assistant's thread as a canvas one, and reading
 * threads unfiltered to work around it is the duplicate this whole change
 * exists to prevent.
 */
export class ThreadSurfaceNotPromotedError extends Error {
  constructor(public readonly surface: CopilotSurface) {
    super(`Copilot thread surface "${surface}" is not available on this database yet`)
    this.name = "ThreadSurfaceNotPromotedError"
  }
}

export interface CopilotThread {
  id: string
  user_id: string
  workflow_id: string
  /**
   * Which assistant this thread belongs to.
   *
   * OPTIONAL for the same reason `allow_publishing` is: a row written before
   * the column existed simply does not carry it, and neither does any row read
   * before migration 404 reaches the shared database. Read it through
   * `threadSurface`, never directly — absent means the canvas.
   */
  surface?: CopilotSurface
  run_mode: RunMode
  /**
   * The user let this thread author social-publishing nodes.
   *
   * OPTIONAL because of when migrations run: they apply on push to `main`, and
   * staging shares the production database — so between a dev merge and the
   * promotion, this code runs against a schema without the column. Absent reads
   * as false, which is the safe direction.
   */
  allow_publishing?: boolean
  auto_run_limit_credits: number
  user_turn_count: number
  archived_at: string | null
  last_message_at: string | null
  created_at: string
}

/**
 * Whether this thread may author publishing nodes.
 *
 * A named function and not an inline `?? false`, because the DEFAULT is the
 * whole point and it needs somewhere to be tested. Absent means one of two
 * things — a thread created before the column existed, or a read taken on
 * staging before the migration was promoted — and both must mean OFF. An
 * exemption that switches itself on when a column is missing is not an
 * exemption.
 */
export function threadAllowsPublishing(thread: Pick<CopilotThread, "allow_publishing">): boolean {
  return thread.allow_publishing === true
}

/**
 * The surface of a thread row, as the row can actually arrive.
 *
 * A named function for the same reason as the one above: the DEFAULT is the
 * whole point. Absent (a row older than the column, or a read taken before the
 * migration was promoted) and unrecognised both mean the canvas — the only
 * kind of thread that existed when those rows were written.
 */
export function threadSurface(thread: { surface?: unknown }): CopilotSurface {
  return THREAD_SURFACES.find((known) => known === thread.surface) ?? DEFAULT_THREAD_SURFACE
}

export interface CopilotTurn {
  id: string
  thread_id: string
  user_id: string
  status: TurnStatus
  heartbeat_at: string | null
  model_id: string
  job_id: string | null
  base_version: number | null
  final_version: number | null
  iterations: number
  tool_calls: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost_usd: number | null
  credits_charged: number | null
  cancel_requested_at: string | null
  error: string | null
  started_at: string
  finished_at: string | null
}

export interface CopilotMessageRow {
  id: string
  thread_id: string
  turn_id: string
  seq: number
  role: "user" | "assistant"
  /** Raw Anthropic content blocks — replayed verbatim into the next turn. */
  content: unknown[]
  context_preamble: string | null
  text_preview: string | null
  created_at: string
}

// A star select, deliberately: naming `allow_publishing` explicitly would make
// every thread read 500 on staging until the migration is promoted, which takes
// the whole copilot down. A missing column is simply absent from the row.
// Nothing on this table is secret, so there is nothing to narrow away from.
const THREAD_COLUMNS = "*"
/**
 * The two ways a database says "that column is not on this table (yet)".
 *
 * They are not interchangeable, and the one that matters below is the SECOND:
 *   - 42703:    undefined column in a filter (raw Postgres)
 *   - PGRST204: unknown column in a write payload (PostgREST schema cache)
 * Everything here that has to notice a missing column notices it on an INSERT
 * that NAMES one, and a hosted database answers that from its schema cache
 * with PGRST204. Recognising 42703 alone left every refusal below unreachable
 * exactly where it exists to fire. Both are accepted, as elsewhere in the repo.
 */
const UNDEFINED_COLUMN_CODES = new Set(["42703", "PGRST204"])

function isUndefinedColumn(error: unknown): boolean {
  return UNDEFINED_COLUMN_CODES.has((error as { code?: string } | null)?.code ?? "")
}

/**
 * How many live threads one workflow can hand back.
 *
 * The unique index admits one per surface, so a handful covers every live
 * thread a workflow can have with room for a surface added later. It is a PAGE
 * and not an unbounded read: a lookup must never turn into a scan of a user's
 * history, however many rows a future bug leaves behind.
 */
const ACTIVE_THREAD_PAGE = 10
const TURN_COLUMNS =
  "id, thread_id, user_id, status, heartbeat_at, model_id, job_id, base_version, final_version, iterations, tool_calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, credits_charged, cancel_requested_at, error, started_at, finished_at"

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export async function getThreadForUser(threadId: string, userId: string): Promise<CopilotThread | null> {
  const { data } = await supabase
    .from("copilot_threads")
    .select(THREAD_COLUMNS)
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle()
  return (data as CopilotThread | null) ?? null
}

/**
 * The user's live thread for this workflow ON THIS SURFACE.
 *
 * Read surface-BLIND and picked in code, for two reasons that pull the same
 * way. A `surface = …` filter is an undefined column on a database that has
 * not taken migration 404 yet, which would take the canvas assistant down for
 * the whole pre-promotion window. And a single-row read over a workflow that
 * now holds two live threads ERRORS — an error that, discarded, reads as "no
 * thread at all", so the caller mints a duplicate and the unique index refuses
 * the insert. So: a page of rows, the surface picked here, and a store error
 * thrown rather than swallowed.
 */
export async function findActiveThread(
  userId: string,
  workflowId: string,
  surface: CopilotSurface,
): Promise<CopilotThread | null> {
  const { data, error } = await supabase
    .from("copilot_threads")
    .select(THREAD_COLUMNS)
    .eq("user_id", userId)
    .eq("workflow_id", workflowId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(ACTIVE_THREAD_PAGE)
  if (error) throw new Error(`findActiveThread: ${error.message}`)
  const rows = (data as CopilotThread[] | null) ?? []
  return rows.find((row) => threadSurface(row) === surface) ?? null
}

export async function countActiveThreads(userId: string): Promise<number> {
  const { count } = await supabase
    .from("copilot_threads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("archived_at", null)
  return count ?? 0
}

/**
 * `createdWorkflow` records that the handshake MADE this workflow, as opposed
 * to opening the copilot on one the user already had. Only the first is the
 * sweep's to delete when the hop never produced a turn (#904).
 *
 * Tolerant of the column not being there yet: reads on this table use a star
 * select for that reason, but an INSERT names its columns, and staging shares
 * the production database — so between the dev merge and the promotion, a
 * column-naming insert would be refused outright and take copilot thread
 * creation down entirely. One retry without the flag, and the worst case is a
 * workflow the sweep declines to touch.
 */
export async function createThread(
  userId: string,
  workflowId: string,
  opts: { createdWorkflow?: boolean; modelTier?: string; surface?: CopilotSurface } = {},
): Promise<CopilotThread> {
  // `model_tier` (migration 344) is on production, so it is named directly —
  // unlike `created_workflow` (349), which the retry below strips when a
  // pre-promotion database rejects it. Written at birth so the thread row is
  // the single tier authority from turn one, and the admin's default only ever
  // affects NEW conversations (an existing thread is `existing ??`-guarded by
  // the caller and never re-defaulted).
  const base: Record<string, unknown> = { user_id: userId, workflow_id: workflowId }
  if (opts.modelTier) base.model_tier = opts.modelTier
  // `surface` (migration 404) is named only when it is NOT the column's own
  // default. A canvas thread therefore inserts exactly what it always did, so
  // a database that has not taken 404 yet still creates one — while a thread
  // of any other surface MUST name it, because a row that silently defaulted
  // to the canvas would be the duplicate the wider index forbids.
  const surface = opts.surface ?? DEFAULT_THREAD_SURFACE
  if (surface !== DEFAULT_THREAD_SURFACE) base.surface = surface
  const insert = async (row: Record<string, unknown>) =>
    supabase.from("copilot_threads").insert(row).select(THREAD_COLUMNS).single()

  let { data, error } = opts.createdWorkflow
    ? await insert({ ...base, created_workflow: true })
    : await insert({ ...base })
  // The retry 349 added, unchanged in what it does: it drops `created_workflow`
  // and nothing else, so a database without THAT column still gets a thread.
  // `surface` deliberately survives it — see above.
  if (opts.createdWorkflow && error && isUndefinedColumn(error)) {
    ;({ data, error } = await insert(base))
  }
  if (error) {
    // `model_tier` is long since on production and `created_workflow` was just
    // stripped, so a column still unknown here is the one this insert named
    // itself. Honest and typed: the route turns it into a 503, never a 500 and
    // never a thread filed under the wrong assistant.
    if (isUndefinedColumn(error) && base.surface !== undefined) {
      throw new ThreadSurfaceNotPromotedError(surface)
    }
    throw new Error(`createThread: ${error.message}`)
  }
  return data as CopilotThread
}

export async function updateThreadSettings(
  threadId: string,
  userId: string,
  patch: { run_mode?: RunMode; auto_run_limit_credits?: number; allow_publishing?: boolean },
): Promise<CopilotThread | null> {
  const { data } = await supabase
    .from("copilot_threads")
    .update(patch)
    .eq("id", threadId)
    .eq("user_id", userId)
    .select(THREAD_COLUMNS)
    .maybeSingle()
  return (data as CopilotThread | null) ?? null
}

export async function archiveThread(threadId: string, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("copilot_threads")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", threadId)
    .eq("user_id", userId)
    .is("archived_at", null)
    .select("id")
  return (data?.length ?? 0) > 0
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

/**
 * The thread's live turn, if any. "Live" is derived from the turn's own
 * heartbeat, never from a thread column: a turn whose process died leaves a
 * `running` row that nothing would otherwise clear, and the thread would be
 * wedged at 409 forever.
 */
export async function findLiveTurn(threadId: string): Promise<CopilotTurn | null> {
  const { data } = await supabase
    .from("copilot_turns")
    .select(TURN_COLUMNS)
    .eq("thread_id", threadId)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const turn = (data as CopilotTurn | null) ?? null
  if (!turn) return null
  const beat = turn.heartbeat_at ? Date.parse(turn.heartbeat_at) : Date.parse(turn.started_at)
  return Number.isFinite(beat) && Date.now() - beat <= TURN_HEARTBEAT_STALE_MS ? turn : null
}

/** Every `running` turn of a thread whose heartbeat has gone stale. */
export async function findStaleTurns(threadId: string): Promise<CopilotTurn[]> {
  const cutoff = new Date(Date.now() - TURN_HEARTBEAT_STALE_MS).toISOString()
  const { data } = await supabase
    .from("copilot_turns")
    .select(TURN_COLUMNS)
    .eq("thread_id", threadId)
    .eq("status", "running")
    .or(`heartbeat_at.is.null,heartbeat_at.lt.${cutoff}`)
  return ((data as CopilotTurn[] | null) ?? []).filter((t) => {
    const beat = t.heartbeat_at ? Date.parse(t.heartbeat_at) : Date.parse(t.started_at)
    return !Number.isFinite(beat) || Date.now() - beat > TURN_HEARTBEAT_STALE_MS
  })
}

/**
 * Claim the thread's one live turn.
 *
 * NULL means the claim was LOST — migration 348's partial unique index
 * (`thread_id` WHERE status = 'running') refused a second live turn, because
 * a concurrent request won the race between the caller's `findLiveTurn` check
 * and this insert. The caller must undo whatever it spent getting here and
 * answer with the same 409 the pre-check gives (#903).
 *
 * A throw stays a throw: only 23505 is the race, and swallowing anything else
 * would turn a broken insert into a silent "someone else is running".
 */
export async function createTurn(input: {
  threadId: string
  userId: string
  modelId: string
  jobId: string
  baseVersion: number | null
}): Promise<CopilotTurn | null> {
  const { data, error } = await supabase
    .from("copilot_turns")
    .insert({
      thread_id: input.threadId,
      user_id: input.userId,
      status: "running",
      model_id: input.modelId,
      job_id: input.jobId,
      base_version: input.baseVersion,
      heartbeat_at: new Date().toISOString(),
    })
    .select(TURN_COLUMNS)
    .single()
  if (error) {
    if ((error as { code?: string }).code === "23505") return null
    throw new Error(`createTurn: ${error.message}`)
  }
  return data as CopilotTurn
}

/** Per-iteration progress. `cost_usd` MUST be persisted here so a crashed turn can still be settled. */
export async function updateTurnProgress(
  turnId: string,
  patch: Partial<Pick<CopilotTurn, "iterations" | "tool_calls" | "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_write_tokens" | "cost_usd" | "final_version">>,
): Promise<void> {
  await supabase
    .from("copilot_turns")
    .update({ ...patch, heartbeat_at: new Date().toISOString() })
    .eq("id", turnId)
}

export async function finishTurn(
  turnId: string,
  status: Exclude<TurnStatus, "running">,
  patch: { error?: string | null; credits_charged?: number | null } = {},
): Promise<void> {
  await supabase
    .from("copilot_turns")
    .update({ status, finished_at: new Date().toISOString(), ...patch })
    .eq("id", turnId)
    .eq("status", "running")
}

/** Proof of life for the turn's process. Best-effort: a missed tick must not fail the turn. */
export async function touchTurnHeartbeat(turnId: string): Promise<void> {
  try {
    await supabase
      .from("copilot_turns")
      .update({ heartbeat_at: new Date().toISOString() })
      .eq("id", turnId)
      .eq("status", "running")
  } catch {
    // The staleness window tolerates several missed ticks.
  }
}

export async function requestTurnCancel(turnId: string): Promise<void> {
  await supabase
    .from("copilot_turns")
    .update({ cancel_requested_at: new Date().toISOString() })
    .eq("id", turnId)
    .eq("status", "running")
}

export async function isCancelRequested(turnId: string): Promise<boolean> {
  const { data } = await supabase
    .from("copilot_turns")
    .select("cancel_requested_at")
    .eq("id", turnId)
    .maybeSingle()
  return Boolean((data as { cancel_requested_at: string | null } | null)?.cancel_requested_at)
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Messages for display. WITHOUT `after` this returns the NEWEST window (then
 * restores order) — a long thread must render its latest exchange, not its
 * first. With `after` it pages forward from that seq, which is what an
 * incremental poll wants.
 */
export async function listMessages(
  threadId: string,
  opts: { after?: number; limit?: number } = {},
): Promise<CopilotMessageRow[]> {
  const limit = opts.limit ?? 200
  const base = supabase
    .from("copilot_messages")
    .select("id, thread_id, turn_id, seq, role, content, context_preamble, text_preview, created_at")
    .eq("thread_id", threadId)
  if (opts.after !== undefined) {
    const { data } = await base.gt("seq", opts.after).order("seq", { ascending: true }).limit(limit)
    return (data as CopilotMessageRow[] | null) ?? []
  }
  return listRecentMessages(threadId, limit)
}

/**
 * The tail of a thread, newest-first then restored to order — what a replay
 * actually needs. Loading a thread from `seq 1` would fetch every message
 * (each up to 256 KB) only for `buildHistory` to throw most of it away.
 */
export async function listRecentMessages(threadId: string, limit: number): Promise<CopilotMessageRow[]> {
  const { data } = await supabase
    .from("copilot_messages")
    .select("id, thread_id, turn_id, seq, role, content, context_preamble, text_preview, created_at")
    .eq("thread_id", threadId)
    .order("seq", { ascending: false })
    .limit(limit)
  return ((data as CopilotMessageRow[] | null) ?? []).slice().reverse()
}

export async function nextSeq(threadId: string): Promise<number> {
  const { data } = await supabase
    .from("copilot_messages")
    .select("seq")
    .eq("thread_id", threadId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle()
  return ((data as { seq: number } | null)?.seq ?? 0) + 1
}

export async function appendMessage(input: {
  threadId: string
  turnId: string
  userId: string
  seq: number
  role: "user" | "assistant"
  content: unknown[]
  contextPreamble?: string | null
  textPreview?: string | null
}): Promise<CopilotMessageRow> {
  const { data, error } = await supabase
    .from("copilot_messages")
    .insert({
      thread_id: input.threadId,
      turn_id: input.turnId,
      user_id: input.userId,
      seq: input.seq,
      role: input.role,
      content: input.content,
      context_preamble: input.contextPreamble ?? null,
      text_preview: input.textPreview?.slice(0, 500) ?? null,
    })
    .select("id, thread_id, turn_id, seq, role, content, context_preamble, text_preview, created_at")
    .single()
  if (error) throw new Error(`appendMessage: ${error.message}`)
  return data as CopilotMessageRow
}

export async function bumpThreadActivity(threadId: string, userTurnDelta: number): Promise<void> {
  const { data } = await supabase
    .from("copilot_threads")
    .select("user_turn_count")
    .eq("id", threadId)
    .maybeSingle()
  const current = (data as { user_turn_count: number } | null)?.user_turn_count ?? 0
  await supabase
    .from("copilot_threads")
    .update({ user_turn_count: current + userTurnDelta, last_message_at: new Date().toISOString() })
    .eq("id", threadId)
}

export function threadAtTurnCap(thread: CopilotThread): boolean {
  return thread.user_turn_count >= THREAD_CAPS.userTurnsPerThread
}
