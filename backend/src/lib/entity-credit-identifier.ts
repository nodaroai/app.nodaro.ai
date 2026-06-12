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
 * ref-count dimension for ref-priced models (Flux 2 family). The studio
 * attach-path anchor (resolved from the DB row inside the -asset routes) is
 * NOT counted — it isn't knowable from the raw body at CHECK time, and the
 * identifier must read identically at both sites.
 */
export function resolveEntityImageCreditIdentifier(body: unknown): string {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const provider = extractProvider(body, "nano-banana")
  const quality = typeof b.quality === "string" ? b.quality : undefined
  const resolution = typeof b.resolution === "string" ? b.resolution : undefined
  const refCount = typeof b.sourceImageUrl === "string" && b.sourceImageUrl.length > 0 ? 1 : 0
  return buildCreditModelIdentifier(provider, quality, resolution, undefined, undefined, refCount)
}
