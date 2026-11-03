/**
 * Admin → Motion price check: every Nodaro Motion run of a range (at most 30
 * local days), what it held, what it took, that in USD, and what its steps
 * cost us, with the totals over the filtered runs.
 *
 * Every figure is computed by the platform (POST /v1/admin/motion-price-check/*);
 * the page filters, sorts, pages and rounds for display, nothing more.
 *
 * - A filter change goes back to the first page.
 * - KIE's own figures live in this page's state only: read once with a
 *   pasted token (the token lives in the KIE bar alone), sent back with each
 *   request, and dropped when the range moves. An answer for a range no
 *   longer shown is dropped too.
 * - A range the page refuses asks for nothing and shows nothing of the last
 *   one under its sentence.
 * - A failure the server answered is said in its own words, in place of the
 *   tables (the 503 while the database lacks the functions included).
 * - "Loading runs…" and "Updating…" are said in one live region that stays
 *   on the page.
 * - A run's button opens its drawer (`RunDrawer`): its steps, its quote's
 *   lines and what it reused, read with KIE's figures when they are in.
 * - The bottom's 80 px are the fixed accessibility button's (44 px, 16 px from
 *   the corner): without them it sits on Next at the end of the page.
 */
import { useId, useRef, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import type { KieRealResult, MotionPriceListParams } from "@/ee/lib/motion-price-check-api"
import { useFetchKieReal, useMotionPriceRuns } from "@/ee/hooks/queries/use-motion-price-check"
import { FiltersBar, type MotionPriceFilters } from "./filters-bar"
import { defaultRange, rangeProblem, rangeToIso } from "./format"
import { KieBar } from "./kie-bar"
import { RunDrawer } from "./run-drawer"
import { RunsTable } from "./runs-table"
import { TotalsTable } from "./totals-table"

const PAGE_SIZE = 50

/** A heading the focus can be put on (never tabbed to) shows it as a control would. */
const HEADING_FOCUS = "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

function initialFilters(now: Date): MotionPriceFilters {
  return {
    ...defaultRange(now),
    engine: "all",
    style: "all",
    kind: "all",
    resolution: "all",
    flaggedOnly: false,
    sort: "margin_usd",
    dir: "asc",
  }
}

/** The request for a page: a filter on "all" is no key at all; `flaggedOnly: false` is no filter. */
function listParamsOf(f: MotionPriceFilters, range: { from: string; to: string }, offset: number): MotionPriceListParams {
  return {
    ...range,
    ...(f.engine !== "all" ? { engine: f.engine } : {}),
    ...(f.style !== "all" ? { style: f.style } : {}),
    ...(f.kind !== "all" ? { kind: f.kind } : {}),
    ...(f.resolution !== "all" ? { resolution: f.resolution } : {}),
    flaggedOnly: f.flaggedOnly,
    sort: f.sort,
    dir: f.dir,
    offset,
    limit: PAGE_SIZE,
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message !== "" ? error.message : "Something went wrong."

export default function AdminMotionPriceCheck() {
  const [filters, setFilters] = useState(() => initialFilters(new Date()))
  const [offset, setOffset] = useState(0)
  const [kie, setKie] = useState<KieRealResult | null>(null)
  const [kieError, setKieError] = useState<string | null>(null)
  // The run whose steps are open.
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const kieFetch = useFetchKieReal()
  // Moves with every range change and every fetch: only the latest fetch, for the range shown, lands.
  const kieTurn = useRef(0)
  const totalsHeadingId = useId()

  const rangeError = rangeProblem(filters.fromDay, filters.toDay)
  const range = rangeError === null ? rangeToIso(filters.fromDay, filters.toDay) : null
  const params = range === null ? null : listParamsOf(filters, range, offset)
  const list = useMotionPriceRuns(params, kie)
  // What the live region says: the first page loading, or another one loading over the rows shown.
  const loading =
    params === null || list.isError ? null : list.data === undefined ? "Loading runs…" : list.isFetching ? "Updating…" : null

  function changeFilters(next: MotionPriceFilters) {
    if (next.fromDay !== filters.fromDay || next.toDay !== filters.toDay) {
      kieTurn.current += 1
      setKie(null)
      setKieError(null)
      kieFetch.reset()
    }
    setFilters(next)
    setOffset(0)
  }

  async function fetchKie(token: string) {
    if (range === null) return
    kieTurn.current += 1
    const turn = kieTurn.current
    setKieError(null)
    try {
      const result = await kieFetch.mutateAsync({ token, from: range.from, to: range.to })
      if (kieTurn.current === turn) setKie(result)
    } catch (error) {
      if (kieTurn.current === turn) setKieError(messageOf(error))
    } finally {
      // The mutation's variables hold the token: let it go once its answer is in this page's state.
      if (kieTurn.current === turn) kieFetch.reset()
    }
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6 px-4 pb-20 pt-4 sm:px-6 sm:pt-6">
      <header className="space-y-1">
        {/* Focusable by script only: where a run's drawer gives the focus back when there is no list to return to. */}
        <h1 data-page-heading tabIndex={-1} className={`text-xl font-bold ${HEADING_FOCUS}`}>
          Motion price check
        </h1>
        <p className="text-sm text-muted-foreground">
          Each Nodaro Motion run: what it held, what it took, what that is worth, and what we paid for its steps.
        </p>
      </header>

      <FiltersBar value={filters} onChange={changeFilters} rangeError={rangeError} />

      <KieBar
        kie={kie}
        pending={kieFetch.isPending}
        error={kieError}
        onFetch={(token) => void fetchKie(token)}
        disabled={range === null}
      />

      <div className="space-y-2">
        {/* One live region that stays on the page (a region inserted with its text is announced less reliably). */}
        <p role="status" className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground">
          {loading !== null && (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {loading}
            </>
          )}
        </p>
        {params === null ? null : list.isError ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
            <p className="min-w-0 break-words text-sm text-red-700 dark:text-red-400">{messageOf(list.error)}</p>
          </div>
        ) : list.data === undefined ? null : (
          <div className="space-y-6">
            <section className="space-y-2">
              <h2 id={totalsHeadingId} className="text-sm font-semibold">
                Totals
              </h2>
              <TotalsTable totals={list.data.totals} labelledBy={totalsHeadingId} />
            </section>
            <section className="space-y-2">
              {/* Where a run's drawer gives the focus back when the run's button has left the page. */}
              <h2 data-runs-heading tabIndex={-1} className={`text-sm font-semibold ${HEADING_FOCUS}`}>
                Runs
              </h2>
              <RunsTable
                runs={list.data.runs}
                total={list.data.total}
                offset={offset}
                limit={PAGE_SIZE}
                onPage={setOffset}
                onOpen={setSelectedRunId}
                openRunId={selectedRunId}
              />
            </section>
          </div>
        )}
      </div>

      {/* Outside the list's states, so a new answer for the list never closes it. */}
      <RunDrawer runId={selectedRunId} kie={kie} onClose={() => setSelectedRunId(null)} />
    </div>
  )
}
