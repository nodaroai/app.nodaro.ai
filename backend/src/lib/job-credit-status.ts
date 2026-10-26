/**
 * A job's billing answers, read off usage logs: `credit_status` (is the job's
 * hold still open, committed or refunded?) and the charge (what the payer ended
 * up paying, through `settledCharge` — the one reader of a usage log's charge).
 *
 * `jobs.credits` is the job's own hold and never changes meaning; a run that
 * settles below it (a ceiling, a measured length) shows the difference only
 * here. `jobs.credits_actual` stays admin-only — the public figure comes from
 * the usage log, the same row the transaction list reads, so both surfaces
 * agree.
 *
 * A job is a RUN: what it charged includes its steps — the child jobs a
 * worker-side handler ran for it (`parent_job_id`, lib/job-run-steps.ts), each
 * billed on its own usage log — and its metered side holds (migration 554).
 * `runCreditsFor` is the one loader of a run's figures and `creditsChargedOf`
 * the one reader of its charge: the REST job routes, the MCP job tools,
 * webhooks, trend runs, the execution history and the admin Jobs list all read
 * it here (`step-charge-side-holds-guard.test.ts`).
 */
import { supabase } from "./supabase.js"
import { settledCharge } from "./usage-amount.js"
import { sideHoldChargesFor } from "./job-step-charge.js"
import { runStepsOf } from "./job-run-steps.js"

export type CreditStatus = "reserved" | "committed" | "refunded"

export interface JobCreditFigures {
  status: CreditStatus
  /** Null while the hold is open; 0 when it was refunded. */
  charged: number | null
}

/** Ids per `.in()` list (what the gateway reliably accepts). */
const IN_BATCH = 200

/**
 * One query per batch of ids (never one per job): callers pass every
 * `usage_log_id` they have, including duplicates/nulls, and get back a `Map`
 * keyed by usage_log_id. A job with no usage log (nothing reserved, e.g. a free
 * run) is simply absent from the map. This is the job's OWN usage log only —
 * a run's charge comes from `runCreditsFor`.
 */
export async function creditStatusMapFor(
  usageLogIds: readonly (string | null | undefined)[],
): Promise<Map<string, JobCreditFigures>> {
  const ids = Array.from(new Set(usageLogIds.filter((id): id is string => Boolean(id))))
  const map = new Map<string, JobCreditFigures>()
  for (let i = 0; i < ids.length; i += IN_BATCH) {
    const { data } = await supabase
      .from("usage_logs")
      .select("id, status, credits_used, credits_charged")
      .in("id", ids.slice(i, i + IN_BATCH))
    for (const row of (data ?? []) as {
      id: string
      status?: string | null
      credits_used?: number | null
      credits_charged?: number | null
    }[]) {
      if (row.status === "reserved" || row.status === "committed" || row.status === "refunded") {
        map.set(row.id, { status: row.status, charged: settledCharge(row) })
      }
    }
  }
  return map
}

/** `null` for both "no usage log" and "usage log row missing/unrecognized
 *  status" — `null` is the documented "not available" spelling. */
export function creditStatusOf(
  usageLogId: string | null | undefined,
  map: Map<string, JobCreditFigures>,
): CreditStatus | null {
  return usageLogId ? map.get(usageLogId)?.status ?? null : null
}

// ── a run's figures ─────────────────────────────────────────────────────────

/** What `runCreditsFor` reads off a job row the caller already has. */
export interface JobChargeRow {
  id: string
  usage_log_id?: string | null
  /** The job's own hold (`jobs.credits`). */
  credits?: number | null
  /** The job's owner — read when `runCreditsFor` is given several owners (an admin list). */
  user_id?: string | null
}

/** One job's figures, alone and as a run with its steps. */
export interface RunCreditFigures {
  /** The job's own hold's lifecycle; null with no usage log. */
  status: CreditStatus | null
  /** The job alone: its own settled charge plus its settled side holds. Null while its hold is open. */
  ownCharged: number | null
  /** The job's own hold (`jobs.credits`). */
  ownHeld: number | null
  /** What went back from the job's own hold, once it settled (never below 0). Null while open. */
  ownReleased: number | null
  /**
   * The run's charge: the job's own plus every step that has settled. Null
   * while the job's own hold is open. A step whose hold is still open adds
   * nothing until it settles; a refunded step adds 0.
   */
  charged: number | null
  /** The run's hold: the job's own hold plus every step's. */
  held: number | null
  /**
   * What went back from the run's holds (`held − charged`), once every hold in
   * the run has settled. Null while any is open, and when side holds put the
   * charge above the holds listed here.
   */
  released: number | null
  /** What the job's own settled side holds charged (0 with none). */
  sideCharged: number
  /** What its settled steps charged, their side holds included; null when none has settled. */
  stepsCharged: number | null
  /** How many steps (child jobs, at any depth) the run has. */
  steps: number
  /** True when no hold in the run (the job's or a step's) is still open. */
  settled: boolean
  /** True when no step's hold is still open (the job's own may be). */
  stepsSettled: boolean
  /**
   * False when the steps could not all be read: the run's figures (`charged`,
   * `held`, `released`, `stepsCharged`) are then unknown (null), never a lower
   * number. The job's own figures stand.
   */
  complete: boolean
}

declare const RUN_CREDITS: unique symbol
/** Only `runCreditsFor` makes one, so no caller can show a charge without the steps. */
export type RunCredits = ReadonlyMap<string, RunCreditFigures> & { readonly [RUN_CREDITS]: true }

