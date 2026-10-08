import type { ReactNode } from "react"
import { AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { SectionFailure } from "./types"

export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border rounded-lg p-4 bg-background">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  )
}

export function SectionShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="border rounded-lg bg-card p-5 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  )
}

type Missing = { status: "not_configured" } | SectionFailure

const GRANT_PATH: Record<"Analytics" | "Search Console", string> = {
  Analytics: "Admin → Property access management → add as Viewer",
  "Search Console": "Settings → Users and permissions → add (Restricted is enough)",
}

/** What fixes a refusal, from Google's reason for it. Access is the remedy only when access is what Google refused. */
function Remedy({ failure, product, email }: { failure: SectionFailure; product: "Analytics" | "Search Console"; email: string | null }) {
  if (failure.reason === "SERVICE_DISABLED") {
    return <p className="text-muted-foreground">Turn the API on in the service account’s Google Cloud project — Google’s message above names it — then press Refresh.</p>
  }
  if (failure.reason === "PERMISSION_DENIED" && email) {
    return (
      <p className="text-muted-foreground">
        Give <span className="font-mono">{email}</span> access in {product}: {GRANT_PATH[product]}.
      </p>
    )
  }
  return null
}

/** A section without data: not set up yet, or Google's refusal and what fixes it. */
export function SectionProblem({ result, product, email }: { result: Missing; product: "Analytics" | "Search Console"; email: string | null }) {
  if (result.status === "not_configured") {
    return <p className="text-sm text-muted-foreground">Not set up yet. See “Finish the setup” above.</p>
  }
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-1">
      <p className="font-medium flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
        <span>{result.reason === "KEY_FILE" ? result.message : `Google said: ${result.message}`}</span>
      </p>
      <Remedy failure={result} product={product} email={email} />
    </div>
  )
}

export function FilterInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="h-8 max-w-xs text-sm" />
}

/** "Showing 25 of 140" with the switch to all of them, and — when Google sent only its top rows — a word on that. */
export function RowsFooter({ shown, total, expanded, onToggle, note }: { shown: number; total: number; expanded: boolean; onToggle: () => void; note?: string }) {
  if (total <= shown && !expanded && !note) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>
        Showing {shown} of {total}
        {note ? ` · ${note}` : ""}
      </span>
      {(total > shown || expanded) && (
        <button type="button" className="underline" onClick={onToggle}>
          {expanded ? "Show fewer" : "Show all"}
        </button>
      )}
    </div>
  )
}
