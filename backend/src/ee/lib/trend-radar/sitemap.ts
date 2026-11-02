/**
 * Reading a template site's public sitemap: which pages it lists, with their
 * last change, and the trend name a page's slug spells.
 *
 * Pure: the fetch is the caller's (`run.ts`, through `safeFetch`). A sitemap
 * index (`<sitemapindex>`) lists other sitemaps; the caller follows those.
 */

export interface SitemapEntry {
  url: string
  /** ISO 8601, as the sitemap states it; `null` when it states none. */
  lastmod: string | null
}

export interface ParsedSitemap {
  /** The page entries of a `<urlset>`. */
  urls: SitemapEntry[]
  /** The child sitemaps of a `<sitemapindex>`. */
  sitemaps: string[]
}

const LOC = /<loc>\s*([^<]+?)\s*<\/loc>/i
const LASTMOD = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

function entriesOf(xml: string, tag: "url" | "sitemap"): SitemapEntry[] {
  const out: SitemapEntry[] = []
  const block = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi")
  for (const m of xml.matchAll(block)) {
    const body = m[1] ?? ""
    const loc = LOC.exec(body)?.[1]
    if (!loc) continue
    const url = decodeXml(loc.trim())
    if (!/^https?:\/\//i.test(url)) continue
    const lastmod = LASTMOD.exec(body)?.[1]?.trim() ?? null
    out.push({ url, lastmod: lastmod && !Number.isNaN(Date.parse(lastmod)) ? lastmod : null })
  }
  return out
}

/** The entries of one sitemap document; a document that is neither kind is empty. */
export function parseSitemap(xml: string): ParsedSitemap {
  return {
    urls: entriesOf(xml, "url"),
    sitemaps: entriesOf(xml, "sitemap").map((e) => e.url),
  }
}

/**
 * The path segments a template page's URL usually sits under. A page under
 * none of them (a blog post, a help article, the home page) is not a trend.
 */
const TEMPLATE_SEGMENTS = new Set(["templates", "template", "trends", "trend", "explore", "effects", "effect", "ai-video", "video-templates"])

/** The slug of a template page, or `null` when the URL is not one. */
export function templateSlugOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const segments = parsed.pathname.split("/").filter(Boolean)
  if (segments.length < 2) return null
  // The slug is the last segment; the one before it names the section.
  const section = segments[segments.length - 2]!.toLowerCase()
  const slug = segments[segments.length - 1]!.toLowerCase()
  if (!TEMPLATE_SEGMENTS.has(section)) return null
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null
  return slug
}

/** Words a slug carries that are not part of the trend's name. */
const SLUG_NOISE = new Set(["ai", "trend", "trends", "template", "templates", "video", "videos", "effect", "effects", "tiktok", "reel", "reels", "short", "shorts", "generator", "filter", "meme", "viral"])

/**
 * The trend name a slug spells: `phone-on-train-ai-trend` → `phone on train`.
 * Noise words are dropped from the ends only, so `ai-dog-bartender` keeps
 * "dog bartender" and a name that is all noise is `null`.
 */
export function nameOfSlug(slug: string): string | null {
  const words = slug.split("-").filter(Boolean)
  let start = 0
  let end = words.length
  while (start < end && SLUG_NOISE.has(words[start]!)) start++
  while (end > start && SLUG_NOISE.has(words[end - 1]!)) end--
  const kept = words.slice(start, end)
  if (kept.length === 0) return null
  return kept.join(" ")
}

/** The candidate slug of a name: lower case, words joined by `-`. */
export function slugOfName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .join("-")
}

/**
 * The template pages of a sitemap read that were not seen before, newest
 * first by `lastmod`. `seen` is what earlier reads listed (slugs).
 */
export function newTemplatePages(entries: SitemapEntry[], seen: ReadonlySet<string>): Array<{ slug: string; name: string; url: string; lastmod: string | null }> {
  const out: Array<{ slug: string; name: string; url: string; lastmod: string | null }> = []
  const taken = new Set<string>()
  for (const e of entries) {
    const slug = templateSlugOf(e.url)
    if (!slug || seen.has(slug) || taken.has(slug)) continue
    const name = nameOfSlug(slug)
    if (!name) continue
    taken.add(slug)
    out.push({ slug, name, url: e.url, lastmod: e.lastmod })
  }
  return out.sort((a, b) => (Date.parse(b.lastmod ?? "") || 0) - (Date.parse(a.lastmod ?? "") || 0))
}
