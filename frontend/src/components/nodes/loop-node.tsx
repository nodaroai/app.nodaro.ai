"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { ArrowUpRight, Copy, Download, Expand, Film, GripVertical, Image, Info, Link, List, Loader2, Music, Plus, Repeat, Table2, Type, Upload, X } from "lucide-react"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { LOOP_COLUMN_TYPE_META, LOOP_COL_ADD_HANDLE, TEXT_CELL_CONTROLS_MIN_LINES, TEXT_CELL_DEFAULT_MAX_LINES, loopColBaseHandle, loopColInputHandle, resolveViewMode, textCellMaxHeightPx, type LoopNodeData, type LoopColumn, type WorkflowNode } from "@/types/nodes"
import { CachedImage } from "@/components/ui/cached-image"
import { useFileUpload } from "@/hooks/use-file-upload"
import { StorageExceededModal } from "@/components/credits/StorageExceededModal"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { copyToClipboard } from "@/lib/utils"
import { resolveEdgeValuesForTableColumn } from "@/components/editor/workflow-editor/node-input-resolver"

const HANDLE_COLOR_MAP: Record<string, "pink" | "indigo" | "green" | "cyan"> = {
  "image-url": "pink",
  "video-url": "indigo",
  "audio-url": "green",
  "text": "cyan",
}

const COLUMN_TYPE_ICON: Record<string, React.ReactElement> = {
  "image-url": <Image />,
  "video-url": <Film />,
  "audio-url": <Music />,
  text: <Type />,
}

const DEFAULT_GALLERY_COLS = 3

const THUMB_SIZE_CONFIG = {
  sm: { px: 24, maxWidth: 220, imgClass: "w-6 h-6" },
  md: { px: 48, maxWidth: 280, imgClass: "w-12 h-12" },
  lg: { px: 80, maxWidth: 400, imgClass: "w-20 h-20" },
} as const

const PACKED_MIN_BY_TYPE: Record<string, number> = {
  "image-url": 60,
  "video-url": 80,
  "audio-url": 220,
  "text":      100,
}
const PACKED_CONTAINER_W = 376
const PACKED_CONTAINER_H = 400
const PACKED_GAP = 4

export function packedMin(columns: ReadonlyArray<LoopColumn>): number {
  if (columns.length === 0) return 100
  return Math.max(...columns.map(c => PACKED_MIN_BY_TYPE[c.type ?? "text"]))
}

export function computePackedLayout(opts: {
  count: number
  min: number
  hint?: number
}): { tileSize: number; cols: number; rows: number; overflow: boolean } {
  const { count, min, hint } = opts
  const W = PACKED_CONTAINER_W
  const H = PACKED_CONTAINER_H
  const gap = PACKED_GAP

  const idealCols = Math.max(
    1,
    hint ?? Math.round(Math.sqrt(count * W / H))
  )
  const candidateW = Math.floor((W - gap * (idealCols - 1)) / idealCols)
  const tileSize = Math.max(min, candidateW)
  const cols = Math.max(1, Math.floor((W + gap) / (tileSize + gap)))
  const rows = Math.ceil(count / cols)
  const totalH = rows * tileSize + (rows - 1) * gap
  return { tileSize, cols, rows, overflow: totalH > H }
}

function buildHandles(columns: ReadonlyArray<LoopColumn>) {
  type HandleDef = {
    id: string
    type: "source" | "target"
    position: typeof Position.Left | typeof Position.Right
    top?: string
    customStyle: Record<string, string>
    hideHandle: boolean
  }

  // Quick-add target handle — always present at top
  const quickAdd: HandleDef = {
    id: LOOP_COL_ADD_HANDLE,
    type: "target" as const,
    position: Position.Left,
    top: "15%",
    customStyle: { top: '15%', left: '-29px' },
    hideHandle: true,
  }

  if (columns.length === 0) {
    return [quickAdd]
  }

  const startPct = 30
  const endPct = 80
  const handles: HandleDef[] = [quickAdd]

  columns.forEach((col, i) => {
    const pct = columns.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (columns.length - 1)) * (endPct - startPct))

    // Per-column target handle (left side)
    handles.push({
      id: `${col.handleId}_in`,
      type: "target" as const,
      position: Position.Left,
      top: `${pct}%`,
      customStyle: { top: `${pct}%`, left: '-29px' },
      hideHandle: true,
    })

    // Per-column source handle (right side) — existing behavior
    handles.push({
      id: col.handleId,
      type: "source" as const,
      position: Position.Right,
      top: `${pct}%`,
      customStyle: { top: `${pct}%`, right: '-29px' },
      hideHandle: true,
    })
  })

  return handles
}

