import type { AggregateableType } from "@nodaro/shared"
import { HANDLE_COLORS } from "@/lib/handle-colors"

/**
 * Aggregate handle pip colors (Group + Collect typed handles) — derived from
 * the canonical per-type HANDLE_COLORS map so an image/video/audio/text
 * aggregate handle is the SAME color as the same-typed pip on every other
 * node, edge, etc.
 *
 * Previously this was a separate literal set (text=green, image=#ff0073,
 * video=cyan, audio=character-pink) that disagreed with the canonical map on
 * all four types — and used the brand action-pink #ff0073, which the canonical
 * map reserves and must never color a handle/edge. Deriving here removes that
 * drift permanently.
 */
export const AGGREGATE_HANDLE_COLORS: Record<AggregateableType, string> = {
  text: HANDLE_COLORS.text,
  image: HANDLE_COLORS.image,
  video: HANDLE_COLORS.video,
  audio: HANDLE_COLORS.audio,
}
