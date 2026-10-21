// @registry-enumerates prices the metered credit ids it reads by getModelCreditCostFromDB — a credit id, not a node type, so not a @registry-lookup
/**
 * The credit audit's LLM mode (D6 monitoring) — `POST /v1/admin/credit-audit/llm`.
 *
 * Per (feature, model), what the metered LLM calls REALLY cost the platform —
 * the provider's dollar cost the settle recorded in the server-only billing
 * ledger (`jobs.llm_billing`, read here through the service role) — against
 * what the payers were CHARGED for them, with the theoretical mode's
 * thresholds: UNDERPRICED when the charge falls short of cost + markup by more
 * than half a credit, OVERPRICED when it is more than double.
 *
 * Admin-only (`requireAdmin`); no KIE token — every figure is our own. Provider
 * dollars are shown to admins here and never to users.
 *
 * Where each figure comes from:
 *  - the tasks: jobs created in the window that carry a ledger, whose usage
 *    log is COMMITTED (a reserved hold is not a settled task). The group is the
 *    ledger's `chargeId` when it records one (a scrape's per-item analysis,
 *    `meta-ads-analysis:<model>`, settled under the scrape's FIXED id), else
 *    the usage log's action — `parseMeteredLlmId` of either.
 *  - cost: Σ ledger `costUsd`, raw (never floored — so the per-call floor and
 *    the rounding show up as OVERPRICED). A ledger whose cost was uncomputable
 *    is left out of both sides and counted.
 *  - expected: each task's cost marked up at the percent of its FULL charge id
 *    (a `:direct` lane included, as the settle applied it), summed, then
 *    rounded up once per group.
 *  - charged: Σ `usage_logs.credits_charged` — what the settle collected:
 *    the hold plus what `commit_credits_metered` could take of an overrun. A
 *    workspace row records the whole actual there, so its `org_usage_variance`
 *    line (the part the platform absorbed) is taken back out. A scrape's row
 *    carries its fixed price too, taken out when the scrape completed (a failed
 *    one refunded it); a remainder that goes NEGATIVE (the fixed price was
 *    repriced up inside the window) is left out of the comparison and counted.
 *  - shortfall: what the platform absorbed — `credit_anomalies`
 *    `uncollected_overrun` + the workspace `org_usage_variance` lines.
 *  - unsettled holds: `credit_anomalies` `metered_settle_unconfirmed` — written
 *    only by a scrape's multi-call settle; a single-call settle left
 *    unconfirmed goes to the reconcile sweep, not here.
 *  - refunded but billed: a REFUNDED usage log whose ledger records a billed
 *    call (`llmBillingLedgerBilled`: calls > 0, what the reconcile sweep treats
 *    as billed — the D10 bug class: a billed call must never be refunded) —
 *    counted with its provider $ when the cost is known, and apart when it was
 *    uncomputable; never part of diff or status.
 *  - missing ledgers: COMMITTED metered usage logs in the window whose job
 *    carries no ledger (the ledger write failed) — invisible to the comparison,
 *    so counted.
 *  - metered SIDE holds (migration 554 — an LLM call a job made beside its
 *    own reservation, a UGC clip's frame check): their usage logs carry no job
 *    and their ledgers live on their `llm_side_holds` rows (server-only); each
 *    is a task under its own charge id exactly like a job's ledger (cost,
 *    charge, shortfall, refunded-but-billed, missing ledger).
 *
 * Every window read pages by key set on (created_at, id), never by OFFSET.
 * `created_at` has a plain index on usage_logs, credit_anomalies and
 * credit_transactions; on `jobs` only partial / composite ones (none usable
 * here), so the jobs read scans — accepted for an admin-only, rarely-run
 * report (no index added for it).
 */
