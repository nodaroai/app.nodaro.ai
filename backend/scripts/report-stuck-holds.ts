/**
 * READ-ONLY report of credit holds left open: `usage_logs` rows still
 * `reserved` whose job has already finished, or that are older than N hours.
 *
 * Why it exists: before app PR #2202, the pipeline worker lane
 * (`ee/pipelines/services/_run-worker-job.ts`) and `POST /v1/credits/reserve`
 * callers reserved without linking `jobs.usage_log_id`, so a worker that reads
 * its reservation off the job row never committed or refunded those holds.
 * This lists them with the settlement each one needs:
 *
 *   - job completed → commit at `jobs.credits_actual` when recorded, else at
 *     the reserved amount — UNLESS the job already has a committed reservation,
 *     in which case this one is a duplicate hold and is refunded;
 *   - job failed / cancelled → refund;
 *   - `job-once` (managed) reservations are owned by the managed recovery cron
 *     and only reported;
 *   - anything else (no job, job still live) → investigate, never settled.
 *
 * Writes nothing. Prints no environment values, no user content, no full user
 * ids (8-char prefixes only).
 *
 * Usage: npx tsx backend/scripts/report-stuck-holds.ts [--hours 24] [--rows 200] [--json out.json]
 */
import "dotenv/config"
import { writeFileSync } from "node:fs"
import { createClient } from "@supabase/supabase-js"

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const STALE_HOURS = Number(arg("hours", "24"))
const ROW_LIMIT = Number(arg("rows", "200"))
const JSON_OUT = arg("json", "")

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from the environment")
  process.exit(1)
}
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

interface LogRow {
  id: string
  user_id: string
  job_id: string | null
  action: string | null
  provider: string | null
  credits_used: number
  created_at: string
  workspace_id: string | null
  on_behalf_of: string | null
  reservation_mode: string | null
  external_wallet: string | null
  allowance_enforced: string | null
  from_sub: string | null
  from_topup: string | null
  allowance_delta: string | null
  meta_pipeline_id: string | null
}
interface JobRow {
  id: string
  status: string
  job_type: string | null
  pipeline_id: string | null
  credits_actual: number | null
  usage_log_id: string | null
  workflow_execution_id: string | null
  created_at: string
  completed_at: string | null
}

const PAGE = 1000
const CHUNK = 100
const TERMINAL = new Set(["completed", "failed", "cancelled"])

async function allReservedLogs(): Promise<LogRow[]> {
  const out: LogRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("usage_logs")
      .select(
        "id, user_id, job_id, action, provider, credits_used, created_at, workspace_id, on_behalf_of, " +
          "reservation_mode:metadata->>reservation_mode, external_wallet:metadata->>external_wallet, " +
          "allowance_enforced:metadata->payer->>allowance_enforced, from_sub:metadata->>from_sub, " +
          "from_topup:metadata->>from_topup, allowance_delta:metadata->>allowance_delta, meta_pipeline_id:metadata->>pipeline_id",
      )
      .eq("status", "reserved")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`usage_logs scan failed: ${error.message}`)
    out.push(...((data ?? []) as unknown as LogRow[]))
    if (!data || data.length < PAGE) break
  }
  return out
}

async function jobsById(ids: string[]): Promise<Map<string, JobRow>> {
  const map = new Map<string, JobRow>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id, status, job_type, pipeline_id, credits_actual, usage_log_id, workflow_execution_id, created_at, completed_at")
      .in("id", ids.slice(i, i + CHUNK))
    if (error) throw new Error(`jobs lookup failed: ${error.message}`)
    for (const j of (data ?? []) as JobRow[]) map.set(j.id, j)
  }
  return map
}

/** Every usage log per job (any status) — to spot a completed job that was
 *  ALREADY charged through another reservation. */
async function siblingLogs(jobIds: string[]): Promise<Map<string, { id: string; status: string }[]>> {
  const map = new Map<string, { id: string; status: string }[]>()
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("usage_logs")
      .select("id, job_id, status")
      .in("job_id", jobIds.slice(i, i + CHUNK))
    if (error) throw new Error(`sibling usage_logs lookup failed: ${error.message}`)
    for (const r of (data ?? []) as { id: string; job_id: string; status: string }[]) {
      const list = map.get(r.job_id) ?? []
      list.push({ id: r.id, status: r.status })
      map.set(r.job_id, list)
    }
  }
  return map
}

