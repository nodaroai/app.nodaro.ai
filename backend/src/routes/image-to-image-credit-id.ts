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
    aspectRatio: body?.aspectRatio,
    quality: body?.quality,
    resolution: body?.resolution,
    renderingSpeed: body?.renderingSpeed,
    refCount: 1 + extraRefs,
    swapToI2i: false,
  }).identifier
}
