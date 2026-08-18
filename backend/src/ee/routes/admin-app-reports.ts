import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"

/** Admin surface for `app_reports` — the generic diagnostic inbox any node
 *  can write to (missing pickers, model rejections, internal errors, …).
 *  List + triage only; writing happens through lib/app-reports.ts, never
 *  through this API. */

const updateReportBody = z.object({
  status: z.enum(["new", "reviewed", "resolved", "dismissed"]),
})

const reportIdParams = z.object({ id: z.string().uuid() })

/** Job context attached to each listed report (all best-effort; null when the
 *  report has no job or the job row is gone). `source`/`source_detail` are the
 *  jobs provenance columns (migration 282: mcp | web | cli | sdk | app | api |
 *  …); orchestrated jobs carry them on the EXECUTION instead — trigger type +
 *  mcp client — and app runs resolve to the published app's slug via app_runs. */
interface ReportJobInfo {
  readonly status: string | null
  readonly model_identifier: string | null
  readonly provider: string | null
  readonly error_message: string | null
  readonly source: string | null
  readonly source_detail: string | null
  readonly workflow_execution_id: string | null
  readonly execution_trigger: string | null
  readonly mcp_client: string | null
  readonly app_slug: string | null
}

/** Batch-resolve user emails + job/execution/app-run context for a page of
 *  reports. Enrichment is best-effort by design: any lookup error degrades to
 *  nulls rather than failing the list. */
async function enrichReports(rows: Array<Record<string, unknown>>): Promise<Array<Record<string, unknown>>> {
  const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))] as string[]
  const jobIds = [...new Set(rows.map((r) => r.job_id).filter(Boolean))] as string[]

  const [{ data: users }, { data: jobs }] = await Promise.all([
    userIds.length > 0
      ? ((supabase.from("profiles") as any).select("id, email").in("id", userIds) as Promise<{ data: any[] | null }>)
      : Promise.resolve({ data: [] }),
    jobIds.length > 0
      ? ((supabase.from("jobs") as any)
          .select("id, status, model_identifier, provider, error_message, source, source_detail, workflow_execution_id")
          .in("id", jobIds) as Promise<{ data: any[] | null }>)
      : Promise.resolve({ data: [] }),
  ])
  const userMap = new Map((users ?? []).map((u: any) => [u.id, u.email]))

  // Orchestrated jobs: the caller lives on the execution (trigger type + mcp
  // client), and an app_runs row means the run came from a published app.
  const executionIds = [...new Set((jobs ?? []).map((j: any) => j.workflow_execution_id).filter(Boolean))] as string[]
  const [{ data: executions }, { data: appRuns }] = executionIds.length > 0
    ? await Promise.all([
        (supabase.from("workflow_executions") as any).select("id, trigger_type, mcp_client").in("id", executionIds) as Promise<{ data: any[] | null }>,
        (supabase.from("app_runs") as any).select("execution_id, app_id").in("execution_id", executionIds) as Promise<{ data: any[] | null }>,
      ])
    : [{ data: [] }, { data: [] }]
  const executionMap = new Map((executions ?? []).map((e: any) => [e.id, e]))
  const appRunMap = new Map((appRuns ?? []).map((r: any) => [r.execution_id, r.app_id]))

  const appIds = [...new Set([...appRunMap.values()].filter(Boolean))] as string[]
  const { data: apps } = appIds.length > 0
    ? await ((supabase.from("published_apps") as any).select("id, slug").in("id", appIds) as Promise<{ data: any[] | null }>)
    : { data: [] as any[] }
  const appSlugMap = new Map((apps ?? []).map((a: any) => [a.id, a.slug]))

  const jobMap = new Map(
    (jobs ?? []).map((j: any) => {
      const execution = j.workflow_execution_id ? executionMap.get(j.workflow_execution_id) : undefined
      const appId = j.workflow_execution_id ? appRunMap.get(j.workflow_execution_id) : undefined
      const info: ReportJobInfo = {
        status: j.status ?? null,
        model_identifier: j.model_identifier ?? null,
        provider: j.provider ?? null,
        error_message: j.error_message ?? null,
        source: j.source ?? null,
        source_detail: j.source_detail ?? null,
        workflow_execution_id: j.workflow_execution_id ?? null,
        execution_trigger: (execution as any)?.trigger_type ?? null,
        mcp_client: (execution as any)?.mcp_client ?? null,
        app_slug: appId ? ((appSlugMap.get(appId) as string | undefined) ?? null) : null,
      }
      return [j.id, info]
    }),
  )

  return rows.map((r) => ({
    ...r,
    user_email: r.user_id ? ((userMap.get(r.user_id) as string | undefined) ?? null) : null,
    job: r.job_id ? (jobMap.get(r.job_id) ?? null) : null,
  }))
}

export async function adminAppReportsRoutes(app: FastifyInstance): Promise<void> {
  // List reports, newest first, with filters + pagination.
  app.get("/v1/admin/app-reports", { preHandler: requireAdmin }, async (req, reply) => {
    const { offset = "0", limit = "50", kind, appSlug, node, status } = req.query as {
      offset?: string; limit?: string; kind?: string; appSlug?: string; node?: string; status?: string
    }
    const from = parseInt(offset, 10)
    const size = Math.min(parseInt(limit, 10) || 50, 100)

    let query = supabase
      .from("app_reports" as "assets")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + size - 1) as unknown as ReturnType<typeof supabase.from>

    if (kind) query = (query as any).eq("kind", kind)
    if (appSlug) query = (query as any).eq("app_slug", appSlug)
    if (node) query = (query as any).eq("node", node)
    if (status) query = (query as any).eq("status", status)

    const { data, error, count } = await (query as any)
    if (error) return reply.status(500).send({ error: { message: error.message } })
    return reply.send({ data: await enrichReports(data ?? []), total: count ?? 0 })
  })

  // Update a report's triage status.
  app.patch("/v1/admin/app-reports/:id", { preHandler: requireAdmin }, async (req, reply) => {
    const paramsResult = reportIdParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: paramsResult.error.issues[0]?.message ?? "Invalid id" } })
    }
    const bodyResult = updateReportBody.safeParse(req.body ?? {})
    if (!bodyResult.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: bodyResult.error.issues[0]?.message ?? "Invalid request" } })
    }
    const { error } = await (supabase
      .from("app_reports" as "assets")
      .update({ status: bodyResult.data.status })
      .eq("id", paramsResult.data.id) as any)
    if (error) return reply.status(500).send({ error: { message: error.message } })
    return reply.send({ ok: true })
  })
}