import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { CREDIT_BASE_USD } from "@nodaro/shared/models"
import { supabase } from "../../lib/supabase.js"
import { getAppSettings } from "../../lib/app-settings.js"
import { formatZodError } from "../../lib/zod-error.js"
import { usageAmount } from "../../lib/usage-amount.js"
import { LLM_BILLING_LEDGER_COLUMN, isLlmBillingLedger, llmBillingLedgerBilled, type LlmBillingLedger } from "../../lib/llm-billing-ledger.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { parseMeteredLlmId } from "../billing/metered-llm-id.js"
import { METERED_LLM_FEATURES } from "../billing/llm-typical-usage.js"
import { effectiveMarkupPercent } from "../billing/service-margin.js"
import { getModelCreditCostFromDB } from "../billing/credits.js"

const llmAuditBody = z.object({
  days: z.number().int().min(1).max(90).optional(),
})

export type LlmAuditStatus = "OK" | "UNDERPRICED" | "OVERPRICED"

export interface LlmAuditRow {
  feature: string
  model: string
  /** Settled (committed) jobs in the comparison: a computable cost, a non-negative charge. */
  tasks: number
  providerCostUsd: number
  /** Σ cost ÷ CREDIT_BASE_USD, unrounded. */
  providerCostInCredits: number
  /**
   * The markup the group is charged at (`effectiveMarkupPercent` of each task's
   * full charge id). When its tasks were charged at different percents (a
   * `:direct` lane with its own margin), the cost-weighted percent and
   * `mixedMarkup: true`.
   */
  markupPercent: number
  mixedMarkup: boolean
  /** ceil(Σ task credits × (100 + its markup) / 100). */
  expectedCredits: number
  /** What the payers were charged (collected). */
  chargedCredits: number
  /** Overruns the platform absorbed (uncollected_overrun + org_usage_variance). */
  shortfallCredits: number
  /** Share (0–1) of the tasks whose cost was estimated (`kie-size-estimate` / `abort-estimate`), not stated. */
  estimatedShare: number
  diff: number
  diffPercent: number | null
  status: LlmAuditStatus
  /** Settled jobs whose overrun was not (wholly) collected. */
  uncollectedOverruns: number
  /** `metered_settle_unconfirmed` anomalies (a scrape's settle only): holds no settle confirmed. */
  unsettledHolds: number
  /** Settled jobs whose ledger cost was uncomputable — out of the comparison. */
  uncomputableTasks: number
  /** Settled jobs whose charge minus the fixed price went negative (a reprice) — out of the comparison. */
  negativeRemainderTasks: number
  /** The fixed price taken out of a scrape's charge (its analysis is what is audited). */
  fixedCreditsExcluded: number
  /** Refunded usage logs whose ledger records a billed call (D10) — never in diff/status. */
  refundedBilledTasks: number
  /** Σ their provider cost, over the ones whose cost is known. */
  refundedBilledCostUsd: number
  /** The part of `refundedBilledTasks` whose cost was uncomputable (not in the $). */
  refundedBilledUncomputableTasks: number
  /** Committed metered usage logs whose job carries no ledger. */
  missingLedgers: number
}

/** One settled metered job, as the aggregation reads it. */
export interface LlmAuditTask {
  chargeKey: string
  /** The usage log's own action (a scrape's fixed id when it differs from chargeKey). */
  action: string
  jobStatus: string
  ledger: LlmBillingLedger
  creditsCharged: number
  /** Absorbed by the platform: uncollected_overrun diff + org_usage_variance. */
  shortfall: number
  /** The part of `shortfall` that is a workspace variance (recorded inside credits_charged). */
  workspaceVariance: number
}

/** A refunded usage log whose ledger records a billed call (the D10 bug class). */
export interface LlmRefundedBilled {
  chargeKey: string
  /** Null when the ledger's cost was uncomputable. */
  costUsd: number | null
}

/** What sits beside the settled tasks: counts that never enter diff or status. */
export interface LlmAuditSideCounts {
  /** charge id → `metered_settle_unconfirmed` anomalies. */
  unsettled: ReadonlyMap<string, number>
  refundedBilled: readonly LlmRefundedBilled[]
  /** usage-log action → committed metered logs whose job has no ledger. */
  missingLedgers: ReadonlyMap<string, number>
}

