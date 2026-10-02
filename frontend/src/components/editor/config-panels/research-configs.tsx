"use client"

import { useState, type ReactNode } from "react"
import {
  SOCIAL_PLATFORMS,
  SOCIAL_SEARCH_COUNTS,
  SOCIAL_SEARCH_PERIODS,
  SOCIAL_SEARCH_PLATFORM_MODES,
  SOCIAL_SEARCH_SORTS,
  SOCIAL_SEARCH_VIDEO_KINDS,
  socialSearchEffectiveCount,
  socialSearchMaxCount,
  socialSearchMode,
  socialSearchPickTop,
  socialSearchPlatform,
  type SocialSearchPeriod,
  type SocialSearchSort,
  type SocialSearchVideoKind,
} from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { SocialSearchNodeData } from "@/types/nodes"
import { applySocialSearchPickTop, socialSearchChosen, socialSearchResults } from "@/components/nodes/social-search-run-state"
import { SOCIAL_PLATFORM_META, choiceLine, socialModeLabel, socialQueryPlaceholder } from "@/components/research/social-platforms"
import { SocialPostPicker } from "@/components/research/social-post-picker"
import { MappableField } from "./mappable-field"
import type { ConfigProps } from "./types"

const fieldClass = "h-auto rounded-xl border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] px-3.5 py-3 text-[14px] font-semibold text-[var(--meta-ads-text)] shadow-none"

const PERIOD_LABEL: Readonly<Record<SocialSearchPeriod, MessageKey>> = {
  day: "social.periodDay",
  week: "social.periodWeek",
  month: "social.periodMonth",
  year: "social.periodYear",
  all: "social.periodAll",
}

const SORT_LABEL: Readonly<Record<SocialSearchSort, MessageKey>> = {
  relevance: "social.sortRelevance",
  popular: "social.sortPopular",
  newest: "social.sortNewest",
}

const VIDEO_KIND_LABEL: Readonly<Record<SocialSearchVideoKind, MessageKey>> = {
  all: "social.kindAll",
  videos: "social.kindVideos",
  shorts: "social.kindShorts",
}

function SectionLabel({ children }: { readonly children: ReactNode }) {
  return <span className="text-[11px] font-extrabold uppercase tracking-[.12em] text-[var(--meta-ads-muted)]">{children}</span>
}

