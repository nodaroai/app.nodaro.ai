export const SCRAPER_ACTOR_IDS = [
  "content-crawler",
  "google-search",
  "instagram",
  "tiktok",
  "rss",
] as const

export type ScraperActorId = (typeof SCRAPER_ACTOR_IDS)[number]

export const SCRAPER_ACTOR_LABELS: Record<ScraperActorId, string> = {
  "content-crawler": "Website Content (Markdown)",
  "google-search":   "Google Search",
  "instagram":       "Instagram",
  "tiktok":          "TikTok",
  "rss":             "RSS Feed",
}

/** Credit costs per composite SKU — must stay in sync with STATIC_CREDIT_COSTS in backend. */
export const SCRAPER_CREDIT_COSTS: Record<string, number> = {
  "web-scrape": 5,
  "web-scrape:google-search": 2,
  "web-scrape:content-crawler": 3,
  "web-scrape:content-crawler:site": 10,
  "web-scrape:instagram": 5,
  "web-scrape:tiktok": 5,
  "web-scrape:rss": 1,
}

export function isScraperActor(value: unknown): value is ScraperActorId {
  return typeof value === "string" && (SCRAPER_ACTOR_IDS as readonly string[]).includes(value)
}

export interface ScraperCreditInput {
  actor: ScraperActorId
  mode?: "page" | "site"
}

export function buildScraperCreditId(input: ScraperCreditInput): string {
  if (input.actor === "content-crawler") {
    const mode = input.mode ?? "page"
    return mode === "site" ? "web-scrape:content-crawler:site" : "web-scrape:content-crawler"
  }
  return `web-scrape:${input.actor}`
}

/**
 * Resolve the credit identifier from an unvalidated request body.
 * Falls back to the cheapest SKU (google-search) on missing/invalid actor
 * so misrouted requests don't accidentally reserve the max-cost tier.
 */
export function resolveScraperCreditId(body: unknown): string {
  const raw = body as { actor?: unknown; mode?: unknown } | undefined
  if (!raw || !isScraperActor(raw.actor)) return "web-scrape:google-search"
  const mode = raw.mode === "site" ? "site" : "page"
  return buildScraperCreditId({ actor: raw.actor, mode })
}
