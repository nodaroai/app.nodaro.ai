"use client"

import { useState, type ReactNode } from "react"
import { ExternalLink, Heart, MessageCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  INSTAGRAM_SCRAPE_MAX_COUNT,
  INSTAGRAM_SCRAPE_MAX_SOURCES,
  INSTAGRAM_SCRAPE_PERIODS,
  INSTAGRAM_SCRAPE_DEFAULT_COUNT,
  META_ADS_FORMATS,
  META_ADS_ANALYSIS_CREDITS_PER_AD,
  META_ADS_ANALYSIS_FOCUS_MAX,
  STRUCTURED_VISION_MODELS,
  instagramScrapeMode,
  metaAdsAnalysisTier,
  type InstagramScrapeMode,
  type InstagramScrapePeriod,
} from "@nodaro/shared"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { InstagramScrapeNodeData } from "@/types/nodes"
import { relativeTime } from "@/components/nodes/web-scrape-run-state"
import { MetaAdMedia } from "@/components/nodes/meta-ad-media"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import {
  instagramCaption,
  instagramFormat,
  instagramFormatLabelKey,
  instagramInitial,
  instagramLink,
  instagramOwner,
  instagramPreviewUrl,
  instagramScrapeItems,
  instagramStat,
  instagramStoredCreatives,
  instagramTimestampLabel,
  instagramVisibleIndexes,
} from "@/components/nodes/instagram-scrape-run-state"
import { MappableField } from "./mappable-field"
import { LlmModelSelect } from "./llm-model-select"
import type { ConfigProps } from "./types"
import { formatNumber } from "@/lib/i18n/format"

const STRUCTURED_VISION_MODEL_IDS = new Set(STRUCTURED_VISION_MODELS.map((m) => m.id))
const fieldClass = "h-auto rounded-xl border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] px-3.5 py-3 text-[14px] font-semibold text-[var(--meta-ads-text)] shadow-none"

function SectionLabel({ children }: { readonly children: ReactNode }) {
  return <span className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[var(--meta-ads-muted)]">{children}</span>
}

function Segmented<T extends string>({ value, options, onChange }: { readonly value: T; readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>; readonly onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 rounded-xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] p-1 text-[13px] font-bold">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)} className={cn("flex-1 rounded-[9px] px-2 py-[9px] text-center transition-colors", o.value === value ? "bg-[var(--meta-ads-segment-active)] text-[var(--meta-ads-text)] shadow-[0_1px_3px_rgba(30,20,60,.1)]" : "text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]")}>{o.label}</button>
      ))}
    </div>
  )
}

export function InstagramScrapeConfig(props: ConfigProps<InstagramScrapeNodeData>) {
  const t = useT()
  const hasRun = props.data.lastRunOutcome !== undefined || props.data.generatedJson !== undefined
  return (
    <Tabs key={hasRun ? "has-run" : "no-run"} defaultValue={hasRun ? "results" : "config"} className="flex flex-col gap-3">
      <TabsList className="grid w-full grid-cols-2 h-8">
        <TabsTrigger value="config" className="text-xs">{t("cfgext.reduceTabConfig")}</TabsTrigger>
        <TabsTrigger value="results" className="text-xs" disabled={!hasRun}>{t("cfgext.scrapeResultsTab")}</TabsTrigger>
      </TabsList>
      <TabsContent value="config"><InstagramConfigTab {...props} /></TabsContent>
      <TabsContent value="results"><InstagramResultsTab data={props.data} onUpdate={props.onUpdate} /></TabsContent>
    </Tabs>
  )
}

