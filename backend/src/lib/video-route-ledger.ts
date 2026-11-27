/**
 * The ledger of a routed video run (`video_route_ledger`): the
 * facts a routed job's settlement is computed from, written as the run goes —
 * each start before it goes out, each task's billed cost as the route reported
 * it, the add-ons the run delivered, and the settlement's own state. Every
 * exit that settles a routed job (ee/billing/video-route-settlement.ts
 * `settleRoutedJob`) reads THIS, never a figure its caller hands it, so a
 * retry or a recovery charges exactly what the first settle would have.
 *
 * Core (no ee import): the run (lib/alternate-route.ts) writes it on every
 * install; only a Cloud install ever routes, so nothing else writes a row.
 */
import { supabase } from "./supabase.js"
import { getRuntimeEnv } from "./runtime-env.js"
import { VIDEO_ROUTE_STAMP_KEY } from "./video-route-decision.js"

const TABLE = "video_route_ledger"

/** Whether a job row in hand carries a routing decision (no read; the settlement verifies it). */
export function isRoutedJobRow(inputData: Record<string, unknown> | null | undefined): boolean {
  const raw = inputData?.[VIDEO_ROUTE_STAMP_KEY]
  return raw !== undefined && raw !== null
}

// The table is not in the generated types yet (a migration of this PR).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ledger = (): any => supabase.from(TABLE as "assets")

/** One billed task of a routed job (a segment of a plugin's run is a task of its parent, `send` = its number). */
/**
 * How a task's send ended when it did not simply deliver: `failed` / `expired`
 * (the route ended it with no result: not billed), `unresolved` (it started
 * and could not be read to an end: a loss candidate the daily report lists).
 * None of the three is charged.
 */
export type RouteTaskOutcome = "done" | "failed" | "expired" | "unresolved"

/** Whether a task row is a delivered send (what a settlement charges). */
export function deliveredTask(task: { readonly outcome?: RouteTaskOutcome | null }): boolean {
  return task.outcome === undefined || task.outcome === null || task.outcome === "done"
}

/** A start with no task row yet: its send was started and nothing says how it ended. */
export interface UnresolvedStart {
  readonly send: number
  readonly key: string
  readonly ref: string | null
}

export interface LedgerTask {
  readonly send: number
  readonly ref: string | null
  readonly outcome?: RouteTaskOutcome | null
  /** A delivered, billed send whose clip was NOT what the person received (a later send replaced it after a step of ours failed): our loss, never charged. */
  readonly ownLoss?: boolean
  /** The verified bill of the task ({@link verifiedTaskUsd}); null when the route reported none. */
  readonly billedUsd: number | null
}

/**
 * What the route says a task's verified bill is:
 *   - "receipt": a money amount the route's upstream reported for the task;
 *   - "billed-seconds": the seconds the upstream's own record says it billed, at the agreed rate.
 * Both are a verified bill and settle alike; the basis is kept for Admin and the daily check.
 */
export type RouteCostBasis = "receipt" | "billed-seconds"

const finiteUsd = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null)
/** A bill is a positive amount: zero or less is no bill (the run stays pending, with an alert), never a free run. */
const billUsd = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null)

/**
 * THE verified cost a routed task settles at: the bill the route reported
 * (`billed_usd`, its `providerCostUsd`), whatever its basis. Null: the route
 * reported no bill, and the settlement stays pending. An estimate
 * (`estimated_usd`) is recorded beside it and is NEVER a bill: nothing here
 * reads it.
 */
export function verifiedTaskUsd(row: { billed_usd?: unknown }): number | null {
  const v = row.billed_usd
  return billUsd(typeof v === "string" && v !== "" ? Number(v) : v)
}

/** The basis of the bill a done read reported; undefined when it reported none (an estimate alone is no bill). */
export function routeCostBasisOf(reported: { providerCostUsd?: number | null; costBasis?: unknown }): RouteCostBasis | undefined {
  if (billUsd(reported.providerCostUsd) === null) return undefined
  return reported.costBasis === "billed-seconds" ? "billed-seconds" : "receipt"
}

/** The verified bill a done read reported ({@link verifiedTaskUsd}); null when it reported none. */
export function verifiedReportedUsd(reported: { providerCostUsd?: number | null }): number | null {
  return billUsd(reported.providerCostUsd)
}

