"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Position, type NodeProps, NodeResizer, Handle, NodeToolbar } from "@xyflow/react"
import { Type, FastForward } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { EditableNodeLabel } from "./editable-node-label"
import { TagTextarea } from "@/components/editor/config-panels/tag-textarea"
import { getUpstreamNodes } from "@/lib/node-refs"
import { NODE_COLORS, getEffectiveColor } from "@/lib/node-colors"
import { hasCredits } from "@/lib/edition"
import { estimateNodeCredits, EXECUTABLE_TYPES } from "@/components/editor/workflow-editor/types"
import type { TextPromptData } from "@/types/nodes"

function TextPromptNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TextPromptData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
  const isEditing = useWorkflowStore((s) => s.selectedNodeId === id)
  const [isHovered, setIsHovered] = useState(false)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const nodeRefs = useMemo(() => getUpstreamNodes(id, nodes, edges), [id, nodes, edges])
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const color = nodeData.color ?? "#0f172a"
  const effectiveColor = getEffectiveColor(color, isDark)
  const width = nodeData.width ?? 220
  const height = nodeData.height ?? 160

  // Local state buffer — preserves browser-native Cmd+Z and debounces store writes
  const [localText, setLocalText] = useState(nodeData.text ?? "")
  const storeTextRef = useRef(nodeData.text ?? "")
  const localTextRef = useRef(nodeData.text ?? "")
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const storeText = nodeData.text ?? ""
    if (storeText !== storeTextRef.current) {
      storeTextRef.current = storeText
      localTextRef.current = storeText
      setLocalText(storeText)
    }
  }, [nodeData.text])

  const handleTextChange = useCallback((value: string) => {
    setLocalText(value)
    localTextRef.current = value
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      storeTextRef.current = value
      updateNodeData(id, { text: value })
    }, 300)
  }, [id, updateNodeData])

  // Flush (not just clear) pending debounce on unmount so last keystrokes aren't lost
  useEffect(() => () => {
    clearTimeout(debounceRef.current)
    if (localTextRef.current !== storeTextRef.current) {
      updateNodeData(id, { text: localTextRef.current })
    }
  }, [id, updateNodeData])

  const handleResize = useCallback(
    (_event: unknown, params: { width: number; height: number }) => {
      updateNodeData(id, { width: params.width, height: params.height })
    },
    [id, updateNodeData],
  )

  // BFS forward to find downstream executable nodes and sum their credit cost
  const { hasDownstream, downstreamCredits } = useMemo(() => {
    const outEdges = edges.filter((e) => e.source === id)
    if (outEdges.length === 0) return { hasDownstream: false, downstreamCredits: 0 }

    const visited = new Set<string>([id])
    const queue = outEdges.map((e) => e.target)
    let totalCredits = 0

    while (queue.length > 0) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)

      const node = nodes.find((n) => n.id === current)
      if (!node) continue

      if (EXECUTABLE_TYPES.has(node.type ?? "")) {
        totalCredits += estimateNodeCredits(node as { type?: string; data?: Record<string, unknown> })
      }

      for (const edge of edges) {
        if (edge.source === current && !visited.has(edge.target)) {
          queue.push(edge.target)
        }
      }
    }

    return { hasDownstream: true, downstreamCredits: totalCredits }
  }, [id, nodes, edges])

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
      {/* Color swatches — centered above the label */}
      {(selected || isHovered) && (
        <div
          className="absolute flex items-center gap-1 px-2 py-1.5 bg-white border border-border dark:bg-[#1a1a1a] dark:border-white/10 rounded-xl shadow-xl backdrop-blur-sm z-10"
          style={{ top: -54, left: '50%', transform: 'translateX(-50%)' }}
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
          {NODE_COLORS.map((c) => (
            <div
              key={c}
              onClick={(e) => { e.stopPropagation(); updateNodeData(id, { color: c }) }}
              className={`w-4 h-4 rounded-full cursor-pointer border-2 transition-transform hover:scale-110 ${color === c ? "border-foreground dark:border-white" : "border-foreground/15 dark:border-white/20"}`}
              style={{ backgroundColor: getEffectiveColor(c, isDark) }}
            />
          ))}
        </div>
      )}

      {/* Floating label above node */}
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Type className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />

      {/* Node resizer — matches BaseNode pattern */}
      <NodeResizer
        isVisible={isHovered || !!selected}
        minWidth={160}
        lineClassName="!border-0 !pointer-events-none"
        handleClassName="!w-2.5 !h-2.5 !bg-muted-foreground/40 !border-0 !rounded-full"
        onResize={handleResize}
      />

      {/* Run from here button — below node, only when connected downstream */}
      {hasDownstream && (
        <NodeToolbar isVisible={selected || isHovered} position={Position.Bottom} offset={4}>
          <div
            className="flex items-center"
            onMouseEnter={() => {
              if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current)
              setIsHovered(true)
            }}
            onMouseLeave={() => {
              hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 300)
            }}
          >
            <button
              type="button"
              className="flex items-center gap-1.5 h-7 px-3 text-[11px] font-medium text-white rounded-lg whitespace-nowrap bg-[#ff0073] hover:bg-[#e60068] shadow-sm transition-colors"
              onClick={(e) => {
                e.stopPropagation()
                runFromHere?.(id)
              }}
            >
              <FastForward className="w-3 h-3" />
              Run from here
              {hasCredits() && downstreamCredits > 0 && (
                <span className="ml-0.5 opacity-80">({downstreamCredits} CR)</span>
              )}
            </button>
          </div>
        </NodeToolbar>
      )}

      {/* Container — with selection/editing glow matching BaseNode */}
      <div
        className={cn(
          "w-full h-full rounded-xl overflow-hidden flex flex-col border-2 transition-colors duration-200",
          "hover:border-black/40 dark:hover:border-white/40",
          // Default border from color
          !selected && !isEditing && "border-transparent",
          // Focused (selected, config panel closed): blue glow
          selected && !isEditing && "border-blue-400 shadow-[0_0_20px_rgba(96,165,250,0.6)]",
          // Editing (selected + config panel open): pink/cyan glow
          isEditing && "border-[#ff0073] shadow-[0_0_20px_rgba(255,0,115,0.5)] dark:border-[#38BDF8] dark:shadow-[0_0_20px_rgba(56,189,248,0.4)]",
        )}
        style={{
          backgroundColor: effectiveColor,
          boxShadow: (!selected && !isEditing) ? `0 0 16px ${effectiveColor}15` : undefined,
        }}
      >
        <div
          className={`text-prompt-tag-textarea w-full flex-1 min-h-0 ${selected ? "nopan nodrag" : "pointer-events-none"}`}
          onMouseDown={selected ? (e) => e.stopPropagation() : undefined}
          onClick={selected ? (e) => e.stopPropagation() : undefined}
          onKeyDown={selected ? (e) => e.stopPropagation() : undefined}
        >
          <TagTextarea
            value={localText}
            onChange={handleTextChange}
            placeholder="Enter your prompt..."
            className="!bg-transparent !border-none !shadow-none !ring-0 !outline-none !resize-none"
            nodeRefs={nodeRefs}
          />
        </div>
      </div>

      {/* Input handle */}
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        style={{ opacity: 0, width: 28, height: 28, minWidth: 0, minHeight: 0, background: "transparent", border: "none", top: "calc(100% - 20px)", left: "-29px", transform: "translateY(-50%)" }}
      />

      {/* Input handle icon */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#38BDF8] shadow-lg shadow-sky-500/30"
        style={{ top: 'calc(100% - 20px)', left: '-29px', transform: 'translateY(-50%)' }}
      >
        <Type className="w-3.5 h-3.5 text-white" />
      </div>

      {/* Handle — fully invisible, interactive */}
      <Handle
        id="prompt"
        type="source"
        position={Position.Right}
        style={{ opacity: 0, width: 28, height: 28, minWidth: 0, minHeight: 0, background: "transparent", border: "none", top: "20px", right: "-43px", transform: "translateY(-50%)" }}
      />

      {/* Output handle icon */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#38BDF8] shadow-lg shadow-sky-500/30"
        style={{ top: '20px', right: '-29px', transform: 'translateY(-50%)' }}
      >
        <Type className="w-3.5 h-3.5 text-white" />
      </div>

    </div>
  )
}

export const TextPromptNode = memo(TextPromptNodeComponent)
