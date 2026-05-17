import { useState } from "react"
import { Link } from "react-router-dom"
import { MoreHorizontal, Trash2, Pencil, FolderOpen, Star } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { Project } from "@/hooks/queries/use-projects-queries"
import { Badge } from "@/components/ui/badge"

interface ProjectCardProps {
  readonly project: Project
  readonly onDelete: (id: string) => void
  readonly onRename: (id: string, newName: string) => Promise<void>
  readonly isOwn?: boolean
  readonly showOwner?: boolean
  readonly viewMode?: "grid" | "list"
}

export function ProjectCard({ project, onDelete, onRename, isOwn, showOwner, viewMode = "grid" }: ProjectCardProps) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [newName, setNewName] = useState(project.name)
  const [renaming, setRenaming] = useState(false)

  const handleRename = async () => {
    if (!newName.trim() || newName === project.name) {
      setRenameOpen(false)
      return
    }
    setRenaming(true)
    try {
      await onRename(project.id, newName.trim())
      setRenameOpen(false)
    } finally {
      setRenaming(false)
    }
  }

  const menuDropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={viewMode === "list"
            ? "h-7 w-7 p-0 hover:bg-muted"
            : "h-7 w-7 p-0 bg-background/80 hover:bg-background shadow-sm"}
          onClick={(e) => e.preventDefault()}
          aria-label={`Project options for ${project.name}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={(e) => {
            e.preventDefault()
            setNewName(project.name)
            setRenameOpen(true)
          }}
        >
          <Pencil className="h-3.5 w-3.5 mr-2" />
          Rename
        </DropdownMenuItem>
        {!project.isDefault && (
          <DropdownMenuItem
            className="text-destructive"
            onClick={(e) => {
              e.preventDefault()
              onDelete(project.id)
            }}
          >
            <Trash2 className="h-3.5 w-3.5 mr-2" />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <>
      {viewMode === "list" ? (
        <Link
          to={`/projects/${project.id}`}
          className="group flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-zinc-100/80 dark:hover:bg-zinc-800/50 transition-colors"
        >
          <div className="w-16 h-16 rounded-lg flex items-center justify-center flex-shrink-0 bg-zinc-100 dark:bg-zinc-800">
            <FolderOpen className="h-8 w-8 text-zinc-400 dark:text-zinc-500" />
          </div>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {project.isDefault && (
              <span
                title="Auto-created — your default workspace"
                className="flex-shrink-0"
              >
                <Star
                  className="h-3.5 w-3.5 text-[#ff0073] fill-[#ff0073]"
                  aria-label="Default workspace"
                />
              </span>
            )}
            <h2 className="font-medium text-sm truncate">{project.name}</h2>
          </div>
          {showOwner && isOwn && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-[#ff0073]/40 text-[#ff0073] flex-shrink-0">
              Mine
            </Badge>
          )}
          <p className="text-[11px] text-muted-foreground w-32 text-right hidden sm:block flex-shrink-0">
            {new Date(project.updatedAt).toLocaleDateString()}
          </p>
          <p className="text-[11px] text-muted-foreground w-32 text-right hidden md:block flex-shrink-0">
            {new Date(project.createdAt).toLocaleDateString()}
          </p>
          <div className="flex-shrink-0" onClick={(e) => e.preventDefault()}>
            {menuDropdown}
          </div>
        </Link>
      ) : (
        <Link
          to={`/projects/${project.id}`}
          className="group block"
        >
          {/* Thumbnail */}
          <div className="relative h-28 rounded-lg overflow-hidden bg-zinc-100 group-hover:bg-zinc-200 dark:bg-zinc-800 dark:group-hover:bg-zinc-700 flex items-center justify-center transition-all duration-200">
            <FolderOpen className="h-12 w-12 text-zinc-500 dark:text-zinc-600" />

            {/* Three-dot menu — top-right, visible on hover */}
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              {menuDropdown}
            </div>
          </div>

          {/* Metadata — below thumbnail, no bg/border */}
          <div className="pt-2 pb-1 px-0.5">
            <div className="flex items-center gap-1.5">
              {project.isDefault && (
                <span
                  title="Auto-created — your default workspace"
                  className="flex-shrink-0"
                >
                  <Star
                    className="h-3.5 w-3.5 text-[#ff0073] fill-[#ff0073]"
                    aria-label="Default workspace"
                  />
                </span>
              )}
              <h2 className="font-medium text-sm truncate">{project.name}</h2>
              {showOwner && isOwn && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-[#ff0073]/40 text-[#ff0073] flex-shrink-0">
                  Mine
                </Badge>
              )}
            </div>
            {showOwner && project.ownerEmail && (
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {project.ownerEmail}
              </p>
            )}
            {project.description && (
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                {project.description}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">
              {new Date(project.updatedAt).toLocaleDateString()}
            </p>
          </div>
        </Link>
      )}

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
    </>
  )
}
