import { useState } from "react"
import { Link } from "react-router-dom"
import { MoreHorizontal, Trash2, Pencil } from "lucide-react"
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
}

export function ProjectCard({ project, onDelete, onRename, isOwn, showOwner }: ProjectCardProps) {
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

  return (
    <>
      <Link
        to={`/projects/${project.id}`}
        className="group block rounded-lg border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
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
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100"
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
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="text-[10px] text-muted-foreground mt-3">
          {new Date(project.updatedAt).toLocaleDateString()}
        </p>
      </Link>

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
