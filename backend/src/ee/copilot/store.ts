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

export interface CopilotThread {
  id: string
  user_id: string
  workflow_id: string
  run_mode: RunMode
  auto_run_limit_credits: number
  user_turn_count: number
  archived_at: string | null
  last_message_at: string | null
  created_at: string
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

const THREAD_COLUMNS =
  "id, user_id, workflow_id, run_mode, auto_run_limit_credits, user_turn_count, archived_at, last_message_at, created_at"
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

export async function findActiveThread(userId: string, workflowId: string): Promise<CopilotThread | null> {
  const { data } = await supabase
    .from("copilot_threads")
    .select(THREAD_COLUMNS)
    .eq("user_id", userId)
    .eq("workflow_id", workflowId)
    .is("archived_at", null)
    .maybeSingle()
  return (data as CopilotThread | null) ?? null
}

export async function countActiveThreads(userId: string): Promise<number> {
  const { count } = await supabase
    .from("copilot_threads")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("archived_at", null)
  return count ?? 0
}

export async function createThread(userId: string, workflowId: string): Promise<CopilotThread> {
  const { data, error } = await supabase
    .from("copilot_threads")
    .insert({ user_id: userId, workflow_id: workflowId })
    .select(THREAD_COLUMNS)
    .single()
  if (error) throw new Error(`createThread: ${error.message}`)
  return data as CopilotThread
}

export async function updateThreadSettings(
  threadId: string,
  userId: string,
  patch: { run_mode?: RunMode; auto_run_limit_credits?: number },
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

export async function createTurn(input: {
  threadId: string
  userId: string
  modelId: string
  jobId: string
  baseVersion: number | null
}): Promise<CopilotTurn> {
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
  if (error) throw new Error(`createTurn: ${error.message}`)
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