const ESTIMATED_SOURCES: ReadonlySet<string> = new Set(["kie-size-estimate", "abort-estimate"])
const PAGE = 1000
const MAX_PAGES = 100
/** Ids per `.in()` list: 500 UUIDs is past what the gateway reliably accepts (credits-digest.ts, deployment-billing.ts). */
const IN_BATCH = 200

const round = (n: number, places: number): number => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

/** `{ feature, model }` of a charge id, the lane suffix dropped; null when it is not a metered LLM id. */
function groupOf(id: string): { feature: string; model: string } | null {
  const parsed = parseMeteredLlmId(id)
  return parsed ? { feature: parsed.feature, model: parsed.modelId } : null
}

interface Acc {
  feature: string
  model: string
  tasks: number
  costUsd: number
  /** markup percent → Σ cost (USD) charged at it. */
  costByMarkup: Map<number, number>
  estimated: number
  charged: number
  shortfall: number
  uncollectedOverruns: number
  unsettledHolds: number
  uncomputableTasks: number
  negativeRemainderTasks: number
  fixedCreditsExcluded: number
  refundedBilledTasks: number
  refundedBilledCostUsd: number
  refundedBilledUncomputableTasks: number
  missingLedgers: number
}

/**
 * The rows, from the settled tasks and the side counts. Pure except for
 * `fixedPrice` (a scrape's fixed id → its charged price).
 */
