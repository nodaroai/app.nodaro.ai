import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { hasCredits } from "../lib/config.js"
import { readTopazImageSize, topazImageLinkRefusal, topazImageSizeBaseCredits, topazImageTier, topazImageTooLargeMessage } from "../lib/topaz-image-size.js"
import { NODARO_IMAGE_UPSCALE_TOO_LARGE_CODE } from "../lib/nodaro-image-upscale-size.js"
import {
  measureNodaroImageUpscaleInput,
  NODARO_IMAGE_UPSCALE_QUOTE_READ_MS,
  nodaroImageUpscaleArgs,
  nodaroImageUpscaleCopyOptions,
  nodaroImageUpscaleInputRefusal,
  nodaroImageUpscaleStamp,
} from "../lib/nodaro-image-upscale-lane.js"
import { copyOutsideInput, inspectOutsideInput, OutsideInputTimedOutError } from "../lib/outside-input-copy.js"
import { CLIENT_CLOSED, clientGoneSignal } from "../lib/client-gone.js"
import { houseModelInvalidRunError, houseModelServed, planHouseModelRun } from "../lib/house-models.js"
import { NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID, nodaroImageUpscaleTooLargeMessage } from "@nodaro/render-rules"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob, type RoutePricing } from "../middleware/credit-guard.js"
import { noteAdjustment, noteWarning } from "../lib/price-notes.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { withResolvedModel } from "../lib/job-resolved-model.js"
import { applySnappedLevers, withAdjustments } from "../lib/image-gen-normalize.js"
import { sourceImageForAutoAspect } from "../lib/image-source-size.js"
import { applyPromptPolicies } from "../lib/prompt-policy.js"
import { retiredEditProviderReason } from "../lib/retired-edit-providers.js"
import { IMAGE_ASPECT_RATIO_VALUES, IMAGE_EDIT_PROVIDERS, IMAGE_EDIT_TARGET_RESOLUTION_VALUES, TASK_CHAINED_EDIT_PROVIDERS, PROMPT_HARD_CEILING } from "@nodaro/shared/models"
import {
  buildCreditModelIdentifier,
  NODARO_IMAGE_UPSCALE_MODEL_ID,
  resolveNodaroImageUpscaleFactor,
  resolveNormalizedImageGen,
  resolveTopazUpscale,
  TOPAZ_UPSCALE_FACTORS,
  UPSCALE_FACTORS,
  upscaleFactorsFor,
} from "@nodaro/shared/credits"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { jobRunModel } from "../lib/run-model.js"

export const editImageBody = z.object({
  // imageUrl is required for every provider EXCEPT the task-chained Grok ops
  // (grok-2-edit / grok-2-segment), which take a prior Grok generation's
  // task_id instead of an image URL. The refinement below enforces
  // "imageUrl XOR taskId" with provider-aware routing.
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
  // Every upscaler's factors; the refinement below holds each model to its
  // own list (`upscaleFactorsFor`) — 8 is Nodaro Image Upscale's alone.
  upscaleFactor: z.enum(UPSCALE_FACTORS).optional(),
  targetResolution: z.enum(IMAGE_EDIT_TARGET_RESOLUTION_VALUES).optional(),
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
  { message: "imageUrl is required (or taskId for grok-2-edit / grok-2-segment)" },
).superRefine((data, ctx) => {
  // A factor the model does not take is refused, as the enum refused it before
  // 8 joined: Nodaro Image Upscale takes 1/2/4/8; every other provider keeps the
  // 1/2/4 it always accepted (Topaz's list), with the enum's own wording.
  if (data.upscaleFactor === undefined) return
  const accepted = upscaleFactorsFor(data.provider ?? "recraft-upscale") ?? TOPAZ_UPSCALE_FACTORS
  if (!(accepted as readonly string[]).includes(data.upscaleFactor)) {
    ctx.addIssue({
      code: "custom",
      path: ["upscaleFactor"],
      message: `Invalid option: expected one of ${accepted.map((f) => `"${f}"`).join("|")}`,
    })
  }
})

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
  // Nodaro Image Upscale is priced by its output's size: the tier the size
  // preHandler stamped, else the hold (a size that could not be read). Never
  // `targetResolution` — a tier stored for another model says nothing of it.
  if (provider === NODARO_IMAGE_UPSCALE_MODEL_ID) return req.nodaroImageUpscale?.creditId ?? NODARO_IMAGE_UPSCALE_HOLD_CREDIT_ID
  const targetResolution = typeof body?.targetResolution === "string" ? body.targetResolution : undefined
  const creditTier = provider === "topaz-image-upscale"
    ? resolveTopazUpscale({
        upscaleFactor: typeof body?.upscaleFactor === "string" ? body.upscaleFactor : undefined,
        targetResolution,
      }).creditTier
    : targetResolution
  return buildCreditModelIdentifier(provider, undefined, undefined, undefined, creditTier)
}

