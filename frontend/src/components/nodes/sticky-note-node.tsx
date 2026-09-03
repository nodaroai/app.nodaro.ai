"use client"

import { useT } from "@/lib/i18n"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { Position, type NodeProps, NodeResizer, NodeToolbar } from "@xyflow/react"
import { StickyNote, Bold, Italic, AlignLeft, AlignCenter, AlignRight, List, ChevronDown, MoreHorizontal } from "lucide-react"
import { useTheme } from "next-themes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { EditableNodeLabel } from "./editable-node-label"
import { INK, NODE_COLORS, adjustColor, getEffectiveColor, readableInk } from "@/lib/node-colors"
import type { StickyNoteData } from "@/types/nodes"

type StickyFontSize = StickyNoteData["fontSize"]

/**
 * The four declared sizes now render four distinct sizes. Previously `lg` and
 * `xl` both rendered 18px and `sm` rendered 14px, so a note on a large canvas
 * had no way to get bigger. `base` (the default) and `lg` keep their existing
 * px values, so every existing note is unchanged; `sm` and `xl` become real.
 */
const FONT_SIZE_PX: Record<StickyFontSize, number> = {
  sm: 12,
  base: 14,
  lg: 18,
  xl: 26,
}

const FONT_SIZE_LABEL: Record<StickyFontSize, string> = {
  sm: "Small",
  base: "Paragraph",
  lg: "Heading",
  xl: "Display",
}

/** The toolbar control cycles the sizes; `sm` is reachable after `xl`. */
const FONT_SIZE_CYCLE: readonly StickyFontSize[] = ["base", "lg", "xl", "sm"]

function nextFontSize(current: StickyFontSize): StickyFontSize {
  const i = FONT_SIZE_CYCLE.indexOf(current)
  return FONT_SIZE_CYCLE[(i + 1) % FONT_SIZE_CYCLE.length]
}

function StickyNoteNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as StickyNoteData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNode = useWorkflowStore((s) => s.updateNode)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isHovered, setIsHovered] = useState(false)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  useEffect(() => {
    updateNode(id, { zIndex: selected ? 10 : -1 })
  }, [selected, id, updateNode])

  const color = nodeData.color ?? "#0f172a"
  const effectiveColor = getEffectiveColor(color, isDark)
  // Ink follows the surface, not the theme — a colour with no light-mode
  // counterpart (the seeded demo's #2d2d44, imports, agents) keeps its dark
  // surface in light mode, and theme-picked slate ink vanished on it.
  const ink = INK[readableInk(effectiveColor, isDark)]
  const currentSize: StickyFontSize = FONT_SIZE_PX[nodeData.fontSize as StickyFontSize]
    ? (nodeData.fontSize as StickyFontSize)
    : "base"
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

  const fontSize = FONT_SIZE_PX[currentSize]
  // 18px and up reads as a heading, and carries the heavier weight the
  // two-state control used to imply.
  const fontWeight = bold ? 700 : fontSize >= 18 ? 600 : 400
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
        lineClassName="!border-[#38BDF8]"
        handleClassName="!w-2.5 !h-2.5 !bg-[#38BDF8] !border-none !rounded-sm"
        onResize={handleResize}
      />

      {/* Floating toolbar above node */}
      <NodeToolbar isVisible={selected || isHovered} position={Position.Top} offset={0}>
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
              updateNodeData(id, { fontSize: nextFontSize(currentSize) })
            }}
          >
            <span>{FONT_SIZE_LABEL[currentSize]}</span>
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

          <div className="w-px h-4 bg-border dark:bg-white/10 mx-1" />

          {/* 3-dots "More options" — sticky-note uses custom chrome instead
              of BaseNode, so it must reproduce BaseNode's overflow button
              itself: dispatch the same `open-node-context-menu` event the
              canvas listens for, giving the note the identical context menu
              (duplicate / skip / delete / …) every other node exposes. */}
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center rounded text-foreground/50 hover:text-foreground/80 hover:bg-black/5 dark:text-white/50 dark:hover:text-white/80 dark:hover:bg-white/10 transition-colors"
            aria-label={t("editor.moreOptions")}
            onClick={(e) => {
              e.stopPropagation()
              window.dispatchEvent(new CustomEvent("open-node-context-menu", {
                detail: { nodeId: id, x: e.clientX, y: e.clientY },
              }))
            }}
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
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
        <textarea
          ref={textareaRef}
          className="sticky-note-textarea nopan w-full flex-1 bg-transparent resize-none outline-none border-none p-3 leading-relaxed"
          style={{
            fontSize,
            fontWeight,
            fontStyle,
            textAlign,
            color: ink.text,
            caretColor: ink.text,
            // Placeholder colour cannot be set inline; globals.css reads it.
            ["--sticky-placeholder" as string]: ink.placeholder,
          }}
          placeholder={t("node.writeANote")}
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
