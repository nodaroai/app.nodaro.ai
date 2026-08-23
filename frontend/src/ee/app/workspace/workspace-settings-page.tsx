import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { queryKeys } from "@/lib/query-keys"
import { useVocabulary } from "@/ee/hooks/use-workspace"
import { JoinCodeCard } from "@/ee/components/org/join-code-card"
import { OrgApiError, getWorkspace, updateWorkspace } from "@/ee/lib/orgs-api"

/**
 * `/w/:id/settings` — the name, the description, and the join code.
 *
 * Whether the caller may be here is the SERVER's answer, not a guess made
 * from a membership snapshot: this page is reached from a workspace someone
 * is already in, and the read either succeeds or says why. That also means
 * an archived workspace renders normally and refuses its writes with the
 * reason, rather than being hidden behind a role check that would say
 * nothing about archiving at all.
 */
export default function WorkspaceSettingsPage() {
  const { id = "" } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const vocabulary = useVocabulary()
  const workspaceWord = vocabulary.workspace ?? "Workspace"

  const workspace = useQuery({
    queryKey: queryKeys.orgs.workspace(id),
    queryFn: () => getWorkspace(id),
    retry: false,
  })

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [dirty, setDirty] = useState(false)

  // Seed the fields once the workspace arrives, and never again — refetching
  // under someone who is typing is how an edit disappears mid-sentence.
  useEffect(() => {
    if (!workspace.data || dirty) return
    setName(workspace.data.name)
    setDescription(workspace.data.description ?? "")
  }, [workspace.data, dirty])

  const save = useMutation({
    mutationFn: () => updateWorkspace(id, { name: name.trim(), description: description.trim() || null }),
    onSuccess: () => {
      setDirty(false)
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgs.all })
    },
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

  const data = workspace.data
  const isAdmin = data.role === "admin"
  const locked = !isAdmin || data.archived

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <Link to={`/w/${id}`} className="text-sm text-muted-foreground hover:underline">
          {data.name}
        </Link>
      </header>

      {!isAdmin && (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">
          Only an administrator of this {workspaceWord.toLowerCase()} can change these.
        </p>
      )}

      {data.archived && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-muted-foreground">
          This {workspaceWord.toLowerCase()} is archived. Nothing can be changed until it is reopened.
        </p>
      )}

      <Card className="space-y-4 p-6">
        <div className="space-y-2">
          <Label htmlFor="ws-name">Name</Label>
          <Input
            id="ws-name"
            value={name}
            onChange={(e) => {
              setDirty(true)
              setName(e.target.value)
            }}
            maxLength={120}
            disabled={locked || save.isPending}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ws-description">Description</Label>
          <Textarea
            id="ws-description"
            value={description}
            onChange={(e) => {
              setDirty(true)
              setDescription(e.target.value)
            }}
            rows={3}
            maxLength={2000}
            disabled={locked || save.isPending}
          />
        </div>

        {save.error && (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{saveFailureMessage(save.error)}</p>
        )}

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={locked || save.isPending || !dirty || name.trim().length === 0}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>

      {isAdmin && <JoinCodeCard workspaceId={id} workspaceWord={workspaceWord} disabled={data.archived} />}
    </div>
  )
}

function saveFailureMessage(error: unknown): string {
  const code = error instanceof OrgApiError ? error.code : "internal_error"
  switch (code) {
    case "insufficient_role":
      return "You cannot change these settings."
    case "workspace_archived":
      return "This workspace is archived, so nothing can be changed."
    case "org_not_active":
      return "This organization is not active."
    case "name_taken":
      return "Another workspace in this organization already uses that address."
    case "validation_error":
      return error instanceof OrgApiError ? error.message : "That change was refused."
    default:
      return "Something went wrong saving. Try again in a moment."
  }
}
