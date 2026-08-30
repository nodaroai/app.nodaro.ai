import { z } from "zod"
import { DIRECTION_FIELDS, DIRECTION_ARRAY_CEILING, type DirectionKey } from "@nodaro/prompts"

/**
 * Route-level Zod mirror of `@nodaro/prompts` `DirectionFields` — the flat
 * cinematic-direction id channel Studio, the MCP route and canvas node data all
 * speak.
 *
 * DERIVED from `DIRECTION_FIELDS`, never hand-mirrored: the key set comes
 * straight from the registry table, so the wire schema cannot drift from what
 * `renderDirectionHints` actually folds (pinned by
 * `__tests__/direction-schema.test.ts`).
 *
 * ONE schema for BOTH `/v1/generate-image` and `/v1/generate-video`. Surface is
 * a RENDER concern (`renderDirectionHints` skips off-surface rows), not a wire
 * concern, so an image-only key sent to the video route is accepted and simply
 * contributes no hint. One schema also means one drift guard instead of two,
 * and removes the class of bug where a per-surface generic's type argument and
 * its runtime filter disagree.
 *
 * DELIBERATELY TOLERANT, in three ways, all load-bearing:
 *  1. NOT `.strict()` (matching `connectedReferenceSchema`): a NEWER client on
 *     an OLDER API has unknown keys silently STRIPPED rather than 400'd. The
 *     consequence is that a client which starts sending new dimensions before
 *     the platform is live loses those hints QUIETLY instead of erroring —
 *     which is exactly why platform-first deploy ordering is load-bearing, not
 *     a nicety.
 *  2. Every key accepts `string | string[]` up to a flat ceiling; the
 *     per-dimension cap is the renderer's slice. A client that stored 3 ids on
 *     a 2-pick dimension keeps running (top 2 win) instead of 400ing a
 *     production the user can still see.
 *  3. NO `.min(1)` on an id — the pre-registry 5-key schema accepted the empty
 *     string and the renderer drops it, so adding `min(1)` would be a NEW 400
 *     on currently-accepted input.
 *
 * Unknown IDS are likewise skipped, never rejected: every `get*PromptHint`
 * returns `""` on a miss, so a retired or pack-only id contributes no clause.
 */

/** Catalog ids are short slugs; a generous ceiling that closes an unbounded
 *  string channel landing verbatim in `jobs.input_data`. */
const DIRECTION_ID_MAX = 100

const directionValue = z
  .union([
    z.string().max(DIRECTION_ID_MAX),
    z.array(z.string().max(DIRECTION_ID_MAX)).max(DIRECTION_ARRAY_CEILING),
  ])
  .optional()

/**
 * The `as Record<DirectionKey, …>` cast is load-bearing, not cosmetic: a bare
 * `Object.fromEntries` types the shape as `Record<string, …>`, which widens
 * `keyof z.infer<typeof directionSchema>` to `string` and makes the type-level
 * drift guard vacuous. The runtime key-set cross-check pins the cast against
 * the table.
 */
export const directionSchema = z.object(
  Object.fromEntries(DIRECTION_FIELDS.map((f) => [f.key, directionValue] as const)) as Record<
    DirectionKey,
    typeof directionValue
  >,
)