function ageBucket(hours: number): string {
  if (hours < 1) return "a <1h"
  if (hours < 6) return "b 1-6h"
  if (hours < 24) return "c 6-24h"
  if (hours < 24 * 7) return "d 1-7d"
  if (hours < 24 * 30) return "e 7-30d"
  return "f >30d"
}

type Settlement = "commit" | "refund" | "refund-duplicate" | "managed-cron" | "investigate" | "in-flight"

interface Classified {
  logId: string
  jobId: string | null
  user: string
  jobStatus: string
  jobType: string
  pipeline: boolean
  mode: string
  payer: string
  linked: "this" | "none" | "other" | "n/a"
  reserved: number
  actual: number | null
  ageHours: number
  createdAt: string
  /** How the reservation's recorded pool split relates to credits_used.
   *  `refund_credits` restores the SPLIT (metadata from_sub + from_topup), so
   *  a split that does not sum to credits_used refunds the wrong amount:
   *  "x10" = a pre-redenomination row (migration 289 scaled credits_used but
   *  never the metadata), "none" = no split (refund puts it all in topup). */
  split: "ok" | "x10" | "none" | "mismatch"
  splitSum: number
  allowanceDelta: number
  metaPipelineId: string | null
  /** Hours since the job finished (`completed_at`, else the hold's age). */
  finishedHours: number | null
  settlement: Settlement
  settleAt: number | null
  note: string
}

function splitOf(log: LogRow): Pick<Classified, "split" | "splitSum" | "allowanceDelta"> {
  const splitSum = Number(log.from_sub ?? 0) + Number(log.from_topup ?? 0)
  const allowanceDelta = Number(log.allowance_delta ?? 0)
  const split =
    splitSum === 0 ? "none" : splitSum === log.credits_used ? "ok" : splitSum * 10 === log.credits_used ? "x10" : "mismatch"
  return { split, splitSum, allowanceDelta }
}

function classify(log: LogRow, job: JobRow | undefined, siblings: { id: string; status: string }[]): Classified {
  const ageHours = (Date.now() - new Date(log.created_at).getTime()) / 3_600_000
  const payer = log.workspace_id
    ? "workspace"
    : log.external_wallet === "true"
      ? "external-wallet"
      : log.allowance_enforced === "true" && log.on_behalf_of
        ? "deployment-allowance"
        : "personal"
  const base = {
    logId: log.id,
    jobId: log.job_id,
    user: log.user_id.slice(0, 8),
    jobStatus: job?.status ?? (log.job_id ? "job-missing" : "no-job"),
    jobType: job?.job_type ?? log.action ?? "?",
    pipeline: !!job?.pipeline_id,
    mode: log.reservation_mode ?? "legacy",
    payer,
    linked: (!job ? "n/a" : job.usage_log_id === log.id ? "this" : job.usage_log_id ? "other" : "none") as Classified["linked"],
    reserved: log.credits_used,
    actual: job?.credits_actual ?? null,
    ageHours,
    createdAt: log.created_at,
    ...splitOf(log),
    metaPipelineId: log.meta_pipeline_id,
    finishedHours: job ? (Date.now() - new Date(job.completed_at ?? log.created_at).getTime()) / 3_600_000 : null,
  }
  if (log.reservation_mode === "job-once") {
    return { ...base, settlement: "managed-cron", settleAt: null, note: "owned by recoverManagedJobSettlements" }
  }
  if (!job) {
    return { ...base, settlement: ageHours >= STALE_HOURS ? "investigate" : "in-flight", settleAt: null, note: "no job row" }
  }
  if (!TERMINAL.has(job.status)) {
    return {
      ...base,
      settlement: ageHours >= STALE_HOURS ? "investigate" : "in-flight",
      settleAt: null,
      note: `job ${job.status}`,
    }
  }
  if (job.status === "completed") {
    const charged = siblings.filter((s) => s.id !== log.id && s.status === "committed")
    if (charged.length > 0) {
      return { ...base, settlement: "refund-duplicate", settleAt: 0, note: `job already charged via ${charged.length} committed log(s)` }
    }
    const at = job.credits_actual ?? log.credits_used
    return {
      ...base,
      settlement: "commit",
      settleAt: at,
      note: job.credits_actual != null ? "at credits_actual" : "at reserved (no recorded actual)",
    }
  }
  return { ...base, settlement: "refund", settleAt: 0, note: `job ${job.status}` }
}

