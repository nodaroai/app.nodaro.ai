import type { ScraperActorId } from "@nodaro/shared"
import type { WebScrapeNodeData } from "@/types/nodes"

/**
 * Web Scrape run-state logic (#765) — everything the card and the Results
 * tab derive, as pure functions, so the five states are unit-testable
 * without rendering and the node component stays presentational.
 *
 * The core acceptance this encodes: a FAILED or EMPTY run never silently
 * replaces a good payload — `applyWebScrapeResult` keeps `generatedJson`
 * and records the outcome beside it; changing the inputs marks the result
 * STALE (fingerprint mismatch) rather than deleting anything.
 */

export type WebScrapeOutcome = "success" | "empty" | "failed"

export type WebScrapeCardState =
  | { readonly kind: "never-ran" }
  | { readonly kind: "running"; readonly startedAt?: number }
  | {
      readonly kind: "success" | "empty" | "failed"
      readonly count: number
      readonly at?: number
      readonly stale: boolean
      /** failed only — what the card promises was kept. */
      readonly kept?: { readonly count: number; readonly at?: number }
      readonly errorMessage?: string
    }

/** Result count per actor shape: content-crawler is `{ pages: [...] }` (its
 *  count reads "pages"); every other actor returns a top-level array. */
export function webScrapeResultCount(json: unknown): number {
  if (Array.isArray(json)) return json.length
  if (json && typeof json === "object" && Array.isArray((json as { pages?: unknown }).pages)) {
    return ((json as { pages: unknown[] }).pages).length
  }
  return 0
}

/** The rows the peek + Results list render, normalized across actor shapes. */
export function webScrapeItems(json: unknown): ReadonlyArray<Record<string, unknown>> {
  const list = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { pages?: unknown }).pages)
      ? (json as { pages: unknown[] }).pages
      : []
  return list.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
}

/**
 * One peek shape, five actors: a 14px glyph plus one truncated line. The
 * glyph is the only per-actor variable — a new actor never needs a new
 * layout. Display-only, so it lives here (frontend) rather than in
 * `@nodaro/shared`'s SCRAPER_OUTPUT_FIELDS (the wire-contract field map).
 * Thumbnails were considered and rejected in the issue — a network fetch
 * per item across a canvas of nodes, for two of five actors, at a width
 * where 40px costs more than the caption it illustrates. Keep them out.
 */
export const WEB_SCRAPE_PEEK: Record<
  ScraperActorId,
  {
    readonly field: string
    /** The item's own address — what a row links to (#779). One map, so a
     *  new actor declares its link beside its peek field, never in a second
     *  hand-kept table. */
    readonly linkField: string
    /** "index" renders 1./2./3.; otherwise the glyph for the item. */
    readonly glyph: (item: Record<string, unknown>, index: number) => string
    /** What the count noun is — "results" for all but content-crawler. */
    readonly countNoun: string
  }
> = {
  "google-search": { field: "title", linkField: "url", glyph: (_i, idx) => `${idx + 1}.`, countNoun: "results" },
  rss: { field: "title", linkField: "url", glyph: (_i, idx) => `${idx + 1}.`, countNoun: "results" },
  "content-crawler": { field: "url", linkField: "url", glyph: () => "◫", countNoun: "pages" },
  instagram: {
    field: "caption",
    linkField: "url", // the post permalink
    glyph: (item) => (item.type === "Video" || item.videoUrl ? "▶" : "▣"),
    countNoun: "results",
  },
  tiktok: {
    field: "text",
    linkField: "webVideoUrl",
    glyph: (item) => (item.videoUrl || item.webVideoUrl ? "▶" : "▣"),
    countNoun: "results",
  },
}

/** One truncated peek line for an item, from the actor's peek field. */
export function webScrapePeekLine(actor: ScraperActorId, item: Record<string, unknown>): string {
  const raw = item[WEB_SCRAPE_PEEK[actor].field]
  return typeof raw === "string" && raw.trim() ? raw.trim() : "(untitled)"
}

/**
 * The item's link, or null when it has none worth following. Scraped URLs are
 * untrusted input: only `http:` / `https:` ever become an anchor — a
 * `javascript:` or `data:` value from a hostile feed renders as text (#779).
 */
