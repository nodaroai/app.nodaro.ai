import type { FastifyInstance } from "fastify"
import { config } from "../../lib/config.js"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { KIE_API_BASE } from "../../providers/kie/client.js"

/**
 * Fetch current KIE.ai account credit balance from their API.
 * Endpoint: GET https://api.kie.ai/api/v1/chat/credit
 */
export async function fetchKieCredits(): Promise<number | null> {
  const apiKey = config.KIE_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch(`${KIE_API_BASE}/api/v1/chat/credit`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      console.error(`[KIE Credits] HTTP ${res.status}: ${await res.text()}`)
      return null
    }

    const data = (await res.json()) as { code: number; msg: string; data: number }
    if (data.code !== 200) {
      console.error(`[KIE Credits] API error code ${data.code}: ${data.msg}`)
      return null
    }

    return data.data
  } catch (err) {
    console.error("[KIE Credits] Fetch failed:", err)
    return null
  }
}

/**
 * Record a KIE credit snapshot in the database.
 * Called by the hourly cron job.
 */
export async function recordKieCreditSnapshot(): Promise<{ credits: number } | null> {
  const credits = await fetchKieCredits()
  if (credits === null) return null

  const { error } = await supabase
    .from("kie_credit_snapshots")
    .insert({ credits })

  if (error) {
    console.error("[KIE Credits] Failed to insert snapshot:", error.message)
    return null
  }

  return { credits }
}

export async function adminKieCreditsRoutes(app: FastifyInstance) {
  /**
   * GET /v1/admin/kie-credits
   * Returns current KIE.ai credit balance + recent history snapshots.
   * Query params: ?days=7 (default 7, max 90)
   */
  app.get("/v1/admin/kie-credits", { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>
    const days = Math.min(90, Math.max(1, parseInt(query.days ?? "7", 10) || 7))

    // Fetch live balance from KIE API
    const currentCredits = await fetchKieCredits()

    // Fetch historical snapshots
    const since = new Date(Date.now() - days * 86400_000).toISOString()
    const { data: snapshots, error } = await supabase
      .from("kie_credit_snapshots")
      .select("credits, recorded_at")
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true })

    if (error) {
      return reply.code(500).send({ error: error.message })
    }

    // Compute consumption stats from snapshots
    const history = snapshots ?? []
    let totalConsumed = 0
    let peakCredits = 0
    let minCredits = Infinity

    for (let i = 0; i < history.length; i++) {
      const credits = history[i].credits
      if (credits > peakCredits) peakCredits = credits
      if (credits < minCredits) minCredits = credits
      if (i > 0) {
        const diff = history[i - 1].credits - credits
        if (diff > 0) totalConsumed += diff // Only count decreases as consumption
      }
    }

    if (history.length === 0) {
      minCredits = 0
    }

    return {
      currentCredits,
      configured: !!config.KIE_API_KEY,
      days,
      history,
      stats: {
        totalConsumed,
        peakCredits,
        minCredits,
        snapshotCount: history.length,
      },
    }
  })
}
