import sharp from "sharp"
import { classifyCreativeFormat, type MetaAdsCreativeFormat, type MetaAdsFormat } from "@nodaro/shared/social"
import { safeFetch } from "./safe-fetch.js"
import { deadlinePool } from "./deadline-pool.js"
import { readBodyCapped, storeImportedImageBuffer } from "./media-import.js"
import { isStorageConfigured, isStorageLimitError, uploadToR2 } from "./storage.js"
import { supabase } from "./supabase.js"

/**
 * Node-agnostic scraped-media step, shared by every scraper node (Meta Ads,
 * Instagram, and the LinkedIn / TikTok nodes to come). Classify each item's
 * creatives by format, optionally filter the items by format, and — when the
 * install has storage — copy the creatives into the user's library so a
 * node's outputs outlive the source CDN's signed, short-lived urls.
 *
 * Contract, in order of importance:
 *   1. NEVER fail a scrape the user already paid for. Every step degrades to
 *      "keep the external url" — a failed fetch, an undecodable image, a full
 *      quota, a missing R2 config, or simply running out of time.
 *   2. Stay inside the route's request budget: everything runs under a
 *      deadline with per-item timeouts and bounded parallelism.
 *   3. One classifier (`classifyCreativeFormat`, packages/shared) for the node
 *      setting, the Results chips and the card.
 *
 * Library policy: rows are quota-accounted assets (`upload_source:
 * url_import`, the caller's `source`, `job_id` set) with `in_library: false` —
 * a scheduled scrape must not flood the media picker. The Results tab's
 * explicit "save" flips `in_library` on.
 */

export interface ScrapedCreative {
  readonly kind: "image" | "video"
  /** The url downstream consumers get — ours once stored, else the source. */
  readonly url: string
  readonly sourceUrl: string
  /** Video only: poster frame (ours once stored). */
  readonly posterUrl: string | null
  readonly width: number | null
  readonly height: number | null
  readonly format: MetaAdsCreativeFormat
  /** The library row for `url` once stored; for a video whose POSTER alone was copied, the poster's row (and `stored` stays false). */
  readonly assetId: string | null
  /** True when `url` itself points at the user's library. */
  readonly stored: boolean
}

/** One scraped item's media before storage — a node adapter maps its own shape onto this. */
export interface ScrapedMediaItem {
  readonly id: string
  readonly images: readonly string[]
  readonly videos: readonly { readonly url: string; readonly poster?: string | null }[]
  /**
   * Pixel dims the SOURCE already reports (Instagram posts do), keyed by the
   * creative's classify url (a video's poster, else the image url). Lets the
   * classify + format-filter pass skip the probe fetch — the store pass still
   * fetches the kept creatives' bytes.
   */
  readonly knownDims?: Readonly<Record<string, { width: number; height: number }>>
  /** Written to the asset row's `source_detail` (advertiser / owner / handle). */
  readonly sourceDetail?: string
}

export interface ScrapedItemMedia {
  /** The primary creative's format — first video (via its poster), else first image. */
  readonly format: MetaAdsCreativeFormat
  readonly creatives: ScrapedCreative[]
}

export type ScrapedMediaSkipReason = "not_configured" | "storage_limit_exceeded" | "deadline"

export interface ScrapedMediaStats {
  readonly classified: number
  readonly stored: number
  /** Of `stored`, how many were VIDEO bytes (the expensive ones) — the rest are images + posters. */
  readonly videosStored: number
  readonly kept: number
  readonly filteredOut: number
  readonly skipReason?: ScrapedMediaSkipReason
}

export interface ScrapedMediaOptions {
  readonly userId: string
  readonly jobId: string
  /** Epoch ms after which no new fetch/upload starts (existing ones finish). */
  readonly deadlineAt: number
  /** Copy creatives into the user's library (false on a cloud relay: the cloud already stored them). */
  readonly storeImages: boolean
  /** Copy the featured item's video too (its index into the KEPT list) — only when its video output is wired. */
  readonly storeFeaturedVideoIndex?: number
  /** Copy EVERY kept item's first video (the expensive bytes) — the "copy all videos" node setting. */
  readonly storeAllVideos?: boolean
  /** Keep only items whose primary creative has one of these formats; empty / undefined = keep all. */
  readonly formats?: readonly MetaAdsFormat[]
  /** The asset row's `source` column (e.g. "meta-ads", "instagram"). */
  readonly source: string
  /** R2 key / filename prefix for stored creatives (e.g. "meta-ad", "ig-post"). */
  readonly filePrefix: string
  readonly concurrency?: number
  readonly now?: () => number
}