/**
 * Topaz image upscale is priced by output size: read the image's header BEFORE
 * the guard, refuse an output past the provider's largest size (a 400, nothing
 * reserved), and let the guard charge the size's units when they cost more
 * than the factor's tier (lib/topaz-image-size.ts). Only where credits are
 * charged. A link to outside content is first held to the deployment's
 * link-import switch, in every edition. Inert for every other provider.
 */
async function topazImageSizePreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = req.body as Record<string, unknown> | null
  if (body?.provider !== "topaz-image-upscale") return
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : undefined
  if (!imageUrl || !safeUrlSchema.safeParse(imageUrl).success) return
  // The deployment's link-import switch, in every edition: a link to outside
  // content is refused where link imports are off (403, nothing read), as
  // Nodaro Image Upscale's copy refuses it — whether or not its size is read.
  const linkRefusal = topazImageLinkRefusal(imageUrl)
  if (linkRefusal) return reply.status(403).send({ error: linkRefusal })
  if (!hasCredits()) return
  const reading = await readTopazImageSize(imageUrl, topazImageTier(body).factor)
  if (reading.kind === "too-large") {
    return reply.status(400).send({ error: { code: "image_too_large", message: topazImageTooLargeMessage(reading.megapixels) } })
  }
  if (reading.kind === "sized") req.topazImageSizeUnits = reading.units
  // A quote says when it could not price by size (a no-op on a run).
  else noteWarning(req, IMAGE_SIZE_UNMEASURED_AT_TIER)
}

/** Topaz, an image whose size its header does not give: priced at its factor's own price. */
const IMAGE_SIZE_UNMEASURED_AT_TIER = {
  code: "image_size_unmeasured",
  message: "The image's size could not be read before the run, so it is priced at its factor's own price. A run whose image cannot be read fails and is refunded.",
} as const

/**
 * Edit models that take a prompt, refused without one — before the credit
 * guard, so the 400 names the problem rather than a 402, and so a quote never
 * prices a body the run refuses.
 */
async function editPromptRequiredPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = req.body as Record<string, unknown> | null
  const provider = body?.provider
  if ((provider === "nano-banana-edit" || provider === "grok-2-edit") && !body?.prompt) {
    return reply.status(400).send({
      error: {
        code: "validation_error",
        message: `Prompt is required for ${provider} provider`,
      },
    })
  }
}

/**
 * Nodaro Image Upscale, a house model (lib/nodaro-image-upscale-lane.ts), run
 * by the credit guard as its `beforePricing` step: after the model deny (an
 * install that does not serve it refuses it there, with nothing copied), the
 * app-token scope gate and the Idempotency-Key dedup, and before the price is
 * resolved and the balance checked — so a request a cheaper gate refuses never
 * stores a copy. Its image goes through the copy helper — copied to our
 * storage under the lane's size limit, or, for a quote, checked with nothing
 * stored — and is measured there. An output past the limits is refused, and
 * so is one the plugin finds no valid run for (`planHouseModelRun`), before
 * anything is reserved. The caller's `imageUrl` is kept as it was sent; the
 * stored copy, its bytes and the tier its output is charged are stamped for
 * the resolver and the handler (`nodaroImageUpscaleStoredUrl` and friends). An
 * image whose size cannot be read stamps the hold (settled to what the run
 * delivers).
 */