function table(title: string, rows: Classified[], keyOf: (r: Classified) => string): void {
  const groups = new Map<string, { n: number; held: number }>()
  for (const r of rows) {
    const k = keyOf(r)
    const g = groups.get(k) ?? { n: 0, held: 0 }
    g.n++
    g.held += r.reserved
    groups.set(k, g)
  }
  console.log(`\n## ${title}`)
  console.log("| group | rows | held credits |")
  console.log("|---|---:|---:|")
  for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].held - a[1].held)) {
    console.log(`| ${k} | ${g.n} | ${g.held} |`)
  }
}

/** Pipelines that point at a hold (`pipelines.reservation_usage_log_id`). */
async function pipelinesByHold(ids: string[]): Promise<Map<string, { status: string; spent: number; user: string }>> {
  const map = new Map<string, { status: string; spent: number; user: string }>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("pipelines")
      .select("status, spent_credits, user_id, reservation_usage_log_id")
      .in("reservation_usage_log_id", ids.slice(i, i + CHUNK))
    if (error) throw new Error(`pipelines lookup failed: ${error.message}`)
    for (const p of data ?? []) {
      map.set(p.reservation_usage_log_id as string, {
        status: p.status as string,
        spent: (p.spent_credits as number) ?? 0,
        user: String(p.user_id).slice(0, 8),
      })
    }
  }
  return map
}

/**
 * What migration 516 would settle if it ran NOW, by its own predicate. The
 * release check compares this against the `516 linked:` / `516 job-less:`
 * lines of the `migrate` job log. Group A's cutoff rolls (holds over 24h old,
 * jobs finished over 1h ago), so run this just before the release.
 */
async function migration516Scope(all: Classified[]): Promise<void> {
  const eligible = (r: Classified) => r.mode === "legacy" && r.payer === "personal"
  const trustedSplit = (r: Classified) => r.split === "ok" || r.split === "x10"
  const linked = all.filter(
    (r) => eligible(r) && r.linked === "this" && TERMINAL.has(r.jobStatus) && r.ageHours >= 24 && (r.finishedHours ?? 0) >= 1,
  )
  const commit = linked.filter((r) => r.settlement === "commit")
  const refund = linked.filter((r) => r.settlement === "refund" && trustedSplit(r))
  const linkedSkipped = linked.length - commit.length - refund.length

  const jobless = all.filter((r) => eligible(r) && r.jobStatus === "no-job" && r.createdAt < "2026-08-01")
  const pipes = await pipelinesByHold(jobless.map((r) => r.logId))
  const joblessRefund = jobless.filter((r) => {
    const p = pipes.get(r.logId)
    if (p && (p.user !== r.user || p.status === "running" || p.status === "stopping" || p.spent !== 0)) return false
    return trustedSplit(r)
  })

  const sum = (rows: Classified[]) => rows.reduce((s, r) => s + r.reserved, 0)
  console.log("\n## migration 516 scope, as it would run now")
  console.log(
    `expected: "516 linked: committed ${commit.length}, refunded ${refund.length}, skipped ${linkedSkipped}, failed 0" ` +
      `(commit holds ${sum(commit)}, refund returns ${sum(refund)})`,
  )
  console.log(
    `expected: "516 job-less: refunded ${joblessRefund.length}, skipped ${jobless.length - joblessRefund.length}, failed 0" ` +
      `(refund returns ${sum(joblessRefund)}; ${pipes.size} pipeline holds)`,
  )
}

