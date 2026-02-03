"use client"

import { memo, useCallback } from "react"
import { type NodeProps, NodeResizer } from "@xyflow/react"
import { cn } from "@/lib/utils"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { StickyNoteData } from "@/types/nodes"

// Determine if a color is light or dark
function isLightColor(hex: string): boolean {
  if (!hex || !hex.startsWith("#")) return true
  const color = hex.replace("#", "")
  const r = parseInt(color.substr(0, 2), 16)
  const g = parseInt(color.substr(2, 2), 16)
  const b = parseInt(color.substr(4, 2), 16)
  const brightness = (r * 299 + g * 587 + b * 114) / 1000
  return brightness > 128
}

// Get border color (slightly darker)
function getBorderColor(hex: string): string {
  if (!hex || !hex.startsWith("#")) return "#d4a574"
  const color = hex.replace("#", "")
  const r = Math.max(0, parseInt(color.substr(0, 2), 16) - 30)
  const g = Math.max(0, parseInt(color.substr(2, 2), 16) - 30)
  const b = Math.max(0, parseInt(color.substr(4, 2), 16) - 30)
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

function StickyNoteNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as StickyNoteData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const bgColor = nodeData.color || "#fef3c7"
  const textColor = isLightColor(bgColor) ? "#1f2937" : "#ffffff"
  const borderColor = getBorderColor(bgColor)
  const fontSize = nodeData.fontSize || "base"

  const fontSizeMap: Record<string, string> = {
    sm: "12px",
    base: "14px",
    lg: "18px",
    xl: "24px",
  }

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
    <div
      className={cn(
        "rounded-lg border-2 shadow-md",
        selected && "ring-2 ring-violet-500 ring-offset-1"
      )}
      style={{
        backgroundColor: bgColor,
        borderColor: borderColor,
        width: nodeData.width || 200,
        height: nodeData.height || 150,
      }}
    >
      {/* Resizer */}
      <NodeResizer
        isVisible={selected}
        minWidth={150}
        minHeight={100}
        onResize={handleResize}
        lineClassName="!border-violet-500"
        handleClassName="!w-2.5 !h-2.5 !bg-violet-500 !border-violet-600"
      />

      {/* Toolbar - only when selected */}
      {selected && (
        <div
          className="absolute -top-10 left-2 flex items-center gap-2 bg-popover rounded-lg px-3 py-1.5 shadow-lg border"
          style={{ zIndex: 1000 }}
        >
          <input
            type="color"
            value={bgColor}
            onChange={handleColorChange}
            className="w-6 h-6 rounded cursor-pointer border-0 p-0"
            title="Background color"
          />
          <select
            value={fontSize}
            onChange={handleFontSizeChange}
            className="text-xs bg-background border rounded px-1.5 py-0.5 cursor-pointer"
          >
            <option value="sm">Small</option>
            <option value="base">Normal</option>
            <option value="lg">Large</option>
            <option value="xl">X-Large</option>
          </select>
        </div>
      )}

      {/* Textarea - ALWAYS visible and editable */}
      <textarea
        value={nodeData.text || ""}
        onChange={handleTextChange}
        placeholder="Write your notes here..."
        className="w-full h-full bg-transparent border-none outline-none resize-none p-3 font-sans"
        style={{
          color: textColor,
          fontSize: fontSizeMap[fontSize] || "14px",
        }}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  )
}

StickyNoteNodeComponent.displayName = "StickyNoteNode"

export const StickyNoteNode = memo(StickyNoteNodeComponent)
