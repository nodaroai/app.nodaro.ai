/**
 * One-off retroactive refund for the Topaz image-upscale overcharge
 * (app-reports triage 2026-09-01 §4.3, decision 8).
 *
 * Until the fix in this PR, `targetResolution` (2K/4K/8K) was PRICED but never
 * reached the worker — `handleEditImage` built `extraParams` from
 * `upscaleFactor` alone. Anyone who bought the 4K or 8K tier without also
 * setting the factor got a 2x render at 2x/4x the price.
 *
 * WHERE THE NUMBERS COME FROM (this is the whole correctness story):
 *   charged  = usage_logs.credits_used, joined through jobs.usage_log_id.
 *              NOT jobs.credits — that column has had no writer since
 *              migration 063 renamed it; reserve_credits writes only the
 *              wallet + usage_logs. And NOT STATIC_CREDIT_COSTS, which is the
 *              0%-markup BASE: the real debit is getModelCreditCostFromDB =
 *              ceil(base * (1 + markup/100)) with a model_pricing override.
 *   correct  = getModelCreditCostFromDB(deliveredIdentifierFor(input_data)) —
 *              the same pricing path, run with the identifier the job SHOULD
 *              have carried given what the worker actually rendered.
 *   refund   = max(0, charged - correct).
 *
 * WHO GETS PAID — `usage_logs.user_id`, NEVER `jobs.user_id`. Under a
 * deployment payer the reservation is written under the PAYER's account
 * (`debitUserId = dep.payerId`, credits.ts ~:2227/:2335) and the requester is
 * stamped into `usage_logs.on_behalf_of` (migration 362). `jobs.user_id` is the
 * REQUESTER, so paying it would credit an account that was never debited and
 * leave the payer short. The usage log is the settlement record; the job row is
 * not. Both ids are printed whenever they differ.
 *
 * FIVE GATES, in two classes.
 *
 * ABORT — a wrong number here is money moved in a one-shot operation, and these
 * three mean the run's own inputs are broken, so it refuses entirely (non-zero
 * exit, ids listed) rather than guess:
 *   1. a candidate with no `usage_log_id`      — the charge is unknowable, and
 *      so is the payer. A real data problem; resolve it by hand.
 *   2. a linked log that is missing, whose `credits_used` is unusable, or that
 *      carries no `user_id`                    — no charge, or no payee.
 *   3. a log with `status = 'refunded'`        — refund_credits already
 *      reversed the whole reservation; paying again double-refunds.
 *
 * EXCLUDE AND LIST — one row is unfit for an automated refund but the rest of
 * the run is sound. These print under "NEEDS MANUAL HANDLING" with a reason,
 * are excluded from the totals, and can never reach `--apply`:
 *   4. a log whose `credits_charged` disagrees with `credits_used` — a TRUE-UP.
 *      `commit_credits` leaves `credits_used` at the RESERVED amount and puts
 *      the net kept amount in `credits_charged`, so `credits_used` overstates
 *      the debit and the two numbers come from different pricing eras. Both are
 *      printed; a human picks. (Production dry run #1, 2026-09-02: 2 of 8
 *      candidates — used=70, charged=30 — which is why this stopped being an
 *      abort.) A true-up row is listed only when SOME reading of it is owed
 *      money, i.e. `max(credits_used, credits_charged) > correct`.
 *   5. a log with `workspace_id` or `org_id` set was paid from
 *      `workspace_budgets` (migration 351), not a personal wallet. Crediting
 *      `topup_credits` would hand the money to an individual and leave the
 *      workspace budget short.
 *
 * PRICING DRIFT. Per row the table prints `billed-now`: today's price of the
 * identifier the job WAS billed on. If that does not equal `charged`, the
 * catalog or the markup has moved since the charge, so `correct` and `charged`
 * rest on different price bases and the delta is not a pure overcharge. Such
 * rows print DRIFT, are excluded from the totals, and are SKIPPED by `--apply`.
 * Expect every app-run / monetized job to land here — those reserved through
 * `checkCredits(..., creditOverride)` with the creator's markup baked in.
 *
 * PRIOR_ADJUSTMENT?. Per row the table also reports any `admin_adjustment` /
 * `refund` credit_transactions row for that payer between the job's
 * `created_at` and now that is NOT one of this script's own. Somebody may
 * already have made this user whole by hand. It is a FLAG, not a gate — the
 * operator decides. The probe is BOUNDED (`created_at >=` the earliest job it
 * is asked about) and PAGED with `.range()`, so PostgREST's 1000-row default
 * cap cannot silently drop a prior adjustment and make a paid user look
 * unpaid.
 *
 * Usage (dry run is the DEFAULT — it prints the tables and writes nothing):
 *   cd backend && npx tsx src/ee/scripts/topaz-overcharge-refund.ts --until <ISO>
 *   … --since <ISO>                        # default 2026-03-10 (PR #461, the
 *                                          #   commit that first priced 4K/8K)
 *   … --dry-run                            # explicit; the default anyway
 *   … --apply --admin-user-id <uuid>       # actually credit the payers
 *   … --limit <positive integer>           # cap the rows refunded
 *
 * `--until` is REQUIRED and has no default. The route lane records the RAW
 * request in `jobs.input_data` (`edit-image.ts` → `buildJobInputData(parsed
 * .data, …)`), not the resolved factor, so a POST-fix job that asks for 4K with
 * no factor is byte-identical to a PRE-fix one — but it renders at 4x and is
 * billed correctly. Time is the only thing that separates them; refunding past
 * the deploy would pay correctly-served users. Set `--until` to the deploy
 * timestamp of this PR.
 *
 * RUNBOOK
 *   1. Dry run, through Railway (it needs SUPABASE_URL +
 *      SUPABASE_SERVICE_ROLE_KEY, which never leave CI/Railway):
 *        railway run --service app.norado.ai --environment production -- \
 *          npx tsx src/ee/scripts/topaz-overcharge-refund.ts --until <ISO>
 *   2. Review the table. Resolve any refusal by hand — do NOT reach for
 *      `--limit` to step over one (it caps the refund list, not the gates).
 *   3. FIRST apply is `--limit 1`. Verify that one user's balance and the
 *      `credit_anomalies` row landed before running the rest.
 *        … --apply --admin-user-id <uuid> --limit 1
 *   4. Then the remainder, without `--limit`.
 *
 * IDEMPOTENCE. A job is skipped if it carries a `credit_anomalies` row with
 * REFUND_TAG (probe 1) OR an `admin_adjustment` `credit_transactions` row whose
 * description carries REFUND_TAG and the job id (probe 2). **Probe 1 is the
 * real guard.** `CreditsService.logTransaction` swallows its own failures
 * (catches, logs, returns false), so probe 2's row can be missing even after a
 * successful credit. That is why a failed `credit_anomalies` insert under
 * `--apply` STOPS the run: continuing would leave the only reliable marker
 * absent and let a later run pay the same job twice.
 */
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { buildCreditModelIdentifier, resolveTopazUpscale } from "@nodaro/shared"
import { supabase } from "../../lib/supabase.js"
import { CreditsService, getModelCreditCostFromDB } from "../billing/credits.js"

