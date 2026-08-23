import { useEffect } from "react"
import { Link, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { queryKeys } from "@/lib/query-keys"
import { getActiveWorkspaceId, setActiveWorkspace } from "@/lib/workspace-context"
import { useVocabulary } from "@/ee/hooks/use-workspace"
import { OrgApiError, getWorkspace } from "@/ee/lib/orgs-api"

/**
 * `/w/:id` — the workspace someone just joined or switched into.
 *
 * Deliberately a SHELL. What belongs here is the work the workspace
 * contains, and content is not scoped to workspaces yet; putting a
 * half-built list here now would have to be unbuilt later. What it does own
 * is the one thing that has to be right from the first day: arriving at a
 * URL selects that workspace, so a link someone pastes to a colleague puts
 * them in the same place rather than showing them their own work under
 * someone else's title.
 *
 * The archived banner is here for the same reason — a read-only workspace
 * that does not say so is how someone loses ten minutes to a save button
 * that will never work.
 */
export default function WorkspaceHomePage() {
  const { id = "" } = useParams<{ id: string }>()
  const vocabulary = useVocabulary()

  const { data, error, isLoading } = useQuery({
    queryKey: queryKeys.orgs.workspace(id),
    queryFn: () => getWorkspace(id),
    retry: false,
  })

  // Arriving by URL selects the workspace: a pasted link has to put the
  // recipient in the same place the sender was.
  useEffect(() => {
    if (data && getActiveWorkspaceId() !== data.id) setActiveWorkspace(data.id)
  }, [data])

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>
  }

  if (error) {
    const code = error instanceof OrgApiError ? error.code : "internal_error"
    return (
      <div className="mx-auto max-w-xl p-6">
        <Card className="space-y-4 p-8">
          <h1 className="text-xl font-semibold">{title(code, vocabulary.workspace ?? "workspace")}</h1>
          <p className="text-sm text-muted-foreground">{explain(code, vocabulary.workspace ?? "workspace")}</p>
          <Button asChild variant="outline">
            <Link to="/">Back to your work</Link>
          </Button>
        </Card>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          {data.role === "admin" && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {vocabulary.workspace_admin ?? "Admin"}
            </span>
          )}
        </div>
        {data.description && <p className="text-sm text-muted-foreground">{data.description}</p>}
      </header>

      {data.archived && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium">This {(vocabulary.workspace ?? "workspace").toLowerCase()} is archived.</p>
          <p className="text-muted-foreground">
            Everything in it stays readable. Nothing new can be added until an administrator reopens it.
          </p>
        </div>
      )}

      <Card className="space-y-2 p-6">
        <h2 className="font-medium">Shared work</h2>
        <p className="text-sm text-muted-foreground">
          Work created here will appear in this list. Until then, everything you make is in your personal space.
        </p>
      </Card>

      {data.role === "admin" && (
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/w/${data.id}/people`}>People</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/w/${data.id}/settings`}>Settings</Link>
          </Button>
        </div>
      )}
    </div>
  )
}

function title(code: string, workspaceWord: string): string {
  if (code === "member_suspended") return "Your membership is suspended"
  return `${workspaceWord} not found`
}

function explain(code: string, workspaceWord: string): string {
  switch (code) {
    case "member_suspended":
      return "You cannot open this while your membership is suspended. An administrator can lift it."
    case "org_not_active":
      return "The organization this belongs to is not active."
    default:
      // A 404 here means "no such workspace" OR "not yours" — the server
      // gives one answer on purpose, and repeating it is the honest thing.
      return `This ${workspaceWord.toLowerCase()} does not exist, or you are not a member of it.`
  }
}
