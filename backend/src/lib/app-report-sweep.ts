import cron from "node-cron"
import { supabase } from "./supabase.js"
import { insertAppReport } from "./app-reports.js"
import {
  EXECUTION_REPORT_SOURCE_COLUMNS,
  JOB_REPORT_SOURCE_COLUMNS,
  appReportContentRedaction,
  executionReportSourceErased,
  jobReportSourceErased,
} from "./app-run-content.js"
import { isContentRejection, rejectionClassOf } from "./mcp/tools/_job-error.js"

/**
 * Failed-work sweeps → `app_reports`.
 *
 * Job failures are written from many sites (workers, reconcile crons, ee
 * pipelines) with no single choke point, so failures are collected by
 * periodically CLASSIFYING recent failed rows instead of instrumenting every
 * failure path: zero risk to generation code, and it catches all of them —
 * every provider lane included (KIE, Replicate, direct ElevenLabs, direct
 * Anthropic/Gemini/OpenAI, ffmpeg, Remotion), because they all end as a
 * failed `jobs` row.
 *
 * Three classifications per failed job, in this order:
 *   - OUR OWN job-policy block  → kind 'policy-block'    (info)
 *   - content-policy rejections → kind 'model-rejection' (warning)
 *   - everything else           → kind 'job-failure'     (error)
 *
 * The policy-block branch must come FIRST and must key on the structured
 * `error_hint` (spec 2026-09-03-job-policy-hook-design §6.3, D12), never on the
 * message text: a registered policy's user-safe reason routinely contains the
 * words "content policy", which is exactly the substring `isContentRejection`
 * matches — so without the branch, day one of enforcement files a
 * `model-rejection` report titled "rejected by the PROVIDER's content filter"
 * for a decision THIS deployment made, at `severity: 'error'`-adjacent volume.
 * A gate that is working is not an incident, hence `severity: 'info'`.
 *
 * Plus a second sweep over `workflow_executions`: runs that failed WITHOUT
 * any failed job — orchestrator-level errors (payload builder throws, credit
 * reservation walls, timeouts) that never reach a provider — become kind
 * 'execution-failure'. Executions with a failed job are skipped: the
 * job-level report already carries the root cause.
 *
 * Idempotency: dedupe against existing reports by job_id / execution_id, with
 * the partial UNIQUE (kind, job_id) and (kind, execution_id) indexes as the
 * race-proof net (insertAppReport treats 23505 as a no-op). The 48h lookback
 * overlaps successive runs on purpose.
 *
 * An admin app expunge can erase a job or execution between this sweep's read
 * and its insert; the report filed from the stale read would keep the erased
 * content for good, since the dedup never re-files it. Each sweep therefore
 * re-reads the sources of the reports it just filed and clears the ones whose
 * source is erased now — see `clearReportsOfErasedSources`.
 */

const LOOKBACK_HOURS = 48
const SCAN_LIMIT = 500
const PROMPT_EXCERPT_MAX = 1000
const ERROR_EXCERPT_MAX = 500
const ID_CHUNK = 100

interface FailedJobRow {
  id: string
  error_message: string | null
  error_detail: string | null
  user_id: string | null
  provider: string | null
  provider_kind: string | null
  source: string | null
  source_detail: string | null
  completed_at: string | null
  input_data: Record<string, unknown> | null
  /** migration 376's structured verdict. `{kind:"policy-block"}` means the
   *  failure is OURS, not the provider's — see the classifier below. */
  error_hint?: { kind?: string; policyId?: string; hookPoint?: string } | null
}

interface FailedExecutionRow {
  id: string
  workflow_id: string | null
  user_id: string | null
  status: string
  trigger_type: string | null
  error_message: string | null
  node_states: Record<string, { status?: string; error?: string }> | null
  completed_at: string | null
}

function promptField(inputData: Record<string, unknown> | null, key: string): string | null {
  const v = inputData?.[key]
  return typeof v === "string" && v.length > 0 ? v : null
}