async function nodaroImageUpscaleBeforePricing(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = req.body as Record<string, unknown> | null
  if (body?.provider !== NODARO_IMAGE_UPSCALE_MODEL_ID) return
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : undefined
  if (!imageUrl || !safeUrlSchema.safeParse(imageUrl).success) return
  if (!houseModelServed(NODARO_IMAGE_UPSCALE_MODEL_ID)) return
  const userId = req.userId
  if (!userId) return
  // A quote reads under its own deadline and stops when the client hangs up:
  // its slot is one of the few the quotes share.
  const quote = req.quoteOnly === true ? quoteRead(reply) : undefined
  let input: Awaited<ReturnType<typeof measureNodaroImageUpscaleInput>>
  try {
    // A quote stores nothing: the same checks and the same measurement, on the caller's URL.
    const stored = quote
      ? { url: imageUrl, ...(await inspectOutsideInput(imageUrl, nodaroImageUpscaleCopyOptions(userId, quote.signal))) }
      : await copyOutsideInput(imageUrl, nodaroImageUpscaleCopyOptions(userId))
    input = await measureNodaroImageUpscaleInput(stored.url, stored, body.upscaleFactor)
  } catch (err) {
    // Nobody is waiting for the answer: say so, and nothing more.
    if (quote?.clientGone.aborted) return reply.status(499).send({ error: CLIENT_CLOSED })
    const refusal = nodaroImageUpscaleInputRefusal(err)
    if (refusal) return reply.status(refusal.status).send({ error: { code: refusal.code, message: refusal.message } })
    return sendInternalError(reply, req, err)
  } finally {
    quote?.dispose()
  }
  if (input.sizing?.kind === "too-large") {
    return reply.status(400).send({ error: { code: NODARO_IMAGE_UPSCALE_TOO_LARGE_CODE, message: nodaroImageUpscaleTooLargeMessage(input.sizing) } })
  }
  if (input.sizing?.kind === "sized" && !planHouseModelRun(NODARO_IMAGE_UPSCALE_MODEL_ID, nodaroImageUpscaleArgs(input.url, body.upscaleFactor, input.sizing.pixels))) {
    return reply.status(400).send({ error: { code: "validation_error", message: houseModelInvalidRunError(NODARO_IMAGE_UPSCALE_MODEL_ID).message } })
  }
  // The stored copy rides beside the caller's link: priced, inserted and sent as the stamp.
  req.nodaroImageUpscale = { creditId: input.creditId, stamp: nodaroImageUpscaleStamp(input) }
  // What a quote says of the price (no-ops on a run): the output it priced, or the hold.
  if (input.sizing?.kind === "sized") {
    const fmt = (n: number) => n.toLocaleString("en-US")
    noteAdjustment(req, {
      code: "output_size",
      message: `Priced by the output's size: ${fmt(input.sizing.width)} × ${fmt(input.sizing.height)} (${fmt(input.sizing.pixels)} pixels).`,
    })
  } else {
    noteWarning(req, { code: "image_size_unmeasured", message: "The picture's size could not be read before the run, so it is priced as the largest output." })
    noteWarning(req, {
      code: "settles_to_actual",
      message: "This is the most the run can cost: it is charged for the picture it delivers, and the difference is refunded when it finishes.",
    })
  }
}

/**
 * The signal a quote reads its picture under: its deadline
 * (`NODARO_IMAGE_UPSCALE_QUOTE_READ_MS`, refused as `input_timed_out`, a
 * refusal to try again) and the client hanging up — the response's `close`
 * before it finished, never the request's, which fires once the body is read.
 */
function quoteRead(reply: FastifyReply): { signal: AbortSignal; clientGone: AbortSignal; dispose(): void } {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(new OutsideInputTimedOutError()), NODARO_IMAGE_UPSCALE_QUOTE_READ_MS)
  const clientGone = clientGoneSignal(reply)
  return {
    signal: AbortSignal.any([deadline.signal, clientGone]),
    clientGone,
    dispose: () => clearTimeout(timer),
  }
}

/**
 * A provider this route no longer serves (`lib/retired-edit-providers.ts`) is
 * answered BEFORE the credit guard — the id has no price any more, and the
 * guard's 503 "price not configured" would hide the reason from a client that
 * still sends it. The orchestrator lane reads the same table in
 * `payload-builder.ts`.
 */
async function retiredEditProviderPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const reason = retiredEditProviderReason((req.body as Record<string, unknown> | null)?.provider)
  if (reason) {
    return reply.status(400).send({ error: { code: "validation_error", message: reason } })
  }
}

/** A Topaz upscale priced above its factor's own price by its output's size (computeCredits). */
async function topazImageSizeCredits(_body: unknown, req: FastifyRequest): Promise<number | undefined> {
  if (req.topazImageSizeUnits === undefined) return undefined
  const base = await topazImageSizeBaseCredits(resolveEditImageCreditIdentifier(req), req.topazImageSizeUnits)
  if (base !== undefined) {
    noteAdjustment(req, { code: "output_size", message: "Priced by the output's size: a large output costs more than its factor's own price." })
  }
  return base
}

