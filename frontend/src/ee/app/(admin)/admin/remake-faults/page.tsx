/**
 * Admin → Remake faults: every Video Remake run of a range (at most 30 local
 * days) that recorded a fault — a blur left on, an unblurred clip refused, a
 * face check unsure or failing, an intent overridden — newest first, its
 * faults worst first, each run linked to its job page.
 *
 * Read from the platform (GET /v1/admin/remake-faults); the page filters and
 * pages, nothing more.
 *
 * - A filter change goes back to the first page.
 * - A range the page refuses asks for nothing and shows nothing of the last
 *   one under its sentence.
 * - A failure the server answered is said in its own words, in place of the
 *   table (the 503 while the database lacks the function included).
 * - "Loading runs…" and "Updating…" are said in one live region that stays
 *   on the page.
 * - The bottom's 80 px are the fixed accessibility button's (the price check's).
 */
import { useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import type { RemakeFaultListParams } from "@/ee/lib/remake-faults-api"
import { useRemakeFaults } from "@/ee/hooks/queries/use-remake-faults"
import { defaultRange, rangeProblem, rangeToIso } from "../motion-price-check/format"
import { FaultsTable } from "./faults-table"
import { FiltersBar, type RemakeFaultFilters } from "./filters-bar"

const PAGE_SIZE = 50

function initialFilters(now: Date): RemakeFaultFilters {
  return { ...defaultRange(now), severity: "all", kind: "", engine: "all" }
}

/** The request for a page: a filter on "all" (or no kind) is no key at all. */
function listParamsOf(f: RemakeFaultFilters, range: { from: string; to: string }, offset: number): RemakeFaultListParams {
  return {
    ...range,
    ...(f.severity !== "all" ? { severity: f.severity } : {}),
    ...(f.kind !== "" ? { kind: f.kind } : {}),
    ...(f.engine !== "all" ? { engine: f.engine } : {}),
    offset,
    limit: PAGE_SIZE,
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message !== "" ? error.message : "Something went wrong."

export default function AdminRemakeFaults() {
  const [filters, setFilters] = useState(() => initialFilters(new Date()))
  const [offset, setOffset] = useState(0)

  const rangeError = rangeProblem(filters.fromDay, filters.toDay)
  const range = rangeError === null ? rangeToIso(filters.fromDay, filters.toDay) : null
  const params = range === null ? null : listParamsOf(filters, range, offset)
  const list = useRemakeFaults(params)
  const loading =
    params === null || list.isError ? null : list.data === undefined ? "Loading runs…" : list.isFetching ? "Updating…" : null

  function changeFilters(next: RemakeFaultFilters) {
    setFilters(next)
    setOffset(0)
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-7xl space-y-6 px-4 pb-20 pt-4 sm:px-6 sm:pt-6">
      <header className="space-y-1">
        <h1 className="text-xl font-bold">Video Remake faults</h1>
        <p className="text-sm text-muted-foreground">
          Each Video Remake run that recorded a fault, newest first: what went wrong, how bad it was, and the job to open.
        </p>
      </header>

      <FiltersBar value={filters} kinds={list.data?.kinds ?? []} onChange={changeFilters} rangeError={rangeError} />

      <div className="space-y-2">
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
          <FaultsTable runs={list.data.runs} total={list.data.total} offset={offset} limit={PAGE_SIZE} onPage={setOffset} />
        )}
      </div>
    </div>
  )
}
