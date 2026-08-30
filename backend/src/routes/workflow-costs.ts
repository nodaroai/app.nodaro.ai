import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { requireScope } from "../lib/scopes.js"
import { getBillingProvider, type Charge } from "../lib/billing-provider.js"
import { sanitizeCostSummaryForPublic } from "./jobs.js"

const costSummaryBody = z.object({
  jobIds: z.array(z.string().min(1)).min(1).max(500),
})

// The owner-scoped DB read is for METADATA only (status + input_data grouping);
// money comes from the registered BillingProvider.report() (§5.2 rule 1). This
// preserves the IDOR hardening (owner-scoped select) while sourcing charges from
// the metering authority instead of coalescing an unanswered lookup to 0.
interface JobRow {
  readonly id: string
  readonly status: string
  readonly input_data: Record<string, unknown> | null
}

interface BreakdownEntry {
  node_type: string
  model: string
  runs: number
  successful: number
  failed: number
  total_credits: number | null
  total_cost_usd: number | null
  avg_credits_per_run: number | null
  unavailable: number
}

export async function workflowCostRoutes(app: FastifyInstance) {
  app.post("/v1/jobs/cost-summary", async (req, reply) => {
    // Auth + owner-scoping (mirrors POST /v1/jobs/batch-status). Without this, the
    // service-role query below (bypasses RLS) was an IDOR: any authed user could
    // POST arbitrary job ids and read another user's provider_cost/display_cost/
    // credits/input_data (prompt, provider) — data hidden from non-admins.
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }
    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "jobs:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }

    const parsed = costSummaryBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { jobIds } = parsed.data
    const isAdmin = req.userRole === "admin" || req.userRole === "super_admin"

    let query = supabase
      .from("jobs")
      .select("id, status, input_data")
      .in("id", jobIds)
    if (!isAdmin) {
      query = query.eq("user_id", req.userId)
    }
    const { data: jobs, error } = await query

    if (error) {
      return sendInternalError(reply, req, error, "Failed to fetch cost summary")
    }

    const rows = (jobs ?? []) as readonly JobRow[]

    // Money from the metering authority — null stays null (never a fabricated 0).
    const charges: Map<string, Charge> | null = await getBillingProvider().report(jobIds)

    const groups = new Map<string, BreakdownEntry>()
    // Track "known" so a total is null ONLY when zero jobs had a known value —
    // never a fabricated 0 for an unanswered lookup (§5.2 rule 1).
    let creditsSum = 0
    let creditsKnown = false
    let usdSum = 0
    let usdKnown = false
    let unavailable = 0
    let totalJobs = 0

    for (const job of rows) {
      const inputData = job.input_data ?? {}
      const nodeType = (inputData.type as string) ?? "unknown"
      const model = (inputData.provider as string) ?? "unknown"
      const key = `${nodeType}::${model}`
      const charge = charges?.get(job.id) ?? null
      const credits = charge?.amount ?? null
      const usd = charge?.secondaryAmount ?? null
      const isSuccess = job.status === "completed"
      const isFailed = job.status === "failed" || job.status === "cancelled"
      const priced = credits != null || usd != null

      totalJobs += 1
      if (credits != null) { creditsSum += credits; creditsKnown = true }
      if (usd != null) { usdSum += usd; usdKnown = true }
      if (!priced) unavailable += 1

      const prev = groups.get(key)
      const base: BreakdownEntry = prev ?? {
        node_type: nodeType, model, runs: 0, successful: 0, failed: 0,
        total_credits: null, total_cost_usd: null,
        avg_credits_per_run: null, unavailable: 0,
      }
      groups.set(key, {
        ...base,
        runs: base.runs + 1,
        successful: base.successful + (isSuccess ? 1 : 0),
        failed: base.failed + (isFailed ? 1 : 0),
        total_credits: credits != null ? (base.total_credits ?? 0) + credits : base.total_credits,
        total_cost_usd: usd != null ? (base.total_cost_usd ?? 0) + usd : base.total_cost_usd,
        avg_credits_per_run: base.avg_credits_per_run, // computed below
        unavailable: base.unavailable + (priced ? 0 : 1),
      })
    }

    const breakdown: BreakdownEntry[] = [...groups.values()]
      .map((e) => ({
        ...e,
        total_cost_usd: e.total_cost_usd != null ? Math.round(e.total_cost_usd * 1_000_000) / 1_000_000 : null,
        avg_credits_per_run:
          e.total_credits != null && e.runs > 0 ? Math.round(e.total_credits / e.runs) : null,
      }))
      .sort((a, b) => (b.total_credits ?? -1) - (a.total_credits ?? -1))

    // The unit the credit figures are denominated in, as the registered
    // provider states it — it rides WITH the figures (H13) so a client renders
    // the pair from one layer and never pairs a converted number with a label
    // it derived elsewhere.
    const unit = getBillingProvider().displayUnit

    const data = {
      total_credits: creditsKnown ? creditsSum : null,
      total_cost_usd: usdKnown ? Math.round(usdSum * 1_000_000) / 1_000_000 : null,
      unit,
      total_jobs: totalJobs,
      unavailable,
      breakdown,
    }
    // USD is admin-only across api/sdk/mcp (same boundary as sanitizeJobForPublic):
    // non-admins get the key absent, never a null they could misread as "free".
    return { data: sanitizeCostSummaryForPublic(data, isAdmin) }
  })
}
