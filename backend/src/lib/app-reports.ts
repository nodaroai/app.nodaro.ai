import { supabase } from "./supabase.js"

/**
 * Generic diagnostic reports (`app_reports`): any node can drop a report for
 * the platform admin — per-incident picker gaps, provider content rejections,
 * app-originated issues, future stats. One table, open `kind` vocabulary,
 * reviewed at /admin/app-reports.
 *
 * The contract that matters: reporting is ALWAYS best-effort. A report must
 * never break, slow-fail, or throw out of the flow that hosts it, so
 * `insertAppReport` swallows every error (returning false) and treats a
 * duplicate (kind, job_id) as a benign no-op — that unique index is what lets
 * job-derived sweepers re-scan without duplicating.
 */

export interface AppReportInput {
  /** Originating client app slug ('person', 'studio', …); omit for platform-internal. */
  readonly appSlug?: string | null
  /** The reporter — which node/process wrote this ('describe-to-picker', 'rejection-sweep', …). */
  readonly node: string
  /** Open vocabulary ('missing-picker', 'model-rejection', 'issue', …). */
  readonly kind: string
  readonly severity?: "info" | "warning" | "error"
  /** One-liner for the admin list. */
  readonly title: string
  /** Free-form detail (imageUrl, gaps, model, error, prompt…). */
  readonly payload?: Record<string, unknown>
  readonly userId?: string | null
  readonly jobId?: string | null
}

export async function insertAppReport(input: AppReportInput): Promise<boolean> {
  try {
    const { error } = await (supabase.from("app_reports" as "assets") as any).insert({
      app_slug: input.appSlug ?? null,
      node: input.node,
      kind: input.kind,
      severity: input.severity ?? "info",
      title: input.title.slice(0, 300),
      payload: input.payload ?? {},
      user_id: input.userId ?? null,
      job_id: input.jobId ?? null,
    })
    if (error) {
      // 23505 = the (kind, job_id) unique index — an already-reported job.
      if (error.code !== "23505") console.warn(`[app-reports] insert failed: ${error.message}`)
      return false
    }
    return true
  } catch (err) {
    console.warn("[app-reports] insert failed:", err)
    return false
  }
}
