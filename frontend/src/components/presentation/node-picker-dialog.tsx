/**
 * Dialog for selecting which nodes appear as inputs or outputs in presentation mode.
 * Each dialog shows only its own section's nodes.
 */

import { useMemo, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Lock, LockOpen } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  getInputNodes,
  getNodeLabel,
  getOutputType,
} from "@/lib/presentation-utils"
import type { WorkflowNode, LoopColumn } from "@/types/nodes"
import type { PresentationSettings } from "@/hooks/use-workflow-store"
import { DEFAULT_SYSTEM_MAX_FANOUT } from "./input-card"

interface NodePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: "inputs" | "outputs"
}

function OutputDisplayModeToggle({
  nodeId,
  presentationSettings,
  updatePresentationSettings,
}: {
  nodeId: string
  presentationSettings: PresentationSettings
  updatePresentationSettings: (settings: Partial<PresentationSettings>) => void
}) {
  const mode = presentationSettings.outputDisplayModes?.[nodeId] ?? "individual"

  const updateDisplayMode = useCallback(
    (newMode: "gallery" | "individual") => {
      const current = presentationSettings.outputDisplayModes ?? {}
      updatePresentationSettings({
        outputDisplayModes: { ...current, [nodeId]: newMode },
      })
    },
    [nodeId, presentationSettings.outputDisplayModes, updatePresentationSettings]
  )

  return (
    <div className="ml-7 mt-1 flex gap-1">
      <span className="text-[10px] text-muted-foreground mr-1">Multiple results:</span>
      <button
        className={`text-[10px] px-2 py-0.5 rounded border ${mode === "gallery" ? "bg-[#ff007320] border-[#ff0073] text-[#ff0073]" : "bg-card border-border text-muted-foreground"}`}
        onClick={() => updateDisplayMode("gallery")}
      >
        Gallery
      </button>
      <button
        className={`text-[10px] px-2 py-0.5 rounded border ${mode !== "gallery" ? "bg-[#ff007320] border-[#ff0073] text-[#ff0073]" : "bg-card border-border text-muted-foreground"}`}
        onClick={() => updateDisplayMode("individual")}
      >
        Individual
      </button>
    </div>
  )
}

function NodeRow({
  node,
  section,
  onToggle,
  presentationSettings,
  updatePresentationSettings,
}: {
  node: WorkflowNode
  section: "inputs" | "outputs"
  onToggle: (nodeId: string, checked: boolean) => void
  presentationSettings: PresentationSettings
  updatePresentationSettings: (settings: Partial<PresentationSettings>) => void
}) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const data = node.data as Record<string, unknown>
  const isVisible = section === "inputs" ? data.presentationInput === true : data.presentationOutput === true
  const isChecked = !!data.presentationInput
  const isReadOnly = !!data.presentationReadOnly
  const label = getNodeLabel(node)
  const typeBadge = getOutputType(node.type)

  return (
    <div>
      <label className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">
        <Checkbox
          checked={isVisible}
          onCheckedChange={(checked) => onToggle(node.id, checked === true)}
        />
        <span className="flex-1 text-sm truncate">{label}</span>
        <Badge variant="secondary" className="text-xs shrink-0">
          {typeBadge}
        </Badge>
        {isVisible && node.type === "text-prompt" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 ml-auto"
            title={isReadOnly ? "Read-only in app" : "Editable in app"}
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(node.id, { presentationReadOnly: !isReadOnly })
            }}
          >
            {isReadOnly ? (
              <Lock className="h-3.5 w-3.5 text-amber-500" />
            ) : (
              <LockOpen className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </Button>
        )}
      </label>
      {section === "outputs" && isVisible && (
        <OutputDisplayModeToggle
          nodeId={node.id}
          presentationSettings={presentationSettings}
          updatePresentationSettings={updatePresentationSettings}
        />
      )}
    </div>
  )
}

export function NodePickerDialog({ open, onOpenChange, section }: NodePickerDialogProps) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const presentationSettings = useWorkflowStore((s) => s.presentationSettings)
  const updatePresentationSettings = useWorkflowStore((s) => s.updatePresentationSettings)

  const availableNodes = useMemo(() => getInputNodes(nodes, false), [nodes])
  const arrayNodes = useMemo(() => availableNodes.filter(n => n.type === "list" || n.type === "loop"), [availableNodes])
  const standardNodes = useMemo(() => availableNodes.filter(n => n.type !== "list" && n.type !== "loop"), [availableNodes])

  const handleToggle = (nodeId: string, checked: boolean) => {
    const field = section === "inputs" ? "presentationInput" : "presentationOutput"
    if (!checked) {
      updateNodeData(nodeId, { [field]: false, presentationReadOnly: false })
    } else {
      updateNodeData(nodeId, { [field]: true })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {section === "inputs" ? "Select Input Nodes" : "Select Output Nodes"}
          </DialogTitle>
        </DialogHeader>
        <div className="max-h-80 overflow-auto py-2">
          {availableNodes.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No nodes in this workflow
            </p>
          ) : (
            <div className="space-y-1">
              {standardNodes.length > 0 && arrayNodes.length > 0 && (
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider px-3 pt-1 pb-1">
                  Standard Inputs
                </p>
              )}
              {standardNodes.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  section={section}
                  onToggle={handleToggle}
                  presentationSettings={presentationSettings}
                  updatePresentationSettings={updatePresentationSettings}
                />
              ))}
              {arrayNodes.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-3 pt-3 pb-1">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      Array Inputs
                    </p>
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#ff0073]/10 text-[#ff0073]">
                      New
                    </span>
                  </div>
                  {arrayNodes.map((node) => {
                    const data = node.data as Record<string, unknown>
                    const maxItems = Math.min((data.maxItems as number) ?? 10, DEFAULT_SYSTEM_MAX_FANOUT)
                    let meta = ""
                    if (node.type === "list") {
                      const items = typeof data.items === "string" && data.items.trim()
                        ? data.items.split("\n").filter(Boolean).length
                        : 0
                      meta = `${items} item${items !== 1 ? "s" : ""} \u00b7 max ${maxItems}`
                    } else if (node.type === "loop") {
                      const columns = (data.columns as LoopColumn[]) ?? []
                      const rows = (data.rows as string[][]) ?? []
                      const types = columns.map(c => c.type ?? "text").join(", ")
                      meta = `${columns.length} col${columns.length !== 1 ? "s" : ""} (${types}) \u00b7 max ${maxItems} rows`
                    }
                    return (
                      <div key={node.id}>
                        <NodeRow
                          node={node}
                          section={section}
                          onToggle={handleToggle}
                          presentationSettings={presentationSettings}
                          updatePresentationSettings={updatePresentationSettings}
                        />
                        {meta && (
                          <p className="text-[10px] text-muted-foreground/60 pl-10 -mt-1 pb-1">
                            {meta}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
