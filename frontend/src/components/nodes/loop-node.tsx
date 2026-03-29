"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Film, GripVertical, Image, Info, Link, Loader2, Music, Plus, Repeat, Table2, Type, Upload, X } from "lucide-react"
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
import { LOOP_COLUMN_TYPE_META, LOOP_COL_ADD_HANDLE, loopColBaseHandle, type LoopNodeData, type LoopColumn } from "@/types/nodes"
import { CachedImage } from "@/components/ui/cached-image"
import { useFileUpload } from "@/hooks/use-file-upload"
import { StorageExceededModal } from "@/components/credits/StorageExceededModal"

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

const THUMB_SIZE_CONFIG = {
  sm: { px: 24, maxWidth: 220, imgClass: "w-6 h-6" },
  md: { px: 48, maxWidth: 280, imgClass: "w-12 h-12" },
  lg: { px: 80, maxWidth: 400, imgClass: "w-20 h-20" },
} as const

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

function LoopNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LoopNodeData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const edges = useWorkflowStore((s) => s.edges)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNodeInternals = useUpdateNodeInternals()
  const status = (nodeData as Record<string, unknown>).executionStatus as string | undefined ?? "idle"
  const showData = !!(nodeData as Record<string, unknown>).showData
  const setShowData = useCallback((v: boolean) => updateNodeData(id, { showData: v }), [id, updateNodeData])

  const thumbSize = nodeData.thumbnailSize ?? "md"
  const sizeConfig = THUMB_SIZE_CONFIG[thumbSize]

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

  const showingPresentation = showData && colCount > 0 && rowCount > 0
  const nodeWidth = showingPresentation ? 350 : sizeConfig.maxWidth

  let statusText: string
  if (hasUpstreamInput) {
    statusText = "Connected: waiting for input..."
  } else if (colCount > 0) {
    statusText = `${rowCount} row${rowCount !== 1 ? "s" : ""} \u00D7 ${colCount} col${colCount !== 1 ? "s" : ""}`
  } else {
    statusText = "Click to configure..."
  }

  const sourceHandles = handles.filter(h => h.type === "source")
  const targetHandles = handles.filter(h => h.type === "target" && h.id !== LOOP_COL_ADD_HANDLE)

  return (
    <div className="relative" style={showingPresentation ? undefined : { maxWidth: `${nodeWidth}px` }}>
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
        icon={<Repeat className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Repeat className="h-4 w-4" />}
        category="input"
        credits={0}
        selected={selected}
        isRunning={status === "running"}
        minWidth={showingPresentation ? 300 : nodeWidth}
        hideHeader
        topToolbarContent={
          <div className="flex items-center gap-1">
            {colCount > 0 && rowCount > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setShowData(!showData) }}
                className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 transition-colors"
                title={showData ? "Show info" : "Show data"}
              >
                {showData ? <Info className="w-3.5 h-3.5" /> : <Table2 className="w-3.5 h-3.5" />}
              </button>
            )}
            {showingPresentation && (
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
          className="p-3"
          style={{ minHeight: colCount > 1 ? `${colCount * 22 + 8}px` : undefined }}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {showData && colCount > 0 && rowCount > 0 ? (
            <div className="relative">
              <div className="nodrag flex flex-col gap-2">
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
              </div>
              {isDragOver && firstImageColIdx >= 0 && (
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
    </div>
  )
}

export const LoopNode = memo(LoopNodeComponent)
