/**
 * Dropdown for selecting the run target in presentation mode.
 * Options: "Entire Workflow" + each route (sub-workflow-input/output pair) + each sub-workflow node.
 * Supports both tab mode (reads from useWorkflowStore) and fullscreen mode (props).
 */

import { useMemo, useEffect } from "react"
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
import { discoverRoutes } from "@/lib/sub-workflow-utils"

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

  const routes = useMemo(() => discoverRoutes(nodes), [nodes])

  // Stale route guard: if selectedRouteId no longer exists, reset to workflow
  useEffect(() => {
    if (
      presentationSettings.runTarget === "route" &&
      presentationSettings.selectedRouteId &&
      onUpdate
    ) {
      const routeExists = routes.some((r) => r.routeId === presentationSettings.selectedRouteId)
      if (!routeExists) {
        onUpdate({ runTarget: "workflow", selectedRouteId: undefined })
      }
    }
  }, [presentationSettings.runTarget, presentationSettings.selectedRouteId, routes, onUpdate])

  const currentValue =
    presentationSettings.runTarget === "route" && presentationSettings.selectedRouteId
      ? `route:${presentationSettings.selectedRouteId}`
      : presentationSettings.runTarget === "sub-workflow" && presentationSettings.subWorkflowNodeId
        ? `sub:${presentationSettings.subWorkflowNodeId}`
        : "workflow"

  const handleChange = (value: string) => {
    if (!onUpdate) return
    if (value === "workflow") {
      onUpdate({ runTarget: "workflow", subWorkflowNodeId: undefined, selectedRouteId: undefined })
    } else if (value.startsWith("route:")) {
      const routeId = value.slice(6)
      onUpdate({ runTarget: "route", selectedRouteId: routeId, subWorkflowNodeId: undefined })
    } else if (value.startsWith("sub:")) {
      const nodeId = value.slice(4)
      onUpdate({ runTarget: "sub-workflow", subWorkflowNodeId: nodeId, selectedRouteId: undefined })
    }
  }

  // Don't show if no sub-workflows and no routes exist
  if (subWorkflowNodes.length === 0 && routes.length === 0) return null

  return (
    <Select value={currentValue} onValueChange={handleChange} disabled={!onUpdate}>
      <SelectTrigger className="w-[180px] h-8 text-xs">
        <SelectValue placeholder="Run target" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="workflow">Entire Workflow</SelectItem>
        {routes.map((route) => (
          <SelectItem key={`route:${route.routeId}`} value={`route:${route.routeId}`}>
            Route: {getNodeLabel(route.inputNode)}
          </SelectItem>
        ))}
        {subWorkflowNodes.map((node) => (
          <SelectItem key={node.id} value={`sub:${node.id}`}>
            {getNodeLabel(node)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
