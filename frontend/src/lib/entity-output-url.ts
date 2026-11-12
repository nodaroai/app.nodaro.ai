import { entityImageUrl } from "@nodaro/shared/entities"

/**
 * The image URL an entity node (character / object / location / creature) emits
 * on its `image` handle / primary output — mirrors the node's displayed
 * thumbnail: the user-selected default asset (starred in the Studio) wins, else
 * the active generated result, else the persisted source image. The shared
 * `entityImageUrl` (the workflow run's rule too, and a wired Character's
 * portrait on both paths), so the previewed image can't drift from the emitted
 * one.
 */
export function entityActiveImageUrl(data: Record<string, unknown>): string | undefined {
  return entityImageUrl(data)
}
