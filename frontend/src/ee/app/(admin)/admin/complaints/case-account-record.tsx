import { useState } from "react"
import { Link } from "react-router-dom"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import type { ComplaintCase } from "@/ee/hooks/queries/use-admin-complaints-queries"
import {
  useLiftMeasure,
  useRecordInfringement,
  useUnblockAccount,
  useWithdrawInfringement,
  type AccountRecord,
  type RecordInfringement,
  type RecordMeasure,
} from "@/ee/hooks/queries/use-admin-repeat-infringers"
import { MEASURE_LABELS, formatWhen, statusLabel } from "./complaint-labels"
import { blockMismatch, measureBlocker, recordBlocker } from "./account-record-state"
import { MeasureForm, stepSentence } from "./measure-form"
import { StepText } from "./step-text"

/** A value as it was typed: line breaks kept, long words wrapped. */
const VALUE = "whitespace-pre-wrap break-words"

/** Runs a move and says how it went; true when it was made. */
async function move(run: () => Promise<unknown>, done: string, failed: string): Promise<boolean> {
  try {
    await run()
    toast.success(done)
    return true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : failed)
    return false
  }
}

/**
 * The record of the account the case names, under the repeat-infringer
 * policy: its standing infringements within the window and the step the
 * policy names for them, every infringement (with its case, and whether that
 * case's content was restored after a counter-notice) and every measure; and
 * the moves: record an infringement from this case, withdraw one, take a
 * measure, lift one. Where the account's block and its closures disagree
 * (neither ever moves the other), it says so and offers the unblock. Every
 * move is written to the case's log.
 */
export function CaseAccountRecord({ complaint: c }: { readonly complaint: ComplaintCase }) {
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="case-record-heading">
      <h2 id="case-record-heading" className="text-sm font-semibold">The account's record</h2>
      {!c.userId ? (
        <p className="text-sm text-muted-foreground">Name the case's account to record an infringement or take a measure.</p>
      ) : !c.record ? (
        <p className="text-sm text-muted-foreground">The account's record could not be read.</p>
      ) : (
        <>
          <RecordSummary record={c.record} />
          <RecordMoves complaint={c} record={c.record} />
          <InfringementList record={c.record} caseId={c.id} />
          <MeasureList record={c.record} />
        </>
      )}
    </section>
  )
}

/** The account's block as words: whether it is blocked, since when and why (a closure's block names its case). */
function blockSentence(record: AccountRecord): string {
  if (record.blocked === null) return "Whether the account is blocked could not be read."
  if (!record.blocked || !record.block) return "The account is not blocked."
  const why = record.block.reason ? `: ${record.block.reason}` : "."
  return `The account is blocked since ${formatWhen(record.block.blockedAt)}${why}`
}

/** The count, the step the policy names, and the account's block, with what to do where the block and the closures disagree. */
function RecordSummary({ record }: { readonly record: AccountRecord }) {
  const unblock = useUnblockAccount()
  const mismatch = blockMismatch(record)
  async function unblockAccount() {
    try {
      const res = await unblock.mutateAsync({ userId: record.userId })
      toast.success("Account unblocked")
      if (res.data.warning) toast.warning(res.data.warning)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to unblock the account")
    }
  }
  return (
    <div className="space-y-1 text-sm">
      <p>{stepSentence(record)}</p>
      <p className={`text-xs text-muted-foreground ${VALUE}`}>{blockSentence(record)}</p>
      {mismatch === "blocked_after_lift" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
          The closure was lifted, but the account is still blocked: read the block's reason above before you unblock it.
          <Button size="sm" variant="outline" onClick={() => void unblockAccount()} disabled={unblock.isPending}>
            {unblock.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Unblock the account
          </Button>
        </div>
      )}
      {mismatch === "closure_without_block" && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          A closure stands, but the account is not blocked: block it from its page, or lift the closure with a reason.
        </p>
      )}
    </div>
  )
}

