import { POST_CONTENT_ANALYSIS_SYSTEM_PROMPT } from "@nodaro/prompts/doctrine"
import type { AdCreativeAnalysis } from "@nodaro/shared/social"
import { analyzeAdCreatives, type AdCreativeItem, type AdCreativeAnalysisStats, type AnalyzeAdCreativesOptions } from "./ad-creative-analysis.js"
import type { InstagramPostWithMedia } from "./instagram-media.js"

/**
 * Per-post AI analysis for Instagram — the same engine as Meta Ads, run with
 * the CONTENT-analyst persona (organic posts, not paid ads). Output shape is
 * shared, so one Results renderer serves both.
 */
export interface InstagramPostAnalyzed extends InstagramPostWithMedia {
  readonly analysis: AdCreativeAnalysis | null
  readonly analysisSkipped?: "deadline" | "failed"
}

function mediaSummary(post: InstagramPostWithMedia): string {
  const parts: string[] = []
  if (post.videos.length > 0) parts.push(`${post.videos.length} video${post.videos.length === 1 ? "" : "s"}`)
  if (post.images.length > 0) parts.push(`${post.images.length} image${post.images.length === 1 ? "" : "s"}`)
  return parts.join(", ")
}

/** The one frame the analyst sees: a video's cover first, else the first image. */
export function instagramAnalysisImage(post: InstagramPostWithMedia): string | undefined {
  return post.videoPreviews[0] ?? post.images[0]
}

export function instagramPostToCreativeItem(post: InstagramPostWithMedia, focus?: string): AdCreativeItem {
  return {
    id: post.postId,
    imageUrl: instagramAnalysisImage(post),
    advertiser: post.ownerUsername || undefined,
    body: post.caption || undefined,
    platforms: ["Instagram"],
    creativeFormat: post.format === "unknown" ? undefined : post.format,
    mediaSummary: mediaSummary(post) || undefined,
    focus: focus || undefined,
  }
}

export async function analyzeInstagramPosts(
  posts: readonly InstagramPostWithMedia[],
  opts: AnalyzeAdCreativesOptions & { readonly focus?: string },
): Promise<{ posts: InstagramPostAnalyzed[]; stats: AdCreativeAnalysisStats }> {
  const { results, stats } = await analyzeAdCreatives(
    posts.map((post) => instagramPostToCreativeItem(post, opts.focus)),
    { ...opts, systemPrompt: POST_CONTENT_ANALYSIS_SYSTEM_PROMPT },
  )
  return {
    posts: posts.map((post) => {
      const r = results.get(post.postId)
      return { ...post, analysis: r?.analysis ?? null, ...(r?.reason ? { analysisSkipped: r.reason } : {}) }
    }),
    stats,
  }
}
