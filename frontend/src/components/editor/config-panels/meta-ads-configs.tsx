"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, Copy, Download, ExternalLink, Play, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { toast } from "sonner"
import {
  META_ADS_FORMATS,
  META_ADS_PLATFORMS,
  META_ADS_SCRAPE_DEFAULT_COUNT,
  META_ADS_SCRAPE_DEFAULT_COUNTRY,
  META_ADS_SCRAPE_MAX_COUNT,
  META_ADS_SCRAPE_MAX_SOURCES,
  META_ADS_SCRAPE_PERIODS,
  META_ADS_SCRAPE_STATUSES,
  META_ADS_ANALYSIS_CREDITS_PER_AD,
  META_ADS_ANALYSIS_FOCUS_MAX,
  STRUCTURED_VISION_MODELS,
  adCreativeAnalysisFrom,
  metaAdsAdvertisersFrom,
  metaAdsAnalysisTier,
  metaAdsNodeMode,
  type MetaAdsNodeMode,
  type MetaAdsScrapePeriod,
  type MetaAdsScrapeStatus,
} from "@nodaro/shared"
import { useT, tx } from "@/lib/i18n"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import type { MetaAdsScrapeNodeData } from "@/types/nodes"
import { META_ADS_COUNTRIES } from "@/lib/meta-ads-countries"
import { relativeTime } from "@/components/nodes/web-scrape-run-state"
import { MetaAdMedia } from "@/components/nodes/meta-ad-media"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import {
  clampFeaturedIndex,
  metaAdDateRange,
  metaAdFormat,
  metaAdHeadline,
  metaAdInitial,
  metaAdLink,
  metaAdMediaCounts,
  metaAdPlatformLabel,
  metaAdPlatforms,
  metaAdPlatformsShort,
  metaAdPreviewUrl,
  metaAdRunDays,
  metaAdStartLabel,
  metaAdStoredCreatives,
  metaAdsActiveCount,
  metaAdsFormatLabelKey,
  metaAdsScrapeItems,
  metaAdsVisibleIndexes,
} from "@/components/nodes/meta-ads-scrape-run-state"
import { Switch } from "@/components/ui/switch"
import { MappableField } from "./mappable-field"
import { MetaAdsAdvertiserPicker } from "./meta-ads-advertiser-picker"
import { LlmModelSelect } from "./llm-model-select"
import type { ConfigProps } from "./types"

const STRUCTURED_VISION_MODEL_IDS = new Set(STRUCTURED_VISION_MODELS.map((m) => m.id))

