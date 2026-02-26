import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { Plus, Search, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { useProjects, useAllProjects } from "@/hooks/queries/use-projects-queries"
import { ProjectCard } from "@/components/dashboard/project-card"
import { StatsOverview } from "@/components/dashboard/stats-overview"
import { useAuth } from "@/hooks/use-auth"

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

  const filtered = search
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (showAll && p.ownerEmail?.toLowerCase().includes(search.toLowerCase())),
      )
    : projects

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
          placeholder={showAll ? "Search projects or users..." : "Search projects..."}
          aria-label="Search projects"
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">
            {projects.length === 0
              ? "No projects yet. Create one to get started."
              : "No projects match your search."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((project) => (
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
