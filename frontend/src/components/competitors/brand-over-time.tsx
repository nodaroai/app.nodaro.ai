"use client"

import { useMemo, useState, type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import type { CompetitorPeriod, CompetitorPeriodPlatform, CompetitorPost, SocialPlatform, SocialPost } from "@nodaro/shared"
import { SocialPostPreview } from "@/components/research/social-post-preview"
import { SocialPostTile } from "@/components/research/social-post-tile"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import { useCompetitorCompare, useCompetitorHistory } from "@/hooks/queries/use-competitors-queries"
import { useT, type MessageKey } from "@/lib/i18n"
import { formatDate, formatNumber } from "@/lib/i18n/format"
import { cn } from "@/lib/utils"
import { compactNumber } from "./action-card-text"
import { FollowerSparkline, sparklinePoints } from "./follower-sparkline"
import { lessonText } from "./lesson-text"
import { PERIOD_PRESETS, compareInput, dateInputValue, earliestDay, periodOf, presetPeriods, type PeriodPreset, type Periods } from "./period-presets"
import { usualText } from "./usual-text"

const PRESET_KEY: Readonly<Record<PeriodPreset, MessageKey>> = {
  week: "competitors.presetWeek",
  month: "competitors.presetMonth",
  calendarMonth: "competitors.presetCalendarMonth",
  day: "competitors.presetDay",
  custom: "competitors.presetCustom",
}

const shortDate = (d: Date) => formatDate(d.getTime(), { month: "short", day: "numeric" })

/** "Sep 29 – Oct 5", or the one day. */
function periodLabel(p: { readonly from: Date | string; readonly to: Date | string }): string {
  const from = shortDate(typeof p.from === "string" ? new Date(p.from) : p.from)
  const to = shortDate(typeof p.to === "string" ? new Date(p.to) : p.to)
  return from === to ? from : `${from} – ${to}`
}

/** A labelled date input, in the person's local days. */
function DayInput({ label, value, min, max, onChange }: { readonly label: string; readonly value: string; readonly min?: string; readonly max: string; readonly onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground">
      {label}
      <input
        type="date"
        dir="ltr"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-md border border-border bg-card px-2 text-[13px] font-normal normal-case tracking-normal text-foreground"
      />
    </label>
  )
}

/** The posts a period's platform counts as its best, as tiles. */
function BestPosts({ ids, posts, onRead }: { readonly ids: readonly string[]; readonly posts: Readonly<Record<string, CompetitorPost>>; readonly onRead: (post: SocialPost) => void }) {
  const found = ids.flatMap((id) => (posts[id] ? [posts[id]!] : []))
  if (found.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <div className="grid w-[104px] grid-cols-2 gap-1.5">
      {found.map((post) => (
        <SocialPostTile key={post.id} post={post} onRead={onRead} />
      ))}
    </div>
  )
}

/** One platform's numbers in one period. */
function PeriodCells({ p, isOwn, posts, onRead }: { readonly p: CompetitorPeriodPlatform | null; readonly isOwn: boolean; readonly posts: Readonly<Record<string, CompetitorPost>>; readonly onRead: (post: SocialPost) => void }) {
  const t = useT()
  const dash = <span className="text-muted-foreground">—</span>
  if (!p) return <>{[0, 1, 2, 3, 4, 5].map((i) => <td key={i} className="px-3 py-2.5">{dash}</td>)}</>
  const usual = usualText(p, t)
  const followers = p.followers ? (p.followers.value === 1 ? t("competitors.followersCountOne") : t("competitors.followersCount", { n: compactNumber(p.followers.value) })) : null
  const change = p.change === null ? null : formatNumber(p.change, { signDisplay: "always" })
  const worked = p.lessons[0] ? lessonText(p.lessons[0], t).line : null
  return (
    <>
      <td className="px-3 py-2.5 tabular-nums">{p.own}</td>
      <td className="px-3 py-2.5 tabular-nums">{p.about}</td>
      <td className="px-3 py-2.5 tabular-nums">{usual ?? dash}</td>
      <td className="px-3 py-2.5 tabular-nums">
        {followers ? (
          <span className="flex flex-col">
            <span>{followers}</span>
            {change !== null && <span className={cn("text-[12px]", p.change! > 0 ? "text-emerald-700 dark:text-emerald-300" : p.change! < 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>{change}</span>}
          </span>
        ) : (
          dash
        )}
      </td>
      <td className="min-w-[170px] px-3 py-2.5 leading-[1.4]">{worked ?? <span className="text-muted-foreground">{p.own === 0 ? "—" : t("competitors.nothingStandsOut")}</span>}</td>
      <td className="min-w-[128px] px-3 py-2.5">
        <BestPosts ids={p.best} posts={posts} onRead={onRead} />
      </td>
    </>
  )
}

/**
 * The brand over time: two periods side by side (their posts, posts about
 * them, usual reach, followers and how they moved, what worked, the best
 * posts), and a line of followers scan after scan, each point opening that
 * scan.
 */
export function BrandOverTime({
  competitorId,
  isOwn,
  historyMonths,
  onOpenScan,
}: {
  readonly competitorId: string
  readonly isOwn: boolean
  /** How many months of scans the plan keeps; null until known. */
  readonly historyMonths: number | null
  readonly onOpenScan: (scanId: string) => void
}) {
  const t = useT()
  const [now] = useState(() => new Date())
  const [preset, setPreset] = useState<PeriodPreset>("week")
  const [day, setDay] = useState(() => dateInputValue(now))
  const [custom, setCustom] = useState(() => {
    const { a, b } = presetPeriods("custom", now)
    return { aFrom: dateInputValue(a.from), aTo: dateInputValue(a.to), bFrom: dateInputValue(b!.from), bTo: dateInputValue(b!.to) }
  })
  const [reading, setReading] = useState<SocialPost | null>(null)

  const periods: Periods | null = useMemo(() => {
    if (preset === "day") {
      const p = periodOf(day, day)
      return p ? { a: p, b: null } : null
    }
    if (preset === "custom") {
      const a = periodOf(custom.aFrom, custom.aTo)
      const b = periodOf(custom.bFrom, custom.bTo)
      return a && b ? { a, b } : null
    }
    return presetPeriods(preset, now)
  }, [preset, day, custom, now])
  const input = useMemo(() => (periods ? compareInput(periods) : null), [periods])
  const compare = useCompetitorCompare(competitorId, input)
  const history = useCompetitorHistory(competitorId, true)
  const minDay = historyMonths ? dateInputValue(earliestDay(now, historyMonths)) : undefined
  const maxDay = dateInputValue(now)

  const [a, b] = compare.data?.periods ?? []
  const platforms = useMemo(() => {
    const seen = new Set<SocialPlatform>([...(a?.platforms ?? []), ...(b?.platforms ?? [])].map((p) => p.platform))
    return [...seen]
  }, [a, b])
  const on = (period: CompetitorPeriod | undefined, platform: SocialPlatform) => period?.platforms.find((p) => p.platform === platform) ?? null
  const head = "px-3 py-2 text-start text-[11px] font-semibold uppercase tracking-[.06em] text-muted-foreground"
  const scans = history.data?.scans ?? []
  const chartPlatforms = useMemo(
    () => [...new Set(scans.flatMap((s) => s.platforms.map((p) => p.platform)))].filter((platform) => sparklinePoints(scans, platform, "followers").length > 0 || sparklinePoints(scans, platform, "own").length > 0),
    [scans],
  )

  const periodHeader = (label: string, period: CompetitorPeriod | undefined): ReactNode => (
    <span className="flex flex-col">
      <span>{label}</span>
      {period && <span className="text-[11px] font-normal normal-case tracking-normal text-muted-foreground">{periodLabel(period)}</span>}
    </span>
  )

  return (
    <div className="flex flex-col gap-5">
      {historyMonths !== null && (
        <p className="text-[12px] text-muted-foreground">{historyMonths === 1 ? t("competitors.historyKeptOne") : t("competitors.historyKept", { n: historyMonths })}</p>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("competitors.periodA")}>
          {PERIOD_PRESETS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={preset === id}
              onClick={() => setPreset(id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                preset === id ? "border-foreground bg-foreground text-background dark:border-foreground/30 dark:bg-muted dark:text-foreground" : "border-border bg-card text-foreground/85 hover:bg-muted/60",
              )}
            >
              {t(PRESET_KEY[id])}
            </button>
          ))}
        </div>
      </div>

      {preset === "day" && (
        <div className="flex flex-wrap gap-3">
          <DayInput label={t("competitors.periodDay")} value={day} min={minDay} max={maxDay} onChange={setDay} />
        </div>
      )}
      {preset === "custom" && (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 text-[12px] font-semibold">{t("competitors.periodA")}</legend>
            <DayInput label={t("competitors.periodFrom")} value={custom.aFrom} min={minDay} max={maxDay} onChange={(aFrom) => setCustom({ ...custom, aFrom })} />
            <DayInput label={t("competitors.periodTo")} value={custom.aTo} min={minDay} max={maxDay} onChange={(aTo) => setCustom({ ...custom, aTo })} />
          </fieldset>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 text-[12px] font-semibold">{t("competitors.periodB")}</legend>
            <DayInput label={t("competitors.periodFrom")} value={custom.bFrom} min={minDay} max={maxDay} onChange={(bFrom) => setCustom({ ...custom, bFrom })} />
            <DayInput label={t("competitors.periodTo")} value={custom.bTo} min={minDay} max={maxDay} onChange={(bTo) => setCustom({ ...custom, bTo })} />
          </fieldset>
        </div>
      )}
      {periods === null && <p className="text-[13px] text-amber-700 dark:text-amber-400">{t("competitors.periodInvalid")}</p>}

      {compare.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : compare.isError ? (
        <p className="py-4 text-sm text-destructive">{t("apiErr.loadCompetitorCompare")}</p>
      ) : compare.data && platforms.length === 0 ? (
        <p className="py-4 text-[13px] text-muted-foreground">{t("competitors.compareEmpty")}</p>
      ) : compare.data ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[980px] border-collapse text-[13px]">
            <thead className="bg-muted/40">
              <tr>
                <th scope="col" className={cn(head, "w-[120px]")} rowSpan={2}>
                  {t("competitors.colPlatform")}
                </th>
                <th scope="colgroup" className={cn(head, "border-s border-border/70")} colSpan={6}>
                  {periodHeader(t("competitors.periodA"), a)}
                </th>
                {b && (
                  <th scope="colgroup" className={cn(head, "border-s border-border/70")} colSpan={6}>
                    {periodHeader(t("competitors.periodB"), b)}
                  </th>
                )}
              </tr>
              <tr>
                {[a, b].filter(Boolean).map((_, i) => (
                  <PeriodHeads key={i} isOwn={isOwn} className={cn(head, "border-s border-border/70")} plain={head} />
                ))}
              </tr>
            </thead>
            <tbody>
              {platforms.map((platform) => (
                <tr key={platform} className="border-t border-border/70 align-top">
                  <th scope="row" className="px-3 py-2.5 text-start font-semibold">
                    <span className="flex items-center gap-2">
                      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-muted">{SOCIAL_PLATFORM_META[platform].icon("h-3.5 w-3.5")}</span>
                      {SOCIAL_PLATFORM_META[platform].name}
                    </span>
                  </th>
                  <PeriodCells p={on(a, platform)} isOwn={isOwn} posts={compare.data.posts} onRead={setReading} />
                  {b && <PeriodCells p={on(b, platform)} isOwn={isOwn} posts={compare.data.posts} onRead={setReading} />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {history.isLoading ? null : history.isError ? (
        <p className="text-sm text-destructive">{t("apiErr.loadCompetitorHistory")}</p>
      ) : scans.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("competitors.noHistoryYet")}</p>
      ) : chartPlatforms.length > 0 ? (
        <div className="flex flex-col gap-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted-foreground">{t("competitors.followersOverTime")}</span>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr))]">
            {chartPlatforms.map((platform) => {
              const measure = sparklinePoints(scans, platform, "followers").length > 0 ? "followers" : "own"
              return (
                <div key={platform} className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <span className="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-muted">{SOCIAL_PLATFORM_META[platform].icon("h-3.5 w-3.5")}</span>
                    {SOCIAL_PLATFORM_META[platform].name}
                    {measure === "own" && <span className="text-[11px] font-normal text-muted-foreground">{t("competitors.postsPerScan")}</span>}
                  </span>
                  <FollowerSparkline scans={scans} platform={platform} measure={measure} onPick={onOpenScan} />
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
      <SocialPostPreview post={reading} onOpenChange={(open) => !open && setReading(null)} />
    </div>
  )
}

/** The six metric headers of one period. */
function PeriodHeads({ isOwn, className, plain }: { readonly isOwn: boolean; readonly className: string; readonly plain: string }) {
  const t = useT()
  return (
    <>
      <th scope="col" className={className}>
        {t(isOwn ? "competitors.legendYours" : "competitors.legendTheirs")}
      </th>
      <th scope="col" className={plain}>
        {t(isOwn ? "competitors.legendAboutYou" : "competitors.legendAbout")}
      </th>
      <th scope="col" className={plain}>
        {t("competitors.colUsually")}
      </th>
      <th scope="col" className={plain}>
        {t("competitors.colFollowers")}
      </th>
      <th scope="col" className={plain}>
        {t("competitors.colWorked")}
      </th>
      <th scope="col" className={plain}>
        {t("competitors.bestPosts")}
      </th>
    </>
  )
}
