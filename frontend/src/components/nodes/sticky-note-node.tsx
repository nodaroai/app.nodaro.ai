"use client"

import { memo, useCallback } from "react"
import { type NodeProps, NodeResizer } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { StickyNoteData } from "@/types/nodes"

// Helper to check if color is light
function isLightColor(color: string): boolean {
  const hex = color.replace("#", "")
  if (hex.length !== 6) return true
  const r = parseInt(hex.substr(0, 2), 16)
  const g = parseInt(hex.substr(2, 2), 16)
  const b = parseInt(hex.substr(4, 2), 16)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness > 128
}

// Font size mapping
function getFontSize(size?: string): string {
  switch (size) {
    case "sm": return "12px"
    case "lg": return "18px"
    case "xl": return "24px"
    default: return "14px"
  }
}

function StickyNoteNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as StickyNoteData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const bgColor = nodeData.color || "#fef3c7"
  const textColor = isLightColor(bgColor) ? "#1f2937" : "#f9fafb"
  const fontSize = getFontSize(nodeData.fontSize)

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeData(id, { text: e.target.value })
    },
    [id, updateNodeData]
  )

  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateNodeData(id, { color: e.target.value })
    },
    [id, updateNodeData]
  )

  const handleFontSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateNodeData(id, { fontSize: e.target.value })
    },
    [id, updateNodeData]
  )

  const handleResize = useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      updateNodeData(id, { width: params.width, height: params.height })
    },
    [id, updateNodeData]
  )

  return (
    <>
      {/* Resizer */}
      <NodeResizer
        isVisible={selected}
        minWidth={150}
        minHeight={80}
        onResize={handleResize}
        lineClassName="!border-violet-400"
        handleClassName="!w-3 !h-3 !bg-violet-500 !border-white !rounded"
      />

      {/* Main container */}
      <div
        className="w-full h-full rounded-lg shadow-md overflow-hidden"
        style={{
          backgroundColor: bgColor,
          width: nodeData.width || 200,
          height: nodeData.height || 150,
        }}
      >
        {/* Toolbar - only when selected, INSIDE the note */}
        {selected && (
          <div className="flex items-center gap-2 px-2 py-1 bg-black/10 border-b border-black/10">
            <input
              type="color"
              value={bgColor}
              onChange={handleColorChange}
              className="w-6 h-6 rounded cursor-pointer border-none bg-transparent"
              title="Background color"
            />
            <select
              value={nodeData.fontSize || "base"}
              onChange={handleFontSizeChange}
              className="text-xs bg-white/80 text-gray-800 rounded px-1 py-0.5 border-none cursor-pointer"
            >
              <option value="sm">Small</option>
              <option value="base">Normal</option>
              <option value="lg">Large</option>
              <option value="xl">X-Large</option>
            </select>
          </div>
        )}

        {/* Text area - always visible and editable */}
        <textarea
          value={nodeData.text || ""}
          onChange={handleTextChange}
          placeholder="Write notes here..."
          className="nodrag nowheel w-full p-3 bg-transparent border-none outline-none resize-none"
          style={{
            color: textColor,
            fontSize: fontSize,
            height: selected ? "calc(100% - 32px)" : "100%",
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        />
      </div>
    </>
  )
}

StickyNoteNodeComponent.displayName = "StickyNoteNode"

export const StickyNoteNode = memo(StickyNoteNodeComponent)
