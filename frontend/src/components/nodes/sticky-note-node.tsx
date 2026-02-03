"use client"

import { memo, useState, useCallback, useRef, useEffect } from "react"
import { type NodeProps, NodeResizer } from "@xyflow/react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Bold,
  Italic,
  Heading1,
  List,
  Link as LinkIcon,
  Table,
  Image as ImageIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react"
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

// Font size classes
const fontSizeClasses: Record<string, string> = {
  sm: "text-xs",
  base: "text-sm",
  lg: "text-base",
  xl: "text-lg",
}

function StickyNoteNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as StickyNoteData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(nodeData.text)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const bgColor = nodeData.color || "#fef3c7"
  const borderColor = adjustColor(bgColor, -40)
  const textColor = isLightColor(bgColor) ? "#1f2937" : "#f9fafb"
  const fontSize = nodeData.fontSize || "base"
  const alignment = nodeData.alignment || "left"

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

  const handleFontSizeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      updateNodeData(id, { fontSize: e.target.value })
    },
    [id, updateNodeData]
  )

  const handleAlignmentChange = useCallback(
    (newAlignment: "left" | "center" | "right") => {
      updateNodeData(id, { alignment: newAlignment })
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

  const insertText = useCallback((text: string) => {
    if (!textareaRef.current) return
    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newText = editText.substring(0, start) + text + editText.substring(end)
    setEditText(newText)
    setTimeout(() => {
      textarea.focus()
      textarea.selectionStart = start + text.length
      textarea.selectionEnd = start + text.length
    }, 0)
  }, [editText])

  const insertLink = useCallback(() => {
    const url = prompt("Enter URL:")
    if (!url) return
    const text = prompt("Enter link text:") || url
    insertText(`[${text}](${url})`)
  }, [insertText])

  const insertTable = useCallback(() => {
    const tableTemplate = `
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
`
    insertText(tableTemplate)
  }, [insertText])

  const handleImageUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      const formData = new FormData()
      formData.append("file", file)

      const response = await fetch("/api/upload/image", {
        method: "POST",
        body: formData,
      })

      if (!response.ok) {
        throw new Error("Upload failed")
      }

      const { url } = await response.json()
      insertText(`![${file.name}](${url})`)
    } catch (error) {
      console.error("Failed to upload image:", error)
      alert("Failed to upload image. Please try again.")
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [insertText])

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

      {/* Hidden file input for image upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
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
        {/* Color picker + font size - shown when selected but NOT editing */}
        {selected && !isEditing && (
          <div className="absolute -top-10 left-0 flex items-center gap-3 bg-card rounded-lg shadow-lg px-3 py-2 border z-10">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Color:</span>
              <input
                type="color"
                value={bgColor}
                onChange={handleColorChange}
                className="w-7 h-7 rounded cursor-pointer border-2 border-muted hover:border-muted-foreground p-0"
                title="Choose color"
              />
            </div>
            <div className="w-px h-5 bg-border" />
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Size:</span>
              <select
                value={fontSize}
                onChange={handleFontSizeChange}
                className="text-xs bg-transparent border border-muted rounded px-1 py-0.5 cursor-pointer hover:border-muted-foreground"
              >
                <option value="sm">Small</option>
                <option value="base">Normal</option>
                <option value="lg">Large</option>
                <option value="xl">X-Large</option>
              </select>
            </div>
            <div className="w-px h-5 bg-border" />
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleAlignmentChange("left")}
                className={cn(
                  "p-1 rounded transition-colors",
                  alignment === "left" ? "bg-accent" : "hover:bg-accent/50"
                )}
                title="Align Left"
              >
                <AlignLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleAlignmentChange("center")}
                className={cn(
                  "p-1 rounded transition-colors",
                  alignment === "center" ? "bg-accent" : "hover:bg-accent/50"
                )}
                title="Align Center"
              >
                <AlignCenter className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleAlignmentChange("right")}
                className={cn(
                  "p-1 rounded transition-colors",
                  alignment === "right" ? "bg-accent" : "hover:bg-accent/50"
                )}
                title="Align Right"
              >
                <AlignRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="w-full h-full p-3 overflow-hidden flex flex-col">
          {isEditing ? (
            <>
              {/* Formatting toolbar - shown only when editing */}
              <div className="flex flex-wrap gap-1 mb-2 pb-2 border-b" style={{ borderColor: borderColor }}>
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
                <div className="w-px h-6 bg-current opacity-20 mx-1" />
                <button
                  onClick={insertLink}
                  className="p-1 rounded hover:bg-black/10 transition-colors"
                  title="Insert Link"
                >
                  <LinkIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={insertTable}
                  className="p-1 rounded hover:bg-black/10 transition-colors"
                  title="Insert Table"
                >
                  <Table className="w-4 h-4" />
                </button>
                <button
                  onClick={handleImageUpload}
                  className="p-1 rounded hover:bg-black/10 transition-colors"
                  title="Insert Image"
                >
                  <ImageIcon className="w-4 h-4" />
                </button>
              </div>
              <textarea
                ref={textareaRef}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                className={cn(
                  "flex-1 w-full resize-none bg-transparent border-none outline-none font-mono",
                  fontSizeClasses[fontSize]
                )}
                style={{ color: textColor, textAlign: alignment }}
                placeholder="Write notes here... (Markdown supported)"
              />
            </>
          ) : (
            <div
              className={cn(
                "w-full h-full overflow-auto cursor-text",
                fontSizeClasses[fontSize],
                !nodeData.text && "opacity-50 italic"
              )}
              style={{ textAlign: alignment }}
            >
              {nodeData.text ? (
                <div
                  className="prose prose-sm max-w-none [&_*]:!text-inherit [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_a]:underline [&_table]:border-collapse [&_th]:border [&_th]:p-1 [&_td]:border [&_td]:p-1 [&_img]:max-w-full [&_img]:h-auto"
                  style={{ textAlign: alignment }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
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
                      // Style images to fit the note
                      img: ({ src, alt }) => (
                        <img
                          src={src}
                          alt={alt || ""}
                          className="max-w-full h-auto rounded"
                          onClick={(e) => e.stopPropagation()}
                        />
                      ),
                      // Style tables
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
