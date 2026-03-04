/**
 * Dropdown for selecting the run target in presentation mode.
 * Options: "Entire Workflow" + each sub-workflow node in the workflow.
 * Supports both tab mode (reads from useWorkflowStore) and fullscreen mode (props).
 */

import { useMemo } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { WorkflowNode } from "@/types/nodes"
import type { PresentationSettings } from "@/hooks/use-workflow-store"
import { getNodeLabel } from "@/lib/presentation-utils"

interface RunTargetSelectorProps {
  nodes: WorkflowNode[]
  presentationSettings: PresentationSettings
  onUpdate?: (patch: Partial<PresentationSettings>) => void
}

export function RunTargetSelector({ nodes, presentationSettings, onUpdate }: RunTargetSelectorProps) {
  const subWorkflowNodes = useMemo(
    () => nodes.filter((n) => n.type === "sub-workflow"),
    [nodes],
  )

  const currentValue = presentationSettings.runTarget === "sub-workflow" && presentationSettings.subWorkflowNodeId
    ? `sub:${presentationSettings.subWorkflowNodeId}`
    : "workflow"

  const handleChange = (value: string) => {
    if (!onUpdate) return
    if (value === "workflow") {
      onUpdate({ runTarget: "workflow", subWorkflowNodeId: undefined })
    } else if (value.startsWith("sub:")) {
      const nodeId = value.slice(4)
      onUpdate({ runTarget: "sub-workflow", subWorkflowNodeId: nodeId })
    }
  }

  // Don't show if no sub-workflows exist
  if (subWorkflowNodes.length === 0) return null

  return (
    <Select value={currentValue} onValueChange={handleChange} disabled={!onUpdate}>
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
