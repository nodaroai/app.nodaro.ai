import { LOOK_PREVIEW_SETS, registerLookPreviews } from "@nodaro/picker-ui"
import { isCloud } from "@/lib/edition"

/**
 * Turn on the rendered look previews (Style, Lens, Framing, …) — Cloud only.
 * They live on the Nodaro CDN; a self-hosted install (Community / Business)
 * never calls it and keeps the drawn previews every picker ships with.
 */
export function bootstrapLookPreviews(): void {
  if (isCloud()) registerLookPreviews(LOOK_PREVIEW_SETS)
}
