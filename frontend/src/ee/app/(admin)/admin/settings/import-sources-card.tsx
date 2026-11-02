// Admin → Settings → Content rights → Import sources: the sites a link may come
// from and what was decided about each (migration 578; /v1/admin/import-sources).
// A site with no row is approved. Its own save: the list is replaced whole,
// independently of the page's other settings, with the version it loaded; a
// list another admin changed since answers 409 and the card says to reload.

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getAuthHeaders } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"

export const IMPORT_SOURCE_STATUSES = [
  { key: "approved", label: "Approved" },
  { key: "restricted", label: "Restricted" },
  { key: "permission_required", label: "Permission required" },
  { key: "disabled", label: "Disabled" },
  { key: "pending_legal_review", label: "Pending legal review" },
] as const
export type ImportSourceStatus = (typeof IMPORT_SOURCE_STATUSES)[number]["key"]

export interface ImportSourcePolicy {
  domain: string
  status: ImportSourceStatus
  note: string | null
}

type Row = ImportSourcePolicy & { key: string }

/** The server's rule (lib/import-source-policy.ts): labels of letters, digits and hyphens, a TLD, punycode for an international name. */
const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*[a-z0-9]$/

interface ImportSourceList {
  policies: ImportSourcePolicy[]
  version: string
}

async function failureMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null
  return typeof body?.error?.message === "string" ? body.error.message : fallback
}

export function useImportSourcePolicies() {
  return useQuery({
    queryKey: queryKeys.admin.importSources(),
    queryFn: async (): Promise<ImportSourceList> => {
      const res = await fetch("/v1/admin/import-sources", { headers: await getAuthHeaders() })
      if (!res.ok) throw new Error(await failureMessage(res, "Failed to load the import sources"))
      const body = (await res.json()) as { data: ImportSourcePolicy[]; version: string }
      return { policies: body.data, version: body.version }
    },
    // The admin settings page is already behind the admin gate; nothing else renders this card.
    staleTime: 30_000,
  })
}

function useSaveImportSourcePolicies() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ policies, version }: ImportSourceList): Promise<ImportSourceList> => {
      const res = await fetch("/v1/admin/import-sources", {
        method: "PUT",
        headers: { ...(await getAuthHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ policies, version }),
      })
      if (!res.ok) throw new Error(await failureMessage(res, "Failed to save the import sources"))
      const body = (await res.json()) as { data: ImportSourcePolicy[]; version: string }
      return { policies: body.data, version: body.version }
    },
    onSuccess: (next) => qc.setQueryData(queryKeys.admin.importSources(), next),
  })
}

const toRows = (policies: ImportSourcePolicy[]): Row[] => policies.map((p) => ({ ...p, key: p.domain }))
/** The server's normalization: lowercase, every leading `www.` and a trailing dot gone. */
const normalizeDomain = (domain: string) => domain.trim().toLowerCase().replace(/\.+$/, "").replace(/^(www\.)+/, "")
const toPolicies = (rows: Row[]): ImportSourcePolicy[] => rows.map(({ key: _key, domain, status, note }) => ({ domain: normalizeDomain(domain), status, note: note?.trim() || null }))

export function ImportSourcesCard() {
  const { data, isLoading, error } = useImportSourcePolicies()
  const save = useSaveImportSourcePolicies()
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    if (data && rows === null) setRows(toRows(data.policies))
  }, [data, rows])

  const saved = data ? JSON.stringify(toPolicies(toRows(data.policies))) : null
  const dirty = rows !== null && saved !== null && JSON.stringify(toPolicies(rows)) !== saved
  const policies = rows ? toPolicies(rows) : []
  const problem = policies.find((p) => !DOMAIN_RE.test(p.domain))
    ? "Every site needs a domain such as example.com."
    : new Set(policies.map((p) => p.domain)).size !== policies.length
      ? "A domain is listed twice."
      : null

  const patch = (key: string, change: Partial<Row>) => setRows((r) => (r ? r.map((row) => (row.key === key ? { ...row, ...change } : row)) : r))

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Import sources</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            What was decided about each site a link may come from. A site that is not listed is approved; a
            disabled or permission-required site refuses the import with a message that names no site. A site
            covers its subdomains and is matched on the link as pasted. A save takes effect within a minute.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setRows((r) => [...(r ?? []), { key: crypto.randomUUID(), domain: "", status: "approved", note: null }])}>
            <Plus className="h-4 w-4 mr-1" />
            Add site
          </Button>
          <Button size="sm" variant="outline" onClick={() => data && setRows(toRows(data.policies))} disabled={!dirty || save.isPending}>
            Discard
          </Button>
          <Button
            size="sm"
            disabled={!dirty || problem !== null || save.isPending}
            onClick={() => rows && data && save.mutate({ policies: toPolicies(rows), version: data.version }, { onSuccess: (next) => setRows(toRows(next.policies)) })}
          >
            {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save sites
          </Button>
        </div>
      </div>

      {isLoading && !rows ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Loading" />
      ) : error && !rows ? (
        <p className="text-sm text-destructive">{error.message}</p>
      ) : rows && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sites listed: every site is approved.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th className="text-left font-medium px-2 py-2">Domain</th>
                <th className="text-left font-medium px-2 py-2">Status</th>
                <th className="text-left font-medium px-2 py-2">Note</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows?.map((row, i) => {
                const who = row.domain.trim() || `site ${i + 1}`
                return (
                  <tr key={row.key} className="border-b last:border-b-0 align-top">
                    <td className="px-2 py-2 min-w-[200px]">
                      <Input value={row.domain} onChange={(e) => patch(row.key, { domain: e.target.value })} placeholder="example.com" aria-label={`Domain of ${who}`} dir="ltr" />
                    </td>
                    <td className="px-2 py-2 min-w-[190px]">
                      <Select value={row.status} onValueChange={(v) => patch(row.key, { status: v as ImportSourceStatus })}>
                        <SelectTrigger aria-label={`Status of ${who}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{IMPORT_SOURCE_STATUSES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-2 min-w-[220px]">
                      <Input value={row.note ?? ""} onChange={(e) => patch(row.key, { note: e.target.value })} placeholder="Why, for the record" maxLength={500} aria-label={`Note on ${who}`} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Button variant="ghost" size="icon" aria-label={`Remove ${who}`} onClick={() => setRows((r) => (r ? r.filter((x) => x.key !== row.key) : r))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {dirty && problem && <p className="text-xs text-destructive" role="alert">{problem}</p>}
      {save.error && <p className="text-xs text-destructive">{save.error.message}</p>}
    </div>
  )
}
