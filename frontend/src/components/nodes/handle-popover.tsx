"use client"

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useReactFlow } from "@xyflow/react"
import { Plus, Unlink2, Link2, Crosshair, Image as ImageIcon } from "lucide-react"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useHandleConnections, type HandleConnection } from "@/hooks/use-handle-connections"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getNodeThumbnailUrl, getNodePickerVisual } from "@/lib/node-thumbnail"
import { buildAdjacency, collectDescendants, isValidWorkflowConnection } from "@/lib/connection-validation"
import { optimizedImageUrl } from "@/lib/image"
import { getHandleConnectionLimit } from "@/lib/handle-limits"
import type { ReactNode } from "react"
import { NODE_DEF_MAP, type WorkflowNode } from "@/types/nodes"
import { cn } from "@/lib/utils"

const SENSOR_OPTIONS = { activationConstraint: { distance: 4 } } as const

interface HandlePopoverProps {
  readonly nodeId: string
  readonly handleId: string
  readonly direction: "source" | "target"
  readonly label: string
  readonly orderMatters?: boolean
  /** Predicate returning true when a source node TYPE is a valid upstream
   *  for this handle. Used to populate the "Optional" candidates list at
   *  the bottom of the popover. */
  readonly accepts?: (sourceNodeType: string) => boolean
  readonly onAddNew?: () => void
  readonly onClose?: () => void
}

interface EnrichedConnection extends HandleConnection {
  readonly thumbnailUrl: string | undefined
  readonly pickerVisual: ReactNode | undefined
}

interface CandidateNode {
  readonly nodeId: string
  readonly nodeLabel: string
  readonly nodeType: string
  readonly thumbnailUrl: string | undefined
  readonly pickerVisual: ReactNode | undefined
  /** Source's output handle id for target-direction popovers (always
   *  defined — filter rejects candidates without static outputs). For
   *  source-direction candidates this stays undefined; the connect path
   *  uses the candidate's `inputs[0]` instead. Narrowing the type to
   *  optional keeps the invariant visible to any future reader. */
  readonly outputHandle: string | undefined
}

/**
 * Popover content for a typed handle.
 *
 * Top section: connected nodes with thumbnails. Click the thumbnail to
 * jump-and-focus the upstream node; hover the thumbnail to see a larger
 * preview. Unlink button per row, plus a "Disconnect all" affordance in
 * the header when there are ≥2 connections. For order-sensitive handles
 * (`orderMatters`), rows are drag-to-reorder via @dnd-kit.
 *
 * Bottom section: grayed-out candidate nodes that are NOT yet connected
 * but pass the `accepts` predicate. Each row has a Connect button that
 * creates the edge on click. Skipped when no `accepts` was provided.
 */
