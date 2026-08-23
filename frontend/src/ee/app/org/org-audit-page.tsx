import { useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { queryKeys } from "@/lib/query-keys"
import { useWorkspace } from "@/ee/hooks/use-workspace"
import { listOrgAudit, type OrgAuditEntry } from "@/ee/lib/orgs-api"

/**
 * `/org/:slug/audit` — what happened, newest first.
 *
 * The page exists for the conversation that starts "who removed her?". Every
 * other organization screen shows the CURRENT state, which is exactly the
 * information that is useless once something has gone wrong.
 *
 * Readable while the organization is SUSPENDED, unlike every other management
 * screen. A suspension is the moment someone most needs to know what led to
 * it, and hiding the record then would be hiding it at the only point it
 * matters.
 *
 * Actions are rendered from an OPEN vocabulary. New ones arrive as the
 * product grows, and a page that threw on an unrecognised action would turn a
 * new feature into a broken screen — so anything unknown falls back to its
 * raw string, which is still readable.
 */
export default function OrgAuditPage() {
  const { slug = "" } = useParams<{ slug: string }>()
  const { organizations, status: membershipStatus } = useWorkspace()
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const membership = organizations.find((o) => o.slug === slug) ?? null
  const orgId = membership?.id ?? ""
  const canRead = membership?.role === "owner" || membership?.role === "admin"

  const audit = useQuery({
    queryKey: queryKeys.orgs.audit(orgId, cursor),
    queryFn: () => listOrgAudit(orgId, { cursor }),
    enabled: canRead && orgId !== "",
    retry: false,
  })

  if (membershipStatus === "idle" || membershipStatus === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }

  // "We could not find out" is not "it does not exist". Collapsing them
  // tells an owner their school vanished because a cache blipped — the one
  // thing the three-state `me` payload exists to prevent.
  if (membershipStatus === "unavailable") {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card className="space-y-4 p-8">
          <h1 className="text-xl font-semibold">Could not load your organizations</h1>
          <p className="text-sm text-muted-foreground">
            This is a problem reaching Nodaro, not a change to what you belong to. Try again in a moment.
          </p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </Card>
      </div>
    )
  }

  if (!membership || !canRead) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card className="space-y-4 p-8">
          <h1 className="text-xl font-semibold">
            {membership ? "Not available to you" : "Organization not found"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {membership
              ? "Only an owner or an administrator can read the history of an organization."
              : "This organization does not exist, or you are not a member of it."}
          </p>
          <Button asChild variant="outline">
            <Link to={membership ? `/org/${slug}` : "/"}>Back</Link>
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">History</h1>
        <Link to={`/org/${slug}`} className="text-sm text-muted-foreground hover:underline">
          {membership.name}
        </Link>
      </header>

      {audit.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {audit.error && <p className="text-sm text-muted-foreground">Could not load the history.</p>}

      {audit.data?.data.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing has been recorded yet.</p>
      )}

      {(audit.data?.data.length ?? 0) > 0 && (
        <ul className="divide-y rounded-md border">
          {audit.data?.data.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}
        </ul>
      )}

      {audit.data?.nextCursor && (
        <Button variant="outline" onClick={() => setCursor(audit.data.nextCursor ?? undefined)}>
          Show older
        </Button>
      )}
      {cursor && (
        <Button variant="ghost" onClick={() => setCursor(undefined)}>
          Back to the newest
        </Button>
      )}
    </div>
  )
}

function AuditRow({ entry }: { entry: OrgAuditEntry }) {
  const actor = entry.actor?.displayName ?? entry.actor?.email ?? null
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm">{describeAction(entry)}</p>
        <p className="text-xs text-muted-foreground">
          {/* "The system" rather than a blank: an action with no actor was
              taken by nobody, and an empty space reads as missing data. */}
          {actor ?? (entry.actor ? entry.actor.userId : "The system")}
        </p>
      </div>
      <time className="text-xs text-muted-foreground" dateTime={entry.createdAt}>
        {new Date(entry.createdAt).toLocaleString()}
      </time>
    </li>
  )
}

/**
 * Plain words for the actions we recognise, and the raw action for the rest.
 *
 * Deliberately a LABEL MAP and not a contract: the server owns this
 * vocabulary and adds to it, and the public schema promises only that the
 * column holds a string. So this list makes no claim to be complete, the
 * fallback is the part that has to keep working, and a new action that
 * arrives before this map hears about it renders as its own name — readable,
 * if less friendly — rather than as a blank row or a thrown page.
 *
 * It covers the lifecycle this product HAS — organizations, members,
 * workspaces, invitations, join codes. Actions belonging to levers that have
 * not shipped are left to the fallback on purpose: a friendly label is a
 * commitment, and naming a feature before it exists is a promise made in the
 * wrong place. Add the label when the lever ships.
 */
const ACTION_WORDS: Record<string, string> = {
  "org.created": "Organization created",
  "org.approved": "Organization approved",
  "org.suspended": "Organization suspended",
  "org.unsuspended": "Organization restored",
  "org.deleted": "Organization deleted",
  "org.settings.updated": "Organization settings changed",
  "org.ownership.transferred": "Ownership transferred",
  "org.member.invited": "Someone was invited",
  "org.member.joined": "Someone joined",
  "org.member.role_changed": "A member's role changed",
  "org.member.suspended": "A member was suspended",
  "org.member.unsuspended": "A member was reinstated",
  "org.member.removed": "A member was removed",
  "org.member.left": "A member left",
  "invitation.resent": "An invitation was resent",
  "invitation.revoked": "An invitation was revoked",
  "workspace.created": "Workspace created",
  "workspace.updated": "Workspace renamed or described",
  "workspace.archived": "Workspace archived",
  "workspace.unarchived": "Workspace restored",
  "workspace.settings.updated": "Workspace settings changed",
  "workspace.member.added": "Someone was added to a workspace",
  "workspace.member.role_changed": "A workspace role changed",
  "workspace.member.suspended": "A workspace member was suspended",
  "workspace.member.unsuspended": "A workspace member was reinstated",
  "workspace.member.removed": "Someone was removed from a workspace",
  "workspace.join_code.rotated": "A join code was rotated",
  "workspace.join_code.enabled": "A join code was enabled",
  "workspace.join_code.disabled": "A join code was disabled",
}

function describeAction(entry: OrgAuditEntry): string {
  return ACTION_WORDS[entry.action] ?? entry.action
}
