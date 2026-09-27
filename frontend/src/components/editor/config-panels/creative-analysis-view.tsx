"use client"

import { adCreativeAnalysisFrom } from "@nodaro/shared"
import { useT, type MessageKey } from "@/lib/i18n"

/**
 * The per-item AI analysis on an expanded scraper Results row — shown only
 * when the run analysed that item. Meta Ads and Instagram share ONE analysis
 * shape (the Instagram prompt answers the ad prompt's fields), so they share
 * this view; each passes the sentence for an item the run could not analyse.
 */
export function CreativeAnalysisView({
  item,
  skippedKey,
}: {
  readonly item: Record<string, unknown>
  /** Shown when the run skipped this item (out of time, or the model failed). */
  readonly skippedKey: MessageKey
}) {
  const t = useT()
  const analysis = adCreativeAnalysisFrom(item.analysis)
  if (!analysis) {
    return item.analysisSkipped === "failed" || item.analysisSkipped === "deadline" ? (
      <p className="text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">{t(skippedKey)}</p>
    ) : null
  }
  const list = (label: string, items: readonly string[]) =>
    items.length === 0 ? null : (
      <div className="flex flex-col gap-0.5">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-[var(--meta-ads-info)]">{label}</span>
        <ul className="flex flex-col gap-0.5">
          {items.map((it, i) => (
            <li key={i} className="text-[12px] leading-snug text-[var(--meta-ads-text-2)]">· {it}</li>
          ))}
        </ul>
      </div>
    )
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--meta-ads-accent-border)] bg-[var(--meta-ads-accent-tint)] p-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-[#FF0073]">{t("cfgext.metaAdsAnalyzeTitle")}</span>
        <span className="rounded-full bg-[var(--meta-ads-chip)] px-1.5 py-[1px] text-[10px] font-bold text-[var(--meta-ads-text-2)]">{analysis.assetType}</span>
        {analysis.format && <span className="text-[11px] text-[var(--meta-ads-muted)]">{analysis.format}</span>}
      </div>
      <p className="text-[12.5px] leading-[1.5] text-[var(--meta-ads-text)]">{analysis.summary}</p>
      {list(t("cfgext.metaAdsAnalyzeVisualHooks"), analysis.visualHooks)}
      {list(t("cfgext.metaAdsAnalyzeAudiences"), analysis.audiences)}
      {list(t("cfgext.metaAdsAnalyzeCopyHooks"), analysis.copywritingHooks)}
      {list(t("cfgext.metaAdsAnalyzeUsps"), analysis.usps)}
      {analysis.graphicIdentity && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.06em] text-[var(--meta-ads-info)]">{t("cfgext.metaAdsAnalyzeGraphic")}</span>
          <p className="text-[12px] leading-snug text-[var(--meta-ads-text-2)]">{analysis.graphicIdentity}</p>
        </div>
      )}
    </div>
  )
}
