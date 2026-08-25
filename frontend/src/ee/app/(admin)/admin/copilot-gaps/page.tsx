import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, RefreshCw, GraduationCap, ArrowLeftRight, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { hasAdmin } from "@/lib/edition"
import { getAuthHeaders } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"

/**
 * Daily copilot knowledge-gap report. The day strip answers "what did the
 * copilot hit yesterday / a week ago"; the compare mode answers "what got
 * resolved between two days" — a bucket that stopped appearing after a
 * teaching change is the improvement, its sample text is the why.
 * Day windows are UTC, mined live from copilot_messages.
 */

interface DaySummary {
  day: string
  messages: number
  rejections: number
  adjustments: number
  turnFailures: number
}

interface GapBucket {
  key: string
  count: number
  threads: string[]
  sample: string
}

interface DayReport {
  day: string
  scannedMessages: number
  truncated: boolean
  rejections: GapBucket[]
  adjustments: GapBucket[]
  turnFailures: Array<{ title: string; count: number }>
}

function useGapsOverview(days: number) {
  return useQuery({
    queryKey: queryKeys.admin.copilotGapsOverview(days),
    queryFn: async (): Promise<{ days: DaySummary[]; truncated: boolean }> => {
      const res = await fetch(`/v1/admin/copilot-gaps/overview?days=${days}`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch the gaps overview")
      return res.json()
    },
    enabled: hasAdmin(),
    staleTime: 60_000,
  })
}

function useGapsDay(day: string | null) {
  return useQuery({
    queryKey: queryKeys.admin.copilotGapsDay(day ?? ""),
    queryFn: async (): Promise<DayReport> => {
      const res = await fetch(`/v1/admin/copilot-gaps?day=${day}`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw new Error("Failed to fetch the day report")
      return res.json()
    },
    enabled: hasAdmin() && day !== null,
    staleTime: 60_000,
  })
}

function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
}

function weekdayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00.000Z`)
  return d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })
}

function DayTile({
  summary,
  selected,
  compared,
  onClick,
}: {
  summary: DaySummary
  selected: boolean
  compared: boolean
  onClick: () => void
}) {
  const quiet = summary.messages === 0
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 rounded-lg border px-3 py-2 min-w-[84px] transition-colors",
        selected
          ? "border-primary bg-primary/10"
          : compared
            ? "border-blue-500 bg-blue-500/10"
            : "bg-card hover:bg-muted/50",
        quiet && !selected && !compared && "opacity-60",
      )}
    >
      <span className="text-[10px] uppercase text-muted-foreground">{weekdayLabel(summary.day)}</span>
      <span className="text-sm font-medium">{dayLabel(summary.day)}</span>
      <span className="text-[10px] text-muted-foreground">{summary.messages} msg</span>
      <div className="flex items-center gap-1.5 text-[10px] font-mono">
        <span className={summary.rejections > 0 ? "text-destructive" : "text-muted-foreground"}>
          {summary.rejections}
        </span>
        <span className={summary.adjustments > 0 ? "text-amber-500" : "text-muted-foreground"}>
          {summary.adjustments}
        </span>
        <span className={summary.turnFailures > 0 ? "text-orange-500" : "text-muted-foreground"}>
          {summary.turnFailures}
        </span>
      </div>
    </button>
  )
}

function BucketTable({ title, tone, buckets }: { title: string; tone: "reject" | "heal"; buckets: GapBucket[] }) {
  if (buckets.length === 0) {
    return (
      <div className="border rounded-lg p-4 bg-card">
        <h2 className="text-sm font-medium mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground">None on this day.</p>
      </div>
    )
  }
  return (
    <div className="border rounded-lg p-4 bg-card">
      <h2 className="text-sm font-medium mb-3">{title}</h2>
      <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
        {buckets.map((b) => (
          <div key={b.key} className="border rounded-md p-3 bg-background/50">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium break-words">{b.key}</p>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-mono",
                  tone === "reject" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-600",
                )}
              >
                ×{b.count}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {b.threads.length} thread{b.threads.length !== 1 ? "s" : ""}
            </p>
            {b.sample && b.sample !== b.key && (
              <p className="text-xs text-muted-foreground mt-1.5 font-mono break-words line-clamp-3">{b.sample}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Bucket diff between two days: resolved = improvement, new = regression. */
function CompareDiff({ older, newer }: { older: DayReport; newer: DayReport }) {
  const diff = useMemo(() => {
    const section = (a: GapBucket[], b: GapBucket[]) => {
      const bByKey = new Map(b.map((x) => [x.key, x]))
      const aByKey = new Map(a.map((x) => [x.key, x]))
      return {
        resolved: a.filter((x) => !bByKey.has(x.key)),
        appeared: b.filter((x) => !aByKey.has(x.key)),
        persisting: b
          .filter((x) => aByKey.has(x.key))
          .map((x) => ({ ...x, delta: x.count - (aByKey.get(x.key)?.count ?? 0) })),
      }
    }
    return {
      rejections: section(older.rejections, newer.rejections),
      adjustments: section(older.adjustments, newer.adjustments),
    }
  }, [older, newer])

  const rows: Array<{ label: string; cls: string; items: Array<{ key: string; note: string }> }> = [
    {
      label: `Resolved since ${dayLabel(older.day)} (stopped appearing)`,
      cls: "text-green-600",
      items: [...diff.rejections.resolved, ...diff.adjustments.resolved].map((b) => ({
        key: b.key,
        note: `was ×${b.count}`,
      })),
    },
    {
      label: `New on ${dayLabel(newer.day)}`,
      cls: "text-destructive",
      items: [...diff.rejections.appeared, ...diff.adjustments.appeared].map((b) => ({
        key: b.key,
        note: `×${b.count}`,
      })),
    },
    {
      label: "Still occurring",
      cls: "text-amber-600",
      items: [...diff.rejections.persisting, ...diff.adjustments.persisting].map((b) => ({
        key: b.key,
        note: b.delta === 0 ? `×${b.count} (unchanged)` : `×${b.count} (${b.delta > 0 ? "+" : ""}${b.delta})`,
      })),
    },
  ]

  return (
    <div className="border rounded-lg p-4 bg-card">
      <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
        <ArrowLeftRight className="h-4 w-4" />
        {dayLabel(older.day)} → {dayLabel(newer.day)}
      </h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {rows.map((row) => (
          <div key={row.label}>
            <p className={cn("text-xs font-medium mb-2", row.cls)}>{row.label}</p>
            {row.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {row.items.map((item) => (
                  <li key={item.key} className="text-xs break-words">
                    <span className="font-mono text-muted-foreground mr-1">{item.note}</span>
                    {item.key}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function AdminCopilotGapsPage() {
  const [days, setDays] = useState(14)
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [compareDay, setCompareDay] = useState<string | null>(null)
  const [compareArmed, setCompareArmed] = useState(false)

  const overview = useGapsOverview(days)
  const strip = overview.data?.days ?? []
  const activeDay = selectedDay ?? strip[strip.length - 1]?.day ?? null
  const dayReport = useGapsDay(activeDay)
  const compareReport = useGapsDay(compareDay)

  const handleTileClick = (day: string) => {
    if (compareArmed) {
      if (day !== activeDay) setCompareDay(day)
      setCompareArmed(false)
      return
    }
    setSelectedDay(day)
    if (compareDay === day) setCompareDay(null)
  }

  const orderedPair = useMemo(() => {
    if (!dayReport.data || !compareReport.data || !compareDay || !activeDay) return null
    return compareDay < activeDay
      ? { older: compareReport.data, newer: dayReport.data }
      : { older: dayReport.data, newer: compareReport.data }
  }, [dayReport.data, compareReport.data, compareDay, activeDay])

  if (overview.isLoading && !overview.data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <GraduationCap className="h-5 w-5" />
          Copilot Knowledge Gaps
        </h1>
        <div className="flex items-center gap-2">
          {[7, 14, 30].map((d) => (
            <Button key={d} variant={days === d ? "default" : "outline"} size="sm" onClick={() => setDays(d)}>
              {d}d
            </Button>
          ))}
          <Button variant="outline" size="sm" onClick={() => overview.refetch()} disabled={overview.isRefetching}>
            <RefreshCw className={cn("h-4 w-4", overview.isRefetching && "animate-spin")} />
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        What the copilot's edits got rejected on, what the server had to heal, and what failed outright — per UTC
        day. Counts per tile: <span className="text-destructive">rejections</span>{" "}
        <span className="text-amber-500">heals</span> <span className="text-orange-500">turn failures</span>.
      </p>

      {overview.data?.truncated && (
        <p className="text-xs text-amber-600 mb-2">
          Scan cap hit for this window — the oldest days shown may be undercounted.
        </p>
      )}

      <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
        {strip.map((s) => (
          <DayTile
            key={s.day}
            summary={s}
            selected={s.day === activeDay}
            compared={s.day === compareDay}
            onClick={() => handleTileClick(s.day)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4">
        {compareDay ? (
          <Button variant="outline" size="sm" onClick={() => setCompareDay(null)}>
            <X className="h-4 w-4 mr-1" />
            Comparing with {dayLabel(compareDay)}
          </Button>
        ) : (
          <Button
            variant={compareArmed ? "default" : "outline"}
            size="sm"
            onClick={() => setCompareArmed((v) => !v)}
          >
            <ArrowLeftRight className="h-4 w-4 mr-1" />
            {compareArmed ? "Pick a day to compare…" : "Compare days"}
          </Button>
        )}
      </div>

      {orderedPair && <div className="mb-4"><CompareDiff older={orderedPair.older} newer={orderedPair.newer} /></div>}

      {dayReport.isLoading && !dayReport.data ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : dayReport.data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Messages scanned", value: dayReport.data.scannedMessages, cls: "" },
              { label: "Rejection hits", value: dayReport.data.rejections.reduce((t, b) => t + b.count, 0), cls: "text-destructive" },
              { label: "Heal hits", value: dayReport.data.adjustments.reduce((t, b) => t + b.count, 0), cls: "text-amber-500" },
              { label: "Turn failures", value: dayReport.data.turnFailures.reduce((t, f) => t + f.count, 0), cls: "text-orange-500" },
            ].map((card) => (
              <div key={card.label} className="border rounded-lg p-4 bg-card">
                <p className="text-sm text-muted-foreground">{card.label}</p>
                <p className={cn("text-2xl font-bold", card.cls)}>{card.value.toLocaleString()}</p>
              </div>
            ))}
          </div>

          {dayReport.data.truncated && (
            <p className="text-xs text-amber-600">
              This day exceeded the scan cap — counts are a floor, not a total.
            </p>
          )}

          {dayReport.data.scannedMessages === 0 ? (
            <div className="border rounded-lg p-6 bg-card text-muted-foreground text-sm">
              No copilot activity on {dayLabel(dayReport.data.day)} (UTC).
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BucketTable
                title="Rejections — edits the server refused (teach these)"
                tone="reject"
                buckets={dayReport.data.rejections}
              />
              <BucketTable
                title="Heals — accepted but auto-corrected (near-misses)"
                tone="heal"
                buckets={dayReport.data.adjustments}
              />
            </div>
          )}

          {dayReport.data.turnFailures.length > 0 && (
            <div className="border rounded-lg p-4 bg-card">
              <h2 className="text-sm font-medium mb-3">Turn failures</h2>
              <ul className="space-y-1.5">
                {dayReport.data.turnFailures.map((f) => (
                  <li key={f.title} className="text-sm flex items-start gap-2">
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-mono bg-orange-500/10 text-orange-600">
                      ×{f.count}
                    </span>
                    <span className="break-words">{f.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