export async function buildLlmAuditRows(
  tasks: readonly LlmAuditTask[],
  side: LlmAuditSideCounts,
  settings: Parameters<typeof effectiveMarkupPercent>[0],
  fixedPrice: (fixedId: string) => Promise<number>,
): Promise<LlmAuditRow[]> {
  const groups = new Map<string, Acc>()
  const acc = (chargeKey: string): Acc | null => {
    const g = groupOf(chargeKey)
    if (!g) return null
    const key = `${g.feature}:${g.model}`
    let a = groups.get(key)
    if (!a) {
      a = {
        ...g, tasks: 0, costUsd: 0, costByMarkup: new Map(), estimated: 0, charged: 0, shortfall: 0, uncollectedOverruns: 0,
        unsettledHolds: 0, uncomputableTasks: 0, negativeRemainderTasks: 0, fixedCreditsExcluded: 0,
        refundedBilledTasks: 0, refundedBilledCostUsd: 0, refundedBilledUncomputableTasks: 0, missingLedgers: 0,
      }
      groups.set(key, a)
    }
    return a
  }

  for (const t of tasks) {
    const a = acc(t.chargeKey)
    if (!a) continue
    if (t.ledger.costUsd == null || !Number.isFinite(t.ledger.costUsd)) {
      a.uncomputableTasks++
      continue
    }
    // A scrape: its usage log carries the fixed price too, charged only when
    // the scrape completed (`fixedPart: "charge"`; a failed one refunded it).
    let fixed = 0
    if (t.action !== t.chargeKey && !groupOf(t.action) && t.jobStatus === "completed") {
      fixed = await fixedPrice(t.action)
    }
    const remainder = t.creditsCharged - t.workspaceVariance - fixed
    if (remainder < 0) {
      // Today's fixed price exceeds what was charged (repriced inside the
      // window): the analysis's own charge is unknown — flagged, not guessed.
      a.negativeRemainderTasks++
      continue
    }
    const markup = effectiveMarkupPercent(settings, t.chargeKey)
    a.tasks++
    a.costUsd += t.ledger.costUsd
    a.costByMarkup.set(markup, (a.costByMarkup.get(markup) ?? 0) + t.ledger.costUsd)
    if (ESTIMATED_SOURCES.has(t.ledger.source)) a.estimated++
    a.charged += remainder
    a.fixedCreditsExcluded += fixed
    a.shortfall += t.shortfall
    if (t.shortfall > 0) a.uncollectedOverruns++
  }
  for (const [chargeKey, n] of side.unsettled) {
    const a = acc(chargeKey)
    if (a) a.unsettledHolds += n
  }
  for (const r of side.refundedBilled) {
    const a = acc(r.chargeKey)
    if (!a) continue
    a.refundedBilledTasks++
    if (r.costUsd == null) a.refundedBilledUncomputableTasks++
    else a.refundedBilledCostUsd += r.costUsd
  }
  for (const [action, n] of side.missingLedgers) {
    const a = acc(action)
    if (a) a.missingLedgers += n
  }

  const rows: LlmAuditRow[] = []
  for (const a of groups.values()) {
    // Rounded to 6 places before the ceil, so float noise in a sum (0.0020000000000000005)
    // can never push an exact figure over a whole credit.
    const providerCostInCredits = round(a.costUsd / CREDIT_BASE_USD, 6)
    let markedUp = 0
    for (const [m, cost] of a.costByMarkup) markedUp += (round(cost / CREDIT_BASE_USD, 6) * (100 + m)) / 100
    const expectedCredits = Math.ceil(round(markedUp, 6))
    const mixedMarkup = a.costByMarkup.size > 1
    const markupPercent =
      a.costByMarkup.size === 1 ? [...a.costByMarkup.keys()][0]!
        : mixedMarkup && providerCostInCredits > 0 ? round((markedUp / providerCostInCredits - 1) * 100, 2)
          : effectiveMarkupPercent(settings, `${a.feature}:${a.model}`)
    const diff = a.charged - expectedCredits
    const diffPercent = expectedCredits > 0 ? round((diff / expectedCredits) * 100, 2) : null
    // Theoretical mode's thresholds, exactly.
    let status: LlmAuditStatus = "OK"
    if (diff < -0.5) status = "UNDERPRICED"
    else if (expectedCredits > 0 && diffPercent != null && diffPercent > 100) status = "OVERPRICED"
    rows.push({
      feature: a.feature,
      model: a.model,
      tasks: a.tasks,
      providerCostUsd: round(a.costUsd, 6),
      providerCostInCredits,
      markupPercent,
      mixedMarkup,
      expectedCredits,
      chargedCredits: a.charged,
      shortfallCredits: a.shortfall,
      estimatedShare: a.tasks > 0 ? round(a.estimated / a.tasks, 4) : 0,
      diff,
      diffPercent,
      status,
      uncollectedOverruns: a.uncollectedOverruns,
      unsettledHolds: a.unsettledHolds,
      uncomputableTasks: a.uncomputableTasks,
      negativeRemainderTasks: a.negativeRemainderTasks,
      fixedCreditsExcluded: a.fixedCreditsExcluded,
      refundedBilledTasks: a.refundedBilledTasks,
      refundedBilledCostUsd: round(a.refundedBilledCostUsd, 6),
      refundedBilledUncomputableTasks: a.refundedBilledUncomputableTasks,
      missingLedgers: a.missingLedgers,
    })
  }
  // Mismatches first, then by largest absolute diff (theoretical mode's order).
  rows.sort((x, y) => {
    if (x.status !== "OK" && y.status === "OK") return -1
    if (x.status === "OK" && y.status !== "OK") return 1
    return Math.abs(y.diff) - Math.abs(x.diff)
  })
  return rows
}

interface Cursor { created_at: string; id: string }
type KeysetQuery = (after: Cursor | null) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>

/**
 * The PostgREST filter for "after `c` in (created_at, id) order" — ANDed with
 * `scope` (an `or` list) when the read has one, in the one `or` it may carry.
 */
function afterFilter(c: Cursor | null, scope?: string): string | null {
  const after = c ? `created_at.gt.${c.created_at},and(created_at.eq.${c.created_at},id.gt.${c.id})` : null
  if (!scope) return after
  return after ? `and(or(${scope}),or(${after}))` : scope
}

