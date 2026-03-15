import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { fetchAllKieLogs } from "../providers/kie/credit-lookup.js"
import {
  KIE_IMAGE_MODELS, KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS,
  KIE_VIDEO_TO_VIDEO_MODELS, KIE_MOTION_TRANSFER_MODELS, KIE_VIDEO_UPSCALE_MODELS,
  KIE_LIP_SYNC_MODELS, KIE_MUSIC_MODELS, KIE_TTS_MODELS, KIE_SOUND_EFFECT_MODELS,
  KIE_AUDIO_ISOLATION_MODELS, KIE_STT_MODELS, KIE_DIALOGUE_MODELS,
  KIE_SPEECH_TO_VIDEO_MODELS, KIE_STORYBOARD_MODELS, KIE_SPECIAL_MODELS,
} from "../providers/kie/models.js"
import type { KieModelConfig } from "../providers/kie/models.js"
import { STATIC_CREDIT_COSTS } from "../billing/credits.js"

***REDACTED-OSS-SCRUB***
const KIE_CREDITS_PER_NODARO = 4

// Build reverse map: KIE model ID → { ourKey, kieCredits, category }
interface ModelMapping {
  ourKey: string
  kieCredits: number      // raw KIE credits from our config
  ourCredits: number      // what we charge users (from STATIC_CREDIT_COSTS)
  category: string
}

function buildModelMap(): Map<string, ModelMapping[]> {
  const map = new Map<string, ModelMapping[]>()

  function addModels(models: Record<string, KieModelConfig>, category: string) {
    for (const [key, config] of Object.entries(models)) {
      const existing = map.get(config.model) ?? []
      existing.push({
        ourKey: key,
        kieCredits: config.credits,
        ourCredits: STATIC_CREDIT_COSTS[key] ?? 0,
        category,
      })
      map.set(config.model, existing)
    }
  }

  addModels(KIE_IMAGE_MODELS, "image")
  addModels(KIE_VIDEO_MODELS, "i2v")
  addModels(KIE_TEXT_TO_VIDEO_MODELS, "t2v")
  addModels(KIE_VIDEO_TO_VIDEO_MODELS, "v2v")
  addModels(KIE_MOTION_TRANSFER_MODELS, "motion")
  addModels(KIE_VIDEO_UPSCALE_MODELS, "upscale")
  addModels(KIE_LIP_SYNC_MODELS, "lip-sync")
  addModels(KIE_MUSIC_MODELS, "music")
  addModels(KIE_TTS_MODELS, "tts")
  addModels(KIE_SOUND_EFFECT_MODELS, "sfx")
  addModels(KIE_AUDIO_ISOLATION_MODELS, "isolation")
  addModels(KIE_STT_MODELS, "stt")
  addModels(KIE_DIALOGUE_MODELS, "dialogue")
  addModels(KIE_SPEECH_TO_VIDEO_MODELS, "s2v")
  addModels(KIE_STORYBOARD_MODELS, "storyboard")
  addModels(KIE_SPECIAL_MODELS, "special")

  // Suno model-specific endpoints return chirp-* codenames instead of suno/v4 etc.
  // Map them as aliases so they aren't UNMAPPED.
  function addAlias(alias: string, targetKey: string, category: string) {
    const existing = map.get(alias) ?? []
    existing.push({
      ourKey: targetKey,
      kieCredits: STATIC_CREDIT_COSTS[targetKey] ? STATIC_CREDIT_COSTS[targetKey] * KIE_CREDITS_PER_NODARO : 0,
      ourCredits: STATIC_CREDIT_COSTS[targetKey] ?? 0,
      category,
    })
    map.set(alias, existing)
  }

  // Suno chirp-* → our model keys
  addAlias("chirp-v4", "suno", "music")
  addAlias("chirp-auk", "suno", "music")           // V4.5
  addAlias("chirp-bluejay", "suno", "music")        // V4.5+
  addAlias("chirp-crow", "suno-v5", "music")        // V5

  // Flux Kontext model-specific endpoint uses "flux-kontext-pro" / "flux-kontext-max"
  addAlias("flux-kontext-pro", "flux-kontext", "image")
  addAlias("flux-kontext-max", "flux-kontext-max", "image")

  return map
}

