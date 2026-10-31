// backend/src/lib/concurrency-lanes/types.ts — the vocabulary of per-user
// concurrency lanes. "Concurrency lane", not "lane": that word already names
// the LLM serving lane (direct / KIE). Types only; nothing here runs (the
// closed list of leaf lanes is a value, so it lives in leaf-lanes.ts).
import type { LeafLane } from "./leaf-lanes.js"

/**
 * The four lanes a user's work is counted in. `provider`: calls to an external
 * AI provider other than LLM text; `llm`: LLM text calls; `local`: in-house
 * compute (ffmpeg, sharp, Remotion); `run`: top-level runs (workflow
 * executions, pipelines, directors, top-level plugin coordinators).
 */
export type ConcurrencyLane = "provider" | "llm" | "local" | "run"

/** A lane a leaf job holds one slot of while it runs; `run` is held only by a top-level coordinator. */
export type { LeafLane } from "./leaf-lanes.js"

/** Fails to compile unless LEAF_LANES is exactly every concurrency lane but `run`. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Holds<T extends true> = T
export type LeafLanesAreTheNonRunLanes = Holds<Same<LeafLane, Exclude<ConcurrencyLane, "run">>>

/**
 * What a job is: a leaf does the work itself and holds a slot of its lane; a
 * coordinator dispatches children (or makes several calls in a row) and holds
 * no leaf slot — a top-level one holds a `run` slot, a nested one none.
 */
export type LaneClass = { kind: "leaf"; lane: LeafLane } | { kind: "coordinator" }

/** How many jobs of each lane one line (user × payer) runs at once. */
export interface LaneSizes { provider: number; llm: number; local: number; run: number }

/** Who pays for a job: each payer is its own line. */
export type PayerKey = `user:${string}` | `workspace:${string}` | `deployment:${string}`

/** Why a job is waiting: its own lane is full, the provider's platform ceiling, or the server share. */
export type WaitReason = "user_lane" | "provider_ceiling" | "server_busy"

/** What a waiting job tells its caller. */
export interface WaitInfo {
  lane: ConcurrencyLane
  /** 1-based, in its (user, payer, lane). */
  position: number
  limit: number
  running: number
  reason: WaitReason
  waitedMs: number
  enqueuedAtMs: number
}

/** Where a lane entry came from: a BullMQ queue, a live (sync HTTP) call, or an in-process call. */
export type LaneQueueName = "video-generation" | "video-render" | "workflow-orchestration" | "pipeline-orchestration"
  | "video-director" | "live" | "inline"

/** What the gate keeps about each entry, for waking it and for the admin page. */
export interface LaneEntryMeta {
  jobId: string
  userId: string
  payer: PayerKey
  lane: ConcurrencyLane
  provider: string | null
  source: string | null
  sourceDetail: string | null
  jobType: string
  model: string | null
  queue: LaneQueueName
  bullJobId: string | null
}

/** The live picture: every line's lanes, every provider's running count, and what is not gated. */
export interface LaneSnapshot {
  lines: Array<{
    userId: string
    payer: PayerKey
    lanes: Record<ConcurrencyLane, { running: number; overLimit: number; queued: number }>
    /** The size the gate last stored for each lane of this line; 0 = the line has no such lane yet. */
    limits: Record<ConcurrencyLane, number>
    oldestWaitMs: number
    sources: Record<string, number>
    /** The line's MCP entries by client name, as the caller named itself: shown live only, never stored in the history. */
    mcpClients: Record<string, number>
  }>
  providers: Array<{
    provider: string
    running: number
    byUser: Record<string, number>
    completed15m: number
    failed15m: number
    /** The provider's platform ceiling; null = none. */
    ceiling: number | null
    /** Outcomes per minute (epoch minute) of the same 15-minute window, oldest first. */
    outcomesByMinute: Array<{ minute: number; completed: number; failed: number }>
  }>
  ungated: Record<string, number>
  notLimited: Record<string, number>
  enforced: boolean
}

/** One entry of a user's lines, as the Live usage drill-down shows it (ConcurrencyGate.userEntries). */
export interface LaneUserEntry {
  jobId: string
  payer: PayerKey
  lane: ConcurrencyLane
  /** `running`: holds a lease (over its limit when `overLimit`); `queued`: waits in its line. */
  state: "running" | "queued"
  provider: string | null
  source: string | null
  sourceDetail: string | null
  jobType: string | null
  model: string | null
  overLimit: boolean
  /** How long a running entry has held its lease; null for a queued one, or a lease older than the stamp. */
  runningMs: number | null
  /** How long a queued entry has waited; null for a running one. */
  waitedMs: number | null
  /** A queued entry's 1-based place in its line; null for a running one. */
  position: number | null
  /** Why a queued entry waits; null for a running one. */
  reason: WaitReason | null
}
