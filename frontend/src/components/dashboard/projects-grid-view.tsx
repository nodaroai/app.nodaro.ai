import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { ChevronDown, ChevronUp, LayoutGrid, List, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { projectNameMap } from "@/lib/project-display-name"
import { isStudioProject } from "@/lib/studio"
import { ProjectCard } from "@/components/dashboard/project-card"
import { WorkflowThumbnail } from "@/components/dashboard/workflow-thumbnail"
import { UserFilter, type UserFilterUser, type UserFilterValue } from "@/components/user-filter"
import { useAllProjects, useProjects } from "@/hooks/queries/use-projects-queries"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { useWorkflowSearch } from "@/hooks/use-workflow-search"
import { formatDate } from "@/lib/i18n/format"

const ALL_USERS: UserFilterValue = { kind: "all" }

interface ProjectsGridViewProps {
  /** Admin "All users" switch is on — list every user's projects. */
  readonly showAll: boolean
  /** The Jump back in search text. Two or more characters also search workflows. */
  readonly search: string
  /**
   * Every user, for the admin owner filter; empty unless `showAll`. The page
   * fetches it — the admin hooks live in ee/, which this core file may not import.
   */
  readonly adminUsers: ReadonlyArray<UserFilterUser>
}

/**
 * The "My Projects" list of the home screen's Jump back in section: grid/list
 * toggle, admin owner filter, a sortable list view, and workflow matches for
 * the search above it.
 */
export function ProjectsGridView({ showAll, search, adminUsers }: ProjectsGridViewProps) {
  const t = useT()
  const { data: myProjects = [], isLoading: myLoading } = useProjects()
  const { data: allData, isLoading: allLoading } = useAllProjects(showAll)
  const projects = showAll ? (allData?.projects ?? []) : myProjects
  const currentUserId = allData?.currentUserId
  const loading = showAll ? allLoading : myLoading

  const deleteProject = useProjectsStore((s) => s.deleteProject)
  const updateProject = useProjectsStore((s) => s.updateProject)
  const handleRenameProject = async (id: string, newName: string) => {
    await updateProject(id, { name: newName })
  }

  // The owner filter only means something while every user's projects are
  // listed. Switching "All users" off RESETS it rather than masking it: the
  // owner it named may be gone from the list by the time the switch comes
  // back on, and a stale one would show "No results" for no visible reason.
  const [userFilter, setUserFilter] = useState<UserFilterValue>(ALL_USERS)
  useEffect(() => {
    if (!showAll) setUserFilter(ALL_USERS)
  }, [showAll])
  const userById = useMemo(() => new Map(adminUsers.map((u) => [u.id, u])), [adminUsers])

  const filteredProjects = useMemo(() => {
    const needle = search.toLowerCase()
    return projects.filter((p) => {
      const matchesUser = (() => {
        if (userFilter.kind === "all") return true
        if (userFilter.kind === "exclude_admins") {
          const role = userById.get(p.userId ?? "")?.role
          return role !== "admin" && role !== "super_admin"
        }
        return p.userId === userFilter.id
      })()
      if (!matchesUser) return false
      if (!search) return true
      return p.name.toLowerCase().includes(needle) || (showAll && p.ownerEmail?.toLowerCase().includes(needle))
    })
  }, [projects, search, showAll, userFilter, userById])

  const userOptions = useMemo(() => {
    if (!showAll) return []
    const ownerIds = new Set(projects.map((p) => p.userId).filter(Boolean) as string[])
    return adminUsers.filter((u) => ownerIds.has(u.id))
  }, [projects, showAll, adminUsers])

  const locale = useLocaleStore((s) => s.locale)
  const projectMap = useMemo(() => projectNameMap(projects, locale), [projects, locale])
  const { results: workflowResults, loading: workflowSearchLoading } = useWorkflowSearch(search, projectMap)
  const isSearching = search.length >= 2

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [sortBy, setSortBy] = useState<"updated" | "created" | "name">("updated")
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")

  const handleSort = (col: "updated" | "created" | "name") => {
    if (sortBy === col) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    } else {
      setSortBy(col)
      setSortDir("desc")
    }
  }

  const sortedProjects = useMemo(() => {
    return [...filteredProjects].sort((a, b) => {
      let result = 0
      if (sortBy === "name") result = a.name.localeCompare(b.name)
      else if (sortBy === "created") result = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      else result = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      return sortDir === "asc" ? -result : result
    })
  }, [filteredProjects, sortBy, sortDir])

  return (
    <>
      <div className="flex items-center justify-end gap-2 mb-3">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={cn("p-1 rounded transition-colors", viewMode === "grid" ? "text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground")}
            aria-label={t("dash.gridView")}
          >
            <LayoutGrid className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={cn("p-1 rounded transition-colors", viewMode === "list" ? "text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground")}
            aria-label={t("dash.listView")}
          >
            <List className="h-5 w-5" />
          </button>
        </div>
        {showAll && userOptions.length > 0 && (
          <UserFilter
            users={userOptions}
            value={userFilter}
            onChange={setUserFilter}
          />
        )}
      </div>

      {isSearching && workflowResults.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">{t("dash.workflows")}</h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5">
            {workflowResults.map((wf) => (
              <Link
                key={wf.id}
                to={`/projects/${wf.projectId}/workflows/${wf.id}`}
                className="group rounded-xl border bg-card hover:bg-accent/30 transition-colors overflow-hidden"
              >
                <WorkflowThumbnail thumbnailUrl={wf.thumbnailUrl} nodeTypes={wf.nodeTypes} />
                <div className="px-3 py-2.5">
                  <p className="text-[13px] font-semibold truncate">{wf.name}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground truncate">
                    {wf.projectName} &middot; {formatDate(wf.updatedAt)}
                  </p>
                </div>
              </Link>
            ))}
          </div>
          {workflowSearchLoading && (
            <div className="flex justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sortedProjects.length === 0 && (!isSearching || workflowResults.length === 0) ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">
            {projects.length === 0
              ? t("dash.noProjectsYet")
              : t("dash.noResults")}
          </p>
        </div>
      ) : (
        <>
          {viewMode === "list" && (
            <div className="flex items-center gap-3 px-3 mb-1 pb-1 border-b border-border">
              <div className="w-5 flex-shrink-0" />
              <span className="text-[11px] text-muted-foreground flex-1">{t("dash.name")}</span>
              <button
                type="button"
                onClick={() => handleSort("updated")}
                className={cn(
                  "w-32 text-end text-[11px] hidden sm:flex items-center justify-end gap-0.5 transition-colors",
                  sortBy === "updated" ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t("dash.lastModified")}
                {sortBy === "updated" && (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
              </button>
              <button
                type="button"
                onClick={() => handleSort("created")}
                className={cn(
                  "w-32 text-end text-[11px] hidden md:flex items-center justify-end gap-0.5 transition-colors",
                  sortBy === "created" ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t("dash.created")}
                {sortBy === "created" && (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
              </button>
              <div className="w-7 flex-shrink-0" />
            </div>
          )}
          <div className={viewMode === "grid" ? "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" : "flex flex-col gap-1"}>
            {sortedProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onDelete={deleteProject}
                onRename={handleRenameProject}
                showOwner={showAll}
                isOwn={showAll && project.userId === currentUserId}
                viewMode={viewMode}
                readOnly={isStudioProject(project)}
              />
            ))}
          </div>
        </>
      )}
    </>
  )
}
