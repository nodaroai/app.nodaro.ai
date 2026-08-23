import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Building2, Loader2 } from "lucide-react"
import type { OrgStatus } from "@nodaro/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { getAuthHeaders } from "@/lib/api"

/**
 * Admin — Organizations.
 *
 * On instances that hold new organizations for review, this page is the only
 * place that review can happen: a pending organization grants its owner
 * nothing, so the person waiting cannot unstick themselves and nobody else
 * can see that they are waiting.
 *
 * Deliberately NOT a management console. A platform admin decides whether an
 * organization may operate on this instance — approve, suspend, restore — and
 * nothing else. Renaming it, reading its members, or changing its settings
 * belong to the people who run it, and an admin surface that offered them
 * would make every organization's internals platform-staff-readable by
 * default. What is shown here is what the decision needs: who owns it, how
 * big it is, and when it arrived.
 *
 * Suspending is REVERSIBLE and destroys nothing — the organization stops
 * granting context, its work stays intact, and restoring puts it back. That
 * is why the confirm below is a single click and not a typed name.
 */

interface AdminOrg {
  id: string
  slug: string
  name: string
  kind: string
  status: OrgStatus
  createdAt: string
  owner: { userId: string; email: string | null; displayName: string | null }
  memberCount: number
  workspaceCount: number
}

interface AdminOrgPage {
  data: AdminOrg[]
  nextCursor: string | null
}

/**
 * `pending` first, and first by default.
 *
 * Someone is blocked behind every pending row, and nobody else is blocked
 * behind any other. A tab strip that opened on "all" would bury the only
 * queue that has a person waiting at the end of it.
 */
const TABS: ReadonlyArray<{ value: OrgStatus | "all"; label: string }> = [
  { value: "pending", label: "Awaiting review" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "all", label: "All" },
]

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  active: "default",
  suspended: "destructive",
  deleted: "outline",
}

async function fetchOrgs(status: OrgStatus | "all"): Promise<AdminOrgPage> {
  const headers = await getAuthHeaders()
  const query = status === "all" ? "" : `?status=${status}`
  const res = await fetch(`/v1/admin/orgs${query}`, { headers })
  const body = (await res.json().catch(() => null)) as
    | (Partial<AdminOrgPage> & { error?: { message?: string } })
    | null
  if (!res.ok) throw new Error(body?.error?.message ?? "Failed to load organizations")
  return { data: body?.data ?? [], nextCursor: body?.nextCursor ?? null }
}

async function setStatus(id: string, status: "active" | "suspended"): Promise<AdminOrg> {
  const headers = await getAuthHeaders()
  headers["Content-Type"] = "application/json"
  const res = await fetch(`/v1/admin/orgs/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ status }),
  })
  const body = (await res.json().catch(() => null)) as
    | { data?: AdminOrg; error?: { message?: string } }
    | null
  if (!res.ok) throw new Error(body?.error?.message ?? "Failed to update the organization")
  return body!.data as AdminOrg
}

export default function AdminOrganizationsPage() {
  const [tab, setTab] = useState<OrgStatus | "all">("pending")
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-orgs", tab],
    queryFn: () => fetchOrgs(tab),
  })

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "suspended" }) => setStatus(id, status),
    // Every tab, not just this one: approving moves a row OUT of the pending
    // list and INTO the active one, and refreshing only the visible tab
    // would leave the other stale until a reload.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-orgs"] }),
  })

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Building2 className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold">Organizations</h1>
          <p className="text-sm text-muted-foreground">
            Whether an organization may operate on this instance. Everything inside one belongs to the
            people who run it.
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button
            key={t.value}
            size="sm"
            variant={tab === t.value ? "default" : "outline"}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {mutation.isError ? (
        <p className="text-sm text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : "Something went wrong"}
        </p>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading organizations…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load organizations"}
        </p>
      ) : (data?.data.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          {tab === "pending" ? "Nothing is waiting for review." : "No organizations here."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Organization</th>
                <th className="px-3 py-2 font-medium">Owner</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.data.map((org) => (
                <tr key={org.id} className="border-t">
                  <td className="px-3 py-2">
                    <div className="font-medium">{org.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {org.kind} · {org.slug}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{org.owner.displayName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{org.owner.email ?? org.owner.userId}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {org.memberCount} {org.memberCount === 1 ? "member" : "members"}
                    {" · "}
                    {org.workspaceCount} {org.workspaceCount === 1 ? "workspace" : "workspaces"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {new Date(org.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[org.status] ?? "outline"}>{org.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <OrgActions
                      org={org}
                      busy={mutation.isPending && mutation.variables?.id === org.id}
                      onSet={(status) => mutation.mutate({ id: org.id, status })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.nextCursor ? (
        <p className="text-xs text-muted-foreground">
          More organizations exist beyond this page.
        </p>
      ) : null}
    </div>
  )
}

/**
 * The actions a status actually permits — never all of them greyed out.
 *
 * A deleted organization offers nothing: restoring one is a support
 * operation with consequences this page cannot show, and a button here would
 * make it look routine.
 */
function OrgActions({
  org,
  busy,
  onSet,
}: {
  org: AdminOrg
  busy: boolean
  onSet: (status: "active" | "suspended") => void
}) {
  if (org.status === "deleted") {
    // Says WHY there is nothing to click. The badge already reports the
    // status; an empty cell beside it reads as a page that failed to render
    // its buttons.
    return <span className="text-xs text-muted-foreground">restore via support</span>
  }
  return (
    <div className="flex justify-end gap-2">
      {org.status === "pending" ? (
        <Button size="sm" disabled={busy} onClick={() => onSet("active")}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Approve"}
        </Button>
      ) : null}
      {org.status === "active" ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onSet("suspended")}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Suspend"}
        </Button>
      ) : null}
      {org.status === "suspended" ? (
        <Button size="sm" disabled={busy} onClick={() => onSet("active")}>
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Restore"}
        </Button>
      ) : null}
    </div>
  )
}