const PROVIDER = "topaz-image-upscale"
const REFUND_TAG = "topaz-target-resolution-overcharge-2026-09"
const PAGE_SIZE = 200
/** PR #461 (2026-03-10) added the 4K/8K rows — no job before it could be overcharged. */
const DEFAULT_SINCE = "2026-03-10T00:00:00Z"
/** The tiers the pre-fix identifier could bill above the bare tier. */
const OVERCHARGEABLE_TIERS = ["4K", "8K"] as const
/** Goodwill a human may already have paid — anything but this script's own rows. */
const GOODWILL_SOURCES = ["admin_adjustment", "refund"] as const

/**
 * The credit identifier the job SHOULD have carried — i.e. the price of what
 * the worker ACTUALLY rendered. `null` = not a topaz job.
 *
 * `targetResolution` is deliberately NOT passed to the resolver. Pre-fix it
 * never reached the worker (`image-ai.ts` forwarded `upscaleFactor` alone), so
 * feeding it here would price what the job *should* have rendered and every
 * overcharged row would come out owing nothing. What DID reach the worker is
 * the factor, and `resolveTopazUpscale` is the same authority the route, the
 * DAG builder and the handler now use to read one — including its trimming and
 * its out-of-enum fallback to KIE's `"2"` default. Deriving the delivered tier
 * through it (rather than re-parsing the string here) is what stops this
 * recompute drifting away from runtime.
 */
