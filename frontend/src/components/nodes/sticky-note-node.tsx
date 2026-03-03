"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Position, type NodeProps, NodeResizer, NodeToolbar } from "@xyflow/react"
import { StickyNote, Bold, Italic, AlignLeft, AlignCenter, AlignRight, List, ChevronDown } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { EditableNodeLabel } from "./editable-node-label"
import type { StickyNoteData } from "@/types/nodes"

const COLORS = ["#0f172a", "#1e3a5f", "#1a2e1a", "#2d1a1a", "#2d1a2d", "#1a2d2d"]

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
  const updateNode = useWorkflowStore((s) => s.updateNode)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    updateNode(id, { zIndex: selected ? 10 : -1 })
  }, [selected, id, updateNode])

  const color = nodeData.color ?? "#0f172a"
  const textStyle = nodeData.fontSize === "lg" || nodeData.fontSize === "xl" ? "heading" : "paragraph"
  const bold = nodeData.bold ?? false
  const italic = nodeData.italic ?? false
  const alignment = nodeData.alignment ?? "left"
  const width = nodeData.width ?? 400
  const height = nodeData.height ?? 300

  const handleResize = useCallback(
    (_event: unknown, params: { width: number; height: number }) => {
      updateNodeData(id, { width: params.width, height: params.height })
    },
    [id, updateNodeData],
  )

  const fontSize = textStyle === "heading" ? 18 : 14
  const fontWeight = bold ? 700 : textStyle === "heading" ? 600 : 400
  const fontStyle = italic ? ("italic" as const) : ("normal" as const)
  const textAlign = alignment as "left" | "center" | "right"

  return (
    <div
      className="relative"
      style={{ width, height, overflow: 'visible' }}
      onMouseEnter={() => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
        setIsHovered(true)
      }}
      onMouseLeave={() => {
        hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 800)
      }}
    >
      {/* Floating label above node */}
      <EditableNodeLabel
        label={nodeData.label}
        icon={<StickyNote className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />

      {/* Node resizer */}
      <NodeResizer
        isVisible={!!selected}
        minWidth={160}
        minHeight={100}
        lineClassName="!border-[#38BDF8]"
        handleClassName="!w-2.5 !h-2.5 !bg-[#38BDF8] !border-none !rounded-sm"
        onResize={handleResize}
      />

      {/* Floating toolbar above node */}
      <NodeToolbar isVisible={selected || isHovered} position={Position.Top} offset={0}>
        <div
          className="flex items-center gap-1 px-2 py-1.5 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-xl backdrop-blur-sm flex-wrap"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
            setIsHovered(true)
          }}
          onMouseLeave={() => {
            hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 300)
          }}
        >
          {/* Color swatches */}
          {COLORS.map((c) => (
            <div
              key={c}
              onClick={(e) => { e.stopPropagation(); updateNodeData(id, { color: c }) }}
              className="w-4 h-4 rounded-full cursor-pointer border-2 transition-transform hover:scale-110"
              style={{
                backgroundColor: c,
                borderColor: color === c ? "white" : "rgba(255,255,255,0.2)",
              }}
            />
          ))}

          <div className="w-px h-4 bg-white/10 mx-1" />

          {/* Paragraph / Heading select */}
          <button
            type="button"
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] text-white/70 hover:bg-white/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { fontSize: textStyle === "paragraph" ? "lg" : "base" })
            }}
          >
            <span>{textStyle === "heading" ? "Heading" : "Paragraph"}</span>
            <ChevronDown className="w-3 h-3" />
          </button>

          <div className="w-px h-4 bg-white/10 mx-1" />

          {/* Bold */}
          <button
            type="button"
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${bold ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80 hover:bg-white/10"}`}
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { bold: !bold })
            }}
          >
            <Bold className="w-3.5 h-3.5" />
          </button>

          {/* Italic */}
          <button
            type="button"
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${italic ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80 hover:bg-white/10"}`}
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { italic: !italic })
            }}
          >
            <Italic className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-white/10 mx-1" />

          {/* Alignment */}
          <button
            type="button"
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${alignment === "left" ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80 hover:bg-white/10"}`}
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { alignment: "left" })
            }}
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${alignment === "center" ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80 hover:bg-white/10"}`}
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { alignment: "center" })
            }}
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${alignment === "right" ? "bg-white/20 text-white" : "text-white/50 hover:text-white/80 hover:bg-white/10"}`}
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { alignment: "right" })
            }}
          >
            <AlignRight className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-white/10 mx-1" />

          {/* Bullet list */}
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center rounded text-white/50 hover:text-white/80 hover:bg-white/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              const currentText = nodeData.text ?? ""
              const lines = currentText.split("\n")
              const allBulleted = lines.every((l) => l.startsWith("- ") || l.trim() === "")
              const newText = allBulleted
                ? lines.map((l) => (l.startsWith("- ") ? l.slice(2) : l)).join("\n")
                : lines.map((l) => (l.trim() === "" ? l : `- ${l}`)).join("\n")
              updateNodeData(id, { text: newText })
            }}
          >
            <List className="w-3.5 h-3.5" />
          </button>
        </div>
      </NodeToolbar>

      {/* Container */}
      <div
        className="w-full h-full rounded-xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: color,
          border: `2px solid ${adjustColor(color, -30)}`,
          boxShadow: `0 0 16px ${color}15`,
        }}
      >
        {/* Textarea */}
        <textarea
          ref={textareaRef}
          className="nopan w-full flex-1 bg-transparent text-white/80 placeholder:text-white/25 resize-none outline-none border-none p-3 leading-relaxed"
          style={{
            fontSize,
            fontWeight,
            fontStyle,
            textAlign,
          }}
          placeholder="Write a note..."
          value={nodeData.text ?? ""}
          onChange={(e) => {
            e.stopPropagation()
            updateNodeData(id, { text: e.target.value })
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>

    </div>
  )
}

export const StickyNoteNode = memo(StickyNoteNodeComponent)
