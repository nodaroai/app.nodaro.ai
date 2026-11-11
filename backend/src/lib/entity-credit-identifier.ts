import { buildCreditModelIdentifier, resolveNormalizedImageGen } from "@nodaro/shared/credits"
import { extractProvider } from "./request-helpers.js"
import { IMAGE_MODEL_ROLE_DEFAULTS, getModel, isPricedPerInputImage, resolutionAtAspectRatio } from "@nodaro/shared/model-catalog"

/** The quality a Reference Board runs at: dropped when its model does not offer it. */
export function boardQuality(provider: unknown, quality: unknown): string | undefined {
  if (typeof provider !== "string" || typeof quality !== "string") return undefined
  return getModel(provider)?.qualities?.includes(quality) ? quality : undefined
}

/**
 * The size a Reference Board renders at: the one asked for, moved to a size
 * its ratio renders where the model limits that ratio (GPT Image 2.5 draws
 * 27:16, 16:27, 9:8 and 8:9 at 1K only). The route's CHECK and DEBIT, its
 * queue payload and the workflow branch all price and send this one value.
 */
export function boardResolution(provider: unknown, aspectRatio: unknown, resolution: unknown): string | undefined {
  if (typeof resolution !== "string") return undefined
  return typeof provider === "string" ? resolutionAtAspectRatio(provider, aspectRatio, resolution) : resolution
}

/**
 * Quality-aware credit model identifier for the entity image routes
 * (generate-character / generate-location and their -asset variants).
 *
 * ONE derivation site shared by each route's credit-guard CHECK (raw, pre-Zod
 * body) and the handler's DEBIT (Zod-parsed data — same field names), so the
 * two can never drift (the CHECK===DEBIT billing-parity invariant
 * generate-image pins with a dedicated test). Reads defensively: missing /
 * non-string fields are ignored and the identifier degrades to the plain
 * provider, exactly what these routes priced before quality/resolution existed.
 *
 * `sourceImageUrl` doubles as the single reference image (the entity worker
 * sends it as `referenceImageUrls: [sourceImageUrl]`), so it drives the
 * ref-count dimension for ref-priced models (Flux 2 family) at the preHandler
 * CHECK, where the raw body is all that's knowable.
 *
 * `refCountOverride` lets a handler pin the ACTUAL number of reference images it
 * will send once known — the `generate-character-asset` route assembles a
 * multi-image identity set (portrait + reference_photos + realLifeRefs + prior
 * assets) that the CHECK can't see, so its DEBIT passes the real capped count.
 * Flux 2 bills per reference image and commits non-metered (no upward true-up),
 * so the RESERVED identifier must reflect the sent refs or the job under-charges.
 * A DEBIT count above the body-based CHECK count is safe: `reserveCredits` is the
 * authoritative atomic gate, so the delta can only reject a truly over-budget
 * request, never over-charge. For non-ref-priced providers the override is inert
 * (`buildCreditModelIdentifier` ignores refCount off the Flux 2 family).
 *
 * The `resolution` / `quality` levers are SNAPPED to `MODEL_CATALOG` here, not
 * at the routes: they are pricing dimensions (`gpt-image:high`,
 * `nano-banana-pro:4K`), and a snap applied only in a handler would leave the
 * preHandler CHECK pricing an un-snapped value. The entity worker forwards both
 * verbatim into `extraParams` (workers/handlers/entity.ts), so a lever the model
 * does not declare would otherwise reach KIE. The aspect ratio is NOT handled
 * here — `makeEntityImageHandler` already clamps it per-model via
 * `clampAspectRatioToModel` (workers/handlers/entity.ts), and the routes resolve
 * it through `resolveCharacterAspectRatio`; feeding it through this resolver
 * would let a write-back erase a ratio those two own.
 *
 * Returns the snapped pair alongside the identifier so a route can record and
 * enqueue exactly what it paid for. `resolveEntityImageCreditIdentifier` is the
 * identifier-only view of the SAME derivation, so the six existing call sites
 * (four route CHECKs + the two payload-builder entity branches) need no edit.
 */
export function resolveEntityImageParams(
  body: unknown,
  refCountOverride?: number,
): { identifier: string; resolution?: string; quality?: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const refCount =
    refCountOverride ?? (typeof b.sourceImageUrl === "string" && b.sourceImageUrl.length > 0 ? 1 : 0)
  const n = resolveNormalizedImageGen({
    provider: extractProvider(body, IMAGE_MODEL_ROLE_DEFAULTS.character),
    quality: b.quality,
    resolution: b.resolution,
    refCount,
    // Entity routes never auto-swap to an i2i sibling — the worker sends
    // `sourceImageUrl` as a reference to the SAME model.
    swapToI2i: false,
  })
  return { identifier: n.identifier, resolution: n.resolution, quality: n.quality }
}

export function resolveEntityImageCreditIdentifier(body: unknown, refCountOverride?: number): string {
  return resolveEntityImageParams(body, refCountOverride).identifier
}

/**
 * The credit id of an image route or node priced on the plain model (face,
 * object, creature, their asset routes, surround fill, a Scene). A model priced
 * per input image (GPT Image 2.6 Flare and Sunburst, MiniMax H3 Image) is
 * priced on what such a run sends: no quality or size (the model's default —
 * medium 1K on GPT Image 2.6, 2K on MiniMax H3 Image) and `inputImages`
 * pictures. Every other model keeps its plain id.
 */
export function plainEntityCreditIdentifier(provider: string, inputImages: number): string {
  if (!isPricedPerInputImage(provider)) return provider
  return buildCreditModelIdentifier(provider, undefined, undefined, undefined, undefined, inputImages)
}

/** The same id at a route's CHECK, where the raw body is all that is known. */
export function plainEntityCheckIdentifier(body: unknown, defaultProvider: string): string {
  const source = body && typeof body === "object" ? (body as Record<string, unknown>).sourceImageUrl : undefined
  return plainEntityCreditIdentifier(
    extractProvider(body, defaultProvider),
    typeof source === "string" && source.length > 0 ? 1 : 0,
  )
}

/**
 * The credit id of a workflow Character or Location node. The job it queues
 * carries no quality or size, so a model priced per input image is priced on
 * what it really sends: the model's default size (and quality) and its source
 * image. Every other model keeps the id built from the node's own settings.
 */
export function workflowEntityCreditIdentifier(data: unknown): string {
  const provider = extractProvider(data, IMAGE_MODEL_ROLE_DEFAULTS.character)
  return isPricedPerInputImage(provider)
    ? plainEntityCheckIdentifier(data, IMAGE_MODEL_ROLE_DEFAULTS.character)
    : resolveEntityImageCreditIdentifier(data)
}
