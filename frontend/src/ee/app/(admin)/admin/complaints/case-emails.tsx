import { Fragment, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  previewAccountNotice,
  previewComplainantUpdate,
  useSendAccountNotice,
  useSendComplainantUpdate,
  type CaseRestriction,
  type ComplaintCase,
  type ComplaintNoticePreview,
} from "@/ee/hooks/queries/use-admin-complaints-queries"
import { CLOSED_STATUSES, formatWhen } from "./complaint-labels"

/** Each email's values in the order its template shows them, as the handler reads them. */
const ACCOUNT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["content", "Content"],
  ["source", "Source"],
  ["reason", "Reason for the restriction"],
  ["reference", "Complaint reference"],
  ["counterNoticeUrl", "Appeal page"],
]
const COMPLAINANT_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["reference", "Complaint reference"],
  ["status", "Status"],
  ["action", "Action taken"],
]

const message = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

/**
 * The case's emails (backend ee/lib/complaint-notices.ts): "Content access
 * restricted" to the account a restriction from an open copyright case
 * covers, with a reason written here for the account (the restriction's own
 * reason is the record's and is never sent), and "Complaint update" to the
 * complainant. Each is previewed first, as it will be sent, and sent only
 * from its preview, naming its digest: the server refuses an email that
 * changed since. A preview also closes with any change to the case (the
 * components are keyed by its `updatedAt`). Every send is written to the
 * case's log.
 */
export function CaseEmails({ complaint }: { readonly complaint: ComplaintCase }) {
  const inForce = complaint.restrictions.filter((r) => !r.liftedAt)
  return (
    <section className="space-y-4 rounded-lg border p-4" aria-labelledby="case-emails-heading">
      <h2 id="case-emails-heading" className="text-sm font-semibold">Emails</h2>
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">To the account whose content was restricted</h3>
        {complaint.kind !== "copyright" ? (
          <p className="text-sm text-muted-foreground">
            This email is for a copyright complaint. Write to the account about another complaint from Admin → Users, with a general message.
          </p>
        ) : CLOSED_STATUSES.has(complaint.status) ? (
          <p className="text-sm text-muted-foreground">The case is closed: the email would invite a counter-notice the case no longer takes.</p>
        ) : inForce.length === 0 ? (
          <p className="text-sm text-muted-foreground">No restriction from this case is in force: there is nothing to tell the account about.</p>
        ) : (
          <ul className="space-y-2">
            {inForce.map((r) => (
              <li key={`${r.id}:${complaint.updatedAt}`}>
                <AccountNotice caseId={complaint.id} restriction={r} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">To the complainant</h3>
        <ComplainantUpdate key={complaint.updatedAt} complaint={complaint} />
      </div>
    </section>
  )
}

function AccountNotice({ caseId, restriction }: { readonly caseId: string; readonly restriction: CaseRestriction }) {
  const sendNotice = useSendAccountNotice()
  const [reason, setReason] = useState("")
  /** The preview, with the reason it was made for: the send names both. */
  const [preview, setPreview] = useState<{ readonly notice: ComplaintNoticePreview; readonly reason: string } | null>(null)
  const [reading, setReading] = useState(false)
  const reasonId = `account-reason-${restriction.id}`

  async function open() {
    const told = reason.trim()
    setReading(true)
    try {
      setPreview({ notice: await previewAccountNotice(caseId, restriction.id, told), reason: told })
    } catch (e) {
      toast.error(message(e, "Failed to preview the email"))
    } finally {
      setReading(false)
    }
  }

  async function sendIt() {
    if (!preview) return
    try {
      await sendNotice.mutateAsync({ id: caseId, restrictionId: restriction.id, reason: preview.reason, digest: preview.notice.digest })
      setPreview(null)
      toast.success("Email sent to the account")
    } catch (e) {
      toast.error(message(e, "Failed to email the account"))
    }
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm text-muted-foreground">Restricted {formatWhen(restriction.restrictedAt)}</p>
      {preview ? (
        <NoticePreview preview={preview.notice} fields={ACCOUNT_FIELDS} sending={sendNotice.isPending} onSend={sendIt} onCancel={() => setPreview(null)} />
      ) : (
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground" htmlFor={reasonId}>
            Reason the account will read (the restriction's own note stays on the record)
          </label>
          <Textarea id={reasonId} rows={2} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="outline" onClick={open} disabled={reading || !reason.trim()}>
            {reading && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Preview the email
          </Button>
        </div>
      )}
    </div>
  )
}

/** Why the complainant cannot be sent an update yet, or null when they can. */
function updateBlockedBy(complaint: ComplaintCase): string | null {
  if (!complaint.verifiedAt) return "The complainant has not proven their email yet."
  if (!(complaint.decision ?? "").trim()) return "Write the decision first and save it: the update tells the complainant what was done."
  return null
}

function ComplainantUpdate({ complaint }: { readonly complaint: ComplaintCase }) {
  const sendUpdate = useSendComplainantUpdate()
  const [preview, setPreview] = useState<ComplaintNoticePreview | null>(null)
  const [reading, setReading] = useState(false)
  const blocked = updateBlockedBy(complaint)

  async function open() {
    setReading(true)
    try {
      setPreview(await previewComplainantUpdate(complaint.id))
    } catch (e) {
      toast.error(message(e, "Failed to preview the email"))
    } finally {
      setReading(false)
    }
  }

  async function sendIt() {
    if (!preview) return
    try {
      await sendUpdate.mutateAsync({ id: complaint.id, digest: preview.digest })
      setPreview(null)
      toast.success("Update sent to the complainant")
    } catch (e) {
      toast.error(message(e, "Failed to email the complainant"))
    }
  }

  if (preview) {
    return <NoticePreview preview={preview} fields={COMPLAINANT_FIELDS} sending={sendUpdate.isPending} onSend={sendIt} onCancel={() => setPreview(null)} />
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={open} disabled={reading || blocked !== null}>
        {reading && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        Preview the update
      </Button>
      {blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}
    </div>
  )
}

function NoticePreview({
  preview,
  fields,
  sending,
  onSend,
  onCancel,
}: {
  readonly preview: ComplaintNoticePreview
  readonly fields: ReadonlyArray<readonly [string, string]>
  readonly sending: boolean
  readonly onSend: () => void
  readonly onCancel: () => void
}) {
  return (
    <div className="space-y-3 rounded-md bg-muted/40 p-3 text-sm">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">To</dt>
        <dd className="break-words">{preview.to}</dd>
        {fields.map(([key, label]) => (
          <Fragment key={key}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="whitespace-pre-wrap break-words">{preview.values[key] ?? ""}</dd>
          </Fragment>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onSend} disabled={sending}>
          {sending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Send
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