/**
 * THE TEXT THE PROVIDER JUDGED — `input_data.prompt`, which is what the route
 * / orchestrator actually sent (buildJobInputData spreads the parsed body; the
 * orchestrator writes the built payload back after buildPayload).
 *
 * This deliberately PREFERS `prompt` over `userPrompt`, reversing the original
 * "show what the user typed" reading. `userPrompt` is the AUTHORED TEMPLATE,
 * pre-resolution: the canvas stamps it straight from `node.data.prompt`
 * (`execute-node.ts` setUserPromptTemplate) before `{Label}` refs, `{image:N}`
 * reference tokens, @-mentions, identity-lock clauses, style folds and
 * character descriptions are expanded into the real request. For a
 * CONTENT-REJECTION report that is the wrong string twice over:
 *   - it can be near-empty ("{Text}" for a 2 000-character scene), so the
 *     report says nothing at all about what was refused;
 *   - the expansion is OURS, so hiding it hides the one hypothesis the report
 *     exists to test — whether Nodaro's own prompt assembly is what tripped
 *     the filter.
 * Measured on the 2026-09-15 rejection-sweep triage: 18 of 48 rows (37%) had
 * `userPrompt !== prompt`, three of them excerpts of 6-15 characters standing
 * in for 141-2 029-character prompts.
 *
 * The authored template is not lost — `excerptPromptTemplate` carries it
 * alongside whenever it differs.
 */
export function excerptPrompt(inputData: Record<string, unknown> | null): string | null {
  const sent = promptField(inputData, "prompt") ?? promptField(inputData, "userPrompt")
  return sent ? sent.slice(0, PROMPT_EXCERPT_MAX) : null
}

/** The author-typed template `prompt` was expanded from, and ONLY when the two
 *  differ — a job whose request was never derived would otherwise carry the
 *  same string twice. Null for every job that did no expansion, so the payload
 *  grows only where the difference is the diagnosis. */
export function excerptPromptTemplate(inputData: Record<string, unknown> | null): string | null {
  const sent = promptField(inputData, "prompt")
  const authored = promptField(inputData, "userPrompt")
  if (!sent || !authored || sent === authored) return null
  return authored.slice(0, PROMPT_EXCERPT_MAX)
}

/** The parameters that decide whether a provider accepts a request — read from
 *  `input_data` (buildJobInputData spreads the whole parsed body; the
 *  orchestrator writes the built payload back after buildPayload). Media URLs
 *  are reduced to presence/count: the report is admin-only but the payload is
 *  copied around, and a URL is never needed to triage a parameter reject. */
const PARAM_KEYS = ["aspectRatio", "resolution", "quality", "duration", "mode", "size", "generationType", "customMode", "executionId", "origin"] as const
const URL_ARRAY_KEYS = ["referenceImageUrls", "imageUrls", "videoUrls", "audioUrls"] as const
const URL_KEYS = ["imageUrl", "videoUrl", "audioUrl", "firstFrameUrl", "lastFrameUrl"] as const

export function paramsOf(inputData: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!inputData) return out
  for (const k of PARAM_KEYS) {
    const v = inputData[k]
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v
  }
  for (const k of URL_ARRAY_KEYS) {
    const v = inputData[k]
    if (Array.isArray(v)) out[k] = v.length
  }
  for (const k of URL_KEYS) {
    if (typeof inputData[k] === "string" && (inputData[k] as string).length > 0) out[k] = true
  }
  return out
}

/** The model id key varies by job type: generate-image stores `model`,
 *  character/entity assets store it as `provider` (legacy naming — it holds a
 *  MODEL_CATALOG id), LLM jobs store `llmModel`. First string wins. */
function modelOf(inputData: Record<string, unknown> | null): string | null {
  for (const key of ["model", "provider", "llmModel"] as const) {
    const v = inputData?.[key]
    if (typeof v === "string" && v.length > 0) return v
  }
  return null
}

function jobReportBasics(job: FailedJobRow) {
  const model = modelOf(job.input_data)
  const jobType = typeof job.input_data?.type === "string" ? job.input_data.type : null
  const origin = typeof job.input_data?.origin === "string" ? job.input_data.origin : null
  return { model, jobType, origin }
}

function commonPayload(job: FailedJobRow, model: string | null, jobType: string | null) {
  return {
    model,
    jobType,
    provider: job.provider ?? job.provider_kind,
    providerKind: job.provider_kind,
    source: job.source,
    sourceDetail: job.source_detail,
    error: job.error_message,
    errorDetail: job.error_detail,
    params: paramsOf(job.input_data),
    prompt: excerptPrompt(job.input_data),
    promptTemplate: excerptPromptTemplate(job.input_data),
    failedAt: job.completed_at,
  }
}