function InstagramConfigTab({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<InstagramScrapeNodeData>) {
  const t = useT()
  const mode: InstagramScrapeMode = instagramScrapeMode(data.mode)
  const count = typeof data.count === "number" ? data.count : INSTAGRAM_SCRAPE_DEFAULT_COUNT
  const selectedFormats = Array.isArray(data.formats) ? data.formats.filter((f): f is string => typeof f === "string") : []
  const toggleFormat = (code: string) => onUpdate({ formats: selectedFormats.includes(code) ? selectedFormats.filter((f) => f !== code) : [...selectedFormats, code] })
  const periodLabel: Record<InstagramScrapePeriod, string> = { "24h": t("cfgext.metaAdsPeriod24h"), "7d": t("cfgext.metaAdsPeriod7d"), "30d": t("cfgext.metaAdsPeriod30d"), all: t("cfgext.metaAdsPeriodAll") }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <SectionLabel>{t("cfgext.metaAdsLabel")}</SectionLabel>
        <Input value={data.label ?? ""} onChange={(e) => onUpdate({ label: e.target.value })} className={fieldClass} />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("cfgext.metaAdsMode")}</SectionLabel>
        <Segmented value={mode} onChange={(v) => onUpdate({ mode: v })} options={[{ value: "profile", label: t("cfgext.igModeProfile") }, { value: "hashtag", label: t("cfgext.igModeHashtag") }]} />
      </div>

      <MappableField field="targets" label={mode === "hashtag" ? t("cfgext.igHashtags") : t("cfgext.igProfiles")} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <div className="flex flex-col gap-2">
          <Textarea value={data.targets ?? ""} onChange={(e) => onUpdate({ targets: e.target.value })} placeholder={mode === "hashtag" ? t("cfgext.igHashtagsPh") : t("cfgext.igProfilesPh")} rows={3} className={cn(fieldClass, "min-h-[84px] text-[13px]")} />
          <p className="text-[11.5px] leading-normal text-[var(--meta-ads-faint)]">
            {t("cfgext.igTargetsHelp", { max: INSTAGRAM_SCRAPE_MAX_SOURCES })}
            {fieldMappings.targets && <span className="ms-1 font-extrabold text-[#FF0073]">· {t("cfgext.metaAdsFromInput")}</span>}
          </p>
        </div>
      </MappableField>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("cfgext.igPeriod")}</SectionLabel>
        <Select value={data.period ?? "30d"} onValueChange={(v) => onUpdate({ period: v })}>
          <SelectTrigger className={cn(fieldClass, "w-full")}><SelectValue /></SelectTrigger>
          <SelectContent>{INSTAGRAM_SCRAPE_PERIODS.map((p) => (<SelectItem key={p} value={p}>{periodLabel[p]}</SelectItem>))}</SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <SectionLabel>{t("cfgext.igPostsPerSource")}</SectionLabel>
          <span className="rounded-full bg-[var(--meta-ads-accent-tint)] px-2 py-0.5 text-[12px] font-extrabold text-[#FF0073]">{count}</span>
        </div>
        <Slider value={[count]} min={1} max={INSTAGRAM_SCRAPE_MAX_COUNT} step={1} onValueChange={([v]) => onUpdate({ count: v })} />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("cfgext.metaAdsFormat")}</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {META_ADS_FORMATS.map((code) => {
            const on = selectedFormats.includes(code)
            const key = instagramFormatLabelKey(code)
            return (
              <button key={code} type="button" onClick={() => toggleFormat(code)} className={cn("rounded-full px-2.5 py-1.5 text-[12px] font-bold transition-colors", on ? "border border-[var(--meta-ads-accent-border)] bg-[var(--meta-ads-accent-tint)] text-[#FF0073]" : "border border-dashed border-[var(--meta-ads-empty-border)] text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]")}>{key ? t(key) : code}</button>
            )
          })}
        </div>
        <p className="text-[11.5px] leading-normal text-[var(--meta-ads-faint)]">{t("cfgext.metaAdsFormatHint")}</p>
      </div>

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
            <span className="text-[11.5px] leading-normal text-[var(--meta-ads-muted)]">{t("cfgext.igAnalyzePerPost", { count: META_ADS_ANALYSIS_CREDITS_PER_AD[metaAdsAnalysisTier(data.analysisModel)] })}</span>
          </div>
          <Switch checked={data.analyze === true} onCheckedChange={(v) => onUpdate({ analyze: v })} />
        </div>
        {data.analyze === true && (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1.5">
              <SectionLabel>{t("cfgext.metaAdsAnalyzeModel")}</SectionLabel>
              <LlmModelSelect feature="meta-ads-analysis" value={data.analysisModel} onChange={(v) => onUpdate({ analysisModel: v })} filter={(m) => STRUCTURED_VISION_MODEL_IDS.has(m.id)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <SectionLabel>{t("cfgext.metaAdsAnalyzeFocus")}</SectionLabel>
              <Textarea value={data.analysisFocus ?? ""} onChange={(e) => onUpdate({ analysisFocus: e.target.value.slice(0, META_ADS_ANALYSIS_FOCUS_MAX) })} placeholder={t("cfgext.igAnalyzeFocusPh")} rows={2} className={cn(fieldClass, "min-h-[56px] text-[13px]")} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function InstagramResultsTab({ data, onUpdate }: { readonly data: InstagramScrapeNodeData; readonly onUpdate: (d: Record<string, unknown>) => void }) {
  const t = useT()
  const [openIndex, setOpenIndex] = useState(-1)
  const items = instagramScrapeItems(data.generatedJson)
  const viewFormat = typeof data.viewFormat === "string" ? data.viewFormat : "all"
  const visible = instagramVisibleIndexes(items, viewFormat)
  const formatCount = (code: string) => items.filter((p) => instagramFormat(p) === code).length

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
        <span>{t("cfgext.igCountResults", { count: items.length })}{data.lastGoodAt ? ` · ${relativeTime(data.lastGoodAt)}` : ""}</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(["all", ...META_ADS_FORMATS] as const).map((code) => {
          const on = viewFormat === code
          const key = code === "all" ? "cfgext.metaAdsFormatAll" : instagramFormatLabelKey(code)
          const n = code === "all" ? items.length : formatCount(code)
          return (
            <button key={code} type="button" onClick={() => onUpdate({ viewFormat: code })} className={cn("rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors", on ? "border-[var(--meta-ads-accent-border)] bg-[var(--meta-ads-accent-tint)] text-[#FF0073]" : "border-[var(--meta-ads-border)] text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]")}>{key ? t(key) : code} <span className="tabular-nums opacity-70">{n}</span></button>
          )
        })}
      </div>

      {visible.length === 0 && <p className="py-6 text-center text-[12px] font-semibold text-[var(--meta-ads-muted)]">{t("cfgext.metaAdsFormatNoMatch")}</p>}

      <div className="flex max-h-[60vh] flex-col overflow-y-auto pe-1">
        {visible.map((i) => {
          const post = items[i]
          const open = openIndex === i
          const link = instagramLink(post)
          const likes = instagramStat(post, "likesCount")
          const comments = instagramStat(post, "commentsCount")
          const stored = instagramStoredCreatives(post)
          const formatKey = instagramFormatLabelKey(instagramFormat(post))
          return (
            <div key={typeof post.postId === "string" ? post.postId : i} className="border-b border-[var(--meta-ads-divider)] last:border-b-0">
              <button type="button" onClick={() => { setOpenIndex(open ? -1 : i); onUpdate({ featuredIndex: i }) }} className="flex w-full items-center gap-2.5 py-2 text-start">
                <span className="h-11 w-11 shrink-0 overflow-hidden rounded-lg"><MetaAdMedia src={instagramPreviewUrl(post)} initial={instagramInitial(post)} className="h-full w-full" initialClassName="text-[13px]" /></span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[12.5px] font-bold text-[var(--meta-ads-text)]">@{instagramOwner(post) || "?"}</span>
                  <span className="truncate text-[11.5px] text-[var(--meta-ads-muted)]">{[instagramTimestampLabel(post), formatKey ? t(formatKey) : ""].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] font-semibold text-[var(--meta-ads-muted)]">
                  {likes !== null && <span className="flex items-center gap-0.5"><Heart className="h-3 w-3" />{formatNumber(likes)}</span>}
                  {comments !== null && <span className="flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{formatNumber(comments)}</span>}
                </span>
              </button>
              {open && (
                <div className="mb-3 ms-[52px] me-2 flex flex-col gap-2 rounded-xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-2)] p-3">
                  {instagramCaption(post) && <p className="whitespace-pre-wrap text-[12.5px] leading-[1.55] text-[var(--meta-ads-text-2)]">{instagramCaption(post)}</p>}
                  <div className="flex flex-wrap items-center gap-2 text-[11.5px] font-semibold text-[var(--meta-ads-muted)]">
                    {stored.length > 0 ? stored.map((c) => (
                      <span key={c.assetId} className="flex items-center gap-1"><SaveToLibraryButton url={c.url} type={c.kind} compact /><span>{c.kind === "video" ? t("cfgext.metaAdsOutVideo") : t("cfgext.metaAdsOutImage")}</span></span>
                    )) : <span>{t("cfgext.metaAdsNotStored")}</span>}
                    {link && <a href={link} target="_blank" rel="noopener noreferrer" className="ms-auto flex items-center gap-1 text-[#FF0073] hover:underline">{t("cfgext.igOpenPost")} <ExternalLink className="h-3 w-3" /></a>}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
