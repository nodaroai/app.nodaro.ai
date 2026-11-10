/**
 * The credit CHECK of POST /v1/image-to-image — the identifier the guard
 * reserves on — kept apart from the route module so a pricing caller (the
 * UGC quote) reaches it without loading the route's handler, queue and credit
 * guard. The route imports it and re-exports it.
 */
import type { FastifyRequest } from "fastify"
import { extractProvider } from "../lib/request-helpers.js"
import { resolveNormalizedImageGen } from "@nodaro/shared/credits"
import { defaultImageModel } from "@nodaro/shared/model-catalog"
import { imageToImageAspectRatio } from "../lib/image-auto-aspect.js"
import { rawBodyRecord, textField } from "../lib/run-model.js"

/**
 * The model a request RUNS on, for the guard's surface deny
 * (`CreditGuardOpts.runModel`): the model it names, else the edit default at
 * its aspect ratio — the default the handler fills in after the guard, the
 * same one the credit check below prices.
 */
export function resolveImageToImageRunModel(req: FastifyRequest): string {
  const body = rawBodyRecord(req)
  return textField(body.provider) ?? defaultImageModel("edit", textField(body.aspectRatio))
}

/**
 * The credit-CHECK model-identifier resolver (preHandler side). Named + exported
 * so the CHECK===DEBIT billing-parity test can run the EXACT pricing the live
 * preHandler runs — every route test mocks `creditGuard` to a no-op, so this
 * closure would otherwise never execute. Keep in lock-step with the handler's
 * reservation identifier in routes/image-to-image.ts.
 */
export function resolveImageToImageCreditIdentifier(req: FastifyRequest): string {
  const body = req.body as Record<string, unknown> | null
  const provider = extractProvider(req.body, defaultImageModel("edit", (body?.aspectRatio as string | undefined)))
  // flux-2-max bills per reference image. In image-to-image the primary
  // `imageUrl` is always one input plus any extra `referenceImageUrls` — so
  // refCount = 1 + extras (the worker concatenates them into `allImages` before
  // dispatching). swapToI2i:false because i2i is already an i2i provider.
  const extraRefs = (body?.referenceImageUrls as string[] | undefined)?.length ?? 0
  return resolveNormalizedImageGen({
    provider,
    // The ratio the handler runs: none named on a GPT Image 2, 2.5 or 2.6 edit is "auto".
    aspectRatio: imageToImageAspectRatio(provider, body?.aspectRatio),
    quality: body?.quality,
    resolution: body?.resolution,
    renderingSpeed: body?.renderingSpeed,
    background: body?.background,
    outputFormat: body?.outputFormat,
    gifFrames: body?.gifFrames,
    gifFrameDurationMs: body?.gifFrameDurationMs,
    svgLevel: body?.svgLevel,
    refCount: 1 + extraRefs,
    swapToI2i: false,
  }).identifier
}
