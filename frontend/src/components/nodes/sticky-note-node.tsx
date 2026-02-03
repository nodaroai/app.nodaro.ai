"use client"

import { memo, useCallback, useRef } from "react"
import { type NodeProps, NodeResizer } from "@xyflow/react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { StickyNoteData } from "@/types/nodes"
import {
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link,
  Image as ImageIcon,
  Table,
  List
} from "lucide-react"

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
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  // Insert text at cursor position
  const insertAtCursor = useCallback((textToInsert: string) => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const currentText = nodeData.text || ""
    const newText = currentText.substring(0, start) + textToInsert + currentText.substring(end)

    updateNodeData(id, { text: newText })

    // Set cursor position after inserted text
    setTimeout(() => {
      textarea.focus()
      textarea.selectionStart = textarea.selectionEnd = start + textToInsert.length
    }, 0)
  }, [id, updateNodeData, nodeData.text])

  const handleInsertLink = useCallback(() => {
    const url = prompt("Enter URL:")
    if (url) {
      const linkText = prompt("Enter link text:", url) || url
      insertAtCursor(`[${linkText}](${url})`)
    }
  }, [insertAtCursor])

  const handleImageUpload = useCallback(() => {
    const url = prompt("Enter image URL:")
    if (url) {
      const altText = prompt("Enter image description:", "image") || "image"
      insertAtCursor(`![${altText}](${url})`)
    }
  }, [insertAtCursor])

  const handleInsertTable = useCallback(() => {
    insertAtCursor(`\n| Header 1 | Header 2 | Header 3 |\n|----------|----------|----------|\n| Cell 1   | Cell 2   | Cell 3   |\n| Cell 4   | Cell 5   | Cell 6   |\n`)
  }, [insertAtCursor])

  const handleInsertBulletList = useCallback(() => {
    insertAtCursor(`\n- Item 1\n- Item 2\n- Item 3\n`)
  }, [insertAtCursor])

  // Calculate toolbar button style based on background
  const toolbarBg = isLightColor(bgColor) ? "bg-black/10" : "bg-white/10"
  const toolbarBorder = isLightColor(bgColor) ? "border-black/10" : "border-white/10"
  const buttonBg = isLightColor(bgColor) ? "hover:bg-black/20" : "hover:bg-white/20"
  const activeButtonBg = isLightColor(bgColor) ? "bg-black/20" : "bg-white/20"
  const buttonText = isLightColor(bgColor) ? "text-gray-700" : "text-gray-200"
  const labelText = isLightColor(bgColor) ? "text-gray-600" : "text-gray-300"

  return (
    <>
      {/* Resizer */}
      <NodeResizer
        isVisible={selected}
        minWidth={280}
        minHeight={120}
        onResize={handleResize}
        lineClassName="!border-violet-400"
        handleClassName="!w-3 !h-3 !bg-violet-500 !border-white !rounded"
      />

      {/* Main container */}
      <div
        className="w-full h-full rounded-lg shadow-md overflow-hidden flex flex-col"
        style={{
          backgroundColor: bgColor,
          width: nodeData.width || 280,
          height: nodeData.height || 180,
        }}
      >
        {/* Toolbar - only when selected, INSIDE the note */}
        {selected && (
          <div className={`flex items-center justify-center gap-4 px-4 py-3 ${toolbarBg} border-b ${toolbarBorder}`}>

            {/* Colors */}
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-center">
                <input
                  type="color"
                  value={bgColor}
                  onChange={handleBgColorChange}
                  className="w-10 h-10 rounded cursor-pointer border-2 border-white/50"
                  title="Background color"
                />
                <span className={`text-xs ${labelText} opacity-70`}>BG</span>
              </div>
              <div className="flex flex-col items-center">
                <input
                  type="color"
                  value={textColor}
                  onChange={handleTextColorChange}
                  className="w-10 h-10 rounded cursor-pointer border-2 border-white/50"
                  title="Text color"
                />
                <span className={`text-xs ${labelText} opacity-70`}>Text</span>
              </div>
            </div>

            {/* Separator */}
            <div className={`w-px h-10 ${isLightColor(bgColor) ? "bg-black/20" : "bg-white/20"}`} />

            {/* Font & Format */}
            <div className="flex items-center gap-2">
              <select
                value={nodeData.fontSize || "base"}
                onChange={handleFontSizeChange}
                className="text-base bg-white/80 text-gray-800 rounded px-3 py-2 border-none cursor-pointer"
                title="Font size"
              >
                <option value="sm">Small</option>
                <option value="base">Normal</option>
                <option value="lg">Large</option>
                <option value="xl">X-Large</option>
              </select>

              <button
                onClick={toggleBold}
                className={`p-2.5 rounded ${buttonText} ${buttonBg} ${isBold ? activeButtonBg : ""}`}
                title="Bold"
              >
                <Bold className="w-5 h-5" />
              </button>

              <button
                onClick={toggleItalic}
                className={`p-2.5 rounded ${buttonText} ${buttonBg} ${isItalic ? activeButtonBg : ""}`}
                title="Italic"
              >
                <Italic className="w-5 h-5" />
              </button>
            </div>

            {/* Separator */}
            <div className={`w-px h-10 ${isLightColor(bgColor) ? "bg-black/20" : "bg-white/20"}`} />

            {/* Alignment */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setAlignment("left")}
                className={`p-2.5 rounded ${buttonText} ${buttonBg} ${alignment === "left" ? activeButtonBg : ""}`}
                title="Align left"
              >
                <AlignLeft className="w-5 h-5" />
              </button>
              <button
                onClick={() => setAlignment("center")}
                className={`p-2.5 rounded ${buttonText} ${buttonBg} ${alignment === "center" ? activeButtonBg : ""}`}
                title="Align center"
              >
                <AlignCenter className="w-5 h-5" />
              </button>
              <button
                onClick={() => setAlignment("right")}
                className={`p-2.5 rounded ${buttonText} ${buttonBg} ${alignment === "right" ? activeButtonBg : ""}`}
                title="Align right"
              >
                <AlignRight className="w-5 h-5" />
              </button>
            </div>

            {/* Separator */}
            <div className={`w-px h-10 ${isLightColor(bgColor) ? "bg-black/20" : "bg-white/20"}`} />

            {/* Insert tools */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleInsertLink}
                className={`p-2.5 rounded ${buttonText} ${buttonBg}`}
                title="Insert link"
              >
                <Link className="w-5 h-5" />
              </button>
              <button
                onClick={handleImageUpload}
                className={`p-2.5 rounded ${buttonText} ${buttonBg}`}
                title="Insert image"
              >
                <ImageIcon className="w-5 h-5" />
              </button>
              <button
                onClick={handleInsertTable}
                className={`p-2.5 rounded ${buttonText} ${buttonBg}`}
                title="Insert table"
              >
                <Table className="w-5 h-5" />
              </button>
              <button
                onClick={handleInsertBulletList}
                className={`p-2.5 rounded ${buttonText} ${buttonBg}`}
                title="Bullet list"
              >
                <List className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Text area - always visible and editable */}
        <textarea
          ref={textareaRef}
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
