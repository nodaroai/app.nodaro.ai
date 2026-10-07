"use client"

import type { CompetitorHistoryPoint, SocialPlatform } from "@nodaro/shared"
import { useT } from "@/lib/i18n"
import { formatDate, formatNumber } from "@/lib/i18n/format"
import { cn } from "@/lib/utils"

export type SparklineMeasure = "followers" | "own"

const WIDTH = 240
const HEIGHT = 40
const PAD = 5

/** The scans that carry the measure on the platform, in order, with their value. */
export function sparklinePoints(scans: readonly CompetitorHistoryPoint[], platform: SocialPlatform, measure: SparklineMeasure) {
  return scans.flatMap((scan) => {
    const here = scan.platforms.find((p) => p.platform === platform)
    const value = here?.[measure]
    return typeof value === "number" ? [{ id: scan.id, at: scan.at, value }] : []
  })
}

/**
 * One line through the scans: the account's followers (or its posts found)
 * on a platform, scan after scan. Each point opens that scan.
 */
export function FollowerSparkline({
  scans,
  platform,
  measure,
  onPick,
  className,
}: {
  readonly scans: readonly CompetitorHistoryPoint[]
  readonly platform: SocialPlatform
  readonly measure: SparklineMeasure
  readonly onPick: (scanId: string) => void
  readonly className?: string
}) {
  const t = useT()
  const points = sparklinePoints(scans, platform, measure)
  if (points.length === 0) return null
  const values = points.map((p) => p.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (i: number) => (points.length === 1 ? WIDTH / 2 : PAD + (i * (WIDTH - 2 * PAD)) / (points.length - 1))
  const y = (v: number) => HEIGHT - PAD - ((v - min) / span) * (HEIGHT - 2 * PAD)
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")
  const dateOf = (iso: string) => formatDate(Date.parse(iso), { month: "short", day: "numeric" })
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={cn("h-10 w-full max-w-[240px] overflow-visible", className)} role="group" aria-label={t(measure === "followers" ? "competitors.followersOverTime" : "competitors.postsPerScan")}>
      {points.length > 1 && <polyline points={line} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-primary" />}
      {points.map((p, i) => (
        <circle
          key={p.id}
          cx={x(i)}
          cy={y(p.value)}
          r={3.5}
          className="cursor-pointer fill-card stroke-primary stroke-[1.5] outline-none hover:fill-primary focus-visible:fill-primary"
          tabIndex={0}
          role="button"
          aria-label={`${t("competitors.openScanOf", { date: dateOf(p.at) })} · ${formatNumber(p.value)}`}
          onClick={() => onPick(p.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault()
              onPick(p.id)
            }
          }}
        >
          <title>{`${dateOf(p.at)} · ${formatNumber(p.value)}`}</title>
        </circle>
      ))}
    </svg>
  )
}