export function HandlePopover({
  nodeId,
  handleId,
  direction,
  label,
  orderMatters,
  accepts,
  onAddNew,
  onClose,
}: HandlePopoverProps) {
  const connections = useHandleConnections(nodeId, handleId, direction)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const onConnect = useWorkflowStore((s) => s.onConnect)
  const { setCenter, getNode } = useReactFlow()
  const deleteEdge = useWorkflowStore((s) => s.deleteEdge)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const setHoveredEdgeId = useWorkflowStore((s) => s.setHoveredEdgeId)
  const reorderHandleEdges = useWorkflowStore((s) => s.reorderHandleEdges)
  const disconnectAllHandleEdges = useWorkflowStore((s) => s.disconnectAllHandleEdges)
  // Roving tabindex for sortable grips. When a user keyboard-reorders a
  // row, focus stays on the moved grip (React preserves DOM via key=
  // edgeId) — we move the tab-stop with it instead of having it return
  // to the array-index-0 grip. Initial value `null` means "no grip has
  // been focused yet"; first-row falls back to tabIndex=0 so Tab can
  // still enter the list cold.
  const [focusedGripEdgeId, setFocusedGripEdgeId] = useState<string | null>(null)

  // Clear any sticky hovered-edge highlight when the popover unmounts.
  // mouseleave doesn't fire on rows that unmount while the cursor is still
  // over them (e.g., user clicks Focus → onClose → popover unmounts) — so
  // without this cleanup the canvas edge stays pink forever.
  useEffect(() => {
    return () => setHoveredEdgeId(null)
  }, [setHoveredEdgeId])

  // Enrich connected rows with the upstream node's thumbnail URL (image
  // nodes) OR picker visual (parameter pickers).
  const enriched: EnrichedConnection[] = useMemo(() => {
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    return connections.map((c) => {
      const n = nodeById.get(c.otherNodeId)
      return {
        ...c,
        thumbnailUrl: getNodeThumbnailUrl(n),
        pickerVisual: getNodePickerVisual(n),
      }
    })
  }, [connections, nodes])

  // Candidate nodes: type-valid AND globally-valid, not yet connected on
  // this handle. No render cap — the popover scrolls within
  // `max-h-[420px]`, image thumbnails are served from CDN-resized
  // variants (~5KB each), and hover-previews are portaled on demand. If
  // real-world workflows ever cross thousands of candidates and start to
  // judder, add row virtualization (react-virtuoso) — a hard cap is the
  // wrong tool because it hides legitimate connect candidates.
  //
  // SOURCE-DIRECTION GATE: `accepts` is documented as "valid upstream
  // type for this handle" — a TARGET-direction semantic. Calling it on
  // candidate target types in source-direction would feed flipped args
  // into the wrong-direction predicate AND the global validator would
  // probe `inputs[0]` arbitrarily for multi-input candidates. Gate
  // source-direction so future source-direction popovers don't silently
  // inherit a broken filter contract — use drag-to-connect until a
  // direction-aware predicate is added.
  //
  // Performance: builds `nodeTypeMap` ONCE for O(1) type lookups inside
  // `isValidWorkflowConnection` calls — without it the validator would
  // do an O(N) `nodes.find` per candidate.
  //
  // Iteration order: REVERSE so newer nodes (appended at the end of the
  // store array) appear first — most-recently-created sources are far
  // more likely targets when the user is actively building.
  const { candidates, hasDynamicOutputCandidates } = useMemo(() => {
    if (!accepts || direction === "source") {
      return { candidates: [] as CandidateNode[], hasDynamicOutputCandidates: false }
    }
    const connectedIds = new Set(connections.map((c) => c.otherNodeId))
    const nodeTypeMap = new Map<string, string>()
    for (const n of nodes) {
      if (n.type) nodeTypeMap.set(n.id, n.type)
    }
    const nodeTypeById = (id: string) => nodeTypeMap.get(id)

    // Single O(V+E) descendant pass to filter every cycle-inducing
    // candidate at once — instead of running an N-element cycle BFS
    // inside isValidWorkflowConnection per candidate. Any node already
    // downstream of the consumer (`nodeId`) would close a cycle if used
    // as the source for a new edge into this handle.
    const adj = buildAdjacency(edges)
    const cycleInducingIds = collectDescendants(adj, nodeId)

    const rendered: CandidateNode[] = []
    let dynamicOutputs = false
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if (n.id === nodeId) continue                       // skip the consumer itself
      if (connectedIds.has(n.id)) continue                // already connected
      if (cycleInducingIds.has(n.id)) continue            // would create a cycle
      const t = (n.type ?? "") as string
      if (!t || !accepts(t)) continue                     // type-incompatible
      const def = NODE_DEF_MAP.get(t as never)
      // Dynamic-output types (list/loop, outputs:[]) don't have a static
      // handle id the Connect button can wire to — drag-to-connect handles
      // them natively via runtime col_<uuid> handles. Flag that they EXIST
      // so the hint can mention them, but don't render a row.
      const outputHandle = def?.outputs?.[0]
      if (!outputHandle) {
        if (def && (!def.outputs || def.outputs.length === 0)) dynamicOutputs = true
        continue
      }
      // GLOBAL connection rules (json→media, composition→render-video) —
      // `accepts` is per-handle; this is what workflow-canvas runs during
      // drag-to-connect. Without this, a future HandleWithPopover with a
      // looser `accepts` predicate could silently wire an invalid edge.
      // Pass `undefined` for the graph since cycle filtering already
      // happened above — re-running per candidate would be O(N×(V+E)).
      const wouldBeConnection = {
        source: n.id,
        sourceHandle: outputHandle,
        target: nodeId,
        targetHandle: handleId,
      }
      if (!isValidWorkflowConnection(wouldBeConnection, nodeTypeById)) continue
      rendered.push({
        nodeId: n.id,
        nodeLabel: ((n.data as { label?: string } | undefined)?.label ?? t) as string,
        nodeType: t,
        thumbnailUrl: getNodeThumbnailUrl(n),
        pickerVisual: getNodePickerVisual(n),
        outputHandle,
      })
    }
    return { candidates: rendered, hasDynamicOutputCandidates: dynamicOutputs }
  }, [accepts, connections, nodes, edges, nodeId, handleId, direction])

  const handleJump = useCallback(
    (otherNodeId: string) => {
      const target = getNode(otherNodeId)
      if (!target) return
      const w = (target.measured?.width ?? 200) as number
      const h = (target.measured?.height ?? 150) as number
      setCenter(target.position.x + w / 2, target.position.y + h / 2, { zoom: 1, duration: 400 })
      selectNode(otherNodeId)
      onClose?.()
    },
    [getNode, setCenter, selectNode, onClose],
  )

  const handleDisconnectAll = useCallback(() => {
    disconnectAllHandleEdges(nodeId, handleId, direction)
  }, [disconnectAllHandleEdges, nodeId, handleId, direction])

  const handleConnectCandidate = useCallback(
    (cand: CandidateNode) => {
      // Source-direction popovers are gated out of candidate enumeration
      // (see the `direction === "source"` early return in the candidates
      // useMemo). If a candidate reaches here, direction is "target" and
      // `cand.outputHandle` is guaranteed defined by the filter.
      if (!cand.outputHandle) return
      onConnect({
        source: cand.nodeId,
        sourceHandle: cand.outputHandle,
        target: nodeId,
        targetHandle: handleId,
      })
    },
    [onConnect, nodeId, handleId],
  )

  // DnD sensors — small distance threshold so quick clicks on inner buttons
  // / thumbnails don't accidentally start a drag. Options literal hoisted
  // (`SENSOR_OPTIONS`) so its identity is stable across renders — otherwise
  // useSensor's deps bust on every parent render and DndContext re-renders.
  // KeyboardSensor + sortableKeyboardCoordinates pairs with the activator
  // ref on the grip span (see SortableConnectionRow) so keyboard users can
  // tab to a grip, press Space/Enter to pick up, then arrow up/down to
  // reorder and Space/Enter to drop.
  const sensors = useSensors(
    useSensor(PointerSensor, SENSOR_OPTIONS),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e
      if (!over || active.id === over.id) return
      const from = enriched.findIndex((c) => c.edgeId === active.id)
      const to = enriched.findIndex((c) => c.edgeId === over.id)
      if (from < 0 || to < 0) return
      reorderHandleEdges(nodeId, handleId, direction, from, to)
    },
    [enriched, reorderHandleEdges, nodeId, handleId, direction],
  )

  // Model-effective limit for this (consumer, handle) pair — e.g.,
  // generate-image's `references` handle is capped at the selected
  // provider's max (REF_IMAGE_MAX_LIMITS). Connections past `limit` are
  // still wired in the workflow but the runtime silently drops them — we
  // surface that in the count label and gray out overflow rows so the
  // user can see (and reorder) which refs will actually be used.
  const consumerNode = getNode(nodeId)
  const handleLimit = direction === "target"
    ? getHandleConnectionLimit(consumerNode as WorkflowNode | undefined, handleId)
    : null
  const overflowFrom = handleLimit && enriched.length > handleLimit.limit ? handleLimit.limit : null
  const countLabel = enriched.length === 0
    ? "Nothing connected"
    : handleLimit
      ? `${enriched.length} of ${handleLimit.limit} max`
      : `${enriched.length} connected`

  const showCandidates = candidates.length > 0

  // Boundary stopPropagation: when the popover sits visually over a canvas
  // node, an unbounded click can bubble through React's delegated event
  // system and select the underlying node. Only stop CLICK / MOUSEDOWN —
  // POINTER events are left alone so @dnd-kit's sortable drag-tracking
  // (which uses pointerdown/move/up under the hood) still works correctly.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return (
    <div
      className="min-w-[280px] max-w-[340px] max-h-[420px] overflow-y-auto"
      onClick={stop}
      onMouseDown={stop}
    >
        <div className="px-1 pb-2 flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-foreground truncate">{label}</div>
            <div className="text-[10px] text-muted-foreground">{countLabel}</div>
          </div>
          <div className="flex items-center gap-0.5">
            {onAddNew && (
              <button
                type="button"
                aria-label="Add new node"
                title="Add new node"
                className="px-2 py-1 rounded hover:bg-accent text-xs font-medium flex items-center gap-1"
                onClick={() => {
                  onAddNew()
                  onClose?.()
                }}
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            )}
            {enriched.length > 1 && (
              <button
                type="button"
                aria-label="Disconnect all"
                title="Disconnect all"
                className="p-1 rounded hover:bg-accent hover:text-destructive opacity-70 hover:opacity-100"
                onClick={handleDisconnectAll}
              >
                <Unlink2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {enriched.length > 0 && (
          // Only render the sortable + drag-handle UI when ordering matters
          // AND there's more than one row to reorder. A single connection
          // can't be reordered, so the drag affordance is meaningless.
          orderMatters && enriched.length > 1 ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={enriched.map((c) => c.edgeId)} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col gap-0.5">
                  {enriched.map((c, i) => (
                    <Fragment key={c.edgeId}>
                      {overflowFrom !== null && i === overflowFrom && (
                        <OverflowDivider providerLabel={handleLimit!.providerLabel} />
                      )}
                      <SortableConnectionRow
                        connection={c}
                        position={i + 1}
                        isTabStop={
                          focusedGripEdgeId === c.edgeId ||
                          (focusedGripEdgeId === null && i === 0)
                        }
                        isOverflow={overflowFrom !== null && i >= overflowFrom}
                        onGripFocus={setFocusedGripEdgeId}
                        onJump={() => handleJump(c.otherNodeId)}
                        onDisconnect={() => deleteEdge(c.edgeId)}
                        onHoverEdge={setHoveredEdgeId}
                      />
                    </Fragment>
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {enriched.map((c, i) => (
                <Fragment key={c.edgeId}>
                  {overflowFrom !== null && i === overflowFrom && (
                    <OverflowDivider providerLabel={handleLimit!.providerLabel} />
                  )}
                  <ConnectionRow
                    connection={c}
                    isOverflow={overflowFrom !== null && i >= overflowFrom}
                    onJump={() => handleJump(c.otherNodeId)}
                    onDisconnect={() => deleteEdge(c.edgeId)}
                    onHoverEdge={setHoveredEdgeId}
                  />
                </Fragment>
              ))}
            </ul>
          )
        )}

        {showCandidates && (
          <>
            {enriched.length > 0 && <div className="border-t border-border my-2" />}
            <div className="px-1.5 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Optional ({candidates.length})
            </div>
            <ul className="flex flex-col gap-0.5">
              {candidates.map((c) => (
                <CandidateRow
                  key={c.nodeId}
                  candidate={c}
                  onJump={() => handleJump(c.nodeId)}
                  onConnect={() => handleConnectCandidate(c)}
                />
              ))}
            </ul>
            {hasDynamicOutputCandidates && (
              <div className="px-1.5 pt-1.5 text-[10px] text-muted-foreground/70 italic">
                Drag from list/loop nodes for column outputs.
              </div>
            )}
          </>
        )}
    </div>
  )
}

// ─── Row components ─────────────────────────────────────────────────────────

interface ConnectionRowProps {
  readonly connection: EnrichedConnection
  readonly onJump: () => void
  readonly onDisconnect: () => void
  readonly onHoverEdge: (edgeId: string | null) => void
  /** When sortable, the parent supplies the grip element (with the dnd-kit
   *  listeners). Putting the listeners ONLY on a dedicated handle — not the
   *  whole row — keeps thumbnail clicks routed correctly: spreading
   *  pointer-down listeners on the whole row causes `preventDefault` to
   *  re-route synthetic click events away from inner buttons. */
  readonly dragHandle?: React.ReactNode
  /** True when this row sits past the consumer model's effective limit
   *  for the handle — the edge is still in the workflow, but the runtime
   *  silently drops it for the currently-selected model. We dim the row
   *  and add a hover hint so the user can reorder or switch models. */
  readonly isOverflow?: boolean
}

function ConnectionRow({ connection, onJump, onDisconnect, onHoverEdge, dragHandle, isOverflow }: ConnectionRowProps) {
  return (
    <li
      className={cn(
        "group flex items-center gap-2 px-1.5 py-1 text-xs rounded hover:bg-accent",
        isOverflow && "opacity-50",
      )}
      title={isOverflow ? "Past model's max — won't be used by the current model. Reorder above or switch model to include." : undefined}
      onMouseEnter={() => onHoverEdge(connection.edgeId)}
      onMouseLeave={() => onHoverEdge(null)}
    >
      {dragHandle}
      <ThumbnailButton
        thumbnailUrl={connection.thumbnailUrl}
        pickerVisual={connection.pickerVisual}
        label={connection.otherNodeLabel}
        onJump={onJump}
      />
      <div className="flex-1 min-w-0">
        <div className="truncate text-foreground" title={connection.otherNodeLabel}>
          {connection.otherNodeLabel}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">{connection.otherNodeType}</div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          aria-label={`Focus ${connection.otherNodeLabel}`}
          title="Focus"
          className="p-1 hover:bg-background rounded"
          onClick={(e) => {
            e.stopPropagation()
            onJump()
          }}
        >
          <Crosshair className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Disconnect ${connection.otherNodeLabel}`}
          title="Disconnect"
          className="p-1 hover:bg-background hover:text-destructive rounded"
          onClick={(e) => {
            e.stopPropagation()
            onDisconnect()
          }}
        >
          <Unlink2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  )
}

function SortableConnectionRow(
  props: ConnectionRowProps & {
    position: number
    isTabStop: boolean
    onGripFocus: (edgeId: string) => void
  },
) {
  const { position, isTabStop, onGripFocus, ...rowProps } = props
  // `rowProps` already includes `isOverflow` via ConnectionRowProps spread.
  const edgeId = props.connection.edgeId
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: edgeId })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <ConnectionRow
        {...rowProps}
        dragHandle={
          // The grip carries BOTH the dnd-kit listeners AND the
          // accessibility attributes — that pairs the announceable
          // `role=button` + aria-roledescription="draggable" with the
          // element that actually responds to Space/Enter activation.
          // `setActivatorNodeRef` tells the KeyboardSensor which element
          // is the keyboard activator (lets focus stay on the grip after
          // pickup so arrow keys move the row).
          //
          // ROVING TABINDEX: exactly one grip in the list is tab-stoppable
          // at a time, and the tab-stop FOLLOWS focus rather than being
          // pinned to index 0. After a keyboard reorder (React preserves
          // DOM identity via key=edgeId so focus stays on the moved grip),
          // that grip keeps tabIndex=0 instead of dropping to -1. Without
          // this, the user would lose tab-entry to the row they just
          // moved.
          //
          // PROP ORDER: spread `attributes` FIRST so our explicit
          // `aria-label` (with the position number) wins over any future
          // generic aria-label dnd-kit might ship in attributes.
          <span
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            tabIndex={isTabStop ? 0 : -1}
            onFocus={() => onGripFocus(edgeId)}
            aria-label={`Drag to reorder (position ${position})`}
            className="flex items-center gap-0.5 text-[10px] leading-none text-muted-foreground/60 group-hover:text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing select-none px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 rounded"
          >
            <span className="font-medium tabular-nums">{position}</span>
            <span aria-hidden className="opacity-60">⋮⋮</span>
          </span>
        }
      />
    </div>
  )
}

interface CandidateRowProps {
  readonly candidate: CandidateNode
  readonly onJump: () => void
  readonly onConnect: () => void
}

function CandidateRow({ candidate, onJump, onConnect }: CandidateRowProps) {
  return (
    <li className="group flex items-center gap-2 px-1.5 py-1 text-xs rounded hover:bg-accent/60 opacity-60 hover:opacity-100 transition-opacity">
      <ThumbnailButton
        thumbnailUrl={candidate.thumbnailUrl}
        pickerVisual={candidate.pickerVisual}
        label={candidate.nodeLabel}
        onJump={onJump}
      />
      <div className="flex-1 min-w-0">
        <div className="truncate text-foreground" title={candidate.nodeLabel}>
          {candidate.nodeLabel}
        </div>
        <div className="text-[10px] text-muted-foreground truncate">{candidate.nodeType}</div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          aria-label={`Focus ${candidate.nodeLabel}`}
          title="Focus"
          className="p-1 hover:bg-background rounded"
          onClick={(e) => {
            e.stopPropagation()
            onJump()
          }}
        >
          <Crosshair className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Connect ${candidate.nodeLabel}`}
          title="Connect"
          className="p-1 hover:bg-background hover:text-primary rounded"
          onClick={(e) => {
            e.stopPropagation()
            onConnect()
          }}
        >
          <Link2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  )
}

// ─── Model-max overflow divider ────────────────────────────────────────────

function OverflowDivider({ providerLabel }: { providerLabel: string }) {
  return (
    <li
      aria-hidden
      className="pointer-events-none px-1.5 py-1 text-[9.5px] uppercase tracking-wide text-muted-foreground/60 border-t border-dashed border-border/70 mt-1"
    >
      Beyond {providerLabel}'s max — won't be used
    </li>
  )
}

// ─── Thumbnail w/ hover-preview + click-to-jump ────────────────────────────

function ThumbnailButton({
  thumbnailUrl,
  pickerVisual,
  label,
  onJump,
}: {
  thumbnailUrl: string | undefined
  pickerVisual: ReactNode | undefined
  label: string
  onJump: () => void
}) {
  // Preview only shows while the cursor is OVER the thumbnail itself; moving
  // anywhere else (including over the preview image — it's pointer-events-none)
  // hides it. The preview is portaled to document.body and positioned with
  // `fixed` so it escapes any ancestor `overflow: auto` clipping (e.g., the
  // popover scroll container when the row is near the bottom of the list).
  const [previewAnchor, setPreviewAnchor] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // The popover wrapper has its own overflow-y-auto. If the user scrolls
  // within the popover (or the window resizes) while a preview is showing,
  // the captured anchor.top/left drifts and the preview floats over the
  // wrong row. Install document-wide scroll (capture phase catches any
  // ancestor scroll container) + window resize listeners while the preview
  // is up; tear them down on hide. Listener identity is stable across
  // re-renders so we don't churn add/removeEventListener every frame.
  useEffect(() => {
    if (!previewAnchor) return
    const update = () => {
      const rect = btnRef.current?.getBoundingClientRect()
      if (rect) setPreviewAnchor(rect)
    }
    document.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      document.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
    // Run once on open / once on close — we don't want to reinstall the
    // listener on every rect mutation, which is why we depend on the
    // "is the preview open?" boolean rather than the rect itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewAnchor === null])
  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        aria-label={`Focus ${label}`}
        title="Click to focus"
        className={cn(
          "w-8 h-8 rounded overflow-hidden bg-muted flex items-center justify-center",
          "ring-0 hover:ring-2 hover:ring-primary/60 transition-shadow cursor-pointer",
        )}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onJump()
        }}
        onMouseEnter={() => {
          // Only show preview when there's actual visual content to preview.
          if (!thumbnailUrl && !pickerVisual) return
          const rect = btnRef.current?.getBoundingClientRect()
          if (rect) setPreviewAnchor(rect)
        }}
        onMouseLeave={() => setPreviewAnchor(null)}
      >
        {thumbnailUrl ? (
          // Cloudflare image-resize transform for cdn.nodaro.ai URLs.
          // Logical 32px × 3 (retina) = 96px wide variant; pass-through
          // for non-R2 URLs (e.g., http(s) uploads still hosted directly).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={optimizedImageUrl(thumbnailUrl, { width: 96, quality: 80 })}
            alt=""
            className="w-full h-full object-cover pointer-events-none"
          />
        ) : pickerVisual ? (
          <div className="w-full h-full pointer-events-none flex items-center justify-center [&>*]:max-w-full [&>*]:max-h-full">
            {pickerVisual}
          </div>
        ) : (
          <ImageIcon className="w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
        )}
      </button>
      {previewAnchor && (thumbnailUrl || pickerVisual) && typeof document !== "undefined" &&
        createPortal(
          <ThumbnailPreview anchor={previewAnchor} url={thumbnailUrl} pickerVisual={pickerVisual} alt={label} />,
          document.body,
        )}
    </div>
  )
}

