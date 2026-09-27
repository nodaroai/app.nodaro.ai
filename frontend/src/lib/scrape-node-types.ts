/**
 * The scraper nodes. Each takes queries or URLs on its `in` input and emits
 * its results as a JSON array on `json` (the social scrapers add the featured
 * item's text / image / video on typed pips).
 *
 * ONE list, spread into every set that carries scraped JSON — the prompt
 * producers, the list / JSON producers, the typed-source candidates and the
 * scraper-input validator. Instagram was added to none of them and its JSON
 * could not be wired to Prompt, Extract Field or List; a new scraper joins
 * them all here. Leaf module: no imports, so every handle module can use it.
 */
export const SCRAPE_NODE_TYPES = ["web-scrape", "meta-ads-scrape", "instagram-scrape"] as const

export type ScrapeNodeType = (typeof SCRAPE_NODE_TYPES)[number]

const SCRAPE_NODE_TYPE_SET: ReadonlySet<string> = new Set(SCRAPE_NODE_TYPES)

export function isScrapeNodeType(type: string | undefined | null): type is ScrapeNodeType {
  return SCRAPE_NODE_TYPE_SET.has(type ?? "")
}
