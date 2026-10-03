/**
 * Video Analysis `video` — what it analyzes: a video file from a video
 * producer, a post's LINK from a text output (the Telegram Account Trigger's
 * Video link, a Text node), or a Social Search's posts (each analyzed from its
 * own video file when it came with one, else by its page link). One predicate
 * shared by the node's own pip, the drag-to-connect validator
 * (`connection-validation.ts`) and the source-direction popover registry
 * (`target-handle-registry.ts`), so the three can never disagree. Both engines
 * route a text source on this handle into the link (`videoPageUrl`), a video
 * producer into the file, and a Social Search post into either
 * (`socialSearchPostVideo`).
 */
import { socialPostsFrom, socialPostsLongestVideoSec } from "@nodaro/shared"
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

/**
 * The video length Video Analysis is quoted at when a Social Search's posts
 * are wired into its `video` input: the longest of the posts the wire hands
 * on (every post on an Each wire, the first on any other), from the lengths
 * the search returned. Each post is charged by its own length when it runs,
 * so the quote is never below the charge. Undefined when a length is unknown
 * (the ceiling quotes it); null when no Social Search is wired there (the
 * node is priced the usual way). The node's badge and every run estimate read
 * this one function.
 */
export function wiredSocialPostsVideoSec(
  nodeId: string,
  edges: ReadonlyArray<{ source?: string; target: string; targetHandle?: string | null; data?: unknown }> | undefined,
  nodes: ReadonlyArray<{ id: string; type?: string | null; data?: unknown }> | undefined,
): number | null | undefined {
  const edge = edges?.find((e) => e.target === nodeId && e.targetHandle === "video")
  const src = edge ? nodes?.find((n) => n.id === edge.source) : undefined
  if (!edge || src?.type !== "social-search") return null
  const posts = socialPostsFrom((src.data as Record<string, unknown> | undefined)?.generatedJson)
  const each = (edge.data as { outputMode?: unknown } | undefined)?.outputMode === "each"
  return socialPostsLongestVideoSec(each ? posts : posts.slice(0, 1))
}
