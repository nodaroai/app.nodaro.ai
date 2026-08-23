import { Link, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { queryKeys } from "@/lib/query-keys"
import { useWorkspace } from "@/ee/hooks/use-workspace"
import { pluralize } from "@/ee/lib/pluralize"
import { OrgApiError, getOrganization, listOrgWorkspaces } from "@/ee/lib/orgs-api"

/**
 * `/org/:slug` — where an organization is looked after.
 *
 * The slug is resolved from the memberships already in hand rather than by
 * asking the server to look one up: the client knows which organizations it
 * belongs to, and an id it does not recognise is one it has no business
 * asking about. That also means the URL is stable across a rename, which is
 * why the address is a slug and not a name.
 *
 * What a member sees and what an owner sees differ, and the difference is
 * decided by the role in the membership — not to keep anything secret (the
 * server refuses either way) but so that nobody is shown a door that will
 * not open.
 */
export default function OrgOverviewPage() {
  const { slug = "" } = useParams<{ slug: string }>()
  const { organizations, status: membershipStatus } = useWorkspace()

  const membership = organizations.find((o) => o.slug === slug) ?? null
  const vocabulary = membership?.vocabulary ?? {}
  const workspaceWord = vocabulary.workspace ?? "Workspace"

  const org = useQuery({
    queryKey: queryKeys.orgs.detail(membership?.id ?? slug),
    queryFn: () => getOrganization(membership!.id),
    enabled: membership !== null,
    retry: false,
  })

  const workspaces = useQuery({
    queryKey: queryKeys.orgs.workspaces(membership?.id ?? slug),
    queryFn: () => listOrgWorkspaces(membership!.id),
    enabled: membership !== null,
    retry: false,
  })

  // "Not loaded yet" and "not yours" are different answers and must not be
  // rendered as the same one — the first resolves on its own.
  if (membershipStatus === "idle" || membershipStatus === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }

  if (!membership) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card className="space-y-4 p-8">
          <h1 className="text-xl font-semibold">Organization not found</h1>
          <p className="text-sm text-muted-foreground">
            This organization does not exist, or you are not a member of it.
          </p>
          <Button asChild variant="outline">
            <Link to="/">Back to your work</Link>
          </Button>
        </Card>
      </div>
    )
  }

  const isAdmin = membership.role === "owner" || membership.role === "admin"
  // The membership snapshot is from the last hydration and the query is from
  // now, so org-level facts come from the query when it has answered. It
  // matters most for approval: without this the pending banner would sit
  // there after the organization went live, and nothing on this page reloads
  // memberships.
  const orgStatus = org.data?.status ?? membership.status
  const live = (workspaces.data ?? []).filter((w) => !w.archived)

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold">{org.data?.name ?? membership.name}</h1>
            <OrgStatusPill status={orgStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            {membership.kind === "school" ? "School" : "Team"} · your role: {roleWord(membership.role, vocabulary)}
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/org/${slug}/members`}>People</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={`/org/${slug}/settings`}>Settings</Link>
            </Button>
          </div>
        )}
      </header>

      {orgStatus === "pending" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">Waiting for approval.</p>
          <p className="text-muted-foreground">
            New organizations are reviewed before they open. Nothing else is needed from you — you will be able to add
            people and create {pluralize(workspaceWord).toLowerCase()} as soon as it is approved.
          </p>
        </div>
      )}

      {orgStatus === "suspended" && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <p className="font-medium">This organization is suspended.</p>
          <p className="text-muted-foreground">Everything stays readable. Nothing can be changed until it is lifted.</p>
        </div>
      )}

      <Card className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{pluralize(workspaceWord)}</h2>
          {isAdmin && orgStatus === "active" && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/org/${slug}/workspaces`}>Manage</Link>
            </Button>
          )}
        </div>

        {workspaces.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {workspaces.error && (
          <p className="text-sm text-muted-foreground">
            {workspaces.error instanceof OrgApiError && workspaces.error.code === "insufficient_role"
              ? `You can see the ${pluralize(workspaceWord).toLowerCase()} you belong to from the switcher.`
              : `Could not load the ${pluralize(workspaceWord).toLowerCase()}.`}
          </p>
        )}

        {!workspaces.isLoading && !workspaces.error && live.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {`No ${pluralize(workspaceWord).toLowerCase()} yet.`}
            {isAdmin && orgStatus === "active" && " Create one to give people somewhere to work."}
          </p>
        )}

        {live.length > 0 && (
          <ul className="divide-y">
            {live.map((workspace) => (
              <li key={workspace.id} className="flex items-center justify-between py-2">
                <Link to={`/w/${workspace.id}`} className="text-sm hover:underline">
                  {workspace.name}
                </Link>
                {workspace.role && <span className="text-xs text-muted-foreground">{workspace.role}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

export function OrgStatusPill({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : status === "pending"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-destructive/10 text-destructive"
  // "Active" is the unremarkable state; a pill that only ever appears when
  // something is off is read faster than one that is always there.
  if (status === "active") return null
  return <span className={cn("rounded-full px-2 py-0.5 text-xs capitalize", tone)}>{status}</span>
}

function roleWord(role: string, vocabulary: Record<string, string>): string {
  if (role === "owner") return vocabulary.org_owner ?? "Owner"
  if (role === "admin") return vocabulary.org_admin ?? "Admin"
  return vocabulary.workspace_member ?? "Member"
}