/** Recording an infringement from this case (with the reasoning, for the record) and taking a measure. */
function RecordMoves({ complaint: c, record }: { readonly complaint: ComplaintCase; readonly record: AccountRecord }) {
  const [open, setOpen] = useState<"record" | "measure" | null>(null)
  const recordInfringement = useRecordInfringement()
  const notRecordable = recordBlocker(c)
  const notMeasurable = measureBlocker(c)
  const submitRecord = (note: string | null) =>
    void move(() => recordInfringement.mutateAsync({ complaintId: c.id, userId: record.userId, note }), "Infringement recorded", "Failed to record the infringement").then((made) => made && setOpen(null))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {open !== "record" && (
          <Button size="sm" variant="outline" onClick={() => setOpen("record")} disabled={notRecordable !== null || open !== null}>Record an infringement…</Button>
        )}
        {open !== "measure" && (
          <Button size="sm" variant="outline" onClick={() => setOpen("measure")} disabled={notMeasurable !== null || open !== null}>Take a measure…</Button>
        )}
        {notRecordable && <span className="text-xs text-muted-foreground">{notRecordable}</span>}
      </div>
      {open === "record" && (
        <StepText label="Why the complaint is substantiated" placeholder="Why the complaint is substantiated (on the record; the account never sees it)" cta="Record the infringement"
          required={false} busy={recordInfringement.isPending} maxLength={4000} onSubmit={submitRecord} onCancel={() => setOpen(null)} />
      )}
      {open === "measure" && <MeasureForm complaint={c} record={record} onDone={() => setOpen(null)} />}
    </div>
  )
}

