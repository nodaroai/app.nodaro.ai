/**
 * Video Analysis `video` — what it analyzes: a video file from a video
 * producer, a post's LINK from a text output (the Telegram Account Trigger's
 * Video link, a Text node), or a Social Search's posts (each analyzed by its
 * page link). One predicate shared by the node's own pip, the drag-to-connect
 * validator (`connection-validation.ts`) and the source-direction popover
 * registry (`target-handle-registry.ts`), so the three can never disagree.
 * Both engines route a text source or a Social Search post on this handle
 * into the link (`videoPageUrl`), a video producer into the file.
 */
import { ACCEPTS_POST_LINK } from "./content-handles"
import { ACCEPTS_VIDEO } from "./ffmpeg-handles"

export const ACCEPTS_VIDEO_OR_POST_LINK = (sourceType: string): boolean =>
  ACCEPTS_VIDEO(sourceType) || ACCEPTS_POST_LINK(sourceType) || sourceType === "social-search"

/** A Social Search's posts reach Video Analysis through its `json` output;
 *  the `text` digest holds no single post's link. */
export const SOCIAL_SEARCH_POSTS_HANDLE = "json"

/**
 * A new wire from a Social Search's posts into Video Analysis starts in Each
 * mode, so every post it passes on is analyzed, not only the first. The
 * person can still change the wire's mode.
 */
export function initialEdgeData(sourceType: string | undefined, sourceHandle: string | null | undefined, targetType: string | undefined, targetHandle: string | null | undefined): { outputMode: "each" } | undefined {
  return sourceType === "social-search" && sourceHandle === SOCIAL_SEARCH_POSTS_HANDLE && targetType === "video-analysis" && targetHandle === "video"
    ? { outputMode: "each" }
    : undefined
}