export function deliveredIdentifierFor(inputData: Record<string, unknown> | null): string | null {
  if (!inputData || inputData.provider !== PROVIDER) return null
  const upscaleFactor = typeof inputData.upscaleFactor === "string" ? inputData.upscaleFactor : undefined
  const { creditTier } = resolveTopazUpscale({ upscaleFactor })
  return buildCreditModelIdentifier(PROVIDER, undefined, undefined, undefined, creditTier)
}

/** The identifier the job WAS billed on, from the tier it bought. */
function billedIdentifierFor(chargedTier: string): string {
  return buildCreditModelIdentifier(
    PROVIDER, undefined, undefined, undefined, chargedTier === "2K" ? undefined : chargedTier,
  )
}

export interface TopazRefundRow {
  jobId: string
  /** WHO WE PAY: `usage_logs.user_id` — the account that was actually debited. */
  userId: string
  /** `jobs.user_id` — the requester. Differs from `userId` under a deployment payer. */
  requesterUserId: string | null
  /** `usage_logs.on_behalf_of` — the requester as the reservation recorded them. */
  onBehalfOf: string | null
  /** Set when the debit hit a workspace budget rather than a personal wallet. */
  workspaceId: string | null
  orgId: string | null
  usageLogId: string
  chargedTier: string
  /** The raw `input_data.upscaleFactor`, JSON-encoded, so a non-string is visible. */
  rawUpscaleFactor: string
  deliveredIdentifier: string
  /** usage_logs.credits_used — what the payer was actually debited. */
  charged: number
  /** The same pricing path, re-run with `deliveredIdentifier`. */
  correct: number
  refund: number
  jobCreatedAt: string | null
}

export interface TopazUsageLog {
  id: string
  /** The DEBITED account. Required — without it there is no payee. */
  user_id?: string | null
  credits_used?: number | null
  on_behalf_of?: string | null
  workspace_id?: string | null
  org_id?: string | null
}

/** True when the debit came out of a workspace budget, not a personal wallet. */
export function isWorkspacePayer(row: Pick<TopazRefundRow, "workspaceId" | "orgId">): boolean {
  return row.workspaceId != null || row.orgId != null
}

/**
 * Pure assembly of one dry-run row. `usageLog === null`, an unusable
 * `credits_used`, or a missing `user_id` yields `null` so the caller can refuse
 * the whole run.
 */
export function topazRefundRowFrom(
  job: { id: string; user_id: string | null; usage_log_id?: string | null; input_data: Record<string, unknown> | null; created_at?: string | null },
  usageLog: TopazUsageLog | null,
  correctCredits: number,
): TopazRefundRow | null {
  const delivered = deliveredIdentifierFor(job.input_data)
  if (!delivered) return null
  if (!usageLog || typeof usageLog.credits_used !== "number" || !Number.isFinite(usageLog.credits_used)) return null
  // The payee is the DEBITED account, which is the usage log's user — not the
  // job's, which is only the requester under a deployment payer.
  if (!usageLog.user_id) return null

  const rawTier = typeof job.input_data?.targetResolution === "string"
    ? job.input_data.targetResolution.trim().toUpperCase()
    : "2K"
  const charged = usageLog.credits_used
  return {
    jobId: job.id,
    userId: usageLog.user_id,
    requesterUserId: job.user_id,
    onBehalfOf: usageLog.on_behalf_of ?? null,
    workspaceId: usageLog.workspace_id ?? null,
    orgId: usageLog.org_id ?? null,
    usageLogId: usageLog.id,
    chargedTier: rawTier,
    rawUpscaleFactor: JSON.stringify(job.input_data?.upscaleFactor ?? null),
    deliveredIdentifier: delivered,
    charged,
    correct: correctCredits,
    refund: Math.max(0, charged - correctCredits),
    jobCreatedAt: job.created_at ?? null,
  }
}