/** Images are fetched for classification anyway; keep the cap well under the import route's 20 MB. */
const CREATIVE_MAX_BYTES = 8 * 1024 * 1024
const FETCH_TIMEOUT_MS = 8_000
const DEFAULT_CONCURRENCY = 6

type Probe = { readonly buffer: Buffer; readonly width: number | null; readonly height: number | null }

async function fetchAndProbe(url: string): Promise<Probe | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: FETCH_TIMEOUT_MS })
    if (!res.ok) return null
    const buffer = await readBodyCapped(res, CREATIVE_MAX_BYTES)
    if (!buffer) return null
    try {
      const meta = await sharp(buffer).metadata()
      return { buffer, width: meta.width ?? null, height: meta.height ?? null }
    } catch {
      return { buffer, width: null, height: null }
    }
  } catch {
    return null
  }
}

interface Slot {
  readonly itemIndex: number
  readonly creativeIndex: number
  /** The url whose pixels decide the format (the poster for a video). */
  readonly probeUrl: string
}

function initialCreatives(item: ScrapedMediaItem): ScrapedCreative[] {
  const videos = item.videos.map((v) => ({
    kind: "video" as const,
    url: v.url,
    sourceUrl: v.url,
    posterUrl: v.poster ?? null,
    width: null,
    height: null,
    format: "unknown" as const,
    assetId: null,
    stored: false,
  }))
  const images = item.images.map((url) => ({
    kind: "image" as const,
    url,
    sourceUrl: url,
    posterUrl: null,
    width: null,
    height: null,
    format: "unknown" as const,
    assetId: null,
    stored: false,
  }))
  return [...videos, ...images]
}

function primaryFormat(creatives: readonly ScrapedCreative[]): MetaAdsCreativeFormat {
  return creatives[0]?.format ?? "unknown"
}

/** The classify url for a creative — the poster for a video, the image url otherwise. */
function classifyUrl(c: ScrapedCreative): string | null {
  return c.kind === "video" ? c.posterUrl : c.url
}

/** The fallback when the media step itself throws: items as scraped, formats unknown, nothing stored. */
export function scrapedItemsWithoutMedia(items: readonly ScrapedMediaItem[]): ScrapedItemMedia[] {
  return items.map((item) => ({ format: "unknown" as const, creatives: initialCreatives(item) }))
}

/**
 * Classify → filter → store. Returns per-item `format` + `creatives` (durable
 * urls swapped in when stored), aligned to the KEPT items in order, plus
 * honest stats for the caller / the UI.
 */
