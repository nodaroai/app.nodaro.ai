import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { useNavigate, Link } from "react-router-dom"
import { Plus, Search, Loader2, BarChart3, BookOpen, LayoutTemplate, ArrowRight, Sparkles, ChevronLeft, ChevronRight, LayoutGrid, List, ChevronDown, ChevronUp } from "lucide-react"
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
import { browseApps, browseTemplates, type TemplateBrowseCard, type AppBrowseCard } from "@/lib/api"
import { useTemplateFavorites, useToggleTemplateFavoriteMutation } from "@/hooks/queries/use-template-marketplace-queries"
import { TemplatePreviewModal } from "@/components/templates/template-preview-modal"
import { TutorialsTab } from "@/components/dashboard/tutorials-tab"
import { useAppSettings } from "@/hooks/queries/use-app-settings-queries"

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

function TemplatesCarousel() {
  const navigate = useNavigate()
  const [previewTemplate, setPreviewTemplate] = useState<TemplateBrowseCard | null>(null)
  const { data: myProjects = [] } = useProjects()
  const { data: browseData, isLoading } = useQuery({
    queryKey: ["template-carousel"],
    queryFn: () => browseTemplates({ sort: "popular", limit: 6 }),
    staleTime: 60_000,
  })
  const { data: favoriteIds = [] } = useTemplateFavorites()
  const favSet = useMemo(() => new Set(favoriteIds), [favoriteIds])
  const favMutation = useToggleTemplateFavoriteMutation()

  const templates = browseData?.data ?? []

  if (isLoading) {
    return (
      <div className="px-3 pb-3">
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="aspect-video rounded-lg bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <div className="text-center py-10 text-muted-foreground">
        <LayoutTemplate className="h-8 w-8 mx-auto mb-2 opacity-30" />
        <p className="text-xs font-medium">No templates available yet</p>
      </div>
    )
  }

  return (
    <div className="px-3 pb-3">
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            className="relative flex-shrink-0 w-48 rounded-lg overflow-hidden border border-border hover:border-zinc-400 transition-colors group cursor-pointer text-left"
            onClick={() => setPreviewTemplate(t)}
          >
            <div className="aspect-video bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-800 dark:to-zinc-900 overflow-hidden">
              {t.previewMediaUrl ? (
                <img src={t.previewMediaUrl} alt={t.name} className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <LayoutTemplate className="h-6 w-6 text-zinc-300 dark:text-zinc-600" />
                </div>
              )}
            </div>
            <div className="p-2">
              <p className="text-xs font-medium text-foreground truncate">{t.name}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{t.nodeCount} nodes · {t.estimatedCredits} CR</p>
            </div>
          </button>
        ))}
        {/* "See all" link card */}
        <button
          type="button"
          className="flex-shrink-0 w-48 rounded-lg border border-dashed border-border hover:border-zinc-400 transition-colors flex items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={() => navigate("/templates")}
        >
          <span className="text-xs font-medium">See all templates →</span>
        </button>
      </div>

      {previewTemplate && (
        <TemplatePreviewModal
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          isFavorited={favSet.has(previewTemplate.id)}
          onToggleFavorite={(id) => favMutation.mutate({ templateId: id })}
          projects={myProjects.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name }))}
        />
      )}
    </div>
  )
}

