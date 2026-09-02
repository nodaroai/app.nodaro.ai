/**
 * Route-side glue for the catalog snap (`resolveNormalizedImageGen`).
 *
 * The snap itself lives in `@nodaro/shared` because it is a PRICING event —
 * `resolution` and `quality` feed the credit identifier, so the CHECK
 * (creditGuard preHandler) and the DEBIT (`reserveCreditsForJob`) have to
 * derive both from one call or the reserve silently bills a tier the run never
 * produced. What is left for the routes is mechanical and identical across all
 * of them: write the snapped levers back onto the Zod-parsed body so the
 * persisted `input_data` and the provider payload describe what actually ran,
 * and surface the corrections in the response. Both live here so
 * `/v1/generate-image`, `/v1/image-to-image` and the workflow orchestrator
 * share one implementation instead of three drifting copies.
 */
import type { z } from "zod"
import type { ModelInputAdjustment, NormalizedImageGen } from "@nodaro/shared"

/** The catalog-governed levers a route hands to the normalizer. */
const SNAPPED_LEVER_FIELDS = ["aspectRatio", "resolution", "quality"] as const

/** Just the snapped values — callers pass the whole `NormalizedImageGen`. */
type SnappedLevers = Pick<NormalizedImageGen, (typeof SNAPPED_LEVER_FIELDS)[number]>

/**
 * Write the catalog-snapped levers back onto a route's Zod-parsed body.
 *
 * `data` is mutated in place, mirroring the existing `parsed.data.prompt = …`
 * policing pattern: everything downstream of the route's parse (the
 * `buildJobInputData` spread, the queue payload) then reads the values that
 * were actually priced and sent, with no second place to keep in sync.
 *
 * WHY THE SCHEMA IS A PARAMETER. The snapped value comes from the catalog,
 * while `data`'s type comes from the route's own Zod enums — asserting one into
 * the other with `as` would be a lying cast that can push a value past the
 * validation the route declares. Instead each field is re-parsed through the
 * route's OWN schema for that field: `.safeParse` returns the value already
 * narrowed to the declared union, and a value the enum does not carry is left
 * alone rather than smuggled in.
 *
 * That fallback is unreachable today and should stay that way. The snap can
 * only ever RETURN a value the caller already sent (which passed the route's
 * Zod), its canonical spelling, or the catalog's first/preferred option — so
 * the invariant the fallback depends on is narrow: every image model's FIRST
 * aspect ratio and PREFERRED resolution must be spelled in the route enums.
 * If that ever drifts, the affected lever silently keeps the caller's value
 * while the credit identifier is priced off the snapped one — so the fix is to
 * close the enum gap, never to widen this fallback.
 *
 * A field the route does not expose, and a field whose snapped value equals
 * what the caller sent, are both skipped — so a catalog-valid request leaves
 * `data` byte-identical to the pre-snap behaviour.
 */
export function applySnappedLevers<Shape extends Record<string, z.ZodType>>(
  data: Record<string, unknown>,
  normalized: SnappedLevers,
  schema: z.ZodObject<Shape>,
): void {
  for (const field of SNAPPED_LEVER_FIELDS) {
    const next = normalized[field]
    if (next === data[field]) continue
    const fieldSchema: z.ZodType | undefined = schema.shape[field]
    if (!fieldSchema) continue
    const narrowed = fieldSchema.safeParse(next)
    if (narrowed.success) data[field] = narrowed.data
  }
}

/**
 * Attach the disclosure channel to a route's 200 body.
 *
 * Absent — not `[]` — when nothing was corrected, so the mainline response
 * shape is unchanged for every request that was already catalog-valid.
 */
export function withAdjustments<T extends object>(
  body: T,
  adjustments: ModelInputAdjustment[],
): T | (T & { adjustments: ModelInputAdjustment[] }) {
  return adjustments.length > 0 ? { ...body, adjustments } : body
}
