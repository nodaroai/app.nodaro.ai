import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useAddComplaintNote, type ComplaintCase, type ComplaintEvent } from "@/ee/hooks/queries/use-admin-complaints-queries"
import { EVENT_LABELS, actorLabel, emailOutcome, formatWhen, statusLabel } from "./complaint-labels"

/** The database's own record of each change to the case (which columns, never their values): there on request. */
const DATABASE_ENTRY = "row_updated"

/**
 * The case's log, oldest first: what the complainant did, what the system
 * did (the matching, the emails), what each handler did. The database's own
 * entry for every change to the case is hidden until asked for. A note is
 * added from here; nothing in the log is ever changed.
 */
export function CaseTimeline({ complaint: c }: { readonly complaint: ComplaintCase }) {
  const add = useAddComplaintNote()
  const [text, setText] = useState("")
  const [showDatabase, setShowDatabase] = useState(false)
  const databaseEntries = c.events.filter((e) => e.kind === DATABASE_ENTRY).length
  const shown = showDatabase ? c.events : c.events.filter((e) => e.kind !== DATABASE_ENTRY)

  async function submit() {
    try {
      await add.mutateAsync({ id: c.id, text: text.trim() })
      setText("")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to note the complaint")
    }
  }

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-labelledby="case-log-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="case-log-heading" className="text-sm font-semibold">Log</h2>
        {databaseEntries > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setShowDatabase((v) => !v)} aria-pressed={showDatabase}>
            {showDatabase ? "Hide the database's entries" : `Show the database's entries (${databaseEntries})`}
          </Button>
        )}
      </div>
      {c.eventsTruncated && <p className="text-xs text-muted-foreground">Older entries are not shown: the log lists its most recent entries.</p>}
      <ol className="space-y-2">
        {shown.map((e) => (
          <li key={e.id} className="grid gap-1 text-sm sm:grid-cols-[11rem_1fr]">
            <span className="text-xs text-muted-foreground">{formatWhen(e.createdAt)}</span>
            <div className="min-w-0">
              <span className="font-medium">{EVENT_LABELS[e.kind] ?? e.kind}</span>
              <span className="ms-2 text-xs text-muted-foreground">{actorLabel(e.actor)}</span>
              <EventDetail event={e} />
            </div>
          </li>
        ))}
      </ol>
      <div className="space-y-2">
        <Textarea rows={2} value={text} maxLength={4000} aria-label="A note for the case's log" placeholder="Add a note to the log" onChange={(e) => setText(e.target.value)} />
        <Button size="sm" onClick={submit} disabled={!text.trim() || add.isPending}>
          {add.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          Add note
        </Button>
      </div>
    </section>
  )
}

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0)

/** The few details worth reading in the log, as words; anything else as it was recorded. */
function EventDetail({ event: e }: { readonly event: ComplaintEvent }) {
  const line = eventLine(e)
  if (!line) return null
  return <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">{line}</p>
}

function eventLine(e: ComplaintEvent): string | null {
  const d = e.data
  switch (e.kind) {
    case "status_changed":
      return `${statusLabel(String(d.from ?? ""))} → ${statusLabel(String(d.to ?? ""))}${d.note ? ` — ${String(d.note)}` : ""}${d.decision ? ` — decision: ${String(d.decision)}` : ""}`
    case "decision_changed":
      return `${d.decision ? `decision: ${String(d.decision)}` : "decision cleared"}${d.note ? ` — ${String(d.note)}` : ""}`
    case "note":
      return String(d.text ?? "")
    case "matched":
      return `${Number(d.assets ?? 0)} files, ${Number(d.confirmations ?? 0)} imports`
    case "rematched": {
      const added = (d.added ?? {}) as Record<string, unknown>
      return `found ${Number(d.assets ?? 0)} files, ${Number(d.confirmations ?? 0)} imports, ${Number(d.users ?? 0)} accounts; added ${count(added.assetIds)} files, ${count(added.confirmationIds)} imports, ${count(added.userIds)} accounts`
    }
    case "mail_unavailable":
      return `${String(d.mail ?? "email")}: ${String(d.reason ?? "unknown")}`
    case "user_named":
      return d.to ? `account ${String(d.to)}` : "no account"
    case "content_restricted":
      return `restriction ${String(d.restrictionId ?? "")}`
    case "user_notified":
      return `restriction ${String(d.restrictionId ?? "")}: ${emailOutcome(d)}`
    case "complainant_notified":
      return `told "${statusLabel(String(d.status ?? ""))}": ${emailOutcome(d)}`
    case "restriction_lifted":
      return `restriction ${String(d.restrictionId ?? "")}${d.reason ? ` — ${String(d.reason)}` : ""}`
    case "counter_notice_received":
    case "restore_window_opened":
    case "restore_window_closing":
      return `${String(d.reference ?? "")}: restorable ${String(d.opensOn ?? "?")} to ${String(d.closesOn ?? "?")}`
    case "counter_notice_forwarded":
    case "counter_notice_declined":
      return String(d.reference ?? "")
    // The note itself is kept encrypted on the counter-notice (a caption names people); the log says only that there is one.
    case "court_action_received":
    case "court_action_ended":
      return `${String(d.reference ?? "")}${d.note === true ? " — with a note" : ""}`
    case "content_restored":
      return `${String(d.reference ?? "")}, restriction ${String(d.restrictionId ?? "")}`
    case "match_failed":
      return String(d.error ?? "")
    case DATABASE_ENTRY:
      return Array.isArray(d.columns) ? `changed: ${d.columns.map(String).join(", ")}` : null
    default:
      return null
  }
}
