"use client"

import { useState } from "react"
import { Save, Play, AlertTriangle, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ThemeToggle } from "@/components/theme-toggle"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { validateWorkflow, type ValidationResult } from "@/lib/workflow-validation"

interface EditorToolbarProps {
  readonly onSave: () => void
  readonly onRun: () => void
  readonly saving: boolean
}

export function EditorToolbar({ onSave, onRun, saving }: EditorToolbarProps) {
  const workflowName = useWorkflowStore((s) => s.workflowName)
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const isDirty = useWorkflowStore((s) => s.isDirty)
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
    <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold text-primary">SceneNode</span>
        <Input
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          className="w-48 h-8 text-sm"
        />
        {isDirty && (
          <Badge variant="outline" className="text-xs">
            Unsaved
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        {validation && (
          <div className="flex items-center gap-1 text-xs mr-2">
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

        <Button variant="outline" size="sm" onClick={handleValidate}>
          Validate
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={saving || !isDirty}
        >
          <Save className="h-4 w-4 mr-1" />
          {saving ? "Saving..." : "Save"}
        </Button>

        <Button size="sm" onClick={handleRun}>
          <Play className="h-4 w-4 mr-1" />
          Run
        </Button>

        <ThemeToggle />
      </div>
    </div>
  )
}
