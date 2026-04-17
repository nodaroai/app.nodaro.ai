import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { fetchAllKieLogs } from "../providers/kie/credit-lookup.js"

const creditAuditSyncBody = z.object({
  token: z.string().min(1, "token is required"),
  mode: z.enum(["theoretical", "actual"]).optional(),
  days: z.number().int().min(1).max(30).optional(),
  lookbackMinutes: z.number().int().min(1).max(43200).optional(),
})
import {
  KIE_IMAGE_MODELS, KIE_VIDEO_MODELS, KIE_TEXT_TO_VIDEO_MODELS,
  KIE_VIDEO_TO_VIDEO_MODELS, KIE_MOTION_TRANSFER_MODELS, KIE_VIDEO_UPSCALE_MODELS,
  KIE_LIP_SYNC_MODELS, KIE_MUSIC_MODELS, KIE_TTS_MODELS, KIE_SOUND_EFFECT_MODELS,
  KIE_AUDIO_ISOLATION_MODELS, KIE_STT_MODELS, KIE_DIALOGUE_MODELS,
  KIE_SPEECH_TO_VIDEO_MODELS, KIE_SPECIAL_MODELS,
} from "../providers/kie/models.js"
import type { KieModelConfig } from "../providers/kie/models.js"
import { STATIC_CREDIT_COSTS } from "../billing/credits.js"
import { getAppSettings } from "../lib/app-settings.js"

// T2V credit overrides: some providers bill differently for text-to-video vs image-to-video.
// Must mirror T2V_CREDIT_OVERRIDES from packages/shared/src/credit-identifiers.ts.
const T2V_CREDIT_OVERRIDES: Record<string, string> = {
  "grok": "grok-i2v",
  "wan": "wan-t2v",
  "wan-turbo": "wan-turbo-t2v",
}

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

  // For T2V models, apply T2V_CREDIT_OVERRIDES so the audit uses the correct
  // credit key (e.g., grok T2V → grok-i2v, wan T2V → wan-t2v).
  // Without this, the audit compares T2V provider costs against I2V/image credit prices.
  const t2vModels: Record<string, KieModelConfig> = {}
  for (const [key, cfg] of Object.entries(KIE_TEXT_TO_VIDEO_MODELS)) {
    const overrideKey = T2V_CREDIT_OVERRIDES[key]
    if (overrideKey) {
      t2vModels[overrideKey] = { ...cfg, credits: STATIC_CREDIT_COSTS[overrideKey] ? STATIC_CREDIT_COSTS[overrideKey] * KIE_CREDITS_PER_NODARO : cfg.credits }
    } else {
      t2vModels[key] = cfg
    }
  }
  addModels(t2vModels, "t2v")

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

  // Suno ops endpoints return sourceLabel as model key (no model field in records)
  addAlias("suno-lyrics", "suno-lyrics", "music")
  addAlias("suno-style", "suno-style-boost", "music")

  // Flux Kontext: model-specific endpoint uses "flux-kontext-pro" / "flux-kontext-max"
  // as model names, but records without a model field fall back to sourceLabel "flux-kontext"
  addAlias("flux-kontext-pro", "flux-kontext", "image")
  addAlias("flux-kontext-max", "flux-kontext-max", "image")
  addAlias("flux-kontext", "flux-kontext", "image")

  // VEO record endpoint may return model as "generate" or fall back to sourceLabel "veo-generate"
  // Add both veo3 and veo3.1 so credit-based matching picks the right one
  addAlias("veo-generate", "veo3", "i2v")
  addAlias("veo-generate", "veo3.1", "i2v")
  addAlias("generate", "veo3", "i2v")
  addAlias("generate", "veo3.1", "i2v")

  return map
}

// Lazy-cached model map (pure function of static imports, safe to cache at module level)
let _cachedModelMap: Map<string, ModelMapping[]> | null = null
function getCachedModelMap() {
  if (!_cachedModelMap) _cachedModelMap = buildModelMap()
  return _cachedModelMap
}

