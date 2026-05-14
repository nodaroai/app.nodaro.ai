"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Braces, Copy, Download, Expand, Film, GripVertical, Image, Info, Link, List, Loader2, Music, Plus, Repeat, Table2, Type, Upload, X } from "lucide-react"
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
import { LOOP_COLUMN_TYPE_META, LOOP_COL_ADD_HANDLE, TEXT_CELL_CONTROLS_MIN_LINES, TEXT_CELL_DEFAULT_MAX_LINES, TEXT_FONT_SIZE_CLASS, TEXT_FONT_SIZE_DEFAULT, loopColBaseHandle, loopColInputHandle, resolveViewMode, type LoopNodeData, type LoopColumn, type WorkflowNode } from "@/types/nodes"
import { CachedImage } from "@/components/ui/cached-image"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useFileUpload } from "@/hooks/use-file-upload"
import { StorageExceededModal } from "@/ee/components/credits/StorageExceededModal"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { copyToClipboard } from "@/lib/utils"
import { resolveEdgeValuesForTableColumn } from "@/components/editor/workflow-editor/node-input-resolver"

const HANDLE_COLOR_MAP: Record<string, "pink" | "indigo" | "green" | "cyan"> = {
  "image-url": "pink",
  "video-url": "indigo",
  "audio-url": "green",
  json: "cyan",
  "text": "cyan",
}

const COLUMN_TYPE_ICON: Record<string, React.ReactElement> = {
  "image-url": <Image />,
  "video-url": <Film />,
  "audio-url": <Music />,
  json: <Braces />,
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
  json:        140,
  "text":      100,
}
const PACKED_CONTAINER_W = 376
const PACKED_CONTAINER_H = 400
const PACKED_GAP = 4
/** Aspect ratio tileW/tileH in packed mode — tile is wider than tall so more items fit vertically. */
const PACKED_ASPECT = 5 / 3
/** Minimum tile HEIGHT in packed mode (independent of width). Below this text becomes illegible. */
const PACKED_MIN_H = 48

export function packedMin(columns: ReadonlyArray<LoopColumn>): number {
  if (columns.length === 0) return 100
  return Math.max(...columns.map(c => PACKED_MIN_BY_TYPE[c.type ?? "text"]))
}

