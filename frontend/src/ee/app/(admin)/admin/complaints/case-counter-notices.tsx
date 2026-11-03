import { useState } from "react"
import { Copy, Loader2, Mail } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  useDeclineCounterNotice,
  useMarkCounterNoticeForwarded,
  useRecordCourtAction,
  useRecordCourtActionEnded,
  useRestoreFromCounterNotice,
  type CaseCounterNotice,
  type ComplaintCase,
} from "@/ee/hooks/queries/use-admin-complaints-queries"
import { formatWhen, mailtoHref, unreadableLabel } from "./complaint-labels"
import { counterNoticeText, restoreBlocker, restoreOverdue, unreadableFields, waitingForDecision, windowDay } from "./counter-notice-state"
import { StepText } from "./step-text"

const POSITION_LABELS: Readonly<Record<CaseCounterNotice["position"], string>> = {
  before: "Window not open yet",
  open: "Window open",
  after: "Past the window",
}

const CLOSED_STATUSES: ReadonlySet<string> = new Set(["resolved", "closed"])

/** A value as the sender typed it: line breaks kept, long words wrapped. */
const VALUE = "whitespace-pre-wrap break-words"

/**
 * The counter-notices the case received: the sender's details (the law has
 * them forwarded to the complainant), the restore window and where today
 * stands in it, and the steps, each once: sent to the complainant (by the
 * administrator's own mail, the text copied from here), a court action
 * received and its end, the counter-notice declined, the content restored.
 * The restore button says why it is held back before it is pressed.
 */
export function CaseCounterNotices({ complaint: c }: { readonly complaint: ComplaintCase }) {
  if (c.counterNotices.length === 0) return null
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="case-counter-notices-heading">
      <h2 id="case-counter-notices-heading" className="text-sm font-semibold">Counter-notices ({c.counterNotices.length})</h2>
      <ul className="space-y-3">
        {c.counterNotices.map((n) => (
          <CounterNoticeItem key={n.id} notice={n} complaint={c} />
        ))}
      </ul>
    </section>
  )
}

/** The steps' mutations, whether one is running, and a runner that says how it went (true when the step was taken). */
function useNoticeSteps() {
  const forwarded = useMarkCounterNoticeForwarded()
  const court = useRecordCourtAction()
  const ended = useRecordCourtActionEnded()
  const decline = useDeclineCounterNotice()
  const restore = useRestoreFromCounterNotice()
  const busy = forwarded.isPending || court.isPending || ended.isPending || decline.isPending || restore.isPending
  async function step(run: () => Promise<unknown>, done: string, failed: string): Promise<boolean> {
    try {
      await run()
      toast.success(done)
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : failed)
      return false
    }
  }
  return { forwarded, court, ended, decline, restore, busy, step }
}

type NoticeSteps = ReturnType<typeof useNoticeSteps>

function CounterNoticeItem({ notice: n, complaint: c }: { readonly notice: CaseCounterNotice; readonly complaint: ComplaintCase }) {
  const steps = useNoticeSteps()
  const overdue = restoreOverdue(n)
  return (
    <li className="space-y-3 rounded-md border p-3 text-sm">
      <NoticeHeader notice={n} overdue={overdue} />
      <NoticeDetails notice={n} />
      <div className="space-y-2">
        <ForwardStep notice={n} complaint={c} steps={steps} />
        <NoticeOutcomes notice={n} />
        <DecisionSteps notice={n} steps={steps} />
        <RestoreStep notice={n} blocker={restoreBlocker(n, CLOSED_STATUSES.has(c.status))} overdue={overdue} steps={steps} />
      </div>
    </li>
  )
}

/** The reference, when it was received, the window and where today stands in it, and a warning when the restore is late. */
function NoticeHeader({ notice: n, overdue }: { readonly notice: CaseCounterNotice; readonly overdue: boolean }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono font-medium">{n.reference}</span>
        <span className="text-xs text-muted-foreground">received {formatWhen(n.receivedAt)} ({windowDay(n.receivedOn)} in New York)</span>
        <span className={`rounded-full border px-2 py-0.5 text-xs ${overdue ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" : "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"}`}>
          {POSITION_LABELS[n.position]}: {windowDay(n.opensOn)} to {windowDay(n.closesOn)}
        </span>
      </div>
      {overdue && (
        <p className="text-xs text-red-700 dark:text-red-300">
          {n.forwardedAt
            ? "The window's last day has passed and the content is still restricted: restore it now unless something else holds it."
            : "The window's last day has passed and the counter-notice was never marked sent to the complainant: send it now, then restore the content."}
        </p>
      )}
    </>
  )
}