/**
 * The route's whole pricing chain, declared ONCE (`RoutePricing`): the run
 * registers it as its preHandlers and `POST /v1/quote` runs the same steps on
 * the same body without a job — the same resolver, the same Nodaro Image
 * Upscale measurement (a quote checks the picture with nothing stored), the
 * same Topaz size reading — so a quote cannot drift from what the run reserves.
 */
export const editImagePricing: RoutePricing = {
  prechecks: [retiredEditProviderPreHandler, editPromptRequiredPreHandler, topazImageSizePreHandler],
  modelResolver: resolveEditImageCreditIdentifier,
  opts: {
    runModel: jobRunModel("edit-image"),
    beforePricing: nodaroImageUpscaleBeforePricing,
    computeCredits: topazImageSizeCredits,
  },
}

export async function editImageRoutes(app: FastifyInstance) {
  app.post("/v1/edit-image", {
    preHandler: [...editImagePricing.prechecks, creditGuard(editImagePricing.modelResolver, editImagePricing.opts)],
  }, async (req, reply) => {
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

    // A prompt-driven edit with no prompt was refused before the guard (editPromptRequiredPreHandler).
    const baseProvider = provider ?? "recraft-upscale"
    // `topaz.adjustments` is deliberately discarded rather than folded into the
    // `withAdjustments` response below: `ModelInputAdjustment.field` is a closed
    // union that does not admit `upscaleFactor`/`targetResolution`. Surfacing
    // them is a follow-up that carries its own @nodaro/shared changeset.
    const topaz = baseProvider === "topaz-image-upscale"
      ? resolveTopazUpscale({ upscaleFactor, targetResolution })
      : undefined
    const nodaroImageUpscale = baseProvider === NODARO_IMAGE_UPSCALE_MODEL_ID
    // Nodaro Image Upscale reserves the id its CHECK priced — the tier stamped from
    // the output's size, or the hold — through the same resolver (CHECK === DEBIT).
    const modelIdentifier = nodaroImageUpscale
      ? resolveEditImageCreditIdentifier(req)
      : buildCreditModelIdentifier(
          baseProvider, undefined, undefined, undefined, topaz ? topaz.creditTier : targetResolution,
        )
    // The factor the worker renders. `targetResolution` stays on the payload
    // below so the worker's own resolveTopazUpscale call is a no-op agreement
    // rather than a second opinion, and so `input_data` keeps the evidence of
    // what the caller asked for. Nodaro Image Upscale always sends its factor (2
    // when none was given), never the provider's default.
    const effectiveUpscaleFactor = topaz
      ? topaz.upscaleFactor
      : nodaroImageUpscale
        ? resolveNodaroImageUpscaleFactor(upscaleFactor)
        : upscaleFactor

    // Aspect-ONLY catalog snap. Billing-neutral on this route (pricing keys on
    // `targetResolution`, which is NOT passed here — see
    // `resolveEditImageCreditIdentifier`), so unlike generate-image /
    // image-to-image it may live in the handler without splitting CHECK from
    // DEBIT. Providers that declare no `aspectRatios` — the upscalers,
    // remove-bg and the grok task-chained ops — DROP the value, so
    // `image_size` stops being forwarded upstream for them; `nano-banana-edit`
    // keeps its own ratio list. Must run BEFORE `buildJobInputData` so the job
    // row records what actually ran. "auto" on a model without a native auto
    // keeps the source photo's shape: `imageUrl`'s size, read from its header
    // (and only in that case), picks the model's nearest ratio.
    const sourceImage = await sourceImageForAutoAspect(baseProvider, rawAspectRatio, imageUrl)
    const normalized = resolveNormalizedImageGen({
      provider: baseProvider,
      aspectRatio: rawAspectRatio,
      refCount: 0,
      swapToI2i: false,
      sourceImage,
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
        // Nodaro Image Upscale: its stored image, bytes, output size and the id it
        // reserves ride on the job, so the worker's payload and `input_data` agree
        // and the worker and the reconcile settle only a hold (lib/nodaro-image-upscale-lane.ts).
        input_data: withResolvedModel({
          ...buildJobInputData(parsed.data, "edit-image"),
          ...(nodaroImageUpscale ? { ...req.nodaroImageUpscale?.stamp, nodaroImageUpscaleCreditId: modelIdentifier } : {}),
        }, "edit-image"),
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
      ...(nodaroImageUpscale ? { ...req.nodaroImageUpscale?.stamp, nodaroImageUpscaleCreditId: modelIdentifier } : {}),
    })

    return withAdjustments({ jobId: job.id }, normalized.adjustments)
  })
}
