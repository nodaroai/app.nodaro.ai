import type { ScraperActorId } from "./scraper-actors.js"

/**
 * Scalar fields exposed in the Extract Field dropdown when the direct
 * upstream is a web-scrape node. Nested / non-scalar fields (authorMeta,
 * musicMeta) are intentionally omitted — users access them via the
 * "Custom path..." option.
 *
 * content-crawler paths are pre-dotted (`pages.url`, `pages.markdown`)
 * because its root shape is `{ pages: [...] }`, not a top-level array.
 */
export const SCRAPER_OUTPUT_FIELDS: Record<ScraperActorId, readonly string[]> = {
  "content-crawler": ["pages.url", "pages.markdown"],
  "google-search":   ["title", "url", "description"],
  "instagram":       [
    "url", "shortCode", "caption", "displayUrl", "videoUrl",
    "timestamp", "likesCount", "commentsCount", "ownerUsername", "type",
    "childPosts",
  ],
  "tiktok":          [
    "id", "webVideoUrl", "videoUrl", "text", "createTime",
    "diggCount", "shareCount", "playCount", "commentCount",
  ],
  "rss":             ["title", "url", "description", "pubDate", "guid"],
} as const
