import { useCallback, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { queryKeys } from "@/lib/query-keys"
import { useWorkspace } from "@/ee/hooks/use-workspace"
import { InviteMembersDialog } from "@/ee/components/org/invite-members-dialog"
import {
  OrgApiError,
  listInvitations,
  listOrgMembers,
  listOrgWorkspaces,
  removeOrgMember,
  resendInvitation,
  revokeInvitation,
  updateOrgMember,
  type InvitationView,
  type OrgMemberView,
} from "@/ee/lib/orgs-api"

/**
 * `/org/:slug/members` — who is in the organization, and who has been asked.
 *
 * Two tabs, because a pending invitation is not a member and a roster that
 * mixes them makes both harder to read: "did I invite her?" and "is she in?"
 * are different questions.
 *
 * The owner's row is inert here by design — ownership moves by transfer, and
 * the database enforces that regardless. Showing the controls greyed out
 * rather than hiding them says WHY the row is different instead of leaving
 * someone hunting for a menu that was never there.
 */
export default function OrgMembersPage() {
  const { slug = "" } = useParams<{ slug: string }>()
  const queryClient = useQueryClient()
  const { organizations, status: membershipStatus } = useWorkspace()
  const [inviting, setInviting] = useState(false)

  const membership = organizations.find((o) => o.slug === slug) ?? null
  const orgId = membership?.id ?? ""
  const vocabulary = membership?.vocabulary ?? {}
  const isOwner = membership?.role === "owner"
  const canManage = isOwner || membership?.role === "admin"

  const members = useQuery({
    queryKey: queryKeys.orgs.members(orgId),
    queryFn: () => listOrgMembers(orgId),
    enabled: canManage && orgId !== "",
    retry: false,
  })

  const invitations = useQuery({
    queryKey: queryKeys.orgs.invitations(orgId, "open"),
    queryFn: () => listInvitations(orgId, { status: "open" }),
    enabled: canManage && orgId !== "",
    retry: false,
  })

  const workspaces = useQuery({
    queryKey: queryKeys.orgs.workspaces(orgId),
    queryFn: () => listOrgWorkspaces(orgId),
    enabled: canManage && orgId !== "",
    retry: false,
  })

  // One invalidation, one root: a role change alters what its subject sees in
  // several places at once, and reasoning about which is how a stale roster
  // survives.
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.all })
  }, [queryClient])

  const patch = useMutation({
    mutationFn: (input: { userId: string; role?: "admin" | "member"; status?: "active" | "suspended" }) =>
      updateOrgMember(orgId, input.userId, { role: input.role, status: input.status }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (userId: string) => removeOrgMember(orgId, userId),
    onSuccess: refresh,
  })
  // Wrapped rather than passed point-free: react-query hands its mutationFn
  // more than the variables, and an api function that quietly receives a
  // second argument is a bug waiting for a signature change.
  const revoke = useMutation({ mutationFn: (id: string) => revokeInvitation(id), onSuccess: refresh })
  const resend = useMutation({ mutationFn: (id: string) => resendInvitation(id), onSuccess: refresh })

  if (membershipStatus === "idle" || membershipStatus === "loading") {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }

  if (!membership || !canManage) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card className="space-y-4 p-8">
          <h1 className="text-xl font-semibold">{membership ? "Not available to you" : "Organization not found"}</h1>
          <p className="text-sm text-muted-foreground">
            {membership
              ? "Only an owner or an administrator can see who is in an organization."
              : "This organization does not exist, or you are not a member of it."}
          </p>
          <Button asChild variant="outline">
            <Link to={membership ? `/org/${slug}` : "/"}>Back</Link>
          </Button>
        </Card>
      </div>
    )
  }

  const mutationError = patch.error ?? remove.error ?? revoke.error ?? resend.error

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">People</h1>
          <Link to={`/org/${slug}`} className="text-sm text-muted-foreground hover:underline">
            {membership.name}
          </Link>
        </div>
        <Button onClick={() => setInviting(true)} disabled={membership.status !== "active"}>
          Invite people
        </Button>
      </header>

      {membership.status !== "active" && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-muted-foreground">
          Nobody can be invited or changed while this organization is {membership.status}.
        </p>
      )}

      {mutationError && (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {actionFailureMessage(mutationError)}
        </p>
      )}

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invitations">
            Invited{(invitations.data?.data.length ?? 0) > 0 ? ` (${invitations.data?.data.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="members" className="pt-4">
          {members.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {members.error && <p className="text-sm text-muted-foreground">Could not load the members.</p>}
          {members.data && (
            <ul className="divide-y rounded-md border">
              {members.data.data.map((member) => (
                <MemberRow
                  key={member.userId}
                  member={member}
                  vocabulary={vocabulary}
                  canManage={membership.status === "active"}
                  isSelf={false}
                  onPatch={(input) => patch.mutate({ userId: member.userId, ...input })}
                  onRemove={() => remove.mutate(member.userId)}
                />
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="invitations" className="pt-4">
          {invitations.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {invitations.data?.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Nobody is waiting on an invitation.</p>
          )}
          {(invitations.data?.data.length ?? 0) > 0 && (
            <ul className="divide-y rounded-md border">
              {invitations.data!.data.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  onResend={() => resend.mutate(invitation.id)}
                  onRevoke={() => revoke.mutate(invitation.id)}
                  busy={resend.isPending || revoke.isPending}
                />
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <InviteMembersDialog
        orgId={orgId}
        open={inviting}
        onOpenChange={setInviting}
        workspaces={workspaces.data ?? []}
        canInviteAdmins={canManage}
        vocabulary={vocabulary}
        onInvited={refresh}
      />
    </div>
  )
}

function MemberRow({
  member,
  vocabulary,
  canManage,
  isSelf,
  onPatch,
  onRemove,
}: {
  member: OrgMemberView
  vocabulary: Record<string, string>
  canManage: boolean
  isSelf: boolean
  onPatch: (input: { role?: "admin" | "member"; status?: "active" | "suspended" }) => void
  onRemove: () => void
}) {
  // The owner's row is inert: ownership moves by transfer, and the database
  // refuses anything else. Greying it out says why; hiding the controls would
  // leave someone hunting for a menu that was never there.
  const locked = member.role === "owner" || !canManage || isSelf

  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{member.displayName ?? member.email ?? member.userId}</p>
        {member.email && <p className="truncate text-xs text-muted-foreground">{member.email}</p>}
      </div>

      {member.status === "suspended" && (
        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">Suspended</span>
      )}

      {member.role === "owner" ? (
        <span className="text-xs text-muted-foreground">{vocabulary.org_owner ?? "Owner"} · by transfer only</span>
      ) : (
        <Select
          value={member.role}
          onValueChange={(role) => onPatch({ role: role as "admin" | "member" })}
          disabled={locked}
        >
          <SelectTrigger className="w-40" aria-label={`Role for ${member.displayName ?? member.email ?? member.userId}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">{vocabulary.workspace_member ?? "Member"}</SelectItem>
            <SelectItem value="admin">{vocabulary.org_admin ?? "Admin"}</SelectItem>
          </SelectContent>
        </Select>
      )}

      <div className={cn("flex gap-2", locked && "invisible")}>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onPatch({ status: member.status === "suspended" ? "active" : "suspended" })}
        >
          {member.status === "suspended" ? "Reinstate" : "Suspend"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </li>
  )
}

function InvitationRow({
  invitation,
  onResend,
  onRevoke,
  busy,
}: {
  invitation: InvitationView
  onResend: () => void
  onRevoke: () => void
  busy: boolean
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{invitation.email}</p>
        <p className="text-xs text-muted-foreground">
          Expires {new Date(invitation.expiresAt).toLocaleDateString()}
          {invitation.orgRole === "admin" ? " · as an admin" : ""}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onResend} disabled={busy}>
        Resend
      </Button>
      <Button size="sm" variant="ghost" onClick={onRevoke} disabled={busy}>
        Revoke
      </Button>
    </li>
  )
}

function actionFailureMessage(error: unknown): string {
  const code = error instanceof OrgApiError ? error.code : "internal_error"
  switch (code) {
    case "insufficient_role":
      return "You cannot make that change."
    case "org_not_active":
      return "This organization is not active, so nothing here can be changed."
    case "validation_error":
      return error instanceof OrgApiError ? error.message : "That change was refused."
    case "invitation_accepted":
      return "That invitation has already been accepted."
    case "not_found":
      return "That person is no longer here. Reload to see the current list."
    default:
      return "Something went wrong. Try again in a moment."
  }
}
