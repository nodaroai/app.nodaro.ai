import type { TrendCandidateLabel, TrendCandidateReading, TrendCandidateStatus } from "@nodaro/sdk/trend-radar"
import { cn } from "@/lib/utils"
import { formatDay, formatPlays } from "./format"

const LABELS: Record<TrendCandidateLabel, { text: string; className: string }> = {
  hot: { text: "Hot", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
  rising: { text: "Rising", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  watching: { text: "Watching", className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" },
  new: { text: "New", className: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" },
  slowing: { text: "Slowing", className: "bg-muted text-muted-foreground" },
}

const DECIDED: Partial<Record<TrendCandidateStatus, { text: string; className: string }>> = {
  approved: { text: "Approved", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  rejected: { text: "Rejected", className: "bg-muted text-muted-foreground line-through" },
  archived: { text: "Archived", className: "bg-muted text-muted-foreground" },
}

/** The pill a card carries: its decision when one was made, else its reading's label. */
export function StatusPill({ status, label }: { status: TrendCandidateStatus; label: TrendCandidateLabel }) {
  const pill = DECIDED[status] ?? LABELS[label]
  return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap", pill.className)}>{pill.text}</span>
}

export function Tile({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 min-w-0">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="mt-1 text-2xl font-bold leading-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{hint}</div>
    </div>
  )
}

export function Card({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border bg-card p-4 min-w-0", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

const W = 640
const H = 170
const LEFT = 40
const RIGHT = 620
const BASE = 140
const TOP = 30

/**
 * The daily readings: distinct creators as bars, summed plays as a line.
 * Pure SVG, scaled to the readings' own maxima; the newest reading is the
 * darkest bar and carries the plays figure.
 */
export function ReadingsChart({ readings }: { readings: readonly TrendCandidateReading[] }) {
  if (readings.length === 0) return <p className="text-sm text-muted-foreground">No readings yet — the next daily run reads this candidate.</p>
  const last = readings.slice(-14)
  const maxCreators = Math.max(1, ...last.map((r) => r.creators))
  const maxPlays = Math.max(1, ...last.map((r) => r.plays))
  const slot = (RIGHT - LEFT) / last.length
  const barW = Math.min(28, slot * 0.5)
  const x = (i: number) => LEFT + slot * i + slot / 2
  const barY = (c: number) => BASE - ((BASE - TOP) * c) / maxCreators
  const lineY = (p: number) => BASE - ((BASE - TOP) * p) / maxPlays
  const points = last.map((r, i) => `${x(i)},${lineY(r.plays)}`).join(" ")
  const newest = last[last.length - 1]!
  const summary = `Creators ${last[0]!.creators} to ${newest.creators}, plays ${formatPlays(last[0]!.plays)} to ${formatPlays(newest.plays)} over ${last.length} readings`
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={summary}>
        <line x1={LEFT} y1={BASE} x2={RIGHT} y2={BASE} stroke="currentColor" opacity="0.15" />
        <line x1={LEFT} y1={(BASE + TOP) / 2} x2={RIGHT} y2={(BASE + TOP) / 2} stroke="currentColor" opacity="0.07" />
        <text x="8" y={BASE + 4} fontSize="11" fill="currentColor" opacity="0.5">0</text>
        <text x="8" y={TOP + 4} fontSize="11" fill="currentColor" opacity="0.5">{maxCreators}</text>
        {last.map((r, i) => (
          <rect key={r.date} x={x(i) - barW / 2} y={barY(r.creators)} width={barW} height={BASE - barY(r.creators)} fill="currentColor" opacity={0.25 + (0.6 * (i + 1)) / last.length} />
        ))}
        <polyline points={points} fill="none" stroke="#ff0073" strokeWidth="2.5" />
        <circle cx={x(last.length - 1)} cy={lineY(newest.plays)} r="4" fill="#ff0073" />
        <text x={Math.min(x(last.length - 1), RIGHT - 4)} y={Math.max(lineY(newest.plays) - 8, 12)} fontSize="11" fill="#e0006f" textAnchor="end">{formatPlays(newest.plays)}</text>
        <text x={x(0)} y={BASE + 18} fontSize="11" fill="currentColor" opacity="0.5" textAnchor="middle">{formatDay(last[0]!.date)}</text>
        {last.length > 1 && (
          <text x={x(last.length - 1)} y={BASE + 18} fontSize="11" fill="currentColor" opacity="0.5" textAnchor="middle">{formatDay(newest.date)}</text>
        )}
      </svg>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-1">
        <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-foreground me-1.5 align-[-1px]" />Distinct creators</span>
        <span><span className="inline-block w-3.5 h-0.5 bg-[#ff0073] me-1.5 align-[3px]" />Plays, top posts</span>
      </div>
    </div>
  )
}
