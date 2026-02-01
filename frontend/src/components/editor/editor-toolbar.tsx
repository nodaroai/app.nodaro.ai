"use client"

import { useState } from "react"
import { ArrowLeft, ChevronRight, Save, Play, AlertTriangle, CheckCircle, Loader2, RefreshCw, Video, VideoOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ThemeToggle } from "@/components/theme-toggle"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useProjectsStore } from "@/hooks/use-projects-store"
import { validateWorkflow, type ValidationResult } from "@/lib/workflow-validation"

interface EditorToolbarProps {
  readonly projectId?: string
  readonly workflowId?: string
  readonly onSave: () => void
  readonly onRun: () => void
  readonly saving: boolean
  readonly onNavigate?: (href: string) => void
}

export function EditorToolbar({ projectId, onSave, onRun, saving, onNavigate }: EditorToolbarProps) {
  const workflowName = useWorkflowStore((s) => s.workflowName)
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const isDirty = useWorkflowStore((s) => s.isDirty)
  const saveStatus = useWorkflowStore((s) => s.saveStatus)
  const saveError = useWorkflowStore((s) => s.saveError)
  const project = useProjectsStore((s) =>
    projectId ? s.projects.find((p) => p.id === projectId) : undefined,
  )
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const setVideoAutoplay = useWorkflowStore((s) => s.setVideoAutoplay)
  const [validation, setValidation] = useState<ValidationResult | null>(null)

  function handleValidate() {
    const result = validateWorkflow(nodes, edges)
    setValidation(result)
  }

  function handleRun() {
    const result = validateWorkflow(nodes, edges)
    setValidation(result)
    if (result.valid) {
      onRun()
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 px-2 sm:px-4 py-2 border-b bg-card">
      <div className="flex items-center gap-1 sm:gap-2 min-w-0">
        {projectId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 shrink-0"
            onClick={() => onNavigate ? onNavigate(`/projects/${projectId}`) : undefined}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}

        {/* Breadcrumbs - hidden on small screens */}
        <nav className="hidden sm:flex items-center gap-1 text-sm shrink-0">
          <button
            type="button"
            onClick={() => onNavigate?.("/projects")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Dashboard
          </button>
          {project && (
            <>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <button
                type="button"
                onClick={() => onNavigate?.(`/projects/${projectId}`)}
                className="text-muted-foreground hover:text-foreground transition-colors max-w-[120px] truncate"
              >
                {project.name}
              </button>
            </>
          )}
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </nav>

        <div className="flex items-center gap-0.5 min-w-0">
          <Input
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="w-28 sm:w-48 h-8 text-sm"
          />
          {isDirty && (
            <span className="text-destructive text-lg leading-none shrink-0" title="Unsaved changes">*</span>
          )}
        </div>

        {/* Save status indicator */}
        <div className="hidden sm:flex items-center gap-1 text-xs shrink-0">
          {saveStatus === "saving" && (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="text-muted-foreground">Saving...</span>
            </>
          )}
          {saveStatus === "saved" && (
            <>
              <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              <span className="text-green-600 dark:text-green-400">Saved</span>
            </>
          )}
          {saveStatus === "error" && (
            <>
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              <span className="text-destructive" title={saveError ?? undefined}>Save failed</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={onSave}
                title="Retry save"
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            </>
          )}
          {saveStatus === "idle" && isDirty && (
            <Badge variant="outline" className="text-xs">
              Unsaved
            </Badge>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {validation && (
          <div className="hidden sm:flex items-center gap-1 text-xs mr-2">
            {validation.valid ? (
              <CheckCircle className="h-4 w-4 text-green-500" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            )}
            <span>
              {validation.errors.length} errors, {validation.warnings.length} warnings
            </span>
            <Badge variant="secondary" className="text-xs">
              ~{validation.estimatedCredits} credits
            </Badge>
          </div>
        )}

        <Button variant="outline" size="sm" onClick={handleValidate} className="hidden sm:flex">
          Validate
        </Button>

        <Button
          variant={isDirty ? "default" : "outline"}
          size="sm"
          onClick={onSave}
          disabled={saving || !isDirty}
        >
          <Save className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{saving ? "Saving..." : "Save"}</span>
          {isDirty && !saving && (
            <span className="ml-0.5 h-2 w-2 rounded-full bg-red-500 shrink-0" />
          )}
        </Button>

        <Button size="sm" onClick={handleRun}>
          <Play className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">Run</span>
        </Button>

        <Button
          variant={videoAutoplay ? "default" : "ghost"}
          size="sm"
          onClick={() => setVideoAutoplay(!videoAutoplay)}
          title={videoAutoplay ? "Auto-playing videos" : "Videos paused"}
        >
          {videoAutoplay ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        </Button>

        <ThemeToggle />
      </div>
    </div>
  )
}
