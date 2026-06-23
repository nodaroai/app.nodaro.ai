import { useState, useMemo } from "react"
import { Link } from "react-router-dom"
import { Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { WorkflowThumbnail } from "./workflow-thumbnail"
import {
  useMyStudioWorkflows,
  useAllStudioWorkflows,
  type MyWorkflow,
} from "@/hooks/queries/use-my-workflows-queries"

interface StudioWorkflowsViewProps {
  /** Admin "All users" switch is on — show every user's Studio workflows. */
  readonly showAll: boolean
}

/**
 * "Studio Workflows" dashboard tab — workflows that originated in
 * studio.nodaro.ai (settings.studio set). Visible to everyone: each user sees
 * their own; admins can flip the "All users" switch to see everyone's (with the
 * owner email shown). Cards open the in-app editor (read-only for Studio
 * projects, as elsewhere).
 */
export function StudioWorkflowsView({ showAll }: StudioWorkflowsViewProps) {
  const mine = useMyStudioWorkflows()
  const all = useAllStudioWorkflows(showAll)

  const workflows: MyWorkflow[] = showAll ? (all.data?.data ?? []) : (mine.data ?? [])
  const isLoading = showAll ? all.isLoading : mine.isLoading

  const [search, setSearch] = useState("")
  const filtered = useMemo(() => {
    if (!search.trim()) return workflows
    const needle = search.toLowerCase()
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(needle) ||
        (w.ownerEmail?.toLowerCase().includes(needle) ?? false) ||
        w.projectName.toLowerCase().includes(needle),
    )
  }, [workflows, search])

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (workflows.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-muted-foreground">
          {showAll ? "No Studio workflows found." : "No Studio workflows yet."}
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          {showAll ? "Studio Workflows — all users" : "Studio Workflows"}
        </h2>
        <div className="relative w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Studio workflows..."
            aria-label="Search Studio workflows"
            className="pl-8 h-8 text-sm w-full"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No workflows match your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map((wf) => (
            <Link
              key={wf.id}
              to={`/projects/${wf.projectId}/workflows/${wf.id}`}
              className="group relative rounded-lg border bg-card hover:bg-accent/30 transition-colors overflow-hidden block"
            >
              <WorkflowThumbnail thumbnailUrl={wf.thumbnailUrl} />
              <div className="px-3 py-2">
                <p className="text-sm font-medium truncate">{wf.name}</p>
                <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                  {showAll && wf.ownerEmail && (
                    <>
                      <span className="truncate">{wf.ownerEmail}</span>
                      <span aria-hidden>·</span>
                    </>
                  )}
                  <span className="flex-shrink-0">
                    {new Date(wf.updatedAt).toLocaleDateString()}
                  </span>
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
