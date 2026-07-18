import cron from "node-cron"
import { supabase } from "./supabase.js"
import { insertAppReport } from "./app-reports.js"
import { isContentRejection } from "./mcp/tools/_job-error.js"

/**
 * Model-rejection sweep → `app_reports` (kind 'model-rejection').
 *
 * Job failures are written from many sites (workers, reconcile crons, ee
 * pipelines) with no single choke point, so rejections are collected by
 * periodically CLASSIFYING recent failed jobs instead of instrumenting every
 * failure path: zero risk to generation code, and it catches all of them.
 * Everything needed is already on the jobs row — `error_message` (the
 * sanitized provider error), `input_data` (the original request incl. prompt;
 * failure updates never null it), `provider_kind`.
 *
 * Idempotency: dedupe against existing reports by job_id, with the partial
 * UNIQUE (kind, job_id) index as the race-proof net (insertAppReport treats
 * 23505 as a no-op). The 48h lookback overlaps successive runs on purpose.
 */

const LOOKBACK_HOURS = 48
const SCAN_LIMIT = 500
const PROMPT_EXCERPT_MAX = 1000

interface FailedJobRow {
  id: string
  error_message: string | null
  user_id: string | null
  provider_kind: string | null
  completed_at: string | null
  input_data: Record<string, unknown> | null
}

/** The prompt the user actually sent: buildJobInputData mirrors the original
 *  to `userPrompt` when a route overwrites `prompt` with a derived one. */
export function excerptPrompt(inputData: Record<string, unknown> | null): string | null {
  const p = inputData?.userPrompt ?? inputData?.prompt
  return typeof p === "string" && p.length > 0 ? p.slice(0, PROMPT_EXCERPT_MAX) : null
}

export function rejectionReportFor(job: FailedJobRow): Parameters<typeof insertAppReport>[0] {
  const model = typeof job.input_data?.model === "string" ? job.input_data.model : null
  const jobType = typeof job.input_data?.type === "string" ? job.input_data.type : null
  return {
    node: "rejection-sweep",
    kind: "model-rejection",
    severity: "warning",
    title: `${model ?? jobType ?? "A generation"} was rejected by the provider's content filter`,
    payload: {
      model,
      jobType,
      provider: job.provider_kind,
      error: job.error_message,
      prompt: excerptPrompt(job.input_data),
      failedAt: job.completed_at,
    },
    userId: job.user_id,
    jobId: job.id,
  }
}

export async function sweepModelRejections(): Promise<{ scanned: number; reported: number }> {
  const since = new Date(Date.now() - LOOKBACK_HOURS * 3_600_000).toISOString()
  const { data, error } = await supabase
    .from("jobs")
    .select("id, error_message, user_id, provider_kind, completed_at, input_data")
    .eq("status", "failed")
    .gte("completed_at", since)
    .order("completed_at", { ascending: false })
    .limit(SCAN_LIMIT)
  if (error) {
    console.warn(`[app-reports] rejection sweep scan failed: ${error.message}`)
    return { scanned: 0, reported: 0 }
  }

  const rows = (data ?? []) as unknown as FailedJobRow[]
  const rejected = rows.filter((j) => isContentRejection(j.error_message))
  if (rejected.length === 0) return { scanned: rows.length, reported: 0 }

  const { data: existing } = await (supabase.from("app_reports" as "assets") as any)
    .select("job_id")
    .eq("kind", "model-rejection")
    .in("job_id", rejected.map((j) => j.id))
  const seen = new Set(((existing ?? []) as Array<{ job_id: string }>).map((r) => r.job_id))

  let reported = 0
  for (const job of rejected) {
    if (seen.has(job.id)) continue
    if (await insertAppReport(rejectionReportFor(job))) reported++
  }
  return { scanned: rows.length, reported }
}

/** Every 15 minutes; same env gating as the reconcile cron (production, or
 *  ENABLE_CLEANUP_CRON=true for local testing). */
export function startAppReportSweepCron(): void {
  const env = process.env.NODE_ENV ?? "development"
  if (env !== "production" && process.env.ENABLE_CLEANUP_CRON !== "true") {
    console.log("[cron] App-report rejection sweep disabled (not production, ENABLE_CLEANUP_CRON not set)")
    return
  }

  cron.schedule("*/15 * * * *", async () => {
    try {
      const { scanned, reported } = await sweepModelRejections()
      if (reported > 0) console.log(`[cron] rejection sweep: scanned=${scanned} reported=${reported}`)
    } catch (err) {
      console.error("[cron] rejection sweep failed:", err)
    }
  })

  console.log("[cron] App-report rejection sweep started (every 15 minutes)")
}
