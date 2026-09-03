/**
 * Every message any admin ever sent this user.
 *
 * Shared by design: the next admin to open this account needs to see what the
 * last one already said, so nothing here filters by the viewer.
 *
 * The three statuses mean three different things and are shown as three
 * different things. `failed` is a message that never arrived, and it carries
 * the provider's reason. `sending` is a message whose fate we do not know —
 * the row was written before the provider call precisely so this state exists
 * rather than a silent gap — and after a couple of minutes it stops meaning
 * "in flight" and starts meaning "interrupted", which the badge says.
 */
import { useState } from "react"
import { AlertTriangle, Check, ChevronDown, ChevronRight, Clock, Mail } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  useAdminUserMessages,
  type AdminMessage,
} from "@/ee/hooks/queries/use-admin-messages"
import { MessagePreview } from "./message-preview"

/** Past this, a row still marked `sending` was interrupted, not in flight.
 *  The provider call itself times out at 10s. */
const STALE_SENDING_MS = 2 * 60_000

const TEMPLATE_LABELS: Record<string, string> = {
  issue_detected: "Issue detected",
  credits_refunded: "Credits refunded",
  general_followup: "General follow-up",
}

export function statusPresentation(message: Pick<AdminMessage, "status" | "sentAt">, now = Date.now()) {
  if (message.status === "sent") {
    return { label: "Sent", tone: "sent" as const }
  }
  if (message.status === "failed") {
    return { label: "Failed", tone: "failed" as const }
  }
  const age = now - new Date(message.sentAt).getTime()
  return Number.isFinite(age) && age > STALE_SENDING_MS
    ? { label: "Interrupted — delivery unknown", tone: "unknown" as const }
    : { label: "Sending...", tone: "pending" as const }
}

const TONE_CLASS: Record<string, string> = {
  sent: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  unknown: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  pending: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
}

function MessageRow({ message }: { readonly message: AdminMessage }) {
  const [open, setOpen] = useState(false)
  const status = statusPresentation(message)

  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 p-3 text-left hover:bg-muted/40"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{message.renderedSubject}</span>
            <Badge variant="secondary" className={TONE_CLASS[status.tone]}>
              {status.tone === "sent" && <Check className="mr-1 h-3 w-3" />}
              {status.tone === "failed" && <AlertTriangle className="mr-1 h-3 w-3" />}
              {(status.tone === "pending" || status.tone === "unknown") && (
                <Clock className="mr-1 h-3 w-3" />
              )}
              {status.label}
            </Badge>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {TEMPLATE_LABELS[message.templateId] ?? message.templateId}
            {" · "}
            {message.sentByAdminEmail ?? "an admin who has since been removed"}
            {" · "}
            {new Date(message.sentAt).toLocaleString()}
          </div>
        </div>
      </button>

      {open && (
        <div className="space-y-2 border-t p-3">
          {/* Both non-sent states carry a reason, and both need to show it. A
              row still `sending` with an error recorded is the "we never heard
              back" case — the reason is the only clue an admin has about
              whether to chase it, and gating this on `failed` alone threw it
              away for exactly the outcome that is hardest to interpret. */}
          {message.errorMessage && message.status === "failed" && (
            <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
              This never reached them: {message.errorMessage}
            </p>
          )}
          {message.errorMessage && message.status === "sending" && (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              The provider never answered, so we do not know whether this arrived:{" "}
              {message.errorMessage}
            </p>
          )}
          <MessagePreview bodyHtml={message.renderedBody} />
          <div className="text-[11px] text-muted-foreground">
            {message.status === "sent" ? "Delivered to" : "Addressed to"} {message.recipientEmail}
            {message.imageUrl && (
              <>
                {" · "}
                <a
                  href={message.imageUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  screenshot
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function MessageHistory({ userId }: { readonly userId: string }) {
  const { data, isLoading, error } = useAdminUserMessages(userId)

  if (isLoading) {
    return <p className="text-xs text-muted-foreground">Loading message history...</p>
  }
  if (error) {
    return (
      <p className="text-xs text-destructive">
        {error instanceof Error ? error.message : "Failed to load the message history"}
      </p>
    )
  }
  if (data?.unavailable) {
    return (
      <p className="text-xs text-muted-foreground">
        Message history is not available on this environment yet — the database migration
        has not been applied.
      </p>
    )
  }

  const messages = data?.data ?? []
  if (messages.length === 0) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Mail className="h-3.5 w-3.5" />
        No admin has messaged this user yet.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {messages.map((m) => (
        <MessageRow key={m.id} message={m} />
      ))}
    </div>
  )
}
