import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoDirectorQueue } from "../lib/video-director-queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { brandTokensSchema } from "../lib/plan-schemas.js"

/**
 * Credit / model identifier for the video-director authoring run. The
 * `creditGuard` preHandler reserves against this id at request time; the
 * director worker commits it on success / refunds it on failure (by jobId,
 * via the reserve→commit/refund lifecycle helpers). Seeded in
 * `STATIC_CREDIT_COSTS` + `model_pricing` (Task 7 / Unit F1).
 */
const VIDEO_DIRECTOR_MODEL_ID = "video-director"

const videoDirectorBody = z.object({
  genre: z.enum(["explainer", "product-launch"]),
  brief: z.string().min(1).max(8000),
  // Optional brand — a preset name (string) OR inline BrandTokens. Passed
  // opaquely to the worker/orchestrator, which calls resolveBrandInput once.
  brand: z.union([z.string(), brandTokensSchema]).optional(),
  // Internal-secret path supplies the resource owner's id in the body; the
  // auth hook copies it to req.userId. Optional so user-JWT calls also pass.
  userId: z.string().uuid().optional(),
})

/**
 * POST /v1/video-director/run — one-shot "make me a video" entry point used by
 * the create_explainer / create_launch_video MCP tools.
 *
 * Mirrors forced-alignment.ts: creditGuard reserves the authoring credit at
 * request time, the handler creates a `jobs` row + reserves credits, then
 * enqueues the director chain (author → speech → alignment → bake → render)
 * onto `videoDirectorQueue`. The worker (workers/video-director-worker.ts)
 * commits/refunds the reservation by jobId.
 */
export async function videoDirectorRoutes(app: FastifyInstance) {
  app.post("/v1/video-director/run", {
    preHandler: creditGuard(() => VIDEO_DIRECTOR_MODEL_ID),
  }, async (req, reply) => {
    const parsed = videoDirectorBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { genre, brief, brand } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Resolve the user's tier so the director chain (model tier, parallelism,
    // watermark) matches their entitlement. Default to "free" when the profile
    // row is missing — never block the run on a tier lookup.
    const { data: profile } = await supabase
      .from("profiles")
      .select("tier")
      .eq("id", userId)
      .single()
    const tier = (profile?.tier as string | undefined) ?? "free"

    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        // NOTE: `jobs` has NO `model_identifier` column — the model id lives in
        // input_data (via buildJobInputData) + is passed to reserveCreditsForJob.
        // Inserting a top-level model_identifier here errors the insert → 500
        // (mirrors forced-alignment.ts, which does not insert it).
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
        input_data: buildJobInputData(parsed.data, VIDEO_DIRECTOR_MODEL_ID),
      })
      .select("id")
      .single()

    if (error) {
      return sendInternalError(reply, req, error, "Failed to start video director")
    }

    await reserveCreditsForJob(req, reply, job.id, VIDEO_DIRECTOR_MODEL_ID)
    // reserveCreditsForJob may short-circuit the response on a dedup-key race.
    if (reply.sent) return

    await videoDirectorQueue.add("video-director", {
      jobId: job.id,
      genre,
      brief,
      userId,
      tier,
      brand,
    })

    return { jobId: job.id }
  })
}
