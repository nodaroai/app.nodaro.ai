import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { applySnappedLevers, withAdjustments } from "../lib/image-gen-normalize.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { IMAGE_ASPECT_RATIO_VALUES, IMAGE_EDIT_PROVIDERS, TASK_CHAINED_EDIT_PROVIDERS, PROMPT_HARD_CEILING, buildCreditModelIdentifier, resolveNormalizedImageGen, resolveTopazUpscale } from "@nodaro/shared"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

export const editImageBody = z.object({
  // imageUrl is required for every provider EXCEPT the task-chained Grok ops
  // (grok-upscale / grok-2-edit / grok-2-segment), which take a prior Grok
  // generation's task_id instead of an image URL. The refinement below
  // enforces "imageUrl XOR taskId" with provider-aware routing.
  imageUrl: safeUrlSchema.optional(),
  /**
   * Prior Grok generation task_id, used only by the task-chained providers
   * (see `TASK_CHAINED_EDIT_PROVIDERS`). KIE's grok endpoints operate by
   * referencing a previous task rather than re-uploading the image, so we
   * plumb the task_id through a separate field instead of overloading
   * imageUrl. A generation job's task id is in its `output_data.kieTaskId`.
   */
  taskId: z.string().min(1).max(200).optional(),
  // Generous ceiling; per-model truncation happens in the assembler (warn-don't-block).
  prompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  userPrompt: z.string().max(PROMPT_HARD_CEILING).optional(),
  provider: z.enum(IMAGE_EDIT_PROVIDERS).optional(),
  upscaleFactor: z.enum(["1", "2", "4"]).optional(),
  targetResolution: z.enum(["2K", "4K", "8K"]).optional(),
  // The SAME vocabulary /v1/generate-image and /v1/image-to-image declare —
  // one shared tuple, not three drifting literal lists. This bounds the
  // vocabulary only, so a free-form string can't reach KIE as `image_size`;
  // the per-model gate is the catalog snap in the handler below, which
  // CORRECTS an unsupported ratio (and discloses it in `adjustments`) rather
  // than 400ing a caller.
  aspectRatio: z.enum(IMAGE_ASPECT_RATIO_VALUES).optional(),
  negativePrompt: z.string().max(5000).optional(),
  style: z.string().max(500).optional(),
  seed: z.number().int().min(0).optional(),
  referenceImageUrls: z.array(safeUrlSchema).max(13).optional(),
  // Optional inpainting mask (forwarded as mask_url to the provider; only consumed by providers that support it)
  maskUrl: safeUrlSchema.optional(),
  /**
   * grok-2-edit only: segment indexes (the `index` values a grok-2-segment
   * run returned, passed through VERBATIM — observed 0-based in production,
   * contra KIE's docs claiming ≥1) restricting the edit to those named
   * regions. Forwarded to KIE as `mask_indexs` (their spelling). Ignored by
   * every other provider.
   */
  maskIndexes: z.array(z.number().int().min(0)).min(1).max(64).optional(),
}).refine(
  (data) => {
    if (TASK_CHAINED_EDIT_PROVIDERS.has(data.provider ?? "recraft-upscale")) {
      return Boolean(data.taskId)
    }
    return Boolean(data.imageUrl)
  },
  { message: "imageUrl is required (or taskId for grok-upscale / grok-2-edit / grok-2-segment)" },
)

/**
 * The credit-CHECK model-identifier resolver (preHandler side). Named + exported
 * so the CHECK===DEBIT billing-parity test can run the EXACT pricing the live
 * preHandler runs — every route test mocks `creditGuard` to a no-op, so this
 * closure would otherwise never execute. Keep in lock-step with the handler's
 * reservation identifier below.
 *
 * `aspectRatio` is deliberately NOT part of this: on this route pricing keys on
 * the resolution tier alone, so the aspect snap is billing-neutral and lives in
 * the handler.
 *
 * The tier itself is provider-dependent. For `topaz-image-upscale` it comes from
 * `resolveTopazUpscale` — the SAME resolver the handler's DEBIT and the worker
 * use — where a valid `upscaleFactor` takes precedence and the legacy
 * `targetResolution` only maps in as a fallback (8K→4). Passing the raw
 * `targetResolution` here instead would split CHECK from DEBIT: `commit_credits`
 * only ever refunds a surplus and never collects an upward delta, so
 * `{upscaleFactor:"4"}` would under-charge and `{upscaleFactor:"2",
 * targetResolution:"8K"}` would over-charge. Every other provider passes
 * `targetResolution` through verbatim.
 */