export default function ProjectsPage() {
  const { isAdmin, user } = useAuth()

  const greeting = (() => {
    const hour = new Date().getHours()
    if (hour < 12) return "Good morning"
    if (hour < 18) return "Good afternoon"
    return "Good evening"
  })()

  const displayName = user?.user_metadata?.full_name?.split(" ")[0]
    ?? user?.email?.split("@")[0]
    ?? ""
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

  type Tab = "apps" | "templates" | "tutorials" | "statistics"
  const [activeTab, setActiveTab] = useState<Tab>("apps")

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "apps", label: "Apps", icon: <LayoutTemplate className="h-3.5 w-3.5" /> },
    { id: "templates", label: "Templates", icon: <BookOpen className="h-3.5 w-3.5" /> },
    { id: "tutorials", label: "Tutorials", icon: <BookOpen className="h-3.5 w-3.5" /> },
    { id: "statistics", label: "Statistics", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  ]

  const CARD_SCROLL_PX = 210

  const { data: appSettings } = useAppSettings()
  const videoAutoplay = appSettings?.carousel_video_autoplay ?? true
  const featuredAppIds = appSettings?.featured_app_ids ?? []
  const appsLimit = appSettings?.featured_apps_limit ?? 20
  const autoScrollMs = (appSettings?.apps_auto_scroll_seconds ?? 4) * 1000

  // Featured apps for the Apps tab — fetch max to allow admin limit to work without refetch
  const { data: featuredAppsData, isLoading: featuredAppsLoading } = useQuery({
    queryKey: ["featured-apps"],
    queryFn: () => browseApps({ sort: "popular", limit: 50, publishType: "app" }),
    staleTime: 60_000,
    enabled: activeTab === "apps",
  })
  const shuffledAppsRef = useRef<{ key: unknown; cacheKey: string; apps: AppBrowseCard[] }>({ key: null, cacheKey: "", apps: [] })
  const cacheKey = `${featuredAppIds.join(",")}_${appsLimit}`
  if (featuredAppsData && (featuredAppsData !== shuffledAppsRef.current.key || cacheKey !== shuffledAppsRef.current.cacheKey)) {
    let apps = [...featuredAppsData.data]
    if (featuredAppIds.length > 0) {
      const curated = featuredAppIds.map((id) => apps.find((a) => a.id === id)).filter(Boolean) as AppBrowseCard[]
      const curatedIds = new Set(featuredAppIds)
      const rest = apps.filter((a) => !curatedIds.has(a.id))
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[rest[i], rest[j]] = [rest[j], rest[i]]
      }
      apps = [...curated, ...rest]
    } else {
      for (let i = apps.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[apps[i], apps[j]] = [apps[j], apps[i]]
      }
    }
    shuffledAppsRef.current = { key: featuredAppsData, cacheKey, apps: apps.slice(0, appsLimit) }
  }
  const featuredApps = shuffledAppsRef.current.apps

  const appsScrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const isHoveringApps = useRef(false)

  const updateScrollState = useCallback(() => {
    const el = appsScrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    if (featuredApps.length === 0) return
    const frame = requestAnimationFrame(updateScrollState)
    const el = appsScrollRef.current
    if (!el) return () => cancelAnimationFrame(frame)
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(el)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [featuredApps.length, updateScrollState])

  useEffect(() => {
    if (featuredApps.length <= 1 || activeTab !== "apps" || autoScrollMs === 0) return
    const timer = setInterval(() => {
      const el = appsScrollRef.current
      if (!el || isHoveringApps.current) return
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
      if (atEnd) {
        el.scrollTo({ left: 0, behavior: "smooth" })
      } else {
        el.scrollBy({ left: CARD_SCROLL_PX, behavior: "smooth" })
      }
    }, autoScrollMs)
    return () => clearInterval(timer)
  }, [featuredApps.length, activeTab, autoScrollMs])

  const scrollAppsLeft = useCallback(() => {
    appsScrollRef.current?.scrollBy({ left: -CARD_SCROLL_PX, behavior: "smooth" })
  }, [])
  const scrollAppsRight = useCallback(() => {
    appsScrollRef.current?.scrollBy({ left: CARD_SCROLL_PX, behavior: "smooth" })
  }, [])

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          {greeting}{displayName ? `, ${displayName}` : ""}
        </h1>
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

      {/* Unified container with pill tabs inside */}
      <div className="mb-6 rounded-xl bg-muted/50 overflow-hidden group/apps">
        {/* Header: tabs + see all link */}
        <div className="flex items-center justify-between p-2">
          <div className="flex items-center gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-md transition-colors",
                  activeTab === tab.id
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
          {activeTab === "apps" && (
            <button
              type="button"
              onClick={() => navigate("/apps")}
              className="flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              See all apps <ArrowRight className="h-3 w-3" />
            </button>
          )}
          {activeTab === "templates" && (
            <button
              type="button"
              onClick={() => navigate("/templates")}
              className="flex items-center gap-1 px-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              See all templates <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Tab content */}
        {activeTab === "apps" && (
          <div className="relative">
            {featuredAppsLoading ? (
              <div className="flex gap-2 px-2 pb-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="shrink-0 w-[200px] animate-pulse">
                    <div className="aspect-square bg-muted rounded-lg" />
                  </div>
                ))}
              </div>
            ) : featuredApps.length > 0 ? (
              <>
                <div
                  ref={appsScrollRef}
                  onScroll={updateScrollState}
                  onMouseEnter={() => { isHoveringApps.current = true }}
                  onMouseLeave={() => { isHoveringApps.current = false }}
                  className="flex gap-2 px-2 pb-2 overflow-x-auto"
                  style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
                >
                  {featuredApps.map((app) => (
                    <button
                      key={app.id}
                      type="button"
                      onClick={() => navigate(`/app/${app.slug}`)}
                      className="shrink-0 w-[200px] text-left group/thumb"
                    >
                      <div className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                        {app.previewMediaUrl ? (
                          app.previewMediaType === "video" ? (
                            <video
                              src={app.previewMediaUrl}
                              className="w-full h-full object-cover"
                              autoPlay={videoAutoplay}
                              muted
                              loop
                              playsInline
                              onMouseEnter={(e) => e.currentTarget.play()}
                              onMouseLeave={(e) => { if (!videoAutoplay) { e.currentTarget.pause(); e.currentTarget.currentTime = 0 } }}
                            />
                          ) : (
                            <img src={app.previewMediaUrl} alt={app.name} className="w-full h-full object-cover" loading="lazy" />
                          )
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Sparkles className="h-5 w-5 text-muted-foreground" />
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
                    className="shrink-0 w-[200px] text-left"
                  >
                    <div className="aspect-square rounded-lg overflow-hidden bg-muted/50 flex flex-col items-center justify-center gap-2 hover:bg-muted transition-colors">
                      <ArrowRight className="h-5 w-5 text-muted-foreground" />
                      <p className="text-xs font-medium text-muted-foreground">See all apps</p>
                    </div>
                  </button>
                </div>

                {/* Scroll arrows */}
                {canScrollLeft && (
                  <button
                    type="button"
                    onClick={scrollAppsLeft}
                    className="absolute left-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-background/90 text-foreground shadow-md hover:bg-background transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                )}
                {canScrollRight && (
                  <button
                    type="button"
                    onClick={scrollAppsRight}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-background/90 text-foreground shadow-md hover:bg-background transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                )}
              </>
            ) : (
              <div className="text-center py-10 text-muted-foreground">
                <LayoutTemplate className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs font-medium">No apps available yet</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "statistics" && (
          <div className="px-3 pb-3">
            <StatsOverview />
          </div>
        )}

        {activeTab === "templates" && (
          <TemplatesCarousel />
        )}

        {activeTab === "tutorials" && (
          <TutorialsTab />
        )}
      </div>

      {/* My Projects heading + view toggle + search */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-muted-foreground">My Projects</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={cn("p-1 rounded transition-colors", viewMode === "grid" ? "text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground")}
              aria-label="Grid view"
            >
              <LayoutGrid className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={cn("p-1 rounded transition-colors", viewMode === "list" ? "text-foreground" : "text-muted-foreground/50 hover:text-muted-foreground")}
              aria-label="List view"
            >
              <List className="h-5 w-5" />
            </button>
          </div>
          <div className="relative w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={showAll ? "Search projects, users..." : "Search projects..."}
              aria-label="Search projects and workflows"
              className="pl-8 h-8 text-sm w-full"
            />
          </div>
        </div>
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

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sortedProjects.length === 0 && (!isSearching || workflowResults.length === 0) ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">
            {projects.length === 0
              ? "No projects yet. Create one to get started."
              : "No results match your search."}
          </p>
        </div>
      ) : (
        <>
          {viewMode === "list" && (
            <div className="flex items-center gap-3 px-3 mb-1 pb-1 border-b border-border">
              <div className="w-5 flex-shrink-0" />
              <span className="text-[11px] text-muted-foreground flex-1">Name</span>
              <button
                type="button"
                onClick={() => handleSort("updated")}
                className={cn(
                  "w-32 text-right text-[11px] hidden sm:flex items-center justify-end gap-0.5 transition-colors",
                  sortBy === "updated" ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Last modified
                {sortBy === "updated" && (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
              </button>
              <button
                type="button"
                onClick={() => handleSort("created")}
                className={cn(
                  "w-32 text-right text-[11px] hidden md:flex items-center justify-end gap-0.5 transition-colors",
                  sortBy === "created" ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                Created
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
              />
            ))}
          </div>
        </>
      )}

    </div>
  )
}
