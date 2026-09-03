"use client"

import { useT } from "@/lib/i18n"
import { memo, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Layers, Combine, Film, Music } from "lucide-react"
import {
  AGGREGATEABLE_TYPES,
  COLLECT_IN_HANDLE,
  groupHandleId,
  isCollectInEdge,
  type AggregateableType,
} from "@nodaro/shared"
import { useShallow } from "zustand/react/shallow"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useStaleHandleCleanup } from "@/hooks/use-stale-handle-cleanup"
import { AggregateHandleVisual } from "@/components/nodes/handle-icon"
import { HandleWithPopover, HANDLE_COLORS } from "@/components/nodes/handle-with-popover"
import { EditableNodeLabel } from "@/components/nodes/editable-node-label"
import { BaseNode, type HandleConfig } from "@/components/nodes/base-node"
import { CachedImage } from "@/components/ui/cached-image"
import { computeCollectBuckets } from "@/components/editor/workflow-editor/execution-graph"
import type { CollectNodeData, WorkflowNode, WorkflowEdge } from "@/types/nodes"

// Collect's output contract is FIXED: one lane pip per aggregateable type,
// always present. Deriving pips from wiring/results (any variant of it) means
// an empty Collect has nothing to drag outward from — which blocks the
// build-the-flow-first-run-later order of work — and lets edges point at
// handles that don't exist yet. A constant lane set makes wiring possible in
// any order and makes an invisible edge structurally impossible.
const ALL_LANES: AggregateableType[] = [...AGGREGATEABLE_TYPES]

function CollectNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as CollectNodeData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  // computeCollectBuckets reads this node's `data.order`, its incoming `in`
  // edges, and each upstream source's type + output value (which changes
  // during polling). Subscribing to whole `s.nodes` / `s.edges` re-rendered
  // the collect node on every unrelated mutation. Instead derive a PRIMITIVE
  // fingerprint (incoming edges + source type/data + this node's order) plus
  // the incoming count; the heavy bucket computation reads live arrays from
  // getState() keyed on the fingerprint.
  const { collectFingerprint, incomingCount } = useWorkflowStore(
    useShallow((s) => {
      const self = s.nodes.find((n) => n.id === id)
      const order = ((self?.data as { order?: string[] } | undefined)?.order) ?? []
      let fp = `order:${order.join(",")}\x03`
      let count = 0
      for (const e of s.edges) {
        if (e.target !== id || !isCollectInEdge(e)) continue
        count++
        const src = s.nodes.find((n) => n.id === e.source)
        fp += `${e.id}\x01${e.source}\x01${e.sourceHandle ?? ""}\x01${src?.type ?? ""}\x01${JSON.stringify(src?.data ?? {})}\x02`
      }
      return { collectFingerprint: fp, incomingCount: count }
    }),
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const buckets = useMemo(() => {
    const { nodes, edges } = useWorkflowStore.getState()
    const node = (nodes as WorkflowNode[]).find((n) => n.id === id)
    return node
      ? computeCollectBuckets(node, nodes as WorkflowNode[], edges as WorkflowEdge[])
      : { text: [], image: [], video: [], audio: [] }
  }, [id, collectFingerprint])
  const types = ALL_LANES

  useStaleHandleCleanup(id, types)

  // Functional handles live in BaseNode's `handles` array (hidden); the colored
  // circles are drawn separately as visual-only overlays at the same anchors.
  const handles = useMemo<ReadonlyArray<HandleConfig>>(
    () => [
      {
        id: COLLECT_IN_HANDLE,
        type: "target",
        position: Position.Left,
        customStyle: { top: "24px", left: "-29px" },
        external: true,
      },
      ...types.map((t, idx) => ({
        id: groupHandleId(t),
        type: "source" as const,
        position: Position.Right,
        hideHandle: true,
        customStyle: { top: `${24 + idx * 30}px`, right: "-29px" },
      })),
    ],
    [types],
  )

  const label = nodeData?.label || "Collect"
  const hasContent = types.some((t) => buckets[t].length > 0)

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={label}
        icon={<Layers className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={label}
        icon={<Layers className="h-4 w-4" />}
        category="processing"
        selected={selected}
        minWidth={180}
        hideHeader
        handles={handles}
      >
        {/* The body shows WHAT was collected, in bucket order — thumbnails
            for images, clamped lines for text, count chips for video/audio.
            Display-only: rendering reads already-produced upstream results
            and never executes anything. */}
        <div className="px-2 py-2 flex flex-col gap-1.5">
          {incomingCount === 0 ? (
            <div className="px-1 text-xs text-muted-foreground">{t("node.connectInputs")}</div>
          ) : !hasContent ? (
            <div className="px-1 text-xs text-muted-foreground">
              {t(incomingCount === 1 ? "node.connectionsWaitingOne" : "node.connectionsWaitingOther", { n: incomingCount })}
            </div>
          ) : (
            <>
              {buckets.image.length > 0 && (
                <div className="grid grid-cols-3 gap-1">
                  {buckets.image.map((url, i) => (
                    <CachedImage
                      key={`${i}-${url}`}
                      src={url}
                      alt=""
                      className="w-full aspect-square object-cover rounded-md"
                    />
                  ))}
                </div>
              )}
              {buckets.text.length > 0 && (
                <div className="flex flex-col gap-1">
                  {buckets.text.slice(0, 3).map((t, i) => (
                    <div
                      key={i}
                      className="px-1 text-[10px] leading-snug text-foreground/75"
                      style={{
                        display: "-webkit-box",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: 2,
                        overflow: "hidden",
                        wordBreak: "break-word",
                      }}
                    >
                      {t}
                    </div>
                  ))}
                  {buckets.text.length > 3 && (
                    <div className="px-1 text-[9px] text-muted-foreground">
                      +{buckets.text.length - 3} more
                    </div>
                  )}
                </div>
              )}
              {buckets.video.length > 0 && (
                <div className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                  <Film className="w-3 h-3" />
                  {buckets.video.length} video{buckets.video.length === 1 ? "" : "s"}
                </div>
              )}
              {buckets.audio.length > 0 && (
                <div className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                  <Music className="w-3 h-3" />
                  {buckets.audio.length} audio
                </div>
              )}
              <div className="px-1 text-[9px] text-muted-foreground/60">
                {incomingCount} connection{incomingCount === 1 ? "" : "s"}
              </div>
            </>
          )}
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="collect" handleId={COLLECT_IN_HANDLE} type="target" position={Position.Left} label="Inputs" color={HANDLE_COLORS.control} icon={<Combine />} side="left" top="24px" />
      {types.map((t, idx) => (
        <AggregateHandleVisual
          key={groupHandleId(t)}
          type={t}
          top={`${24 + idx * 30}px`}
          side="right"
        />
      ))}
    </div>
  )
}

export const CollectNode = memo(CollectNodeComponent)

// Re-export the data type for convenience.
export type { CollectNodeData }