/**
 * Every row of a window read, paged by key set on (created_at, id) — never by
 * OFFSET, which re-scans every skipped row per page. `truncated` when it
 * stopped at the page cap.
 */
async function readAll<T extends Cursor>(page: KeysetQuery): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = []
  let after: Cursor | null = null
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await page(after)
    if (error) throw new Error(error.message)
    const got = (data ?? []) as T[]
    rows.push(...got)
    if (got.length < PAGE) return { rows, truncated: false }
    const last = got[got.length - 1]!
    after = { created_at: last.created_at, id: last.id }
  }
  return { rows, truncated: true }
}

interface JobRow extends Cursor { usage_log_id: string | null; status: string; billing_force_refund?: boolean | null; [LLM_BILLING_LEDGER_COLUMN]: unknown }
interface UsageRow { id: string; job_id: string | null; action: string; status: string | null; credits_used: number | null; credits_charged: number | null; metadata?: unknown }

/**
 * A DELIBERATE platform refund — never the D10 bug class "refunded but billed": a side log the
 * platform refunded (R57, `metadata.side_refund`, written by `refund_settled_side_hold`), a job's
 * own settled metered charge a result-policy block, a reviewer's reject or a withdraw reversed
 * (R61, `metadata.policy_refund`, written by `refund_settled_metered_charge`), or the log of a job
 * withdrawn with `billing_force_refund`.
 */
function deliberateRefund(log: UsageRow, jobForceRefund: boolean): boolean {
  const meta = log.metadata
  if (jobForceRefund) return true
  if (!meta || typeof meta !== "object") return false
  const m = meta as Record<string, unknown>
  return m.side_refund != null || m.policy_refund != null
}
interface MeteredLogRow extends Cursor { job_id: string | null; action: string }
interface AnomalyRow extends Cursor { usage_log_id: string | null; model_identifier: string; anomaly_type: string; diff: number | null }
interface VarianceRow extends Cursor { amount: number | null; description: string | null }
/** A metered SIDE hold (554): its usage log carries no job; its ledger lives on its own row. */
interface SideHoldRow { created_at: string; usage_log_id: string; charge_id: string; ledger: unknown }

const VARIANCE_LOG_ID = /usage_log ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

/** A metered usage log's action starts with one of the features (narrowed again by `parseMeteredLlmId`). */
const METERED_ACTION_SCOPE = METERED_LLM_FEATURES.map((f) => `action.like.${f}:*`).join(",")