/**
 * `retry`: not settled yet (the sweep settles it again). `hold`: its verified
 * bill is far above its quote; an admin confirms or rejects it (never swept).
 * `done` / `shortfall`: charged. `waived`: an admin rejected the bill; the
 * hold was released and `uncollected` is the charge not taken.
 */
export type LedgerSettleState = "retry" | "hold" | "unbilled" | "done" | "shortfall" | "waived"

/**
 * An admin's decision: on a `hold`, `confirmed` (charge the bill in full) or
 * `rejected` (release it); on an `unbilled` settlement, `quote` (charge each
 * send the route never billed at its quote) or `rejected` (release it).
 */
export type LedgerSettleDecision = "confirmed" | "rejected" | "quote"

export interface RouteLedger {
  readonly starts: readonly number[]
  readonly tasks: readonly LedgerTask[]
  /** A plugin run's segments (rows of the parent job, by segment key). */
  readonly segments: ReadonlyArray<{ readonly key: string; readonly ref: string | null; readonly outcome?: RouteTaskOutcome | null; readonly billedUsd: number | null; readonly priceId: string | null; readonly quoteFactor?: number | null; readonly quotedUsd: number | null; readonly quotedCredits: number | null }>
  /** Delivered add-ons, base credits; undefined when the completion recorded none. */
  readonly addonsBase: number | undefined
  readonly settle: { readonly state: LedgerSettleState; readonly updatedAt: string; readonly credits: number | null; readonly uncollected: number | null; readonly decision: LedgerSettleDecision | null; readonly attempts?: number
    /** An admin chose to charge the sends the route never billed at their quote (kept even when the settlement is then held for its total). */
    readonly atQuote?: boolean
    readonly detail?: Readonly<Record<string, unknown>> | null } | undefined
  /** Starts (a job's own sends and a run's segments) with no task row: not read to an end yet. */
  readonly unresolvedStarts?: readonly UnresolvedStart[]
}

/**
 * Records that send `send` of the job is about to start, BEFORE the call:
 * "recorded" for the first such record, "exists" when one is there already
 * (a start of this send may have gone out: never start another), "error" when
 * it could not be told (never start on a guess).
 */
export async function recordRouteStart(
  jobId: string,
  send: number,
  key = "",
  /** A segment's quote (its price id, factored USD and charged credits). */
  quote?: { priceId: string; factor?: number; quotedUsd: number; chargedCredits: number },
): Promise<"recorded" | "exists" | "error"> {
  try {
    const { error } = await ledger().insert({
      job_id: jobId,
      env: getRuntimeEnv(),
      kind: "start",
      send,
      key,
      ...(quote ? { price_id: quote.priceId, quote_factor: quote.factor, quoted_usd: quote.quotedUsd, credits: quote.chargedCredits } : {}),
    })
    if (!error) return "recorded"
    if (error.code === "23505") return "exists"
    console.warn(`[video-route-ledger] job ${jobId}: recording start ${send} failed: ${error.message}`)
    return "error"
  } catch (err) {
    console.warn(`[video-route-ledger] job ${jobId}: recording start ${send} failed: ${err instanceof Error ? err.message : String(err)}`)
    return "error"
  }
}

/** Persist the supplier reference even when the first write loses its response. */
export async function recordRouteStartRef(jobId: string, send: number, key: string, ref: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await ledger().update({ ref, updated_at: new Date().toISOString() })
        .eq("job_id", jobId).eq("kind", "start").eq("send", send).eq("key", key).select("id").maybeSingle()
      if (!error && data) return
    } catch {
      // Writing the same reference to this unique start is idempotent.
    }
  }
  throw new Error(`Job ${jobId}: could not persist its supplier task reference`)
}

/** Withdraws a start record of a send whose start was refused before anything was created (so its one retry can record its own). */
export async function withdrawRouteStart(jobId: string, send: number, key = ""): Promise<boolean> {
  try {
    const { error } = await ledger().delete().eq("job_id", jobId).eq("kind", "start").eq("send", send).eq("key", key)
    return !error
  } catch {
    return false
  }
}

/**
 * When a task's verified bill was first recorded on the ledger (`detail.billedAt`,
 * set once: a later write of the same bill never moves it). The daily
 * reconciliation counts a bill on the day it was RECORDED, so one that arrives
 * after its task's row was written lands on the day it arrived, not on no day.
 * Undefined for a row whose bill went on with the row itself (its `created_at`).
 */