export function rejectionReportFor(job: FailedJobRow): Parameters<typeof insertAppReport>[0] {
  const { model, jobType, origin } = jobReportBasics(job)
  return {
    appSlug: origin,
    node: "rejection-sweep",
    kind: "model-rejection",
    severity: "warning",
    title: `${model ?? jobType ?? "A generation"} was rejected by the provider's content filter`,
    payload: { ...commonPayload(job, model, jobType), rejectionClass: rejectionClassOf(job.error_message) },
    userId: job.user_id,
    jobId: job.id,
  }
}

/**
 * A block this deployment's own registered job policy decided — the request
 * gate refusing a generation, or the result gate withholding an output.
 *
 * Deliberately `severity: 'info'`: the other two kinds mean "something went
 * wrong", this one means "the gate did its job". On a moderated instance this
 * is the highest-volume kind by far, and filing it as a warning would drown
 * `/admin/app-reports` in successful enforcement. The title never says
 * "provider" — attributing our decision to the model vendor is the specific
 * mis-report this branch exists to prevent.
 */
export function policyBlockReportFor(job: FailedJobRow): Parameters<typeof insertAppReport>[0] {
  const { model, jobType, origin } = jobReportBasics(job)
  const hint = job.error_hint ?? {}
  const where = hint.hookPoint === "request" ? "before it ran" : "its result was withheld"
  return {
    appSlug: origin,
    node: "policy-sweep",
    kind: "policy-block",
    severity: "info",
    title: `${model ?? jobType ?? "A generation"} was blocked by this deployment's content policy (${where})`,
    payload: {
      ...commonPayload(job, model, jobType),
      policyId: typeof hint.policyId === "string" ? hint.policyId : null,
      hookPoint: typeof hint.hookPoint === "string" ? hint.hookPoint : null,
    },
    userId: job.user_id,
    jobId: job.id,
  }
}

export function failureReportFor(job: FailedJobRow): Parameters<typeof insertAppReport>[0] {
  const { model, jobType, origin } = jobReportBasics(job)
  const error = job.error_message ?? "no error message recorded"
  return {
    appSlug: origin,
    node: "failure-sweep",
    kind: "job-failure",
    severity: "error",
    title: `${model ?? jobType ?? "A job"} failed: ${error.slice(0, 200)}`,
    payload: commonPayload(job, model, jobType),
    userId: job.user_id,
    jobId: job.id,
  }
}

export async function sweepFailedJobs(): Promise<{ scanned: number; reported: number }> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString()
  const { data, error } = await (supabase.from("jobs") as any)
    // NB: jobs has NO model_identifier column — selecting it made PostgREST
    // reject the whole query and this sweep silently scanned nothing from the
    // day it shipped (prod: "column jobs.model_identifier does not exist").
    // The model id lives inside input_data (see modelOf).
    // error_hint (migration 376) is what separates OUR policy block from the
    // provider's content filter — see the classifier below. Without it in the
    // projection the policy-block branch can never fire.
    .select("id, error_message, error_detail, user_id, provider, provider_kind, source, source_detail, completed_at, input_data, error_hint")
    .eq("status", "failed")
    .gte("completed_at", since)
    .order("completed_at", { ascending: false })
    .limit(SCAN_LIMIT)
  if (error) {
    console.warn(`[app-reports] job sweep scan failed: ${error.message}`)
    return { scanned: 0, reported: 0 }
  }

  const rows = (data ?? []) as unknown as FailedJobRow[]
  if (rows.length === 0) return { scanned: 0, reported: 0 }

  // One dedup query across ALL THREE job-derived kinds — the classifier is
  // deterministic per error, so a job only ever maps to one of them. A kind
  // missing from this list means its rows are never seen as "already reported"
  // and the sweep re-files the same job on every tick for 48 hours.
  const { data: existing } = await (supabase.from("app_reports" as "assets") as any)
    .select("job_id")
    .in("kind", ["model-rejection", "job-failure", "policy-block"])
    .in("job_id", rows.map((j) => j.id))
  const seen = new Set(((existing ?? []) as Array<{ job_id: string }>).map((r) => r.job_id))

  let reported = 0
  const filed: FiledReport[] = []
  for (const job of rows) {
    if (seen.has(job.id)) continue
    // ORDER IS THE POINT: the structured hint wins over the message sniff.
    const report =
      job.error_hint?.kind === "policy-block"
        ? policyBlockReportFor(job)
        : isContentRejection(job.error_message)
          ? rejectionReportFor(job)
          : failureReportFor(job)
    if (await insertAppReport(report)) {
      reported++
      filed.push({ kind: report.kind, source: job as unknown as SourceRow })
    }
  }
  await clearReportsOfErasedSources(filed, JOB_SOURCES)
  return { scanned: rows.length, reported }
}

