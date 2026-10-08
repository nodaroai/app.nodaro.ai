"use client"

import { useEffect } from "react"
import { Link } from "react-router-dom"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import {
  COMPETITOR_ACCOUNT_KEYS,
  COMPETITOR_ABOUT_PLATFORMS,
  SOCIAL_PLATFORMS,
  SOCIAL_READ_LIMIT_MAX,
  SOCIAL_READ_WINDOW_DAYS_MAX,
  SOCIAL_READ_WINDOW_HOURS_MAX,
  type CollectionReadOrder,
  type CollectionReadWindowUnit,
  type CompetitorReadRole,
  type SocialPlatform,
  type SocialReadPeriod,
  type TrackedCompetitor,
} from "@nodaro/shared"
import { useCompetitors } from "@/hooks/queries/use-competitors-queries"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import type { CompetitorReadData, InspirationReadData } from "@/types/nodes"
import type { ConfigProps } from "./types"

const LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]"
const HINT_CLASS = "text-[10px] text-muted-foreground mt-1"

const clampWindow = (n: number, unit: CollectionReadWindowUnit): number =>
  Math.max(1, Math.min(unit === "days" ? SOCIAL_READ_WINDOW_DAYS_MAX : SOCIAL_READ_WINDOW_HOURS_MAX, n))

/** The browser's timezone, stored with a picked day so the server reads that day where the person is. */
function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