export async function adminCreditAuditLlmRoutes(app: FastifyInstance) {
  app.post("/v1/admin/credit-audit/llm", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = llmAuditBody.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const lookbackMinutes = (parsed.data.days ?? 7) * 1440
    const since = new Date(Date.now() - lookbackMinutes * 60_000).toISOString()

    /** A window read on `table`, ordered by (created_at, id), after the cursor. */
    const windowPage = (
      table: string,
      columns: string,
      narrow: (q: ReturnType<ReturnType<typeof supabase.from>["select"]>) => ReturnType<ReturnType<typeof supabase.from>["select"]>,
      scope?: string,
    ): KeysetQuery => (after) => {
      let q = narrow(supabase.from(table).select(`created_at, id, ${columns}`)).gte("created_at", since)
      const filter = afterFilter(after, scope)
      if (filter) q = q.or(filter)
      return q.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(PAGE)
    }

    // 1. The metered jobs: the ones the settle wrote a ledger on. The column
    //    is not null for a worker job's pre-call marker too (R38) — not a
    //    ledger: every reader below goes through `isLlmBillingLedger`.
    const jobs = await readAll<JobRow>(
      windowPage("jobs", `usage_log_id, status, billing_force_refund, ${LLM_BILLING_LEDGER_COLUMN}`, (q) => q.not(LLM_BILLING_LEDGER_COLUMN, "is", null)),
    )

    // 2. Their usage logs (what was charged, under which action) — by the
    //    job's pointer, else by the log's own job_id (the link the metered
    //    settle itself trusts), so a path that never wrote the pointer still counts.
    const USAGE_COLUMNS = "id, job_id, action, status, credits_used, credits_charged, metadata"
    const logIds = [...new Set(jobs.rows.map((j) => j.usage_log_id).filter((id): id is string => !!id))]
    const logs = new Map<string, UsageRow>()
    for (let i = 0; i < logIds.length; i += IN_BATCH) {
      const { data, error } = await supabase.from("usage_logs").select(USAGE_COLUMNS).in("id", logIds.slice(i, i + IN_BATCH))
      if (error) throw new Error(error.message)
      for (const row of (data ?? []) as UsageRow[]) logs.set(row.id, row)
    }
    const unlinked = jobs.rows.filter((j) => !j.usage_log_id || !logs.has(j.usage_log_id)).map((j) => j.id)
    const logByJob = new Map<string, UsageRow>()
    for (let i = 0; i < unlinked.length; i += IN_BATCH) {
      const { data, error } = await supabase.from("usage_logs").select(USAGE_COLUMNS).in("job_id", unlinked.slice(i, i + IN_BATCH))
      if (error) throw new Error(error.message)
      for (const row of (data ?? []) as UsageRow[]) {
        if (!row.job_id) continue
        const seen = logByJob.get(row.job_id)
        // One log per job; should there be several, the settled one is the charge.
        if (!seen || (seen.status !== "committed" && row.status === "committed")) logByJob.set(row.job_id, row)
      }
    }
    const logOf = (j: JobRow): UsageRow | undefined => (j.usage_log_id ? logs.get(j.usage_log_id) : undefined) ?? logByJob.get(j.id)

    // 3. What the platform absorbed, and the holds no settle confirmed.
    const anomalies = await readAll<AnomalyRow>(
      windowPage("credit_anomalies", "usage_log_id, model_identifier, anomaly_type, diff", (q) =>
        q.in("anomaly_type", ["uncollected_overrun", "metered_settle_unconfirmed"])),
    )
    const variances = await readAll<VarianceRow>(
      windowPage("credit_transactions", "amount, description", (q) => q.eq("source", "org_usage_variance")),
    )

    // 4. Committed metered usage logs in the window — to find the ones whose job has no ledger.
    const meteredLogs = await readAll<MeteredLogRow>(
      windowPage("usage_logs", "job_id, action", (q) => q.eq("status", "committed"), METERED_ACTION_SCOPE),
    )

    // 5. Metered SIDE holds (554) — an LLM call a job made beside its own
    //    reservation (a UGC clip's frame check): its usage log carries NO job
    //    and its ledger is on its `llm_side_holds` row, so neither read above
    //    sees it (the job's row has no ledger for it; step 4 skips a log with
    //    no job). Read here, then audited under its own charge id exactly
    //    like a job's ledger. Keyset on (created_at, usage_log_id).
    const sideRows: SideHoldRow[] = []
    let sideTruncated = true
    {
      let after: { created_at: string; id: string } | null = null
      for (let p = 0; p < MAX_PAGES; p++) {
        let q = supabase.from("llm_side_holds" as "assets").select("created_at, usage_log_id, charge_id, ledger").gte("created_at", since)
        if (after) q = q.or(`created_at.gt.${after.created_at},and(created_at.eq.${after.created_at},usage_log_id.gt.${after.id})`)
        const { data, error } = await q.order("created_at", { ascending: true }).order("usage_log_id", { ascending: true }).limit(PAGE)
        if (error) throw new Error(error.message)
        const got = (data ?? []) as unknown as SideHoldRow[]
        sideRows.push(...got)
        if (got.length < PAGE) {
          sideTruncated = false
          break
        }
        const last = got[got.length - 1]!
        after = { created_at: last.created_at, id: last.usage_log_id }
      }
    }
    const sideLogs = new Map<string, UsageRow>()
    const sideLogIds = sideRows.map((r) => r.usage_log_id)
    for (let i = 0; i < sideLogIds.length; i += IN_BATCH) {
      const { data, error } = await supabase.from("usage_logs").select(USAGE_COLUMNS).in("id", sideLogIds.slice(i, i + IN_BATCH))
      if (error) throw new Error(error.message)
      for (const row of (data ?? []) as UsageRow[]) sideLogs.set(row.id, row)
    }

    // The charge key of each known usage log (the ledger's chargeId wins: a scrape's analysis).
    const chargeKeyByLog = new Map<string, string>()
    for (const j of jobs.rows) {
      const log = logOf(j)
      const ledger = j[LLM_BILLING_LEDGER_COLUMN]
      if (!log || !isLlmBillingLedger(ledger)) continue
      chargeKeyByLog.set(log.id, ledger.chargeId ?? log.action)
    }
    for (const h of sideRows) {
      if (sideLogs.has(h.usage_log_id) && isLlmBillingLedger(h.ledger)) chargeKeyByLog.set(h.usage_log_id, h.ledger.chargeId ?? h.charge_id)
    }

    const overrunByLog = new Map<string, number>()
    const unsettled = new Map<string, number>()
    for (const a of anomalies.rows) {
      if (a.anomaly_type === "uncollected_overrun") {
        if (a.usage_log_id) overrunByLog.set(a.usage_log_id, (overrunByLog.get(a.usage_log_id) ?? 0) + Math.max(a.diff ?? 0, 0))
      } else {
        // An unconfirmed settle's model_identifier IS its charge id; its log is still reserved.
        const key = (a.usage_log_id && chargeKeyByLog.get(a.usage_log_id)) || a.model_identifier
        unsettled.set(key, (unsettled.get(key) ?? 0) + 1)
      }
    }
    const varianceByLog = new Map<string, number>()
    for (const v of variances.rows) {
      const logId = VARIANCE_LOG_ID.exec(v.description ?? "")?.[1]?.toLowerCase()
      if (!logId || !chargeKeyByLog.has(logId)) continue
      varianceByLog.set(logId, (varianceByLog.get(logId) ?? 0) + Math.max(v.amount ?? 0, 0))
    }

    const tasks: LlmAuditTask[] = []
    const refundedBilled: LlmRefundedBilled[] = []
    // One task per usage log, whichever path linked it (pointer or job_id) —
    // and each side hold's log with its own ledger (its "job status" is
    // irrelevant: it carries no fixed part).
    const seenLogs = new Set<string>()
    const ledgered: Array<{ log: UsageRow; ledger: LlmBillingLedger; jobStatus: string; forceRefund: boolean }> = []
    for (const j of jobs.rows) {
      const log = logOf(j)
      const ledger = j[LLM_BILLING_LEDGER_COLUMN]
      if (!log || !isLlmBillingLedger(ledger)) continue
      ledgered.push({ log, ledger, jobStatus: j.status, forceRefund: j.billing_force_refund === true })
    }
    for (const h of sideRows) {
      const log = sideLogs.get(h.usage_log_id)
      if (log && isLlmBillingLedger(h.ledger)) ledgered.push({ log, ledger: h.ledger, jobStatus: "side-hold", forceRefund: false })
    }
    for (const { log, ledger, jobStatus, forceRefund } of ledgered) {
      if (seenLogs.has(log.id)) continue
      seenLogs.add(log.id)
      const chargeKey = chargeKeyByLog.get(log.id)!
      if (log.status === "refunded") {
        // D10: a billed metered call must never be refunded — surfaced, never
        // compared. Billed is what the reconcile sweep reads (calls > 0), whatever the cost.
        // A deliberate platform refund (R57 withdraw, a force-refunded job) is not that bug class.
        if (llmBillingLedgerBilled(ledger) && !deliberateRefund(log, forceRefund)) {
          const cost = ledger.costUsd != null && Number.isFinite(ledger.costUsd) ? ledger.costUsd : null
          refundedBilled.push({ chargeKey, costUsd: cost })
        }
        continue
      }
      if (log.status !== "committed") continue
      const variance = varianceByLog.get(log.id) ?? 0
      tasks.push({
        chargeKey,
        action: log.action,
        jobStatus,
        ledger,
        creditsCharged: usageAmount(log) ?? 0,
        shortfall: (overrunByLog.get(log.id) ?? 0) + variance,
        workspaceVariance: variance,
      })
    }

    // Missing ledgers: a committed metered log whose job exists and carries none.
    // A job already read above has a ledger; the rest are asked by id (a job
    // created before the window can still carry one).
    // A pre-call marker (R38) is not a ledger: a job that carries only one is
    // still "missing" its ledger.
    const withLedger = new Set(jobs.rows.filter((j) => isLlmBillingLedger(j[LLM_BILLING_LEDGER_COLUMN])).map((j) => j.id))
    const actionByJob = new Map<string, string>()
    for (const l of meteredLogs.rows) {
      if (!l.job_id || withLedger.has(l.job_id) || !groupOf(l.action)) continue
      actionByJob.set(l.job_id, l.action)
    }
    const candidates = [...actionByJob.keys()]
    const missingLedgers = new Map<string, number>()
    for (let i = 0; i < candidates.length; i += IN_BATCH) {
      const { data, error } = await supabase
        .from("jobs")
        .select(`id, ${LLM_BILLING_LEDGER_COLUMN}`)
        .in("id", candidates.slice(i, i + IN_BATCH))
      if (error) throw new Error(error.message)
      for (const row of (data ?? []) as Array<{ id: string } & Record<string, unknown>>) {
        // No ledger — an empty column, or only a pre-call marker (R38).
        if (isLlmBillingLedger(row[LLM_BILLING_LEDGER_COLUMN])) continue
        const action = actionByJob.get(row.id)
        if (action) missingLedgers.set(action, (missingLedgers.get(action) ?? 0) + 1)
      }
    }
    // A committed side hold whose ledger write failed (554).
    for (const h of sideRows) {
      const log = sideLogs.get(h.usage_log_id)
      if (!log || log.status !== "committed" || isLlmBillingLedger(h.ledger) || !groupOf(h.charge_id)) continue
      missingLedgers.set(h.charge_id, (missingLedgers.get(h.charge_id) ?? 0) + 1)
    }

    const settings = await getAppSettings()
    const fixedPrices = new Map<string, number>()
    const fixedPrice = async (id: string): Promise<number> => {
      let p = fixedPrices.get(id)
      if (p === undefined) {
        p = (await getModelCreditCostFromDB(id)).creditCost
        fixedPrices.set(id, p)
      }
      return p
    }
    const models = await buildLlmAuditRows(tasks, { unsettled, refundedBilled, missingLedgers }, settings, fixedPrice)
    const sum = (f: (m: LlmAuditRow) => number) => models.reduce((s, m) => s + f(m), 0)

    return {
      mode: "llm" as const,
      lookbackMinutes,
      markupPercent: settings.cost_markup_percent,
      mismatches: models.filter((m) => m.status !== "OK").length,
      /** Settled metered jobs across the rows: compared + uncomputable + negative remainder. */
      totalJobs: sum((m) => m.tasks + m.uncomputableTasks + m.negativeRemainderTasks),
      refundedBilled: {
        tasks: sum((m) => m.refundedBilledTasks),
        costUsd: round(sum((m) => m.refundedBilledCostUsd), 6),
        uncomputableTasks: sum((m) => m.refundedBilledUncomputableTasks),
      },
      missingLedgers: sum((m) => m.missingLedgers),
      truncated: jobs.truncated || anomalies.truncated || variances.truncated || meteredLogs.truncated || sideTruncated,
      models,
    }
  })
}
