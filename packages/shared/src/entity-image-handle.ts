/**
 * Entity node types that expose a plain `image` source handle (emitting the
 * portrait URL) in addition to their identity `*Ref` handle. When a wire leaves
 * the `image` handle, the entity is treated as a plain image PRODUCER
 * (substituted to "upload-image") so it reaches image inputs and lists exactly
 * like generate-image / upload-image, while the `*Ref` handle stays identity.
 *
 * SINGLE SOURCE OF TRUTH — consumed by:
 *   - frontend connection validation (drop validator, drag-glow, popover),
 *   - frontend run assemblers (execute-node, video-prompt-assembly),
 *   - frontend config-panel reference preview builders,
 *   - backend payload-builder identity-injection guards.
 * Add future per-handle output-type remaps HERE so every surface inherits them.
 */
export const ENTITY_IMAGE_HANDLE_TYPES: ReadonlySet<string> = new Set([
  "character",
  "location",
  "object",
  "creature",
])

/**
 * Aggregate node types (Group / Collect) whose source handles are typed LANES
 * — `out-text` / `out-image` / `out-video` / `out-audio` — each emitting that
 * media type. Like an entity's `image` handle, a wire leaving a lane is a plain
 * producer of that lane's type, so it must reach the typed inputs of every
 * consumer (Image Collage, Combine Videos, Merge Lists, prompts, …) exactly as
 * an upload node of that type would. Neither node type is in any producer set
 * itself: the NODE emits nothing, its LANES do.
 */
export const AGGREGATE_LANE_SOURCE_TYPES: ReadonlySet<string> = new Set(["group", "collect"])

/**
 * The plain producer each aggregate lane behaves as. `upload-*` are the
 * canonical single-media producers present in every typed accepts set
 * (IMAGE/VIDEO/AUDIO_PRODUCER_TYPES). `out-text` maps to `list`, not
 * `text-prompt`: the lane is a LIST of texts, so it must reach both prompt
 * inputs (TEXT_PRODUCER_TYPES) and the list consumers (Merge Lists / Sort /
 * Dedup / Selector — LIST_PRODUCER_TYPES), exactly like a List text column.
 * (`list` is also a DYNAMIC producer, so the text lane is admitted at media
 * inputs too — the same latitude a List column already has on canvas.)
 */
const AGGREGATE_LANE_EFFECTIVE_TYPE: Readonly<Record<string, string>> = {
  "out-image": "upload-image",
  "out-video": "upload-video",
  "out-audio": "upload-audio",
  "out-text": "list",
}

/**
 * The effective output TYPE a given source handle emits. Returns the raw node
 * type for every `(type, handle)` pair EXCEPT:
 *   - an entity `image` handle → `"upload-image"` (a plain image producer);
 *   - an aggregate (group / collect) lane handle → the plain producer of that
 *     lane's media type (see AGGREGATE_LANE_EFFECTIVE_TYPE).
 * Pure — safe for both frontend and backend.
 */
export function resolveEffectiveSourceType(
  rawSourceType: string | undefined | null,
  sourceHandleId: string | undefined | null,
): string {
  if (sourceHandleId === "image" && ENTITY_IMAGE_HANDLE_TYPES.has(rawSourceType ?? "")) {
    return "upload-image"
  }
  if (AGGREGATE_LANE_SOURCE_TYPES.has(rawSourceType ?? "")) {
    const effective = AGGREGATE_LANE_EFFECTIVE_TYPE[sourceHandleId ?? ""]
    if (effective) return effective
  }
  return rawSourceType ?? ""
}

/**
 * The ref-assembly map key (and `ConnectedReference.id`) for a wired source.
 *
 * An entity's `image` handle emits a plain image that is DISTINCT from the
 * entity's identity `*Ref` handle, yet both edges carry the SAME source node
 * id. Every ref-assembly map that keyed by the bare node id therefore had the
 * two edges collide — silently dropping one (identity → a literal `@abi:N`
 * token + lost character, or the plain image → missing from the picker),
 * non-deterministically by edge order. Scoping the entity-`image`-handle ref to
 * `${nodeId}::image` keeps the two refs distinct so BOTH survive. Every other
 * (type, handle) keeps the bare node id, so nothing else changes.
 */
export function sourceRefKey(
  nodeId: string,
  sourceHandleId: string | undefined | null,
  rawSourceType: string | undefined | null,
): string {
  return sourceHandleId === "image" && ENTITY_IMAGE_HANDLE_TYPES.has(rawSourceType ?? "")
    ? `${nodeId}::image`
    : nodeId
}
