import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  COMPLAINT_STATUSES,
  useMoveComplaintStatus,
  type ComplaintCase,
  type ComplaintStatus,
} from "@/ee/hooks/queries/use-admin-complaints-queries"
import { CLOSED_STATUSES, statusLabel } from "./complaint-labels"

/**
 * The case's move: a status, the handler's decision (kept on the case and
 * shown to whoever handles it next), a note for the log. The move is made
 * from the case as this screen showed it: when another handler changed the
 * case meanwhile, the server refuses it and the screen reads the case again,
 * keeping what was typed here so it can be saved again on top of the change.
 * Closing a verified case ends its hold on the files it matched; the panel
 * says so before the move (an unverified case holds nothing).
 */
export function CaseStatusPanel({ complaint }: { readonly complaint: ComplaintCase }) {
  const move = useMoveComplaintStatus()
  const [status, setStatus] = useState<ComplaintStatus>(complaint.status)
  const [decision, setDecision] = useState(complaint.decision ?? "")
  const [note, setNote] = useState("")
  // What the handler has changed here and not saved yet: a read of the case never replaces it.
  const [statusTouched, setStatusTouched] = useState(false)
  const [decisionTouched, setDecisionTouched] = useState(false)

  // A move made here or elsewhere: the form follows the case, except where the handler is still typing.
  useEffect(() => {
    if (!statusTouched) setStatus(complaint.status)
  }, [complaint.status, statusTouched])
  useEffect(() => {
    if (!decisionTouched) setDecision(complaint.decision ?? "")
  }, [complaint.decision, decisionTouched])

  const decisionChanged = decision.trim() !== (complaint.decision ?? "").trim()
  const unchanged = status === complaint.status && !decisionChanged && !note.trim()
  const closing = Boolean(complaint.verifiedAt) && CLOSED_STATUSES.has(status) && !CLOSED_STATUSES.has(complaint.status)

  async function submit() {
    try {
      await move.mutateAsync({
        id: complaint.id,
        seen: complaint.updatedAt,
        status,
        ...(decisionChanged ? { decision: decision.trim() || null } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      setNote("")
      setStatusTouched(false)
      setDecisionTouched(false)
      toast.success(status === complaint.status ? `${complaint.reference}: saved` : `${complaint.reference}: ${statusLabel(status)}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to move the complaint")
    }
  }

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="case-handle-heading">
      <h2 id="case-handle-heading" className="text-sm font-semibold">Handle the case</h2>
      <div className="grid gap-3 md:grid-cols-[16rem_1fr]">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="case-status">Status</label>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v as ComplaintStatus)
              setStatusTouched(true)
            }}
          >
            <SelectTrigger id="case-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COMPLAINT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {statusTouched && status !== complaint.status && (
            <p className="text-xs text-muted-foreground">Now: {statusLabel(complaint.status)}</p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="case-note">Note for the log (optional)</label>
          <Input id="case-note" value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground" htmlFor="case-decision">Decision</label>
        <Textarea
          id="case-decision"
          rows={3}
          value={decision}
          maxLength={8000}
          onChange={(e) => {
            setDecision(e.target.value)
            setDecisionTouched(true)
          }}
        />
        {decisionTouched && (complaint.decision ?? "") !== "" && decisionChanged && (
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">On the case now: {complaint.decision}</p>
        )}
      </div>
      {closing && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Closing the case ends its hold on the files it matched: unless a restriction or another open case covers them, their owners can delete them again.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={unchanged || move.isPending}>
          {move.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Save
        </Button>
        {(statusTouched || decisionTouched) && (
          <Button
            variant="ghost"
            onClick={() => {
              setStatusTouched(false)
              setDecisionTouched(false)
              setStatus(complaint.status)
              setDecision(complaint.decision ?? "")
            }}
            disabled={move.isPending}
          >
            Discard changes
          </Button>
        )}
      </div>
    </section>
  )
}
