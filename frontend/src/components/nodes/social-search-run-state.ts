import {
  pickSocialPosts,
  socialPostsDigest,
  socialPostsFrom,
  socialSearchCount,
  socialSearchMode,
  socialSearchPlatform,
  type SocialPost,
} from "@nodaro/shared"
import type { SocialSearchNodeData } from "@/types/nodes"
import {
  applyWebScrapeFailure,
  type WebScrapeCardState,
  type WebScrapeOutcome,
} from "./web-scrape-run-state"

/**
 * Social Search run state — the Web Scrape #765 machine (a failed or empty
 * search never replaces good results; changed inputs mark the result STALE),
 * plus the node's choice: every post found lives on `searchResults`, the posts
 * the node passes on on `generatedJson` (a person's picks, else the first
 * `pickTop`), their digest on `generatedText`.
 */

export type SocialSearchCardState = WebScrapeCardState

export function socialSearchResults(d: Readonly<Record<string, unknown>>): SocialPost[] {
  return socialPostsFrom(d.searchResults)
}

export function socialSearchChosen(d: Readonly<Record<string, unknown>>): SocialPost[] {
  return socialPostsFrom(d.generatedJson)
}

/** Every field that changes what a search fetches. */
export function socialSearchFingerprint(d: SocialSearchNodeData): string {
  const platform = socialSearchPlatform(d.platform)
  return JSON.stringify([
    platform,
    socialSearchMode(platform, d.mode),
    (d.query ?? "").trim(),
    socialSearchCount(d.count),
    d.period ?? "month",
    d.sort ?? "relevance",
    d.region ?? "",
    d.country ?? "",
    d.activeOnly !== false,
    d.subreddit ?? "",
    d.videoKind ?? "all",
  ])
}

export function socialSearchRunStartPatch(d: SocialSearchNodeData): Record<string, unknown> {
  return {
    executionStatus: "running",
    errorMessage: undefined,
    lastRunStartedAt: Date.now(),
    lastRunFingerprint: socialSearchFingerprint(d),
  }
}

/** What the node passes on for these results and picks, and its digest. */
export function socialSearchChoicePatch(
  results: readonly SocialPost[],
  pickedIds: readonly string[] | undefined,
  pickTop: unknown,
): { generatedJson: SocialPost[]; generatedText: string } {
  const chosen = pickSocialPosts(results, pickedIds, pickTop)
  return { generatedJson: chosen, generatedText: socialPostsDigest(chosen) }
}

/**
 * The node-data patch for a COMPLETED search. A new search clears the old
 * picks (their posts are gone from the grid) and passes on the first
 * `pickTop`. An empty search records the outcome and KEEPS the previous
 * results, as every scraper does.
 */
export function applySocialSearchResult(json: unknown, data: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  const posts = socialPostsFrom(json)
  const now = Date.now()
  if (posts.length === 0) {
    return {
      executionStatus: "completed",
      lastRunOutcome: "empty" as WebScrapeOutcome,
      lastRunAt: now,
      lastRunCount: 0,
      searchWarnings: undefined,
    }
  }
  return {
    executionStatus: "completed",
    lastRunOutcome: "success" as WebScrapeOutcome,
    lastRunAt: now,
    lastRunCount: posts.length,
    searchResults: posts,
    pickedIds: undefined,
    ...socialSearchChoicePatch(posts, undefined, data.pickTop),
    lastGoodAt: now,
    lastGoodCount: posts.length,
    // The live run sets this run's notes after the patch; a recovery has none.
    searchWarnings: undefined,
  }
}

export function applySocialSearchFailure(message: string): Record<string, unknown> {
  return { ...applyWebScrapeFailure(message), searchWarnings: undefined }
}

/**
 * The node-data patch for a search a SERVER run finished (Execute All, a
 * schedule): the orchestrator's output carries every post found
 * (`searchResults`) and the ones passed on (`json`). An output without
 * `searchResults` came from the node's own saved data — a skipped node, or
 * one keeping its picks — and changes nothing on the node.
 */
export function socialSearchServerRunPatch(
  data: SocialSearchNodeData,
  output: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (!Array.isArray(output.searchResults)) return {}
  const results = socialPostsFrom(output.searchResults)
  const now = Date.now()
  const fingerprint = socialSearchFingerprint(data)
  if (results.length === 0) {
    return { lastRunOutcome: "empty" as WebScrapeOutcome, lastRunAt: now, lastRunCount: 0, lastRunFingerprint: fingerprint, searchWarnings: undefined }
  }
  const chosen = socialPostsFrom(output.json)
  return {
    lastRunOutcome: "success" as WebScrapeOutcome,
    lastRunAt: now,
    lastRunCount: results.length,
    lastRunFingerprint: fingerprint,
    searchResults: results,
    pickedIds: undefined,
    generatedJson: chosen,
    generatedText: socialPostsDigest(chosen),
    lastGoodAt: now,
    lastGoodCount: results.length,
    searchWarnings: undefined,
  }
}

/** The patch for a person's picks (from the picker): ids in picking order. */
export function applySocialSearchPicks(d: Readonly<Record<string, unknown>>, pickedIds: readonly string[]): Record<string, unknown> {
  const results = socialSearchResults(d)
  const known = new Set(results.map((p) => p.id))
  const ids = pickedIds.filter((id) => known.has(id))
  return { pickedIds: ids.length ? ids : undefined, ...socialSearchChoicePatch(results, ids, d.pickTop) }
}

/** The patch when "how many to pass on" changes: re-derive the choice. */
export function applySocialSearchPickTop(d: Readonly<Record<string, unknown>>, pickTop: number): Record<string, unknown> {
  const results = socialSearchResults(d)
  const ids = Array.isArray(d.pickedIds) ? (d.pickedIds as string[]) : undefined
  return { pickTop, ...(results.length ? socialSearchChoicePatch(results, ids, pickTop) : {}) }
}

export function deriveSocialSearchCardState(d: SocialSearchNodeData): SocialSearchCardState {
  if (d.executionStatus === "running") {
    return { kind: "running", startedAt: d.lastRunStartedAt }
  }
  const results = socialSearchResults(d)
  const outcome = d.lastRunOutcome
  if (!outcome) return results.length > 0 ? { kind: "success", count: results.length, stale: false } : { kind: "never-ran" }
  const stale = typeof d.lastRunFingerprint === "string" && d.lastRunFingerprint !== socialSearchFingerprint(d)
  if (outcome === "failed") {
    return {
      kind: "failed",
      count: 0,
      at: d.lastRunAt,
      stale,
      errorMessage: d.errorMessage,
      ...(results.length > 0 ? { kept: { count: results.length, at: d.lastGoodAt } } : {}),
    }
  }
  if (outcome === "empty") return { kind: "empty", count: 0, stale, at: d.lastRunAt }
  return { kind: "success", count: d.lastRunCount ?? results.length, stale, at: d.lastRunAt }
}