/** Section label — 11/800, .12em, uppercase, muted (design handoff). */
function SectionLabel({ children, right }: { readonly children: ReactNode; readonly right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[var(--meta-ads-muted)]">{children}</span>
      {right}
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  readonly value: T
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>
  readonly onChange: (value: T) => void
  readonly size?: "sm" | "md"
}) {
  return (
    <div className={cn("flex gap-1 rounded-xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] font-bold", size === "md" ? "p-1 text-[13px]" : "p-[3px] text-[12px] rounded-[9px]")}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-[9px] text-center transition-colors",
            size === "md" ? "px-2 py-[9px]" : "px-2.5 py-[5px] rounded-[7px]",
            o.value === value
              ? "bg-[var(--meta-ads-segment-active)] text-[var(--meta-ads-text)] shadow-[0_1px_3px_rgba(30,20,60,.1)]"
              : "text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const fieldClass =
  "h-auto rounded-xl border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] px-3.5 py-3 text-[14px] font-semibold text-[var(--meta-ads-text)] shadow-none"

/** Config + Results tabs — opens on Results once a run has finished (same rule as Web Scrape). */
export function MetaAdsScrapeConfig(props: ConfigProps<MetaAdsScrapeNodeData>) {
  const t = useT()
  const hasRun = props.data.lastRunOutcome !== undefined || props.data.generatedJson !== undefined
  return (
    <Tabs key={hasRun ? "has-run" : "no-run"} defaultValue={hasRun ? "results" : "config"} className="flex flex-col gap-3">
      <TabsList className="grid w-full grid-cols-2 h-8">
        <TabsTrigger value="config" className="text-xs">{t("cfgext.reduceTabConfig")}</TabsTrigger>
        <TabsTrigger value="results" className="text-xs" disabled={!hasRun}>{t("cfgext.scrapeResultsTab")}</TabsTrigger>
      </TabsList>
      <TabsContent value="config">
        <MetaAdsScrapeConfigTab {...props} />
      </TabsContent>
      <TabsContent value="results">
        <MetaAdsScrapeResultsTab data={props.data} onUpdate={props.onUpdate} />
      </TabsContent>
    </Tabs>
  )
}

function MetaAdsScrapeConfigTab({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<MetaAdsScrapeNodeData>) {
  const t = useT()
  const mode: MetaAdsNodeMode = metaAdsNodeMode(data.mode)
  const count = typeof data.count === "number" ? data.count : META_ADS_SCRAPE_DEFAULT_COUNT
  const selectedPlatforms = Array.isArray(data.platforms) ? data.platforms.filter((p): p is string => typeof p === "string") : []
  const selectedFormats = Array.isArray(data.formats) ? data.formats.filter((f): f is string => typeof f === "string") : []
  const toggleFormat = (code: string) => {
    const next = selectedFormats.includes(code) ? selectedFormats.filter((f) => f !== code) : [...selectedFormats, code]
    onUpdate({ formats: next })
  }
  const periodLabel: Record<MetaAdsScrapePeriod, string> = {
    "24h": t("cfgext.metaAdsPeriod24h"),
    "7d": t("cfgext.metaAdsPeriod7d"),
    "30d": t("cfgext.metaAdsPeriod30d"),
    all: t("cfgext.metaAdsPeriodAll"),
  }
  const statusLabel: Record<MetaAdsScrapeStatus, string> = {
    active: t("cfgext.metaAdsStatusActive"),
    inactive: t("cfgext.metaAdsStatusInactive"),
    all: t("cfgext.metaAdsStatusAll"),
  }
  const togglePlatform = (code: string) => {
    const next = selectedPlatforms.includes(code) ? selectedPlatforms.filter((p) => p !== code) : [...selectedPlatforms, code]
    onUpdate({ platforms: next })
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <SectionLabel>{t("cfgext.metaAdsLabel")}</SectionLabel>
        <Input value={data.label ?? ""} onChange={(e) => onUpdate({ label: e.target.value })} className={fieldClass} />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("cfgext.metaAdsMode")}</SectionLabel>
        <Segmented
          value={mode}
          onChange={(v) => onUpdate({ mode: v })}
          options={[
            { value: "search", label: t("cfgext.metaAdsModeSearch") },
            { value: "advertiser", label: t("cfgext.metaAdsModeAdvertiser") },
            { value: "pages", label: t("cfgext.metaAdsModePages") },
          ]}
        />
      </div>

      {mode === "advertiser" ? (
        <div className="flex flex-col gap-2">
          <SectionLabel>{t("cfgext.metaAdsAdvertisers")}</SectionLabel>
          <MetaAdsAdvertiserPicker
            selected={metaAdsAdvertisersFrom(data.advertisers)}
            onChange={(advertisers) => onUpdate({ advertisers })}
          />
        </div>
      ) : mode === "search" ? (
        <MappableField field="query" label={t("cfgext.metaAdsQuery")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5 rounded-xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] px-3.5 py-1">
              <Search className="h-3.5 w-3.5 shrink-0 text-[var(--meta-ads-faint)]" />
              <Input
                id="meta-ads-query"
                value={data.query ?? ""}
                onChange={(e) => onUpdate({ query: e.target.value })}
                placeholder={t("cfgext.metaAdsQueryPh")}
                className="h-9 flex-1 border-0 bg-transparent px-0 text-[14px] font-semibold text-[var(--meta-ads-text)] shadow-none focus-visible:ring-0"
              />
              {fieldMappings.query && (
                <span className="shrink-0 rounded-full bg-[var(--meta-ads-accent-tint)] px-2 py-[3px] text-[11px] font-extrabold text-[#FF0073]">
                  {t("cfgext.metaAdsFromInput")}
                </span>
              )}
            </div>
            <p className="text-[11.5px] leading-normal text-[var(--meta-ads-faint)]">{t("cfgext.metaAdsQueryHelp")}</p>
          </div>
        </MappableField>
      ) : (
        <MappableField field="pageUrls" label={t("cfgext.metaAdsPageUrls")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
          <div className="flex flex-col gap-2">
            <Textarea
              id="meta-ads-page-urls"
              value={data.pageUrls ?? ""}
              onChange={(e) => onUpdate({ pageUrls: e.target.value })}
              placeholder={t("cfgext.metaAdsPageUrlsPh", { max: META_ADS_SCRAPE_MAX_SOURCES })}
              rows={3}
              className={cn(fieldClass, "min-h-[84px] text-[13px]")}
            />
            <p className="text-[11.5px] leading-normal text-[var(--meta-ads-faint)]">
              {t("cfgext.metaAdsPageUrlsHelp", { max: META_ADS_SCRAPE_MAX_SOURCES })}
              {fieldMappings.pageUrls && <span className="ms-1 font-extrabold text-[#FF0073]">· {t("cfgext.metaAdsFromInput")}</span>}
            </p>
          </div>
        </MappableField>
      )}

      <div className="grid grid-cols-2 gap-3.5">
        <div className="flex flex-col gap-2">
          <SectionLabel>{t("cfgext.metaAdsCountry")}</SectionLabel>
          <Select value={data.countryCode ?? META_ADS_SCRAPE_DEFAULT_COUNTRY} onValueChange={(v) => onUpdate({ countryCode: v })}>
            <SelectTrigger className={cn(fieldClass, "w-full")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("cfgext.metaAdsAllCountries")}</SelectItem>
              {META_ADS_COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <SectionLabel>{t("cfgext.metaAdsStatus")}</SectionLabel>
          <Select value={data.activeStatus ?? "active"} onValueChange={(v) => onUpdate({ activeStatus: v as MetaAdsScrapeStatus })}>
            <SelectTrigger className={cn(fieldClass, "w-full")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {META_ADS_SCRAPE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{statusLabel[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("cfgext.metaAdsPeriod")}</SectionLabel>
        <Select value={data.period ?? "30d"} onValueChange={(v) => onUpdate({ period: v as MetaAdsScrapePeriod })}>
          <SelectTrigger className={cn(fieldClass, "w-full")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {META_ADS_SCRAPE_PERIODS.map((p) => (
              <SelectItem key={p} value={p}>{periodLabel[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel
          right={
            <span className="rounded-lg border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] px-2.5 py-1 text-[13px] font-extrabold tabular-nums text-[var(--meta-ads-text)]">
              {count}
            </span>
          }
        >
          {t("cfgext.metaAdsCount")}
        </SectionLabel>
        <Slider
          value={[count]}
          min={1}
          max={META_ADS_SCRAPE_MAX_COUNT}
          step={1}
          onValueChange={([v]) => onUpdate({ count: v })}
          className="[&_[data-slot=slider-range]]:bg-[#FF0073] [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:shadow-[0_2px_8px_rgba(0,0,0,.3)]"
        />
        <div className="flex justify-between text-[11px] font-semibold text-[var(--meta-ads-faint)]">
          <span>1</span>
          <span>{META_ADS_SCRAPE_MAX_COUNT}</span>
        </div>
        <p className="text-[11.5px] leading-normal text-[var(--meta-ads-faint)]">{t("cfgext.metaAdsCountHint")}</p>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("cfgext.metaAdsPlatforms")}</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {META_ADS_PLATFORMS.map((code) => {
            const on = selectedPlatforms.includes(code)
            return (
              <button
                key={code}
                type="button"
                onClick={() => togglePlatform(code)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-bold transition-colors",
                  on
                    ? "border border-[var(--meta-ads-accent-border)] bg-[var(--meta-ads-accent-tint)] text-[#FF0073]"
                    : "border border-dashed border-[var(--meta-ads-empty-border)] text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]",
                )}
              >
                {on ? null : <span aria-hidden>+</span>}
                {metaAdPlatformLabel(code)}
                {on ? <X className="h-3 w-3" /> : null}
              </button>
            )
          })}
        </div>
        <p className="text-[11.5px] leading-normal text-[var(--meta-ads-faint)]">
          {selectedPlatforms.length === 0 ? t("cfgext.metaAdsPlatformsAll") : t("cfgext.metaAdsPlatformsSome", { count: selectedPlatforms.length })}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("cfgext.metaAdsFormat")}</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {META_ADS_FORMATS.map((code) => {
            const on = selectedFormats.includes(code)
            const key = metaAdsFormatLabelKey(code)
            return (
              <button
                key={code}
                type="button"
                onClick={() => toggleFormat(code)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-bold transition-colors",
                  on
                    ? "border border-[var(--meta-ads-accent-border)] bg-[var(--meta-ads-accent-tint)] text-[#FF0073]"
                    : "border border-dashed border-[var(--meta-ads-empty-border)] text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]",
                )}
              >
                {on ? null : <span aria-hidden>+</span>}
                {key ? t(key) : code}
                {on ? <X className="h-3 w-3" /> : null}
              </button>
            )
          })}
        </div>
        <p className="text-[11.5px] leading-normal text-[var(--meta-ads-faint)]">{t("cfgext.metaAdsFormatHint")}</p>
      </div>

      <p className="text-[11.5px] leading-normal text-[var(--meta-ads-faint)]">{t("cfgext.metaAdsOutputsHelp")}</p>

      <div className="flex items-start justify-between gap-3 rounded-[14px] border border-[var(--meta-ads-info-card-border)] bg-[var(--meta-ads-info-card)] px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-extrabold text-[var(--meta-ads-text)]">{t("cfgext.metaAdsCopyAllVideos")}</span>
          <span className="text-[11.5px] leading-normal text-[var(--meta-ads-muted)]">{t("cfgext.metaAdsCopyAllVideosHint")}</span>
        </div>
        <Switch checked={data.ingestAllVideos === true} onCheckedChange={(v) => onUpdate({ ingestAllVideos: v })} />
      </div>

      <div className="flex flex-col gap-2.5 rounded-[14px] border border-[var(--meta-ads-info-card-border)] bg-[var(--meta-ads-info-card)] px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-extrabold text-[var(--meta-ads-text)]">{t("cfgext.metaAdsAnalyzeTitle")}</span>
            <span className="text-[11.5px] leading-normal text-[var(--meta-ads-muted)]">
              {t("cfgext.metaAdsAnalyzePerAd", { count: META_ADS_ANALYSIS_CREDITS_PER_AD[metaAdsAnalysisTier(data.analysisModel)] })}
            </span>
          </div>
          <Switch checked={data.analyze === true} onCheckedChange={(v) => onUpdate({ analyze: v })} />
        </div>
        {data.analyze === true && (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1.5">
              <SectionLabel>{t("cfgext.metaAdsAnalyzeModel")}</SectionLabel>
              <LlmModelSelect
                feature="meta-ads-analysis"
                value={data.analysisModel}
                onChange={(v) => onUpdate({ analysisModel: v })}
                filter={(m) => STRUCTURED_VISION_MODEL_IDS.has(m.id)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <SectionLabel>{t("cfgext.metaAdsAnalyzeFocus")}</SectionLabel>
              <Textarea
                value={data.analysisFocus ?? ""}
                onChange={(e) => onUpdate({ analysisFocus: e.target.value.slice(0, META_ADS_ANALYSIS_FOCUS_MAX) })}
                placeholder={t("cfgext.metaAdsAnalyzeFocusPh")}
                rows={2}
                className={cn(fieldClass, "min-h-[56px] text-[13px]")}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 rounded-[14px] border border-[var(--meta-ads-info-card-border)] bg-[var(--meta-ads-info-card)] px-4 py-3.5">
        <span className="text-[13px] font-extrabold text-[var(--meta-ads-info)]">{t("cfgext.metaAdsReturnsTitle")}</span>
        <div className="grid grid-cols-2 gap-x-3.5 gap-y-1.5 text-[12px] font-semibold text-[var(--meta-ads-text-2)]">
          <span>{t("cfgext.metaAdsReturnsPage")}</span>
          <span>{t("cfgext.metaAdsReturnsDates")}</span>
          <span>{t("cfgext.metaAdsReturnsCopy")}</span>
          <span>{t("cfgext.metaAdsPlatforms")}</span>
          <span>{t("cfgext.metaAdsReturnsMedia")}</span>
          <span>{t("cfgext.metaAdsReturnsLinks")}</span>
        </div>
      </div>
    </div>
  )
}

type ResultsView = "list" | "grid" | "json"

/** The per-ad AI analysis on an expanded Results row — shown only when the run analysed that ad. */
function MetaAdAnalysisView({ ad }: { readonly ad: Record<string, unknown> }) {
  const t = useT()
  const analysis = adCreativeAnalysisFrom(ad.analysis)
  if (!analysis) {
    return ad.analysisSkipped === "failed" || ad.analysisSkipped === "deadline" ? (
      <p className="text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">{t("cfgext.metaAdsAnalyzeSkipped")}</p>
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

export function MetaAdsScrapeResultsTab({
  data,
  onUpdate,
}: {
  readonly data: MetaAdsScrapeNodeData
  readonly onUpdate: (d: Record<string, unknown>) => void
}) {
  const t = useT()
  const isRtl = useAppDir() === "rtl"
  const [view, setView] = useState<ResultsView>("list")
  const [openIndex, setOpenIndex] = useState(-1)
  const items = metaAdsScrapeItems(data.generatedJson)
  const storedFeatured = clampFeaturedIndex(data.featuredIndex, items.length)
  // The format chips live on the node (`viewFormat`) so the card's thumb
  // strip and pager follow the same filter. The featured index addresses the
  // FULL array (it feeds the outputs), so switching chips snaps it into view.
  const viewFormat = typeof data.viewFormat === "string" ? data.viewFormat : "all"
  const visible = metaAdsVisibleIndexes(items, viewFormat)
  const featured = visible.includes(storedFeatured) ? storedFeatured : (visible[0] ?? storedFeatured)
  const formatCount = (code: string) => items.filter((a) => metaAdFormat(a) === code).length
  const pickFormat = (code: string) => {
    const next = metaAdsVisibleIndexes(items, code)
    const snap = !next.includes(storedFeatured) && next.length > 0 ? { featuredIndex: next[0] } : {}
    onUpdate({ viewFormat: code, ...snap })
  }
  const json = data.generatedJson === undefined ? "" : JSON.stringify(data.generatedJson, null, 2)
  const sizeKb = json ? (new Blob([json]).size / 1024).toFixed(1) : "0"

  if (data.generatedJson === undefined) {
    return <p className="py-4 text-center text-xs text-muted-foreground">{t("cfgext.metaAdsNoResults")}</p>
  }

  const copyJson = () => {
    void navigator.clipboard.writeText(json).then(
      () => toast.success(tx("cfgext.scrapeJsonCopied")),
      () => toast.error(tx("cfgext.scrapeCopyFailed")),
    )
  }
  const downloadJson = () => {
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "meta-ads-results.json"
    a.click()
    URL.revokeObjectURL(url)
  }
  const pick = (i: number) => {
    onUpdate({ featuredIndex: i })
    setOpenIndex((cur) => (cur === i ? -1 : i))
  }
  const mediaLabel = (ad: Record<string, unknown>) => {
    const c = metaAdMediaCounts(ad)
    const parts: string[] = []
    if (c.videos > 0) parts.push(c.videos === 1 ? t("cfgext.metaAdsVideoOne") : t("cfgext.metaAdsVideoCount", { count: c.videos }))
    if (c.images > 0) parts.push(c.images === 1 ? t("cfgext.metaAdsImageOne") : t("cfgext.metaAdsImageCount", { count: c.images }))
    return parts.join(" · ")
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "list", label: t("cfgext.scrapeViewList") },
            { value: "grid", label: t("cfgext.metaAdsViewGrid") },
            { value: "json", label: t("cfgext.scrapeViewJson") },
          ]}
        />
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-[30px] w-[30px] rounded-lg border-[var(--meta-ads-border)] p-0 text-[var(--meta-ads-muted)]" onClick={copyJson} title={t("cfgext.scrapeCopyJson")}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="h-[30px] w-[30px] rounded-lg border-[var(--meta-ads-border)] p-0 text-[var(--meta-ads-muted)]" onClick={downloadJson} title={t("cfgext.scrapeDownloadJson")}>
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
        <span>
          {t("cfgext.metaAdsCountResults", { count: items.length })} · {t("cfgext.metaAdsCountActive", { count: metaAdsActiveCount(items) })}
          {data.lastGoodAt ? ` · ${relativeTime(data.lastGoodAt)}` : ""}
        </span>
        <span>{sizeKb} KB</span>
      </div>

      {/* Creative-format chips: filter what the list / grid / card strip show. */}
      <div className="flex flex-wrap gap-1.5">
        {(["all", ...META_ADS_FORMATS] as const).map((code) => {
          const on = viewFormat === code
          const key = code === "all" ? "cfgext.metaAdsFormatAll" : metaAdsFormatLabelKey(code)
          const n = code === "all" ? items.length : formatCount(code)
          return (
            <button
              key={code}
              type="button"
              onClick={() => pickFormat(code)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors",
                on
                  ? "border-[var(--meta-ads-accent-border)] bg-[var(--meta-ads-accent-tint)] text-[#FF0073]"
                  : "border-[var(--meta-ads-border)] text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]",
              )}
            >
              {key ? t(key) : code} <span className="tabular-nums opacity-70">{n}</span>
            </button>
          )
        })}
      </div>

      {view === "json" && (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-2 text-[10px]">{json}</pre>
      )}

      {view !== "json" && visible.length === 0 && (
        <p className="py-6 text-center text-[12px] font-semibold text-[var(--meta-ads-muted)]">{t("cfgext.metaAdsFormatNoMatch")}</p>
      )}

      {view === "grid" && (
        <div className="grid max-h-[60vh] grid-cols-3 gap-2 overflow-y-auto pe-1">
          {visible.map((i) => items[i]).map((ad, k) => (
            <button
              key={typeof ad.adArchiveId === "string" ? ad.adArchiveId : visible[k]}
              type="button"
              onClick={() => onUpdate({ featuredIndex: visible[k] })}
              className={cn("flex flex-col gap-1 rounded-xl p-1 text-start transition-colors hover:bg-[var(--meta-ads-chip)]", visible[k] === featured && "ring-2 ring-[#FF0073]")}
            >
              <MetaAdMedia src={metaAdPreviewUrl(ad)} initial={metaAdInitial(ad)} className="h-[120px] w-full rounded-lg" initialClassName="text-[22px]">
                {metaAdMediaCounts(ad).videos > 0 && (
                  <span className="absolute start-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-black/55 text-white">
                    <Play className="h-2.5 w-2.5 fill-current" />
                  </span>
                )}
              </MetaAdMedia>
              <span className="truncate px-0.5 text-[11.5px] font-bold text-[var(--meta-ads-text)]">{typeof ad.pageName === "string" ? ad.pageName : ""}</span>
            </button>
          ))}
        </div>
      )}

      {view === "list" && (
        <div className="flex max-h-[60vh] flex-col overflow-y-auto pe-1">
          {visible.map((i) => {
            const ad = items[i]
            const open = openIndex === i
            const link = metaAdLink(ad)
            const days = metaAdRunDays(ad)
            const cta = typeof ad.ctaText === "string" && ad.ctaText.trim() ? ad.ctaText.trim() : t("cfgext.metaAdsNoCta")
            const formatKey = metaAdsFormatLabelKey(metaAdFormat(ad))
            const stored = metaAdStoredCreatives(ad)
            const meta = [metaAdStartLabel(ad), formatKey ? t(formatKey) : "", mediaLabel(ad), metaAdPlatformsShort(ad)].filter(Boolean)
            return (
              <div key={typeof ad.adArchiveId === "string" ? ad.adArchiveId : i} className="border-b border-[var(--meta-ads-divider)]">
                <button
                  type="button"
                  onClick={() => pick(i)}
                  aria-expanded={open}
                  className={cn("flex w-full gap-3 rounded-[10px] px-2 py-2.5 text-start transition-colors hover:bg-[var(--meta-ads-chip)]", i === featured && "bg-[var(--meta-ads-chip)]")}
                >
                  <MetaAdMedia src={metaAdPreviewUrl(ad)} initial={metaAdInitial(ad)} className="h-[66px] w-[52px] shrink-0 rounded-lg" initialClassName="text-[15px]" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-extrabold text-[var(--meta-ads-text)]">{typeof ad.pageName === "string" ? ad.pageName : ""}</span>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: ad.isActive === true ? "var(--meta-ads-success)" : "var(--meta-ads-faint)" }} />
                    </div>
                    <span className="truncate text-[12.5px] text-[var(--meta-ads-text-2)]">{metaAdHeadline(ad)}</span>
                    <span className="flex flex-wrap gap-1.5 text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
                      {meta.map((m, k) => (
                        <span key={k} className="flex gap-1.5">
                          {k > 0 && <span className="text-[var(--meta-ads-faint)]">·</span>}
                          {m}
                        </span>
                      ))}
                    </span>
                  </div>
                  <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 self-center text-[var(--meta-ads-muted)] transition-transform duration-200", open && "rotate-180")} />
                </button>
                {open && (
                  <div className="mb-3 ms-[72px] me-2 flex flex-col gap-2.5 rounded-xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-2)] p-3">
                    <p className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-[var(--meta-ads-text-2)]">{typeof ad.text === "string" ? ad.text : ""}</p>
                    <MetaAdAnalysisView ad={ad} />
                    {metaAdPlatforms(ad).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {metaAdPlatforms(ad).map((p) => (
                          <span key={p} className="rounded-md bg-[var(--meta-ads-chip)] px-[7px] py-[3px] text-[10.5px] font-bold text-[var(--meta-ads-text-2)]">{metaAdPlatformLabel(p)}</span>
                        ))}
                      </div>
                    )}
                    {/* Creatives already copied into the library can be promoted to the media picker; external ones say so. */}
                    <div className="flex flex-wrap items-center gap-2 text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
                      {stored.length > 0 ? (
                        stored.map((c) => (
                          <span key={c.assetId} className="flex items-center gap-1">
                            <SaveToLibraryButton url={c.url} type={c.kind} compact />
                            <span>{c.kind === "video" ? t("cfgext.metaAdsOutVideo") : t("cfgext.metaAdsOutImage")}</span>
                          </span>
                        ))
                      ) : (
                        <span>{t("cfgext.metaAdsNotStored")}</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[12px] font-bold">
                      <span className="text-[var(--meta-ads-muted)]">
                        {metaAdDateRange(ad, isRtl)}
                        {days !== null ? ` · ${t("cfgext.metaAdsRunDays", { count: days })}` : ""}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="rounded-[7px] bg-[var(--meta-ads-cta-bg)] px-2.5 py-[5px] text-[11.5px] font-extrabold text-[var(--meta-ads-cta-fg)]">{cta}</span>
                        {link && (
                          <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[#FF0073] hover:underline">
                            {t("cfgext.metaAdsAdLibrary")} <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
