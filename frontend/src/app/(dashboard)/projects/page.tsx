import { useState, useMemo, useEffect, useRef } from "react"
import { useNavigate, Link } from "react-router-dom"
import { Plus, Search, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useProjectsStore, type WorkflowMeta } from "@/hooks/use-projects-store"
import { useProjects, useAllProjects } from "@/hooks/queries/use-projects-queries"
import { ProjectCard } from "@/components/dashboard/project-card"
import { StatsOverview } from "@/components/dashboard/stats-overview"
import { WorkflowThumbnail } from "@/components/dashboard/workflow-thumbnail"
import { useAuth } from "@/hooks/use-auth"
import { createClient } from "@/lib/supabase"

interface WorkflowSearchResult extends WorkflowMeta {
  readonly projectName: string
}

function useWorkflowSearch(search: string, projectMap: Map<string, string>) {
  const [results, setResults] = useState<WorkflowSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const projectMapRef = useRef(projectMap)
  projectMapRef.current = projectMap

  useEffect(() => {
    if (search.length < 2) {
      setResults([])
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const supabase = createClient()
        const { data, error } = await supabase
          .from("workflows")
          .select("id, project_id, folder_id, name, thumbnail_url, created_at, updated_at")
          .ilike("name", `%${search}%`)
          .order("updated_at", { ascending: false })
          .limit(20)

        if (error || cancelled) return

        const map = projectMapRef.current
        setResults(
          data.map((row) => ({
            id: row.id,
            projectId: row.project_id,
            folderId: row.folder_id ?? null,
            name: row.name,
            thumbnailUrl: row.thumbnail_url ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            projectName: map.get(row.project_id) ?? "Unknown Project",
          })),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search])

  return { results, loading }
}

export default function ProjectsPage() {
  const { isAdmin } = useAuth()
  const [viewAll, setViewAll] = useState(() => {
    if (!isAdmin) return false
    return localStorage.getItem("nodaro-admin-view-all-projects") === "true"
  })

  const handleViewAllChange = (checked: boolean) => {
    setViewAll(checked)
    localStorage.setItem("nodaro-admin-view-all-projects", String(checked))
  }

  const { data: myProjects = [], isLoading: myLoading } = useProjects()
  const { data: allData, isLoading: allLoading } = useAllProjects(isAdmin && viewAll)

  const showAll = isAdmin && viewAll
  const projects = showAll ? (allData?.projects ?? []) : myProjects
  const currentUserId = allData?.currentUserId
  const loading = showAll ? allLoading : myLoading

  const createProject = useProjectsStore((s) => s.createProject)
  const deleteProject = useProjectsStore((s) => s.deleteProject)
  const updateProject = useProjectsStore((s) => s.updateProject)

  const navigate = useNavigate()

  const handleRenameProject = async (id: string, newName: string) => {
    await updateProject(id, { name: newName })
  }

  const handleCreateProject = async () => {
    const project = await createProject("Untitled Project")
    if (project) {
      navigate(`/projects/${project.id}`)
    }
  }

  const [search, setSearch] = useState("")

  const filteredProjects = useMemo(() => {
    if (!search) return projects
    return projects.filter((p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (showAll && p.ownerEmail?.toLowerCase().includes(search.toLowerCase())),
    )
  }, [projects, search, showAll])

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects])
  const { results: workflowResults, loading: workflowSearchLoading } = useWorkflowSearch(search, projectMap)

  const isSearching = search.length >= 2

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-bold">Projects</h1>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Switch
                id="view-all-projects"
                checked={viewAll}
                onCheckedChange={handleViewAllChange}
              />
              <Label htmlFor="view-all-projects" className="text-sm text-muted-foreground cursor-pointer whitespace-nowrap">
                All users
              </Label>
            </div>
          )}
          <Button size="sm" className="sm:size-default" onClick={handleCreateProject}>
            <Plus className="h-4 w-4 mr-1" />
            <span className="hidden sm:inline">New Project</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      </div>

      <StatsOverview className="mb-6" />

      <div className="relative mb-4 sm:mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={showAll ? "Search projects, workflows, or users..." : "Search projects and workflows..."}
          aria-label="Search projects and workflows"
          className="pl-9"
        />
      </div>

      {isSearching && workflowResults.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Workflows</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {workflowResults.map((wf) => (
              <Link
                key={wf.id}
                to={`/projects/${wf.projectId}/workflows/${wf.id}`}
                className="group rounded-lg border bg-card hover:bg-accent/30 transition-colors overflow-hidden"
              >
                <WorkflowThumbnail thumbnailUrl={wf.thumbnailUrl} />
                <div className="px-3 py-2">
                  <p className="text-sm font-medium truncate">{wf.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {wf.projectName} &middot; {new Date(wf.updatedAt).toLocaleDateString()}
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

      {isSearching && filteredProjects.length > 0 && (
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Projects</h2>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredProjects.length === 0 && (!isSearching || workflowResults.length === 0) ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">
            {projects.length === 0
              ? "No projects yet. Create one to get started."
              : "No results match your search."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onDelete={deleteProject}
              onRename={handleRenameProject}
              showOwner={showAll}
              isOwn={showAll && project.userId === currentUserId}
            />
          ))}
        </div>
      )}

    </div>
  )
}
