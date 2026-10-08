import { Navigate, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import NotFound from "@/components/not-found"
import { useT } from "@/lib/i18n"
import { queryKeys } from "@/lib/query-keys"
import { createClient } from "@/lib/supabase"

/** A workflow id (a UUID). */
const WORKFLOW_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `/editor/<workflowId>` — the short link to a workflow: what assistants are
 * taught to share (the MCP Film Director skill builds it, and chats already
 * hold it) and what the Shared page links to. The editor itself lives under
 * its project, so the project is looked up here, with the viewer's own access
 * (the row policies the editor reads with), and the editor opens at its full
 * address. A workflow the viewer cannot read is not found — the same answer
 * as one that does not exist.
 */
export default function EditorLinkPage() {
  const t = useT()
  const { workflowId = "" } = useParams<{ workflowId: string }>()
  const valid = WORKFLOW_ID.test(workflowId)
  const project = useQuery({
    queryKey: queryKeys.editor.workflowProject(workflowId),
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await createClient().from("workflows").select("project_id").eq("id", workflowId).maybeSingle()
      if (error) throw error
      return (data as { project_id: string | null } | null)?.project_id ?? null
    },
    enabled: valid,
    retry: false,
    // Asked fresh on every visit and never acted on from memory: a workflow
    // moved since the last click opens under its new project, not the old one
    // (whose address a collaborator's save would then be refused for).
    staleTime: 0,
    gcTime: 0,
  })

  if (!valid || project.isError || (project.isSuccess && !project.isFetching && !project.data)) return <NotFound />
  if (!project.data || project.isFetching) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label={t("common.loading")} />
      </div>
    )
  }
  return <Navigate to={`/projects/${project.data}/workflows/${workflowId}`} replace />
}
