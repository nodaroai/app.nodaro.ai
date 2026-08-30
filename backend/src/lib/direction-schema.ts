import { z } from "zod"
import {
  DIRECTION_FIELDS,
  DIRECTION_ARRAY_CEILING,
  DIRECTION_ID_MAX_CHARS,
  type DirectionKey,
} from "@nodaro/prompts"

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
 * ONE schema for every surface that takes direction: `/v1/generate-image`,
 * `/v1/generate-video` and `/v1/text-to-video` all import it unchanged.
 * `/v1/extend-video` deliberately does not — its prompt continues an existing
 * clip, where re-stating the look is the wrong lever. Surface is a RENDER concern
 * (`renderDirectionHints` skips off-surface rows), not a wire concern, so an
 * image-only key sent to the video route is accepted and simply contributes no
 * hint. One schema also means one drift guard instead of two, and removes the
 * class of bug where a per-surface generic's type argument and its runtime
 * filter disagree.
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
 * TWO BOUNDS ARE DELIBERATELY *NOT* TOLERANT, and both are a new 400 relative
 * to the pre-registry 5-key schema (whose `z.string().optional()` ids were
 * unbounded): a value array longer than `DIRECTION_ARRAY_CEILING`, and an id
 * string longer than `DIRECTION_ID_MAX_CHARS`. The asymmetry with point 3 is
 * the point — the empty string is realistic legacy input a real client stores,
 * a 101-character "catalog id" is not an id at all, and the channel lands
 * verbatim in `jobs.input_data`. Tolerance is for input someone plausibly sent;
 * these bounds are storage hygiene on input nobody plausibly sent.
 *
 * BOTH bounds come from `@nodaro/prompts`, shared with the persisted-node
 * reader (`read-node-direction.ts`) rather than re-typed per door: the wire and
 * the canvas must agree on which strings are ids, or a body this route accepts
 * would silently lose ids when the same node is re-run from the canvas.
 *
 * Unknown IDS are likewise skipped, never rejected: every `get*PromptHint`
 * returns `""` on a miss, so a retired or pack-only id contributes no clause.
 */

const directionValue = z
  .union([
    z.string().max(DIRECTION_ID_MAX_CHARS),
    z.array(z.string().max(DIRECTION_ID_MAX_CHARS)).max(DIRECTION_ARRAY_CEILING),
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
