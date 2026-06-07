import { getModel } from "@nodaro/shared"

/**
 * Normalize a caller-supplied image-model identifier for the `image_provider`
 * column on characters / locations / objects.
 *
 * Keeps the value only when it's a known MODEL_CATALOG entry of `kind: "image"`;
 * anything else (unknown id, a video/audio model, empty string, null, undefined)
 * collapses to `null`. This is the single source of truth for the per-entity
 * `image_provider` validation, shared by the three upsert routes so an unknown
 * or non-image value can never be persisted.
 */
export function normalizeImageProvider(value: string | null | undefined): string | null {
  return value && getModel(value)?.kind === "image" ? value : null
}
