/**
 * Dialog for selecting which nodes appear in presentation mode.
 * Shows both inputs and outputs with the primary group first, grouped by type.
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
  getOutputNodes,
  getNodeLabel,
  getOutputType,
} from "@/lib/presentation-utils"
import type { WorkflowNode } from "@/types/nodes"

interface NodePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: "inputs" | "outputs"
}

function NodeRow({ node, onToggle }: { node: WorkflowNode; onToggle: (nodeId: string, checked: boolean) => void }) {
  const data = node.data as Record<string, unknown>
  const isVisible = data.presentationVisible === true
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
  const edges = useWorkflowStore((s) => s.edges)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const inputNodes = useMemo(() => getInputNodes(nodes, false), [nodes])
  const outputNodes = useMemo(() => getOutputNodes(nodes, edges, false), [nodes, edges])

  // Show both groups, primary group first
  const primaryNodes = section === "inputs" ? inputNodes : outputNodes
  const secondaryNodes = section === "inputs" ? outputNodes : inputNodes
  const primaryLabel = section === "inputs" ? "Inputs" : "Outputs"
  const secondaryLabel = section === "inputs" ? "Outputs" : "Inputs"

  const hasAny = primaryNodes.length > 0 || secondaryNodes.length > 0

  const handleToggle = (nodeId: string, checked: boolean) => {
    updateNodeData(nodeId, { presentationVisible: checked })
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
          {!hasAny ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No nodes in this workflow
            </p>
          ) : (
            <>
              {primaryNodes.length > 0 && (
                <div>
                  <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {primaryLabel}
                  </p>
                  <div className="space-y-1">
                    {primaryNodes.map((node) => (
                      <NodeRow key={node.id} node={node} onToggle={handleToggle} />
                    ))}
                  </div>
                </div>
              )}
              {secondaryNodes.length > 0 && (
                <div className={primaryNodes.length > 0 ? "mt-3 pt-3 border-t border-border" : ""}>
                  <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {secondaryLabel}
                  </p>
                  <div className="space-y-1">
                    {secondaryNodes.map((node) => (
                      <NodeRow key={node.id} node={node} onToggle={handleToggle} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
