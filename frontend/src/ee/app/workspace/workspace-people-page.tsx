import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { queryKeys } from "@/lib/query-keys"
import { useVocabulary } from "@/ee/hooks/use-workspace"
import {
  OrgApiError,
  getWorkspace,
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMember,
  type WorkspaceMemberView,
} from "@/ee/lib/orgs-api"

/**
 * `/w/:id/people` — who is in this workspace.
 *
 * A member and an admin get different rows from the SERVER, not different
 * rendering of the same row: a member's list carries no standing and no
 * spending cap, because those are an administrator's business. This page
 * shows what it was given, which is why a member opening it sees a plain
 * list rather than a table of greyed-out controls.
 *
 * Removing someone here removes them from the workspace and NOT from the
 * organization — the two are different decisions and the copy says so,
 * because "remove" that quietly means "expel" is the kind of button people
 * stop trusting.
 */
export default function WorkspacePeoplePage() {
  const { id = "" } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const vocabulary = useVocabulary()
  const workspaceWord = vocabulary.workspace ?? "Workspace"

  const workspace = useQuery({
    queryKey: queryKeys.orgs.workspace(id),
    queryFn: () => getWorkspace(id),
    retry: false,
  })

  const members = useQuery({
    queryKey: queryKeys.orgs.workspaceMembers(id),
    queryFn: () => listWorkspaceMembers(id),
    enabled: workspace.data !== undefined,
    retry: false,
  })

  const refresh = () => void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.all })

  const patch = useMutation({
    mutationFn: (input: { userId: string; role?: "admin" | "member"; status?: "active" | "suspended" }) =>
      updateWorkspaceMember(id, input.userId, { role: input.role, status: input.status }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (userId: string) => removeWorkspaceMember(id, userId),
    onSuccess: refresh,
  })

  if (workspace.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>

  if (workspace.error || !workspace.data) {
    const code = workspace.error instanceof OrgApiError ? workspace.error.code : "internal_error"
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card className="space-y-4 p-8">
          <h1 className="text-xl font-semibold">Not available</h1>
          <p className="text-sm text-muted-foreground">
            {code === "member_suspended"
              ? "You cannot open this while your membership is suspended."
              : `This ${workspaceWord.toLowerCase()} does not exist, or you are not a member of it.`}
          </p>
          <Button asChild variant="outline">
            <Link to="/">Back to your work</Link>
          </Button>
        </Card>
      </div>
    )
  }

  const isAdmin = workspace.data.role === "admin"
  const canChange = isAdmin && !workspace.data.archived
  const mutationError = patch.error ?? remove.error

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">People</h1>
        <Link to={`/w/${id}`} className="text-sm text-muted-foreground hover:underline">
          {workspace.data.name}
        </Link>
      </header>

      {workspace.data.archived && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-muted-foreground">
          This {workspaceWord.toLowerCase()} is archived. Its members cannot be changed until it is reopened.
        </p>
      )}

      {mutationError && (
        <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {actionFailureMessage(mutationError)}
        </p>
      )}

      {members.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {members.error && <p className="text-sm text-muted-foreground">Could not load the people here.</p>}

      {members.data && members.data.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nobody has been added to this {workspaceWord.toLowerCase()} yet.
        </p>
      )}

      {members.data && members.data.data.length > 0 && (
        <ul className="divide-y rounded-md border">
          {members.data.data.map((member) => (
            <PersonRow
              key={member.userId}
              member={member}
              vocabulary={vocabulary}
              canChange={canChange}
              onPatch={(input) => patch.mutate({ userId: member.userId, ...input })}
              onRemove={() => remove.mutate(member.userId)}
            />
          ))}
        </ul>
      )}

      {isAdmin && (
        <p className="text-xs text-muted-foreground">
          Removing someone here takes them out of this {workspaceWord.toLowerCase()} only. They stay in the
          organization.
        </p>
      )}
    </div>
  )
}

function PersonRow({
  member,
  vocabulary,
  canChange,
  onPatch,
  onRemove,
}: {
  member: WorkspaceMemberView
  vocabulary: Record<string, string>
  canChange: boolean
  onPatch: (input: { role?: "admin" | "member"; status?: "active" | "suspended" }) => void
  onRemove: () => void
}) {
  // `status` and `creditCap` are present only in an admin's copy of the row —
  // the server decides that, and their absence is what tells this component
  // it is rendering a member's view.
  const seesStanding = member.status !== undefined

  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      <p className="min-w-0 flex-1 truncate text-sm font-medium">{member.displayName ?? member.userId}</p>

      {seesStanding && member.status === "suspended" && (
        <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">Suspended</span>
      )}

      {canChange ? (
        <Select value={member.role} onValueChange={(role) => onPatch({ role: role as "admin" | "member" })}>
          <SelectTrigger className="w-36" aria-label={`Role for ${member.displayName ?? member.userId}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">{vocabulary.workspace_member ?? "Member"}</SelectItem>
            <SelectItem value="admin">{vocabulary.workspace_admin ?? "Admin"}</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <span className="text-xs text-muted-foreground">
          {member.role === "admin" ? (vocabulary.workspace_admin ?? "Admin") : (vocabulary.workspace_member ?? "Member")}
        </span>
      )}

      {canChange && (
        <div className="flex gap-2">
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
      )}
    </li>
  )
}

function actionFailureMessage(error: unknown): string {
  const code = error instanceof OrgApiError ? error.code : "internal_error"
  switch (code) {
    case "insufficient_role":
      return "You cannot make that change."
    case "workspace_archived":
      return "This workspace is archived, so its members cannot be changed."
    case "org_not_active":
      return "This organization is not active."
    case "not_found":
      return "That person is no longer here. Reload to see the current list."
    default:
      return "Something went wrong. Try again in a moment."
  }
}
