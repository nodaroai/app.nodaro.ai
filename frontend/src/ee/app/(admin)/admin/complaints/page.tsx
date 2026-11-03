import { useState } from "react"
import { Link } from "react-router-dom"
import { Loader2, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  COMPLAINT_STATUSES,
  COMPLAINTS_PAGE_SIZE,
  searchProblem,
  useAdminComplaints,
  type ComplaintFilters,
} from "@/ee/hooks/queries/use-admin-complaints-queries"
import { categoryLabel, formatWhen, statusLabel, statusTone, unreadableLabel } from "./complaint-labels"

/**
 * Admin → Complaints: the queue the public form (`/copyright-complaints`)
 * fills. The open cases by default; a case opens on its own page, where it is
 * handled. Search by reference (`CR-…`) or by the complainant's email: what
 * is typed is sent in the request's body, never in an address, and an email
 * is looked up by its keyed hash (the address is never scanned in the clear).
 *
 * The page shows complainants' names and addresses: session recordings mask
 * it (`data-clarity-mask`).
 *
 * DIRECTION: logical Tailwind properties only (`ms-`/`me-`/`ps-`/`pe-`/`text-start`).
 */
export default function AdminComplaintsPage() {
  const [filters, setFilters] = useState<ComplaintFilters>({ status: "open", kind: "all", q: "", page: 1 })
  const [search, setSearch] = useState("")
  const [searchError, setSearchError] = useState<string | null>(null)
  const { data, isLoading, isError, error, isPlaceholderData } = useAdminComplaints(filters)
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / COMPLAINTS_PAGE_SIZE))

  const set = (patch: Partial<ComplaintFilters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }))

  return (
    <div className="space-y-6 p-6" data-clarity-mask="true">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Complaints</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Copyright notices and other legal complaints sent through the public form. Nothing is removed by a complaint on its own:
          every case is handled here, by a person. A verified, open case holds the files it matched as evidence.
        </p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="complaints-status">Status</label>
          <Select value={filters.status} onValueChange={(v) => set({ status: v as ComplaintFilters["status"] })}>
            <SelectTrigger id="complaints-status" className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open (not resolved or closed)</SelectItem>
              <SelectItem value="all">All</SelectItem>
              {COMPLAINT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="complaints-kind">Kind</label>
          <Select value={filters.kind} onValueChange={(v) => set({ kind: v as ComplaintFilters["kind"] })}>
            <SelectTrigger id="complaints-kind" className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="copyright">Copyright notice</SelectItem>
              <SelectItem value="other">Other complaint</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const problem = searchProblem(search)
            setSearchError(problem)
            if (!problem) set({ q: search.trim() })
          }}
        >
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor="complaints-search">Reference or email</label>
            <Input
              id="complaints-search"
              className="w-72"
              value={search}
              maxLength={320}
              placeholder="CR-2026-000001 or name@example.com"
              aria-invalid={searchError !== null}
              aria-describedby={searchError ? "complaints-search-error" : undefined}
              onChange={(e) => {
                setSearch(e.target.value)
                setSearchError(null)
              }}
            />
            {searchError && <p id="complaints-search-error" className="text-xs text-red-600">{searchError}</p>}
          </div>
          <Button type="submit" variant="outline" size="icon" aria-label="Search">
            <Search className="h-4 w-4" />
          </Button>
        </form>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : isError ? (
        <p className="text-sm text-red-600">{error instanceof Error ? error.message : "Failed to load the complaints"}</p>
      ) : !data || data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{filters.page > 1 && total > 0 ? "No complaints on this page." : "No complaints match."}</p>
      ) : (
        <div className={`overflow-x-auto rounded-lg border ${isPlaceholderData ? "opacity-60" : ""}`} aria-busy={isPlaceholderData}>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start font-medium">Reference</th>
                <th className="px-3 py-2 text-start font-medium">Received</th>
                <th className="px-3 py-2 text-start font-medium">Category</th>
                <th className="px-3 py-2 text-start font-medium">Status</th>
                <th className="px-3 py-2 text-start font-medium">Complainant</th>
                <th className="px-3 py-2 text-start font-medium">Matched</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((c) => (
                <tr key={c.id} className="border-t hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono">
                    <Link to={`/admin/complaints/${encodeURIComponent(c.id)}`} className="underline underline-offset-2">{c.reference}</Link>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatWhen(c.receivedAt)}</td>
                  <td className="px-3 py-2">{categoryLabel(c.category)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${statusTone(c.status)}`}>{statusLabel(c.status)}</span>
                    {!c.verifiedAt && <span className="ms-2 text-xs text-muted-foreground">unverified</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div>{c.complainantName ?? <span className="text-xs text-amber-700 dark:text-amber-300">{unreadableLabel(["name"])}</span>}</div>
                    <div className="text-xs text-muted-foreground">{c.complainantEmail ?? <span className="text-amber-700 dark:text-amber-300">{unreadableLabel(["email"])}</span>}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {c.matchedAssetIds.length} files · {c.matchedConfirmationIds.length} imports · {c.matchedUserIds.length} accounts
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(total > COMPLAINTS_PAGE_SIZE || filters.page > 1) && (
        <div className="flex items-center gap-3 text-sm">
          <Button variant="outline" size="sm" disabled={filters.page <= 1} onClick={() => set({ page: Math.min(filters.page - 1, pages) })}>Previous</Button>
          <span className="text-muted-foreground">Page {filters.page} of {pages} · {total} cases</span>
          <Button variant="outline" size="sm" disabled={filters.page >= pages || isPlaceholderData} onClick={() => set({ page: filters.page + 1 })}>Next</Button>
        </div>
      )}
    </div>
  )
}
