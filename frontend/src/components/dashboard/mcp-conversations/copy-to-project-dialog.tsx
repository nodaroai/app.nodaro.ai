import { useState } from "react"
import { FolderOpen, Loader2, Star } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useProjects } from "@/hooks/queries/use-projects-queries"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { useT } from "@/lib/i18n"
import { useProjectDisplayName } from "@/lib/project-display-name"

interface CopyToProjectDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly workflowId: string | null
  readonly workflowName: string | null
}

/**
 * Pick a project for a standalone copy of a flow. Unlike Move, the original
 * stays where it is — for a conversation, in its month's MCP hub.
 */
export function CopyToProjectDialog({ open, onOpenChange, workflowId, workflowName }: CopyToProjectDialogProps) {
  const t = useT()
  const projectDisplayName = useProjectDisplayName()
  const { data: projects = [], isLoading } = useProjects()
  const copyWorkflowToProject = useProjectsStore((s) => s.copyWorkflowToProject)
  const [copying, setCopying] = useState<string | null>(null)

  const handleCopy = async (projectId: string, name: string) => {
    if (!workflowId) return
    setCopying(projectId)
    try {
      const copy = await copyWorkflowToProject(workflowId, projectId)
      if (copy) {
        toast.success(t("mcpconv.copied", { project: name }))
        onOpenChange(false)
      } else {
        toast.error(t("mcpconv.copyFailed"))
      }
    } finally {
      setCopying(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t("mcpconv.copyTitle")}</DialogTitle>
          <DialogDescription>{t("mcpconv.copyDesc", { name: workflowName ?? "" })}</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("common.loading")} />
          </div>
        ) : projects.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">{t("mcpconv.noProjects")}</div>
        ) : (
          <div className="max-h-72 overflow-y-auto py-1">
            {projects.map((p) => {
              const name = projectDisplayName(p)
              return (
                <Button
                  key={p.id}
                  variant="ghost"
                  className="h-9 w-full justify-start gap-2 px-2 font-normal"
                  onClick={() => handleCopy(p.id, name)}
                  disabled={copying !== null}
                >
                  {p.isDefault ? (
                    <Star className="h-3.5 w-3.5 fill-[#ff0073] text-primary-ink" aria-hidden />
                  ) : (
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  )}
                  <span className="flex-1 truncate text-start">{name}</span>
                  {copying === p.id && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                </Button>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