function ThumbnailPreview({
  anchor,
  url,
  pickerVisual,
  alt,
}: {
  anchor: DOMRect
  url: string | undefined
  pickerVisual: ReactNode | undefined
  alt: string
}) {
  // Render to the right of the thumbnail by default; flip to the left if
  // there isn't enough room before the viewport edge. Clamp vertically so
  // tall previews stay on screen. Renders either an image (for media nodes)
  // or the picker's in-node visual scaled up (for parameter pickers).
  const PREVIEW_MAX = 240
  const GAP = 8
  const fitsRight = anchor.right + GAP + PREVIEW_MAX <= window.innerWidth
  const left = fitsRight ? anchor.right + GAP : Math.max(8, anchor.left - GAP - PREVIEW_MAX)
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - PREVIEW_MAX - 8))
  return (
    <div
      className="fixed pointer-events-none z-[9999] bg-popover border border-border shadow-lg rounded p-1"
      style={{ left, top }}
    >
      {url ? (
        // Cloudflare image-resize transform for cdn.nodaro.ai URLs.
        // Logical 240px max × 2 (retina) = 480px wide variant; pass-through
        // for non-R2 URLs. Quality 85 (slight bump over thumb's 80) for the
        // larger preview surface.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={optimizedImageUrl(url, { width: 480, quality: 85 })}
          alt={alt}
          className="rounded object-contain block"
          style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
        />
      ) : pickerVisual ? (
        <div
          className="flex items-center justify-center [&>*]:max-w-full [&>*]:max-h-full"
          style={{ width: PREVIEW_MAX, height: PREVIEW_MAX }}
        >
          {pickerVisual}
        </div>
      ) : null}
    </div>
  )
}