export async function classifyAndStoreScrapedMedia(
  items: readonly ScrapedMediaItem[],
  opts: ScrapedMediaOptions,
): Promise<{ items: ScrapedItemMedia[]; keptIndexes: number[]; stats: ScrapedMediaStats }> {
  const now = opts.now ?? Date.now
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY
  const creativesByItem: ScrapedCreative[][] = items.map(initialCreatives)
  const probes = new Map<string, Probe | null>()
  const safePrefix = opts.filePrefix.replace(/[^a-zA-Z0-9_-]/g, "") || "media"

  // ── 1. Classify: known dims skip the fetch; otherwise one fetch per creative ──
  const slots: Slot[] = []
  for (const [itemIndex, creatives] of creativesByItem.entries()) {
    for (const [creativeIndex, c] of creatives.entries()) {
      const url = classifyUrl(c)
      if (url) slots.push({ itemIndex, creativeIndex, probeUrl: url })
    }
  }
  let classified = 0
  const classifyHitDeadline = await deadlinePool(slots, concurrency, opts.deadlineAt, now, async (slot) => {
    const item = items[slot.itemIndex]
    const known = item.knownDims?.[slot.probeUrl]
    let width: number | null
    let height: number | null
    if (known && known.width > 0 && known.height > 0) {
      // The source already told us the pixels — no fetch needed to classify.
      width = known.width
      height = known.height
    } else {
      if (!probes.has(slot.probeUrl)) probes.set(slot.probeUrl, await fetchAndProbe(slot.probeUrl))
      const probe = probes.get(slot.probeUrl)
      width = probe?.width ?? null
      height = probe?.height ?? null
    }
    if (width) classified += 1
    const c = creativesByItem[slot.itemIndex][slot.creativeIndex]
    creativesByItem[slot.itemIndex][slot.creativeIndex] = { ...c, width, height, format: classifyCreativeFormat(width, height) }
  })

  // ── 2. Filter by format (node setting) ──
  const wanted = new Set<string>(opts.formats ?? [])
  const keptIndexes = items
    .map((_, i) => i)
    .filter((i) => wanted.size === 0 || wanted.has(primaryFormat(creativesByItem[i])))

  // ── 3. Store creatives of the KEPT items (images + posters; asked-for videos) ──
  let stored = 0
  let videosStored = 0
  let skipReason: ScrapedMediaSkipReason | undefined = classifyHitDeadline ? "deadline" : undefined
  const canStore = opts.storeImages && isStorageConfigured()
  if (opts.storeImages && !isStorageConfigured()) skipReason = "not_configured"

  if (canStore) {
    let quotaExceeded = false
    const targets = keptIndexes.flatMap((itemIndex) =>
      creativesByItem[itemIndex].map((_, creativeIndex) => ({ itemIndex, creativeIndex })),
    )
    const storeHitDeadline = await deadlinePool(targets, Math.min(concurrency, 4), opts.deadlineAt, now, async ({ itemIndex, creativeIndex }) => {
      if (quotaExceeded) return
      const c = creativesByItem[itemIndex][creativeIndex]
      const url = classifyUrl(c)
      if (!url) return
      // Reuse the classify buffer when we fetched one; otherwise (known dims,
      // which never touched the probe map) fetch the bytes now — storing needs
      // them either way. A URL already probed AND failed is cached as `null`;
      // `has()` (not `?? undefined`, which conflates null with "absent")
      // distinguishes it so a dead CDN url is skipped, not re-fetched.
      let probe = probes.get(url) ?? undefined
      if (!probe && !probes.has(url)) {
        probe = (await fetchAndProbe(url)) ?? undefined
        probes.set(url, probe ?? null)
      }
      if (!probe) return
      const item = items[itemIndex]
      const result = await storeImportedImageBuffer({
        userId: opts.userId,
        body: probe.buffer,
        uploadSource: "url_import",
        sourceUrl: url,
        filename: `${safePrefix}-${item.id}-${creativeIndex}${c.kind === "video" ? "-poster" : ""}`,
        source: opts.source,
        sourceDetail: item.sourceDetail || undefined,
        inLibrary: false,
        jobId: opts.jobId,
      }).catch(() => null)
      if (!result) return
      if (!result.ok) {
        if (result.code === "storage_limit_exceeded") quotaExceeded = true
        return
      }
      stored += 1
      creativesByItem[itemIndex][creativeIndex] = c.kind === "video"
        ? { ...c, posterUrl: result.url, assetId: result.assetId, stored: c.stored }
        : { ...c, url: result.url, assetId: result.assetId, stored: true }
    })
    if (quotaExceeded) skipReason = "storage_limit_exceeded"
    else if (storeHitDeadline) skipReason = "deadline"

    // The asked-for videos (featured when wired, and/or all when "copy all
    // videos" is on) — the first video creative per item. Bounded at 2 (large
    // downloads), deadline-aware; a quota refusal stops the rest rather than
    // hammering N failed uploads. Deduped: the featured item is not copied
    // twice when "copy all" is also on.
    const videoTargetSet = new Set<number>()
    if (opts.storeAllVideos) for (const itemIndex of keptIndexes) videoTargetSet.add(itemIndex)
    if (opts.storeFeaturedVideoIndex !== undefined) {
      const itemIndex = keptIndexes[opts.storeFeaturedVideoIndex]
      if (itemIndex !== undefined) videoTargetSet.add(itemIndex)
    }
    const videoTargets = [...videoTargetSet]
    if (videoTargets.length > 0 && !quotaExceeded) {
      const videoHitDeadline = await deadlinePool(videoTargets, 2, opts.deadlineAt, now, async (itemIndex) => {
        if (quotaExceeded) return
        const creativeIndex = creativesByItem[itemIndex].findIndex((c) => c.kind === "video")
        if (creativeIndex < 0) return
        const c = creativesByItem[itemIndex][creativeIndex]
        const item = items[itemIndex]
        const storedVideo = await storeScrapedVideo({
          userId: opts.userId,
          jobId: opts.jobId,
          source: opts.source,
          filePrefix: safePrefix,
          itemId: item.id,
          sourceDetail: item.sourceDetail ?? null,
          sourceUrl: c.sourceUrl,
          posterUrl: c.posterUrl,
        })
        if (storedVideo.quota) {
          quotaExceeded = true
          return
        }
        if (storedVideo.ok) {
          stored += 1
          videosStored += 1
          creativesByItem[itemIndex][creativeIndex] = { ...c, url: storedVideo.url, assetId: storedVideo.assetId, stored: true }
        }
      })
      if (quotaExceeded) skipReason = "storage_limit_exceeded"
      else if (videoHitDeadline && !skipReason) skipReason = "deadline"
    }
  }

  const out: ScrapedItemMedia[] = keptIndexes.map((itemIndex) => ({
    format: primaryFormat(creativesByItem[itemIndex]),
    creatives: creativesByItem[itemIndex],
  }))

  return {
    items: out,
    keptIndexes,
    stats: {
      classified,
      stored,
      videosStored,
      kept: out.length,
      filteredOut: items.length - out.length,
      ...(skipReason ? { skipReason } : {}),
    },
  }
}