/** Today in the browser's timezone, YYYY-MM-DD — the first day a person picks. */
function today(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

type PeriodData = Pick<InspirationReadData, "period" | "windowAmount" | "windowUnit" | "day" | "timezone" | "limit" | "order">

/** Platform, period (the last N hours or days, or one day), max posts, order — what both readers ask. */
function PlatformField({ value, platforms, onChange }: { readonly value: SocialPlatform | "all"; readonly platforms: readonly SocialPlatform[]; readonly onChange: (p: SocialPlatform | "all") => void }) {
  const t = useT()
  return (
    <div>
      <Label className={LABEL_CLASS}>{t("socialRead.platform")}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as SocialPlatform | "all")}>
        <SelectTrigger aria-label={t("socialRead.platform")} className="mt-1.5">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("competitors.allPlatforms")}</SelectItem>
          {platforms.map((p) => (
            <SelectItem key={p} value={p}>{SOCIAL_PLATFORM_META[p].name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function PeriodFields({ data, windowHint, onUpdate }: { readonly data: PeriodData; readonly windowHint: string; readonly onUpdate: (patch: Partial<PeriodData>) => void }) {
  const t = useT()
  const period: SocialReadPeriod = data.period === "day" ? "day" : "window"
  const unit: CollectionReadWindowUnit = data.windowUnit === "hours" ? "hours" : "days"
  const amount = data.windowAmount ?? 7
  const limit = data.limit ?? 20
  return (
    <>
      <div>
        <Label className={LABEL_CLASS}>{t("socialRead.period")}</Label>
        <Select
          value={period}
          onValueChange={(v) => onUpdate(v === "day" ? { period: "day", day: data.day || today(), timezone: browserTimezone() } : { period: "window" })}
        >
          <SelectTrigger aria-label={t("socialRead.period")} className="mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="window">{t("socialRead.periodWindow")}</SelectItem>
            <SelectItem value="day">{t("socialRead.periodDay")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {period === "window" ? (
        <div>
          <Label className={LABEL_CLASS}>{t("collcfg.window")}</Label>
          <div className="flex gap-2 mt-1.5">
            <Input
              type="number"
              min={1}
              max={unit === "days" ? SOCIAL_READ_WINDOW_DAYS_MAX : SOCIAL_READ_WINDOW_HOURS_MAX}
              value={amount}
              aria-label={t("collcfg.window")}
              className="w-24"
              onChange={(e) => {
                const n = parseInt(e.target.value, 10)
                onUpdate({ windowAmount: Number.isFinite(n) ? clampWindow(n, unit) : 7 })
              }}
            />
            <Select
              value={unit}
              onValueChange={(v) => {
                const next = v as CollectionReadWindowUnit
                onUpdate({ windowUnit: next, windowAmount: clampWindow(amount, next) })
              }}
            >
              <SelectTrigger aria-label={t("collcfg.window")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hours">{t("collcfg.hours")}</SelectItem>
                <SelectItem value="days">{t("collcfg.days")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className={HINT_CLASS}>{windowHint}</p>
        </div>
      ) : (
        <div>
          <Label className={LABEL_CLASS}>{t("socialRead.day")}</Label>
          <Input
            type="date"
            value={data.day ?? ""}
            max={today()}
            aria-label={t("socialRead.day")}
            className="mt-1.5"
            onChange={(e) => onUpdate({ day: e.target.value, timezone: browserTimezone() })}
          />
          {/* The zone the server reads the day in: the one stored when the day was picked, else UTC (a node an agent or a template wrote). */}
          <p className={HINT_CLASS}>{t("socialRead.dayHint", { timezone: data.timezone || "UTC" })}</p>
        </div>
      )}

      <div>
        <Label className={LABEL_CLASS}>{t("socialRead.maxPosts")}</Label>
        <Input
          type="number"
          min={1}
          max={SOCIAL_READ_LIMIT_MAX}
          value={limit}
          className="mt-1.5"
          onChange={(e) => {
            const n = parseInt(e.target.value, 10)
            onUpdate({ limit: Number.isFinite(n) ? Math.max(1, Math.min(SOCIAL_READ_LIMIT_MAX, n)) : 20 })
          }}
        />
      </div>

      <div>
        <Label className={LABEL_CLASS}>{t("collcfg.order")}</Label>
        <Select value={data.order ?? "newest"} onValueChange={(v) => onUpdate({ order: v as CollectionReadOrder })}>
          <SelectTrigger aria-label={t("collcfg.order")} className="mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">{t("collcfg.newestFirst")}</SelectItem>
            <SelectItem value="oldest">{t("collcfg.oldestFirst")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  )
}

function RunError({ data }: { readonly data: { executionStatus?: string; errorMessage?: string } }) {
  if (data.executionStatus !== "failed" || !data.errorMessage) return null
  return (
    <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
      <p className="text-xs text-red-700 dark:text-red-400">{data.errorMessage}</p>
    </div>
  )
}

// ── Read Inspiration ───────────────────────────────────────────

export function InspirationReadConfig({ data, onUpdate }: ConfigProps<InspirationReadData>) {
  const t = useT()
  return (
    <div className="space-y-4">
      <PlatformField value={data.platform ?? "all"} platforms={SOCIAL_PLATFORMS} onChange={(platform) => onUpdate({ platform })} />
      <div>
        <Label className={LABEL_CLASS}>{t("socialRead.tag")}</Label>
        <Input
          value={data.tag ?? ""}
          placeholder={t("socialRead.tagPlaceholder")}
          aria-label={t("socialRead.tag")}
          className="mt-1.5"
          dir="auto"
          onChange={(e) => onUpdate({ tag: e.target.value })}
        />
      </div>
      <PeriodFields data={data} windowHint={t("socialRead.inspirationWindowHint")} onUpdate={onUpdate} />
      <RunError data={data} />
    </div>
  )
}

// ── Read Competitor ────────────────────────────────────────────

/** The platforms a brand is read on: its accounts' and the ones its name is searched on, in the canonical order. */
function brandPlatforms(brand: TrackedCompetitor | undefined): SocialPlatform[] {
  if (!brand) return [...new Set<SocialPlatform>([...COMPETITOR_ACCOUNT_KEYS, ...COMPETITOR_ABOUT_PLATFORMS])]
  const on = new Set<string>([...Object.keys(brand.accounts).filter((k) => brand.accounts[k as keyof typeof brand.accounts]), ...brand.aboutPlatforms])
  return SOCIAL_PLATFORMS.filter((p) => on.has(p))
}

export function CompetitorReadConfig({ data, onUpdate }: ConfigProps<CompetitorReadData>) {
  const t = useT()
  const { data: brands, isLoading } = useCompetitors()
  const brand = brands?.find((b) => b.id === data.competitorId)
  const platforms = brandPlatforms(brand)
  const stale = Boolean(brand && data.platform && data.platform !== "all" && !platforms.includes(data.platform))
  const platform = stale ? "all" : (data.platform ?? "all")
  // A platform the brand is not read on would make the run read nothing: once
  // the brand is known, the node data falls back to all of them (shown AND sent).
  useEffect(() => {
    if (stale) onUpdate({ platform: "all" })
  }, [stale, onUpdate])
  return (
    <div className="space-y-4">
      <div>
        <Label className={LABEL_CLASS}>{t("socialRead.competitor")}</Label>
        <Select
          value={data.competitorId || undefined}
          onValueChange={(id) => {
            const picked = brands?.find((b) => b.id === id)
            // A platform the new brand is not read on falls back to all of them.
            const keep = data.platform && data.platform !== "all" && brandPlatforms(picked).includes(data.platform) ? data.platform : "all"
            onUpdate({ competitorId: id, competitorName: picked?.brand, platform: keep })
          }}
          disabled={isLoading}
        >
          <SelectTrigger aria-label={t("socialRead.competitor")} className="mt-1.5">
            <SelectValue placeholder={t("socialRead.competitorPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {(brands ?? []).map((b) => (
              <SelectItem key={b.id} value={b.id}>{b.brand}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {brands && brands.length === 0 && <p className={HINT_CLASS}>{t("socialRead.noCompetitors")}</p>}
        <Link to="/competitors" className="mt-1 inline-block text-[10px] text-muted-foreground underline">{t("socialRead.manageCompetitors")}</Link>
      </div>
      <PlatformField value={platform} platforms={platforms} onChange={(p) => onUpdate({ platform: p })} />
      <div>
        <Label className={LABEL_CLASS}>{t("socialRead.which")}</Label>
        <Select value={data.role ?? "all"} onValueChange={(v) => onUpdate({ role: v as CompetitorReadRole })}>
          <SelectTrigger aria-label={t("socialRead.which")} className="mt-1.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("socialRead.roleAll")}</SelectItem>
            <SelectItem value="own">{t("socialRead.roleOwn")}</SelectItem>
            <SelectItem value="about">{t("socialRead.roleAbout")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <PeriodFields data={data} windowHint={t("socialRead.competitorWindowHint")} onUpdate={onUpdate} />
      <p className={HINT_CLASS}>{t("socialRead.scansHint")}</p>
      <RunError data={data} />
    </div>
  )
}
