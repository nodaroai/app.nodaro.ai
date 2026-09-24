"use client"

import { useT, type MessageKey } from "@/lib/i18n"
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
 * The four declared sizes render four distinct BODY sizes; the title sits one
 * step above its body so a note reads as heading + paragraph at every size.
 * `base` (the default) and `lg` keep their historical px values, so every
 * existing note is unchanged.
 */
const FONT_SIZE_PX: Record<StickyFontSize, number> = {
  sm: 12,
  base: 14,
  lg: 18,
  xl: 26,
}

const TITLE_SIZE_PX: Record<StickyFontSize, number> = {
  sm: 14,
  base: 17,
  lg: 22,
  xl: 30,
}

const FONT_SIZE_LABEL: Record<StickyFontSize, MessageKey> = {
  sm: "inputcfg.small",
  base: "node.stickyParagraph",
  lg: "node.stickyHeading",
  xl: "node.stickyDisplay",
}

/** The toolbar control cycles the sizes; `sm` is reachable after `xl`. */
const FONT_SIZE_CYCLE: readonly StickyFontSize[] = ["base", "lg", "xl", "sm"]

function nextFontSize(current: StickyFontSize): StickyFontSize {
  const i = FONT_SIZE_CYCLE.indexOf(current)
  return FONT_SIZE_CYCLE[(i + 1) % FONT_SIZE_CYCLE.length]
}

/** `<input type="color">` only speaks 6-digit hex — drop a palette entry's alpha
 *  byte, and give an imported note's non-hex colour (`rebeccapurple`) a legal
 *  stand-in instead of a React value warning. */