export function computePackedLayout(opts: {
  count: number
  min: number
  /** Unused in the tight-packing path — kept for API compatibility. */
  hint?: number
}): { tileW: number; tileH: number; cols: number; rows: number; overflow: boolean } {
  const { count, min } = opts
  const W = PACKED_CONTAINER_W
  const H = PACKED_CONTAINER_H
  const gap = PACKED_GAP

  // Goal: fit as many items as possible in H without scroll (or minimize overflow).
  // totalH(cols) decreases roughly as 1/cols² (rows ∝ 1/cols AND tileH ∝ 1/cols),
  // so pack as many columns as the min-width floor allows.
  const maxColsByMin = Math.max(1, Math.floor((W + gap) / (min + gap)))
  const cols = Math.max(1, Math.min(maxColsByMin, count))
  const tileW = Math.max(min, Math.floor((W - gap * (cols - 1)) / cols))
  const tileH = Math.max(PACKED_MIN_H, Math.round(tileW / PACKED_ASPECT))
  const rows = Math.ceil(count / cols)
  const totalH = rows * tileH + (rows - 1) * gap
  return { tileW, tileH, cols, rows, overflow: totalH > H }
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
  const runFromHere = useWorkflowStore((s) => s.runFromHere)
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
  const textFontSize = nodeData.textFontSize ?? TEXT_FONT_SIZE_DEFAULT
  const textFontClass = TEXT_FONT_SIZE_CLASS[textFontSize]
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

  /** Resolve rows from connected upstream nodes — respects edge outputMode and selector. */
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
      : resolvedViewMode === "packed" ? 220
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
    const tile = mode !== "list"
    const packed = mode === "packed"
    const innerSize = packed ? "w-full aspect-[5/3]" : ""
    // Gallery shows images at their natural aspect ratio (h-auto); packed crops to the shorter tile; list is flexible.
    const imgSizing = packed ? "w-full h-full object-cover" : tile ? "w-full h-auto" : "w-full h-auto"
    const actionRowClass = tile
      ? "nodrag nopan absolute inset-x-0 bottom-0 flex justify-center gap-1 py-1 opacity-0 group-hover/img:opacity-100 transition-opacity bg-gradient-to-t from-black/50 to-transparent"
      : "nodrag nopan absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/img:opacity-100 transition-opacity"
    const actionBtnClass = packed
      ? "w-5 h-5 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full"
      : tile
      ? "w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full"
      : "w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
    const actionIconClass = tile ? "w-3 h-3" : "w-3.5 h-3.5"

    return (
      <div key={`${rowIdx}-${col.id}`} className={`relative group/img ${innerSize}`}>
        <div className={`relative rounded-lg overflow-hidden ${innerSize}`}>
          <CachedImage src={cell} alt="" className={`${imgSizing} rounded-lg`} />
          <button
            type="button"
            aria-label="Expand image"
            className="nodrag nopan absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white opacity-0 group-hover/img:opacity-100 transition-opacity shadow-sm"
            onClick={(e) => { e.stopPropagation(); setPreviewIndex(cellIdx) }}
          >
            <Expand className="w-3 h-3" />
          </button>
          <div className={actionRowClass}>
            <button type="button" className={actionBtnClass} onClick={(e) => { e.stopPropagation(); const a = document.createElement("a"); a.href = `/v1/image-proxy?url=${encodeURIComponent(cell)}&download=1`; a.download = "image.png"; a.click() }} title="Download"><Download className={actionIconClass} /></button>
            <button type="button" className={actionBtnClass} onClick={(e) => { e.stopPropagation(); copyToClipboard(cell, "URL copied") }} title="Copy URL"><Link className={actionIconClass} /></button>
          </div>
        </div>
        <span className="absolute -top-1.5 -left-1.5 z-10 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900 text-black dark:text-white text-[9px] font-medium tabular-nums shadow-sm">{idx + 1}</span>
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
    const tile = mode !== "list"
    const packed = mode === "packed"
    const innerSize = packed ? "w-full aspect-[5/3]" : ""
    const videoSizing = packed ? "w-full h-full object-cover" : tile ? "w-full h-auto object-cover aspect-square" : "w-full h-auto"
    const actionRowClass = tile
      ? "nodrag nopan absolute inset-x-0 bottom-0 flex justify-center gap-1 py-1 opacity-0 group-hover/vid:opacity-100 transition-opacity bg-gradient-to-t from-black/50 to-transparent"
      : "nodrag nopan absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/vid:opacity-100 transition-opacity"
    const actionBtnClass = packed
      ? "w-5 h-5 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full"
      : tile
      ? "w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full"
      : "w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
    const actionIconClass = tile ? "w-3 h-3" : "w-3.5 h-3.5"

    return (
      <div key={`${rowIdx}-${col.id}`} className={`relative group/vid ${innerSize}`}>
        <div className={`relative rounded-lg overflow-hidden ${innerSize}`}>
          <video src={cell} crossOrigin="anonymous" className={`${videoSizing} rounded-lg`} autoPlay loop muted playsInline />
          <button
            type="button"
            aria-label="Expand video"
            className="nodrag nopan absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white opacity-0 group-hover/vid:opacity-100 transition-opacity shadow-sm"
            onClick={(e) => { e.stopPropagation(); setPreviewIndex(cellIdx) }}
          >
            <Expand className="w-3 h-3" />
          </button>
          <div className={actionRowClass}>
            <button type="button" className={actionBtnClass} onClick={(e) => { e.stopPropagation(); const a = document.createElement("a"); a.href = cell; a.download = "video.mp4"; a.click() }} title="Download"><Download className={actionIconClass} /></button>
            <button type="button" className={actionBtnClass} onClick={(e) => { e.stopPropagation(); copyToClipboard(cell, "URL copied") }} title="Copy URL"><Link className={actionIconClass} /></button>
          </div>
        </div>
        <span className="absolute -top-1.5 -left-1.5 z-10 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900 text-black dark:text-white text-[9px] font-medium tabular-nums shadow-sm">{rowIdx + 1}</span>
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
    const packed = mode === "packed"
    const innerSize = packed ? "w-full aspect-[5/3]" : ""
    const innerClass = packed
      ? "relative rounded-lg border border-border/40 bg-transparent overflow-hidden pt-5 pb-1 px-1.5 flex flex-col justify-end h-full w-full"
      : tile
      ? "relative rounded-lg border border-border/40 bg-transparent aspect-square overflow-hidden pt-7 pb-1.5 px-1.5 flex flex-col justify-end h-full"
      : "relative rounded-lg border border-border/40 bg-transparent p-1.5 pt-6"

    return (
      <div key={`${rowIdx}-${col.id}`} className={`relative group/cell ${innerSize}`}>
        <div className={innerClass}>
          <button
            type="button"
            aria-label="Expand audio"
            className="nodrag nopan absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white opacity-0 group-hover/cell:opacity-100 transition-opacity shadow-sm"
            onClick={(e) => { e.stopPropagation(); setPreviewIndex(cellIdx) }}
          >
            <Expand className="w-3 h-3" />
          </button>
          <div className="nodrag nopan">
            <audio src={cell} controls className="w-full h-8 rounded" style={{ minWidth: 0 }} />
          </div>
        </div>
        <span className="absolute -top-1.5 -left-1.5 z-10 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900 text-black dark:text-white text-[9px] font-medium tabular-nums shadow-sm">{rowIdx + 1}</span>
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
    const packed = mode === "packed"
    // Text cells size to content (line-clamped to textMaxLines) in all modes so the
    // textMaxLines setting actually drives cell height — no fixed aspect ratio.
    const innerClass = "relative rounded-lg border border-border/40 bg-muted/10 overflow-hidden"

    // Browser-enforced line clamping — exactly textMaxLines visible regardless of font-size
    // line-height math. Users open the fullscreen preview (Expand) to see content beyond.
    const clampStyle: React.CSSProperties = {
      display: "-webkit-box",
      WebkitBoxOrient: "vertical",
      WebkitLineClamp: textMaxLines,
      overflow: "hidden",
      wordBreak: "break-word",
    }

    const textContent = (
      <div className={`${textFontClass} text-foreground/80`} style={clampStyle}>
        {cell}
      </div>
    )

    const cellContainer = packed ? (
      <div className="px-1.5 py-1">{textContent}</div>
    ) : tile ? (
      <div className="px-2 py-2">{textContent}</div>
    ) : (
      <div className="px-2 py-2 pr-3">{textContent}</div>
    )

    return (
      <div key={`${rowIdx}-${col.id}`} className="relative group/cell self-start">
        <div className={innerClass}>
          {cellContainer}
          {showCellControls && (
            tile ? (
              <div className="nodrag nopan absolute inset-x-0 bottom-0 flex justify-center gap-1 py-1 opacity-0 group-hover/cell:opacity-100 transition-opacity bg-gradient-to-t from-black/50 to-transparent">
                <button
                  type="button"
                  aria-label="Expand text"
                  className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full"
                  onClick={(e) => { e.stopPropagation(); setPreviewIndex(cellIdx) }}
                >
                  <Expand className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  aria-label="Copy text"
                  className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full"
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(cell, "Copied") }}
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="Expand text"
                  className="nodrag nopan absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white opacity-0 group-hover/cell:opacity-100 transition-opacity shadow-sm"
                  onClick={(e) => { e.stopPropagation(); setPreviewIndex(cellIdx) }}
                >
                  <Expand className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  aria-label="Copy text"
                  className="nodrag nopan absolute top-6 right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white opacity-0 group-hover/cell:opacity-100 transition-opacity shadow-sm"
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(cell, "Copied") }}
                >
                  <Copy className="w-3 h-3" />
                </button>
              </>
            )
          )}
        </div>
        <span className="absolute -top-1.5 -left-1.5 z-10 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900 text-black dark:text-white text-[9px] font-medium tabular-nums shadow-sm">{rowIdx + 1}</span>
      </div>
    )
  }

  const renderJsonCell = (cell: string, rowIdx: number, col: LoopColumn, cellIdx: number, mode: RenderMode) => {
    if (!cell) {
      return (
        <div key={`${rowIdx}-${col.id}`} className="w-full h-10 rounded-lg border border-dashed border-muted-foreground/10 flex items-center justify-center">
          <span className="text-[9px] text-muted-foreground/30">{"\u2014"}</span>
        </div>
      )
    }
    let parsed: unknown
    try { parsed = JSON.parse(cell) } catch { parsed = null }
    const allEntries = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.entries(parsed as Record<string, unknown>)
      : null
    const entries = allEntries?.slice(0, 4) ?? null
    const tile = mode !== "list"
    const packed = mode === "packed"

    const content = entries ? (
      <div className="flex flex-col gap-0.5">
        {entries.map(([k, v]) => {
          const vs = typeof v === "string" ? v : JSON.stringify(v)
          return (
            <div key={k} className="flex gap-1 min-w-0">
              <span className="shrink-0" style={{ color: LOOP_COLUMN_TYPE_META.json.color }}>{k}:</span>
              <span className="text-foreground/60 truncate">{vs}</span>
            </div>
          )
        })}
        {allEntries && allEntries.length > 4 && (
          <span className="text-muted-foreground/40">+{allEntries.length - 4} more</span>
        )}
      </div>
    ) : (
      <div className="text-foreground/60 truncate">{cell}</div>
    )

    const innerClass = "relative rounded-lg border border-border/40 bg-muted/10 overflow-hidden"
    const containerClass = packed ? "px-1.5 py-1" : tile ? "px-2 py-1.5" : "px-2 py-1.5 pr-3"

    return (
      <div key={`${rowIdx}-${col.id}`} className="relative group/cell self-start">
        <div className={innerClass}>
          <div className={containerClass}>
            <div className="text-[10px] font-mono leading-relaxed" style={{ WebkitLineClamp: 5, display: "-webkit-box", WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {content}
            </div>
          </div>
          {showCellControls && (
            tile ? (
              <div className="nodrag nopan absolute inset-x-0 bottom-0 flex justify-center gap-1 py-1 opacity-0 group-hover/cell:opacity-100 transition-opacity bg-gradient-to-t from-black/50 to-transparent">
                <button type="button" aria-label="Expand" className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full" onClick={(e) => { e.stopPropagation(); setPreviewIndex(cellIdx) }}><Expand className="w-3 h-3" /></button>
                <button type="button" aria-label="Copy" className="w-6 h-6 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full" onClick={(e) => { e.stopPropagation(); copyToClipboard(cell, "Copied") }}><Copy className="w-3 h-3" /></button>
              </div>
            ) : (
              <>
                <button type="button" aria-label="Expand" className="nodrag nopan absolute top-1 right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white opacity-0 group-hover/cell:opacity-100 transition-opacity shadow-sm" onClick={(e) => { e.stopPropagation(); setPreviewIndex(cellIdx) }}><Expand className="w-3 h-3" /></button>
                <button type="button" aria-label="Copy" className="nodrag nopan absolute top-6 right-1 w-[18px] h-[18px] flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-white opacity-0 group-hover/cell:opacity-100 transition-opacity shadow-sm" onClick={(e) => { e.stopPropagation(); copyToClipboard(cell, "Copied") }}><Copy className="w-3 h-3" /></button>
              </>
            )
          )}
        </div>
        <span className="absolute -top-1.5 -left-1.5 z-10 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-900 text-black dark:text-white text-[9px] font-medium tabular-nums shadow-sm">{rowIdx + 1}</span>
      </div>
    )
  }

  const renderCell = (cell: string, rowIdx: number, col: LoopColumn, imgIdx: number, cellIdx: number, mode: RenderMode) => {
    const t = col.type ?? "text"
    if (t === "image-url") return renderImageCell(cell, rowIdx, col, imgIdx, cellIdx, mode)
    if (t === "video-url") return renderVideoCell(cell, rowIdx, col, cellIdx, mode)
    if (t === "audio-url") return renderAudioCell(cell, rowIdx, col, cellIdx, mode)
    if (t === "json") return renderJsonCell(cell, rowIdx, col, cellIdx, mode)
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
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/heic,image/heif"
        onChange={handleCellFileSelect}
        className="hidden"
        ref={hiddenFileRef}
      />
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/heic,image/heif"
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
        minWidth={showingPresentation ? (resolvedViewMode === "packed" ? 220 : 300) : nodeWidth}
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
              <RunNodeButton nodeId={id} credits={0} isRunning={status === "running"} onRun={(nid) => runFromHere?.(nid)} runFromHere />
            )}
          </div>
        }
        handles={handles}
      >
        <div
          className="p-1 h-full flex flex-col"
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
                    <ScrollArea className="flex-1 min-h-0">
                      <div className="flex flex-col divide-y divide-border/30 pt-2 pl-2 pr-4">
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
                    </ScrollArea>
                  )}

                  {resolvedViewMode === "gallery" && (
                    <ScrollArea className="flex-1 min-h-0">
                      <div className="grid gap-1.5 pt-2 pl-2 pr-4" style={{ gridTemplateColumns: `repeat(${galleryCols}, minmax(0, 1fr))` }}>
                        {(() => { let imgIdx = 0; let cellIdx = 0; return displayRows.flatMap((row, rowIdx) =>
                          columns.map((col, colIdx) => {
                            const cell = row[colIdx] ?? ""
                            if (!cell) return null
                            const t = col.type ?? "text"
                            const myImgIdx = t === "image-url" ? imgIdx++ : -1
                            const myCellIdx = cellIdx++
                            return renderCell(cell, rowIdx, col, myImgIdx, myCellIdx, "gallery")
                          }),
                        ) })()}
                      </div>
                    </ScrollArea>
                  )}

                  {resolvedViewMode === "packed" && (
                    <ScrollArea className="flex-1 min-h-0">
                      <div
                        className="grid gap-1 pt-2 pl-2 pr-4"
                        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${packedMin(columns)}px, 1fr))` }}
                      >
                        {(() => { let imgIdx = 0; let cellIdx = 0; return displayRows.flatMap((row, rowIdx) =>
                          columns.map((col, colIdx) => {
                            const cell = row[colIdx] ?? ""
                            if (!cell) return null
                            const t = col.type ?? "text"
                            const myImgIdx = t === "image-url" ? imgIdx++ : -1
                            const myCellIdx = cellIdx++
                            return renderCell(cell, rowIdx, col, myImgIdx, myCellIdx, "packed")
                          }),
                        ) })()}
                      </div>
                    </ScrollArea>
                  )}
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
                                if (colType === "json") {
                                  return (
                                    <span key={col.id} className="text-[10px] text-muted-foreground/60 font-mono italic block py-1 truncate">
                                      {cell ? `{...}` : "\u2014"}
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
                <ScrollArea className="flex-1 min-h-0">
                  <div className="flex flex-col gap-0.5 pt-2 pl-2 pr-4">
                    {displayRows.map((row, i) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <span className="text-[9px] text-muted-foreground/40 tabular-nums mt-0.5 shrink-0 w-3 text-right">{i + 1}</span>
                        <span className={`${textFontClass} text-foreground/75 flex-1`} style={{
                          display: "-webkit-box",
                          WebkitBoxOrient: "vertical",
                          WebkitLineClamp: textMaxLines,
                          overflow: "hidden",
                          wordBreak: "break-word",
                        }}>{row[0] || "—"}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
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
          <HandleIcon
            key={h.id}
            icon={icon}
            color={HANDLE_COLOR_MAP[colType] ?? "cyan"}
            top={h.top}
            label={col?.name}
          />
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
