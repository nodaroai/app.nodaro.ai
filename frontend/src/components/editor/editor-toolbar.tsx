"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, ChevronRight, Save, Play, AlertTriangle, CheckCircle } from "lucide-react"
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
}

export function EditorToolbar({ projectId, onSave, onRun, saving }: EditorToolbarProps) {
  const workflowName = useWorkflowStore((s) => s.workflowName)
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const isDirty = useWorkflowStore((s) => s.isDirty)
  const project = useProjectsStore((s) =>
    projectId ? s.projects.find((p) => p.id === projectId) : undefined,
  )
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
          <Link href={`/projects/${projectId}`}>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
        )}

        {/* Breadcrumbs - hidden on small screens */}
        <nav className="hidden sm:flex items-center gap-1 text-sm shrink-0">
          <Link
            href="/projects"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Dashboard
          </Link>
          {project && (
            <>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <Link
                href={`/projects/${projectId}`}
                className="text-muted-foreground hover:text-foreground transition-colors max-w-[120px] truncate"
              >
                {project.name}
              </Link>
            </>
          )}
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </nav>

        <Input
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          className="w-28 sm:w-48 h-8 text-sm"
        />
        {isDirty && (
          <Badge variant="outline" className="text-xs shrink-0 hidden sm:flex">
            Unsaved
          </Badge>
        )}
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
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={saving || !isDirty}
        >
          <Save className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">{saving ? "Saving..." : "Save"}</span>
        </Button>

        <Button size="sm" onClick={handleRun}>
          <Play className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">Run</span>
        </Button>

        <ThemeToggle />
      </div>
    </div>
  )
}
