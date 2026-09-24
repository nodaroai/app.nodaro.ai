import {
  applyWebScrapeFailure,
  applyWebScrapeResult,
  webScrapeResultCount,
  type WebScrapeCardState,
  type WebScrapeOutcome,
} from "./web-scrape-run-state"
import {
  META_ADS_FORMATS,
  clampInstagramFeaturedIndex,
  classifyCreativeFormat,
  splitInstagramTargets,
  type MetaAdsCreativeFormat,
} from "@nodaro/shared"
import type { InstagramScrapeNodeData } from "@/types/nodes"
import { metaAdsFormatLabelKey } from "./meta-ads-scrape-run-state"
import { formatDate } from "@/lib/i18n/format"

/** The Instagram node reuses the Web Scrape #765 run-state machine. */
export type InstagramScrapeCardState = WebScrapeCardState

export function instagramScrapeItems(json: unknown): ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(json) ? json.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : []
}

const urls = (v: unknown): string[] => (Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && u.trim().length > 0) : [])

/** "@owner — first words of the caption" for the card peek. */
export function instagramPeekLine(item: Record<string, unknown>, noCaption = "(no caption)"): string {
  const owner = typeof item.ownerUsername === "string" && item.ownerUsername ? `@${item.ownerUsername}` : ""
  const caption = typeof item.caption === "string" ? item.caption.replace(/\s+/g, " ").trim() : ""
  const head = caption ? caption.slice(0, 80) : ""
  return [owner, head || (owner ? "" : noCaption)].filter(Boolean).join(" — ")
}

export function instagramOwner(item: Record<string, unknown>): string {
  return typeof item.ownerUsername === "string" ? item.ownerUsername : ""
}
export function instagramInitial(item: Record<string, unknown>): string {
  const o = instagramOwner(item).trim()
  return o ? o.charAt(0).toUpperCase() : "?"
}
export function instagramCaption(item: Record<string, unknown>): string {
  return typeof item.caption === "string" ? item.caption : ""
}
export function instagramLink(item: Record<string, unknown>): string | null {
  const u = typeof item.url === "string" ? item.url : ""
  return /^https?:\/\//i.test(u) ? u : null
}
/** The card thumbnail — first image / video cover. */
export function instagramPreviewUrl(item: Record<string, unknown>): string | null {
  return urls(item.images)[0] ?? urls(item.videoPreviews)[0] ?? null
}
export function instagramVideoUrl(item: Record<string, unknown>): string | null {
  return urls(item.videos)[0] ?? null
}
export function instagramMediaCounts(item: Record<string, unknown>): { readonly images: number; readonly videos: number } {
  return { images: urls(item.images).length, videos: urls(item.videos).length }
}
export function instagramStat(item: Record<string, unknown>, key: "likesCount" | "commentsCount"): number | null {
  return typeof item[key] === "number" ? (item[key] as number) : null
}
export function instagramTimestampLabel(item: Record<string, unknown>): string {
  const t = typeof item.timestamp === "string" ? Date.parse(item.timestamp) : NaN
  return Number.isNaN(t) ? "" : formatDate(t, { month: "short", day: "numeric" })
}

export function clampFeaturedIndex(stored: unknown, count: number): number {
  return clampInstagramFeaturedIndex(stored, count)
}

/** The primary creative's format for a post (already stored on `format` by the backend media step). */
export function instagramFormat(item: Record<string, unknown>): MetaAdsCreativeFormat {
  if (item.format === "vertical" || item.format === "square" || item.format === "horizontal") return item.format
  if (typeof item.dimsWidth === "number" && typeof item.dimsHeight === "number") return classifyCreativeFormat(item.dimsWidth, item.dimsHeight)
  return "unknown"
}
export function instagramVisibleIndexes(items: ReadonlyArray<Record<string, unknown>>, viewFormat: unknown): number[] {
  const want = typeof viewFormat === "string" && (META_ADS_FORMATS as readonly string[]).includes(viewFormat) ? viewFormat : null
  return items.map((_, i) => i).filter((i) => want === null || instagramFormat(items[i]) === want)
}
export { metaAdsFormatLabelKey as instagramFormatLabelKey }

export interface InstagramStoredCreative {
  readonly kind: "image" | "video"
  readonly url: string
  readonly assetId: string
}
export function instagramStoredCreatives(item: Record<string, unknown>): InstagramStoredCreative[] {
  if (!Array.isArray(item.creatives)) return []
  return item.creatives.flatMap((c) => {
    if (!c || typeof c !== "object") return []
    const r = c as Record<string, unknown>
    if (r.stored !== true || typeof r.assetId !== "string" || typeof r.url !== "string") return []
    return [{ kind: r.kind === "video" ? "video" : "image", url: r.url, assetId: r.assetId }]
  })
}

export function instagramActiveCount(items: ReadonlyArray<Record<string, unknown>>): number {
  return items.length
}

/** Fingerprint of every field that changes what a run would fetch. */
export function instagramScrapeFingerprint(d: InstagramScrapeNodeData): string {
  return JSON.stringify([
    d.mode ?? "profile",
    splitInstagramTargets(d.targets).sort(),
    d.count ?? null,
    d.period ?? "",
    Array.isArray(d.formats) ? [...d.formats].sort() : [],
    d.ingestAllVideos === true,
    d.analyze === true,
    d.analyze === true ? (d.analysisModel ?? "") : "",
    d.analyze === true ? (d.analysisFocus ?? "") : "",
  ])
}

export function instagramScrapeRunStartPatch(d: InstagramScrapeNodeData): Record<string, unknown> {
  return {
    executionStatus: "running",
    lastRunStartedAt: Date.now(),
    lastRunFingerprint: instagramScrapeFingerprint(d),
    errorMessage: undefined,
  }
}

export function applyInstagramScrapeResult(json: unknown): Record<string, unknown> {
  const patch = applyWebScrapeResult(json)
  return patch.lastRunOutcome === "success" ? { ...patch, featuredIndex: 0, viewFormat: "all" } : patch
}
export const applyInstagramScrapeFailure = applyWebScrapeFailure

export function deriveInstagramScrapeCardState(d: InstagramScrapeNodeData): InstagramScrapeCardState {
  if (d.executionStatus === "running") {
    return { kind: "running", startedAt: d.lastRunStartedAt as number | undefined }
  }
  const outcome = d.lastRunOutcome as WebScrapeOutcome | undefined
  if (!outcome) {
    if (d.generatedJson !== undefined) {
      const count = webScrapeResultCount(d.generatedJson)
      return { kind: count > 0 ? "success" : "empty", count, stale: false }
    }
    return { kind: "never-ran" }
  }
  const stale = d.lastRunFingerprint !== undefined && d.lastRunFingerprint !== instagramScrapeFingerprint(d)
  if (outcome === "failed") {
    const keptCount = (d.lastGoodCount as number | undefined) ?? webScrapeResultCount(d.generatedJson)
    return {
      kind: "failed",
      count: 0,
      stale,
      errorMessage: (d.errorMessage as string | undefined) ?? "Scrape failed",
      at: d.lastRunAt as number | undefined,
      ...(keptCount > 0 ? { kept: { count: keptCount, at: d.lastGoodAt as number | undefined } } : {}),
    }
  }
  if (outcome === "empty") {
    return { kind: "empty", count: 0, stale, at: d.lastRunAt as number | undefined }
  }
  return {
    kind: "success",
    count: (d.lastRunCount as number | undefined) ?? webScrapeResultCount(d.generatedJson),
    stale,
    at: d.lastRunAt as number | undefined,
  }
}
