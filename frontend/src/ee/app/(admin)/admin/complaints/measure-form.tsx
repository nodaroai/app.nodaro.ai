import { useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { ComplaintCase } from "@/ee/hooks/queries/use-admin-complaints-queries"
import { MAX_BLOCK_DAYS, MEASURE_KINDS, measureTakesDays, useApplyMeasure, type AccountRecord, type MeasureKind } from "@/ee/hooks/queries/use-admin-repeat-infringers"
import { MEASURE_LABELS, formatWhen, measureLabel } from "./complaint-labels"
import { daysFor, draftFromStep, followsStep, standingInfringementOf, suggestedOwnerReason } from "./account-record-state"

/** What the policy names for the account's count, in words. */
export function stepSentence(record: AccountRecord): string {
  const count = `${record.inWindow} infringement${record.inWindow === 1 ? "" : "s"} in ${record.windowMonths} months`
  return record.step ? `The policy names: ${measureLabel(record.step.kind, record.step.days)}, for ${count}.` : `The policy names no measure for ${count}.`
}

/** The form's state and its send: it starts at the policy's step; a departure from it needs a reason. */
function useMeasureDraft(c: ComplaintCase, record: AccountRecord, onDone: () => void) {
  const draft = draftFromStep(record.step)
  const [kind, setKind] = useState<MeasureKind>(draft.kind)
  const [daysText, setDaysText] = useState(draft.days ? String(draft.days) : "")
  const [reason, setReason] = useState(() => suggestedOwnerReason(draft.kind, c.kind))
  const [reasonEdited, setReasonEdited] = useState(false)
  const [note, setNote] = useState("")
  const [departure, setDeparture] = useState("")
  const apply = useApplyMeasure()
  const days = daysFor(kind, daysText, MAX_BLOCK_DAYS)
  const departs = days === undefined || !followsStep(record.step, kind, days)
  const ready = reason.trim() !== "" && days !== undefined && (!departs || departure.trim() !== "") && !apply.isPending
  const infringement = standingInfringementOf(record, c.id)

  const choose = (next: MeasureKind) => {
    setKind(next)
    if (!reasonEdited) setReason(suggestedOwnerReason(next, c.kind))
  }
  const editReason = (text: string) => {
    setReason(text)
    setReasonEdited(true)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready || days === undefined) return
    try {
      const input = {
        complaintId: c.id,
        userId: record.userId,
        kind,
        days,
        reason: reason.trim(),
        note: note.trim() || null,
        infringementId: infringement?.id ?? null,
        departureReason: departs ? departure.trim() : null,
      }
      const res = await apply.mutateAsync(input)
      toast.success(kind === "closed" ? "Account closed" : kind === "suspended" ? "Account suspended" : "Measure taken")
      if (res.data.warning) toast.warning(res.data.warning)
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to take the measure")
    }
  }

  return { kind, choose, daysText, setDaysText, days, reason, editReason, note, setNote, departure, setDeparture, departs, ready, infringement, pending: apply.isPending, submit }
}

/** A labelled text area of the form. */
function TextField({ id, label, max, value, onChange }: { readonly id: string; readonly label: string; readonly max: number; readonly value: string; readonly onChange: (text: string) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={2} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

/** The measure to take: one of the kinds. */
function KindChoice({ name, kind, onChoose }: { readonly name: string; readonly kind: MeasureKind; readonly onChoose: (kind: MeasureKind) => void }) {
  return (
    <fieldset className="flex flex-wrap gap-3">
      <legend className="sr-only">The measure</legend>
      {MEASURE_KINDS.map((option) => (
        <label key={option} className="flex items-center gap-1.5 text-sm">
          <input type="radio" name={name} value={option} checked={kind === option} onChange={() => onChoose(option)} />
          {MEASURE_LABELS[option]}
        </label>
      ))}
    </fieldset>
  )
}

/** A measure's length: an import block's days, or empty for until lifted; a suspension's days, always. */
function DaysField({ id, kind, text, invalid, onChange }: { readonly id: string; readonly kind: MeasureKind; readonly text: string; readonly invalid: boolean; readonly onChange: (text: string) => void }) {
  const required = kind === "suspended"
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{required ? "Days" : "Days (empty: until lifted)"}</Label>
      <Input id={id} className="max-w-32" inputMode="numeric" value={text} onChange={(e) => onChange(e.target.value)} />
      {invalid && <p className="text-xs text-red-600">A whole number of days from 1 to {MAX_BLOCK_DAYS}{required ? "." : ", or empty."}</p>}
    </div>
  )
}

/** What taking a measure that refuses the account does, said before it is taken. */
function RefusalNotice({ kind }: { readonly kind: MeasureKind }) {
  if (kind !== "closed" && kind !== "suspended") return null
  return (
    <p className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-800 dark:text-red-200">
      {kind === "closed"
        ? "Closing blocks the account: its sign-in and every request are refused, and the decision stays on the record."
        : "Suspending refuses the account's sign-in and every request until the suspension ends (its scheduled runs and published apps stop meanwhile); you can lift it early, and the decision stays on the record."}
    </p>
  )
}

/**
 * Taking a measure on the case's account: it starts at the step the policy
 * names for the account's standing infringements, and a choice that departs
 * from it asks why. What the account's owner is told is suggested and
 * editable; the administrator's own note stays on the record, never shown to
 * the owner. Closing the account blocks it; suspending it refuses it until the
 * suspension ends.
 */
export function MeasureForm({ complaint: c, record, onDone }: { readonly complaint: ComplaintCase; readonly record: AccountRecord; readonly onDone: () => void }) {
  const d = useMeasureDraft(c, record, onDone)
  const refuses = d.kind === "closed" || d.kind === "suspended"
  return (
    <form onSubmit={d.submit} className="space-y-3 rounded-md border p-3" aria-label="Take a measure on the account">
      <p className="text-xs text-muted-foreground">{stepSentence(record)}</p>
      <KindChoice name={`measure-kind-${c.id}`} kind={d.kind} onChoose={d.choose} />
      {measureTakesDays(d.kind) && <DaysField id={`measure-days-${c.id}`} kind={d.kind} text={d.daysText} invalid={d.days === undefined} onChange={d.setDaysText} />}
      <TextField id={`measure-reason-${c.id}`} label="What the account's owner is told" max={2000} value={d.reason} onChange={d.editReason} />
      <TextField id={`measure-note-${c.id}`} label="Your note (on the record; the owner never sees it)" max={4000} value={d.note} onChange={d.setNote} />
      {d.departs && <TextField id={`measure-departure-${c.id}`} label="Why this departs from the policy" max={2000} value={d.departure} onChange={d.setDeparture} />}
      {d.infringement && <p className="text-xs text-muted-foreground">Follows the infringement recorded from this case on {formatWhen(d.infringement.recordedAt)}.</p>}
      <RefusalNotice kind={d.kind} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant={refuses ? "destructive" : "default"} disabled={!d.ready}>
          {d.pending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {d.kind === "closed" ? "Close the account" : d.kind === "suspended" ? "Suspend the account" : "Take the measure"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={d.pending}>Cancel</Button>
      </div>
    </form>
  )
}