const sumOrNull = (values: ReadonlyArray<number | null | undefined>): number | null => {
  let total: number | null = null
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) total = (total ?? 0) + v
  return total
}

const releasedOf = (held: number | null, charged: number | null): number | null =>
  held !== null && charged !== null && charged <= held ? held - charged : null

/**
 * The figures of each job in `rows`, as a run: one read for its steps per level
 * of the tree, one usage-log read and one side-hold read for every job and step
 * (in batches) — never a read per job. Callers pass every row of the page and
 * whose jobs they are: one user, or — for a list mixing users (an admin's) —
 * the users it may hold, each row then naming its own (`user_id`; a row whose
 * owner is not among them gets no steps). Steps are read as that owner's only.
 */
export async function runCreditsFor(rows: readonly JobChargeRow[], owners: string | readonly string[]): Promise<RunCredits> {
  const jobs = rows.filter((r): r is JobChargeRow => typeof r?.id === "string" && r.id.length > 0)
  const allowed = typeof owners === "string" ? null : new Set(owners)
  const ownerOf = (j: JobChargeRow): string | null =>
    typeof owners === "string" ? owners : j.user_id && allowed!.has(j.user_id) ? j.user_id : null
  const { steps, incomplete } = await runStepsOf(jobs.flatMap((j) => {
    const owner = ownerOf(j)
    return owner ? [{ id: j.id, owner }] : []
  }))
  const everyStep = new Map<string, { usage_log_id: string | null }>()
  for (const list of steps.values()) for (const s of list) everyStep.set(s.id, s)
  const logs = await creditStatusMapFor([...jobs.map((j) => j.usage_log_id), ...[...everyStep.values()].map((s) => s.usage_log_id)])
  const side = await sideHoldChargesFor([...jobs.map((j) => j.id), ...everyStep.keys()])

  const out = new Map<string, RunCreditFigures>()
  for (const job of jobs) {
    if (out.has(job.id)) continue
    const own = job.usage_log_id ? logs.get(job.usage_log_id) : undefined
    const ownOpen = own?.status === "reserved"
    const ownSide = side.get(job.id) ?? 0
    const ownCharged = own && own.charged !== null ? own.charged + ownSide : null
    const ownHeld = typeof job.credits === "number" ? job.credits : null

    const mine = steps.get(job.id) ?? []
    let stepsSettled = true
    const stepCharges: Array<number | null> = []
    for (const step of mine) {
      const log = step.usage_log_id ? logs.get(step.usage_log_id) : undefined
      if (log?.status === "reserved") stepsSettled = false
      const stepSide = side.get(step.id) ?? 0
      stepCharges.push(log && log.charged !== null ? log.charged + stepSide : null)
    }
    const complete = !incomplete.has(job.id)
    const stepsCharged = complete ? sumOrNull(stepCharges) : null
    const charged = !complete || ownOpen ? null : ownCharged === null && stepsCharged === null ? null : (ownCharged ?? 0) + (stepsCharged ?? 0)
    const held = complete ? sumOrNull([ownHeld, ...mine.map((s) => s.credits)]) : null
    const settled = complete && !ownOpen && stepsSettled

    out.set(job.id, {
      status: own?.status ?? null,
      ownCharged: ownOpen ? null : ownCharged,
      ownHeld,
      ownReleased: ownOpen ? null : releasedOf(ownHeld, ownCharged),
      charged,
      held,
      released: settled ? releasedOf(held, charged) : null,
      sideCharged: ownSide,
      stepsCharged,
      steps: mine.length,
      settled,
      stepsSettled: complete && stepsSettled,
      complete,
    })
  }
  return out as unknown as RunCredits
}

/**
 * A job's charge AS A RUN STEP of a workflow (node-executor's `creditsUsed`,
 * which the execution total, the app-run total and a monetized app's creator
 * fee base sum): the figure the caller already has for the job itself (its
 * hold, its metered actual), plus its settled side holds and its settled steps
 * (child jobs) from `runCreditsFor`. Unknown (`null` / `undefined`) stays
 * unknown when there is nothing to add.
 */
export function withRunCharges<T extends number | null | undefined>(own: T, jobId: string | null | undefined, credits: RunCredits): T | number {
  const figures = runCreditsOf(jobId, credits)
  const extra = (figures?.sideCharged ?? 0) + (figures?.stepsCharged ?? 0)
  if (extra === 0) return own
  return (own ?? 0) + extra
}

/** A job's figures from `runCreditsFor`, or null when it was not loaded. */
export function runCreditsOf(jobId: string | null | undefined, credits: RunCredits): RunCreditFigures | null {
  return jobId ? credits.get(jobId) ?? null : null
}

/**
 * The public `credits_charged` of a job: the run's charge (its own, its settled
 * steps, its settled side holds). `null` until the job's own hold settles, and
 * when nothing was charged through a usage log.
 */
export function creditsChargedOf(jobId: string | null | undefined, credits: RunCredits): number | null {
  return runCreditsOf(jobId, credits)?.charged ?? null
}

/**
 * The public credit fields of a job beside its own `credits` (the hold):
 * `credits_charged`, `credits_held` (the run's hold, its steps' included) and
 * `credits_released` (what went back, once every hold in the run settled).
 */
export function publicCreditFieldsOf(
  jobId: string | null | undefined,
  credits: RunCredits,
): { credits_charged: number | null; credits_held: number | null; credits_released: number | null } {
  const figures = runCreditsOf(jobId, credits)
  return {
    credits_charged: creditsChargedOf(jobId, credits),
    credits_held: figures?.held ?? null,
    credits_released: figures?.released ?? null,
  }
}