export function billedAtOf(detail: unknown): string | undefined {
  const at = detailOf(detail)?.billedAt
  return typeof at === "string" && Number.isFinite(Date.parse(at)) ? at : undefined
}

/**
 * Records the bill of the job's task of send `send` as the route reported it
 * (`billedUsd`, with `basis` saying what it is; null: none reported), and the
 * route's estimate beside it when it gave one (kept for the record, never
 * settled from). Written on every read that finds it done; a later write of
 * the same send keeps a reported bill over none, never changes how the send
 * ended (`outcome`: a start given up on stays given up, whatever it is billed),
 * and keeps what else the row carries (`detail`). The first bill of a row is
 * stamped with when it was recorded ({@link billedAtOf}). Retries once, then
 * throws so an unrecorded task cannot be published as delivered.
 */
export async function recordRouteTask(jobId: string, send: number, ref: string | null, billedUsd: number | null | undefined, key = "", estimatedUsd?: number | null, basis?: RouteCostBasis): Promise<boolean> {
  const billed = billUsd(billedUsd)
  const estimated = finiteUsd(estimatedUsd)
  const write = async (): Promise<boolean> => {
    const at = new Date().toISOString()
    // With no bill: the row is written once and never over another (a bill already there is kept).
    if (billed === null) {
      const { error } = await ledger().upsert(
        { job_id: jobId, env: getRuntimeEnv(), kind: "task", send, key, ref, billed_usd: null, ...(estimated !== null ? { estimated_usd: estimated } : {}), updated_at: at },
        { onConflict: "job_id,kind,send,key", ignoreDuplicates: true },
      )
      return !error
    }
    const fields = { ref, billed_usd: billed, cost_basis: basis ?? "receipt", ...(estimated !== null ? { estimated_usd: estimated } : {}), updated_at: at }
    // A new row with its bill: recorded now (its `created_at`).
    const inserted = await ledger().insert({ job_id: jobId, env: getRuntimeEnv(), kind: "task", send, key, ...fields })
    if (!inserted.error) return true
    if (inserted.error.code !== "23505") return false
    const read = await ledger().select("id, billed_usd, detail").eq("job_id", jobId).eq("kind", "task").eq("send", send).eq("key", key).limit(1)
    const row = ((read.data ?? []) as Array<{ id?: unknown; billed_usd?: unknown; detail?: unknown }>)[0]
    if (read.error || !row) return false
    if (verifiedTaskUsd(row) === null) {
      // The bill arrives on a row written without one: it is recorded NOW (set once, in the same
      // compare-and-set that writes the bill, so two writers cannot both stamp it).
      const { data, error } = await ledger().update({ ...fields, detail: { ...(detailOf(row.detail) ?? {}), billedAt: at } })
        .eq("id", row.id).is("billed_usd", null).select("id")
      if (error) return false
      if (Array.isArray(data) && data.length > 0) return true
    }
    // A bill there already: the route's latest figure is kept, and when it was first recorded is not moved.
    const { error } = await ledger().update(fields).eq("id", row.id)
    return !error
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (await write()) return true
    } catch {
      // Retry a lost response using the same unique task key.
    }
  }
  throw new Error(`Job ${jobId}: could not record the routed task for send ${send}`)
}

/** Records the settlement's state without reopening a completed receipt. */
export async function recordRouteSettle(jobId: string, state: Exclude<LedgerSettleState, "hold" | "unbilled">, fields: { credits?: number; uncollected?: number; note?: string } = {}): Promise<void> {
  const { error } = await ledger().upsert(
      {
        job_id: jobId,
        env: getRuntimeEnv(),
        kind: "settle",
        send: 1,
        state,
        credits: fields.credits ?? null,
        uncollected: fields.uncollected ?? null,
        note: fields.note?.slice(0, 500) ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "job_id,kind,send,key", ignoreDuplicates: state === "retry" },
    )
  if (error) throw new Error(`Job ${jobId}: could not record its settlement (${state}): ${error.message}`)
}

function detailOf(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
}

/**
 * A stamp for a compare-and-set write that is strictly later than the one it
 * replaces. Compared as instants, never as text: the database answers
 * `+00:00` where JavaScript writes `Z`, and with microseconds. A write in the
 * same millisecond as the last one would otherwise leave the stamp unchanged,
 * and a concurrent writer's compare-and-set on it would then succeed over
 * this write.
 */
