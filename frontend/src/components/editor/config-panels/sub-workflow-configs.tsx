"use client"

import { useCallback, useMemo, useState } from "react"
import { useNavigate } from "react-router"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, RefreshCw, AlertCircle, ExternalLink, Eye } from "lucide-react"
import { WorkflowViewerModal } from "@/components/editor/workflow-viewer-modal"
import type { ConfigProps } from "./types"
import type {
  SubWorkflowInputData,
  SubWorkflowOutputData,
  SubWorkflowData,
  SubWorkflowPort,
} from "@/types/nodes"
import { useCallableWorkflows, useWorkflowInterface } from "@/hooks/queries/use-callable-workflows"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { discoverRoutes } from "@/lib/sub-workflow-utils"
import { openSubWorkflow } from "@/lib/sub-workflow-navigation"
import { listSubWorkflowViewModes } from "@/components/nodes/sub-workflow-views/view-mode-registry"

// ---------- Shared: Ports Editor ----------

function PortsEditor({
  ports,
  onChange,
}: {
  readonly ports: SubWorkflowPort[]
  readonly onChange: (ports: SubWorkflowPort[]) => void
}) {
  const addPort = useCallback(() => {
    const newPort: SubWorkflowPort = {
      id: crypto.randomUUID(),
      name: `Port ${ports.length + 1}`,
      mediaType: "any",
    }
    onChange([...ports, newPort])
  }, [ports, onChange])

  const removePort = useCallback((id: string) => {
    if (ports.length <= 1) return
    onChange(ports.filter((p) => p.id !== id))
  }, [ports, onChange])

  const updatePort = useCallback((id: string, field: keyof SubWorkflowPort, value: string) => {
    onChange(ports.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
  }, [ports, onChange])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Ports</Label>
        <Button variant="ghost" size="sm" onClick={addPort} className="h-6 px-2 text-xs">
          <Plus className="w-3 h-3 mr-1" /> Add
        </Button>
      </div>
      {ports.map((port) => (
        <div key={port.id} className="flex items-center gap-2">
          <Input
            className="flex-1 h-8 text-xs"
            value={port.name}
            onChange={(e) => updatePort(port.id, "name", e.target.value)}
            placeholder="Port name"
          />
          <Select
            value={port.mediaType}
            onValueChange={(v) => updatePort(port.id, "mediaType", v)}
          >
            <SelectTrigger className="w-24 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">Text</SelectItem>
              <SelectItem value="image">Image</SelectItem>
              <SelectItem value="video">Video</SelectItem>
              <SelectItem value="audio">Audio</SelectItem>
              <SelectItem value="any">Any</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removePort(port.id)}
            disabled={ports.length <= 1}
            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      ))}
    </div>
  )
}

// ---------- Sub-Workflow Input Config ----------

