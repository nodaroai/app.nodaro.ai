import cron from "node-cron"
import { supabase } from "./supabase.js"
import { insertAppReport } from "./app-reports.js"
import { isContentRejection } from "./mcp/tools/_job-error.js"

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
 * Two classifications per failed job:
 *   - content-policy rejections → kind 'model-rejection' (warning)
 *   - everything else           → kind 'job-failure'     (error)
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
 */

const LOOKBACK_HOURS = 48
const SCAN_LIMIT = 500
const PROMPT_EXCERPT_MAX = 1000
const ERROR_EXCERPT_MAX = 500

interface FailedJobRow {
  id: string
  error_message: string | null
  user_id: string | null
  provider: string | null
  provider_kind: string | null
  model_identifier: string | null
  source: string | null
  source_detail: string | null
  completed_at: string | null
  input_data: Record<string, unknown> | null
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

/** The prompt the user actually sent: buildJobInputData mirrors the original
 *  to `userPrompt` when a route overwrites `prompt` with a derived one. */
export function excerptPrompt(inputData: Record<string, unknown> | null): string | null {
  const p = inputData?.userPrompt ?? inputData?.prompt
  return typeof p === "string" && p.length > 0 ? p.slice(0, PROMPT_EXCERPT_MAX) : null
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
  const model = job.model_identifier ?? modelOf(job.input_data)
  const jobType = typeof job.input_data?.type === "string" ? job.input_data.type : null
  const origin = typeof job.input_data?.origin === "string" ? job.input_data.origin : null
  return { model, jobType, origin }
}

export function rejectionReportFor(job: FailedJobRow): Parameters<typeof insertAppReport>[0] {
  const { model, jobType, origin } = jobReportBasics(job)
  return {
    appSlug: origin,
    node: "rejection-sweep",
    kind: "model-rejection",
    severity: "warning",
    title: `${model ?? jobType ?? "A generation"} was rejected by the provider's content filter`,
    payload: {
      model,
      jobType,
      provider: job.provider ?? job.provider_kind,
      error: job.error_message,
      prompt: excerptPrompt(job.input_data),
      failedAt: job.completed_at,
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
    payload: {
      model,
      jobType,
      provider: job.provider ?? job.provider_kind,
      source: job.source,
      sourceDetail: job.source_detail,
      error: job.error_message,
      prompt: excerptPrompt(job.input_data),
      failedAt: job.completed_at,
    },
    userId: job.user_id,
    jobId: job.id,
  }
}

export async function sweepFailedJobs(): Promise<{ scanned: number; reported: number }> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString()
  const { data, error } = await (supabase.from("jobs") as any)
    .select("id, error_message, user_id, provider, provider_kind, model_identifier, source, source_detail, completed_at, input_data")
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

  // One dedup query across both job-derived kinds — the classifier is
  // deterministic per error, so a job only ever maps to one of them.
  const { data: existing } = await (supabase.from("app_reports" as "assets") as any)
    .select("job_id")
    .in("kind", ["model-rejection", "job-failure"])
    .in("job_id", rows.map((j) => j.id))
  const seen = new Set(((existing ?? []) as Array<{ job_id: string }>).map((r) => r.job_id))

  let reported = 0
  for (const job of rows) {
    if (seen.has(job.id)) continue
    const report = isContentRejection(job.error_message) ? rejectionReportFor(job) : failureReportFor(job)
    if (await insertAppReport(report)) reported++
  }
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
  const { data: failedJobs } = await (supabase.from("jobs") as any)
    .select("workflow_execution_id")
    .eq("status", "failed")
    .in("workflow_execution_id", rows.map((e) => e.id))
  const coveredByJob = new Set(
    ((failedJobs ?? []) as Array<{ workflow_execution_id: string | null }>).map((j) => j.workflow_execution_id),
  )

  const candidates = rows.filter((e) => !coveredByJob.has(e.id))
  if (candidates.length === 0) return { scanned: rows.length, reported: 0 }

  const { data: existing } = await (supabase.from("app_reports" as "assets") as any)
    .select("execution_id")
    .eq("kind", "execution-failure")
    .in("execution_id", candidates.map((e) => e.id))
  const seen = new Set(((existing ?? []) as Array<{ execution_id: string }>).map((r) => r.execution_id))

  let reported = 0
  for (const execution of candidates) {
    if (seen.has(execution.id)) continue
    if (await insertAppReport(executionFailureReportFor(execution))) reported++
  }
  return { scanned: rows.length, reported }
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
