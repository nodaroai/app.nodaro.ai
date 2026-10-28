/**
 * "Show prompt" for an admin's trend run, with its Full / 4 s preview switch.
 * Registered by `adminTrendsRoutes` (admin-trends.ts), so it shares its
 * `requireAdmin` door and its edition gate; admin-only.
 *
 *   GET /v1/admin/trends/test-runs/:jobId/prompt?mode=full|preview
 *
 * Replies `{ data: AdminTrendRunPrompt }`:
 * - `prompt`: what the engine was sent (its Seedance child's `prompt`), only
 *   for the mode the run ran in (`runMode`), and null before the engine has
 *   made it. A run never had the other mode's prompt.
 * - `parts`: the trend's own hidden prompt parts as a run in `mode` sends them
 *   (`trendPromptParts`: a preview's own role names, reference lines, pre and
 *   trend prompts, each falling back to the full run's), from the trend
 *   version the run used, as that version is saved now; null when it is gone.
 *   A run that carried the stored scene description (`__sceneDescription` on
 *   its record) names its roles by their full role names, a preview included
 *   (one name per run), and its parts show those.
 *
 * `mode` left out = the mode the run ran in. Admins may see a trend's hidden
 * data; nothing here is reachable by a user.
 */
import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { getVersion } from "../lib/trends/store.js"
import { TREND_PROMPT_MODES, trendPromptParts, type TrendPromptMode, type TrendPromptParts } from "../lib/trends/prompt-parts.js"
import { isRec, str, unavailableOrInternal, type RunJobRow } from "../lib/trends/run-helpers.js"

/** "Show prompt" for one run, as a Full or 4 s preview run. */
export interface AdminTrendRunPrompt {
  mode: TrendPromptMode
  /** The mode the run ran in: the only one with an engine `prompt`. */
  runMode: TrendPromptMode
  prompt: string | null
  /** Whether the run's trend version offers a 4 s preview. */
  previewOffered: boolean
  parts: TrendPromptParts | null
}

export interface TrendPromptDeps {
  /** A trend run (any owner), with its owner, or null. */
  findTrendRun: (jobId: string) => Promise<(RunJobRow & { user_id: string }) | null>
  badRequest: (reply: FastifyReply, error: z.ZodError) => FastifyReply
}

/** Which run's prompt (left out = the mode the run ran in). */
const promptQuery = z.object({ mode: z.enum(TREND_PROMPT_MODES).optional() })

/** The engine prompt of a run: its Seedance child's `prompt`, or null before there is one. */
async function enginePromptOf(run: RunJobRow): Promise<string | null> {
  const childId = isRec(run.output_data) ? str(run.output_data.__castSwapChildJobId) : null
  if (!childId) return null
  const { data, error } = await supabase.from("jobs").select("input_data").eq("id", childId).maybeSingle()
  if (error) throw new Error(`Could not read job ${childId}: ${error.message}`)
  const input = (data as { input_data?: unknown } | null)?.input_data
  return isRec(input) ? str(input.prompt) : null
}

export function registerTrendPromptRoutes(app: FastifyInstance, deps: TrendPromptDeps): void {
  app.get("/v1/admin/trends/test-runs/:jobId/prompt", { preHandler: requireAdmin }, async (req, reply) => {
    const { jobId } = req.params as { jobId: string }
    const query = promptQuery.safeParse(req.query ?? {})
    if (!query.success) return deps.badRequest(reply, query.error)
    try {
      const run = await deps.findTrendRun(jobId)
      if (!run) return reply.status(404).send({ error: { code: "not_found", message: "Run not found" } })
      const input = isRec(run.input_data) ? run.input_data : {}
      const runMode: TrendPromptMode = input.preview === true ? "preview" : "full"
      const mode = query.data.mode ?? runMode
      const stamp = isRec(input.trend) ? input.trend : {}
      const trendId = str(stamp.id)
      const version = typeof stamp.version === "number" && Number.isInteger(stamp.version) ? stamp.version : null
      const [prompt, data] = await Promise.all([
        mode === runMode ? enginePromptOf(run) : Promise.resolve(null),
        trendId && version !== null ? getVersion(trendId, version) : Promise.resolve(null),
      ])
      // The run carried the stored scene description: its roles went by their full role names.
      const roleNames = typeof input.__sceneDescription === "string" ? "stored" : "own"
      const out: AdminTrendRunPrompt = {
        mode,
        runMode,
        prompt,
        previewOffered: data ? data.previewStart !== null : false,
        parts: data ? trendPromptParts(data, mode, roleNames) : null,
      }
      return { data: out }
    } catch (e) {
      return unavailableOrInternal(reply, req, e, "Failed to read the run's prompt")
    }
  })
}
