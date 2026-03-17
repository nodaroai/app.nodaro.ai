/**
 * Dialog for selecting which nodes appear as inputs or outputs in presentation mode.
 * Each dialog shows only its own section's nodes.
 */

import { useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  getInputNodes,
  getNodeLabel,
  getOutputType,
} from "@/lib/presentation-utils"
import type { WorkflowNode } from "@/types/nodes"

interface NodePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: "inputs" | "outputs"
}

function NodeRow({ node, section, onToggle }: { node: WorkflowNode; section: "inputs" | "outputs"; onToggle: (nodeId: string, checked: boolean) => void }) {
  const data = node.data as Record<string, unknown>
  const isVisible = section === "inputs" ? data.presentationInput === true : data.presentationOutput === true
  const label = getNodeLabel(node)
  const typeBadge = getOutputType(node.type)

  return (
    <label className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">
      <Checkbox
        checked={isVisible}
        onCheckedChange={(checked) => onToggle(node.id, checked === true)}
      />
      <span className="flex-1 text-sm truncate">{label}</span>
      <Badge variant="secondary" className="text-xs shrink-0">
        {typeBadge}
      </Badge>
    </label>
  )
}

export function NodePickerDialog({ open, onOpenChange, section }: NodePickerDialogProps) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const availableNodes = useMemo(() => getInputNodes(nodes, false), [nodes])

  const handleToggle = (nodeId: string, checked: boolean) => {
    const field = section === "inputs" ? "presentationInput" : "presentationOutput"
    updateNodeData(nodeId, { [field]: checked })
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
              {availableNodes.map((node) => (
                <NodeRow key={node.id} node={node} section={section} onToggle={handleToggle} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