export function nextLedgerStamp(previous: unknown, now = Date.now()): string {
  const before = typeof previous === "string" ? Date.parse(previous) : NaN
  return new Date(Number.isFinite(before) ? Math.max(now, Math.floor(before) + 1) : now).toISOString()
}

/**
 * Merges `patch` into the settle row's `detail` (and sets `columns` beside it).
 * A compare-and-set on the detail it read, tried a few times: a concurrent
 * writer's keys (the first attempt's time, the watch, a late bill) are never
 * lost to a stale read. With `onlyStates`, only a row still in one of those
 * states is written (a row that moved on meanwhile is left as it is). False
 * when nothing was written (no row, a row in another state, a write that
 * failed): a caller that needs the write says so (ee/billing/video-route-receipt.ts
 * `patchSettleOrAlert`). Never throws.
 */
export async function patchRouteSettle(jobId: string, patch: Record<string, unknown>, columns: Record<string, unknown> = {}, opts: { onlyStates?: readonly LedgerSettleState[] } = {}): Promise<boolean> {
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error: readError } = await ledger().select("id, detail, state, updated_at").eq("job_id", jobId).eq("kind", "settle").limit(1)
      const row = ((data ?? []) as Array<{ id?: unknown; detail?: unknown; state?: unknown; updated_at?: unknown }>)[0]
      if (readError || !row) return false
      if (opts.onlyStates && !opts.onlyStates.includes(row.state as LedgerSettleState)) return false
      const current = detailOf(row.detail) ?? {}
      let write = ledger().update({ ...columns, detail: { ...current, ...patch }, updated_at: nextLedgerStamp(row.updated_at) })
        .eq("id", row.id).eq("updated_at", row.updated_at)
      if (opts.onlyStates) write = write.in("state", [...opts.onlyStates])
      const { data: written, error } = await write.select("id")
      if (error) return false
      if (Array.isArray(written) && written.length > 0) return true
    }
    return false
  } catch {
    return false
  }
}

/** Marks a delivered send as our own loss (its clip was replaced after a step of ours failed). False when it could not be written; never throws. */
export async function markRouteTaskOwnLoss(jobId: string, send: number): Promise<boolean> {
  try {
    // Merged into what the row carries (when its bill was recorded), a compare-and-set on the stamp it read.
    for (let attempt = 0; attempt < 4; attempt++) {
      const read = await ledger().select("id, detail, updated_at").eq("job_id", jobId).eq("kind", "task").eq("send", send).eq("key", "").limit(1)
      const row = ((read.data ?? []) as Array<{ id?: unknown; detail?: unknown; updated_at?: unknown }>)[0]
      if (read.error || !row) return false
      const { data, error } = await ledger().update({ detail: { ...(detailOf(row.detail) ?? {}), ownLoss: true }, updated_at: nextLedgerStamp(row.updated_at) })
        .eq("id", row.id).eq("updated_at", row.updated_at).select("id")
      if (error) return false
      if (Array.isArray(data) && data.length > 0) return true
    }
    return false
  } catch {
    return false
  }
}

function outcomeOf(raw: unknown): RouteTaskOutcome | null {
  return raw === "done" || raw === "failed" || raw === "expired" || raw === "unresolved" ? raw : null
}

/**
 * Records how a send that did not deliver ended (`failed`, `expired`,
 * `unresolved`): a task row with no bill. Never over a task that has a bill
 * (a delivered send stays delivered). Never throws: a missed record leaves
 * the start unresolved, which the settlement reads again.
 */
