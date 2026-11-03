/**
 * Admin → Motion price check: one run's drill-down, opened from its row in
 * the runs table. Every figure is the platform's
 * (POST /v1/admin/motion-price-check/runs/:jobId); the drawer lays them out.
 *
 * - The header: when, who, the run's name (a Full Quality with its draft's
 *   id), its facts and its figures, "KIE real" beside Paid $ once KIE's own
 *   figures went into it. A run in flight reads "In progress" under Taken
 *   and Margin $, as in the table.
 * - The quote: a row per line of the run's recorded quote, with what its
 *   steps held and took. A line beside the hold is tagged so; an extra (a
 *   retry quoted beside the hold) also says whether it ran, and only an
 *   extra does: `ran` is null on every other line, an "auto" masking
 *   quote's privacy line included. Then what the run was allowed: the hold
 *   plus the extras that ran.
 * - The steps: the run's own row first, then each step as the platform
 *   orders them, indented by its depth (a step of a step also says, to a
 *   screen reader, which step it is under), tagged local, no recorded cost
 *   or hold open, and on its quote line ("—" for none, or for a line the
 *   quote does not carry).
 * - Reused, no cost: what the run took from a cache instead of paying for
 *   it. A record with nothing in it reads "Nothing reused"; a run with no
 *   record at all (one from before the record, or one stopped before its
 *   first step) reads "Not recorded", never "Nothing reused".
 * - A sheet from the end side, full width on a phone, the admin drawers'
 *   48rem from 640 px (a tablet, an iPad on its side), and 64rem from
 *   1280 px, where the steps table needs the room: it scrolls down as a
 *   whole, each table sideways in its own box (focusable and named by its
 *   section's heading, so a keyboard scrolls it too), and its Close is a
 *   44 px target. Closing gives the focus back to the run's button
 *   (`focusRunOpener`), as Safari never focused it.
 * - KIE's figures landing while the drawer is open keep the run's figures
 *   on screen, "Updating…", until the new ones are in.
 */
import { useId, useState, type ReactNode } from "react"
import { AlertTriangle, Loader2, XIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type {
  KieRealResult,
  MotionPriceQuoteLine,
  MotionPriceReused,
  MotionPriceRun,
  MotionPriceRunDetail,
  MotionPriceStep,
} from "@/ee/lib/motion-price-check-api"
import { useMotionPriceRun } from "@/ee/hooks/queries/use-motion-price-check"
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
  styleLabel,
} from "./format"
import { focusRunOpener } from "./runs-table"
import { Scroll } from "./scroll-box"

const NONE = "—"
const CELL = "whitespace-nowrap p-2"
const FIGURE = `${CELL} text-end tabular-nums`
const ROW_HEADER = `${CELL} text-start font-normal`
const RED = "text-red-600 dark:text-red-400"
const AMBER_BADGE = "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-400"
const below = (v: number | null): boolean => v !== null && v < 0

/** A role as the page counts it, from 1. */
const roleOf = (role: number): string => `role ${formatCount(role + 1)}`

/** A step's indent by its depth: the run's own row, its steps, theirs, and anything deeper. */
const INDENT = ["ps-2", "ps-6", "ps-10", "ps-14"] as const
const indentOf = (depth: number): string => INDENT[Math.min(Math.max(depth, 0), INDENT.length - 1)]!

const providerModel = (s: MotionPriceStep): string =>
  [s.provider, s.model].filter((v): v is string => v !== null && v !== "").join(" · ") || NONE

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message !== "" ? error.message : "Something went wrong."

/** What the reuse section says when it lists nothing. */
function reuseSentence(recorded: MotionPriceRunDetail["reuse"]["recorded"]): string {
  if (recorded === "yes") return "Nothing reused"
  // A quote but no record: the run may have stopped before its first step wrote one.
  if (recorded === "none") return "Not recorded"
  return "Not recorded — a run from before reuse was recorded"
}

/**
 * A word after a name (a role, a count), with a real space before it. The
 * space is a text node between the two elements: one inside the span would
 * be trimmed from the cell's accessible name.
 */
function After({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <>
      {" "}
      <span className={className}>{children}</span>
    </>
  )
}