function SortableNodeRow({
  id,
  children,
  onRemove,
}: {
  id: string
  children: React.ReactNode
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-1.5">
      <div
        {...attributes}
        {...listeners}
        className="nodrag nopan shrink-0 mt-2 text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        {children}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        className="nodrag nopan shrink-0 mt-2 text-muted-foreground/30 hover:text-red-400 transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function LoopNodeComponent({ id, data, selected, type }: NodeProps) {
  const nodeData = data as LoopNodeData
  const isList = type === "list"
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const edges = useWorkflowStore((s) => s.edges)
  const nodes = useWorkflowStore((s) => s.nodes)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNodeInternals = useUpdateNodeInternals()
  const status = (nodeData as Record<string, unknown>).executionStatus as string | undefined ?? "idle"

  // Migrate legacy list data (items string → columns + rows)
  useEffect(() => {
    if (!isList) return
    const d = data as Record<string, unknown>
    if (typeof d.items === "string" && !d.columns) {
      const items = (d.items as string).split("\n").filter((l: string) => l.trim() !== "").map((l: string) => l.trim())
      const colId = crypto.randomUUID()
      const col: LoopColumn = { id: colId, name: "Items", handleId: `col_${colId}`, type: "text" }
      updateNodeData(id, { columns: [col], rows: items.map((item) => [item]), items: undefined })
    } else if (!d.columns) {
      const colId = crypto.randomUUID()
      const col: LoopColumn = { id: colId, name: "Items", handleId: `col_${colId}`, type: "text" }
      updateNodeData(id, { columns: [col], rows: [[""]] })
    }
  }, [isList, id]) // eslint-disable-line react-hooks/exhaustive-deps
  const showData = !!(nodeData as Record<string, unknown>).showData
  const setShowData = useCallback((v: boolean) => updateNodeData(id, { showData: v }), [id, updateNodeData])

  const thumbSize = nodeData.thumbnailSize ?? "md"
  const sizeConfig = THUMB_SIZE_CONFIG[thumbSize]
  const textMaxLines = Math.max(1, nodeData.textMaxLines ?? TEXT_CELL_DEFAULT_MAX_LINES)
  const showCellControls = textMaxLines >= TEXT_CELL_CONTROLS_MIN_LINES
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  const { upload, storageExceeded, clearStorageExceeded } = useFileUpload()
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploadingRows, setUploadingRows] = useState<Set<number>>(new Set())
  const [resizingCol, setResizingCol] = useState<{ colIdx: number; startX: number; startWidth: number } | null>(null)
  const [dragColWidth, setDragColWidth] = useState<{ colIdx: number; width: number } | null>(null)
  const fileInputRef = useRef<{ rowIdx: number; colIdx: number } | null>(null)
  const hiddenFileRef = useRef<HTMLInputElement>(null)

  const columns = nodeData.columns ?? []
  const handles = useMemo(() => buildHandles(columns), [columns])

  const targetHandleIds = useMemo(
    () => new Set(handles.filter(h => h.type === "target").map(h => h.id)),
    [handles],
  )

  const hasUpstreamInput = useMemo(
    () => edges.some((e) => e.target === id && e.targetHandle && targetHandleIds.has(e.targetHandle)),
    [edges, id, targetHandleIds],
  )

  /** Resolve rows from connected upstream nodes — respects edge outputMode, selector, and useAllResults. */
  const connectedRows = useMemo<string[][] | null>(() => {
    if (columns.length === 0) return null

    const colValues: (string[] | null)[] = columns.map((col) => {
      const colInEdges = edges.filter(
        (e) => e.target === id && e.targetHandle === loopColInputHandle(col.handleId),
      )
      if (colInEdges.length === 0) return null
      const allValues: string[] = []
      for (const edge of colInEdges) {
        const upstream = nodes.find((n) => n.id === edge.source)
        if (!upstream) continue
        const vals = resolveEdgeValuesForTableColumn(edge, upstream, edges, nodes, columns)
        if (vals) allValues.push(...vals)
      }
      return allValues.length > 0 ? allValues : null
    })

    const legacyEdge = edges.find((e) => e.target === id && e.targetHandle === "in")
    let legacyValues: string[] | null = null
    if (legacyEdge) {
      const upstream = nodes.find((n) => n.id === legacyEdge.source)
      if (upstream) {
        legacyValues = resolveEdgeValuesForTableColumn(legacyEdge, upstream, edges, nodes, columns)
      }
    }

    if (!colValues.some((d) => d !== null) && !legacyValues) return null

    const maxRows = Math.max(
      ...colValues.map((d) => d?.length ?? 0),
      legacyValues?.length ?? 0,
    )
    const result: string[][] = []
    for (let r = 0; r < maxRows; r++) {
      result.push(
        columns.map((_col, ci) => {
          if (colValues[ci]) return colValues[ci]![r] ?? ""
          if (legacyValues) return legacyValues[r] ?? ""
          return ""
        }),
      )
    }
    return result
  }, [id, columns, edges, nodes])

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, columns.length, updateNodeInternals])

  useEffect(() => {
    if (!resizingCol) return

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      e.stopPropagation()
      const delta = e.clientX - resizingCol.startX
      const newWidth = Math.max(40, resizingCol.startWidth + delta)
      // Track width in local state during drag (avoid store write per pixel)
      setDragColWidth({ colIdx: resizingCol.colIdx, width: newWidth })
    }

    const handleMouseUp = () => {
      // Commit final width to store only on release
      setDragColWidth((current) => {
        if (current) {
          const updatedCols = columns.map((col, i) =>
            i === current.colIdx ? { ...col, width: current.width } : col
          )
          updateNodeData(id, { columns: updatedCols })
        }
        return null
      })
      setResizingCol(null)
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [resizingCol, columns, id, updateNodeData])

  // Effective column width: use drag-in-progress width during resize, otherwise persisted width
  const getColWidth = useCallback((colIdx: number, col: LoopColumn) => {
    if (dragColWidth && dragColWidth.colIdx === colIdx) return dragColWidth.width
    return col.width
  }, [dragColWidth])

  const rows = nodeData.rows ?? []
  const rowCount = rows.length
  const colCount = nodeData.columns?.length ?? 0

  const displayRows = connectedRows ?? rows
  const displayRowCount = displayRows.length
  const isConnectedData = connectedRows !== null

  const firstImageColIdx = columns.findIndex((c) => c.type === "image-url")
  const maxItems = nodeData.maxItems ?? 20

  const addImageFiles = useCallback(async (files: File[]) => {
    if (firstImageColIdx < 0 || uploadingRows.size > 0) return
    const imageFiles = files.filter((f) => f.type.startsWith("image/"))
    if (imageFiles.length === 0) return

    let latestRows = [...(nodeData.rows ?? [])]
    const newRowIndices: number[] = []
    for (const file of imageFiles) {
      if (latestRows.length >= maxItems) break
      const newRow = columns.map(() => "")
      latestRows.push(newRow)
      newRowIndices.push(latestRows.length - 1)
    }
    updateNodeData(id, { rows: latestRows })

    for (let i = 0; i < newRowIndices.length; i++) {
      const rowIdx = newRowIndices[i]
      setUploadingRows((prev) => new Set(prev).add(rowIdx))
      try {
        const result = await upload(imageFiles[i])
        latestRows = latestRows.map((row, ri) =>
          ri === rowIdx ? row.map((cell, ci) => ci === firstImageColIdx ? result.url : cell) : row
        )
        updateNodeData(id, { rows: latestRows })
      } catch {
        // Error handled by useFileUpload
      } finally {
        setUploadingRows((prev) => {
          const next = new Set(prev)
          next.delete(rowIdx)
          return next
        })
      }
    }
  }, [id, columns, nodeData.rows, firstImageColIdx, maxItems, updateNodeData, upload, uploadingRows.size])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    addImageFiles(Array.from(e.dataTransfer.files))
  }, [addImageFiles])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation()
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleCellFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !fileInputRef.current) return
    const { rowIdx, colIdx } = fileInputRef.current

    setUploadingRows((prev) => new Set(prev).add(rowIdx))
    try {
      const result = await upload(file)
      updateNodeData(id, {
        rows: (nodeData.rows ?? []).map((row, ri) =>
          ri === rowIdx
            ? row.map((cell, ci) => ci === colIdx ? result.url : cell)
            : row
        ),
      })
    } catch {
      // handled by useFileUpload
    } finally {
      setUploadingRows((prev) => {
        const next = new Set(prev)
        next.delete(rowIdx)
        return next
      })
      fileInputRef.current = null
    }
    e.target.value = ""
  }, [id, nodeData.rows, updateNodeData, upload])

  const handleAddRow = useCallback(() => {
    if (rows.length >= maxItems) return
    const newRow = columns.map(() => "")
    updateNodeData(id, { rows: [...rows, newRow] })
  }, [id, columns, rows, maxItems, updateNodeData])

  const handleRemoveRow = useCallback((rowIdx: number) => {
    updateNodeData(id, { rows: rows.filter((_, i) => i !== rowIdx) })
  }, [id, rows, updateNodeData])

  const dropZoneFileRef = useRef<HTMLInputElement>(null)

  const rowIds = useMemo(() => rows.map((_, i) => `row-${i}`), [rows])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const handleReorderRows = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = rowIds.indexOf(active.id as string)
      const newIndex = rowIds.indexOf(over.id as string)
      if (oldIndex === -1 || newIndex === -1) return
      updateNodeData(id, { rows: arrayMove([...rows], oldIndex, newIndex) })
    },
    [rowIds, rows, id, updateNodeData],
  )

  const showingPresentation = showData && colCount > 0 && displayRowCount > 0
  const resolvedViewMode = resolveViewMode(nodeData)
  const galleryCols = nodeData.galleryCols ?? DEFAULT_GALLERY_COLS
  const nodeWidth = showingPresentation
    ? resolvedViewMode === "gallery" ? Math.max(350, galleryCols * 100)
      : resolvedViewMode === "packed" ? 400
      : 350
    : sizeConfig.maxWidth

  type CellRef = {
    type: "image" | "video" | "audio" | "text"
    url?: string
    text?: string
  }

  const allCells = useMemo<CellRef[]>(() => {
    if (!isConnectedData) return []
    const out: CellRef[] = []
    for (const row of displayRows) {
      for (let ci = 0; ci < columns.length; ci++) {
        const cellVal = row[ci]
        if (!cellVal) continue
        const t = columns[ci].type ?? "text"
        if (t === "image-url") out.push({ type: "image", url: cellVal })
        else if (t === "video-url") out.push({ type: "video", url: cellVal })
        else if (t === "audio-url") out.push({ type: "audio", url: cellVal })
        else out.push({ type: "text", text: cellVal })
      }
    }
    return out
  }, [isConnectedData, displayRows, columns])

  type RenderMode = "list" | "gallery" | "packed"

  const renderImageCell = (cell: string, rowIdx: number, col: LoopColumn, idx: number, cellIdx: number, mode: RenderMode) => {
    if (!cell) {
      return (
        <div key={`${rowIdx}-${col.id}`} className="w-full h-10 rounded-lg border border-dashed border-muted-foreground/10 flex items-center justify-center">
          <span className="text-[9px] text-muted-foreground/30">{"\u2014"}</span>
        </div>
      )
    }
    const sourceHandle = col.handleId
    const tile = mode !== "list"
    const wrapper = "relative group/img rounded-lg overflow-hidden"
    const imgClass = `w-full h-auto rounded-lg ${tile ? "object-cover aspect-square" : ""}`
    const badgeClass = tile
      ? "absolute top-1 left-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 text-white text-[9px] font-medium tabular-nums opacity-0 group-hover/img:opacity-100 transition-opacity"
      : "absolute top-2 left-2 min-w-[20px] h-[20px] flex items-center justify-center rounded-full bg-black/50 text-white text-[10px] font-medium tabular-nums opacity-0 group-hover/img:opacity-100 transition-opacity"
    const dragClass = tile
      ? "nodrag nopan absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-[#ff0073]/80 text-white cursor-grab active:cursor-grabbing opacity-0 group-hover/img:opacity-100 transition-opacity"
      : "nodrag nopan absolute top-2 right-2 w-[20px] h-[20px] flex items-center justify-center rounded-full bg-black/50 hover:bg-[#ff0073]/80 text-white cursor-grab active:cursor-grabbing opacity-0 group-hover/img:opacity-100 transition-opacity shadow-sm"
    const arrowClass = tile ? "w-3 h-3" : "w-3.5 h-3.5"
    const actionRowClass = tile
      ? "nodrag nopan absolute inset-x-0 bottom-0 flex justify-center gap-1 py-1 opacity-0 group-hover/img:opacity-100 transition-opacity bg-gradient-to-t from-black/50 to-transparent"
      : "nodrag nopan absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity"
    const actionBtnClass = tile
      ? "w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full"
      : "w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
    const actionIconClass = tile ? "w-3 h-3" : "w-3.5 h-3.5"

    return (
      <div key={`${rowIdx}-${col.id}`} className={wrapper}>
        <CachedImage src={cell} alt="" className={imgClass} />
        <span className={badgeClass}>{idx + 1}</span>
        <div className={actionRowClass}>
          <button type="button" className={actionBtnClass} onClick={(e) => { e.stopPropagation(); setPreviewIndex(cellIdx) }} title="Expand"><Expand className={actionIconClass} /></button>
          <button type="button" className={actionBtnClass} onClick={(e) => { e.stopPropagation(); const a = document.createElement("a"); a.href = `/v1/image-proxy?url=${encodeURIComponent(cell)}&download=1`; a.download = "image.png"; a.click() }} title="Download"><Download className={actionIconClass} /></button>
          <button type="button" className={actionBtnClass} onClick={(e) => { e.stopPropagation(); copyToClipboard(cell, "URL copied") }} title="Copy URL"><Link className={actionIconClass} /></button>
        </div>
        <div
          className={dragClass}
          title={`Drag out as item ${idx + 1}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/nodaro-image", cell)
            e.dataTransfer.setData("application/nodaro-edge-context", JSON.stringify({ sourceNodeId: id, sourceHandle, itemIndex: idx + 1 }))
            e.dataTransfer.effectAllowed = "copy"
          }}
        >
          <ArrowUpRight className={arrowClass} />
        </div>
      </div>
    )
  }

  const renderVideoCell = (cell: string, rowIdx: number, col: LoopColumn, cellIdx: number, mode: RenderMode) => {
    if (!cell) {
      return (
        <div key={`${rowIdx}-${col.id}`} className="w-full h-10 rounded-lg border border-dashed border-muted-foreground/10 flex items-center justify-center">
          <span className="text-[9px] text-muted-foreground/30">{"\u2014"}</span>
        </div>
      )
    }
    const sourceHandle = col.handleId
    const tile = mode !== "list"
    const wrapper = "relative group/vid rounded-lg overflow-hidden"
    const videoClass = `w-full h-auto rounded-lg ${tile ? "object-cover aspect-square" : ""}`
    const badgeClass = tile
      ? "absolute top-1 left-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 text-white text-[9px] font-medium tabular-nums opacity-0 group-hover/vid:opacity-100 transition-opacity"
      : "absolute top-2 left-2 min-w-[20px] h-[20px] flex items-center justify-center rounded-full bg-black/50 text-white text-[10px] font-medium tabular-nums opacity-0 group-hover/vid:opacity-100 transition-opacity"
    const dragClass = tile
      ? "nodrag nopan absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-[#ff0073]/80 text-white cursor-grab active:cursor-grabbing opacity-0 group-hover/vid:opacity-100 transition-opacity"
      : "nodrag nopan absolute top-2 right-2 w-[20px] h-[20px] flex items-center justify-center rounded-full bg-black/50 hover:bg-[#ff0073]/80 text-white cursor-grab active:cursor-grabbing opacity-0 group-hover/vid:opacity-100 transition-opacity shadow-sm"
    const arrowClass = tile ? "w-3 h-3" : "w-3.5 h-3.5"
    const actionRowClass = tile
      ? "nodrag nopan absolute inset-x-0 bottom-0 flex justify-center gap-1 py-1 opacity-0 group-hover/vid:opacity-100 transition-opacity bg-gradient-to-t from-black/50 to-transparent"
      : "nodrag nopan absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/vid:opacity-100 transition-opacity"
    const actionBtnClass = tile
      ? "w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full"
      : "w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
    const actionIconClass = tile ? "w-3 h-3" : "w-3.5 h-3.5"

    return (
      <div key={`${rowIdx}-${col.id}`} className={wrapper}>
        <video src={cell} crossOrigin="anonymous" className={videoClass} autoPlay loop muted playsInline />
        <span className={badgeClass}>{rowIdx + 1}</span>
        <div className={actionRowClass}>
          <button type="button" className={actionBtnClass} onClick={(e) => { e.stopPropagation(); setPreviewIndex(cellIdx) }} title="Expand"><Expand className={actionIconClass} /></button>
          <button type="button" className={actionBtnClass} onClick={(e) => { e.stopPropagation(); const a = document.createElement("a"); a.href = cell; a.download = "video.mp4"; a.click() }} title="Download"><Download className={actionIconClass} /></button>
          <button type="button" className={actionBtnClass} onClick={(e) => { e.stopPropagation(); copyToClipboard(cell, "URL copied") }} title="Copy URL"><Link className={actionIconClass} /></button>
        </div>
        <div
          className={dragClass}
          title={`Drag out as item ${rowIdx + 1}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/nodaro-video", cell)
            e.dataTransfer.setData("application/nodaro-edge-context", JSON.stringify({ sourceNodeId: id, sourceHandle, itemIndex: rowIdx + 1 }))
            e.dataTransfer.effectAllowed = "copy"
          }}
        >
          <ArrowUpRight className={arrowClass} />
        </div>
      </div>
    )
  }

  const renderAudioCell = (cell: string, rowIdx: number, col: LoopColumn, cellIdx: number, mode: RenderMode) => {
    if (!cell) {
      return (
        <div key={`${rowIdx}-${col.id}`} className="w-full h-10 rounded-lg border border-dashed border-muted-foreground/10 flex items-center justify-center">
          <span className="text-[9px] text-muted-foreground/30">{"\u2014"}</span>
        </div>
      )
    }
    const tile = mode !== "list"
    const wrapper = tile
      ? "relative group/cell rounded-lg border border-border/40 bg-transparent aspect-square overflow-hidden pt-7 pb-1.5 px-1.5 flex flex-col justify-end h-full"
      : "relative group/cell rounded-lg border border-border/40 bg-transparent p-1.5 pt-6"

    return (
      <div key={`${rowIdx}-${col.id}`} className={wrapper}>
        <span className="absolute top-1 left-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 text-white text-[9px] font-medium tabular-nums opacity-0 group-hover/cell:opacity-100 transition-opacity">
          {rowIdx + 1}
        </span>
        <button
          type="button"
          title={`Expand item ${rowIdx + 1}`}
          aria-label="Expand audio"
          className="nodrag nopan absolute top-1 right-6 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white opacity-0 group-hover/cell:opacity-100 transition-opacity shadow-sm"
          onClick={(e) => { e.stopPropagation(); setPreviewIndex(cellIdx) }}
        >
          <Expand className="w-3 h-3" />
        </button>
        <div
          className="nodrag nopan absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-[#ff0073]/80 text-white cursor-grab active:cursor-grabbing opacity-0 group-hover/cell:opacity-100 transition-opacity shadow-sm"
          title={`Drag out as item ${rowIdx + 1}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/nodaro-audio", cell)
            e.dataTransfer.setData("application/nodaro-edge-context", JSON.stringify({ sourceNodeId: id, sourceHandle: col.handleId, itemIndex: rowIdx + 1 }))
            e.dataTransfer.effectAllowed = "copy"
          }}
        >
          <ArrowUpRight className="w-3 h-3" />
        </div>
        <div className="nodrag nopan">
          <audio src={cell} controls className="w-full h-8 rounded" style={{ minWidth: 0 }} />
        </div>
      </div>
    )
  }

  const renderTextCell = (cell: string, rowIdx: number, col: LoopColumn, cellIdx: number, mode: RenderMode) => {
    if (!cell) {
      return (
        <div key={`${rowIdx}-${col.id}`} className="w-full h-10 rounded-lg border border-dashed border-muted-foreground/10 flex items-center justify-center">
          <span className="text-[9px] text-muted-foreground/30">{"\u2014"}</span>
        </div>
      )
    }
    const tile = mode !== "list"
    const wrapper = `relative group/cell rounded-lg border border-border/40 bg-muted/10 ${tile ? "aspect-square overflow-hidden" : ""}`
    const innerClass = tile
      ? "text-xs text-foreground/80 h-full overflow-y-auto px-2 pt-7 pb-7 break-words"
      : "text-xs text-foreground/80 px-2 py-2 break-words overflow-y-auto"
    const innerStyle = tile ? undefined : { maxHeight: `${textCellMaxHeightPx(textMaxLines)}px` }

    return (
      <div key={`${rowIdx}-${col.id}`} className={wrapper}>
        <div className={innerClass} style={innerStyle} title={cell}>
          {cell}
        </div>
        {showCellControls && (
          <>
            <span className="absolute top-1 left-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 text-white text-[9px] font-medium tabular-nums opacity-0 group-hover/cell:opacity-100 transition-opacity">
              {rowIdx + 1}
            </span>
            <div
              className="nodrag nopan absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-[#ff0073]/80 text-white cursor-grab active:cursor-grabbing opacity-0 group-hover/cell:opacity-100 transition-opacity shadow-sm"
              title={`Drag out as item ${rowIdx + 1}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("application/nodaro-text", cell)
                e.dataTransfer.setData("application/nodaro-edge-context", JSON.stringify({ sourceNodeId: id, sourceHandle: col.handleId, itemIndex: rowIdx + 1 }))
                e.dataTransfer.effectAllowed = "copy"
              }}
            >
              <ArrowUpRight className="w-3 h-3" />
            </div>
            <div className="nodrag nopan absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover/cell:opacity-100 transition-opacity">
              <button
                type="button"
                aria-label="Expand text"
                className="w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded"
                onClick={(e) => { e.stopPropagation(); setPreviewIndex(cellIdx) }}
              >
                <Expand className="w-3 h-3" />
              </button>
              <button
                type="button"
                aria-label="Copy text"
                className="w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded"
                onClick={(e) => { e.stopPropagation(); copyToClipboard(cell, "Copied") }}
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  const renderCell = (cell: string, rowIdx: number, col: LoopColumn, imgIdx: number, cellIdx: number, mode: RenderMode) => {
    const t = col.type ?? "text"
    if (t === "image-url") return renderImageCell(cell, rowIdx, col, imgIdx, cellIdx, mode)
    if (t === "video-url") return renderVideoCell(cell, rowIdx, col, cellIdx, mode)
    if (t === "audio-url") return renderAudioCell(cell, rowIdx, col, cellIdx, mode)
    return renderTextCell(cell, rowIdx, col, cellIdx, mode)
  }

  let statusText: string
  if (hasUpstreamInput && !connectedRows) {
    statusText = "Connected: waiting for input..."
  } else if (colCount > 0) {
    statusText = `${displayRowCount} row${displayRowCount !== 1 ? "s" : ""} \u00D7 ${colCount} col${colCount !== 1 ? "s" : ""}`
  } else {
    statusText = "Click to configure..."
  }

  const sourceHandles = handles.filter(h => h.type === "source")
  const targetHandles = handles.filter(h => h.type === "target" && h.id !== LOOP_COL_ADD_HANDLE)

  return (
    <div className="relative" style={{ maxWidth: `${nodeWidth}px` }}>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleCellFileSelect}
        className="hidden"
        ref={hiddenFileRef}
      />
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) addImageFiles(files)
          e.target.value = ""
        }}
        className="hidden"
        ref={dropZoneFileRef}
      />
      <EditableNodeLabel
        label={nodeData.label}
        icon={isList ? <List className="w-3.5 h-3.5" /> : <Repeat className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={isList ? <List className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        minWidth={showingPresentation ? (resolvedViewMode === "packed" ? 400 : 300) : nodeWidth}
        hideHeader
        topToolbarContent={
          <div className="flex items-center gap-1">
            {colCount > 0 && displayRowCount > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowData(!showData) }}
                className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
                title={showData ? "Show info" : "Show data"}
              >
                {showData ? <Info className="w-3.5 h-3.5" /> : <Table2 className="w-3.5 h-3.5" />}
              </button>
            )}
            {showingPresentation && !isConnectedData && (
              <>
                <span className="text-[9px] text-muted-foreground/60">
                  {rowCount} of {maxItems} max
                </span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleAddRow() }}
                  disabled={rows.length >= maxItems}
                  className="flex items-center justify-center w-5 h-5 rounded-md bg-[#ff0073] text-white transition-opacity duration-150 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
                  title="Add row"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </>
            )}
            {status !== "running" && (
              <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
            )}
          </div>
        }
        handles={handles}
      >
        <div
          className="p-3 h-full flex flex-col"
          style={{ minHeight: colCount > 1 ? `${colCount * 22 + 8}px` : undefined }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {showData && colCount > 0 && displayRowCount > 0 ? (
            <div className="relative flex-1 min-h-0 flex flex-col">
              {isConnectedData ? (
                <>
                  {resolvedViewMode === "list" && (
                    <div className="flex flex-col divide-y divide-border/30 flex-1 min-h-0 overflow-y-auto pr-1">
                      {(() => { let imgIdx = 0; let cellIdx = 0; return displayRows.map((row, rowIdx) => (
                        <div key={rowIdx} className="min-w-0 pt-2 first:pt-0">
                          {columns.map((col, colIdx) => {
                            const cell = row[colIdx] ?? ""
                            const t = col.type ?? "text"
                            const myImgIdx = t === "image-url" && cell ? imgIdx++ : -1
                            const myCellIdx = cell ? cellIdx++ : -1
                            return renderCell(cell, rowIdx, col, myImgIdx, myCellIdx, "list")
                          })}
                        </div>
                      )) })()}
                    </div>
                  )}

                  {resolvedViewMode === "gallery" && (
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${galleryCols}, 1fr)` }}>
                      {(() => { let imgIdx = 0; return displayRows.flatMap((row, rowIdx) =>
                        columns.map((col, colIdx) => {
                          const cell = row[colIdx] ?? ""
                          if (!cell) return null
                          if ((col.type ?? "text") !== "image-url") return null
                          const idx = imgIdx++
                          const sourceHandle = col.handleId
                          return (
                            <div key={`${rowIdx}-${col.id}`} className="relative group/img rounded-lg overflow-hidden">
                              <CachedImage src={cell} alt="" className="w-full h-auto rounded-lg object-cover aspect-square" />
                              <span className="absolute top-1 left-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 text-white text-[9px] font-medium tabular-nums opacity-0 group-hover/img:opacity-100 transition-opacity">{idx + 1}</span>
                              <div className="nodrag nopan absolute inset-x-0 bottom-0 flex justify-center gap-1 py-1 opacity-0 group-hover/img:opacity-100 transition-opacity bg-gradient-to-t from-black/50 to-transparent">
                                <button type="button" className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full" onClick={(e) => { e.stopPropagation(); setPreviewIndex(idx) }} title="Expand"><Expand className="w-3 h-3" /></button>
                                <button type="button" className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full" onClick={(e) => { e.stopPropagation(); const a = document.createElement("a"); a.href = `/v1/image-proxy?url=${encodeURIComponent(cell)}&download=1`; a.download = "image.png"; a.click() }} title="Download"><Download className="w-3 h-3" /></button>
                                <button type="button" className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full" onClick={(e) => { e.stopPropagation(); copyToClipboard(cell, "URL copied") }} title="Copy URL"><Link className="w-3 h-3" /></button>
                              </div>
                              <div
                                className="nodrag nopan absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-[#ff0073]/80 text-white cursor-grab active:cursor-grabbing opacity-0 group-hover/img:opacity-100 transition-opacity"
                                title={`Drag out as item ${idx + 1}`}
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData("application/nodaro-image", cell)
                                  e.dataTransfer.setData("application/nodaro-edge-context", JSON.stringify({ sourceNodeId: id, sourceHandle, itemIndex: idx + 1 }))
                                  e.dataTransfer.effectAllowed = "copy"
                                }}
                              >
                                <ArrowUpRight className="w-3 h-3" />
                              </div>
                            </div>
                          )
                        }),
                      ) })()}
                    </div>
                  )}

                  {resolvedViewMode === "packed" && (() => {
                    const layout = computePackedLayout({
                      count: allCells.length,
                      min: packedMin(columns),
                      hint: galleryCols,
                    })
                    const containerStyle: React.CSSProperties = {
                      height: 400,
                      width: 376,
                      display: "grid",
                      gridTemplateColumns: `repeat(${layout.cols}, ${layout.tileSize}px)`,
                      gap: 4,
                      justifyContent: "center",
                      overflowY: layout.overflow ? "auto" : "hidden",
                    }
                    return (
                      <div style={containerStyle}>
                        {(() => { let imgIdx = 0; let cellIdx = 0; return displayRows.flatMap((row, rowIdx) =>
                          columns.map((col, colIdx) => {
                            const cell = row[colIdx] ?? ""
                            if (!cell) return null
                            const t = col.type ?? "text"
                            const myImgIdx = t === "image-url" ? imgIdx++ : -1
                            const myCellIdx = cellIdx++
                            return renderCell(cell, rowIdx, col, myImgIdx, myCellIdx, "packed")
                          })
                        ) })()}
                      </div>
                    )
                  })()}
                </>
              ) : (
                <div className="nodrag flex flex-col gap-2">
                  <>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleReorderRows}>
                      <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
                        {rows.map((row, rowIdx) => (
                          <SortableNodeRow key={rowIds[rowIdx]} id={rowIds[rowIdx]} onRemove={() => handleRemoveRow(rowIdx)}>
                            {uploadingRows.has(rowIdx) ? (
                              <div className="flex items-center justify-center py-8 rounded-lg bg-muted/10">
                                <Loader2 className="w-5 h-5 animate-spin text-[#38BDF8]" />
                              </div>
                            ) : (
                              columns.map((col, colIdx) => {
                                const cell = row[colIdx] ?? ""
                                const colType = col.type ?? "text"
                                if (colType === "image-url") {
                                  return cell ? (
                                    <CachedImage
                                      key={col.id}
                                      src={cell}
                                      alt=""
                                      className="w-full h-auto rounded-lg"
                                    />
                                  ) : (
                                    <button
                                      key={col.id}
                                      type="button"
                                      className="w-full h-14 rounded-lg border-2 border-dashed border-muted-foreground/20 flex items-center justify-center hover:border-[#ff0073]/50 hover:bg-[#ff0073]/5 transition-colors"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        fileInputRef.current = { rowIdx, colIdx }
                                        hiddenFileRef.current?.click()
                                      }}
                                    >
                                      <Plus className="w-4 h-4 text-muted-foreground/40" />
                                    </button>
                                  )
                                }
                                if (colType === "video-url" || colType === "audio-url") {
                                  return (
                                    <span key={col.id} className="text-[10px] text-muted-foreground/60 italic block py-1">
                                      {cell ? "media" : "\u2014"}
                                    </span>
                                  )
                                }
                                return col.connectedSourceId ? (
                                  <div key={col.id} className="px-1 py-0.5 text-[10px] text-muted-foreground/60 truncate">
                                    {cell || "..."}
                                  </div>
                                ) : (
                                  <span key={col.id} className="text-[10px] text-muted-foreground truncate block py-1" title={cell}>
                                    {cell || "\u2014"}
                                  </span>
                                )
                              })
                            )}
                          </SortableNodeRow>
                        ))}
                      </SortableContext>
                    </DndContext>
                    {firstImageColIdx >= 0 && rows.length < maxItems && (
                      <div
                        className="flex items-center justify-center py-3 border-2 border-dashed rounded-lg transition-colors cursor-pointer border-muted-foreground/15 hover:border-[#ff0073]/40"
                        onClick={(e) => { e.stopPropagation(); dropZoneFileRef.current?.click() }}
                      >
                        <div className="flex items-center gap-1.5">
                          <Upload className="w-3.5 h-3.5 text-muted-foreground/40" />
                          <span className="text-[10px] text-muted-foreground/60">Drop files to add rows, or click to browse</span>
                        </div>
                      </div>
                    )}
                  </>
                </div>
              )}
              {isDragOver && firstImageColIdx >= 0 && !isConnectedData && (
                <div className="absolute inset-0 bg-[#ff0073]/5 border-2 border-dashed border-[#ff0073]/60 rounded-lg flex items-center justify-center z-10">
                  <div className="flex items-center gap-1.5 text-[#ff0073] text-xs font-medium">
                    <Upload className="w-3.5 h-3.5" />
                    Drop to add rows
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Text preview for single-column text lists (uses displayRows so upstream-connected rows show their filtered values). */}
              {colCount === 1 && columns[0]?.type === "text" && displayRowCount > 0 ? (
                <div className="flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto">
                  {displayRows.map((row, i) => (
                    <div key={i} className="flex items-start gap-1.5 overflow-hidden" style={{ maxHeight: `${textMaxLines * 16}px` }}>
                      <span className="text-[9px] text-muted-foreground/40 tabular-nums mt-0.5 shrink-0 w-3 text-right">{i + 1}</span>
                      <span className="text-[11px] text-foreground/75 flex-1" style={{ wordBreak: "break-word" }}>{row[0] || "—"}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {statusText}
                  </p>
                  {columns.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-1">
                      {columns.map((col) => {
                        const colColor = LOOP_COLUMN_TYPE_META[col.type ?? "text"]?.color ?? "#38BDF8"
                        return (
                          <span key={col.id} className="text-[9px] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-0.5"
                            style={{
                              background: `${colColor}20`,
                              color: colColor,
                            }}>
                            {col.name}
                            {col.connectedSourceId && <Link className="w-2.5 h-2.5 opacity-60" />}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </BaseNode>
      {/* Quick-add target icon (top-left) */}
      <HandleIcon icon={<Plus />} color="cyan" side="left" top="15%" />
      {/* Per-column target icons (left side) */}
      {targetHandles.map((h) => {
        const handleBase = loopColBaseHandle(h.id)
        const col = columns.find((c) => c.handleId === handleBase)
        const colType = col?.type ?? "text"
        const icon = COLUMN_TYPE_ICON[colType] ?? COLUMN_TYPE_ICON.text
        return (
          <HandleIcon key={h.id} icon={icon} color={HANDLE_COLOR_MAP[colType] ?? "cyan"} side="left" top={h.top} />
        )
      })}
      {/* Per-column source icons (right side) */}
      {sourceHandles.map((h) => {
        const col = columns.find((c) => c.handleId === h.id)
        const colType = col?.type ?? "text"
        const icon = COLUMN_TYPE_ICON[colType] ?? COLUMN_TYPE_ICON.text
        return (
          <HandleIcon key={h.id} icon={icon} color={HANDLE_COLOR_MAP[colType] ?? "cyan"} top={h.top} />
        )
      })}
      <StorageExceededModal
        open={storageExceeded.exceeded}
        onClose={clearStorageExceeded}
        usedBytes={storageExceeded.usedBytes}
        quotaBytes={storageExceeded.quotaBytes}
        tier={storageExceeded.tier}
      />
      {previewIndex !== null && (
        <MediaPreviewModal
          isOpen={previewIndex !== null}
          onClose={() => setPreviewIndex(null)}
          type={allCells[previewIndex]?.type ?? "image"}
          url={allCells[previewIndex]?.url ?? ""}
          results={allCells}
          initialIndex={previewIndex}
        />
      )}
    </div>
  )
}

// Explicit comparator: re-render whenever `data` reference changes.
// React Flow v12's default shallow memo can miss updates produced by
// Zustand mutations (e.g. the config-panel "Split" action replaces
// `rows` via a new `data` reference — without this comparator the
// upstream node's preview and Data tab stayed stale while downstream
// consumers saw the new rows).
export const LoopNode = memo(
  LoopNodeComponent,
  (prev, next) =>
    prev.id === next.id &&
    prev.type === next.type &&
    prev.selected === next.selected &&
    prev.data === next.data,
)