type StoredVideo =
  | { readonly ok: true; readonly quota: false; readonly url: string; readonly assetId: string | null }
  | { readonly ok: false; readonly quota: boolean }

/** Stream one creative video into R2 (quota-reserved) and record the asset row. `quota:true` = the user's storage limit refused it (the caller stops copying more). */
async function storeScrapedVideo(args: {
  userId: string
  jobId: string
  source: string
  filePrefix: string
  itemId: string
  sourceDetail: string | null
  sourceUrl: string
  posterUrl: string | null
}): Promise<StoredVideo> {
  // itemId is external actor data → sanitize before it becomes an R2 key / filename.
  const safeId = String(args.itemId).replace(/[^a-zA-Z0-9_-]/g, "") || "item"
  const outputId = `${args.filePrefix}-${safeId}-${args.jobId.slice(0, 8)}`
  try {
    const url = await uploadToR2(args.sourceUrl, outputId, "video", args.userId, { reserveQuota: true })
    // uploadToR2 reserved + settled the bytes already — no updateStorageUsage here.
    const { data, error } = await supabase
      .from("assets")
      .insert({
        user_id: args.userId,
        job_id: args.jobId,
        type: "video",
        filename: `${outputId}.mp4`,
        mime_type: "video/mp4",
        size_bytes: 0,
        r2_key: `videos/${outputId}.mp4`,
        r2_url: url,
        upload_source: "url_import",
        source: args.source,
        source_detail: args.sourceDetail || null,
        in_library: false,
        metadata: { thumbnail_url: args.posterUrl, source_url: args.sourceUrl },
      })
      .select("id")
      .single()
    if (error) console.warn(`[scraped-media] video asset row failed for ${outputId} (video kept, unowned): ${error.message}`)
    return { ok: true, quota: false, url, assetId: data?.id ?? null }
  } catch (err) {
    // Quota is a TYPED signal (isStorageLimitError), not a message grep.
    const quota = isStorageLimitError(err)
    if (!quota) console.warn(`[scraped-media] video store failed for ${outputId}: ${err instanceof Error ? err.message : String(err)}`)
    return { ok: false, quota }
  }
}
