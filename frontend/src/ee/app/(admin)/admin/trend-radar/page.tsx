// Admin → Trend Radar: the candidates the daily run found, with the run's
// tiles, a status filter and a sort. Nothing reaches the catalog from here:
// "Review" opens the candidate, and only its "Open as draft trend" creates a
// draft trend (in the trends admin, where the source clip is finished).
// Everything on this page comes through the SDK's `trendRadar` resource.

import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import type { TrendCandidateSort, TrendCandidateStatus } from "@nodaro/sdk/trend-radar"
import { Loader2, RefreshCw, Settings2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatDay, formatDayChange, formatPlays, formatSeconds, formatWhen } from "./format"
import { StatusPill, Tile } from "./parts"
import { QUEUE_FILTERS, radarUnavailable, useRadarCandidates, useRadarSummary, useRunRadar } from "./use-trend-radar"

const SORTS: ReadonlyArray<{ key: TrendCandidateSort; label: string }> = [
  { key: "creators", label: "Creators, most first" },
  { key: "dayChange", label: "Day change" },
  { key: "firstSeen", label: "First seen" },
]

export default function AdminTrendRadarPage() {
  const [filter, setFilter] = useState<"all" | TrendCandidateStatus>("all")
  const [sort, setSort] = useState<TrendCandidateSort>("creators")
  // A run just started here re-reads the page for a while (the run is asynchronous).
  const [polling, setPolling] = useState(false)
  const summary = useRadarSummary(polling)
  const candidates = useRadarCandidates({ ...(filter === "all" ? {} : { status: filter }), sort }, polling)
  const run = useRunRadar()

  useEffect(() => {
    if (!polling) return
    const stop = setTimeout(() => setPolling(false), 5 * 60_000)
    return () => clearTimeout(stop)
  }, [polling])

  const unavailable = radarUnavailable(summary.error) || radarUnavailable(candidates.error)
  const rows = candidates.data?.data ?? []
  const maxCreators = Math.max(1, ...rows.map((c) => c.creators))
  const counts = summary.data?.counts

  const runNow = () => {
    run.mutate(undefined, {
      onSuccess: () => {
        setPolling(true)
        toast.success("The run started. The tiles and the queue re-read every few seconds while it runs.")
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "The run could not start"),
    })
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Trend Radar</h1>
          <p className="text-sm text-muted-foreground">Candidates found by the daily run. Nothing reaches the catalog without an approval here.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(summary.isFetching || candidates.isFetching) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />}
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/trend-radar/settings">
              <Settings2 className="h-4 w-4 me-2" />
              Sources &amp; thresholds
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={runNow} disabled={run.isPending || unavailable}>
            <RefreshCw className={cn("h-4 w-4 me-2", run.isPending && "animate-spin")} />
            Run now
          </Button>
        </div>
      </div>

      {unavailable ? (
        <p className="text-sm text-muted-foreground">Trend Radar is not available on this server yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile
              title="Last run"
              value={formatWhen(summary.data?.lastRun?.at ?? null)}
              hint={summary.data?.lastRun ? `${summary.data.lastRun.sourcesRead} sources read · ${summary.data.lastRun.namesSeen} names seen` : "no run yet"}
            />
            <Tile title="Candidates" value={String(counts?.candidates ?? "—")} hint="passed the creator threshold" />
            <Tile title="Watching" value={String(counts?.watching ?? "—")} hint="re-read every morning" />
            <Tile
              title="Searches today"
              value={String(summary.data?.searchesToday ?? "—")}
              hint={summary.data ? `of ${summary.data.dailySearchBudget} daily budget` : ""}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Status">
              {QUEUE_FILTERS.map((f) => {
                const count = f.key === "candidate" ? counts?.candidates : f.key === "watching" ? counts?.watching : f.key === "slowing" ? counts?.slowing : undefined
                return (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={filter === f.key}
                    onClick={() => setFilter(f.key)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm min-h-8",
                      filter === f.key ? "bg-foreground text-background border-foreground" : "bg-card hover:bg-accent",
                    )}
                  >
                    {f.label}
                    {count !== undefined && <span className="tabular-nums opacity-70">· {count}</span>}
                  </button>
                )
              })}
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Sort</span>
              <Select value={sort} onValueChange={(v) => setSort(v as TrendCandidateSort)}>
                <SelectTrigger className="h-8 w-[190px]" aria-label="Sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          <div className="rounded-lg border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="text-start font-medium px-3 py-2.5">Trend</th>
                  <th className="text-start font-medium px-3 py-2.5">First seen</th>
                  <th className="text-start font-medium px-3 py-2.5">Creators</th>
                  <th className="text-start font-medium px-3 py-2.5">Plays</th>
                  <th className="text-start font-medium px-3 py-2.5">Day change</th>
                  <th className="text-start font-medium px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {candidates.isLoading && !candidates.data ? (
                  <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline-block" aria-label="Loading" /></td></tr>
                ) : candidates.error ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-destructive">{candidates.error.message}</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">Nothing here yet. The daily run adds candidates as new template pages and clips appear.</td></tr>
                ) : (
                  rows.map((c) => {
                    const decided = c.status === "rejected" || c.status === "archived"
                    return (
                      <tr key={c.id} className={cn("border-b last:border-b-0", decided && "text-muted-foreground")}>
                        <td className="px-3 py-3 min-w-[220px]">
                          <Link to={`/admin/trend-radar/${c.id}`} className="font-semibold hover:underline">{c.name}</Link>
                          <div className="text-xs text-muted-foreground">
                            {c.soundName ? `sound: "${c.soundName}"` : "sound: original"} · {formatSeconds(c.durationSec)}
                          </div>
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{c.firstSeen.name} · {formatDay(c.firstSeen.firstSeenAt)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <span className="tabular-nums font-semibold w-6">{c.creators}</span>
                            <span className="h-1.5 w-[72px] rounded bg-muted overflow-hidden" aria-hidden="true">
                              <span className="block h-full bg-foreground" style={{ width: `${Math.round((100 * c.creators) / maxCreators)}%` }} />
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 tabular-nums">{formatPlays(c.plays)}</td>
                        <td className={cn("px-3 py-3 tabular-nums", (c.dayChangePct ?? 0) > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>{formatDayChange(c.dayChangePct)}</td>
                        <td className="px-3 py-3"><StatusPill status={c.status} label={c.label} /></td>
                        <td className="px-3 py-3 whitespace-nowrap text-end">
                          {c.status === "approved" && c.trendId ? (
                            <Button size="sm" variant="outline" asChild><Link to={`/admin/trends/${c.trendId}`}>Open draft</Link></Button>
                          ) : (
                            <Button size="sm" variant={c.status === "candidate" ? "default" : "outline"} asChild><Link to={`/admin/trend-radar/${c.id}`}>Review</Link></Button>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          {candidates.data?.next && <p className="text-xs text-muted-foreground">Showing the first {rows.length}. Narrow the filter to see the rest.</p>}
          <p className="text-xs text-muted-foreground">Plays are read logged out, once a day; where a site hides views, likes are counted instead. Readings are deleted after the retention period.</p>
        </>
      )}
    </div>
  )
}
