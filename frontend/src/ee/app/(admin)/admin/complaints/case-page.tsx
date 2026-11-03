import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Loader2 } from "lucide-react"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import { caseIdOrNull, useAdminComplaint, type CaseSection } from "@/ee/hooks/queries/use-admin-complaints-queries"
import { categoryLabel, formatWhen, statusLabel, statusTone } from "./complaint-labels"
import { CaseStatusPanel } from "./case-status-panel"
import { CaseDetails } from "./case-details"
import { CaseMatches } from "./case-matches"
import { CaseCounterNotices } from "./case-counter-notices"
import { CaseAccountRecord } from "./case-account-record"
import { CaseTimeline } from "./case-timeline"

const SECTION_LABELS: Readonly<Record<CaseSection, string>> = {
  events: "the log",
  files: "the matched files",
  confirmations: "the import confirmations",
  accounts: "the accounts",
  restrictions: "the restrictions",
  counterNotices: "the counter-notices",
  record: "the account's record",
}

/**
 * Admin → Complaints → one case: what the complainant sent (decrypted for
 * this screen only), what their links matched in our records, the
 * restrictions the case led to, its log, and the moves — the status with a
 * decision, a note, the account the case names, a restriction from the case.
 * Every move is written to the case's log and audited.
 *
 * The page shows a complainant's details: session recordings mask it
 * (`data-clarity-mask`).
 *
 * DIRECTION: logical Tailwind properties only (`ms-`/`me-`/`ps-`/`pe-`/`text-start`).
 */
export default function AdminComplaintCasePage() {
  const { id } = useParams<{ id: string }>()
  const validId = caseIdOrNull(id) !== null
  const { data: c, isLoading, isError, error } = useAdminComplaint(id)

  if (validId && isLoading) {
    return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
  }
  if (!validId || isError || !c) {
    return (
      <div className="space-y-3 p-6">
        <BackLink />
        <p className="text-sm text-red-600">{validId && error instanceof Error ? error.message : "No such complaint"}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6" data-clarity-mask="true">
      <BackLink />
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold">{c.reference}</h1>
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${statusTone(c.status)}`}>{statusLabel(c.status)}</span>
          {c.verifiedAt ? (
            <span className="text-xs text-emerald-700 dark:text-emerald-300">Email verified {formatWhen(c.verifiedAt)}</span>
          ) : (
            <span className="text-xs text-amber-700 dark:text-amber-300">Email not verified: the case holds nothing as evidence until it is</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {c.kind === "copyright" ? "Copyright notice" : "Other complaint"} · {categoryLabel(c.category)} · received {formatWhen(c.receivedAt)}
          {c.closedAt ? ` · closed ${formatWhen(c.closedAt)}` : ""}
        </p>
      </header>

      <UnreadSections sections={c.partial} />
      <CaseStatusPanel complaint={c} />
      <CaseDetails complaint={c} />
      <CaseMatches complaint={c} />
      <CaseCounterNotices complaint={c} />
      <CaseAccountRecord complaint={c} />
      <CaseTimeline complaint={c} />
    </div>
  )
}

/** The parts of the case the server could not read: they are shown empty, and a reload reads them again. */
function UnreadSections({ sections }: { readonly sections: readonly CaseSection[] }) {
  if (sections.length === 0) return null
  return (
    <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
      Some of the case could not be read and is shown empty: {sections.map((s) => SECTION_LABELS[s]).join(", ")}. Reload the page to read it again.
    </p>
  )
}

function BackLink() {
  const isRtl = useAppDir() === "rtl"
  return (
    <Link to="/admin/complaints" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className={cn("h-4 w-4", isRtl && "rotate-180")} aria-hidden="true" /> All complaints
    </Link>
  )
}
