"use client"

import { useMemo } from "react"
import { Play, CircleSlash, CircleCheck } from "lucide-react"
import { useReactFlow, useViewport } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { RUN_BUTTON_CLASS } from "@/lib/run-button-style"

export function SelectionActionBar() {
  const nodes = useWorkflowStore((s) => s.nodes)
  const runSelected = useWorkflowStore((s) => s.runSelected)
  const skipSelectedNodes = useWorkflowStore((s) => s.skipSelectedNodes)
  const unskipSelectedNodes = useWorkflowStore((s) => s.unskipSelectedNodes)
  const viewport = useViewport()
  const { flowToScreenPosition } = useReactFlow()

  const selectedNodes = useMemo(
    () => nodes.filter((n) => n.selected),
    [nodes],
  )

  const selectedCount = selectedNodes.length

  // Calculate screen position: center-x of bounding box, above the topmost node
  const position = useMemo(() => {
    if (selectedCount < 2) return null

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity

    for (const node of selectedNodes) {
      const x = node.position.x
      const w = node.measured?.width ?? 260
      if (x < minX) minX = x
      if (x + w > maxX) maxX = x + w
      if (node.position.y < minY) minY = node.position.y
    }

    const centerX = (minX + maxX) / 2
    const topY = minY - 60

    const screen = flowToScreenPosition({ x: centerX, y: topY })
    return screen
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNodes, selectedCount, flowToScreenPosition, viewport])

  if (selectedCount < 2 || !position) return null

  const isAnyRunning = selectedNodes.some((n) => {
    const data = n.data as Record<string, unknown>
    return data.executionStatus === "running"
  })

  const allSkipped = selectedNodes.every((n) => {
    const data = n.data as Record<string, unknown>
    return data.skipped === true
  })

  const handleToggleSkip = () => {
    const ids = selectedNodes.map((n) => n.id)
    if (allSkipped) {
      unskipSelectedNodes(ids)
    } else {
      skipSelectedNodes(ids)
    }
  }

  return (
    <div
      className="fixed z-40 flex items-center gap-2 px-3 py-2 rounded-lg border bg-popover shadow-lg"
      style={{
        left: position.x,
        top: position.y,
        transform: "translate(-50%, -100%)",
      }}
    >
      <button
        type="button"
        onClick={() => runSelected?.()}
        disabled={isAnyRunning || !runSelected}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed ${RUN_BUTTON_CLASS}`}
      >
        <Play className="w-3.5 h-3.5" />
        Run selected ({selectedCount})
      </button>
      <button
        type="button"
        onClick={handleToggleSkip}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-600 text-white hover:bg-zinc-600/90 transition-colors"
      >
        {allSkipped ? <CircleCheck className="w-3.5 h-3.5" /> : <CircleSlash className="w-3.5 h-3.5" />}
        {allSkipped ? `Unskip (${selectedCount})` : `Skip (${selectedCount})`}
      </button>
    </div>
  )
}