export function executionFailureReportFor(execution: FailedExecutionRow): Parameters<typeof insertAppReport>[0] {
  const failedNodes = Object.entries(execution.node_states ?? {})
    .filter(([, s]) => s?.status === "failed" || typeof s?.error === "string")
    .map(([nodeId, s]) => ({ nodeId, error: typeof s?.error === "string" ? s.error.slice(0, ERROR_EXCERPT_MAX) : null }))
  const error = execution.error_message ?? failedNodes.find((n) => n.error)?.error ?? null
  const timedOut = execution.status === "timed_out"
  return {
    node: "execution-sweep",
    kind: "execution-failure",
    severity: "error",
    title: timedOut
      ? "Workflow execution timed out"
      : `Workflow execution failed before any provider call: ${(error ?? "no error message recorded").slice(0, 200)}`,
    payload: {
      workflowId: execution.workflow_id,
      executionId: execution.id,
      trigger: execution.trigger_type,
      status: execution.status,
      error,
      failedNodes,
      failedAt: execution.completed_at,
    },
    userId: execution.user_id,
    executionId: execution.id,
  }
}

/** Failed/timed-out executions with NO failed job: the failure happened in the
 *  orchestrator itself (bad parameters, unknown node type, credit walls,
 *  timeouts) and would otherwise be invisible — no provider was ever reached. */
export async function sweepFailedExecutions(): Promise<{ scanned: number; reported: number }> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString()
  const { data, error } = await (supabase.from("workflow_executions") as any)
    .select("id, workflow_id, user_id, status, trigger_type, error_message, node_states, completed_at")
    .in("status", ["failed", "timed_out"])
    .gte("completed_at", since)
    .order("completed_at", { ascending: false })
    .limit(SCAN_LIMIT)
  if (error) {
    console.warn(`[app-reports] execution sweep scan failed: ${error.message}`)
    return { scanned: 0, reported: 0 }
  }

  const rows = (data ?? []) as unknown as FailedExecutionRow[]
  if (rows.length === 0) return { scanned: 0, reported: 0 }

  // Executions whose failure already produced a failed job are covered by the
  // job sweep — reporting them again would double every provider failure.
  // Only the execution owner's job covers it (decided 2026-10-06; migration
  // 474): these executions span many users, so `user_id` is compared here, row
  // by row, rather than filtered — a row naming the execution is a pointer.
  const ownerOf = new Map(rows.map((e) => [e.id, e.user_id]))
  const { data: failedJobs } = await (supabase.from("jobs") as any)
    .select("user_id, workflow_execution_id")
    .eq("status", "failed")
    .in("workflow_execution_id", rows.map((e) => e.id))
  const coveredByJob = new Set(
    ((failedJobs ?? []) as Array<{ user_id: string | null; workflow_execution_id: string | null }>)
      .filter((j) => j.workflow_execution_id !== null && j.user_id === ownerOf.get(j.workflow_execution_id))
      .map((j) => j.workflow_execution_id),
  )

  const candidates = rows.filter((e) => !coveredByJob.has(e.id))
  if (candidates.length === 0) return { scanned: rows.length, reported: 0 }

  const { data: existing } = await (supabase.from("app_reports" as "assets") as any)
    .select("execution_id")
    .eq("kind", "execution-failure")
    .in("execution_id", candidates.map((e) => e.id))
  const seen = new Set(((existing ?? []) as Array<{ execution_id: string }>).map((r) => r.execution_id))

  let reported = 0
  const filed: FiledReport[] = []
  for (const execution of candidates) {
    if (seen.has(execution.id)) continue
    const report = executionFailureReportFor(execution)
    if (await insertAppReport(report)) {
      reported++
      filed.push({ kind: report.kind, source: execution as unknown as SourceRow })
    }
  }
  await clearReportsOfErasedSources(filed, EXECUTION_SOURCES)
  return { scanned: rows.length, reported }
}

type SourceRow = Record<string, unknown> & { id: string }

/** A report this sweep run inserted, with the source row it was built from. */
interface FiledReport {
  kind: string
  source: SourceRow
}

