"use client"

import { memo, useCallback, useEffect, useMemo } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { GitBranch, ChevronRight } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { RouterNodeData } from "@/types/nodes"

const LETTERS = "ABCDEFGHIJ"

function RouterNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as RouterNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNodeInternals = useUpdateNodeInternals()
  const routes = nodeData.routes ?? []
  const mode = nodeData.mode ?? "radio"
  const routeIds = routes.map((r) => r.id).join(",")
  const spacing = routes.length <= 1 ? 30 : Math.min(30, Math.floor(120 / routes.length))

  // Update React Flow internals when route IDs change (add/remove/replace)
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, routeIds, updateNodeInternals])

  const toggleRoute = useCallback((routeId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = routes.map((r) => {
      if (mode === "radio") {
        return { ...r, active: r.id === routeId }
      }
      return r.id === routeId ? { ...r, active: !r.active } : r
    })
    updateNodeData(id, { routes: updated })
  }, [id, routes, mode, updateNodeData])

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
        selected={selected}
        hideHeader
        minWidth={200}
        handles={handles}
      >
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {mode === "radio" ? "Radio" : "Checkbox"}
          </span>
          {routes.length > 0 && routes.every((r) => !r.active) && (
            <span className="text-[9px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded font-medium">
              NONE
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1 px-3 pb-2 nopan nodrag">
          {routes.map((route) => (
            <button
              key={route.id}
              type="button"
              className="flex items-center gap-2 w-full text-left py-0.5 hover:opacity-80 transition-opacity"
              onClick={(e) => toggleRoute(route.id, e)}
            >
              {mode === "radio" ? (
                <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                  route.active ? "border-green-500" : "border-muted-foreground/40"
                }`}>
                  {route.active && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                </div>
              ) : (
                <div className={`w-6 h-3.5 rounded-full relative transition-colors ${
                  route.active ? "bg-green-500" : "bg-muted-foreground/30"
                }`}>
                  <div className={`w-2.5 h-2.5 rounded-full bg-white absolute top-0.5 transition-all ${
                    route.active ? "right-0.5" : "left-0.5"
                  }`} />
                </div>
              )}
              <span className={`text-[11px] truncate ${route.active ? "text-foreground" : "text-muted-foreground"}`}>
                {route.name}
              </span>
            </button>
          ))}
        </div>
      </BaseNode>
      <HandleIcon icon={<ChevronRight />} color="cyan" side="left" top="calc(100% - 20px)" />
      {routes.map((route, i) => (
        <HandleIcon
          key={route.id}
          icon={<span className="text-[8px] font-bold">{LETTERS[i] ?? "?"}</span>}
          color={route.active ? "green" : "steel"}
          top={`${20 + i * spacing}px`}
          label={route.name}
        />
      ))}
    </div>
  )
}

export const RouterNode = memo(RouterNodeComponent)