export async function adminCreditAuditRoutes(app: FastifyInstance) {
  // GET /v1/admin/credit-audit - List recent audit entries
  // Query params: ?mismatch=true&model=kling-3.0&limit=50&offset=0
  app.get("/v1/admin/credit-audit", { preHandler: requireAdmin }, async (request, reply) => {
    const query = request.query as Record<string, string | undefined>
    const limit = Math.min(200, Math.max(1, parseInt(query.limit ?? "50", 10) || 50))
    const offset = Math.max(0, parseInt(query.offset ?? "0", 10) || 0)
    const mismatchOnly = query.mismatch === "true"
    const modelFilter = query.model?.trim() ?? null

    let dbQuery = supabase
      .from("credit_cost_audit")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (mismatchOnly) {
      dbQuery = dbQuery.eq("mismatch", true)
    }
    if (modelFilter) {
      dbQuery = dbQuery.eq("model_key", modelFilter)
    }

    const { data, count, error } = await dbQuery
    if (error) return reply.code(500).send({ error: error.message })

    return { data: data ?? [], total: count ?? 0, limit, offset }
  })

  // GET /v1/admin/credit-audit/summary - Aggregated mismatch summary by model
  app.get("/v1/admin/credit-audit/summary", { preHandler: requireAdmin }, async (request, reply) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from("credit_cost_audit")
      .select("model_key, mismatch")
      .gte("created_at", thirtyDaysAgo)

    if (error) return reply.code(500).send({ error: error.message })

    const summary: Record<string, { total: number; mismatches: number }> = {}
    for (const row of data ?? []) {
      if (!summary[row.model_key]) {
        summary[row.model_key] = { total: 0, mismatches: 0 }
      }
      summary[row.model_key].total++
      if (row.mismatch) summary[row.model_key].mismatches++
    }

    const models = Object.entries(summary)
      .map(([model, stats]) => ({
        model,
        total: stats.total,
        mismatches: stats.mismatches,
        mismatchRate: stats.total > 0 ? (stats.mismatches / stats.total * 100).toFixed(1) + "%" : "0%",
      }))
      .sort((a, b) => b.mismatches - a.mismatches)

    return { data: models, period: "30d" }
  })

  // POST /v1/admin/credit-audit/sync - Fetch KIE logs and compare against our pricing
  // Body: { token, days?: number }
  // token = authorization header from kie.ai session (changes per session)
  // KIE_UNIQUE_ID is read from env (constant per account)
  app.post("/v1/admin/credit-audit/sync", { preHandler: requireAdmin }, async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const token = body.token as string
    const days = Math.min(30, Math.max(1, Number(body.days) || 7))

    if (!token) {
      return reply.code(400).send({
        error: "Provide session token from kie.ai/logs Network tab (authorization header value)",
      })
    }

    const endTime = Date.now()
    const beginTime = endTime - days * 86400_000

    // Fetch all KIE logs for the time window (generic + model-specific endpoints)
    const { records, sources, errors, rawSamples } = await fetchAllKieLogs(token, beginTime, endTime)

    if (records.length === 0) {
      return { message: "No records found", days, totalRecords: 0, sources, errors, rawSamples, models: [] }
    }

    // Build our model mapping for comparison
    const modelMap = buildModelMap()

    // Group by KIE model and aggregate (raw KIE credits)
    const byModel = new Map<string, {
      kieModel: string
      tasks: number
      totalCredits: number
      minCredits: number
      maxCredits: number
    }>()

    for (const record of records) {
      // Different endpoints use different state values: "success", "completed", "1", etc.
      const s = record.state?.toLowerCase?.() ?? ""
      if (s !== "success" && s !== "completed" && s !== "1" && s !== "done") continue

      const key = record.model
      const existing = byModel.get(key)
      if (existing) {
        existing.tasks++
        existing.totalCredits += record.consumeCredits
        existing.minCredits = Math.min(existing.minCredits, record.consumeCredits)
        existing.maxCredits = Math.max(existing.maxCredits, record.consumeCredits)
      } else {
        byModel.set(key, {
          kieModel: key,
          tasks: 1,
          totalCredits: record.consumeCredits,
          minCredits: record.consumeCredits,
          maxCredits: record.consumeCredits,
        })
      }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100

    // Compare: provider KIE credits vs what we charge users
    const results = []
    for (const [kieModel, stats] of byModel) {
      const mappings = modelMap.get(kieModel)
      const avgKieCredits = round2(stats.totalCredits / stats.tasks)
      // What the provider actually costs us in Nodaro credit units
      const providerCostInCredits = round2(avgKieCredits / KIE_CREDITS_PER_NODARO)

      if (!mappings?.length) {
        results.push({
          kieModel,
          ourKey: null,
          category: "unknown",
          tasks: stats.tasks,
          providerCredits: avgKieCredits,
          providerMin: stats.minCredits,
          providerMax: stats.maxCredits,
          ourCredits: null,
          providerCostInCredits,
          diff: null,
          diffPercent: null,
          status: "UNMAPPED",
          variable: stats.minCredits !== stats.maxCredits,
        })
        continue
      }

      // When multiple keys map to same KIE model, pick the one whose
      // KIE credits are closest to the actual average
      const mapping = mappings.length === 1
        ? mappings[0]
        : mappings.reduce((best, m) =>
            Math.abs(m.kieCredits - avgKieCredits) < Math.abs(best.kieCredits - avgKieCredits) ? m : best
          )

      // diff = how much more/less we charge vs provider cost (in Nodaro credits)
      const diff = round2(mapping.ourCredits - providerCostInCredits)
      const diffPercent = providerCostInCredits > 0
        ? round2((diff / providerCostInCredits) * 100)
        : null

      // UNDERPRICED = we charge less than it costs us, OVERPRICED = we charge much more
      let status = "OK"
      if (diff < -0.5) {
        status = "UNDERPRICED"
      } else if (providerCostInCredits > 0 && diffPercent != null && diffPercent > 100) {
        status = "OVERPRICED"
      }

      results.push({
        kieModel,
        ourKey: mappings.length === 1 ? mapping.ourKey : mappings.map(m => m.ourKey).join(", "),
        category: mapping.category,
        tasks: stats.tasks,
        providerCredits: avgKieCredits,
        providerMin: stats.minCredits,
        providerMax: stats.maxCredits,
        ourCredits: mapping.ourCredits,
        providerCostInCredits,
        diff,
        diffPercent,
        status,
        variable: stats.minCredits !== stats.maxCredits,
      })
    }

    // Sort: mismatches first, then by absolute diff
    results.sort((a, b) => {
      if (a.status !== "OK" && b.status === "OK") return -1
      if (a.status === "OK" && b.status !== "OK") return 1
      return Math.abs(a.diff ?? 0) - Math.abs(b.diff ?? 0)
    })

    const mismatches = results.filter(r => r.status !== "OK")

    return {
      days,
      totalRecords: records.length,
      successRecords: records.filter(r => {
        const s = r.state?.toLowerCase?.() ?? ""
        return s === "success" || s === "completed" || s === "1" || s === "done"
      }).length,
      uniqueModels: byModel.size,
      mismatches: mismatches.length,
      sources,
      errors,
      rawSamples,
      models: results,
    }
  })
}
