"use client"

import { memo, useCallback, useMemo, useRef, useState } from "react"
import { Position, type NodeProps, NodeResizer, Handle, NodeToolbar } from "@xyflow/react"
import { Type, Bold, Italic, AlignLeft, AlignCenter, AlignRight, List, ChevronDown } from "lucide-react"
import { useTheme } from "next-themes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { EditableNodeLabel } from "./editable-node-label"
import { TagTextarea } from "@/components/editor/config-panels/tag-textarea"
import { getUpstreamNodes } from "@/lib/node-refs"
import { NODE_COLORS, adjustColor, getEffectiveColor } from "@/lib/node-colors"
import type { TextPromptData } from "@/types/nodes"

function TextPromptNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TextPromptData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const [isHovered, setIsHovered] = useState(false)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const nodeRefs = useMemo(() => getUpstreamNodes(id, nodes, edges), [id, nodes, edges])
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const color = nodeData.color ?? "#0f172a"
  const effectiveColor = getEffectiveColor(color, isDark)
  const textStyle = nodeData.textStyle ?? "paragraph"
  const bold = nodeData.bold ?? false
  const italic = nodeData.italic ?? false
  const alignment = nodeData.alignment ?? "left"
  const width = nodeData.width ?? 220
  const height = nodeData.height ?? 160

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
        hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 600)
      }}
    >
      {/* Floating label above node */}
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Type className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />

      {/* Node resizer */}
      <NodeResizer
        isVisible={!!selected}
        minWidth={160}
        lineClassName="!border-[#38BDF8]"
        handleClassName="!w-2.5 !h-2.5 !bg-[#38BDF8] !border-none !rounded-sm"
        onResize={handleResize}
      />

      {/* Floating toolbar below node */}
      <NodeToolbar isVisible={selected || isHovered} position={Position.Bottom} offset={0}>
        <div
          className="flex items-center gap-1 px-2 py-1.5 bg-white border border-border dark:bg-[#1a1a1a] dark:border-white/10 rounded-xl shadow-xl backdrop-blur-sm flex-wrap"
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
          {NODE_COLORS.map((c) => (
            <div
              key={c}
              onClick={(e) => { e.stopPropagation(); updateNodeData(id, { color: c }) }}
              className={`w-4 h-4 rounded-full cursor-pointer border-2 transition-transform hover:scale-110 ${color === c ? "border-foreground dark:border-white" : "border-foreground/15 dark:border-white/20"}`}
              style={{ backgroundColor: getEffectiveColor(c, isDark) }}
            />
          ))}

          <div className="w-px h-4 bg-border dark:bg-white/10 mx-1" />

          {/* Paragraph / Heading select */}
          <button
            type="button"
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] text-foreground/70 hover:bg-black/5 dark:text-white/70 dark:hover:bg-white/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { textStyle: textStyle === "paragraph" ? "heading" : "paragraph" })
            }}
          >
            <span>{textStyle === "heading" ? "Heading" : "Paragraph"}</span>
            <ChevronDown className="w-3 h-3" />
          </button>

          <div className="w-px h-4 bg-border dark:bg-white/10 mx-1" />

          {/* Bold */}
          <button
            type="button"
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${bold ? "bg-black/10 text-foreground dark:bg-white/20 dark:text-white" : "text-foreground/50 hover:text-foreground/80 hover:bg-black/5 dark:text-white/50 dark:hover:text-white/80 dark:hover:bg-white/10"}`}
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
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${italic ? "bg-black/10 text-foreground dark:bg-white/20 dark:text-white" : "text-foreground/50 hover:text-foreground/80 hover:bg-black/5 dark:text-white/50 dark:hover:text-white/80 dark:hover:bg-white/10"}`}
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { italic: !italic })
            }}
          >
            <Italic className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-border dark:bg-white/10 mx-1" />

          {/* Alignment */}
          <button
            type="button"
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${alignment === "left" ? "bg-black/10 text-foreground dark:bg-white/20 dark:text-white" : "text-foreground/50 hover:text-foreground/80 hover:bg-black/5 dark:text-white/50 dark:hover:text-white/80 dark:hover:bg-white/10"}`}
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { alignment: "left" })
            }}
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${alignment === "center" ? "bg-black/10 text-foreground dark:bg-white/20 dark:text-white" : "text-foreground/50 hover:text-foreground/80 hover:bg-black/5 dark:text-white/50 dark:hover:text-white/80 dark:hover:bg-white/10"}`}
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { alignment: "center" })
            }}
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${alignment === "right" ? "bg-black/10 text-foreground dark:bg-white/20 dark:text-white" : "text-foreground/50 hover:text-foreground/80 hover:bg-black/5 dark:text-white/50 dark:hover:text-white/80 dark:hover:bg-white/10"}`}
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { alignment: "right" })
            }}
          >
            <AlignRight className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-border dark:bg-white/10 mx-1" />

          {/* Bullet list */}
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center rounded text-foreground/50 hover:text-foreground/80 hover:bg-black/5 dark:text-white/50 dark:hover:text-white/80 dark:hover:bg-white/10 transition-colors"
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
          backgroundColor: effectiveColor,
          border: `2px solid ${adjustColor(effectiveColor, -30)}`,
          boxShadow: `0 0 16px ${effectiveColor}15`,
        }}
      >
        {/* Textarea */}
        <div
          className={`text-prompt-tag-textarea w-full flex-1 min-h-0 ${selected ? "nopan nodrag" : "pointer-events-none"}`}
          onMouseDown={selected ? (e) => e.stopPropagation() : undefined}
          onClick={selected ? (e) => e.stopPropagation() : undefined}
          onKeyDown={selected ? (e) => e.stopPropagation() : undefined}
          style={{ fontSize, fontWeight, fontStyle, textAlign }}
        >
          <TagTextarea
            value={nodeData.text ?? ""}
            onChange={(value) => updateNodeData(id, { text: value })}
            placeholder="Enter your prompt..."
            className="!bg-transparent !border-none !shadow-none !ring-0 !outline-none !p-3 !leading-relaxed !h-full !resize-none"
            nodeRefs={nodeRefs}
          />
        </div>
      </div>

      {/* Input handle */}
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 28, height: 28, minWidth: 0, minHeight: 0, background: "transparent", border: "none", top: "50%", left: "-29px", transform: "translateY(-50%)" }}
      />

      {/* Input handle icon */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#38BDF8] shadow-lg shadow-sky-500/30"
        style={{ top: '50%', left: '-29px', transform: 'translateY(-50%)' }}
      >
        <Type className="w-3.5 h-3.5 text-white" />
      </div>

      {/* Handle — fully invisible, interactive */}
      <Handle
        id="prompt"
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 28, height: 28, minWidth: 0, minHeight: 0, background: "transparent", border: "none", top: "calc(25% - 47px)", right: "-43px", transform: "none" }}
      />

      {/* Output handle icon */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#38BDF8] shadow-lg shadow-sky-500/30"
        style={{ top: 'calc(25% - 47px)', right: '-29px' }}
      >
        <Type className="w-3.5 h-3.5 text-white" />
      </div>

    </div>
  )
}

export const TextPromptNode = memo(TextPromptNodeComponent)
