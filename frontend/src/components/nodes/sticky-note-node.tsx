"use client"

import { memo, useState, useCallback, useRef, useEffect } from "react"
import { type NodeProps, NodeResizer } from "@xyflow/react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { StickyNoteData } from "@/types/nodes"

// Determine if a color is light or dark to set appropriate text color
function isLightColor(hex: string): boolean {
  if (!hex || !hex.startsWith("#")) return true
  const num = parseInt(hex.replace("#", ""), 16)
  const r = (num >> 16) & 0xff
  const g = (num >> 8) & 0xff
  const b = num & 0xff
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5
}

// Get font size in pixels
function getFontSize(size: string): string {
  switch (size) {
    case "sm": return "12px"
    case "lg": return "18px"
    case "xl": return "24px"
    default: return "14px"
  }
}

// Get border color (slightly darker than background)
function getBorderColor(hex: string): string {
  if (!hex || !hex.startsWith("#")) return "#d4a574"
  const num = parseInt(hex.replace("#", ""), 16)
  const r = Math.max(0, (num >> 16) - 30)
  const g = Math.max(0, ((num >> 8) & 0xff) - 30)
  const b = Math.max(0, (num & 0xff) - 30)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

function StickyNoteNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as StickyNoteData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const [isEditing, setIsEditing] = useState(false)
  const [localText, setLocalText] = useState(nodeData.text || "")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const bgColor = nodeData.color || "#fef3c7"
  const textColor = isLightColor(bgColor) ? "#1f2937" : "#f9fafb"
  const borderColor = getBorderColor(bgColor)
  const fontSize = getFontSize(nodeData.fontSize || "base")

  // Sync local text with node data when not editing
  useEffect(() => {
    if (!isEditing) {
      setLocalText(nodeData.text || "")
    }
  }, [nodeData.text, isEditing])

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.selectionStart = textareaRef.current.value.length
    }
  }, [isEditing])

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setIsEditing(true)
  }, [])

  const handleBlur = useCallback(() => {
    setIsEditing(false)
    if (localText !== nodeData.text) {
      updateNodeData(id, { text: localText })
    }
  }, [id, localText, nodeData.text, updateNodeData])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === "Escape") {
      setLocalText(nodeData.text || "")
      setIsEditing(false)
    }
  }, [nodeData.text])

  const handleColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    updateNodeData(id, { color: e.target.value })
  }, [id, updateNodeData])

  const handleFontSizeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    updateNodeData(id, { fontSize: e.target.value })
  }, [id, updateNodeData])

  const handleResize = useCallback((_: unknown, params: { width: number; height: number }) => {
    updateNodeData(id, { width: params.width, height: params.height })
  }, [id, updateNodeData])

  return (
    <>
      <NodeResizer
        minWidth={150}
        minHeight={100}
        isVisible={selected}
        lineClassName="!border-violet-500"
        handleClassName="!w-2.5 !h-2.5 !bg-violet-500 !border-violet-600"
        onResize={handleResize}
      />

      <div
        className={cn(
          "rounded-lg border-2 shadow-md transition-shadow overflow-hidden",
          selected && "ring-2 ring-violet-500 ring-offset-1"
        )}
        style={{
          width: nodeData.width || 200,
          height: nodeData.height || 150,
          backgroundColor: bgColor,
          borderColor: borderColor,
        }}
        onDoubleClick={handleDoubleClick}
      >
        {/* Simple toolbar - only when selected and NOT editing */}
        {selected && !isEditing && (
          <div
            className="absolute -top-12 left-0 flex items-center gap-3 bg-popover rounded-lg px-3 py-2 shadow-lg border"
            style={{ zIndex: 1000 }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Color:</span>
              <input
                type="color"
                value={bgColor}
                onChange={handleColorChange}
                className="w-7 h-7 rounded cursor-pointer border-0 p-0"
              />
            </div>
            <div className="w-px h-5 bg-border" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Size:</span>
              <select
                value={nodeData.fontSize || "base"}
                onChange={handleFontSizeChange}
                className="text-xs bg-background border rounded px-2 py-1 cursor-pointer"
              >
                <option value="sm">Small</option>
                <option value="base">Normal</option>
                <option value="lg">Large</option>
                <option value="xl">X-Large</option>
              </select>
            </div>
          </div>
        )}

        {/* Content area */}
        <div className="w-full h-full p-3">
          {isEditing ? (
            <textarea
              ref={textareaRef}
              value={localText}
              onChange={(e) => setLocalText(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={handleKeyDown}
              placeholder="Write your notes here... (Markdown supported)"
              className="w-full h-full bg-transparent resize-none outline-none font-mono"
              style={{ color: textColor, fontSize }}
            />
          ) : (
            <div
              className={cn(
                "w-full h-full overflow-auto cursor-text",
                !nodeData.text && "opacity-50 italic"
              )}
              style={{ color: textColor, fontSize }}
            >
              {nodeData.text ? (
                <div className="prose prose-sm max-w-none [&_*]:!text-inherit [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_a]:underline [&_table]:border-collapse [&_th]:border [&_th]:p-1 [&_td]:border [&_td]:p-1">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ children, href }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ color: textColor }}
                        >
                          {children}
                        </a>
                      ),
                      table: ({ children }) => (
                        <table className="w-full border-collapse text-xs my-2" style={{ borderColor }}>
                          {children}
                        </table>
                      ),
                      th: ({ children }) => (
                        <th className="border p-1 font-semibold" style={{ borderColor }}>
                          {children}
                        </th>
                      ),
                      td: ({ children }) => (
                        <td className="border p-1" style={{ borderColor }}>
                          {children}
                        </td>
                      ),
                    }}
                  >
                    {nodeData.text}
                  </ReactMarkdown>
                </div>
              ) : (
                "Double-click to edit..."
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

export const StickyNoteNode = memo(StickyNoteNodeComponent)
