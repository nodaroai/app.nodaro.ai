import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { hasCredits } from "@/lib/edition"
import { cn } from "@/lib/utils"
import { LANE_LABELS, formatDuration, isCancellable, payerLabel, personLabel, reasonLabel, sourceLabel, tierLabel } from "./format"
import { UserHistoryTable } from "./history-tab"
import { InlineConfirm } from "./inline-confirm"
import { OverrideEditor } from "./override-editor"
import type { CancelAnswer, LaneUserEntry, LaneUserReport } from "./types"
import { LiveUsageError, useCancelLaneJob, useLaneConfig, useLaneUser } from "./use-live-usage"

const ordinal = (n: number) => {
  const tail = n % 100
  if (tail >= 11 && tail <= 13) return `${n}th`
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`
}

function cancelText(a: CancelAnswer): string {
  if (a.cancelled) return hasCredits() ? "Cancelled; its credits were refunded." : "Cancelled."
  if (a.inFlight) return "It had already started, so it was not cancelled."
  return "It left the line before the cancel reached it; nothing was cancelled."
}

function State({ e }: { e: LaneUserEntry }) {
  if (e.state === "running") {
    return (
      <span className={cn(e.overLimit && "font-medium text-rose-500")}>
        Running{e.overLimit ? " · over limit (would wait)" : ""}
      </span>
    )
  }
  return (
    <span className="font-medium text-amber-500">
      Waiting{e.position !== null ? ` · ${ordinal(e.position)} in line` : ""} · {reasonLabel(e.reason)}
    </span>
  )
}

/** What the cancel asks first: the refund is said only where there are credits. */
const cancelQuestion = () => (hasCredits() ? "Cancel this job and refund it?" : "Cancel this job?")

function Entries({ report, asking, onAsk, onDismiss, onCancel, cancelling, result }: {
  report: LaneUserReport
  /** The job whose cancel is being asked, or null. */
  asking: string | null
  onAsk: (jobId: string) => void
  onDismiss: () => void
  onCancel: (jobId: string) => void
  cancelling: string | null
  result: { jobId: string; text: string; failed: boolean } | null
}) {
  const lines = report.lines.filter((l) => l.entries.length > 0)
  if (lines.length === 0) return <p className="text-xs text-muted-foreground">Nothing running or waiting right now.</p>
  return (
    <div className="space-y-4">
      {lines.map((line) => (
        <div key={line.payer} className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold">{payerLabel(line.payer)}</span>
            <span className="text-muted-foreground">{tierLabel(line.tier)}</span>
            {line.override && line.payer.startsWith("user:") && <Badge variant="outline" className="text-[11px] font-normal">override</Badge>}
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5 text-start font-medium">State</th>
                  <th className="px-2 py-1.5 text-start font-medium">Lane</th>
                  <th className="px-2 py-1.5 text-start font-medium">Type</th>
                  <th className="px-2 py-1.5 text-start font-medium">Model</th>
                  <th className="px-2 py-1.5 text-start font-medium">From</th>
                  <th className="px-2 py-1.5 text-start font-medium">For</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {line.entries.map((e) => (
                  <tr key={e.jobId} className="border-t align-top">
                    <td className="px-2 py-1.5"><State e={e} /></td>
                    <td className="px-2 py-1.5">{LANE_LABELS[e.lane] ?? e.lane}{e.provider ? ` · ${e.provider}` : ""}</td>
                    <td className="px-2 py-1.5">{e.jobType ?? "—"}</td>
                    <td className="px-2 py-1.5">{e.model ?? "—"}</td>
                    <td className="px-2 py-1.5">{sourceLabel(e.source, e.sourceDetail)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{formatDuration(e.state === "queued" ? e.waitedMs : e.runningMs)}</td>
                    <td className="px-2 py-1.5 text-end">
                      {isCancellable(e) && (
                        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={cancelling !== null || asking === e.jobId} onClick={() => onAsk(e.jobId)}>
                          {cancelling === e.jobId && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
                          Cancel job
                        </Button>
                      )}
                      {asking === e.jobId && (
                        <InlineConfirm
                          className="mt-1 w-56"
                          title={cancelQuestion()}
                          confirmLabel="Cancel job"
                          cancelLabel="Keep job"
                          destructive
                          pending={cancelling === e.jobId}
                          onConfirm={() => onCancel(e.jobId)}
                          onCancel={onDismiss}
                        />
                      )}
                      {result?.jobId === e.jobId && (
                        <p className={cn("mt-1 max-w-48 text-start", result.failed ? "text-destructive" : "text-muted-foreground")}>{result.text}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {result && !lines.some((l) => l.entries.some((e) => e.jobId === result.jobId)) && (
        <p className={cn("text-xs", result.failed ? "text-destructive" : "text-muted-foreground")}>{result.text}</p>
      )}
    </div>
  )
}

function DrawerBody({ userId }: { userId: string }) {
  const { data, error, isLoading } = useLaneUser(userId)
  const { data: config } = useLaneConfig()
  const cancel = useCancelLaneJob(userId)
  const [result, setResult] = useState<{ jobId: string; text: string; failed: boolean } | null>(null)
  /** Cancel asks first (one job at a time): it ends another account's job. */
  const [asking, setAsking] = useState<string | null>(null)

  if (isLoading && !data) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading" /></div>
  if (!data) {
    const gone = error instanceof LiveUsageError && error.status === 404
    return <p className="text-sm text-muted-foreground">{gone ? "No such user." : error?.message ?? "Failed to load this user's lanes."}</p>
  }

  const onAsk = (jobId: string) => {
    setResult(null)
    setAsking(jobId)
  }
  const onCancel = (jobId: string) => {
    setResult(null)
    cancel.mutate(jobId, {
      onSuccess: (a) => setResult({ jobId, text: cancelText(a), failed: false }),
      onError: (err) => setResult({ jobId, text: err.message, failed: true }),
      onSettled: () => setAsking(null),
    })
  }
  // The plan the placeholders show: the user's own line's tier when it is in the lanes now.
  const tier = data.lines.find((l) => l.payer.startsWith("user:"))?.tier ?? null
  const planSizes = config?.editable && tier ? config.plans[tier] ?? null : null

  return (
    <div className="space-y-6 px-4 pb-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Running and waiting</h3>
        {data.linesAvailable ? (
          <Entries report={data} asking={asking} onAsk={onAsk} onDismiss={() => setAsking(null)} onCancel={onCancel} cancelling={cancel.isPending ? cancel.variables ?? null : null} result={result} />
        ) : (
          <p className="text-xs text-amber-600">This environment's lanes could not be read just now; only the history is shown.</p>
        )}
      </section>

      {config?.editable && (
        data.own === null ? (
          <p className="text-xs text-amber-600">This user's override could not be read just now.</p>
        ) : !data.own.available ? (
          <p className="text-xs text-muted-foreground">Overrides are not in this database yet.</p>
        ) : (
          <OverrideEditor userId={userId} override={data.own.override} note={data.own.note} planSizes={planSizes} sizeBounds={config.bounds.laneSize} />
        )
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Last 30 days</h3>
        {data.history.available ? (
          <UserHistoryTable rows={data.history.rows} />
        ) : (
          <p className="text-xs text-muted-foreground">There is no lane history in this database yet.</p>
        )}
      </section>
    </div>
  )
}

/** One user from either view: their jobs in the lanes, Cancel on a waiting job, their override, their last 30 days. */
export function UserDrawer({ userId, label, onClose }: { userId: string | null; label: string | null; onClose: () => void }) {
  const { data } = useLaneUser(userId)
  const title = data ? personLabel(data) : label ?? "User"
  return (
    <Sheet open={userId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{[data?.email && data.email !== title ? data.email : null, data?.env ?? null].filter(Boolean).join(" · ") || "Live usage"}</SheetDescription>
        </SheetHeader>
        {userId !== null && <DrawerBody key={userId} userId={userId} />}
      </SheetContent>
    </Sheet>
  )
}
