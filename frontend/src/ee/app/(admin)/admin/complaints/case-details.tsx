import type { ReactNode } from "react"
import { Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ComplaintCase } from "@/ee/hooks/queries/use-admin-complaints-queries"
import { formatWhen, mailtoHref, unreadableLabel } from "./complaint-labels"

/**
 * What the complainant sent, as they sent it: who they are (decrypted for
 * this screen only — never copied into the log or the audit), what work
 * they claim, where they say it is, and the statements they affirmed. The
 * submission never changes; only the case moves.
 *
 * The address is shown as text, and the mail is opened by a button: no link
 * on the page carries it, so nothing that reads links (an analytics tag, a
 * recording) is handed the complainant's address.
 */
export function CaseDetails({ complaint: c }: { readonly complaint: ComplaintCase }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Complainant</h2>
        {c.complainantUnreadable.length > 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Some of the complainant's details cannot be read on this server ({unreadableLabel(c.complainantUnreadable)}). The rest of the case is shown.
          </p>
        )}
        {c.complainantName && <Field label="Name">{c.complainantName}</Field>}
        {c.complainantEmail && (
          <Field label="Email">
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all">{c.complainantEmail}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  if (c.complainantEmail) window.location.href = mailtoHref(c.complainantEmail, c.reference)
                }}
              >
                <Mail className="me-2 h-4 w-4" aria-hidden="true" />
                Write to the complainant
              </Button>
            </div>
          </Field>
        )}
        {c.claimantRole && <Field label="Acting as">{c.claimantRole === "owner" ? "The rights holder" : "An agent of the rights holder"}</Field>}
        {c.complainantAddress && <Field label="Address">{c.complainantAddress}</Field>}
        {c.complainantPhone && <Field label="Phone">{c.complainantPhone}</Field>}
        {c.signature && <Field label="Signature">{c.signature}</Field>}
        {c.userAgent && <Field label="Browser"><span className="break-all text-xs text-muted-foreground">{c.userAgent}</span></Field>}
      </section>

      <section className="space-y-2 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">The report</h2>
        {c.originalWork && <Field label="Work claimed"><Prose text={c.originalWork} /></Field>}
        {c.originalWorkUrl && (
          <Field label="Where the original is">
            {/^https?:\/\//i.test(c.originalWorkUrl) ? (
              <a href={c.originalWorkUrl} target="_blank" rel="noopener noreferrer nofollow" className="break-all underline underline-offset-2">{c.originalWorkUrl}</a>
            ) : (
              <span className="break-all">{c.originalWorkUrl}</span>
            )}
          </Field>
        )}
        <Field label="Where the content is"><Prose text={c.reportedContent} /></Field>
        <Field label="Explanation"><Prose text={c.explanation} /></Field>
        {c.kind === "copyright" && (
          <Field label="Statements">
            {c.goodFaithAffirmedAt && c.accuracyAffirmedAt
              ? `Good faith and accuracy affirmed ${formatWhen(c.goodFaithAffirmedAt)}`
              : "Not affirmed"}
          </Field>
        )}
        {c.reportedUrls.length > 0 && (
          <Field label="Links read from the report">
            <ul className="space-y-0.5">
              {c.reportedUrls.map((u) => (
                <li key={u} className="break-all font-mono text-xs">{u}</li>
              ))}
            </ul>
          </Field>
        )}
      </section>
    </div>
  )
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid gap-1 text-sm sm:grid-cols-[9rem_1fr]">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** The complainant's own words: kept as written, line breaks included, never rendered as markup. */
function Prose({ text }: { readonly text: string }) {
  return <p className="whitespace-pre-wrap break-words">{text}</p>
}
