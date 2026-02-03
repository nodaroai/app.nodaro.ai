"use client"

import { memo, useCallback } from "react"
import { type NodeProps, NodeResizer } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { StickyNoteData } from "@/types/nodes"
import { Bold, Italic, AlignLeft, AlignCenter, AlignRight } from "lucide-react"

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
  const textColor = nodeData.textColor || (isLightColor(bgColor) ? "#1f2937" : "#f9fafb")
  const fontSize = getFontSize(nodeData.fontSize)
  const isBold = nodeData.bold || false
  const isItalic = nodeData.italic || false
  const alignment = nodeData.alignment || "left"

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeData(id, { text: e.target.value })
    },
    [id, updateNodeData]
  )

  const handleBgColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateNodeData(id, { color: e.target.value })
    },
    [id, updateNodeData]
  )

  const handleTextColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateNodeData(id, { textColor: e.target.value })
    },
    [id, updateNodeData]
  )

  const handleFontSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateNodeData(id, { fontSize: e.target.value })
    },
    [id, updateNodeData]
  )

  const toggleBold = useCallback(() => {
    updateNodeData(id, { bold: !isBold })
  }, [id, updateNodeData, isBold])

  const toggleItalic = useCallback(() => {
    updateNodeData(id, { italic: !isItalic })
  }, [id, updateNodeData, isItalic])

  const setAlignment = useCallback(
    (align: "left" | "center" | "right") => {
      updateNodeData(id, { alignment: align })
    },
    [id, updateNodeData]
  )

  const handleResize = useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      updateNodeData(id, { width: params.width, height: params.height })
    },
    [id, updateNodeData]
  )

  // Calculate toolbar button style based on background
  const toolbarBg = isLightColor(bgColor) ? "bg-black/10" : "bg-white/10"
  const toolbarBorder = isLightColor(bgColor) ? "border-black/10" : "border-white/10"
  const buttonBg = isLightColor(bgColor) ? "hover:bg-black/20" : "hover:bg-white/20"
  const activeButtonBg = isLightColor(bgColor) ? "bg-black/20" : "bg-white/20"
  const buttonText = isLightColor(bgColor) ? "text-gray-700" : "text-gray-200"

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
        className="w-full h-full rounded-lg shadow-md overflow-hidden flex flex-col"
        style={{
          backgroundColor: bgColor,
          width: nodeData.width || 200,
          height: nodeData.height || 150,
        }}
      >
        {/* Toolbar - only when selected, INSIDE the note */}
        {selected && (
          <div className={`flex items-center justify-center gap-1 px-2 py-1 ${toolbarBg} border-b ${toolbarBorder}`}>
            {/* Background color */}
            <div className="relative" title="Background color">
              <input
                type="color"
                value={bgColor}
                onChange={handleBgColorChange}
                className="w-5 h-5 rounded cursor-pointer border-none bg-transparent opacity-0 absolute inset-0"
              />
              <div
                className={`w-5 h-5 rounded border border-black/20 cursor-pointer`}
                style={{ backgroundColor: bgColor }}
              />
            </div>

            {/* Text color */}
            <div className="relative" title="Text color">
              <input
                type="color"
                value={textColor}
                onChange={handleTextColorChange}
                className="w-5 h-5 rounded cursor-pointer border-none bg-transparent opacity-0 absolute inset-0"
              />
              <div
                className={`w-5 h-5 rounded border border-black/20 cursor-pointer flex items-center justify-center text-xs font-bold`}
                style={{ backgroundColor: textColor, color: isLightColor(textColor) ? "#000" : "#fff" }}
              >
                A
              </div>
            </div>

            {/* Separator */}
            <div className={`w-px h-4 ${isLightColor(bgColor) ? "bg-black/20" : "bg-white/20"} mx-0.5`} />

            {/* Font size */}
            <select
              value={nodeData.fontSize || "base"}
              onChange={handleFontSizeChange}
              className={`text-xs ${buttonText} rounded px-1 py-0.5 border-none cursor-pointer bg-white/80`}
              title="Font size"
            >
              <option value="sm">S</option>
              <option value="base">M</option>
              <option value="lg">L</option>
              <option value="xl">XL</option>
            </select>

            {/* Separator */}
            <div className={`w-px h-4 ${isLightColor(bgColor) ? "bg-black/20" : "bg-white/20"} mx-0.5`} />

            {/* Bold */}
            <button
              onClick={toggleBold}
              className={`p-1 rounded ${buttonText} ${buttonBg} ${isBold ? activeButtonBg : ""}`}
              title="Bold"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>

            {/* Italic */}
            <button
              onClick={toggleItalic}
              className={`p-1 rounded ${buttonText} ${buttonBg} ${isItalic ? activeButtonBg : ""}`}
              title="Italic"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>

            {/* Separator */}
            <div className={`w-px h-4 ${isLightColor(bgColor) ? "bg-black/20" : "bg-white/20"} mx-0.5`} />

            {/* Alignment */}
            <button
              onClick={() => setAlignment("left")}
              className={`p-1 rounded ${buttonText} ${buttonBg} ${alignment === "left" ? activeButtonBg : ""}`}
              title="Align left"
            >
              <AlignLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setAlignment("center")}
              className={`p-1 rounded ${buttonText} ${buttonBg} ${alignment === "center" ? activeButtonBg : ""}`}
              title="Align center"
            >
              <AlignCenter className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setAlignment("right")}
              className={`p-1 rounded ${buttonText} ${buttonBg} ${alignment === "right" ? activeButtonBg : ""}`}
              title="Align right"
            >
              <AlignRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Text area - always visible and editable */}
        <textarea
          value={nodeData.text || ""}
          onChange={handleTextChange}
          placeholder="Write notes here..."
          className="nodrag nowheel flex-1 w-full p-3 bg-transparent border-none outline-none resize-none"
          style={{
            color: textColor,
            fontSize: fontSize,
            fontWeight: isBold ? "bold" : "normal",
            fontStyle: isItalic ? "italic" : "normal",
            textAlign: alignment,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        />
      </div>
    </>
  )
}

StickyNoteNodeComponent.displayName = "StickyNoteNode"

export const StickyNoteNode = memo(StickyNoteNodeComponent)