export function resolveEditImageCreditIdentifier(req: FastifyRequest): string {
  const body = req.body as Record<string, unknown> | null
  const provider = (body?.provider as string) ?? "recraft-upscale"
  const targetResolution = typeof body?.targetResolution === "string" ? body.targetResolution : undefined
  const creditTier = provider === "topaz-image-upscale"
    ? resolveTopazUpscale({
        upscaleFactor: typeof body?.upscaleFactor === "string" ? body.upscaleFactor : undefined,
        targetResolution,
      }).creditTier
    : targetResolution
  return buildCreditModelIdentifier(provider, undefined, undefined, undefined, creditTier)
}

export async function editImageRoutes(app: FastifyInstance) {
  app.post("/v1/edit-image", { preHandler: creditGuard(resolveEditImageCreditIdentifier) }, async (req, reply) => {
    const parsed = editImageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    // `aspectRatio` is destructured as `raw*` on purpose: `applySnappedLevers`
    // below rewrites it on `parsed.data`, so this local is the caller's PRE-snap
    // value and is only ever valid as INPUT to the normalizer. Everything
    // downstream reads `parsed.data.aspectRatio`.
    const { imageUrl, taskId, prompt, provider, upscaleFactor, targetResolution, aspectRatio: rawAspectRatio, negativePrompt, style, seed, referenceImageUrls, maskUrl, maskIndexes } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Validate that prompt-driven edit providers have a prompt
    if ((provider === "nano-banana-edit" || provider === "grok-2-edit") && !prompt) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: `Prompt is required for ${provider} provider`,
        },
      })
    }

    const baseProvider = provider ?? "recraft-upscale"
    // `topaz.adjustments` is deliberately discarded rather than folded into the
    // `withAdjustments` response below: `ModelInputAdjustment.field` is a closed
    // union that does not admit `upscaleFactor`/`targetResolution`. Surfacing
    // them is a follow-up that carries its own @nodaro/shared changeset.
    const topaz = baseProvider === "topaz-image-upscale"
      ? resolveTopazUpscale({ upscaleFactor, targetResolution })
      : undefined
    const modelIdentifier = buildCreditModelIdentifier(
      baseProvider, undefined, undefined, undefined, topaz ? topaz.creditTier : targetResolution,
    )
    // The factor the worker renders. `targetResolution` stays on the payload
    // below so the worker's own resolveTopazUpscale call is a no-op agreement
    // rather than a second opinion, and so `input_data` keeps the evidence of
    // what the caller asked for.
    const effectiveUpscaleFactor = topaz ? topaz.upscaleFactor : upscaleFactor

    // Aspect-ONLY catalog snap. Billing-neutral on this route (pricing keys on
    // `targetResolution`, which is NOT passed here — see
    // `resolveEditImageCreditIdentifier`), so unlike generate-image /
    // image-to-image it may live in the handler without splitting CHECK from
    // DEBIT. Providers that declare no `aspectRatios` — the upscalers,
    // remove-bg and the grok task-chained ops — DROP the value, so
    // `image_size` stops being forwarded upstream for them; `nano-banana-edit`
    // keeps its own ratio list. Must run BEFORE `buildJobInputData` so the job
    // row records what actually ran.
    const normalized = resolveNormalizedImageGen({
      provider: baseProvider,
      aspectRatio: rawAspectRatio,
      refCount: 0,
      swapToI2i: false,
    })
    applySnappedLevers(parsed.data, normalized, editImageBody)

    // B4b: deployment prompt policy on the prompt-driven edit lane — only when
    // a prompt exists (upscale/remove-bg edits carry none, and policing ""
    // would inject a policy clause as the entire prompt). The DAG lane polices
    // in payload-builder. No policy registered = identity.
    const policed = prompt ? applyPromptPolicies({ prompt, negativePrompt: negativePrompt ?? "", kind: "image" }) : undefined
    const finalPrompt = policed ? policed.prompt : prompt
    const finalNegativePrompt = policed ? policed.negativePrompt || undefined : negativePrompt
    parsed.data.prompt = finalPrompt
    parsed.data.negativePrompt = finalNegativePrompt

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "edit-image"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("edit-image", {
      jobId: job.id,
      imageUrl,
      taskId,
      prompt: finalPrompt,
      provider,
      upscaleFactor: effectiveUpscaleFactor,
      targetResolution,
      aspectRatio: parsed.data.aspectRatio,
      negativePrompt: finalNegativePrompt,
      style,
      seed,
      referenceImageUrls,
      maskUrl,
      maskIndexes,
      usageLogId,
    })

    return withAdjustments({ jobId: job.id }, normalized.adjustments)
  })
}