export function SubWorkflowInputConfig({ data, onUpdate }: ConfigProps<SubWorkflowInputData>) {
  const nodeData = data as SubWorkflowInputData

  // Auto-generate routeId if empty
  const routeId = nodeData.routeId || ""

  const handleLabelChange = useCallback((label: string) => {
    onUpdate({ label })
  }, [onUpdate])

  const handlePortsChange = useCallback((ports: SubWorkflowPort[]) => {
    // Ensure ports have stable IDs
    const withIds = ports.map((p) => ({
      ...p,
      id: p.id || crypto.randomUUID(),
    }))
    onUpdate({ ports: withIds })
  }, [onUpdate])

  const handleGenerateRouteId = useCallback(() => {
    onUpdate({ routeId: crypto.randomUUID() })
  }, [onUpdate])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label className="text-xs font-medium">Label</Label>
        <Input
          className="mt-1 h-8 text-xs"
          value={nodeData.label}
          onChange={(e) => handleLabelChange(e.target.value)}
          placeholder="Route label"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          This becomes the display name on sub-workflow caller nodes.
        </p>
      </div>

      <div>
        <Label className="text-xs font-medium">Route ID</Label>
        <div className="flex items-center gap-2 mt-1">
          <Input
            className="flex-1 h-8 text-xs font-mono"
            value={routeId}
            readOnly
            placeholder="Click Generate"
          />
          {!routeId && (
            <Button variant="outline" size="sm" onClick={handleGenerateRouteId} className="h-8 text-xs">
              Generate
            </Button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">
          Pair this with a Sub-Workflow Output using the same Route ID.
        </p>
      </div>

      <PortsEditor ports={nodeData.ports ?? []} onChange={handlePortsChange} />
    </div>
  )
}

// ---------- Sub-Workflow Output Config ----------

export function SubWorkflowOutputConfig({ data, onUpdate, nodes }: ConfigProps<SubWorkflowOutputData>) {
  const nodeData = data as SubWorkflowOutputData

  // Find all sub-workflow-input nodes in the current workflow that have a routeId
  const inputNodes = useMemo(() => {
    return nodes
      .filter((n) => n.type === "sub-workflow-input")
      .map((n) => ({
        id: n.id,
        routeId: (n.data as SubWorkflowInputData).routeId,
        label: (n.data as SubWorkflowInputData).label,
      }))
      .filter((n) => !!n.routeId)
  }, [nodes])

  const handleRouteChange = useCallback((routeId: string) => {
    onUpdate({ routeId })
  }, [onUpdate])

  const handlePortsChange = useCallback((ports: SubWorkflowPort[]) => {
    const withIds = ports.map((p) => ({
      ...p,
      id: p.id || crypto.randomUUID(),
    }))
    // If visible output port was removed, reset to first port
    const visibleStillExists = withIds.some((p) => p.id === nodeData.visibleOutputPortId)
    const updates: Record<string, unknown> = { ports: withIds }
    if (!visibleStillExists && withIds.length > 0) {
      updates.visibleOutputPortId = withIds[0].id
    }
    onUpdate(updates)
  }, [onUpdate, nodeData.visibleOutputPortId])

  const handleVisibleOutputChange = useCallback((portId: string) => {
    onUpdate({ visibleOutputPortId: portId })
  }, [onUpdate])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label className="text-xs font-medium">Label</Label>
        <Input
          className="mt-1 h-8 text-xs"
          value={nodeData.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </div>

      <div>
        <Label className="text-xs font-medium">Paired Input Route</Label>
        <Select value={nodeData.routeId || ""} onValueChange={handleRouteChange}>
          <SelectTrigger className="mt-1 h-8 text-xs">
            <SelectValue placeholder="Select an input node..." />
          </SelectTrigger>
          <SelectContent>
            {inputNodes.map((input) => (
              <SelectItem key={input.routeId || input.id} value={input.routeId || input.id}>
                {input.label} {input.routeId ? `(${input.routeId.slice(0, 8)}...)` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <PortsEditor ports={nodeData.ports ?? []} onChange={handlePortsChange} />

      {(nodeData.ports ?? []).length > 0 && (
        <div>
          <Label className="text-xs font-medium">Visible Output</Label>
          <p className="text-[10px] text-muted-foreground mb-1">
            Which port's result to preview on the caller node.
          </p>
          <div className="flex flex-col gap-1">
            {(nodeData.ports ?? []).map((port) => (
              <label key={port.id} className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="visibleOutput"
                  checked={nodeData.visibleOutputPortId === port.id}
                  onChange={() => handleVisibleOutputChange(port.id)}
                  className="accent-[#ff0073]"
                />
                {port.name}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Sub-Workflow Config (Caller Node) ----------

export function SubWorkflowConfig({ data, onUpdate }: ConfigProps<SubWorkflowData>) {
  const nodeData = data as SubWorkflowData
  const navigate = useNavigate()
  const projectId = useWorkflowStore((s) => s.projectId)
  const workflowId = useWorkflowStore((s) => s.workflowId)
  const workflowName = useWorkflowStore((s) => s.workflowName)
  const localNodes = useWorkflowStore((s) => s.nodes)
  const [showAllProjects, setShowAllProjects] = useState(false)
  const [viewerOpen, setViewerOpen] = useState(false)

  const { data: callableWorkflows, isLoading: isLoadingWorkflows } = useCallableWorkflows(
    showAllProjects ? undefined : (projectId ?? undefined),
  )

  // Merge current workflow from local store (may have unsaved sub-workflow-input/output nodes)
  const mergedWorkflows = useMemo(() => {
    const remote = callableWorkflows ?? []
    if (!workflowId) return remote

    // Discover routes from local (possibly unsaved) state
    const localRoutes = discoverRoutes(localNodes)
    if (localRoutes.length === 0) return remote

    const localEntry = {
      id: workflowId,
      name: workflowName || "Current Workflow",
      projectId: projectId ?? "",
      projectName: "",
      routes: localRoutes.map((r) => ({
        routeId: r.routeId,
        inputLabel: r.inputData.label || "Unnamed",
        inputPorts: r.inputData.ports ?? [],
        outputPorts: r.outputData.ports ?? [],
        visibleOutputPortId: r.outputData.visibleOutputPortId ?? "",
      })),
    }

    // Replace the remote entry for the current workflow with the local one
    const filtered = remote.filter((w) => w.id !== workflowId)
    return [localEntry, ...filtered]
  }, [callableWorkflows, workflowId, workflowName, projectId, localNodes])

  const { data: workflowInterface, isLoading: isLoadingInterface, refetch: refetchInterface } = useWorkflowInterface(
    nodeData.referencedWorkflowId || undefined,
  )

  const handleWorkflowSelect = useCallback((selectedId: string) => {
    const workflow = mergedWorkflows.find((w) => w.id === selectedId)
    if (!workflow) return

    const updates: Record<string, unknown> = {
      referencedWorkflowId: selectedId,
      referencedWorkflowName: workflow.name,
      selectedRouteId: workflow.routes[0]?.routeId ?? "",
      routeSnapshot: workflow.routes[0] ?? null,
    }
    onUpdate(updates)
  }, [mergedWorkflows, onUpdate])

  const handleRouteSelect = useCallback((routeId: string) => {
    const route = workflowInterface?.routes.find((r) => r.routeId === routeId)
    if (!route) return
    onUpdate({
      selectedRouteId: routeId,
      routeSnapshot: route,
    })
  }, [workflowInterface, onUpdate])

  const handleRefreshInterface = useCallback(async () => {
    const { data: fresh } = await refetchInterface()
    const routes = fresh?.routes ?? workflowInterface?.routes ?? []
    const route = routes.find((r) => r.routeId === nodeData.selectedRouteId)
    if (route) {
      onUpdate({ routeSnapshot: route })
    }
  }, [refetchInterface, workflowInterface, nodeData.selectedRouteId, onUpdate])

  const snapshot = nodeData.routeSnapshot

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label className="text-xs font-medium">Label</Label>
        <Input
          className="mt-1 h-8 text-xs"
          value={nodeData.label}
          onChange={(e) => onUpdate({ label: e.target.value })}
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Workflow</Label>
          <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showAllProjects}
              onChange={(e) => setShowAllProjects(e.target.checked)}
              className="accent-[#ff0073]"
            />
            All projects
          </label>
        </div>
        <Select
          value={nodeData.referencedWorkflowId || ""}
          onValueChange={handleWorkflowSelect}
        >
          <SelectTrigger className="mt-1 h-8 text-xs">
            <SelectValue placeholder={isLoadingWorkflows ? "Loading..." : "Select a workflow..."} />
          </SelectTrigger>
          <SelectContent>
            {mergedWorkflows.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}{w.id === workflowId ? " (current)" : ""} ({w.routes.length} route{w.routes.length !== 1 ? "s" : ""})
              </SelectItem>
            ))}
            {!isLoadingWorkflows && mergedWorkflows.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No callable workflows found. Add Sub-Workflow Input/Output nodes to a workflow first.
              </div>
            )}
          </SelectContent>
        </Select>
      </div>

      {nodeData.referencedWorkflowId && workflowInterface && workflowInterface.routes.length > 1 && (
        <div>
          <Label className="text-xs font-medium">Route</Label>
          <Select value={nodeData.selectedRouteId || ""} onValueChange={handleRouteSelect}>
            <SelectTrigger className="mt-1 h-8 text-xs">
              <SelectValue placeholder="Select route..." />
            </SelectTrigger>
            <SelectContent>
              {workflowInterface.routes.map((route) => (
                <SelectItem key={route.routeId} value={route.routeId}>
                  {route.inputLabel} ({route.inputPorts.length} in, {route.outputPorts.length} out)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {snapshot && (
        <div className="rounded-lg bg-gray-100 dark:bg-[#1a1a2e] border border-gray-200 dark:border-[#2D2D2D] p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium">Interface</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefreshInterface}
              disabled={isLoadingInterface}
              className="h-6 px-2 text-[10px]"
            >
              <RefreshCw className="w-3 h-3 mr-1" /> Refresh
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            <div className="text-[10px] text-muted-foreground">
              <span className="font-medium">Inputs:</span>{" "}
              {snapshot.inputPorts.map((p) => `${p.name} (${p.mediaType})`).join(", ")}
            </div>
            <div className="text-[10px] text-muted-foreground">
              <span className="font-medium">Outputs:</span>{" "}
              {snapshot.outputPorts.map((p) => `${p.name} (${p.mediaType})`).join(", ")}
            </div>
          </div>
        </div>
      )}

      {nodeData.referencedWorkflowId && nodeData.referencedWorkflowId !== workflowId && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={() => setViewerOpen(true)}
          >
            <Eye className="w-3 h-3 mr-1.5" />
            View Workflow
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-8 text-xs"
            onClick={() => {
              const wf = mergedWorkflows.find((w) => w.id === nodeData.referencedWorkflowId)
              const pid = wf?.projectId || projectId
              if (pid && nodeData.referencedWorkflowId) {
                openSubWorkflow({
                  childWorkflowId: nodeData.referencedWorkflowId,
                  childWorkflowName: nodeData.referencedWorkflowName ?? wf?.name ?? "Untitled Workflow",
                  childProjectId: pid,
                  sourceNodeId: null,
                  navigate,
                  extraQuery: "?focusType=sub-workflow-input",
                })
              }
            }}
          >
            <ExternalLink className="w-3 h-3 mr-1.5" />
            Open Workflow
          </Button>
        </div>
      )}

      {nodeData.referencedWorkflowId && !workflowInterface && !isLoadingInterface && (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5" />
          Referenced workflow not found or has no valid routes.
        </div>
      )}

      <div>
        <Label className="text-xs font-medium">View mode</Label>
        <Select
          value={nodeData.viewMode ?? "default"}
          onValueChange={(v) => onUpdate({ viewMode: v })}
        >
          <SelectTrigger className="mt-1 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {listSubWorkflowViewModes().map((mode) => (
              <SelectItem key={mode.id} value={mode.id}>{mode.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Controls how this container renders on the canvas. Storyboard / Video / Script views will plug in here as they ship in v2.
        </p>
      </div>

      {viewerOpen && nodeData.referencedWorkflowId && (
        <WorkflowViewerModal
          workflowId={nodeData.referencedWorkflowId}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  )
}