export function webScrapeItemLink(actor: ScraperActorId, item: Record<string, unknown>): string | null {
  const raw = item[WEB_SCRAPE_PEEK[actor].linkField]
  if (typeof raw !== "string") return null
  const value = raw.trim()
  try {
    const u = new URL(value)
    return u.protocol === "http:" || u.protocol === "https:" ? value : null
  } catch {
    return null
  }
}

/**
 * Fingerprint of every field that changes what a run would fetch. Stored at
 * run time; a mismatch at render time = the STALE state. Deliberately NOT a
 * store subscription — pure derivation on render.
 */
export function webScrapeFingerprint(d: WebScrapeNodeData): string {
  return JSON.stringify([
    d.actor ?? "google-search",
    d.query ?? "",
    d.url ?? "",
    d.mode ?? "",
    d.target ?? "",
    d.maxResults ?? null,
    d.countryCode ?? "",
    d.resultsLimit ?? null,
  ])
}

/** The node-data patch for a run START. */
export function webScrapeRunStartPatch(d: WebScrapeNodeData): Record<string, unknown> {
  return {
    executionStatus: "running",
    errorMessage: undefined,
    lastRunStartedAt: Date.now(),
    lastRunFingerprint: webScrapeFingerprint(d),
  }
}

/**
 * The node-data patch for a COMPLETED run. Empty results record the outcome
 * but KEEP the previous good payload (`generatedJson` untouched) — the
 * incident in #765 was an empty rerun silently destroying 20 real results.
 */
export function applyWebScrapeResult(json: unknown): Record<string, unknown> {
  const count = webScrapeResultCount(json)
  const now = Date.now()
  if (count === 0) {
    return {
      executionStatus: "completed",
      lastRunOutcome: "empty" as WebScrapeOutcome,
      lastRunAt: now,
      lastRunCount: 0,
      // generatedJson deliberately absent from the patch — kept as-is.
    }
  }
  return {
    executionStatus: "completed",
    lastRunOutcome: "success" as WebScrapeOutcome,
    lastRunAt: now,
    lastRunCount: count,
    generatedJson: json,
    lastGoodAt: now,
    lastGoodCount: count,
  }
}

/** The node-data patch for a FAILED run — payload kept, outcome recorded. */
export function applyWebScrapeFailure(message: string): Record<string, unknown> {
  return {
    executionStatus: "failed",
    lastRunOutcome: "failed" as WebScrapeOutcome,
    lastRunAt: Date.now(),
    errorMessage: message,
    // generatedJson deliberately absent from the patch — kept as-is.
  }
}

/** Derive the card's state from node data — the five states of the spec. */
export function deriveWebScrapeCardState(d: WebScrapeNodeData): WebScrapeCardState {
  if (d.executionStatus === "running") {
    return { kind: "running", startedAt: d.lastRunStartedAt as number | undefined }
  }
  const outcome = d.lastRunOutcome as WebScrapeOutcome | undefined
  if (!outcome) {
    // Back-compat: a pre-#765 node that completed carries generatedJson but
    // no outcome — treat a stored payload as an old success, else never-ran.
    if (d.generatedJson !== undefined) {
      const count = webScrapeResultCount(d.generatedJson)
      return { kind: count > 0 ? "success" : "empty", count, stale: false }
    }
    return { kind: "never-ran" }
  }
  const stale =
    typeof d.lastRunFingerprint === "string" && d.lastRunFingerprint !== webScrapeFingerprint(d)
  if (outcome === "failed") {
    const keptCount = (d.lastGoodCount as number | undefined) ?? webScrapeResultCount(d.generatedJson)
    return {
      kind: "failed",
      count: 0,
      at: d.lastRunAt as number | undefined,
      stale,
      errorMessage: d.errorMessage,
      ...(keptCount > 0
        ? { kept: { count: keptCount, at: d.lastGoodAt as number | undefined } }
        : {}),
    }
  }
  return {
    kind: outcome,
    count: (d.lastRunCount as number | undefined) ?? webScrapeResultCount(d.generatedJson),
    at: d.lastRunAt as number | undefined,
    stale,
  }
}

/** "2m ago" style relative time for the status row. */
export function relativeTime(ts: number | undefined, now: number = Date.now()): string {
  if (!ts) return ""
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** m:ss elapsed for the running state. */
export function elapsedLabel(startedAt: number | undefined, now: number = Date.now()): string {
  if (!startedAt) return "0:00"
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}
