// Admin → Trend Radar: the candidates the daily run found, with the run's
// tiles, and the queue as a gallery (the default) or a table. The status is
// read from the server one list at a time; the platform, site, views, age,
// search and sort run over the loaded cards, and all of it lives in the
// page's address. A tile opens the viewer, where the post plays and the
// candidate is decided. Nothing reaches the catalog from here without an
// approval, and only "Open as draft trend" creates a draft trend (in the
// trends admin, where the source clip is finished). Everything on this page
// comes through the SDK's `trendRadar` resource.

import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { Loader2, RefreshCw, Settings2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { searchesHint } from "./daily-reading"
import { formatWhen } from "./format"
import { Tile } from "./parts"
import { QueueGallery } from "./queue-gallery"
import { QueueTable } from "./queue-table"
import { QueueToolbar } from "./queue-toolbar"
import { filterCards, platformCounts, readFilters, sortCards, sourceNames, writeFilters, type QueueFilters } from "./queue-view"
import { QueueViewer } from "./queue-viewer"
import { radarUnavailable, useRadarQueue, useRadarSummary, useRunRadar } from "./use-trend-radar"

const OPEN_PARAM = "open"

export default function AdminTrendRadarPage() {
  const [params, setParams] = useSearchParams()
  const filters = readFilters(params)
  const openId = params.get(OPEN_PARAM)
  // A run just started here re-reads the page for a while (the run is asynchronous).
  const [polling, setPolling] = useState(false)
  const summary = useRadarSummary(polling)
  const queue = useRadarQueue(filters.status === "all" ? undefined : filters.status, polling)
  const run = useRunRadar()

  useEffect(() => {
    if (!polling) return
    const stop = setTimeout(() => setPolling(false), 5 * 60_000)
    return () => clearTimeout(stop)
  }, [polling])

  const write = (next: QueueFilters, open: string | null) => {
    const p = writeFilters(next)
    if (open) p.set(OPEN_PARAM, open)
    setParams(p, { replace: true })
  }
  const setFilters = (next: QueueFilters) => write(next, null)
  const setOpenId = (id: string | null) => write(filters, id)

  const cards = queue.data?.cards ?? []
  // A few hundred cards at most: filtering and sorting them on each render costs nothing.
  const shown = sortCards(filterCards(cards, filters, new Date()), filters.sort, filters.platform)
  const sources = sourceNames(cards)
  const perPlatform = platformCounts(cards)

  const unavailable = radarUnavailable(summary.error) || radarUnavailable(queue.error)
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
          {(summary.isFetching || queue.isFetching) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />}
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/trend-radar/settings">
              <Settings2 className="h-4 w-4 me-2" />
              Settings
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
              warning={summary.data?.lastRun?.stoppedEarly ?? undefined}
            />
            <Tile title="Candidates" value={String(counts?.candidates ?? "—")} hint="passed the creator threshold" />
            <Tile title="Watching" value={String(counts?.watching ?? "—")} hint="re-read every morning" />
            <Tile
              title="Searches today"
              value={String(summary.data?.searchesToday ?? "—")}
              hint={summary.data ? searchesHint(summary.data.dailySearchBudget, summary.data.reading?.searchesPerRead) : ""}
            />
          </div>

          <QueueToolbar filters={filters} onChange={setFilters} counts={counts} platformCounts={perPlatform} total={cards.length} sources={sources} shown={shown.length} />

          {queue.isLoading && !queue.data ? (
            <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" /></div>
          ) : queue.error ? (
            <p className="py-8 text-center text-sm text-destructive">{queue.error.message}</p>
          ) : cards.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing here yet. The daily run adds candidates as new template pages and clips appear.</p>
          ) : shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No candidate matches these filters.</p>
          ) : filters.view === "gallery" ? (
            <QueueGallery cards={shown} platform={filters.platform} onOpen={setOpenId} />
          ) : (
            <QueueTable cards={shown} platform={filters.platform} onOpen={setOpenId} />
          )}

          {queue.data && !queue.data.complete && <p className="text-xs text-muted-foreground">Showing the first {cards.length}. Pick a status to see the rest.</p>}
          <p className="text-xs text-muted-foreground">
            Views are read logged out; where a site hides views (Instagram), likes are counted instead. Growth is measured on the same posts from one reading to the next. Readings are deleted after the retention period.
          </p>

          <QueueViewer cards={shown} openId={openId} platform={filters.platform} onOpenId={setOpenId} />
        </>
      )}
    </div>
  )
}