function Segmented<T extends string | number>({ value, options, onChange }: {
  readonly value: T
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>
  readonly onChange: (v: T) => void
}) {
  return (
    <div className="flex gap-1 rounded-xl border border-[var(--meta-ads-border)] bg-[var(--meta-ads-surface-3)] p-1 text-[13px] font-bold">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn("flex-1 rounded-[9px] px-2 py-[9px] text-center transition-colors", o.value === value ? "bg-[var(--meta-ads-segment-active)] text-[var(--meta-ads-text)] shadow-[0_1px_3px_rgba(30,20,60,.1)]" : "text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]")}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Social Search settings: the platform, how to search it, the query, the
 * platform's own options, and what a run passes on. A platform switch snaps
 * the mode to one the new platform has (the request builder repairs it at run
 * time too, for a node written by an agent or a template).
 */
export function SocialSearchConfig({ data, onUpdate, sources, fieldMappings, onMapField }: ConfigProps<SocialSearchNodeData>) {
  const t = useT()
  const [pickerOpen, setPickerOpen] = useState(false)
  const platform = socialSearchPlatform(data.platform)
  const mode = socialSearchMode(platform, data.mode)
  const results = socialSearchResults(data)
  const chosen = socialSearchChosen(data)
  const pickTop = socialSearchPickTop(data.pickTop)

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <SectionLabel>{t("social.cfgLabel")}</SectionLabel>
        <Input value={data.label ?? ""} onChange={(e) => onUpdate({ label: e.target.value })} className={fieldClass} />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("social.cfgPlatform")}</SectionLabel>
        <div className="grid grid-cols-4 gap-1.5">
          {SOCIAL_PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                const nextMode = socialSearchMode(p, data.mode)
                // Fail-safe: snap the mode and the results to what the new platform has.
                onUpdate({ platform: p, mode: nextMode, count: socialSearchEffectiveCount(p, nextMode, data.count) })
              }}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-[11.5px] font-bold transition-colors",
                p === platform ? "border-[#FF0073] bg-[var(--meta-ads-accent-tint)] text-[#FF0073]" : "border-[var(--meta-ads-border)] text-[var(--meta-ads-muted)] hover:text-[var(--meta-ads-text)]",
              )}
            >
              {SOCIAL_PLATFORM_META[p].icon("h-4 w-4")}
              {SOCIAL_PLATFORM_META[p].name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("social.cfgSearchBy")}</SectionLabel>
        <Segmented
          value={mode}
          onChange={(v) => onUpdate({ mode: v, count: socialSearchEffectiveCount(platform, v, data.count) })}
          options={SOCIAL_SEARCH_PLATFORM_MODES[platform].map((m) => ({ value: m, label: t(socialModeLabel(platform, m)) }))}
        />
      </div>

      <MappableField field="query" label={t(socialModeLabel(platform, mode))} sources={sources} fieldMappings={fieldMappings} onMapField={onMapField}>
        <div className="flex flex-col gap-2">
          <Input value={data.query ?? ""} onChange={(e) => onUpdate({ query: e.target.value })} placeholder={t(socialQueryPlaceholder(platform, mode))} className={fieldClass} dir="auto" />
          <p className="text-[11.5px] leading-normal text-[var(--meta-ads-faint)]">{t("social.cfgQueryHelp")}</p>
        </div>
      </MappableField>

      {platform === "tiktok" && mode === "keyword" && (
        <div className="flex flex-col gap-2">
          <SectionLabel>{t("social.cfgRegion")}</SectionLabel>
          <Input value={data.region ?? ""} maxLength={2} onChange={(e) => onUpdate({ region: e.target.value.toUpperCase() || undefined })} placeholder={t("social.phRegion")} className={fieldClass} dir="ltr" />
        </div>
      )}

      {platform === "meta_ads" && (
        <>
          <div className="flex flex-col gap-2">
            <SectionLabel>{t("social.cfgCountry")}</SectionLabel>
            <Input value={data.country ?? ""} maxLength={3} onChange={(e) => onUpdate({ country: e.target.value.toUpperCase() || undefined })} placeholder={t("social.phCountry")} className={fieldClass} dir="ltr" />
          </div>
          <label className="flex items-center justify-between gap-3 text-[13px] font-semibold text-[var(--meta-ads-text)]">
            {t("social.cfgActiveOnly")}
            <Switch checked={data.activeOnly !== false} onCheckedChange={(v) => onUpdate({ activeOnly: v })} />
          </label>
        </>
      )}

      {platform === "reddit" && mode === "keyword" && (
        <div className="flex flex-col gap-2">
          <SectionLabel>{t("social.cfgSubreddit")}</SectionLabel>
          <Input value={data.subreddit ?? ""} onChange={(e) => onUpdate({ subreddit: e.target.value || undefined })} placeholder={t("social.phCommunity")} className={fieldClass} dir="ltr" />
        </div>
      )}

      {platform === "youtube" && mode === "keyword" && (
        <div className="flex flex-col gap-2">
          <SectionLabel>{t("social.cfgVideoKind")}</SectionLabel>
          <Segmented
            value={data.videoKind ?? "all"}
            onChange={(v) => onUpdate({ videoKind: v })}
            options={SOCIAL_SEARCH_VIDEO_KINDS.map((k) => ({ value: k, label: t(VIDEO_KIND_LABEL[k]) }))}
          />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("social.cfgResults")}</SectionLabel>
        <Segmented
          value={socialSearchEffectiveCount(platform, mode, data.count)}
          onChange={(v) => onUpdate({ count: v })}
          options={SOCIAL_SEARCH_COUNTS.filter((c) => c <= socialSearchMaxCount(platform, mode)).map((c) => ({ value: c, label: String(c) }))}
        />
        {socialSearchMaxCount(platform, mode) === 20 && (
          <p className="text-[11.5px] leading-normal text-[var(--meta-ads-faint)]">{t("social.cfgOnePage")}</p>
        )}
      </div>

      {platform !== "meta_ads" && (
        <div className="flex flex-col gap-2">
          <SectionLabel>{t("social.cfgPeriod")}</SectionLabel>
          <Select value={data.period ?? "month"} onValueChange={(v) => onUpdate({ period: v })}>
            <SelectTrigger className={cn(fieldClass, "w-full")}><SelectValue /></SelectTrigger>
            <SelectContent>{SOCIAL_SEARCH_PERIODS.map((p) => <SelectItem key={p} value={p}>{t(PERIOD_LABEL[p])}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <SectionLabel>{t("social.cfgSort")}</SectionLabel>
        <Segmented value={data.sort ?? "relevance"} onChange={(v) => onUpdate({ sort: v })} options={SOCIAL_SEARCH_SORTS.map((s) => ({ value: s, label: t(SORT_LABEL[s]) }))} />
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-[var(--meta-ads-border)] p-3">
        <SectionLabel>{t("social.cfgPassOn")}</SectionLabel>
        <div className="flex items-center gap-2 text-[13px] text-[var(--meta-ads-text)]">
          <Input
            type="number"
            min={1}
            max={60}
            value={pickTop}
            onChange={(e) => onUpdate(applySocialSearchPickTop(data, socialSearchPickTop(Number(e.target.value))))}
            className={cn(fieldClass, "w-20 py-2")}
            dir="ltr"
          />
          <span className="text-[12px] text-[var(--meta-ads-muted)]">{t("social.cfgPickTopHint")}</span>
        </div>
        <label className="flex items-center justify-between gap-3 pt-1 text-[13px] font-semibold text-[var(--meta-ads-text)]">
          {t("social.cfgKeepPicks")}
          <Switch checked={data.keepPicks === true} onCheckedChange={(v) => onUpdate({ keepPicks: v })} />
        </label>
        <p className="text-[11.5px] leading-normal text-[var(--meta-ads-faint)]">{t("social.cfgKeepPicksHint")}</p>
        {results.length > 0 && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--meta-ads-muted)]">
              <span>{results.length === 1 ? t("social.countResultsOne") : t("social.countResults", { count: results.length })}</span>
              <span className="text-[var(--meta-ads-faint)]">·</span>
              <span>{choiceLine(Array.isArray(data.pickedIds) && data.pickedIds.length > 0, chosen.length, t)}</span>
            </span>
            <Button size="sm" onClick={() => setPickerOpen(true)}>{t("social.pickPosts")}</Button>
          </div>
        )}
      </div>

      <SocialPostPicker data={data} open={pickerOpen} onOpenChange={setPickerOpen} onApply={onUpdate} />
    </div>
  )
}