function opaqueHex(hex: string): string {
  if (/^#[0-9a-fA-F]{8}$/.test(hex)) return hex.slice(0, 7)
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : "#000000"
}

type TranslationKey = Parameters<ReturnType<typeof useT>>[0]

/** Spoken names for the palette swatches (aria); order follows NODE_COLORS. */
const SWATCH_LABEL_KEY: Record<string, TranslationKey> = {
  "#0f172a": "node.swatchSlate",
  "#1e3a5f": "node.swatchBlue",
  "#1a2e1a": "node.swatchGreen",
  "#ff007340": "node.swatchPink",
  "#A855F740": "node.swatchPurple",
  "#22D3EE40": "node.swatchCyan",
  "#26221a": "node.swatchPaper",
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
  const inkKey = readableInk(effectiveColor, isDark)
  const ink = INK[inkKey]
  const currentSize: StickyFontSize = FONT_SIZE_PX[nodeData.fontSize as StickyFontSize]
    ? (nodeData.fontSize as StickyFontSize)
    : "base"
  const bold = nodeData.bold ?? false
  const italic = nodeData.italic ?? false
  const alignment = nodeData.alignment ?? "left"
  const width = nodeData.width ?? 320
  const height = nodeData.height ?? 200
  const title = nodeData.title ?? ""

  const handleResize = useCallback(
    (_event: unknown, params: { width: number; height: number }) => {
      updateNodeData(id, { width: params.width, height: params.height })
    },
    [id, updateNodeData],
  )

  const fontSize = FONT_SIZE_PX[currentSize]
  const titleSize = TITLE_SIZE_PX[currentSize]
  // 18px and up reads as a heading, and carries the heavier weight the
  // two-state control used to imply.
  const fontWeight = bold ? 700 : fontSize >= 18 ? 600 : 400
  const fontStyle = italic ? ("italic" as const) : ("normal" as const)
  const textAlign = alignment as "left" | "center" | "right"
  const borderColor = adjustColor(effectiveColor, inkKey === "dark" ? -28 : 22)

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
      {/* Floating label above the note — only while the note has no title of
          its own; once a title is set it IS the name, and the label would just
          repeat it. */}
      {!title.trim() && (
        <EditableNodeLabel
          label={nodeData.label}
          icon={<StickyNote className="w-3.5 h-3.5" />}
          onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
        />
      )}

      {/* Node resizer */}
      <NodeResizer
        isVisible={!!selected}
        minWidth={160}
        minHeight={110}
        lineClassName="!border-[#38BDF8]"
        handleClassName="!w-2.5 !h-2.5 !bg-[#38BDF8] !border-none !rounded-sm"
        onResize={handleResize}
      />

      {/* Floating toolbar above node */}
      <NodeToolbar isVisible={selected || isHovered} position={Position.Top} offset={0}>
        <div
          className="flex items-center gap-1 px-2 py-1.5 rounded-xl shadow-xl backdrop-blur-sm flex-wrap border node-menu-surface"
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
          {/* Colour swatches — the palette, then a free colour well */}
          {NODE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={SWATCH_LABEL_KEY[c] ? t(SWATCH_LABEL_KEY[c]) : c}
              onClick={(e) => { e.stopPropagation(); updateNodeData(id, { color: c }) }}
              className={`w-5 h-5 rounded-full cursor-pointer border-2 transition-transform hover:scale-110 ${color === c ? "border-foreground dark:border-white" : "border-foreground/15 dark:border-white/20"}`}
              style={{ backgroundColor: getEffectiveColor(c, isDark) }}
            />
          ))}
          <label
            title={t("node.customColour")}
            className="relative w-5 h-5 rounded-full cursor-pointer border-2 border-foreground/15 dark:border-white/20 overflow-hidden transition-transform hover:scale-110"
            style={{ background: "conic-gradient(#ff0073, #f59e0b, #22c55e, #38bdf8, #a855f7, #ff0073)" }}
          >
            <input
              type="color"
              aria-label={t("node.customColour")}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              value={opaqueHex(color)}
              onChange={(e) => updateNodeData(id, { color: e.target.value })}
            />
          </label>

          <div className="w-px h-4 bg-[var(--pill-border)] mx-1" />

          {/* Paragraph / Heading select */}
          <button
            type="button"
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] text-[var(--pill-fg-muted)] hover:text-[var(--pill-fg)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { fontSize: nextFontSize(currentSize) })
            }}
          >
            <span>{t(FONT_SIZE_LABEL[currentSize])}</span>
            <ChevronDown className="w-3 h-3" />
          </button>

          <div className="w-px h-4 bg-[var(--pill-border)] mx-1" />

          {/* Bold */}
          <button
            type="button"
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${bold ? "bg-black/10 text-[var(--pill-fg)] dark:bg-white/20" : "text-[var(--pill-fg-muted)] hover:text-[var(--pill-fg)] hover:bg-black/5 dark:hover:bg-white/10"}`}
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
            className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${italic ? "bg-black/10 text-[var(--pill-fg)] dark:bg-white/20" : "text-[var(--pill-fg-muted)] hover:text-[var(--pill-fg)] hover:bg-black/5 dark:hover:bg-white/10"}`}
            onClick={(e) => {
              e.stopPropagation()
              updateNodeData(id, { italic: !italic })
            }}
          >
            <Italic className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-[var(--pill-border)] mx-1" />

          {/* Alignment */}
          {([
            ["left", <AlignLeft key="l" className="w-3.5 h-3.5" />],
            ["center", <AlignCenter key="c" className="w-3.5 h-3.5" />],
            ["right", <AlignRight key="r" className="w-3.5 h-3.5" />],
          ] as const).map(([value, icon]) => (
            <button
              key={value}
              type="button"
              className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${alignment === value ? "bg-black/10 text-[var(--pill-fg)] dark:bg-white/20" : "text-[var(--pill-fg-muted)] hover:text-[var(--pill-fg)] hover:bg-black/5 dark:hover:bg-white/10"}`}
              onClick={(e) => {
                e.stopPropagation()
                updateNodeData(id, { alignment: value })
              }}
            >
              {icon}
            </button>
          ))}

          <div className="w-px h-4 bg-[var(--pill-border)] mx-1" />

          {/* Bullet list */}
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--pill-fg-muted)] hover:text-[var(--pill-fg)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
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

          <div className="w-px h-4 bg-[var(--pill-border)] mx-1" />

          {/* 3-dots "More options" — sticky-note uses custom chrome instead
              of BaseNode, so it must reproduce BaseNode's overflow button
              itself: dispatch the same `open-node-context-menu` event the
              canvas listens for, giving the note the identical context menu
              (duplicate / skip / delete / …) every other node exposes. */}
          <button
            type="button"
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--pill-fg-muted)] hover:text-[var(--pill-fg)] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
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

      {/* Container: title row + body, one surface */}
      <div
        className="w-full h-full rounded-2xl overflow-hidden flex flex-col px-4 pt-3 pb-3"
        style={{
          backgroundColor: effectiveColor,
          border: `1px solid ${borderColor}`,
          boxShadow: "var(--node-shadow)",
        }}
      >
        <input
          type="text"
          aria-label={t("node.noteTitle")}
          className="sticky-note-textarea nopan nodrag w-full bg-transparent outline-none border-none p-0 mb-1 leading-tight"
          style={{
            fontSize: titleSize,
            fontWeight: 700,
            textAlign,
            color: ink.text,
            caretColor: ink.text,
            ["--sticky-placeholder" as string]: ink.placeholder,
          }}
          placeholder={t("node.noteTitle")}
          value={title}
          onChange={(e) => {
            e.stopPropagation()
            updateNodeData(id, { title: e.target.value })
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <textarea
          ref={textareaRef}
          aria-label={t("node.noteBody")}
          className="sticky-note-textarea nopan w-full flex-1 bg-transparent resize-none outline-none border-none p-0 leading-relaxed"
          style={{
            fontSize,
            fontWeight,
            fontStyle,
            textAlign,
            color: ink.text,
            caretColor: ink.text,
            opacity: 0.88,
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
