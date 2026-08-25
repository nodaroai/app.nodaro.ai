import { useCallback, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, UserPlus, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  addWorkflowCollaborator,
  listWorkflowCollaborators,
  removeWorkflowCollaborator,
  setWorkflowVisibility,
  updateWorkflowCollaborator,
  type CollaboratorRole,
  type WorkflowAccessInfo,
} from "@/lib/api"

/**
 * People with access to one workflow, and the workspace-wide switch beside
 * them.
 *
 * Two different ways to widen who can reach a piece of work, kept together
 * because they answer the same question and apart from the public share link
 * above them, which answers a third one — a link is for anyone who has it, a
 * grant is for one person and can be taken back.
 *
 * The visibility switch is RENDERED ONLY when the server has already said this
 * caller may change it (`canChangeVisibility`). Showing a control that answers
 * 403 teaches people the product is broken; not showing it teaches them the
 * rule.
 */

interface CollaboratorsPanelProps {
  workflowId: string
  access: WorkflowAccessInfo
  onVisibilityChanged?: () => void
}

const ROLE_LABEL: Record<CollaboratorRole, string> = {
  viewer: "Can view",
  editor: "Can edit",
}

export function CollaboratorsPanel({
  workflowId,
  access,
  onVisibilityChanged,
}: CollaboratorsPanelProps) {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<CollaboratorRole>("viewer")

  const listKey = ["workflow-collaborators", workflowId] as const

  const { data, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => listWorkflowCollaborators(workflowId),
    staleTime: 30_000,
  })

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: listKey })
  }, [queryClient, listKey])

  const add = useMutation({
    mutationFn: () => addWorkflowCollaborator(workflowId, { email: email.trim() }, role),
    onSuccess: () => {
      setEmail("")
      invalidate()
      toast.success("Shared")
    },
    // The server's message is the useful one here: "no account with that
    // address", "already has access", "that is the owner". Replacing it with a
    // generic failure would throw away the only part the person can act on.
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not share"),
  })

  const changeRole = useMutation({
    mutationFn: (v: { userId: string; role: CollaboratorRole }) =>
      updateWorkflowCollaborator(workflowId, v.userId, v.role),
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not change the role"),
  })

  const remove = useMutation({
    mutationFn: (userId: string) => removeWorkflowCollaborator(workflowId, userId),
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not remove access"),
  })

  const setVisibility = useMutation({
    mutationFn: (v: "private" | "workspace") => setWorkflowVisibility(workflowId, v),
    onSuccess: () => {
      onVisibilityChanged?.()
      toast.success("Updated")
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not update"),
  })

  const collaborators = data?.data ?? []
  // The server's own answer, not one inferred from a neighbouring field.
  // "May I hand this to somebody" and "may I open it to the whole workspace"
  // are different rules with different answers — a team workspace can allow
  // the first and reserve the second — so deriving one from the other hides
  // the invite field from exactly the people a team preset was configured to
  // let invite.
  const canShare = access.canShare

  return (
    <div className="space-y-4">
      {/* The workspace-wide lever. Only for work that is IN a workspace —
          a personal workflow has nothing to be visible to. */}
      {access.workspaceId !== null && access.canChangeVisibility && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Everyone in this workspace</label>
          <Select
            value={access.visibility}
            onValueChange={(v) => setVisibility.mutate(v as "private" | "workspace")}
            disabled={setVisibility.isPending}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="private">Only people I share it with</SelectItem>
              <SelectItem value="workspace">Everyone in the workspace</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">People with access</label>

        {canShare && (
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && email.trim()) add.mutate()
              }}
              disabled={add.isPending}
            />
            <Select value={role} onValueChange={(v) => setRole(v as CollaboratorRole)}>
              <SelectTrigger className="w-[130px] shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">{ROLE_LABEL.viewer}</SelectItem>
                <SelectItem value="editor">{ROLE_LABEL.editor}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="icon"
              className="shrink-0"
              onClick={() => add.mutate()}
              disabled={!email.trim() || add.isPending}
              aria-label="Share with this person"
            >
              {add.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading
          </div>
        ) : collaborators.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">
            Nobody yet. Add someone by email to share this workflow with them.
          </p>
        ) : (
          <ul className="space-y-1">
            {collaborators.map((c) => (
              <li key={c.userId} className="flex items-center gap-2">
                {/* Names and avatars only — an address is never listed. This
                    list is readable by anyone who can view the workflow,
                    including someone granted a look at this one thing and
                    belonging to nothing else. */}
                {c.avatarUrl ? (
                  <img
                    src={c.avatarUrl}
                    alt=""
                    // The URL is chosen by the person it depicts, and this
                    // dialog is opened from `/editor/<workflowId>`. Without
                    // this, every render tells whoever hosts the image the
                    // viewer's IP and — through the Referer — exactly which
                    // workflow they just opened the share dialog on.
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="h-7 w-7 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs">
                    {(c.name ?? "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="min-w-0 flex-1 truncate text-sm">{c.name ?? "Someone"}</span>
                {canShare ? (
                  <>
                    <Select
                      value={c.role}
                      onValueChange={(v) =>
                        changeRole.mutate({ userId: c.userId, role: v as CollaboratorRole })
                      }
                    >
                      <SelectTrigger className="h-8 w-[130px] shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">{ROLE_LABEL.viewer}</SelectItem>
                        <SelectItem value="editor">{ROLE_LABEL.editor}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => remove.mutate(c.userId)}
                      aria-label={`Remove ${c.name ?? "this person"}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {ROLE_LABEL[c.role]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
