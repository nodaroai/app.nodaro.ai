import { useState, useMemo } from "react"
import { Link } from "react-router-dom"
import { Plus, Loader2, Search, Star, MoreHorizontal, Trash2, FolderInput } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { WorkflowThumbnail } from "./workflow-thumbnail"
import { useMyWorkflows, type MyWorkflow } from "@/hooks/queries/use-my-workflows-queries"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

interface MyWorkflowsViewProps {
  readonly onCreateWorkflow: () => void
  readonly onMoveWorkflow: (workflow: MyWorkflow) => void
  readonly isCreating?: boolean
}

export function MyWorkflowsView({ onCreateWorkflow, onMoveWorkflow, isCreating }: MyWorkflowsViewProps) {
  const { data: workflows = [], isLoading } = useMyWorkflows()
  const deleteWorkflow = useProjectsStore((s) => s.deleteWorkflow)
  const [search, setSearch] = useState("")

  const filtered = useMemo(() => {
    if (!search.trim()) return workflows
    const needle = search.toLowerCase()
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(needle) ||
        w.projectName.toLowerCase().includes(needle),
    )
  }, [workflows, search])

  const handleDelete = async (id: string) => {
    await deleteWorkflow(id)
    queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all })
  }

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
        <p className="text-sm text-muted-foreground mb-4">
          No workflows yet. Create your first one to get started.
        </p>
        <Button onClick={onCreateWorkflow} disabled={isCreating}>
          {isCreating ? (
            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
          ) : (
            <Plus className="h-4 w-4 mr-1" />
          )}
          {isCreating ? "Creating…" : "New Workflow"}
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">My Workflows</h2>
        <div className="relative w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workflows..."
            aria-label="Search workflows"
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
            <div
              key={wf.id}
              className="group relative rounded-lg border bg-card hover:bg-accent/30 transition-colors overflow-hidden"
            >
              <Link
                to={`/projects/${wf.projectId}/workflows/${wf.id}`}
                className="block"
              >
                <WorkflowThumbnail thumbnailUrl={wf.thumbnailUrl} />
                <div className="px-3 py-2">
                  <p className="text-sm font-medium truncate">{wf.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                    {wf.projectIsDefault && (
                      <Star
                        className="h-2.5 w-2.5 text-[#ff0073] fill-[#ff0073] flex-shrink-0"
                        aria-label="Default workspace"
                      />
                    )}
                    <span className="truncate">{wf.projectName}</span>
                    <span aria-hidden>·</span>
                    <span className="flex-shrink-0">{new Date(wf.updatedAt).toLocaleDateString()}</span>
                  </p>
                </div>
              </Link>
              <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 w-7 p-0 shadow-sm"
                      aria-label={`Workflow options for ${wf.name}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onMoveWorkflow(wf)}>
                      <FolderInput className="h-3.5 w-3.5 mr-2" />
                      Move to project
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => handleDelete(wf.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
