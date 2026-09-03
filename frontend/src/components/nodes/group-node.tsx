"use client"

import { useT } from "@/lib/i18n"
import { memo, useCallback, useMemo, useState } from "react"
import {
  NodeResizer,
  NodeToolbar,
  Position,
  type NodeProps,
} from "@xyflow/react"
import { Boxes } from "lucide-react"
import { useTheme } from "next-themes"
import {
  computeAggregateLanes,
  getOutputType,
  groupHandleId,
  isAggregateableType,
  type AggregateableType,
} from "@nodaro/shared"
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useStaleHandleCleanup } from "@/hooks/use-stale-handle-cleanup"
import { AggregateHandleIcon } from "@/components/nodes/handle-icon"
import { computeGroupBuckets } from "@/components/editor/workflow-editor/execution-graph"
import { NODE_COLORS, adjustColor, getEffectiveColor } from "@/lib/node-colors"
import type { GroupNodeData, WorkflowNode } from "@/types/nodes"

/** Neutral frame — the look every existing group had before tinting existed. */
const NEUTRAL_BORDER = "#2D2D2D"

/** NODE_COLORS carries 8-digit (alpha) entries for the bright brand hues. The
 *  frame wants that translucency, but the banner has to read as a solid block,
 *  so drop the alpha byte before painting it. */
function opaque(hex: string): string {
  return hex.length === 9 ? hex.slice(0, 7) : hex
}

/** Black or white banner text, whichever the tint can carry. The palette spans
 *  near-black navies and near-white pastels, so a fixed text colour is illegible
 *  on one end of it. */
function readableText(hex: string): string {
  const c = hex.replace("#", "").slice(0, 6)
  if (c.length !== 6) return "#ffffff"
  const n = parseInt(c, 16)
  const luma = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return luma > 150 ? "#0f172a" : "#ffffff"
}

