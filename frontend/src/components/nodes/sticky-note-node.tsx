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

// Font size mapping (5x larger than standard: sm=60, base=70, lg=90, xl=120)
function getFontSize(size?: string): string {
  switch (size) {
    case "sm": return "60px"
    case "lg": return "90px"
    case "xl": return "120px"
    default: return "70px"
  }
}

// Adjust color brightness for border
function adjustColor(hex: string, amount: number): string {
  const color = hex.replace("#", "")
  if (color.length !== 6) return hex
  const num = parseInt(color, 16)
  const r = Math.min(255, Math.max(0, (num >> 16) + amount))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amount))
  const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amount))
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`
}

function StickyNoteNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as StickyNoteData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const bgColor = nodeData.color || "#2d2d44"
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
        minWidth={420}
        minHeight={270}
        onResize={handleResize}
        lineClassName="!border-violet-400"
        handleClassName="!w-3 !h-3 !bg-violet-500 !border-white !rounded"
      />

      {/* Main container */}
      <div
        className="w-full h-full rounded-lg shadow-md overflow-hidden flex flex-col"
        style={{
          backgroundColor: bgColor,
          border: `1px solid ${adjustColor(bgColor, isLightColor(bgColor) ? -20 : 20)}`,
          width: nodeData.width || 840,
          height: nodeData.height || 540,
        }}
      >
        {/* Toolbar - only when selected, INSIDE the note (scaled 3x to match note size) */}
        {selected && (
          <div className={`flex items-center justify-center gap-10 px-10 py-8 ${toolbarBg} border-b-2 ${toolbarBorder}`}>

            {/* Colors */}
            <div className="flex items-center gap-8">
              <div className="flex flex-col items-center gap-1">
                <input
                  type="color"
                  value={bgColor}
                  onChange={handleBgColorChange}
                  className="w-28 h-28 rounded-lg cursor-pointer border-4 border-white/50"
                  title="Background color"
                />
                <span className={`text-2xl ${labelText} opacity-70`}>BG</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <input
                  type="color"
                  value={textColor}
                  onChange={handleTextColorChange}
                  className="w-28 h-28 rounded-lg cursor-pointer border-4 border-white/50"
                  title="Text color"
                />
                <span className={`text-2xl ${labelText} opacity-70`}>Text</span>
              </div>
            </div>

            {/* Separator */}
            <div className={`w-px h-28 ${isLightColor(bgColor) ? "bg-black/20" : "bg-white/20"}`} />

            {/* Font & Format */}
            <div className="flex items-center gap-5">
              <select
                value={nodeData.fontSize || "base"}
                onChange={handleFontSizeChange}
                className="text-3xl bg-white/80 text-gray-800 rounded-lg px-8 py-5 border-none cursor-pointer"
                title="Font size"
              >
                <option value="sm">Small</option>
                <option value="base">Normal</option>
                <option value="lg">Large</option>
                <option value="xl">X-Large</option>
              </select>

              <button
                onClick={toggleBold}
                className={`p-7 rounded-lg ${buttonText} ${buttonBg} ${isBold ? activeButtonBg : ""}`}
                title="Bold"
              >
                <Bold className="w-14 h-14" />
              </button>

              <button
                onClick={toggleItalic}
                className={`p-7 rounded-lg ${buttonText} ${buttonBg} ${isItalic ? activeButtonBg : ""}`}
                title="Italic"
              >
                <Italic className="w-14 h-14" />
              </button>
            </div>

            {/* Separator */}
            <div className={`w-px h-28 ${isLightColor(bgColor) ? "bg-black/20" : "bg-white/20"}`} />

            {/* Alignment */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAlignment("left")}
                className={`p-7 rounded-lg ${buttonText} ${buttonBg} ${alignment === "left" ? activeButtonBg : ""}`}
                title="Align left"
              >
                <AlignLeft className="w-14 h-14" />
              </button>
              <button
                onClick={() => setAlignment("center")}
                className={`p-7 rounded-lg ${buttonText} ${buttonBg} ${alignment === "center" ? activeButtonBg : ""}`}
                title="Align center"
              >
                <AlignCenter className="w-14 h-14" />
              </button>
              <button
                onClick={() => setAlignment("right")}
                className={`p-7 rounded-lg ${buttonText} ${buttonBg} ${alignment === "right" ? activeButtonBg : ""}`}
                title="Align right"
              >
                <AlignRight className="w-14 h-14" />
              </button>
            </div>

            {/* Separator */}
            <div className={`w-px h-28 ${isLightColor(bgColor) ? "bg-black/20" : "bg-white/20"}`} />

            {/* Insert tools */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleInsertLink}
                className={`p-7 rounded-lg ${buttonText} ${buttonBg}`}
                title="Insert link"
              >
                <Link className="w-14 h-14" />
              </button>
              <button
                onClick={handleImageUpload}
                className={`p-7 rounded-lg ${buttonText} ${buttonBg}`}
                title="Insert image"
              >
                <ImageIcon className="w-14 h-14" />
              </button>
              <button
                onClick={handleInsertTable}
                className={`p-7 rounded-lg ${buttonText} ${buttonBg}`}
                title="Insert table"
              >
                <Table className="w-14 h-14" />
              </button>
              <button
                onClick={handleInsertBulletList}
                className={`p-7 rounded-lg ${buttonText} ${buttonBg}`}
                title="Bullet list"
              >
                <List className="w-14 h-14" />
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
          className="nodrag nowheel flex-1 w-full p-8 bg-transparent border-none outline-none resize-none"
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