function isSuccessState(state: string | undefined): boolean {
  const s = state?.toLowerCase?.() ?? ""
  return s === "success" || s === "completed" || s === "1" || s === "done"
}

function findBestMapping(mappings: ModelMapping[], avgKieCredits: number): ModelMapping {
  return mappings.length === 1
    ? mappings[0]
    : mappings.reduce((best, m) =>
        Math.abs(m.kieCredits - avgKieCredits) < Math.abs(best.kieCredits - avgKieCredits) ? m : best
      )
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
    const parsed = creditAuditSyncBody.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" },
      })
    }
    const { token } = parsed.data
    const mode = parsed.data.mode === "actual" ? "actual" as const : "theoretical" as const

    // Support both lookbackMinutes (fine-grained) and days (legacy)
    const lookbackMinutes = parsed.data.lookbackMinutes
      ? parsed.data.lookbackMinutes
      : (parsed.data.days ?? 7) * 1440

    const endTime = Date.now()
    const beginTime = endTime - lookbackMinutes * 60_000

    // Fetch all KIE logs for the time window (generic + model-specific endpoints)
    const { records, sources, errors, rawSamples } = await fetchAllKieLogs(token, beginTime, endTime)

    if (records.length === 0) {
      return { mode, lookbackMinutes, message: "No records found", totalRecords: 0, sources, errors, rawSamples, models: [] }
    }

    // Build our model mapping for comparison
    const modelMap = getCachedModelMap()

    // Group by KIE model and aggregate (raw KIE credits)
    const byModel = new Map<string, {
      kieModel: string
      tasks: number
      totalCredits: number
      minCredits: number
      maxCredits: number
      /** Every distinct KIE credit amount observed → how many tasks had that cost */
      costBuckets: Map<number, number>
    }>()

    let successCount = 0
    for (const record of records) {
      if (!isSuccessState(record.state)) continue
      successCount++

      const key = record.model
      const existing = byModel.get(key)
      if (existing) {
        existing.tasks++
        existing.totalCredits += record.consumeCredits
        existing.minCredits = Math.min(existing.minCredits, record.consumeCredits)
        existing.maxCredits = Math.max(existing.maxCredits, record.consumeCredits)
        existing.costBuckets.set(record.consumeCredits, (existing.costBuckets.get(record.consumeCredits) ?? 0) + 1)
      } else {
        byModel.set(key, {
          kieModel: key,
          tasks: 1,
          totalCredits: record.consumeCredits,
          minCredits: record.consumeCredits,
          maxCredits: record.consumeCredits,
          costBuckets: new Map([[record.consumeCredits, 1]]),
        })
      }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100

    // Read markup from DB (admin settings) so audit matches pricing formula
    const settings = await getAppSettings()
    const markupMultiplier = 1 + settings.cost_markup_percent / 100

    // ---------- Actual mode: compare KIE cost vs what we ACTUALLY charged ----------
    if (mode === "actual") {
      const since = new Date(beginTime).toISOString()
      const until = new Date(endTime).toISOString()

      // Fetch usage_logs for the time window (paginated, up to 10k rows)
      const allUsageLogs: { action: string; credits_used: number }[] = []
      let usageOffset = 0
      const USAGE_PAGE = 1000
      while (usageOffset < 10_000) {
        const { data } = await supabase
          .from("usage_logs")
          .select("action, credits_used")
          .gte("created_at", since)
          .lte("created_at", until)
          .neq("status", "refunded")
          .range(usageOffset, usageOffset + USAGE_PAGE - 1)
        if (!data || data.length === 0) break
        allUsageLogs.push(...(data as { action: string; credits_used: number }[]))
        if (data.length < USAGE_PAGE) break
        usageOffset += USAGE_PAGE
      }

      // Group by base model key (strip composite ":variant" suffix)
      const usageByBaseKey = new Map<string, { count: number; totalCredits: number; min: number; max: number }>()
      for (const log of allUsageLogs) {
        const baseKey = log.action.split(":")[0]
        const credits = log.credits_used ?? 0
        const existing = usageByBaseKey.get(baseKey)
        if (existing) {
          existing.count++
          existing.totalCredits += credits
          existing.min = Math.min(existing.min, credits)
          existing.max = Math.max(existing.max, credits)
        } else {
          usageByBaseKey.set(baseKey, { count: 1, totalCredits: credits, min: credits, max: credits })
        }
      }

      const actualResults = []
      for (const [kieModel, stats] of byModel) {
        const mappings = modelMap.get(kieModel)
        const avgKieCredits = round2(stats.totalCredits / stats.tasks)
        const providerCostInCredits = round2(avgKieCredits / KIE_CREDITS_PER_NODARO)
        const expectedCredits = Math.ceil(providerCostInCredits * markupMultiplier)

        if (!mappings?.length) {
          actualResults.push({
            kieModel, ourKey: null, category: "unknown",
            kieTasks: stats.tasks, ourJobs: 0,
            avgKieCredits, providerCostInCredits, expectedCredits,
            actualAvgCredits: null, actualMin: null, actualMax: null,
            diff: null, diffPercent: null,
            status: "UNMAPPED" as const,
            variable: stats.minCredits !== stats.maxCredits,
          })
          continue
        }

        const mapping = findBestMapping(mappings, avgKieCredits)

        const possibleKeys = [...new Set(mappings.map(m => m.ourKey))]
        let totalOurJobs = 0
        let totalOurCredits = 0
        let ourMin = Infinity
        let ourMax = -Infinity

        for (const key of possibleKeys) {
          const usage = usageByBaseKey.get(key)
          if (usage) {
            totalOurJobs += usage.count
            totalOurCredits += usage.totalCredits
            ourMin = Math.min(ourMin, usage.min)
            ourMax = Math.max(ourMax, usage.max)
          }
        }

        if (totalOurJobs === 0) {
          actualResults.push({
            kieModel, ourKey: possibleKeys.join(", "), category: mapping.category,
            kieTasks: stats.tasks, ourJobs: 0,
            avgKieCredits, providerCostInCredits, expectedCredits,
            actualAvgCredits: null, actualMin: null, actualMax: null,
            diff: null, diffPercent: null,
            status: "UNMATCHED" as const,
            variable: stats.minCredits !== stats.maxCredits,
          })
          continue
        }

        const actualAvgCredits = round2(totalOurCredits / totalOurJobs)
        const diff = round2(actualAvgCredits - expectedCredits)
        const diffPercent = expectedCredits > 0 ? round2((diff / expectedCredits) * 100) : null

        let status: "OK" | "UNDERCHARGED" | "OVERCHARGED" = "OK"
        if (diff < -0.5) status = "UNDERCHARGED"
        else if (expectedCredits > 0 && diffPercent != null && diffPercent > 100) status = "OVERCHARGED"

        actualResults.push({
          kieModel,
          ourKey: possibleKeys.length === 1 ? possibleKeys[0] : possibleKeys.join(", "),
          category: mapping.category,
          kieTasks: stats.tasks, ourJobs: totalOurJobs,
          avgKieCredits, providerCostInCredits, expectedCredits,
          actualAvgCredits,
          actualMin: ourMin === Infinity ? null : ourMin,
          actualMax: ourMax === -Infinity ? null : ourMax,
          diff, diffPercent, status,
          variable: stats.minCredits !== stats.maxCredits || (ourMin !== ourMax && ourMin !== Infinity),
        })
      }

      actualResults.sort((a, b) => {
        if (a.status !== "OK" && b.status === "OK") return -1
        if (a.status === "OK" && b.status !== "OK") return 1
        return Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0)
      })

      const actualMismatches = actualResults.filter(r => r.status !== "OK").length
      return {
        mode: "actual" as const,
        lookbackMinutes,
        markupPercent: settings.cost_markup_percent,
        totalRecords: records.length,
        successRecords: successCount,
        totalUsageLogs: allUsageLogs.length,
        uniqueModels: byModel.size,
        mismatches: actualMismatches,
        sources, errors, rawSamples,
        models: actualResults,
      }
    }

    // ---------- Theoretical mode: compare KIE cost vs our pricing table ----------
    // Compare: provider KIE credits vs what we charge users
    const results = []
    for (const [kieModel, stats] of byModel) {
      const mappings = modelMap.get(kieModel)
      const avgKieCredits = round2(stats.totalCredits / stats.tasks)
      // What the provider actually costs us in Nodaro credit units
      const providerCostInCredits = round2(avgKieCredits / KIE_CREDITS_PER_NODARO)
      // What we SHOULD charge given the markup setting
      const expectedCredits = Math.ceil(providerCostInCredits * markupMultiplier)

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
          expectedCredits,
          diff: null,
          diffPercent: null,
          status: "UNMAPPED",
          variable: stats.minCredits !== stats.maxCredits,
        })
        continue
      }

      // When multiple keys map to same KIE model, pick the one whose
      // KIE credits are closest to the actual average
      const mapping = findBestMapping(mappings, avgKieCredits)

      // Collect ALL credit tiers for this model (base + composite like key:5s, key:10s:audio)
      const allTiers: number[] = []
      for (const m of mappings) {
        if (STATIC_CREDIT_COSTS[m.ourKey] !== undefined) {
          allTiers.push(STATIC_CREDIT_COSTS[m.ourKey])
        }
        const prefix = m.ourKey + ":"
        for (const k of Object.keys(STATIC_CREDIT_COSTS)) {
          if (k.startsWith(prefix)) allTiers.push(STATIC_CREDIT_COSTS[k])
        }
      }

      const isVariable = stats.minCredits !== stats.maxCredits
      const hasTiers = allTiers.length > 1

      // For variable models with tiers: validate EACH observed cost level
      // against our actual tier pricing, not the meaningless average.
      // For fixed-cost or single-tier models: compare normally.
      let status = "OK"
      let diff: number
      let diffPercent: number | null
      let tierBreakdown: { kieCost: number; tasks: number; required: number; bestTier: number; covered: boolean }[] | undefined

      if (isVariable && hasTiers) {
        // Per-cost-level validation
        tierBreakdown = []
        let worstDiff = 0
        for (const [kieCost, count] of stats.costBuckets) {
          const required = Math.ceil((kieCost / KIE_CREDITS_PER_NODARO) * markupMultiplier)
          // Find the smallest tier that covers this cost
          const coveringTiers = allTiers.filter(t => t >= required).sort((a, b) => a - b)
          const bestTier = coveringTiers.length > 0 ? coveringTiers[0] : Math.max(...allTiers)
          const covered = coveringTiers.length > 0
          tierBreakdown.push({ kieCost, tasks: count, required, bestTier, covered })
          if (!covered) {
            worstDiff = Math.min(worstDiff, bestTier - required)
          }
        }
        const allCovered = tierBreakdown.every(t => t.covered)
        diff = allCovered ? 0 : worstDiff
        diffPercent = null
        if (!allCovered) status = "UNDERPRICED"
      } else {
        // Fixed-cost model: compare directly
        diff = round2(mapping.ourCredits - expectedCredits)
        diffPercent = expectedCredits > 0
          ? round2((diff / expectedCredits) * 100)
          : null
        if (diff < -0.5) {
          status = "UNDERPRICED"
        } else if (expectedCredits > 0 && diffPercent != null && diffPercent > 100) {
          status = "OVERPRICED"
        }
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
        expectedCredits,
        diff,
        diffPercent,
        status,
        variable: isVariable,
        ...(tierBreakdown ? { tierBreakdown } : {}),
      })
    }

    // Sort: mismatches first, then by largest absolute diff
    results.sort((a, b) => {
      if (a.status !== "OK" && b.status === "OK") return -1
      if (a.status === "OK" && b.status !== "OK") return 1
      return Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0)
    })

    const mismatches = results.filter(r => r.status !== "OK")

    return {
      mode: "theoretical" as const,
      lookbackMinutes,
      markupPercent: settings.cost_markup_percent,
      totalRecords: records.length,
      successRecords: successCount,
      uniqueModels: byModel.size,
      mismatches: mismatches.length,
      sources,
      errors,
      rawSamples,
      models: results,
    }
  })
}
