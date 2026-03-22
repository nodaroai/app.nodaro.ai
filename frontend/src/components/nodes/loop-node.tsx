"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Film, Image, Info, Loader2, Music, Plus, Repeat, Table2, Type, Upload } from "lucide-react"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { LOOP_COLUMN_TYPE_META, type LoopNodeData, type LoopColumn } from "@/types/nodes"
import { CachedImage } from "@/components/ui/cached-image"
import { useFileUpload } from "@/hooks/use-file-upload"
import { StorageExceededModal } from "@/components/credits/StorageExceededModal"

const HANDLE_COLOR_MAP: Record<string, "pink" | "indigo" | "green" | "cyan"> = {
  "image-url": "pink",
  "video-url": "indigo",
  "audio-url": "green",
  "text": "cyan",
}

const THUMB_SIZE_CONFIG = {
  sm: { px: 24, maxWidth: 220, imgClass: "w-6 h-6" },
  md: { px: 48, maxWidth: 280, imgClass: "w-12 h-12" },
  lg: { px: 80, maxWidth: 400, imgClass: "w-20 h-20" },
} as const

function buildHandles(columns: ReadonlyArray<LoopColumn>) {
  const target = {
    id: "in",
    type: "target" as const,
    position: Position.Left,
    customStyle: { top: 'calc(100% - 20px)', left: '-29px' },
    hideHandle: true,
  }

  if (columns.length === 0) {
    return [target]
  }

  const startPct = 30
  const endPct = 80
  const sources = columns.map((col, i) => {
    const pct = columns.length === 1
      ? Math.round((startPct + endPct) / 2)
      : Math.round(startPct + (i / (columns.length - 1)) * (endPct - startPct))
    return {
      id: col.handleId,
      type: "source" as const,
      position: Position.Right,
      top: `${pct}%`,
      customStyle: { top: `${pct}%`, right: '-29px' },
      hideHandle: true,
    }
  })

  return [target, ...sources]
}

function LoopNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LoopNodeData
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const edges = useWorkflowStore((s) => s.edges)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const updateNodeInternals = useUpdateNodeInternals()
  const status = (nodeData as Record<string, unknown>).executionStatus as string | undefined ?? "idle"
  const [showData, setShowData] = useState(false)

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

  const hasUpstreamInput = useMemo(
    () => edges.some((e) => e.target === id && e.targetHandle === "in"),
    [edges, id],
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

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (firstImageColIdx < 0 || uploadingRows.size > 0) return

    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"))
    if (files.length === 0) return

    // Use a local mutable variable to track latest rows (avoids stale closure)
    let latestRows = [...(nodeData.rows ?? [])]
    const newRowIndices: number[] = []

    // Create empty rows for each file
    for (const _ of files) {
      const newRow = columns.map(() => "")
      latestRows.push(newRow)
      newRowIndices.push(latestRows.length - 1)
    }
    updateNodeData(id, { rows: latestRows })

    // Upload files serially to avoid clobbering useFileUpload singleton state
    for (let i = 0; i < files.length; i++) {
      const rowIdx = newRowIndices[i]
      setUploadingRows((prev) => new Set(prev).add(rowIdx))
      try {
        const result = await upload(files[i])
        latestRows = latestRows.map((row, ri) =>
          ri === rowIdx
            ? row.map((cell, ci) => ci === firstImageColIdx ? result.url : cell)
            : row
        )
        updateNodeData(id, { rows: latestRows })
      } catch {
        // Error handled by useFileUpload (storageExceeded state)
      } finally {
        setUploadingRows((prev) => {
          const next = new Set(prev)
          next.delete(rowIdx)
          return next
        })
      }
    }
  }, [id, columns, nodeData.rows, firstImageColIdx, updateNodeData, upload, uploadingRows.size])

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

  let statusText: string
  if (hasUpstreamInput) {
    statusText = "Connected: waiting for input..."
  } else if (colCount > 0) {
    statusText = `${rowCount} row${rowCount !== 1 ? "s" : ""} \u00D7 ${colCount} col${colCount !== 1 ? "s" : ""}`
  } else {
    statusText = "Click to configure..."
  }

  const sourceHandles = handles.filter(h => h.type === "source")
  const hasTarget = handles.some(h => h.id === "in")

  return (
    <div className="relative" style={{ maxWidth: `${sizeConfig.maxWidth}px` }}>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleCellFileSelect}
        className="hidden"
        ref={hiddenFileRef}
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
        minWidth={sizeConfig.maxWidth}
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
            {showData && colCount > 0 && (
              <div className="flex items-center bg-muted/30 rounded-md overflow-hidden">
                {(["sm", "md", "lg"] as const).map((size) => (
                  <button
                    key={size}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); updateNodeData(id, { thumbnailSize: size }) }}
                    className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase transition-colors ${
                      thumbSize === size
                        ? "bg-[#ff0073]/15 text-[#ff0073]"
                        : "text-muted-foreground/50 hover:text-muted-foreground"
                    }`}
                  >
                    {size.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
            {status !== "running" && (
              <RunNodeButton nodeId={id} credits={0} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
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
            <div className="overflow-auto max-h-[200px] rounded border border-border/40 relative">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="bg-muted/30">
                    {columns.map((col, ci) => {
                      const meta = LOOP_COLUMN_TYPE_META[col.type ?? "text"]
                      const colColor = meta?.color ?? "#38BDF8"
                      const w = getColWidth(ci, col)
                      return (
                        <th key={col.id} className="px-1.5 py-1 text-left font-medium whitespace-nowrap border-b border-border/30 relative select-none"
                          style={w ? { width: `${w}px`, minWidth: `${w}px` } : undefined}>
                          <span className="inline-flex items-center gap-1">
                            <span className="text-[8px] px-1 py-0.5 rounded font-semibold"
                              style={{ background: `${colColor}20`, color: colColor }}>
                              {meta?.shortLabel ?? "TXT"}
                            </span>
                            <span className="text-muted-foreground truncate max-w-[60px]">{col.name}</span>
                          </span>
                          <div
                            className="absolute top-0 right-0 bottom-0 w-[6px] cursor-col-resize hover:bg-[#ff0073]/30 transition-colors"
                            onMouseDown={(e) => {
                              e.stopPropagation()
                              e.preventDefault()
                              const th = (e.target as HTMLElement).parentElement!
                              setResizingCol({ colIdx: columns.indexOf(col), startX: e.clientX, startWidth: th.offsetWidth })
                            }}
                          />
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIdx) => (
                    <tr key={rowIdx} className={`${rowIdx % 2 === 0 ? "bg-muted/10" : ""} relative`}>
                      {uploadingRows.has(rowIdx) ? (
                        <td colSpan={columns.length} className="px-1.5 py-1 text-center">
                          <Loader2 className="w-3 h-3 animate-spin text-[#38BDF8] inline-block" />
                        </td>
                      ) : (
                        columns.map((col, colIdx) => {
                          const cell = row[colIdx] ?? ""
                          const colType = col.type ?? "text"
                          const tdW = getColWidth(colIdx, col)
                          return (
                            <td key={col.id} className="px-1.5 py-0.5 align-middle border-b border-border/20"
                              style={tdW ? { width: `${tdW}px`, minWidth: `${tdW}px` } : undefined}>
                              {colType === "image-url" ? (
                                cell ? (
                                  <CachedImage
                                    src={cell}
                                    alt=""
                                    thumbnail
                                    thumbnailWidth={sizeConfig.px * 2}
                                    className={`${sizeConfig.imgClass} object-cover rounded`}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className={`${sizeConfig.imgClass} rounded border-2 border-dashed border-[#38BDF8]/30 flex items-center justify-center hover:border-[#38BDF8]/60 hover:bg-[#38BDF8]/5 transition-colors`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      fileInputRef.current = { rowIdx, colIdx }
                                      hiddenFileRef.current?.click()
                                    }}
                                  >
                                    <Plus className="w-3 h-3 text-[#38BDF8]/60" />
                                  </button>
                                )
                              ) : colType === "video-url" || colType === "audio-url" ? (
                                <span className="text-muted-foreground/60 italic">
                                  {cell ? "media" : "\u2014"}
                                </span>
                              ) : (
                                <span className="text-muted-foreground truncate block" style={{ maxWidth: `${sizeConfig.maxWidth - 80}px` }} title={cell}>
                                  {cell || "\u2014"}
                                </span>
                              )}
                            </td>
                          )
                        })
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {isDragOver && firstImageColIdx >= 0 && (
                <div className="absolute inset-0 bg-[#38BDF8]/10 border-2 border-dashed border-[#38BDF8]/60 rounded flex items-center justify-center z-10">
                  <div className="flex items-center gap-1.5 text-[#38BDF8] text-xs font-medium">
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
                      <span key={col.id} className="text-[9px] px-1.5 py-0.5 rounded font-semibold"
                        style={{
                          background: `${colColor}20`,
                          color: colColor,
                        }}>
                        {col.name}
                      </span>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </BaseNode>
      {hasTarget && <HandleIcon icon={<Type />} side="left" top="calc(100% - 20px)" />}
      {sourceHandles.map((h) => {
        const col = columns.find((c) => c.handleId === h.id)
        const colType = col?.type ?? "text"
        const icon = colType === "image-url" ? <Image />
          : colType === "video-url" ? <Film />
          : colType === "audio-url" ? <Music />
          : <Type />
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
