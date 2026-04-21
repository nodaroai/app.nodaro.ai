"use client"

import { memo, useCallback, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { GitBranch, ChevronRight } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAutoExecute } from "@/hooks/use-auto-execute"
import type { RouterNodeData } from "@/types/nodes"

const LETTERS = "ABCDEFGHIJ"

function RouterNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as RouterNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const updateNodeInternals = useUpdateNodeInternals()
  const routes = nodeData.routes ?? []
  const mode = nodeData.mode ?? "radio"
  const isConditional = mode === "conditional"
  const activeRoutes = nodeData.activeRoutes ?? []
  const routeIds = routes.map((r) => r.id).join(",")
  const spacing = routes.length <= 1 ? 30 : Math.min(30, Math.floor(120 / routes.length))
  const status = nodeData.executionStatus ?? "idle"

  useAutoExecute(id, data as Record<string, unknown>)

  // In conditional mode the "active" state is derived from rule evaluation,
  // so we read the post-execution activeRoutes rather than the stored flags.
  const isRouteActive = useCallback(
    (route: { id: string; active: boolean }) =>
      isConditional ? activeRoutes.includes(route.id) : route.active,
    [isConditional, activeRoutes],
  )

  // Update React Flow internals when route IDs change (add/remove/replace)
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, routeIds, updateNodeInternals])

  const toggleRoute = useCallback((routeId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    // Conditional mode: active state is derived, not user-toggled. Ignore clicks.
    if (isConditional) return
    const updated = routes.map((r) => {
      if (mode === "radio") {
        return { ...r, active: r.id === routeId }
      }
      return r.id === routeId ? { ...r, active: !r.active } : r
    })
    updateNodeData(id, { routes: updated })
  }, [id, routes, mode, isConditional, updateNodeData])

  // Build dynamic handles — only recompute when route IDs or spacing change
  const handles = useMemo(() => {
    const h: Array<{ id: string; type: "target" | "source"; position: typeof Position.Left | typeof Position.Right; hideHandle: boolean; customStyle: Record<string, string> }> = [
      { id: "in", type: "target", position: Position.Left, hideHandle: true, customStyle: { top: "calc(100% - 20px)", left: "-29px" } },
    ]
    routes.forEach((route, i) => {
      h.push({
        id: route.id,
        type: "source",
        position: Position.Right,
        hideHandle: true,
        customStyle: { top: `${20 + i * spacing}px`, right: "-29px" },
      })
    })
    return h
  }, [routeIds, spacing]) // eslint-disable-line react-hooks/exhaustive-deps

  const modeLabel = mode === "radio" ? "Radio" : mode === "checkbox" ? "Checkbox" : "Conditional"

  return (
    <div className="relative" style={{ maxWidth: "220px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<GitBranch className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<GitBranch className="h-4 w-4" />}
        category="processing"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={200}
        topToolbarContent={
          <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runFromHere?.(nid)} runFromHere />
        }
        handles={handles}
      >
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {modeLabel}
          </span>
          {routes.length > 0 && routes.every((r) => !isRouteActive(r)) && (
            <span className="text-[9px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded font-medium">
              NONE
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 px-3 pb-2 nopan nodrag">
          {routes.map((route) => {
            const active = isRouteActive(route)
            return (
              <button
                key={route.id}
                type="button"
                className={
                  "flex items-center gap-2 w-full text-left py-0.5 transition-opacity " +
                  (isConditional ? "cursor-default" : "hover:opacity-80")
                }
                onClick={(e) => toggleRoute(route.id, e)}
                title={isConditional ? "Active state is decided by condition groups at run time" : undefined}
              >
                {mode === "checkbox" ? (
                  <div className={`w-6 h-3.5 rounded-full relative transition-colors ${
                    active ? "bg-green-500" : "bg-muted-foreground/30"
                  }`}>
                    <div className={`w-2.5 h-2.5 rounded-full bg-white absolute top-0.5 transition-all ${
                      active ? "right-0.5" : "left-0.5"
                    }`} />
                  </div>
                ) : (
                  // radio + conditional both render as a filled circle
                  <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                    active ? "border-green-500" : "border-muted-foreground/40"
                  }`}>
                    {active && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                  </div>
                )}
                <span className={`text-[11px] truncate ${active ? "text-foreground" : "text-muted-foreground"}`}>
                  {route.name}
                </span>
              </button>
            )
          })}
        </div>
      </BaseNode>
      <HandleIcon icon={<ChevronRight />} color="cyan" side="left" top="calc(100% - 20px)" />
      {routes.map((route, i) => (
        <HandleIcon
          key={route.id}
          icon={<span className="text-[8px] font-bold">{LETTERS[i] ?? "?"}</span>}
          color={isRouteActive(route) ? "green" : "steel"}
          top={`${20 + i * spacing}px`}
          label={route.name}
        />
      ))}
    </div>
  )
}

export const RouterNode = memo(RouterNodeComponent)
