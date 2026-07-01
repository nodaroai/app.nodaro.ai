import { buildCreditModelIdentifier } from "@nodaro/shared"
import { extractProvider } from "./request-helpers.js"

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
 */
export function resolveEntityImageCreditIdentifier(body: unknown, refCountOverride?: number): string {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const provider = extractProvider(body, "nano-banana")
  const quality = typeof b.quality === "string" ? b.quality : undefined
  const resolution = typeof b.resolution === "string" ? b.resolution : undefined
  const refCount =
    refCountOverride ?? (typeof b.sourceImageUrl === "string" && b.sourceImageUrl.length > 0 ? 1 : 0)
  return buildCreditModelIdentifier(provider, quality, resolution, undefined, undefined, refCount)
}
