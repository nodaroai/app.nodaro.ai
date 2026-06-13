import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { insertWithIdempotencyKey } from "../lib/idempotent-insert.js"
import { buildCreditModelIdentifier, REFERENCE_BOARD_PROVIDERS, buildBoardPrompt } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"

const referenceBoardBody = z.object({
  provider: z.enum(REFERENCE_BOARD_PROVIDERS),
  boardTemplate: z.string().min(1).max(60),
  prompt: z.string().max(8000).optional(),       // empty → seeded from template
  negativePrompt: z.string().max(5000).optional(),
  aspectRatio: z.string().max(12).optional(),
  resolution: z.enum(["1K", "2K", "4K"]).optional(),
  quality: z.enum(["medium", "high"]).optional(),
  seed: z.number().int().min(0).optional(),
  referenceImageUrls: z.array(safeUrlSchema).max(13).optional(),
  // Connected-entity context for the metadata block (resolver-supplied):
  entityName: z.string().max(120).optional(),
  entityDescription: z.string().max(2000).optional(),
})
export type ReferenceBoardBody = z.infer<typeof referenceBoardBody>

/** Pass-through credit identifier — reserve under the chosen IMAGE provider's
 *  existing composite id (no new reference-board pricing row). Must read from
 *  the RAW body (pre-Zod) for the creditGuard preHandler. */
export function resolveBoardCreditIdentifier(req: FastifyRequest): string {
  const b = (req.body ?? {}) as Record<string, unknown>
  // Clamp the raw (pre-Zod) provider to the valid set before pricing, so a body
  // with an out-of-enum provider can't reserve under a different (cheaper) model
  // id than execution uses. Mirrors generate-image's defensive resolver.
  const raw = String(b.provider ?? "nano-banana-pro")
  const provider = (REFERENCE_BOARD_PROVIDERS as readonly string[]).includes(raw) ? raw : "nano-banana-pro"
  return buildCreditModelIdentifier(
    provider,
    b.quality as string | undefined,
    b.resolution as string | undefined,
  )
}

export async function referenceBoardRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/reference-board", { preHandler: creditGuard(resolveBoardCreditIdentifier) }, async (req, reply) => {
    const parsed = referenceBoardBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send(formatZodError(parsed.error))

    const body = parsed.data
    // Derive userId ONLY from the authenticated session (set by the auth
    // middleware — from the JWT/API token, or from the body solely when the
    // internal-orchestrator secret is verified). Never trust a body userId here
    // (IDOR). Mirrors generate-image.ts.
    const userId = (req as unknown as { userId?: string }).userId
    if (!userId) return reply.status(401).send({ error: "unauthorized" })

    // Seed the prompt from the template when the user left it empty. An unknown
    // boardTemplate makes buildBoardPrompt throw — return 400 (not a bare 500),
    // since the Zod schema accepts any string for forward-compat.
    let prompt: string
    try {
      prompt = body.prompt?.trim()
        ? body.prompt
        : buildBoardPrompt(body.boardTemplate, { name: body.entityName, description: body.entityDescription })
    } catch {
      return reply
        .status(400)
        .send({ error: { code: "invalid_board_template", message: `Unknown board template: ${body.boardTemplate}` } })
    }

    const modelIdentifier = resolveBoardCreditIdentifier(req)
    const workflowId = extractWorkflowId(req.body)
    const forcePrivate = extractForcePrivate(req.body)

    let insertResult: { row: { id: string }; created: boolean }
    try {
      insertResult = await insertWithIdempotencyKey<{ id: string }>(
        "jobs",
        {
          user_id: userId,
          status: "pending",
          workflow_id: workflowId ?? null,
          force_private: forcePrivate || undefined,
          input_data: { ...buildJobInputData(body as unknown as Record<string, unknown>, "reference-board"), prompt },
        },
        req.idempotencyKey,           // set by creditGuard; NOT the raw header
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return reply.status(500).send({ error: { code: "internal_error", message } })
    }
    const job = insertResult.row

    if (!insertResult.created) {
      // Dedup hit at the DB layer (race winner already exists). Mirror the
      // preHandler dedup-hit response so callers see a consistent contract.
      reply.header("X-Dedup-Hit", "1")
      return reply.code(200).send({ jobId: job.id, deduped: true })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("reference-board", {
      jobId: job.id,
      prompt,
      referenceImageUrls: body.referenceImageUrls,
      provider: body.provider,
      aspectRatio: body.aspectRatio,
      resolution: body.resolution,
      quality: body.quality,
      negativePrompt: body.negativePrompt,
      seed: body.seed,
      usageLogId,
    })

    return reply.send({ jobId: job.id })
  })
}
