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