function GroupNodeComponent({ id, data, selected, height }: NodeProps) {
  const t = useT()
  const nodeData = data as GroupNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const [editing, setEditing] = useState(false)
  const [labelDraft, setLabelDraft] = useState(nodeData.label)
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  // A tinted group reads as a titled section: the frame carries a wash of the
  // colour and the label sits above it as a solid banner in the same colour.
  // Untinted groups keep the original neutral frame and quiet label exactly.
  const tint = nodeData.color ? opaque(getEffectiveColor(nodeData.color, isDark)) : null
  const frameStyle = tint
    ? {
        backgroundColor: `${tint}${isDark ? "1f" : "40"}`,
        borderColor: adjustColor(tint, isDark ? 45 : -45),
      }
    : undefined
  // A frame is a canvas-scale object — thousands of units tall is normal — and
  // it is read at fit-to-view zoom, where a fixed 15px title shrinks to an
  // unreadable smudge. Scale the banner off the frame so the title stays legible
  // at the zoom the frame is actually seen at. The untinted caption, which sits
  // beside ordinary nodes, keeps its fixed size.
  const bannerFont = Math.min(120, Math.max(15, (height ?? 400) * 0.045))
  const bannerStyle = tint
    ? {
        backgroundColor: tint,
        color: readableText(tint),
        fontSize: `${bannerFont}px`,
        gap: `${bannerFont * 0.4}px`,
        padding: `${bannerFont * 0.26}px ${bannerFont * 0.55}px`,
        borderRadius: `${bannerFont * 0.22}px ${bannerFont * 0.22}px 0 0`,
      }
    : undefined

  // computeGroupBuckets traverses this group's children (their parentId,
  // type, position.y and output values). Subscribing to the whole `s.nodes`
  // array re-rendered the group on every unrelated mutation. Instead derive a
  // PRIMITIVE fingerprint that changes only when a child's membership /
  // ordering / output actually changes (plus outgoing edges' source handles —
  // they keep edge-referenced lanes alive); the heavy bucket computation
  // reads live nodes from getState() keyed on that fingerprint.
  const childFingerprint = useWorkflowStore(
    useShallow((s) => {
      let fp = ""
      for (const n of s.nodes) {
        if (n.parentId !== id) continue
        fp += `${n.id}\x01${n.type ?? ""}\x01${n.position?.y ?? 0}\x01${JSON.stringify(n.data ?? {})}\x02`
      }
      for (const e of s.edges) {
        if (e.source === id) fp += `out:${e.id}\x01${e.sourceHandle ?? ""}\x02`
      }
      return fp
    }),
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const types = useMemo(() => {
    const { nodes, edges } = useWorkflowStore.getState()
    const node = (nodes as WorkflowNode[]).find((n) => n.id === id)
    const buckets = node
      ? computeGroupBuckets(node, nodes as WorkflowNode[])
      : { text: [], image: [], video: [], audio: [] }
    // Lanes exist as soon as a member of that type is INSIDE the frame —
    // buckets alone only fill after results exist, which left pre-run groups
    // with zero source pips (nothing to drag from, pre-authored edges
    // invisible). Mirrors collect-node's derivation via computeAggregateLanes.
    const memberTypes: AggregateableType[] = []
    for (const n of nodes as WorkflowNode[]) {
      if (n.parentId !== id) continue
      const t = getOutputType(n.type)
      if (isAggregateableType(t)) memberTypes.push(t)
    }
    return computeAggregateLanes(id, memberTypes, buckets, edges)
  }, [id, childFingerprint])

  useStaleHandleCleanup(id, types)

  const commitLabel = useCallback(() => {
    const next = labelDraft.trim() || "New group"
    updateNodeData(id, { label: next })
    setEditing(false)
  }, [id, labelDraft, updateNodeData])

  const cancelLabel = useCallback(() => {
    setLabelDraft(nodeData.label)
    setEditing(false)
  }, [nodeData.label])

  const enterEditMode = useCallback(() => {
    setLabelDraft(nodeData.label)
    setEditing(true)
  }, [nodeData.label])

  return (
    <div
      className={`group-node relative rounded-lg border ${tint ? "" : "border-border bg-muted/30 dark:border-[#2D2D2D] dark:bg-[#1E1E1E]/40"}`}
      style={{ width: "100%", height: "100%", ...frameStyle }}
    >
      {/* Offset clears the banner when tinted, the caption when not. */}
      <NodeToolbar isVisible={!!selected} position={Position.Top} offset={tint ? bannerFont * 1.6 + 24 : 40}>
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5 shadow-lg dark:border-white/10 dark:bg-zinc-900">
          {/* Neutral (no tint) */}
          <div
            onClick={(e) => { e.stopPropagation(); updateNodeData(id, { color: undefined }) }}
            title={t("node.noColour")}
            className={`w-4 h-4 rounded-full cursor-pointer border-2 transition-transform hover:scale-110 ${!nodeData.color ? "border-foreground dark:border-white" : "border-foreground/15 dark:border-white/20"}`}
            style={{ backgroundColor: NEUTRAL_BORDER }}
          />
          {NODE_COLORS.map((c) => (
            <div
              key={c}
              onClick={(e) => { e.stopPropagation(); updateNodeData(id, { color: c }) }}
              className={`w-4 h-4 rounded-full cursor-pointer border-2 transition-transform hover:scale-110 ${nodeData.color === c ? "border-foreground dark:border-white" : "border-foreground/15 dark:border-white/20"}`}
              style={{ backgroundColor: getEffectiveColor(c, isDark) }}
            />
          ))}
        </div>
      </NodeToolbar>
      <NodeResizer
        isVisible={!!selected}
        minWidth={240}
        minHeight={160}
        lineClassName="!border-[#ff0073]"
        handleClassName="!w-2.5 !h-2.5 !bg-[#ff0073] !border-none !rounded-sm"
      />

      {/* Label above the node. Untinted it stays the quiet floating caption it
          has always been; tinted it becomes a solid banner flush against the
          top edge, so the frame + banner read as one titled section. */}
      <div
        data-testid="group-label"
        className={`absolute left-0 flex items-center max-w-full ${
          tint
            ? "bottom-full font-semibold"
            : "-top-6 gap-1.5 text-[12px] font-medium text-foreground/70 dark:text-white/70"
        } ${editing ? "nopan nodrag nowheel" : "select-none"}`}
        style={bannerStyle}
      >
        <Boxes
          className={tint ? "shrink-0" : "w-3.5 h-3.5 shrink-0"}
          style={tint ? { width: bannerFont, height: bannerFont } : undefined}
        />
        {editing ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            onBlur={commitLabel}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation()
                commitLabel()
              } else if (e.key === "Escape") {
                e.stopPropagation()
                cancelLabel()
              }
            }}
            style={tint ? { fontSize: `${bannerFont}px` } : undefined}
            className={`bg-white border border-border rounded-md px-2 py-0.5 text-foreground outline-none min-w-[8rem] focus:ring-1 focus:ring-[#ff0073]/40 focus:border-[#ff0073] dark:bg-zinc-900 dark:border-white/20 dark:text-white/90 ${tint ? "" : "max-w-[20rem] text-[12px]"}`}
          />
        ) : (
          <span
            className={`truncate cursor-text transition-colors ${tint ? "" : "hover:text-foreground dark:hover:text-white/90"}`}
            onDoubleClick={enterEditMode}
            onMouseDown={(e) => e.stopPropagation()}
            title={t("node.doubleClickToRename")}
          >
            {nodeData.label || t("node.newGroup")}
          </span>
        )}
      </div>

      {types.length === 0 && (
        <div className="empty-hint p-4 text-center text-xs text-muted-foreground">
          {t("node.dropNodesHere")}
        </div>
      )}

      {types.map((t, idx) => (
        <AggregateHandleIcon
          key={groupHandleId(t)}
          id={groupHandleId(t)}
          type={t}
          top={`${24 + idx * 30}px`}
        />
      ))}
    </div>
  )
}

export const GroupNode = memo(GroupNodeComponent)
