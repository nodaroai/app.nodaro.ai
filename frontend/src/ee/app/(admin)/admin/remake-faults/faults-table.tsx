/**
 * Admin → Remake faults: one page of the range's faulted runs, newest first
 * (the server's order), and the pager.
 *
 * - Who: the account's address, else the start of its id (the price check's).
 * - The run's faults as chips, worst first; the job's own page opens in a new
 *   tab from the run's row (`JobPageLink`).
 * - In its own scroll box, so a phone scrolls the table and never the page.
 */
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RemakeFaultChips } from "@/ee/components/admin/remake-fault-chips"
import type { RemakeFaultRun } from "@/ee/lib/remake-faults-api"
import { JobPageLink } from "../jobs/job-detail-view"
import { engineLabel, formatCount, formatWhen, resolutionLabel } from "../motion-price-check/format"

const COLUMNS = ["When", "Who", "Engine", "Resolution", "Status", "Faults", "Job"] as const
const CELL = "whitespace-nowrap p-2 align-top"

function FaultRow({ run }: { run: RemakeFaultRun }) {
  return (
    <tr className="border-b border-border/50 last:border-0 hover:bg-muted/20" data-run-id={run.id}>
      <td className={`${CELL} tabular-nums`}>{formatWhen(run.createdAt)}</td>
      <td className={CELL}>
        {run.email !== null ? (
          <span className="inline-block max-w-48 truncate align-bottom" title={run.email}>
            {run.email}
          </span>
        ) : (
          <span className="font-mono text-xs" title={run.userId}>{`${run.userId.slice(0, 8)}…`}</span>
        )}
      </td>
      <td className={CELL}>
        {engineLabel(run.engine)}
        {run.fullQuality && (
          <>
            {" "}
            <Badge variant="outline">Full Quality</Badge>
          </>
        )}
      </td>
      <td className={CELL}>{resolutionLabel(run.resolution, run.draft)}</td>
      <td className={CELL}>{run.status}</td>
      <td className="min-w-64 p-2 align-top">
        <RemakeFaultChips faults={run.faults} />
      </td>
      <td className={CELL}>
        <JobPageLink
          jobId={run.id}
          className="inline-flex min-h-11 min-w-11 items-center gap-1 text-sm underline-offset-4 hover:underline"
        >
          Open
        </JobPageLink>
      </td>
    </tr>
  )
}

export function FaultsTable({
  runs,
  total,
  offset,
  limit,
  onPage,
}: {
  runs: RemakeFaultRun[]
  total: number
  offset: number
  limit: number
  onPage(offset: number): void
}) {
  const last = Math.min(offset + limit, total)
  return (
    <div className="space-y-2">
      {runs.length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          No Video Remake run recorded a fault matching these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table aria-label="Faulted runs" className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {COLUMNS.map((c) => (
                  <th key={c} scope="col" className="whitespace-nowrap p-2 text-start font-medium text-muted-foreground">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <FaultRow key={run.id} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm tabular-nums text-muted-foreground">
            {`${formatCount(Math.min(offset + 1, last))}–${formatCount(last)} of ${formatCount(total)}`}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 min-w-11"
              disabled={offset === 0}
              onClick={() => onPage(Math.max(0, offset - limit))}
            >
              Prev
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 min-w-11"
              disabled={offset + limit >= total}
              onClick={() => onPage(offset + limit)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
