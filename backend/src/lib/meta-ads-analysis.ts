import type { AdCreativeAnalysis } from "@nodaro/shared/social"
import { analyzeAdCreatives, type AdCreativeItem, type AdCreativeAnalysisStats, type AnalyzeAdCreativesOptions } from "./ad-creative-analysis.js"
import type { MetaAdWithMedia } from "./meta-ads-media.js"

/**
 * The Meta-shaped adapter over the node-agnostic analysis: which creative the
 * model sees (the durable library copy when the media step stored one, the
 * first image, else a video's poster), which facts ride along, and where the
 * answer lands (`ad.analysis`, `null` when that ad was not analysed).
 */
export interface MetaAdAnalyzed extends MetaAdWithMedia {
  readonly analysis: AdCreativeAnalysis | null
  readonly analysisSkipped?: "deadline" | "failed"
}

function landingDomain(ad: MetaAdWithMedia): string | undefined {
  try {
    return ad.linkUrl ? new URL(ad.linkUrl).hostname.replace(/^www\./, "") : undefined
  } catch {
    return ad.caption || undefined
  }
}

function mediaSummary(ad: MetaAdWithMedia): string {
  const parts: string[] = []
  if (ad.videos.length > 0) parts.push(`${ad.videos.length} video${ad.videos.length === 1 ? "" : "s"}`)
  if (ad.images.length > 0) parts.push(`${ad.images.length} image${ad.images.length === 1 ? "" : "s"}`)
  return parts.join(", ")
}

/** The one frame the analyst sees: a video's poster first (motion ads lead with video), else the first image. */
export function metaAdAnalysisImage(ad: MetaAdWithMedia): string | undefined {
  return ad.videoPreviews[0] ?? ad.images[0]
}

export function metaAdToCreativeItem(ad: MetaAdWithMedia, focus?: string): AdCreativeItem {
  return {
    id: ad.adArchiveId,
    imageUrl: metaAdAnalysisImage(ad),
    advertiser: ad.pageName || undefined,
    headline: ad.title || undefined,
    body: ad.text || undefined,
    ctaLabel: ad.ctaText || undefined,
    landing: landingDomain(ad),
    platforms: ad.platforms,
    creativeFormat: ad.format === "unknown" ? undefined : ad.format,
    mediaSummary: mediaSummary(ad) || undefined,
    focus: focus || undefined,
  }
}

export async function analyzeMetaAds(
  ads: readonly MetaAdWithMedia[],
  opts: AnalyzeAdCreativesOptions & { readonly focus?: string },
): Promise<{ ads: MetaAdAnalyzed[]; stats: AdCreativeAnalysisStats }> {
  const { results, stats } = await analyzeAdCreatives(ads.map((ad) => metaAdToCreativeItem(ad, opts.focus)), opts)
  return {
    ads: ads.map((ad) => {
      const r = results.get(ad.adArchiveId)
      return {
        ...ad,
        analysis: r?.analysis ?? null,
        ...(r?.reason ? { analysisSkipped: r.reason } : {}),
      }
    }),
    stats,
  }
}
