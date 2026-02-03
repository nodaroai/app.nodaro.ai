"use client"

import { memo, useState, useCallback, useRef, useEffect } from "react"
import { type NodeProps, NodeResizer } from "@xyflow/react"
import ReactMarkdown from "react-markdown"
import { Bold, Italic, Heading1, List } from "lucide-react"
import { cn } from "@/lib/utils"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { StickyNoteData } from "@/types/nodes"

// Helper function to darken/lighten a hex color
function adjustColor(hex: string, percent: number): string {
  // Handle invalid input
  if (!hex || !hex.startsWith("#")) return "#d4a574"

  const num = parseInt(hex.replace("#", ""), 16)
  const r = Math.max(0, Math.min(255, (num >> 16) + percent))
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00ff) + percent))
  const b = Math.max(0, Math.min(255, (num & 0x0000ff) + percent))
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

// Determine if a color is light or dark to set appropriate text color
function isLightColor(hex: string): boolean {
  if (!hex || !hex.startsWith("#")) return true
  const num = parseInt(hex.replace("#", ""), 16)
  const r = (num >> 16) & 0xff
  const g = (num >> 8) & 0xff
  const b = num & 0xff
  // Calculate relative luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5
}

function StickyNoteNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as StickyNoteData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(nodeData.text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const bgColor = nodeData.color || "#fef3c7"
  const borderColor = adjustColor(bgColor, -40)
  const textColor = isLightColor(bgColor) ? "#1f2937" : "#f9fafb"

  const handleDoubleClick = useCallback(() => {
    setEditText(nodeData.text)
    setIsEditing(true)
  }, [nodeData.text])

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      // Move cursor to end
      textareaRef.current.selectionStart = textareaRef.current.value.length
      textareaRef.current.selectionEnd = textareaRef.current.value.length
    }
  }, [isEditing])

  const handleSave = useCallback(() => {
    setIsEditing(false)
    if (editText !== nodeData.text) {
      updateNodeData(id, { text: editText })
    }
  }, [id, editText, nodeData.text, updateNodeData])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Prevent event from bubbling to canvas shortcuts
      e.stopPropagation()

      if (e.key === "Escape") {
        setIsEditing(false)
        setEditText(nodeData.text)
      }

      // Formatting shortcuts
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "b") {
          e.preventDefault()
          wrapSelection("**", "**")
        } else if (e.key === "i") {
          e.preventDefault()
          wrapSelection("*", "*")
        }
      }
    },
    [nodeData.text]
  )

  const handleColorChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateNodeData(id, { color: e.target.value })
    },
    [id, updateNodeData]
  )

  const handleResize = useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      updateNodeData(id, { width: params.width, height: params.height })
    },
    [id, updateNodeData]
  )

  // Text formatting helpers
  const wrapSelection = useCallback((prefix: string, suffix: string) => {
    if (!textareaRef.current) return
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = editText.substring(start, end)
    const newText = editText.substring(0, start) + prefix + selectedText + suffix + editText.substring(end)
    setEditText(newText)
    // Restore cursor position after the wrapped text
    setTimeout(() => {
      textarea.focus()
      textarea.selectionStart = start + prefix.length
      textarea.selectionEnd = end + prefix.length
    }, 0)
  }, [editText])

  const insertAtLineStart = useCallback((prefix: string) => {
    if (!textareaRef.current) return
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    // Find the start of the current line
    const lineStart = editText.lastIndexOf("\n", start - 1) + 1
    const newText = editText.substring(0, lineStart) + prefix + editText.substring(lineStart)
    setEditText(newText)
    setTimeout(() => {
      textarea.focus()
      textarea.selectionStart = start + prefix.length
      textarea.selectionEnd = start + prefix.length
    }, 0)
  }, [editText])

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
          "rounded-lg border-2 shadow-lg transition-shadow",
          selected && "ring-2 ring-violet-500 ring-offset-1"
        )}
        style={{
          width: nodeData.width || 200,
          height: nodeData.height || 150,
          backgroundColor: bgColor,
          borderColor: borderColor,
          color: textColor,
        }}
        onDoubleClick={handleDoubleClick}
      >
        {/* Color picker - shown when selected */}
        {selected && !isEditing && (
          <div className="absolute -top-9 left-0 flex items-center gap-2 bg-card rounded-md shadow-md px-2 py-1 border z-10">
            <span className="text-xs text-muted-foreground">Color:</span>
            <input
              type="color"
              value={bgColor}
              onChange={handleColorChange}
              className="w-7 h-7 rounded cursor-pointer border-0 p-0"
              title="Choose color"
            />
          </div>
        )}

        {/* Content */}
        <div className="w-full h-full p-3 overflow-hidden flex flex-col">
          {isEditing ? (
            <>
              {/* Formatting toolbar */}
              <div className="flex gap-1 mb-2 pb-2 border-b" style={{ borderColor: borderColor }}>
                <button
                  onClick={() => wrapSelection("**", "**")}
                  className="p-1 rounded hover:bg-black/10 transition-colors"
                  title="Bold (Ctrl+B)"
                >
                  <Bold className="w-4 h-4" />
                </button>
                <button
                  onClick={() => wrapSelection("*", "*")}
                  className="p-1 rounded hover:bg-black/10 transition-colors"
                  title="Italic (Ctrl+I)"
                >
                  <Italic className="w-4 h-4" />
                </button>
                <button
                  onClick={() => insertAtLineStart("## ")}
                  className="p-1 rounded hover:bg-black/10 transition-colors"
                  title="Heading"
                >
                  <Heading1 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => insertAtLineStart("- ")}
                  className="p-1 rounded hover:bg-black/10 transition-colors"
                  title="List"
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
              <textarea
                ref={textareaRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                className="flex-1 w-full resize-none bg-transparent border-none outline-none text-sm font-mono"
                style={{ color: textColor }}
                placeholder="Write notes here... (Markdown supported)"
              />
            </>
          ) : (
            <div
              className={cn(
                "w-full h-full text-sm overflow-auto cursor-text",
                !nodeData.text && "opacity-50 italic"
              )}
            >
              {nodeData.text ? (
                <div className="prose prose-sm max-w-none [&_*]:!text-inherit [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_a]:underline">
                  <ReactMarkdown
                    components={{
                      // Ensure links don't interfere with double-click editing
                      a: ({ children, href }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {children}
                        </a>
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
