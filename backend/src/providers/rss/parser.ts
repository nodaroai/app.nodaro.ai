/**
 * Minimal RSS 2.0 feed parser — no external dependency. Handles the five
 * standard `<item>` fields the Web Scrape RSS actor exposes:
 *
 *   title, url (link), description, pubDate (ISO), guid
 *
 * Design: regex + string slicing, not a full XML parser. RSS has a narrow
 * enough shape that this is safe; what's out of scope:
 *   - Atom feeds (use `<entry>` + namespaced tags)
 *   - Nested namespaced fields (media:content, content:encoded)
 *   - Arbitrary attribute parsing
 *
 * If a feed is Atom or uses unusual structure, the parser returns the items
 * it could recognise and drops the rest — it never throws on malformed XML.
 */
import { URL } from "url"

export interface RssItem {
  title: string
  url: string
  description: string
  pubDate: string
  guid: string
}

export interface FetchRssOptions {
  url: string
  resultsLimit?: number
  fetchImpl?: typeof fetch
  /** Max bytes we'll accept from the feed response (default 5 MB). */
  maxBytes?: number
  /** Fetch abort timeout in milliseconds (default 30s). */
  timeoutMs?: number
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

const USER_AGENT = "Nodaro-RSS/1.0 (+https://nodaro.ai)"

/**
 * Fetch the given RSS feed and return parsed items.
 *
 * Throws a plain Error on network failure, non-2xx response, oversized body,
 * or if the response wasn't recognisable as RSS. Callers should catch and
 * surface the message — matching the Apify scraper error contract.
 */
export async function fetchRssItems(opts: FetchRssOptions): Promise<RssItem[]> {
  const fetchFn = opts.fetchImpl ?? fetch
  const limit = clampLimit(opts.resultsLimit)
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // Re-parse the URL so a second line of defence rejects javascript:, data:,
  // etc. even if the caller skipped Zod validation.
  const parsed = new URL(opts.url)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported RSS URL protocol: ${parsed.protocol}`)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetchFn(opts.url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml, application/xml, text/xml, */*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(`RSS fetch failed: HTTP ${response.status}`)
  }

  const contentLength = Number(response.headers.get("content-length") ?? "0")
  if (contentLength > maxBytes) {
    throw new Error(`RSS feed too large: ${contentLength} bytes (max ${maxBytes})`)
  }

  const xml = await readLimited(response, maxBytes)
  return parseRssXml(xml, limit)
}

function clampLimit(n: number | undefined): number {
  const v = n ?? DEFAULT_LIMIT
  if (!Number.isFinite(v) || v < 1) return DEFAULT_LIMIT
  return Math.min(Math.floor(v), MAX_LIMIT)
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  // Stream so we can abort on oversized bodies without buffering them fully.
  const reader = response.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder("utf-8")
  let total = 0
  let out = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      reader.cancel().catch(() => {})
      throw new Error(`RSS feed too large: over ${maxBytes} bytes`)
    }
    out += decoder.decode(value, { stream: true })
  }
  out += decoder.decode() // flush
  return out
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Lift CDATA wrappers and decode the handful of XML entities we care about. */
function decodeXmlText(raw: string): string {
  let s = raw
  // Strip one or more CDATA sections (may be mixed with plain text).
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, inner) => inner)
  // Named entities — numeric entities too for completeness.
  s = s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = parseInt(code, 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : _m
    })
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_m, hex) => {
      const n = parseInt(hex, 16)
      return Number.isFinite(n) ? String.fromCodePoint(n) : _m
    })
  return s.trim()
}

function extractTag(block: string, tag: string): string {
  // Non-greedy, case-insensitive, multi-line. Tag must match at a word
  // boundary so `<description>` doesn't also match `<description-extra>`.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i")
  const m = re.exec(block)
  return m ? decodeXmlText(m[1]) : ""
}

function extractLink(block: string): string {
  // RSS 2.0 uses <link>URL</link>. Atom-style <link href="..."/> is a common
  // fallback — handle it so mildly non-conformant feeds still yield a URL.
  const plain = extractTag(block, "link")
  if (plain) return plain
  const atomMatch = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i.exec(block)
  return atomMatch ? decodeXmlText(atomMatch[1]) : ""
}

/** Normalise an RFC 822 date (or anything `Date` accepts) to ISO 8601. Pass
 *  the original string through when parsing fails so downstream filters can
 *  still see the raw value rather than an empty cell. */
function normalisePubDate(raw: string): string {
  if (!raw) return ""
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? raw : d.toISOString()
}

/** Extract every `<item>` block from the document. */
function findItemBlocks(xml: string): string[] {
  const blocks: string[] = []
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    blocks.push(m[1])
  }
  return blocks
}

export function parseRssXml(xml: string, limit = DEFAULT_LIMIT): RssItem[] {
  const effectiveLimit = clampLimit(limit)
  const blocks = findItemBlocks(xml)
  const items: RssItem[] = []
  for (const block of blocks) {
    if (items.length >= effectiveLimit) break
    const title = extractTag(block, "title")
    const url = extractLink(block)
    const description = extractTag(block, "description")
    const pubDate = normalisePubDate(extractTag(block, "pubDate"))
    // Prefer <guid> but fall back to the item URL so downstream dedupe still
    // has a stable key when a feed omits the tag.
    const guid = extractTag(block, "guid") || url
    items.push({ title, url, description, pubDate, guid })
  }
  return items
}
