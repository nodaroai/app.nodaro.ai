import { LOOK_PREVIEW_SETS, SOUND_RENDER_SETS, registerLookPreviews } from "@nodaro/picker-ui"
import { isCloud } from "@/lib/edition"

/**
 * Turn on the rendered previews — the look pickers' (Style, Lens, Framing, …)
 * and the music / voice pickers' pictures (Music Genre, Music Mood,
 * Instrumentation, Voice Character, Voice Delivery) — Cloud only. They live on
 * the Nodaro CDN; a self-hosted install (Community / Business) never calls it
 * and keeps the drawn previews, 3D emoji and flags every picker ships with.
 */
export function bootstrapLookPreviews(): void {
  if (isCloud()) registerLookPreviews({ ...LOOK_PREVIEW_SETS, ...SOUND_RENDER_SETS })
}
