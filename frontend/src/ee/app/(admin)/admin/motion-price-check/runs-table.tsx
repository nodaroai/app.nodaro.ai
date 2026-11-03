/**
 * Admin → Motion price check: one page of the range's runs, in the API's
 * order (by a figure, a run in flight comes last either way; by date, the
 * date alone), and the pager.
 *
 * - A run is opened from a real button, its name (the trend's, or "Hand"),
 *   so the focus can come back to it; the open run's row is marked. It and
 *   the pager's buttons are 44 px targets.
 * - The button is an inline box, not a flex one: the space before a Full
 *   Quality badge is drawn, the underline is the name's alone, and the focus
 *   ring is drawn inside it, where the scroll box cannot clip it.
 * - A run in flight reads "In progress" under Taken (its running total) and
 *   Margin, and never shows a flag, whatever its answer carries.
 * - Flags: "Paid > taken" in red; "No cost: N steps" and "Above quote" in
 *   amber, the latter with its reason on screen (what was taken against what
 *   the quote allowed), so a tap reads it as well as a hover.
 * - In its own scroll box, so a phone scrolls the table and never the page.
 */
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { MotionPriceRun } from "@/ee/lib/motion-price-check-api"
import {
  engineLabel,
  formatCount,
  formatCredits,
  formatPct,
  formatSeconds,
  formatUsd,
  formatWhen,
  resolutionLabel,
  runName,
} from "./format"

/**
 * Gives the focus back to the button that opened `runId`'s drawer, once the
 * drawer has closed. Radix would return it to a dialog trigger, and there is
 * none, so it would fall to the page; nor can the drawer keep the focused
 * element when it opens, as Safari does not focus a button it clicks. The
 * button is found by the run's id (`data-run-open`), so a table drawn again
 * meanwhile still has it.
 *
 * KIE's figures can land while the drawer is open and move the run to
 * another page, or the list can fail to be read again. With no button, the
 * focus goes to the runs' heading (`data-runs-heading`), and with no list
 * either, to the page's own heading (`data-page-heading`): never to the page
 * itself.
 */
export function focusRunOpener(runId: string | null, event: Event): void {
  const opener =
    runId === null ? undefined : [...document.querySelectorAll<HTMLElement>("[data-run-open]")].find((el) => el.dataset.runOpen === runId)
  const target =
    opener ?? document.querySelector<HTMLElement>("[data-runs-heading]") ?? document.querySelector<HTMLElement>("[data-page-heading]")
  if (!target) return
  event.preventDefault()
  target.focus()
}

const COLUMNS: readonly { label: string; figure: boolean }[] = [
  { label: "When", figure: false },
  { label: "Who", figure: false },
  { label: "Run", figure: false },
  { label: "Engine", figure: false },
  { label: "Resolution", figure: false },
  { label: "Clip (s)", figure: true },
  { label: "Held", figure: true },
  { label: "Taken", figure: true },
  { label: "Taken $", figure: true },
  { label: "Paid $", figure: true },
  { label: "Margin $", figure: true },
  { label: "Margin %", figure: true },
  { label: "Flags", figure: false },
]

const CELL = "whitespace-nowrap p-2"
const FIGURE = `${CELL} text-end tabular-nums`
const RED = "text-red-600 dark:text-red-400"
const RED_BADGE = "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
const AMBER_BADGE = "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-400"
const below = (v: number | null): boolean => v !== null && v < 0

/** A figure of a run still in flight: what there is so far, and that it is not final. */
function InProgress({ children }: { children: ReactNode }) {
  return (
    <>
      <div>{children}</div>
      <div className="text-xs text-muted-foreground">In progress</div>
    </>
  )
}

function Flags({ run }: { run: MotionPriceRun }) {
  if (!run.settled) return null
  const steps = run.stepsWithoutCost
  return (
    <>
      {run.flags.paidAboveTaken && (
        <Badge variant="outline" className={RED_BADGE}>
          Paid &gt; taken
        </Badge>
      )}
      {run.flags.missingCost && (
        <Badge variant="outline" className={AMBER_BADGE}>
          {`No cost: ${formatCount(steps)} ${steps === 1 ? "step" : "steps"}`}
        </Badge>
      )}
      {run.flags.aboveQuote && (
        <>
          <Badge variant="outline" className={AMBER_BADGE}>
            Above quote
          </Badge>
          <span className="text-xs text-muted-foreground">
            {`taken ${formatCredits(run.taken)} > allowed ${formatCredits(run.quoteAllowed)}`}
          </span>
        </>
      )}
    </>
  )
}

function RunRow({ run, open, onOpen }: { run: MotionPriceRun; open: boolean; onOpen(runId: string): void }) {
  return (
    <tr
      aria-current={open ? "true" : undefined}
      className={cn("border-b border-border/50 last:border-0 hover:bg-muted/20", open && "bg-muted/40")}
    >
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
      {/* No vertical padding: the button's own 44 px is the row's height. */}
      <td className="whitespace-nowrap px-2 py-0">
        <button
          type="button"
          data-run-open={run.id}
          className="group inline-block min-h-11 min-w-11 rounded-sm py-3 text-start font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          title="Open the run's steps"
          onClick={() => onOpen(run.id)}
        >
          <span className="underline-offset-4 group-hover:underline">{runName(run)}</span>
          {run.fullQuality && (
            <>
              {" "}
              <Badge variant="outline">Full Quality</Badge>
            </>
          )}
        </button>
      </td>
      <td className={CELL}>{engineLabel(run.engine)}</td>
      <td className={CELL}>{resolutionLabel(run.resolution, run.draft)}</td>
      <td className={FIGURE}>{formatSeconds(run.lengthSec)}</td>
      <td className={FIGURE}>{formatCredits(run.held)}</td>
      <td className={FIGURE}>{run.settled ? formatCredits(run.taken) : <InProgress>{formatCredits(run.taken)}</InProgress>}</td>
      <td className={FIGURE}>{formatUsd(run.takenUsd)}</td>
      <td className={FIGURE}>{formatUsd(run.paidUsd)}</td>
      <td className={cn(FIGURE, run.settled && below(run.marginUsd) && RED)}>
        {run.settled ? formatUsd(run.marginUsd) : <InProgress>{formatUsd(null)}</InProgress>}
      </td>
      <td className={cn(FIGURE, run.settled && below(run.marginPct) && RED)}>
        {run.settled ? formatPct(run.marginPct) : formatPct(null)}
      </td>
      <td className={CELL}>
        <div className="flex items-center gap-1">
          <Flags run={run} />
        </div>
      </td>
    </tr>
  )
}

export function RunsTable({
  runs,
  total,
  offset,
  limit,
  onPage,
  onOpen,
  openRunId = null,
}: {
  runs: MotionPriceRun[]
  total: number
  offset: number
  limit: number
  onPage(offset: number): void
  onOpen(runId: string): void
  /** The run whose steps are open: its row is marked. */
  openRunId?: string | null
}) {
  const last = Math.min(offset + limit, total)
  return (
    <div className="space-y-2">
      {runs.length === 0 ? (
        <p className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">
          No Motion runs match these filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table aria-label="Runs" className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {COLUMNS.map((c) => (
                  <th
                    key={c.label}
                    scope="col"
                    className={cn("whitespace-nowrap p-2 font-medium text-muted-foreground", c.figure ? "text-end" : "text-start")}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} open={run.id === openRunId} onOpen={onOpen} />
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