// ── CLI parsing ──

export interface ParsedArgs {
  apply: boolean
  adminUserId?: string
  limit: number
  since: string
  until: string
}

/** `{ error }` = refuse, exit 1. Every refusal is a hard stop; none defaults. */
export function parseArgs(argv: string[]): { args: ParsedArgs } | { error: string[] } {
  const valueOf = (flag: string): string | undefined => {
    const i = argv.indexOf(flag)
    return i !== -1 ? argv[i + 1] : undefined
  }
  const apply = argv.includes("--apply")
  const dryRun = argv.includes("--dry-run")

  if (apply && dryRun) {
    return { error: ["--dry-run and --apply are contradictory. Pass neither for a dry run, or --apply alone to write."] }
  }
  const adminUserId = valueOf("--admin-user-id")
  if (apply && !adminUserId) {
    return { error: ["--apply requires --admin-user-id <uuid> (recorded on every credit_transactions row)"] }
  }

  // A malformed --limit must never silently become "everything".
  let limit = Infinity
  if (argv.includes("--limit")) {
    const raw = valueOf("--limit")
    if (raw === undefined || !/^[0-9]+$/.test(raw.trim()) || parseInt(raw, 10) < 1) {
      return { error: [`--limit must be a positive integer — got ${raw === undefined ? "no value" : `"${raw}"`}.`] }
    }
    limit = parseInt(raw, 10)
  }

  const parseInstant = (flag: string, value: string): string | null => {
    const t = Date.parse(value)
    return Number.isNaN(t) ? null : new Date(t).toISOString()
  }
  const since = parseInstant("--since", valueOf("--since") ?? DEFAULT_SINCE)
  if (!since) return { error: [`--since is not a parseable timestamp: ${valueOf("--since")}`] }

  const untilRaw = valueOf("--until")
  if (untilRaw === undefined) {
    return {
      error: [
        "--until <ISO timestamp> is REQUIRED — set it to this PR's production deploy time.",
        "After the fix, a 4K request with no factor renders at 4x and is billed correctly,",
        "but jobs.input_data records the raw request either way, so only time tells them apart.",
      ],
    }
  }
  const until = parseInstant("--until", untilRaw)
  if (!until) return { error: [`--until is not a parseable timestamp: ${untilRaw}`] }

  return { args: { apply, adminUserId, limit, since, until } }
}

// ── everything below is I/O and only runs from main() ──

type JobRow = { id: string; user_id: string | null; usage_log_id: string | null; input_data: Record<string, unknown> | null; created_at: string }
type LogRow = TopazUsageLog & { credits_charged: number | null; status: string | null }
type GoodwillRow = { user_id: string | null; amount: number | null; source: string | null; description: string | null; created_at: string | null }

/** A row this script will not pay automatically, and why. */
export interface ManualRow {
  row: TopazRefundRow
  reason: string
}