export async function recordRouteTaskOutcome(jobId: string, send: number, key: string, ref: string | null, outcome: Exclude<RouteTaskOutcome, "done">): Promise<boolean> {
  try {
    const row = { job_id: jobId, env: getRuntimeEnv(), kind: "task", send, key, ref, billed_usd: null, outcome, updated_at: new Date().toISOString() }
    const inserted = await ledger().insert(row)
    if (!inserted.error) return true
    if (inserted.error.code !== "23505") return false
    // Only over a row that already says the send did NOT deliver: a task recorded delivered
    // (no outcome, or `done`) stays delivered whatever is learned of it later.
    const { data, error } = await ledger().update({ outcome, updated_at: row.updated_at })
      .eq("job_id", jobId).eq("kind", "task").eq("send", send).eq("key", key).is("billed_usd", null)
      .in("outcome", ["failed", "expired", "unresolved"]).select("id")
    return !error && Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

/** Notes one more attempt to settle, and when the next is due (the sweep's backoff). Never throws. */
export async function noteRouteSettleAttempt(jobId: string, attempts: number, nextAttemptAt: Date): Promise<void> {
  try {
    await ledger().update({ attempts, next_attempt_at: nextAttemptAt.toISOString() })
      .eq("job_id", jobId).eq("kind", "settle").eq("state", "retry")
  } catch {
    // The sweep simply tries again on its next pass.
  }
}

/**
 * Moves a settlement whose route never reported a bill into `unbilled`
 * (compare-and-set from `retry` with no decision): it waits for an admin,
 * who settles it at its quote or releases it. True when THIS call moved it.
 */
export async function markRouteSettleUnbilled(jobId: string, fields: { credits: number | null; quotedUsd: number | null; note: string; nextAttemptAt?: Date }): Promise<boolean> {
  return enterHeldState(jobId, "unbilled", { credits: fields.credits, quoted_usd: fields.quotedUsd, note: fields.note.slice(0, 500), next_attempt_at: fields.nextAttemptAt?.toISOString() ?? null })
}

/**
 * Moves the settle row from `retry` (no decision) into `hold` / `unbilled`, and
 * stamps when it did (`detail.heldAt`) in the SAME compare-and-set: what Admin
 * and the daily reminder show as "waiting since", never the row's `updated_at`
 * (which every later write of the row moves). Merged into the detail it read,
 * on the stamp it read, so a concurrent detail write is never lost. True when
 * THIS call moved it; false when the row is not (or no longer) `retry` with no
 * decision. Throws when it could not be written.
 */
async function enterHeldState(jobId: string, state: "hold" | "unbilled", columns: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const read = await ledger().select("id, state, decision, detail, updated_at").eq("job_id", jobId).eq("kind", "settle").limit(1)
    if (read.error) throw new Error(`Job ${jobId}: could not read its settlement to move it to ${state}: ${read.error.message}`)
    const row = ((read.data ?? []) as Array<{ id?: unknown; state?: unknown; decision?: unknown; detail?: unknown; updated_at?: unknown }>)[0]
    if (!row || row.state !== "retry" || (row.decision ?? null) !== null) return false
    const at = new Date().toISOString()
    const { data, error } = await ledger()
      .update({ ...columns, state, detail: { ...(detailOf(row.detail) ?? {}), heldAt: at }, updated_at: nextLedgerStamp(row.updated_at) })
      .eq("id", row.id).eq("updated_at", row.updated_at).eq("state", "retry").is("decision", null).select("id")
    if (error) throw new Error(`Job ${jobId}: could not move its settlement to ${state}: ${error.message}`)
    if (Array.isArray(data) && data.length > 0) return true
  }
  return false
}

/** When a held settlement started waiting: `detail.heldAt`, else (a row held before it was kept) when the row was created — never its `updated_at`. */
function heldAtOf(row: Record<string, unknown>): string {
  const kept = detailOf(row.detail)?.heldAt
  return typeof kept === "string" && kept ? kept : String(row.created_at ?? "")
}

/** What a settlement held for an admin's decision records beside its state. */
export interface RouteSettleHold {
  /** The charge the bill comes to, in credits (taken in full on a confirm). */
  readonly credits: number
  readonly billedUsd: number
  readonly quotedUsd: number
  readonly note: string
}

/**
 * Moves the job's settlement into `hold` (compare-and-set: only from `retry`
 * with no decision, or from nothing). True when THIS call entered the hold —
 * the one caller that alerts; false when it was held already or has moved on.
 * Throws when it could not be written (the settle is then retried).
 */
export async function holdRouteSettle(jobId: string, hold: RouteSettleHold): Promise<boolean> {
  const fields = { credits: hold.credits, billed_usd: hold.billedUsd, quoted_usd: hold.quotedUsd, note: hold.note.slice(0, 500) }
  const at = new Date().toISOString()
  const inserted = await ledger().insert({ job_id: jobId, env: getRuntimeEnv(), kind: "settle", send: 1, state: "hold", ...fields, detail: { heldAt: at }, updated_at: at })
  if (!inserted.error) return true
  if (inserted.error.code !== "23505") throw new Error(`Job ${jobId}: could not hold its settlement: ${inserted.error.message}`)
  // A settlement an admin settled "at its quote" whose total turns out far above the quote is
  // held like any other: that decision is spent (what it chose stays in `detail.atQuote`).
  // A `confirmed` given for a smaller total is spent the same way: the new total needs its own.
  await ledger().update({ decision: null }).eq("job_id", jobId).eq("kind", "settle").eq("state", "retry").in("decision", ["quote", "confirmed"])
  return enterHeldState(jobId, "hold", fields)
}

/**
 * Records an admin's decision on a held settlement (compare-and-set: only a
 * `hold` with no decision) and hands it back to the settlement (`retry`),
 * which charges it in full or releases it. True when THIS call decided it.
 */
export async function decideRouteSettleHold(jobId: string, decision: LedgerSettleDecision, adminId: string, kind: "anomaly" | "unbilled" = "anomaly", decidedForCredits?: number): Promise<boolean> {
  // `quote` is remembered beside the decision: if the total is then held for its size, a later
  // confirm still charges the unbilled sends at their quote. The total the admin saw is kept too:
  // a confirm holds only for that total (video-route-receipt.ts `commitRoutedCharge`).
  const kept = { ...(decision === "quote" ? { atQuote: true } : {}), ...(decidedForCredits !== undefined ? { decidedForCredits } : {}) }
  // Written IN the decision's own compare-and-set, so a click that loses the race changes nothing.
  const read = await ledger().select("detail").eq("job_id", jobId).eq("env", getRuntimeEnv()).eq("kind", "settle").limit(1)
  if (read.error) throw new Error(`Job ${jobId}: could not read its held settlement: ${read.error.message}`)
  const current = detailOf(((read.data ?? []) as Array<{ detail?: unknown }>)[0]?.detail) ?? {}
  const { data, error } = await ledger()
    // The decision applies promptly: any wait the sweep had scheduled is cleared.
    .update({ state: "retry", decision, decided_by: adminId, decided_at: new Date().toISOString(), updated_at: new Date().toISOString(), next_attempt_at: null, detail: { ...current, ...kept } })
    // Pinned to the kind the admin was shown: a row that changed kind meanwhile is not decided by this click.
    .eq("job_id", jobId).eq("env", getRuntimeEnv()).eq("kind", "settle").eq("state", kind === "unbilled" ? "unbilled" : "hold").is("decision", null).select("id")
  if (error) throw new Error(`Job ${jobId}: could not record the decision on its held settlement: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

/** A settlement the sweep still watches for a bill that may arrive late. */
export interface LateBillWatch {
  readonly jobId: string
  readonly state: LedgerSettleState
  readonly credits: number | null
  readonly uncollected: number | null
  readonly detail: Readonly<Record<string, unknown>>
}

/** This environment's settlements due for a late-bill read: `unbilled`, or settled / released with a send the route had not billed. Throws on a database error. */
export async function readLateBillWatches(now: Date, limit = 500): Promise<LateBillWatch[]> {
  const { data, error } = await ledger().select("job_id, state, credits, uncollected, detail")
    .eq("env", getRuntimeEnv()).eq("kind", "settle").in("state", ["unbilled", "done", "shortfall", "waived"])
    .lte("next_attempt_at", now.toISOString()).order("id", { ascending: true }).limit(limit)
  if (error) throw new Error(`Could not read the late-bill watches: ${error.message}`)
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({ jobId: String(r.job_id), state: r.state as LedgerSettleState, credits: num(r.credits), uncollected: num(r.uncollected), detail: detailOf(r.detail) ?? {} }))
}

/** An `unbilled` settlement whose bill has arrived goes back to the settlement (`retry`), where it is checked like any bill. True when THIS call moved it. */
export async function reopenUnbilledSettle(jobId: string): Promise<boolean> {
  const { data, error } = await ledger().update({ state: "retry", next_attempt_at: null, updated_at: new Date().toISOString() })
    .eq("job_id", jobId).eq("kind", "settle").eq("state", "unbilled").is("decision", null).select("id")
  if (error) throw new Error(`Job ${jobId}: could not reopen its unbilled settlement: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

/** How many settlements of this environment had a late bill recorded since `sinceIso`. Throws on a database error. */
export async function countLateBills(sinceIso: string): Promise<number> {
  const { count, error } = await ledger().select("id", { count: "exact", head: true })
    .eq("env", getRuntimeEnv()).eq("kind", "settle").gte("detail->lateBill->>at", sinceIso)
  if (error) throw new Error(`Could not count the late bills: ${error.message}`)
  return typeof count === "number" ? count : 0
}

/**
 * How many deferred repayments of this environment were left for an admin:
 * the database's retry gave up on them after its failed tries
 * (`retry_deferred_video_repayments`, `attempts` at its limit). Throws on a
 * database error.
 */
export async function countStuckDeferredRepayments(): Promise<number> {
  const { count, error } = await (supabase.from("video_route_deferred_repayments" as "assets") as any).select("id", { count: "exact", head: true })
    .eq("env", getRuntimeEnv()).gte("attempts", DEFERRED_REPAYMENT_MAX_ATTEMPTS)
  if (error) throw new Error(`Could not count the stuck deferred repayments: ${error.message}`)
  return typeof count === "number" ? count : 0
}

/** The failed tries after which the database's retry leaves a deferred repayment for an admin. */
export const DEFERRED_REPAYMENT_MAX_ATTEMPTS = 10

/**
 * Environments other than this one with settlements still waiting to be SWEPT
 * (`retry`), and how many. A settlement held for an admin (`hold`, `unbilled`)
 * is not one: it waits by design, in its own environment's Admin, and is no
 * business of this one. Throws on a database error.
 */
export async function readOtherEnvOpenSettles(limit = 1000): Promise<Array<{ env: string; open: number }>> {
  const { data, error } = await ledger().select("env").neq("env", getRuntimeEnv()).eq("kind", "settle").eq("state", "retry").limit(limit)
  if (error) throw new Error(`Could not read other environments' open settlements: ${error.message}`)
  const counts = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ env?: unknown }>) if (typeof r.env === "string") counts.set(r.env, (counts.get(r.env) ?? 0) + 1)
  return [...counts].map(([env, open]) => ({ env, open }))
}

/** Whether an environment wrote anything to the ledger since `sinceIso` (it is alive). Throws on a database error. */
export async function envWroteLedgerSince(env: string, sinceIso: string): Promise<boolean> {
  const { data, error } = await ledger().select("id").eq("env", env).gte("updated_at", sinceIso).limit(1)
  if (error) throw new Error(`Could not read the ledger of ${env}: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

export interface HeldRouteSettle {
  readonly jobId: string
  /** `anomaly`: its bill is far above its quote (confirm or reject). `unbilled`: the route never reported a bill (settle at the quote or release). */
  readonly kind: "anomaly" | "unbilled"
  readonly credits: number | null
  readonly billedUsd: number | null
  readonly quotedUsd: number | null
  readonly note: string | null
  readonly heldAt: string
}

/** This environment's settlements held for a decision, oldest first. Throws on a database error. */
export async function readHeldRouteSettles(limit = 200): Promise<HeldRouteSettle[]> {
  const { data, error } = await ledger().select("job_id, state, credits, billed_usd, quoted_usd, note, detail, created_at")
    .eq("env", getRuntimeEnv()).eq("kind", "settle").in("state", ["hold", "unbilled"]).order("id", { ascending: true }).limit(limit)
  if (error) throw new Error(`Could not read the held settlements: ${error.message}`)
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null)
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    jobId: String(r.job_id), kind: r.state === "unbilled" ? "unbilled" as const : "anomaly" as const, credits: num(r.credits), billedUsd: num(r.billed_usd), quotedUsd: num(r.quoted_usd),
    note: typeof r.note === "string" ? r.note : null, heldAt: heldAtOf(r),
  }))
}

/** One job's held settlement in this environment, or null when it is not held. Throws on a database error. */
export async function readHeldRouteSettle(jobId: string): Promise<HeldRouteSettle | null> {
  const { data, error } = await ledger().select("job_id, state, credits, billed_usd, quoted_usd, note, detail, created_at")
    .eq("job_id", jobId).eq("env", getRuntimeEnv()).eq("kind", "settle").in("state", ["hold", "unbilled"]).limit(1)
  if (error) throw new Error(`Could not read the held settlement: ${error.message}`)
  const r = ((data ?? []) as Array<Record<string, unknown>>)[0]
  if (!r) return null
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null)
  return { jobId: String(r.job_id), kind: r.state === "unbilled" ? "unbilled" : "anomaly", credits: num(r.credits), billedUsd: num(r.billed_usd), quotedUsd: num(r.quoted_usd), note: typeof r.note === "string" ? r.note : null, heldAt: heldAtOf(r) }
}

/** How many settlements this environment holds for a decision, and since when the oldest has waited ({@link heldAtOf}). Throws on a database error. */
export async function countHeldRouteSettles(limit = 1000): Promise<{ count: number; oldestAt: string | null }> {
  const { data, error, count } = await ledger().select("detail, created_at", { count: "exact" })
    .eq("env", getRuntimeEnv()).eq("kind", "settle").in("state", ["hold", "unbilled"]).order("id", { ascending: true }).limit(limit)
  if (error) throw new Error(`Could not count the held settlements: ${error.message}`)
  const rows = (data ?? []) as Array<Record<string, unknown>>
  let oldest: number | null = null
  for (const r of rows) {
    const at = Date.parse(heldAtOf(r))
    if (Number.isFinite(at) && (oldest === null || at < oldest)) oldest = at
  }
  return { count: typeof count === "number" ? count : rows.length, oldestAt: oldest === null ? null : new Date(oldest).toISOString() }
}

/** The job's ledger; throws when it cannot be read (a settlement never guesses). */
export async function readRouteLedger(jobId: string): Promise<RouteLedger> {
  const { data, error } = await ledger().select("kind, send, key, ref, billed_usd, cost_basis, outcome, attempts, detail, price_id, quote_factor, quoted_usd, addons_base, state, decision, credits, uncollected, updated_at").eq("job_id", jobId)
  if (error) throw new Error(`reading the route ledger of job ${jobId} failed: ${error.message}`)
  const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null)
  const settleRow = rows.find((r) => r.kind === "settle")
  const addonsRow = rows.find((r) => r.kind === "addons")
  return {
    starts: rows.filter((r) => r.kind === "start" && (r.key ?? "") === "").map((r) => Number(r.send)),
    // A segment is what was STARTED (its quote is on its start), with its task's
    // reported billed cost when it ended; a segment whose task never read done
    // (failed, or not ended yet) is not charged.
    segments: rows
      .filter((r) => r.kind === "task" && typeof r.key === "string" && r.key !== "")
      .map((t) => {
        const start = rows.find((r) => r.kind === "start" && r.key === t.key)
        return {
          key: t.key as string,
          ref: typeof t.ref === "string" ? t.ref : null,
          outcome: outcomeOf(t.outcome),
          billedUsd: verifiedTaskUsd(t),
          priceId: typeof start?.price_id === "string" ? start.price_id : null,
          quoteFactor: num(start?.quote_factor),
          quotedUsd: num(start?.quoted_usd),
          quotedCredits: num(start?.credits),
        }
      }),
    tasks: rows
      .filter((r) => r.kind === "task" && (r.key ?? "") === "")
      .map((r) => ({ send: Number(r.send), ref: typeof r.ref === "string" ? r.ref : null, outcome: outcomeOf(r.outcome), ...(detailOf(r.detail)?.ownLoss === true ? { ownLoss: true } : {}), billedUsd: verifiedTaskUsd(r) }))
      .sort((a, b) => a.send - b.send),
    addonsBase: addonsRow ? (num(addonsRow.addons_base) ?? 0) : undefined,
    unresolvedStarts: rows
      .filter((r) => r.kind === "start" && !rows.some((t) => t.kind === "task" && Number(t.send) === Number(r.send) && (t.key ?? "") === (r.key ?? "")))
      .map((r) => ({ send: Number(r.send), key: typeof r.key === "string" ? r.key : "", ref: typeof r.ref === "string" ? r.ref : null })),
    settle: settleRow
      ? {
          state: settleRow.state as LedgerSettleState,
          updatedAt: String(settleRow.updated_at ?? ""),
          credits: num(settleRow.credits),
          uncollected: num(settleRow.uncollected),
          decision: settleRow.decision === "confirmed" || settleRow.decision === "rejected" || settleRow.decision === "quote" ? settleRow.decision : null,
          attempts: num(settleRow.attempts) ?? 0,
          atQuote: settleRow.decision === "quote" || detailOf(settleRow.detail)?.atQuote === true,
          detail: detailOf(settleRow.detail),
        }
      : undefined,
  }
}
