import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useNavigate, Link } from "react-router-dom"
import { Plus, Search, Loader2, BarChart3, BookOpen, LayoutTemplate, ArrowRight, Sparkles, ChevronRight } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
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
import { browseApps } from "@/lib/api"

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

  type Tab = "apps" | "templates" | "tutorials" | "statistics"
  const [activeTab, setActiveTab] = useState<Tab>("apps")

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "apps", label: "Apps", icon: <LayoutTemplate className="h-3.5 w-3.5" /> },
    { id: "templates", label: "Templates", icon: <BookOpen className="h-3.5 w-3.5" /> },
    { id: "tutorials", label: "Tutorials", icon: <BookOpen className="h-3.5 w-3.5" /> },
    { id: "statistics", label: "Statistics", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  ]

  // Featured apps for the Apps tab
  const { data: featuredAppsData, isLoading: featuredAppsLoading } = useQuery({
    queryKey: ["featured-apps"],
    queryFn: () => browseApps({ sort: "popular", limit: 6 }),
    staleTime: 60_000,
    enabled: activeTab === "apps",
  })
  const featuredApps = featuredAppsData?.data ?? []

  const appsScrollRef = useRef<HTMLDivElement>(null)
  const scrollAppsRight = useCallback(() => {
    appsScrollRef.current?.scrollBy({ left: 240, behavior: "smooth" })
  }, [])

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

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.id
                ? "border-[#ff0073] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "apps" && (
        <div className="mb-6 rounded-xl border border-white/10 bg-zinc-950 overflow-hidden group/apps">
          {/* Scroll area — no header, thumbnails flush to top */}
          <div className="relative">
            {featuredAppsLoading ? (
              <div className="flex gap-3 px-3 py-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="shrink-0 w-[220px] animate-pulse">
                    <div className="aspect-square bg-zinc-800 rounded-lg" />
                  </div>
                ))}
              </div>
            ) : featuredApps.length > 0 ? (
              <>
                <div
                  ref={appsScrollRef}
                  className="flex gap-3 px-3 py-3 overflow-x-auto"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {featuredApps.map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => navigate(`/app/${app.slug}`)}
                      className="shrink-0 w-[220px] text-left group/thumb"
                    >
                      <div className="relative aspect-square rounded-lg overflow-hidden bg-zinc-800">
                        {app.previewMediaUrl ? (
                          app.previewMediaType === "video" ? (
                            <video src={app.previewMediaUrl} className="w-full h-full object-cover" muted playsInline />
                          ) : (
                            <img src={app.previewMediaUrl} alt={app.name} className="w-full h-full object-cover" loading="lazy" />
                          )
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Sparkles className="h-5 w-5 text-zinc-600" />
                          </div>
                        )}
                        {/* Name overlay */}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-6">
                          <p className="text-xs font-medium text-white truncate">{app.name}</p>
                        </div>
                      </div>
                    </button>
                  ))}

                  {/* See all card */}
                  <button
                    type="button"
                    onClick={() => navigate("/apps")}
                    className="shrink-0 w-[220px] text-left"
                  >
                    <div className="aspect-square rounded-lg overflow-hidden bg-zinc-800/50 flex flex-col items-center justify-center gap-2 hover:bg-zinc-800 transition-colors">
                      <ArrowRight className="h-5 w-5 text-zinc-400" />
                      <p className="text-xs font-medium text-zinc-400">See all apps</p>
                    </div>
                  </button>
                </div>

                {/* Scroll arrow */}
                <button
                  type="button"
                  onClick={scrollAppsRight}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-lg bg-black/60 text-white opacity-0 group-hover/apps:opacity-100 transition-opacity hover:bg-black/80"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            ) : (
              <div className="text-center py-10 text-zinc-500">
                <LayoutTemplate className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs font-medium">No apps available yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "statistics" && (
        <StatsOverview className="mb-6" />
      )}

      {activeTab === "templates" && (
        <div className="text-center py-16 text-muted-foreground">
          <LayoutTemplate className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Templates coming soon</p>
          <p className="text-xs mt-1">Preset workflow templates to get you started faster.</p>
        </div>
      )}

      {activeTab === "tutorials" && (
        <div className="text-center py-16 text-muted-foreground">
          <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Tutorials coming soon</p>
          <p className="text-xs mt-1">Step-by-step guides for building workflows.</p>
        </div>
      )}

      {/* Search + Projects (always visible) */}
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

      <h2 className="text-sm font-medium text-muted-foreground mb-3">My Projects</h2>

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