export interface RunResult {
  ok: boolean
  /** Set when a gate or the CLI refused. */
  refusal?: string
  /** Personal-wallet rows owed a refund, after the idempotency probes. */
  rows: TopazRefundRow[]
  /** Excluded rows (true-up / workspace payer) — for a human, never paid here. */
  manual: ManualRow[]
  /** Job ids excluded from the totals because today's price ≠ what was charged. */
  drifted: string[]
  total: number
  refunded: number
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const refused = (headline: string, ids: string[]): RunResult => {
  console.error(`[topaz-refund] REFUSING TO RUN — ${headline}`)
  for (const id of ids) console.error(`[topaz-refund]   ${id}`)
  return { ok: false, refusal: headline, rows: [], manual: [], drifted: [], total: 0, refunded: 0 }
}

export async function main(argv: string[]): Promise<RunResult> {
  const parsed = parseArgs(argv)
  if ("error" in parsed) {
    for (const line of parsed.error) console.error(`[topaz-refund] ${line}`)
    return { ok: false, refusal: parsed.error[0], rows: [], manual: [], drifted: [], total: 0, refunded: 0 }
  }
  const { apply, adminUserId, limit, since, until } = parsed.args

  /** Cached so a run of N jobs makes at most a couple of pricing lookups. */
  const priceCache = new Map<string, number>()
  const priceOf = async (identifier: string): Promise<number> => {
    const hit = priceCache.get(identifier)
    if (hit !== undefined) return hit
    const { creditCost } = await getModelCreditCostFromDB(identifier)
    priceCache.set(identifier, creditCost)
    return creditCost
  }

  console.warn(`[topaz-refund] window: created_at >= ${since} AND < ${until}`)
  console.warn(`[topaz-refund] candidates: jobs.status='completed', input_data.provider='${PROVIDER}', input_data.targetResolution IN (${OVERCHARGEABLE_TIERS.join(", ")})`)

  // 1. Collect candidate jobs: completed topaz runs that bought 4K or 8K.
  const candidates: JobRow[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, user_id, usage_log_id, input_data, created_at")
      .eq("status", "completed")
      .eq("input_data->>provider", PROVIDER)
      .in("input_data->>targetResolution", [...OVERCHARGEABLE_TIERS])
      .gte("created_at", since)
      .lt("created_at", until)
      .order("created_at", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw new Error(`jobs query failed: ${error.message}`)
    const page = (data ?? []) as unknown as JobRow[]
    candidates.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  console.warn(`[topaz-refund] ${candidates.length} candidate job(s) in window`)

  // 2. GATE 1: every candidate must have a usage log, or we cannot know what
  //    was charged — nor who paid it.
  const unlinked = candidates.filter((j) => !j.usage_log_id)
  if (unlinked.length > 0) {
    const r = refused(
      `${unlinked.length} candidate job(s) have no usage_log_id, so the charged amount and the payer cannot be established:`,
      unlinked.map((j) => j.id),
    )
    console.error("[topaz-refund] Resolve these by hand (check credit_transactions.job_id) before re-running.")
    return r
  }

  // 3. Fetch the authoritative charges AND payers.
  const logIds = candidates.map((j) => j.usage_log_id as string)
  const logs = new Map<string, LogRow>()
  for (const ids of chunk(logIds, PAGE_SIZE)) {
    const { data, error } = await supabase
      .from("usage_logs")
      .select("id, user_id, on_behalf_of, workspace_id, org_id, credits_used, credits_charged, status")
      .in("id", ids)
    if (error) throw new Error(`usage_logs query failed: ${error.message}`)
    for (const l of (data ?? []) as unknown as LogRow[]) logs.set(l.id, l)
  }

  // 4. GATES 3 + 4 — the reservation was reversed, or a true-up moved the real
  //    charge away from `credits_used`.
  const reversed = candidates.filter((j) => logs.get(j.usage_log_id as string)?.status === "refunded")
  if (reversed.length > 0) {
    return refused(
      `${reversed.length} candidate job(s) sit on a usage log with status='refunded' — the charge was already reversed:`,
      reversed.map((j) => `${j.id} (usage_log ${j.usage_log_id})`),
    )
  }
  // 5. Recompute the correct charge through the SAME pricing path (markup and
  //    model_pricing overrides included), then assemble the rows.
  const personal: TopazRefundRow[] = []
  const manual: ManualRow[] = []
  const unresolvable: string[] = []
  for (const job of candidates) {
    const delivered = deliveredIdentifierFor(job.input_data)
    if (!delivered) continue
    const correct = await priceOf(delivered)
    const log = logs.get(job.usage_log_id as string) ?? null
    const row = topazRefundRowFrom(job, log, correct)
    if (!row) { unresolvable.push(job.id); continue }

    // GATE 4 — a true-up landed, so `credits_used` (what `row.charged` holds)
    // is the RESERVATION and `credits_charged` is the net debit; the two come
    // from different pricing eras. Neither number can be refunded blind, so
    // print both and let a human pick. Listed only when SOME reading is owed
    // money — a row that owes nothing under either number is simply fine.
    const netDebit = log?.credits_charged
    if (typeof netDebit === "number" && netDebit !== row.charged) {
      if (Math.max(row.charged, netDebit) > correct) {
        manual.push({
          row,
          reason: `true-up: used=${row.charged} charged=${netDebit} — net debit is credits_charged; pricing era differs`,
        })
      }
      continue
    }

    // GATE 5 — the debit hit a workspace budget, not a personal wallet.
    if (isWorkspacePayer(row)) {
      if (row.refund > 0) {
        manual.push({
          row,
          reason: `workspace/org payer: workspace=${row.workspaceId ?? "-"} org=${row.orgId ?? "-"} — the debit hit workspace_budgets, not a personal wallet`,
        })
      }
      continue
    }

    if (row.refund > 0) personal.push(row)
  }
  // GATE 2.
  if (unresolvable.length > 0) {
    return refused(
      `${unresolvable.length} job(s) have a usage_log_id whose row is missing, carries no credits_used, or carries no user_id (no payee):`,
      unresolvable,
    )
  }

  const done = await alreadyRefunded(personal.map((r) => r.jobId))
  const skipped = personal.filter((r) => done.has(r.jobId))
  const todo = personal.filter((r) => !done.has(r.jobId)).slice(0, limit)

  // 7. Pricing-drift diagnostic, and prior goodwill for the same payer.
  const drifted = new Set<string>()
  for (const r of todo) {
    if (await priceOf(billedIdentifierFor(r.chargedTier)) !== r.charged) drifted.add(r.jobId)
  }
  // Bounded by the earliest job we are actually asking about — never the whole
  // ledger — and paged, so the 1000-row cap cannot hide a prior adjustment.
  const goodwillFloor = todo
    .map((r) => r.jobCreatedAt)
    .filter((d): d is string => typeof d === "string" && !Number.isNaN(Date.parse(d)))
    .sort()[0] ?? since
  const goodwill = await priorAdjustments(todo, goodwillFloor)

  const byUser = new Map<string, number>()
  for (const r of todo) {
    if (drifted.has(r.jobId)) continue
    byUser.set(r.userId, (byUser.get(r.userId) ?? 0) + r.refund)
  }
  const total = [...byUser.values()].reduce((n, v) => n + v, 0)

  if (manual.length > 0) {
    console.warn(`[topaz-refund] NEEDS MANUAL HANDLING — ${manual.length} row(s), EXCLUDED from the totals and unreachable by --apply.`)
    console.warn("[topaz-refund] manual | job | payer | usage_log | correct | reason")
    for (const m of manual) {
      console.warn(`[topaz-refund] manual | ${m.row.jobId} | ${m.row.userId} | ${m.row.usageLogId} | ${m.row.correct} | ${m.reason}`)
    }
  }

  if (skipped.length > 0) console.warn(`[topaz-refund] ${skipped.length} job(s) already refunded — skipped`)
  console.warn(`[topaz-refund] ${todo.length} personal row(s), ${drifted.size} with pricing DRIFT, ${byUser.size} payer(s), ${total} credits${apply ? "" : " (DRY RUN — nothing written)"}`)
  console.warn("[topaz-refund] job | payer (usage_log.user_id) | requester | tier bought | raw upscaleFactor | rendered as | charged | correct | refund | billed-now | usage_log | PRIOR_ADJUSTMENT?")
  for (const r of todo) {
    const billedNow = await priceOf(billedIdentifierFor(r.chargedTier))
    // Only printed when it is NOT the payer — a deployment payer paid for
    // somebody else's job, and the audit line has to show both.
    const requester = r.requesterUserId && r.requesterUserId !== r.userId
      ? `${r.requesterUserId}${r.onBehalfOf && r.onBehalfOf !== r.requesterUserId ? ` (on_behalf_of ${r.onBehalfOf})` : ""}`
      : "-"
    const prior = goodwill.get(r.jobId)
    const priorCell = prior ? prior.map((p) => `${p.amount >= 0 ? "+" : ""}${p.amount} ${p.source} ${p.at}`).join("; ") : "-"
    const flag = drifted.has(r.jobId) ? " | DRIFT" : ""
    console.warn(`[topaz-refund] ${r.jobId} | ${r.userId} | ${requester} | ${r.chargedTier} | ${r.rawUpscaleFactor} | ${r.deliveredIdentifier} | ${r.charged} | ${r.correct} | ${r.refund} | ${billedNow} | ${r.usageLogId} | ${priorCell}${flag}`)
  }
  for (const [userId, amount] of byUser) console.warn(`[topaz-refund] TOTAL payer=${userId} +${amount}`)
  console.warn(`[topaz-refund] GRAND TOTAL ${total} credits across ${byUser.size} payer(s)`)

  const result: RunResult = { ok: true, rows: todo, manual, drifted: [...drifted], total, refunded: 0 }
  if (!apply) return result

  for (const r of todo) {
    if (drifted.has(r.jobId)) {
      console.warn(`[topaz-refund] SKIPPED ${r.jobId} — pricing drift: the ${r.chargedTier} tier does not price today at the ${r.charged} it was charged. Decide this one by hand.`)
      continue
    }
    await CreditsService.adminAdjustCredits({
      userId: r.userId,
      amount: r.refund,
      // Top-up credits do not expire with a subscription period, so a
      // retroactive credit cannot evaporate before the payer can spend it.
      creditType: "topup",
      description: `Topaz upscale overcharge refund (${REFUND_TAG}) — job ${r.jobId}`,
      adminUserId: adminUserId as string,
    })
    // supabase-js RESOLVES with `{ error }` — it does not throw. This row is
    // the ONLY reliable idempotency marker (logTransaction swallows its own
    // failures), so a failed insert stops the run rather than leaving a paid
    // job unmarked for the next `--apply` to pay again.
    const { error: auditError } = await supabase.from("credit_anomalies" as "assets").insert({
      job_id: r.jobId,
      user_id: r.userId,
      usage_log_id: r.usageLogId,
      model_identifier: billedIdentifierFor(r.chargedTier),
      provider: PROVIDER,
      credits_estimated: r.charged,
      credits_actual: r.correct,
      diff: r.correct - r.charged,
      anomaly_type: "overcharge",
      status: "acknowledged",
      admin_notes: `${REFUND_TAG}: billed the ${r.chargedTier} tier (${r.charged} cr), rendered ${r.deliveredIdentifier} (${r.correct} cr) — refunded ${r.refund} credits to the debited account${r.requesterUserId && r.requesterUserId !== r.userId ? ` (requester ${r.requesterUserId})` : ""}.`,
    } as Record<string, unknown>)
    if (auditError) {
      console.error(`[topaz-refund] STOPPING — job ${r.jobId} was CREDITED ${r.refund} to ${r.userId}, but its credit_anomalies audit row failed to write: ${auditError.message}`)
      console.error(`[topaz-refund] Write that row by hand (admin_notes must contain "${REFUND_TAG}") before re-running, or the next --apply may pay it again.`)
      return { ...result, ok: false, refusal: "audit row insert failed", refunded: result.refunded }
    }
    result.refunded += 1
    console.warn(`[topaz-refund] refunded ${r.refund} to ${r.userId} for ${r.jobId}`)
  }
  return result
}

/**
 * Two independent probes. Probe 1 (the tagged anomaly row) is authoritative;
 * probe 2 is a best-effort second opinion, because logTransaction swallows its
 * own failures and may have written nothing.
 */
async function alreadyRefunded(jobIds: string[]): Promise<Set<string>> {
  const done = new Set<string>()
  if (jobIds.length === 0) return done

  for (const ids of chunk(jobIds, PAGE_SIZE)) {
    const { data, error } = await supabase
      .from("credit_anomalies" as "assets")
      .select("job_id, admin_notes")
      .in("job_id", ids)
    if (error) throw new Error(`credit_anomalies query failed: ${error.message}`)
    for (const r of (data ?? []) as unknown as Array<{ job_id: string | null; admin_notes: string | null }>) {
      if (r.job_id && r.admin_notes?.includes(REFUND_TAG)) done.add(r.job_id)
    }
  }

  // adminAdjustCredits logs with no job_id, so the job is identified by the
  // description this script writes.
  const { data: txs, error: txError } = await supabase
    .from("credit_transactions")
    .select("description")
    .eq("source", "admin_adjustment")
    .ilike("description", `%${REFUND_TAG}%`)
  if (txError) throw new Error(`credit_transactions query failed: ${txError.message}`)
  const descriptions = ((txs ?? []) as unknown as Array<{ description: string | null }>).map((t) => t.description ?? "")
  for (const id of jobIds) {
    if (descriptions.some((d) => d.includes(id))) done.add(id)
  }

  return done
}

/**
 * Goodwill somebody may already have paid this payer since the job ran. A FLAG
 * for the operator, never a gate: an unrelated admin adjustment is common, and
 * only a human can tell whether it was meant to cover this.
 */
async function priorAdjustments(
  rows: TopazRefundRow[],
  /** Nothing before the earliest job we are asking about can be "prior goodwill". */
  floor: string,
): Promise<Map<string, Array<{ amount: number; source: string; at: string }>>> {
  const out = new Map<string, Array<{ amount: number; source: string; at: string }>>()
  const userIds = [...new Set(rows.map((r) => r.userId))]
  if (userIds.length === 0) return out

  const found: GoodwillRow[] = []
  for (const ids of chunk(userIds, PAGE_SIZE)) {
    // Paged: an unbounded PostgREST select stops at 1000 rows with no error,
    // which would silently turn "already made whole" into "-" on the table.
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("credit_transactions")
        .select("user_id, amount, source, description, created_at")
        .in("user_id", ids)
        .in("source", [...GOODWILL_SOURCES])
        .gte("created_at", floor)
        .order("created_at", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1)
      if (error) throw new Error(`credit_transactions goodwill query failed: ${error.message}`)
      const page = (data ?? []) as unknown as GoodwillRow[]
      found.push(...page)
      if (page.length < PAGE_SIZE) break
    }
  }

  for (const r of rows) {
    const since = r.jobCreatedAt ? Date.parse(r.jobCreatedAt) : NaN
    const hits = found.filter((t) => {
      if (t.user_id !== r.userId) return false
      // This script's own rows are not "prior" goodwill.
      if (t.description?.includes(REFUND_TAG)) return false
      if (Number.isNaN(since)) return true
      const at = t.created_at ? Date.parse(t.created_at) : NaN
      return !Number.isNaN(at) && at >= since
    })
    if (hits.length > 0) {
      out.set(r.jobId, hits.map((t) => ({
        amount: t.amount ?? 0,
        source: t.source ?? "?",
        at: (t.created_at ?? "").slice(0, 10),
      })))
    }
  }
  return out
}

// Guarded so the test can import the helpers without running the script.
// Exact-path, not a substring match: the test file is ALSO named
// `topaz-overcharge-refund…`, and a substring guard would run the whole script
// on any direct `node --import tsx <that test>` invocation.
const invokedDirectly = process.argv[1] != null
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((r) => { if (!r.ok) process.exitCode = 1 })
    .catch((err) => {
      console.error("[topaz-refund] failed:", err)
      process.exitCode = 1
    })
}
