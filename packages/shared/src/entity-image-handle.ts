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
 * The effective output TYPE a given source handle emits. Returns the raw node
 * type for every `(type, handle)` pair EXCEPT an entity `image` handle, which
 * resolves to `"upload-image"` (a plain image producer). Pure — safe for both
 * frontend and backend.
 */
export function resolveEffectiveSourceType(
  rawSourceType: string | undefined | null,
  sourceHandleId: string | undefined | null,
): string {
  if (sourceHandleId === "image" && ENTITY_IMAGE_HANDLE_TYPES.has(rawSourceType ?? "")) {
    return "upload-image"
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