function InfringementList({ record, caseId }: { readonly record: AccountRecord; readonly caseId: string }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">Infringements ({record.infringements.length})</h3>
      {record.infringements.length === 0 ? (
        <p className="text-sm text-muted-foreground">None recorded.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {record.infringements.map((i) => (
            <InfringementItem key={i.id} infringement={i} caseId={caseId} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** The case it was recorded from, as a link unless it is this one. */
function CaseLink({ complaintId, reference, caseId }: { readonly complaintId: string | null; readonly reference: string | null; readonly caseId: string }) {
  if (!complaintId) return null
  if (complaintId === caseId) return <span className="font-medium">this case</span>
  return <Link to={`/admin/complaints/${encodeURIComponent(complaintId)}`} className="font-mono underline underline-offset-2">{reference ?? "another case"}</Link>
}

function InfringementItem({ infringement: i, caseId }: { readonly infringement: RecordInfringement; readonly caseId: string }) {
  const [asking, setAsking] = useState(false)
  const withdraw = useWithdrawInfringement()
  const submit = (reason: string | null) => {
    if (reason) void move(() => withdraw.mutateAsync({ infringementId: i.id, reason }), "Infringement withdrawn", "Failed to withdraw the infringement").then((made) => made && setAsking(false))
  }
  const standing = i.withdrawnAt ? `withdrawn ${formatWhen(i.withdrawnAt)}` : i.counts ? "counts" : "outside the window"
  return (
    <li className="space-y-1 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <CaseLink complaintId={i.complaintId} reference={i.caseReference} caseId={caseId} />
        {i.caseStatus && <span className="text-xs text-muted-foreground">{statusLabel(i.caseStatus)}</span>}
        <span className="text-xs text-muted-foreground">recorded {formatWhen(i.recordedAt)}</span>
        <span className={`text-xs ${i.counts ? "font-medium" : "text-muted-foreground"}`}>{standing}</span>
      </div>
      {i.note && <p className={`text-xs ${VALUE}`}>{i.note}</p>}
      {i.withdrawReason && <p className={`text-xs text-muted-foreground ${VALUE}`}>{i.withdrawReason}</p>}
      {!i.withdrawnAt && i.restoredAfterCounterNotice && (
        <p className="text-xs text-amber-700 dark:text-amber-300">The account's content on that case was restored after a counter-notice: withdraw the infringement unless something else holds it.</p>
      )}
      {!i.withdrawnAt && !asking && <Button size="sm" variant="ghost" onClick={() => setAsking(true)} disabled={withdraw.isPending}>Withdraw…</Button>}
      {!i.withdrawnAt && asking && (
        <StepText label="Why the infringement is withdrawn" placeholder="Why it is withdrawn" cta="Withdraw the infringement" required busy={withdraw.isPending}
          initial={i.restoredAfterCounterNotice ? "Content restored after a counter-notice" : ""} onSubmit={submit} onCancel={() => setAsking(false)} />
      )}
    </li>
  )
}

function MeasureList({ record }: { readonly record: AccountRecord }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">Measures ({record.measures.length})</h3>
      {record.measures.length === 0 ? (
        <p className="text-sm text-muted-foreground">None taken.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {record.measures.map((m) => (
            <MeasureItem key={m.id} measure={m} />
          ))}
        </ul>
      )}
    </div>
  )
}

/** A measure's span: until when it runs, or how it ended. */
function measureSpan(m: RecordMeasure): string {
  if (m.kind === "warning") return `given ${formatWhen(m.appliedAt)}`
  if (m.liftedAt) return `lifted ${formatWhen(m.liftedAt)}`
  if (!m.inForce) return `ended ${formatWhen(m.endsAt)}`
  return m.endsAt ? `in force until ${formatWhen(m.endsAt)}` : "in force until lifted"
}

/** What the lift of a measure is called, and what it says once made. */
const LIFT_WORDS: Readonly<Partial<Record<RecordMeasure["kind"], { readonly cta: string; readonly done: string }>>> = {
  closed: { cta: "Lift the closure", done: "Closure lifted: the account's block is unchanged" },
  suspended: { cta: "Lift the suspension", done: "Suspension lifted" },
}

function MeasureItem({ measure: m }: { readonly measure: RecordMeasure }) {
  const [asking, setAsking] = useState(false)
  const lift = useLiftMeasure()
  const words = LIFT_WORDS[m.kind] ?? { cta: "Lift the measure", done: "Measure lifted" }
  const submit = (reason: string | null) => {
    if (!reason) return
    const run = async () => {
      const res = await lift.mutateAsync({ measureId: m.id, reason })
      if (res.data.warning) toast.warning(res.data.warning)
    }
    void move(run, words.done, "Failed to lift the measure").then((made) => made && setAsking(false))
  }
  return (
    <li className="space-y-1 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{MEASURE_LABELS[m.kind]}</span>
        <span className={`text-xs ${m.inForce ? "font-medium text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>{measureSpan(m)}</span>
        {m.kind !== "warning" && <span className="text-xs text-muted-foreground">taken {formatWhen(m.appliedAt)}</span>}
        {m.caseReference && <span className="font-mono text-xs text-muted-foreground">{m.caseReference}</span>}
      </div>
      <p className={`text-xs ${VALUE}`}>The owner was told: {m.reason}</p>
      {m.note && <p className={`text-xs text-muted-foreground ${VALUE}`}>Note: {m.note}</p>}
      <p className={`text-xs text-muted-foreground ${VALUE}`}>
        {m.policyStep ? `Followed the policy, at ${m.infringementsInWindow} infringement(s).` : `Departed from the policy, at ${m.infringementsInWindow} infringement(s): ${m.departureReason ?? ""}`}
      </p>
      {m.liftReason && <p className={`text-xs text-muted-foreground ${VALUE}`}>Lifted: {m.liftReason}</p>}
      {m.inForce && m.kind !== "warning" && !asking && <Button size="sm" variant="ghost" onClick={() => setAsking(true)} disabled={lift.isPending}>Lift…</Button>}
      {m.inForce && m.kind !== "warning" && asking && (
        <StepText label="Why the measure is lifted" placeholder="Why it is lifted" cta={words.cta} required busy={lift.isPending}
          onSubmit={submit} onCancel={() => setAsking(false)} />
      )}
    </li>
  )
}