/** The sender's details as typed, and those that could not be read. */
function NoticeDetails({ notice: n }: { readonly notice: CaseCounterNotice }) {
  const unreadable = unreadableFields(n)
  const rows: ReadonlyArray<readonly [string, string | null, string]> = [
    ["Sender", n.name, VALUE],
    ["Email", n.email, "break-all"],
    ["Address", n.address, VALUE],
    ["Phone", n.phone, VALUE],
    ["Material", n.contentIdentification, VALUE],
    ["Before removal", n.locationBefore, VALUE],
    ["Signature", n.signature, VALUE],
  ]
  return (
    <>
      {unreadable.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300">{unreadableLabel(unreadable)}</p>}
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
        {rows.map(([label, value, className]) => (
          <div key={label} className="contents">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className={className}>{value ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

/** Copying the counter-notice, writing to the complainant, and recording that it was sent. */
function ForwardStep({ notice: n, complaint: c, steps }: { readonly notice: CaseCounterNotice; readonly complaint: ComplaintCase; readonly steps: NoticeSteps }) {
  async function copyText() {
    try {
      await navigator.clipboard.writeText(counterNoticeText(n, c.reference))
      toast.success("Counter-notice copied")
    } catch {
      toast.error("Copying was refused by the browser")
    }
  }
  const email = c.complainantEmail
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => void copyText()}>
        <Copy className="me-2 h-4 w-4" aria-hidden="true" />
        Copy the counter-notice
      </Button>
      {email && (
        <Button size="sm" variant="outline" onClick={() => { window.location.href = mailtoHref(email, `Counter-notification ${n.reference} (complaint ${c.reference})`) }}>
          <Mail className="me-2 h-4 w-4" aria-hidden="true" />
          Write to the complainant
        </Button>
      )}
      {n.forwardedAt ? (
        <span className="text-xs text-muted-foreground">sent to the complainant {formatWhen(n.forwardedAt)}</span>
      ) : !n.declinedAt ? (
        <Button size="sm" onClick={() => void steps.step(() => steps.forwarded.mutateAsync({ counterNoticeId: n.id }), "Marked as sent", "Failed to record the forwarding")} disabled={steps.busy}>
          {steps.forwarded.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Mark as sent to the complainant
        </Button>
      ) : null}
    </div>
  )
}

/** What happened to it: a court action and its end, with their notes; a decline with its reason. */
function NoticeOutcomes({ notice: n }: { readonly notice: CaseCounterNotice }) {
  return (
    <>
      {n.courtActionAt && (
        <p className="text-xs text-violet-700 dark:text-violet-300">
          court action received {formatWhen(n.courtActionAt)}
          {n.courtActionNote && <span className={`block ${VALUE}`}>{n.courtActionNote}</span>}
        </p>
      )}
      {n.courtActionEndedAt && (
        <p className="text-xs text-violet-700 dark:text-violet-300">
          court action ended {formatWhen(n.courtActionEndedAt)}
          {n.courtActionEndedNote && <span className={`block ${VALUE}`}>{n.courtActionEndedNote}</span>}
        </p>
      )}
      {n.declinedAt && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          declined {formatWhen(n.declinedAt)}
          <span className={`block ${VALUE}`}>{n.declinedReason}</span>
        </p>
      )}
    </>
  )
}

/** Recording a court action, its end, or a decline: each asks for its text, and its form closes only once the step was taken. */
function DecisionSteps({ notice: n, steps }: { readonly notice: CaseCounterNotice; readonly steps: NoticeSteps }) {
  const [asking, setAsking] = useState<"court" | "ended" | "decline" | null>(null)
  const waiting = waitingForDecision(n)
  const courtHolds = Boolean(n.courtActionAt && !n.courtActionEndedAt && !n.restoredAt)
  const take = async (run: () => Promise<unknown>, done: string, failed: string) => {
    if (await steps.step(run, done, failed)) setAsking(null)
  }
  const cancel = () => setAsking(null)
  return (
    <div className="flex flex-wrap items-center gap-2">
      {waiting && asking !== "court" && <Button size="sm" variant="outline" onClick={() => setAsking("court")} disabled={steps.busy}>Court action received…</Button>}
      {waiting && asking === "court" && (
        <StepText label="A note on the court action" placeholder="Note (the court, the case number)" cta="Record the court action" required={false} busy={steps.court.isPending}
          onSubmit={(note) => void take(() => steps.court.mutateAsync({ counterNoticeId: n.id, note }), "Court action recorded", "Failed to record the court action")} onCancel={cancel} />
      )}
      {courtHolds && asking !== "ended" && <Button size="sm" variant="outline" onClick={() => setAsking("ended")} disabled={steps.busy}>The court action ended…</Button>}
      {courtHolds && asking === "ended" && (
        <StepText label="A note on how the court action ended" placeholder="Note (dismissed, withdrawn, decided)" cta="Record that it ended" required={false} busy={steps.ended.isPending}
          onSubmit={(note) => void take(() => steps.ended.mutateAsync({ counterNoticeId: n.id, note }), "End of the court action recorded", "Failed to record the end of the court action")} onCancel={cancel} />
      )}
      {waiting && asking !== "decline" && <Button size="sm" variant="outline" onClick={() => setAsking("decline")} disabled={steps.busy}>Decline as not valid…</Button>}
      {waiting && asking === "decline" && (
        <StepText label="Why the counter-notice is declined (the sender sees this)" placeholder="Why (the sender sees this)" cta="Decline the counter-notice" required busy={steps.decline.isPending}
          onSubmit={(reason) => { if (reason) void take(() => steps.decline.mutateAsync({ counterNoticeId: n.id, reason }), "Counter-notice declined", "Failed to decline the counter-notice") }} onCancel={cancel} />
      )}
    </div>
  )
}

/** Restoring the content: held back, with the reason beside the button, while anything says so. */
function RestoreStep({ notice: n, blocker, overdue, steps }: { readonly notice: CaseCounterNotice; readonly blocker: string | null; readonly overdue: boolean; readonly steps: NoticeSteps }) {
  if (n.restoredAt) return <span className="text-xs text-emerald-700 dark:text-emerald-300">content restored {formatWhen(n.restoredAt)}</span>
  if (n.declinedAt) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant={overdue ? "destructive" : "default"} onClick={() => void steps.step(() => steps.restore.mutateAsync({ counterNoticeId: n.id }), "Content restored", "Failed to restore the content")} disabled={steps.busy || blocker !== null}>
        {steps.restore.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        Restore the content
      </Button>
      {blocker && <span className="text-xs text-muted-foreground">{blocker}</span>}
    </div>
  )
}
