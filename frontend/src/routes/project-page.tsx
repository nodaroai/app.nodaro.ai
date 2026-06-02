import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Settings, Loader2, MoreVertical, Pencil, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { useProjects, useProject } from "@/hooks/queries/use-projects-queries"
import { useAuth } from "@/hooks/use-auth"
import { Badge } from "@/components/ui/badge"
import { WorkflowsTab } from "@/components/dashboard/workflows-tab"
import { AssetsTab } from "@/components/dashboard/assets-tab"
import { JobsTab } from "@/components/dashboard/jobs-tab"
import { isStudioProject } from "@/lib/studio"

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const { isAdmin } = useAuth()
  const { data: projects = [], isLoading: projectsLoading } = useProjects()
  const ownProject = projects.find((p) => p.id === id)

  // Admin fallback: fetch the project directly if not found in own projects
  const { data: fetchedProject, isLoading: fetchedLoading } = useProject(
    isAdmin && !ownProject && !projectsLoading ? id : undefined,
  )

  const project = ownProject ?? fetchedProject ?? undefined
  const readOnly = !ownProject || isStudioProject(project)
  const loading = projectsLoading || (isAdmin && !ownProject && fetchedLoading)

  const fetchProjectData = useProjectsStore((s) => s.fetchProjectData)
  const updateProject = useProjectsStore((s) => s.updateProject)

  const [renameOpen, setRenameOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [renaming, setRenaming] = useState(false)

  useEffect(() => {
    fetchProjectData(id!)
  }, [id, fetchProjectData])

  const handleRename = async () => {
    if (!newName.trim() || newName === project?.name) {
      setRenameOpen(false)
      return
    }
    setRenaming(true)
    try {
      await updateProject(id!, { name: newName.trim() })
      setRenameOpen(false)
    } finally {
      setRenaming(false)
    }
  }

  const openRenameDialog = () => {
    setNewName(project?.name || "")
    setRenameOpen(true)
  }

  if (loading && !project) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>Project not found.</p>
        <Link to="/projects" className="text-primary underline text-sm mt-2 block">
          Back to projects
        </Link>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-6">
        <Link to="/projects">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {project.isDefault && (
              <span
                title="Auto-created — your default workspace"
                className="flex-shrink-0"
              >
                <Star
                  className="h-4 w-4 text-[#ff0073] fill-[#ff0073]"
                  aria-label="Default workspace"
                />
              </span>
            )}
            <h1 className="text-lg sm:text-xl font-bold truncate">{project.name}</h1>
            {readOnly && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-muted-foreground/40 text-muted-foreground flex-shrink-0">
                View only
              </Badge>
            )}
          </div>
          {project.description && (
            <p className="text-xs sm:text-sm text-muted-foreground truncate sm:whitespace-normal">{project.description}</p>
          )}
        </div>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openRenameDialog}>
                <Pencil className="h-3.5 w-3.5 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <Settings className="h-3.5 w-3.5 mr-2" />
                Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <Tabs defaultValue="workflows">
        <TabsList>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="assets">Assets</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>
        <TabsContent value="workflows" className="mt-4">
          <WorkflowsTab projectId={id!} readOnly={readOnly} />
        </TabsContent>
        <TabsContent value="assets" className="mt-4">
          <AssetsTab />
        </TabsContent>
        <TabsContent value="jobs" className="mt-4">
          <JobsTab />
        </TabsContent>
      </Tabs>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Rename Project</DialogTitle>
            <DialogDescription>
              Enter a new name for this project.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="project-name" className="sr-only">
              Project name
            </Label>
            <Input
              id="project-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Project name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !renaming) {
                  handleRename()
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={renaming}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={renaming || !newName.trim()}>
              {renaming ? "Renaming..." : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
