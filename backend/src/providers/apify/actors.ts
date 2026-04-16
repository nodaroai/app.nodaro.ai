import type { ScraperActorId } from "../../../../packages/shared/src/scraper-actors.js"

export interface ActorDefinition {
  apifyActorId: string
  timeoutSecs: number
}

export const ACTORS: Record<ScraperActorId, ActorDefinition> = {
  "content-crawler": { apifyActorId: "apify/website-content-crawler", timeoutSecs: 600 },
  "google-search":   { apifyActorId: "apify/google-search-scraper",   timeoutSecs: 180 },
  "instagram":       { apifyActorId: "apify/instagram-scraper",       timeoutSecs: 300 },
  "tiktok":          { apifyActorId: "clockworks/tiktok-scraper",     timeoutSecs: 300 },
}

export type ContentCrawlerArgs = {
  actor: "content-crawler"
  url: string
  mode?: "page" | "site"
}
export type GoogleSearchArgs = {
  actor: "google-search"
  query: string
  maxResults?: number
  countryCode?: string
}
export type InstagramArgs = {
  actor: "instagram"
  target: string
  resultsLimit?: number
}
export type TikTokArgs = {
  actor: "tiktok"
  target: string
  resultsLimit?: number
}
export type ActorArgs =
  | ContentCrawlerArgs
  | GoogleSearchArgs
  | InstagramArgs
  | TikTokArgs

export function buildActorInput(args: ActorArgs): Record<string, unknown> {
  switch (args.actor) {
    case "content-crawler": {
      const mode = args.mode ?? "page"
      return {
        startUrls: [{ url: args.url }],
        maxCrawlPages: mode === "site" ? 20 : 1,
        maxCrawlDepth: mode === "site" ? 3 : 0,
        crawlerType: "playwright:chrome",
        saveMarkdown: true,
      }
    }
    case "google-search":
      return {
        queries: args.query,
        resultsPerPage: Math.min(Math.max(args.maxResults ?? 10, 1), 10),
        maxPagesPerQuery: 1,
        countryCode: args.countryCode ?? "us",
      }
    case "instagram":
      return {
        directUrls: [args.target],
        resultsLimit: Math.min(Math.max(args.resultsLimit ?? 10, 1), 20),
        resultsType: "posts",
      }
    case "tiktok":
      return {
        postURLs: [args.target],
        resultsPerPage: Math.min(Math.max(args.resultsLimit ?? 10, 1), 20),
      }
  }
}

export interface ActorOutput {
  json: unknown
}

export function extractActorOutput(
  actor: ScraperActorId,
  items: Record<string, unknown>[],
): ActorOutput {
  if (actor === "content-crawler") {
    const pages = items.map((it) => ({
      url: (it.url as string) ?? "",
      markdown: (it.markdown as string) ?? (it.text as string) ?? "",
    }))
    return { json: { pages } }
  }

  if (actor === "google-search") {
    const flat: Array<{ title: string; url: string; description: string }> = []
    for (const it of items) {
      const organic = (it.organicResults as Array<Record<string, unknown>>) ?? []
      for (const r of organic) {
        flat.push({
          title: (r.title as string) ?? "",
          url: (r.url as string) ?? "",
          description: (r.description as string) ?? "",
        })
      }
    }
    return { json: flat }
  }

  if (actor === "instagram") {
    // Project to the fields consumers actually need. Raw Apify posts can be
    // tens of KB each (nested comments, likes, hashtag objects) — keeping the
    // output trim avoids bloating jobs.output_data.
    const projected = items.map((it) => {
      // For Sidecar (carousel) posts, extract child media URLs
      const rawChildren = it.childPosts as Array<Record<string, unknown>> | undefined
      const childPosts = rawChildren?.map((c) => ({
        type: c.type,
        displayUrl: c.displayUrl,
        videoUrl: c.videoUrl,
      }))
      return {
        url: it.url,
        type: it.type,
        shortCode: it.shortCode,
        caption: it.caption,
        displayUrl: it.displayUrl,
        videoUrl: it.videoUrl,
        timestamp: it.timestamp,
        likesCount: it.likesCount,
        commentsCount: it.commentsCount,
        ownerUsername: it.ownerUsername,
        ...(childPosts ? { childPosts } : {}),
      }
    })
    return { json: projected }
  }

  // tiktok
  const projected = items.map((it) => ({
    id: it.id,
    webVideoUrl: it.webVideoUrl,
    videoUrl: it.videoUrl,
    text: it.text,
    createTime: it.createTime,
    diggCount: it.diggCount,
    shareCount: it.shareCount,
    playCount: it.playCount,
    commentCount: it.commentCount,
    authorMeta: it.authorMeta,
    musicMeta: it.musicMeta,
  }))
  return { json: projected }
}