/** Where a sweep's reports come from, and what "erased" means there. */
interface ReportSources {
  table: "jobs" | "workflow_executions"
  /** The `app_reports` column that names the source row. */
  pointer: "job_id" | "execution_id"
  columns: readonly string[]
  erased: (row: Readonly<Record<string, unknown>>) => boolean
}

const JOB_SOURCES: ReportSources = {
  table: "jobs",
  pointer: "job_id",
  columns: JOB_REPORT_SOURCE_COLUMNS,
  erased: jobReportSourceErased,
}

const EXECUTION_SOURCES: ReportSources = {
  table: "workflow_executions",
  pointer: "execution_id",
  columns: EXECUTION_REPORT_SOURCE_COLUMNS,
  erased: executionReportSourceErased,
}

/**
 * Clear the reports this run just filed whose source row an admin app expunge
 * erased after the sweep read it (decided 2026-10-07), with the expunge's own
 * patch (`appReportContentRedaction`). The rows stay, like the expunge's.
 *
 * Why this closes the race without a lock: the expunge clears the job, then
 * the reports naming it, each a statement of its own; the sweep inserts the
 * report, then re-reads the job, here. If the job's clear committed before
 * this re-read began, the re-read sees it erased and the report is cleared
 * here. If it committed later, the expunge's report clear began after this
 * re-read, so after the insert committed, and found the report itself. The
 * same holds for executions.
 *
 * Only a source that was intact when read and is erased now: a report built
 * from an already-erased row carries nothing of it. A source row that is gone
 * altogether is left alone. Best-effort, like every report write: a failed
 * read or write is logged and the sweep carries on.
 */
async function clearReportsOfErasedSources(filed: readonly FiledReport[], sources: ReportSources): Promise<void> {
  const kindsOf = new Map<string, Set<string>>()
  for (const { kind, source } of filed) {
    if (sources.erased(source)) continue
    const kinds = kindsOf.get(source.id) ?? new Set<string>()
    kinds.add(kind)
    kindsOf.set(source.id, kinds)
  }
  const ids = [...kindsOf.keys()]
  try {
    const erasedByKind = new Map<string, string[]>()
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK)
      const { data, error } = await (supabase.from(sources.table) as any)
        .select(["id", ...sources.columns].join(", "))
        .in("id", chunk)
      if (error) {
        console.warn(`[app-reports] re-read of ${sources.table} after the sweep failed: ${error.message}`)
        return
      }
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        if (typeof row.id !== "string" || !sources.erased(row)) continue
        for (const kind of kindsOf.get(row.id) ?? []) {
          const list = erasedByKind.get(kind) ?? []
          list.push(row.id)
          erasedByKind.set(kind, list)
        }
      }
    }
    for (const [kind, erasedIds] of erasedByKind) {
      for (let i = 0; i < erasedIds.length; i += ID_CHUNK) {
        const { error } = await (supabase.from("app_reports" as "assets") as any)
          .update(appReportContentRedaction())
          .eq("kind", kind)
          .in(sources.pointer, erasedIds.slice(i, i + ID_CHUNK))
        if (error) console.warn(`[app-reports] clearing reports of erased ${sources.table} failed: ${error.message}`)
      }
    }
  } catch (err) {
    console.warn(`[app-reports] clearing reports of erased ${sources.table} failed:`, err)
  }
}

/** Every 15 minutes; same env gating as the reconcile cron (production, or
 *  ENABLE_CLEANUP_CRON=true for local testing). */
export function startAppReportSweepCron(): void {
  const env = process.env.NODE_ENV ?? "development"
  if (env !== "production" && process.env.ENABLE_CLEANUP_CRON !== "true") {
    console.log("[cron] App-report failure sweep disabled (not production, ENABLE_CLEANUP_CRON not set)")
    return
  }

  cron.schedule("*/15 * * * *", async () => {
    try {
      const jobs = await sweepFailedJobs()
      const executions = await sweepFailedExecutions()
      if (jobs.reported > 0 || executions.reported > 0) {
        console.log(
          `[cron] failure sweep: jobs scanned=${jobs.scanned} reported=${jobs.reported} · executions scanned=${executions.scanned} reported=${executions.reported}`,
        )
      }
    } catch (err) {
      console.error("[cron] failure sweep failed:", err)
    }
  })

  console.log("[cron] App-report failure sweep started (every 15 minutes)")
}
