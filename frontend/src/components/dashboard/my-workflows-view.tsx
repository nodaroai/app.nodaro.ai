import { useState, useMemo } from "react"
import { Link } from "react-router-dom"
import { Plus, Loader2, Search, Star, MoreHorizontal, Trash2, FolderInput, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { WorkflowThumbnail } from "./workflow-thumbnail"
import { useT } from "@/lib/i18n"
import { useProjectDisplayName } from "@/lib/project-display-name"
import { useAuth } from "@/hooks/use-auth"
import { useMyWorkflows, type MyWorkflow } from "@/hooks/queries/use-my-workflows-queries"
import { useDemoSeed } from "@/hooks/use-demo-seed"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "sonner"
import { formatDate } from "@/lib/i18n/format"

interface MyWorkflowsViewProps {
  readonly onCreateWorkflow: () => void
  readonly onMoveWorkflow: (workflow: MyWorkflow) => void
  readonly isCreating?: boolean
  /**
   * `personal` (default) — the hand-made flows, i.e. everything outside the
   * auto-created "mcp" project. `mcp` — only that project's flows: the same
   * grid, search and card menu (duplicate / move / delete), under the "MCP
   * Workflows" filter, without a create action (an MCP client creates those).
   */
  readonly scope?: "personal" | "mcp"
  /**
   * Controlled search text — the home screen's Jump back in field. When set,
   * the view renders no heading row of its own: the filter above it already
   * names the list and owns the search.
   */
  readonly search?: string
}

export function MyWorkflowsView({
  onCreateWorkflow,
  onMoveWorkflow,
  isCreating,
  scope = "personal",
  search: controlledSearch,
}: MyWorkflowsViewProps) {
  const t = useT()
  const projectDisplayName = useProjectDisplayName()
  const { data: workflows = [], isLoading } = useMyWorkflows(scope)
  // Same cached query, unsliced — the demo seed must look at EVERYTHING the
  // user owns, or a user whose only flows came from an MCP client would get
  // the Welcome Demo re-seeded every time they opened the personal tab.
  const { data: allWorkflows = [] } = useMyWorkflows("all")
  const { user } = useAuth()
  // First-time users get the Welcome Demo seeded into their default project.
  // Gated on a resolved session: the hook fires exactly once per mount, so
  // firing during an auth-timing edge (query resolved [] with no user yet)
  // would burn that one attempt on a 401.
  const { isSeeding } = useDemoSeed(scope === "personal" && !isLoading && allWorkflows.length === 0 && !!user)
  const deleteWorkflow = useProjectsStore((s) => s.deleteWorkflow)
  const duplicateWorkflow = useProjectsStore((s) => s.duplicateWorkflow)
  const [ownSearch, setOwnSearch] = useState("")
  const search = controlledSearch ?? ownSearch

  const filtered = useMemo(() => {
    if (!search.trim()) return workflows
    const needle = search.toLowerCase()
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(needle) ||
        w.projectName.toLowerCase().includes(needle) ||
        projectDisplayName({ name: w.projectName, isDefault: w.projectIsDefault }).toLowerCase().includes(needle),
    )
  }, [workflows, search])

  const handleDelete = async (id: string) => {
    await deleteWorkflow(id)
    queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all })
  }

  // Same-project copy named "<name> (Copy)" (use-projects-store). The store
  // refreshes the project view; this flat list has its own query, so refetch it.
  const handleDuplicate = async (id: string) => {
    // The store swallows every failure into null — say so, or the menu item
    // looks like it did nothing.
    const copy = await duplicateWorkflow(id)
    if (!copy) {
      toast.error(t("dash.duplicateFailed"))
      return
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.workflows.all })
  }

  if (isLoading || isSeeding) {
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
          {scope === "mcp" ? t("dash.noMcpWorkflowsYet") : t("dash.noWorkflowsYet")}
        </p>
        {scope === "personal" && (
          <Button onClick={onCreateWorkflow} disabled={isCreating}>
            {isCreating ? (
              <Loader2 className="h-4 w-4 me-1 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 me-1" />
            )}
            {isCreating ? t("dash.creating") : t("dash.newWorkflow")}
          </Button>
        )}
      </div>
    )
  }

  return (
    <>
      {controlledSearch === undefined && (
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {scope === "mcp" ? t("dash.mcpWorkflows") : t("dash.myWorkflows")}
          </h2>
          <div className="relative w-48">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={ownSearch}
              onChange={(e) => setOwnSearch(e.target.value)}
              placeholder={t("dash.searchWorkflows")}
              aria-label={t("dash.searchWorkflows")}
              className="ps-8 h-8 text-sm w-full"
            />
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">{t("dash.noWorkflowsMatch")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5">
          {filtered.map((wf, i) => (
            <div
              key={wf.id}
              className="group relative rounded-xl border bg-card hover:bg-accent/30 transition-colors overflow-hidden"
            >
              <Link
                to={`/projects/${wf.projectId}/workflows/${wf.id}`}
                className="block"
              >
                {/* The first row is the LCP candidate — fetch it at high priority. */}
                <WorkflowThumbnail thumbnailUrl={wf.thumbnailUrl} nodeTypes={wf.nodeTypes} priority={i < 5} />
                <div className="px-3 py-2.5">
                  <p className="text-[13px] font-semibold truncate">{wf.name}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground truncate flex items-center gap-1">
                    {wf.projectIsDefault && (
                      <Star
                        className="h-2.5 w-2.5 text-[#ff0073] fill-[#ff0073] flex-shrink-0"
                        aria-label={t("dash.defaultWorkspace")}
                      />
                    )}
                    <span className="truncate">{projectDisplayName({ name: wf.projectName, isDefault: wf.projectIsDefault })}</span>
                    <span aria-hidden>·</span>
                    <span className="flex-shrink-0">{formatDate(wf.updatedAt)}</span>
                  </p>
                </div>
              </Link>
              <div className="absolute top-1.5 end-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 w-7 p-0 shadow-sm"
                      aria-label={t("dash.workflowOptions", { name: wf.name })}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleDuplicate(wf.id)}>
                      <Copy className="h-3.5 w-3.5 me-2" />
                      {t("dash.workflowDuplicate")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onMoveWorkflow(wf)}>
                      <FolderInput className="h-3.5 w-3.5 me-2" />
                      {t("dialog.moveToProject")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => handleDelete(wf.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 me-2" />
                      {t("common.delete")}
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
