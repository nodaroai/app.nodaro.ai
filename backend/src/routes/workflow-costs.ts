import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"

interface CostSummaryBody {
  readonly jobIds: string[]
}

interface JobRow {
  readonly id: string
  readonly status: string
  readonly input_data: Record<string, unknown> | null
  readonly provider_cost: number | null
  readonly display_cost: number | null
  readonly credits: number | null
}

interface BreakdownEntry {
  node_type: string
  model: string
  runs: number
  successful: number
  failed: number
  total_credits: number
  total_cost_usd: number
  avg_credits_per_run: number
}

export async function workflowCostRoutes(app: FastifyInstance) {
  app.post<{ Body: CostSummaryBody }>("/v1/jobs/cost-summary", async (req, reply) => {
    const { jobIds } = req.body

    if (!jobIds || !Array.isArray(jobIds) || jobIds.length === 0) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "jobIds array is required" },
      })
    }

    if (jobIds.length > 500) {
      return reply.status(400).send({
        error: { code: "bad_request", message: "Maximum 500 job IDs per request" },
      })
    }

    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("id, status, input_data, provider_cost, display_cost, credits")
      .in("id", jobIds)

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    const rows = (jobs ?? []) as readonly JobRow[]

    // Aggregate by (node_type, model)
    const groups = new Map<string, BreakdownEntry>()
    let totalCredits = 0
    let totalCostUsd = 0
    let totalJobs = 0

    for (const job of rows) {
      const inputData = job.input_data ?? {}
      const nodeType = (inputData.type as string) ?? "unknown"
      const model = (inputData.provider as string) ?? "unknown"
      const key = `${nodeType}::${model}`

      const credits = job.credits ?? 0
      const costUsd = job.display_cost ?? job.provider_cost ?? 0
      const isSuccess = job.status === "completed"
      const isFailed = job.status === "failed" || job.status === "cancelled"

      totalCredits += credits
      totalCostUsd += costUsd
      totalJobs += 1

      const existing = groups.get(key)
      if (existing) {
        groups.set(key, {
          ...existing,
          runs: existing.runs + 1,
          successful: existing.successful + (isSuccess ? 1 : 0),
          failed: existing.failed + (isFailed ? 1 : 0),
          total_credits: existing.total_credits + credits,
          total_cost_usd: existing.total_cost_usd + costUsd,
          avg_credits_per_run: 0, // calculated below
        })
      } else {
        groups.set(key, {
          node_type: nodeType,
          model,
          runs: 1,
          successful: isSuccess ? 1 : 0,
          failed: isFailed ? 1 : 0,
          total_credits: credits,
          total_cost_usd: costUsd,
          avg_credits_per_run: 0,
        })
      }
    }

    // Calculate averages and build sorted array
    const breakdown: BreakdownEntry[] = [...groups.values()]
      .map((entry) => ({
        ...entry,
        total_cost_usd: Math.round(entry.total_cost_usd * 1_000_000) / 1_000_000,
        avg_credits_per_run: entry.runs > 0 ? Math.round(entry.total_credits / entry.runs) : 0,
      }))
      .sort((a, b) => b.total_credits - a.total_credits)

    return {
      data: {
        total_credits: totalCredits,
        total_cost_usd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
        total_jobs: totalJobs,
        breakdown,
      },
    }
  })
}
