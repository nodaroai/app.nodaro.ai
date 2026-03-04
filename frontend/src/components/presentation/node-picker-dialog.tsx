/**
 * Dialog for selecting which nodes appear in presentation mode.
 * Shows inputs and outputs as separate sections with checkboxes.
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

interface NodePickerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: "inputs" | "outputs"
}

export function NodePickerDialog({ open, onOpenChange, section }: NodePickerDialogProps) {
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  // Get all eligible nodes (curatedOnly=false to show all candidates)
  const eligibleNodes = useMemo(() => {
    if (section === "inputs") return getInputNodes(nodes, false)
    return getOutputNodes(nodes, edges, false)
  }, [nodes, edges, section])

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
        <div className="space-y-1 max-h-80 overflow-auto py-2">
          {eligibleNodes.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              No {section === "inputs" ? "input" : "output"} nodes in this workflow
            </p>
          ) : (
            eligibleNodes.map((node) => {
              const data = node.data as Record<string, unknown>
              const isVisible = data.presentationVisible === true
              const label = getNodeLabel(node)
              const typeBadge = section === "outputs"
                ? getOutputType(node.type)
                : node.type?.replace(/-/g, " ") ?? "unknown"

              return (
                <label
                  key={node.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
                >
                  <Checkbox
                    checked={isVisible}
                    onCheckedChange={(checked) => handleToggle(node.id, checked === true)}
                  />
                  <span className="flex-1 text-sm truncate">{label}</span>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    {typeBadge}
                  </Badge>
                </label>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