/** A tag after a name, with a real space before it, so it reads as a word of its own. */
function Tag({ children, amber = false }: { children: ReactNode; amber?: boolean }) {
  return (
    <>
      {" "}
      <Badge variant="outline" className={cn("align-middle", amber && AMBER_BADGE)}>
        {children}
      </Badge>
    </>
  )
}

/** A figure of a run still in flight: what there is so far, and that it is not final. */
function InProgress({ children }: { children: ReactNode }) {
  return (
    <>
      <div>{children}</div>
      <div className="text-xs text-muted-foreground">In progress</div>
    </>
  )
}

function Fact({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("break-words", className)}>{children}</dd>
    </div>
  )
}

/** A section of the drawer: its heading, its table (if any) in a scroll box the heading names, then the rest. */
function Section({ title, table, children }: { title: string; table?: ReactNode; children?: ReactNode }) {
  const headingId = useId()
  return (
    <section className="space-y-2">
      <h3 id={headingId} className="text-sm font-semibold">
        {title}
      </h3>
      {table !== undefined && <Scroll labelledBy={headingId}>{table}</Scroll>}
      {children}
    </section>
  )
}

function Head({ columns }: { columns: readonly { label: string; figure: boolean }[] }) {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/30">
        {columns.map((c) => (
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
  )
}

const ROW = "border-b border-border/50 last:border-0"

function RunFacts({ run }: { run: MotionPriceRun }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
        <Fact label="Engine">{engineLabel(run.engine)}</Fact>
        <Fact label="Style">{styleLabel(run.style)}</Fact>
        <Fact label="Resolution">{resolutionLabel(run.resolution, run.draft)}</Fact>
        <Fact label="Clip">{run.lengthSec === null ? NONE : `${formatSeconds(run.lengthSec)} s`}</Fact>
        <Fact label="Status">{run.status || NONE}</Fact>
      </dl>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm tabular-nums sm:grid-cols-3">
        <Fact label="Held">{formatCredits(run.held)}</Fact>
        <Fact label="Taken">
          {run.settled ? formatCredits(run.taken) : <InProgress>{formatCredits(run.taken)}</InProgress>}
        </Fact>
        <Fact label="Taken $">{formatUsd(run.takenUsd)}</Fact>
        <Fact label="Paid $">
          {formatUsd(run.paidUsd)}
          {run.kieUsd !== null && <Tag>KIE real</Tag>}
        </Fact>
        <Fact label="Margin $" className={cn(run.settled && below(run.marginUsd) && RED)}>
          {run.settled ? formatUsd(run.marginUsd) : <InProgress>{formatUsd(null)}</InProgress>}
        </Fact>
        <Fact label="Margin %" className={cn(run.settled && below(run.marginPct) && RED)}>
          {run.settled ? formatPct(run.marginPct) : formatPct(null)}
        </Fact>
      </dl>
    </div>
  )
}

const QUOTE_COLUMNS = [
  { label: "Line", figure: false },
  { label: "Quoted", figure: true },
  { label: "Expected", figure: true },
  { label: "Steps", figure: true },
  { label: "Held", figure: true },
  { label: "Taken", figure: true },
] as const

function QuoteRow({ line }: { line: MotionPriceQuoteLine }) {
  return (
    <tr className={ROW}>
      <th scope="row" className={ROW_HEADER}>
        <span>{line.label}</span>
        {line.outsideTotal && <Tag>outside the hold</Tag>}
        {line.ran !== null && <Tag>{line.ran ? "ran" : "did not run"}</Tag>}
      </th>
      <td className={FIGURE}>{formatCredits(line.quoted)}</td>
      <td className={FIGURE}>{formatCredits(line.expected)}</td>
      <td className={FIGURE}>{formatCount(line.steps)}</td>
      <td className={FIGURE}>{formatCredits(line.held)}</td>
      <td className={FIGURE}>{formatCredits(line.taken)}</td>
    </tr>
  )
}

function QuoteSection({ run, quote }: { run: MotionPriceRun; quote: MotionPriceRunDetail["quote"] }) {
  if (quote === null) {
    return (
      <Section title="Quote">
        <p className="text-sm text-muted-foreground">No quote recorded — a run from before quotes were recorded</p>
      </Section>
    )
  }
  return (
    <Section
      title="Quote"
      table={
        <table className="w-full text-sm">
          <Head columns={QUOTE_COLUMNS} />
          <tbody>
            {quote.lines.map((line) => (
              <QuoteRow key={line.line} line={line} />
            ))}
          </tbody>
        </table>
      }
    >
      <p className="text-sm tabular-nums">{`Allowed: ${formatCredits(run.quoteAllowed)} (the hold plus the extras that ran)`}</p>
    </Section>
  )
}

const STEP_COLUMNS = [
  { label: "Step", figure: false },
  { label: "Route", figure: false },
  { label: "Provider · model", figure: false },
  { label: "Task id", figure: false },
  { label: "Status", figure: false },
  { label: "Held", figure: true },
  { label: "Taken", figure: true },
  { label: "Taken $", figure: true },
  { label: "Recorded $", figure: true },
  { label: "KIE real $", figure: true },
  { label: "Paid $", figure: true },
  { label: "Quote line", figure: false },
] as const

/** A step as a row names it: its name, and its role counted from 1. */
const stepLabel = (step: MotionPriceStep): string => (step.role === null ? step.name : `${step.name} ${roleOf(step.role)}`)

function StepRow({
  step,
  nesting,
  lineOf,
}: {
  step: MotionPriceStep
  /** What a screen reader hears of a step of a step (its indent alone is not read out); null for the run and its own steps. */
  nesting: string | null
  lineOf(line: string | null): string
}) {
  return (
    <tr className={ROW}>
      <th scope="row" className={cn(ROW_HEADER, indentOf(step.depth))}>
        <span className={cn(step.depth === 0 && "font-medium")}>{step.name}</span>
        {step.role !== null && <After className="text-muted-foreground">{roleOf(step.role)}</After>}
        {step.local && <Tag>local</Tag>}
        {step.missingCost && <Tag amber>no recorded cost</Tag>}
        {step.open && <Tag amber>hold open</Tag>}
        {nesting !== null && <After className="sr-only">{nesting}</After>}
      </th>
      <td className={CELL}>{step.route || NONE}</td>
      <td className={CELL}>{providerModel(step)}</td>
      <td className={cn(CELL, "font-mono text-xs")}>{step.providerTaskId ?? NONE}</td>
      <td className={CELL}>{step.status || NONE}</td>
      <td className={FIGURE}>{formatCredits(step.held)}</td>
      <td className={FIGURE}>{formatCredits(step.taken)}</td>
      <td className={FIGURE}>{formatUsd(step.takenUsd)}</td>
      <td className={FIGURE}>{formatUsd(step.recordedUsd)}</td>
      <td className={FIGURE}>{formatUsd(step.kieUsd)}</td>
      <td className={FIGURE}>{formatUsd(step.paidUsd)}</td>
      <td className={CELL}>{lineOf(step.quoteLine)}</td>
    </tr>
  )
}

const REUSE_COLUMNS = [
  { label: "Step", figure: false },
  { label: "Job", figure: false },
  { label: "Quote line", figure: false },
] as const

function ReusedRow({ entry, lineOf }: { entry: MotionPriceReused; lineOf(line: string | null): string }) {
  return (
    <tr className={ROW}>
      <th scope="row" className={ROW_HEADER}>
        <span>{entry.name}</span>
        {entry.step === "clip" && <After className="tabular-nums">{`×${formatCount(entry.count)}`}</After>}
        {entry.role !== null && <After className="text-muted-foreground">{roleOf(entry.role)}</After>}
      </th>
      <td className={cn(CELL, "font-mono text-xs")}>{entry.jobId ?? NONE}</td>
      <td className={CELL}>{lineOf(entry.quoteLine)}</td>
    </tr>
  )
}

function Detail({ detail }: { detail: MotionPriceRunDetail }) {
  const { run, quote, steps, reuse } = detail
  // A line is named as the quote names it; one the quote does not carry (or no quote at all) is none.
  const labels = new Map((quote?.lines ?? []).map((l) => [l.line, l.label]))
  const lineOf = (line: string | null): string => (line === null ? NONE : (labels.get(line) ?? NONE))
  // A step of a step (depth 2 and deeper) names the step it is under; the run's own steps are plainly its own.
  const byJob = new Map(steps.map((s) => [s.jobId, s]))
  const nestingOf = (step: MotionPriceStep): string | null => {
    if (step.depth < 2) return null
    const parent = step.parentJobId === null ? undefined : byJob.get(step.parentJobId)
    return parent === undefined ? "(nested step)" : `(nested step of ${stepLabel(parent)})`
  }
  return (
    <div className="space-y-6">
      <RunFacts run={run} />
      <QuoteSection run={run} quote={quote} />
      <Section
        title="Steps"
        table={
          <table className="w-full text-sm">
            <Head columns={STEP_COLUMNS} />
            <tbody>
              {steps.map((step, i) => (
                <StepRow key={`${i}:${step.jobId}`} step={step} nesting={nestingOf(step)} lineOf={lineOf} />
              ))}
            </tbody>
          </table>
        }
      />
      <Section
        title="Reused, no cost"
        table={
          reuse.entries.length === 0 ? undefined : (
            <table className="w-full text-sm">
              <Head columns={REUSE_COLUMNS} />
              <tbody>
                {reuse.entries.map((entry, i) => (
                  <ReusedRow key={`${i}:${entry.step}`} entry={entry} lineOf={lineOf} />
                ))}
              </tbody>
            </table>
          )
        }
      >
        {reuse.entries.length === 0 && <p className="text-sm text-muted-foreground">{reuseSentence(reuse.recorded)}</p>}
      </Section>
    </div>
  )
}

function DrawerContent({ runId, kie }: { runId: string; kie: KieRealResult | null }) {
  const query = useMotionPriceRun(runId, kie)
  const detail = query.data
  const run = detail?.run ?? null
  const loading = detail === undefined && !query.isError
  // KIE's figures landing: the run's figures stay on screen until the new ones are in.
  const updating = query.isPlaceholderData
  return (
    <>
      <SheetHeader className="gap-1 border-b border-border">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <SheetTitle className="break-words text-lg">
              {run === null ? (
                "Motion run"
              ) : (
                <>
                  {runName(run)}
                  {run.fullQuality && <Tag>Full Quality</Tag>}
                </>
              )}
            </SheetTitle>
            <SheetDescription className="break-words">
              {run === null ? "" : `${formatWhen(run.createdAt)} · ${run.email ?? run.userId}`}
            </SheetDescription>
            {run?.fullQuality && (
              <p className="text-sm text-muted-foreground">
                {"Draft "}
                <span className="break-all font-mono text-xs">{run.draftJobId ?? NONE}</span>
              </p>
            )}
          </div>
          <SheetClose asChild>
            <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0" aria-label="Close">
              <XIcon aria-hidden="true" />
            </Button>
          </SheetClose>
        </div>
      </SheetHeader>
      <div className="min-w-0 px-4 pb-6 pt-4">
        {/* One live region that stays while the drawer is open: empty, it takes no room. */}
        <p role="status" className="text-sm text-muted-foreground">
          {(loading || updating) && (
            <span className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              {loading ? "Loading the run…" : "Updating…"}
            </span>
          )}
        </p>
        {detail !== undefined ? (
          <Detail detail={detail} />
        ) : query.isError ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-700 dark:text-red-400" aria-hidden="true" />
            <p className="min-w-0 break-words text-sm text-red-700 dark:text-red-400">{messageOf(query.error)}</p>
          </div>
        ) : null}
      </div>
    </>
  )
}

/**
 * The drawer of the run `runId` (null: closed). `kie` is the page's KIE
 * figures, sent with the request once fetched; `onClose` is called when the
 * admin closes it (Close, Escape, or a tap beside it).
 */
export function RunDrawer({ runId, kie, onClose }: { runId: string | null; kie: KieRealResult | null; onClose(): void }) {
  // The run on show: the open one, or, while the drawer slides shut, the one it showed, whose button then gets the focus back.
  const [shownId, setShownId] = useState(runId)
  if (runId !== null && runId !== shownId) setShownId(runId)
  const id = runId ?? shownId
  return (
    <Sheet
      open={runId !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 overflow-y-auto sm:max-w-3xl xl:max-w-5xl"
        onCloseAutoFocus={(event) => focusRunOpener(id, event)}
      >
        {id !== null && <DrawerContent key={id} runId={id} kie={kie} />}
      </SheetContent>
    </Sheet>
  )
}