async function main(): Promise<void> {
  const logs = await allReservedLogs()
  const jobIds = [...new Set(logs.map((l) => l.job_id).filter((x): x is string => !!x))]
  const [jobs, siblings] = await Promise.all([jobsById(jobIds), siblingLogs(jobIds)])
  const all = logs.map((l) => classify(l, l.job_id ? jobs.get(l.job_id) : undefined, l.job_id ? siblings.get(l.job_id) ?? [] : []))

  // In scope: finished job, or older than the stale threshold.
  const inScope = all.filter((r) => TERMINAL.has(r.jobStatus) || r.ageHours >= STALE_HOURS)
  const settle = inScope.filter((r) => r.settlement === "commit" || r.settlement === "refund" || r.settlement === "refund-duplicate")

  console.log(`# Stuck credit holds — ${new Date().toISOString()}`)
  console.log(`stale threshold: ${STALE_HOURS}h`)
  console.log(`reserved usage_logs total: ${all.length} (held ${all.reduce((s, r) => s + r.reserved, 0)} credits)`)
  console.log(`in scope (finished job OR older than ${STALE_HOURS}h): ${inScope.length} (held ${inScope.reduce((s, r) => s + r.reserved, 0)} credits)`)
  console.log(`distinct users in scope: ${new Set(inScope.map((r) => r.user)).size}`)

  table("in scope by settlement", inScope, (r) => r.settlement)
  table("in scope by job status", inScope, (r) => r.jobStatus)
  table("in scope by age", inScope, (r) => ageBucket(r.ageHours))
  table("in scope by job_type", inScope, (r) => r.jobType)
  table("in scope by pipeline job", inScope, (r) => (r.pipeline ? "pipeline" : "not pipeline"))
  table("in scope by reservation mode", inScope, (r) => r.mode)
  table("in scope by payer", inScope, (r) => r.payer)
  table("in scope by jobs.usage_log_id link", inScope, (r) => r.linked)
  table("settleable by settlement × job status × link", settle, (r) => `${r.settlement} / ${r.jobStatus} / link=${r.linked}`)
  table("settleable by pool split", settle, (r) => `${r.settlement} / split=${r.split}`)
  table("settleable with an allowance delta", settle.filter((r) => r.allowanceDelta !== 0), (r) => `${r.settlement} / delta=${r.allowanceDelta}`)
  table("settleable by month created", settle, (r) => r.createdAt.slice(0, 7))
  table("all reserved (incl. in flight) by settlement", all, (r) => r.settlement)

  await migration516Scope(all)

  const commitTotal = settle.filter((r) => r.settlement === "commit")
  const refundTotal = settle.filter((r) => r.settlement !== "commit")
  console.log("\n## settlement totals")
  console.log(
    `commit: ${commitTotal.length} rows, held ${commitTotal.reduce((s, r) => s + r.reserved, 0)}, ` +
      `charged ${commitTotal.reduce((s, r) => s + (r.settleAt ?? 0), 0)} ` +
      `(${commitTotal.filter((r) => r.actual != null).length} at recorded actual)`,
  )
  console.log(`refund: ${refundTotal.length} rows, returned ${refundTotal.reduce((s, r) => s + r.reserved, 0)}`)

  console.log(`\n## rows (first ${ROW_LIMIT}, oldest first)`)
  console.log("| usage_log | job | user | job status | job_type | pipeline | mode | payer | link | reserved | split | actual | age h | settlement | at | note |")
  console.log("|---|---|---|---|---|---|---|---|---|---:|---|---:|---:|---|---:|---|")
  for (const r of [...inScope].sort((a, b) => b.ageHours - a.ageHours).slice(0, ROW_LIMIT)) {
    console.log(
      `| ${r.logId} | ${r.jobId ?? "-"} | ${r.user} | ${r.jobStatus} | ${r.jobType} | ${r.pipeline ? "y" : "n"} | ${r.mode} | ${r.payer} | ${r.linked} | ${r.reserved} | ${r.split}:${r.splitSum} | ${r.actual ?? "-"} | ${r.ageHours.toFixed(1)} | ${r.settlement} | ${r.settleAt ?? "-"} | ${r.note}${r.metaPipelineId ? ` (pipeline ${r.metaPipelineId})` : ""} |`,
    )
  }
  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify(inScope, null, 2))
    console.log(`\nwrote ${inScope.length} rows to ${JSON_OUT}`)
  }
}

main().catch((err) => {
  console.error((err as Error).message)
  process.exit(1)
})
