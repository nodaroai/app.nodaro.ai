/**
 * Dropdown for selecting the run target in presentation edit mode.
 * Options: "Entire Workflow" + each sub-workflow node in the workflow.
 */

import { useMemo } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getNodeLabel } from "@/lib/presentation-utils"

export function RunTargetSelector() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const presentationSettings = useWorkflowStore((s) => s.presentationSettings)
  const updatePresentationSettings = useWorkflowStore((s) => s.updatePresentationSettings)

  const subWorkflowNodes = useMemo(
    () => nodes.filter((n) => n.type === "sub-workflow"),
    [nodes],
  )

  const currentValue = presentationSettings.runTarget === "sub-workflow" && presentationSettings.subWorkflowNodeId
    ? `sub:${presentationSettings.subWorkflowNodeId}`
    : "workflow"

  const handleChange = (value: string) => {
    if (value === "workflow") {
      updatePresentationSettings({ runTarget: "workflow", subWorkflowNodeId: undefined })
    } else if (value.startsWith("sub:")) {
      const nodeId = value.slice(4)
      updatePresentationSettings({ runTarget: "sub-workflow", subWorkflowNodeId: nodeId })
    }
  }

  // Don't show if no sub-workflows exist
  if (subWorkflowNodes.length === 0) return null

  return (
    <Select value={currentValue} onValueChange={handleChange}>
      <SelectTrigger className="w-[180px] h-8 text-xs">
        <SelectValue placeholder="Run target" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="workflow">Entire Workflow</SelectItem>
        {subWorkflowNodes.map((node) => (
          <SelectItem key={node.id} value={`sub:${node.id}`}>
            {getNodeLabel(node)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
