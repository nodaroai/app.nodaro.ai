import { useCallback, useMemo, useRef, useState } from "react"
import { Plus, X, Upload, Film, Maximize2, Download, Link, GripVertical } from "lucide-react"
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useFileUpload } from "@/hooks/use-file-upload"
import { CachedImage } from "@/components/ui/cached-image"
import { GlassButton, copyUrl, downloadFile } from "../output-cards/shared"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { PromptHelperButton } from "@/components/editor/config-panels/prompt-helper-button"
import type { PromptContext } from "@/lib/prompt-context"
import { type WorkflowNode, type LoopColumn, type PresentationDisplay } from "@/types/nodes"
import { resolveDisplay, ELEMENT_SIZES, isMediaColumn, colTypeToMimePrefix } from "@/lib/presentation-display"

interface LoopInputCardProps {
  node: WorkflowNode
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
  maxItems: number
  display?: PresentationDisplay
  promptHelper?: PromptContext
}

const POINTER_SENSOR_OPTS = { activationConstraint: { distance: 5 } }
const TOUCH_SENSOR_OPTS = { activationConstraint: { delay: 150, tolerance: 5 } }

const TEXTAREA_CLS = "w-full min-h-[56px] bg-muted/30 border border-border rounded-lg px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-[#ff0073]/50 focus:ring-1 focus:ring-[#ff0073]/30 transition-all duration-200"

function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const segments = pathname.split("/")
    return segments[segments.length - 1] || "file"
  } catch {
    return "file"
  }
}

/** Shared overlay buttons for media cells (Enlarge, Download, Copy URL, Remove) */
function MediaOverlayButtons({
  url,
  onPreview,
  onRemove,
  readOnly,
}: {
  url: string
  onPreview: () => void
  onRemove: () => void
  readOnly?: boolean
}) {
  return (
    <div className="media-overlay-controls absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
      <GlassButton onClick={onPreview} title="Enlarge">
        <Maximize2 className="w-3.5 h-3.5" />
      </GlassButton>
      <GlassButton onClick={() => downloadFile(url, getFilenameFromUrl(url))} title="Download">
        <Download className="w-3.5 h-3.5" />
      </GlassButton>
      <GlassButton onClick={() => copyUrl(url)} title="Copy URL">
        <Link className="w-3.5 h-3.5" />
      </GlassButton>
      {!readOnly && (
        <GlassButton onClick={onRemove} title="Remove">
          <X className="w-3.5 h-3.5" />
        </GlassButton>
      )}
    </div>
  )
}

/** Rich media cell with fullscreen preview, hover overlay, and full-width display */
function RichMediaCell({
  value,
  onChange,
  mimePrefix,
  readOnly,
}: {
  value: string
  onChange: (val: string) => void
  mimePrefix: string
  readOnly?: boolean
}) {
  const { upload, isUploading } = useFileUpload()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith(mimePrefix)) return
      try {
        const result = await upload(file)
        onChange(result.url)
      } catch {
        // Error handled by useFileUpload hook
      }
    },
    [mimePrefix, upload, onChange],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile],
  )

  const mediaType = mimePrefix === "image/" ? "image" : mimePrefix === "video/" ? "video" : "audio"

  if (value) {
    return (
      <>
        {mimePrefix === "image/" && (
          <div className="relative group rounded-lg overflow-hidden cursor-pointer" onClick={() => setPreviewOpen(true)}>
            <CachedImage
              src={value}
              alt="upload"
              className="w-full max-h-[200px] object-cover rounded-lg"
            />
            <MediaOverlayButtons url={value} onPreview={() => setPreviewOpen(true)} onRemove={() => onChange("")} readOnly={readOnly} />
          </div>
        )}
        {mimePrefix === "video/" && (
          <div className="relative group rounded-lg overflow-hidden cursor-pointer" onClick={() => setPreviewOpen(true)}>
            <video
              src={value}
              className="w-full max-h-[200px] object-cover rounded-lg"
              muted
              playsInline
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
                <Film className="w-4 h-4 text-white ml-0.5" />
              </div>
            </div>
            <MediaOverlayButtons url={value} onPreview={() => setPreviewOpen(true)} onRemove={() => onChange("")} readOnly={readOnly} />
          </div>
        )}
        {mimePrefix === "audio/" && (
          <div className="relative group flex items-center gap-2 rounded-lg p-2">
            <audio src={value} controls className="flex-1 h-8 [&::-webkit-media-controls-panel]:bg-transparent" />
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              <GlassButton onClick={() => downloadFile(value, getFilenameFromUrl(value))} title="Download">
                <Download className="w-3.5 h-3.5" />
              </GlassButton>
              {!readOnly && (
                <GlassButton onClick={() => onChange("")} title="Remove">
                  <X className="w-3.5 h-3.5" />
                </GlassButton>
              )}
            </div>
          </div>
        )}
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type={mediaType}
          url={value}
        />
      </>
    )
  }

  if (readOnly) {
    return (
      <div className="flex items-center justify-center h-14 bg-muted/10 rounded-lg text-xs text-muted-foreground/50">
        No file
      </div>
    )
  }

  return (
    <div
      className={`relative flex items-center justify-center h-14 border-2 border-dashed rounded-lg transition-all duration-200 cursor-pointer ${
        isDragOver
          ? "border-[#ff0073]/60 bg-[#ff0073]/5"
          : "border-muted-foreground/20 hover:border-[#ff0073]/50 bg-muted/10"
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
    >
      {isUploading ? (
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 border-2 border-[#ff0073]/40 border-t-[#ff0073] rounded-full animate-spin" />
          <span className="text-[11px] text-muted-foreground">Uploading...</span>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <Upload className="w-4 h-4 text-muted-foreground/40" />
          <span className="text-xs text-muted-foreground">Drop or click</span>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept={`${mimePrefix}*`}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ""
        }}
      />
    </div>
  )
}

function BottomDropZone({
  onDrop,
  mimePrefix,
}: {
  onDrop: (files: File[]) => void
  mimePrefix: string
}) {
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      className={`mt-3 flex items-center justify-center py-3 border-2 border-dashed rounded-lg transition-all duration-200 cursor-pointer ${
        isDragOver
          ? "border-[#ff0073]/60 bg-[#ff0073]/5"
          : "border-muted-foreground/15 hover:border-[#ff0073]/40"
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "copy"
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragOver(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length > 0) onDrop(files)
      }}
      onClick={() => fileInputRef.current?.click()}
    >
      <div className="flex items-center gap-1.5">
        <Upload className="w-4 h-4 text-muted-foreground/40" />
        <span className="text-xs text-muted-foreground/60">Drop files to add rows, or click to browse</span>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={`${mimePrefix}*`}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length > 0) onDrop(files)
          e.target.value = ""
        }}
      />
    </div>
  )
}

export function LoopInputCard({
  node,
  isFullscreen,
  inputValues,
  onUpdateInput,
  readOnly,
  maxItems,
  display,
  promptHelper,
}: LoopInputCardProps) {
  const columns: LoopColumn[] = useMemo(
    () => (node.data.columns as LoopColumn[]) ?? [],
    [node.data.columns],
  )

  const resolved = useMemo(
    () => resolveDisplay(
      node.data.presentationDisplay as PresentationDisplay | undefined,
      display,
      "loop",
      columns,
    ),
    [node.data.presentationDisplay, display, columns],
  )

  const rows: string[][] = useMemo(() => {
    if (isFullscreen) {
      const stored = inputValues[node.id]?.rows
      if (Array.isArray(stored) && stored.length > 0) return stored as string[][]
    } else {
      const raw = node.data.rows as string[][] | undefined
      if (Array.isArray(raw) && raw.length > 0) return raw
    }
    // Initialize with one empty row matching column count
    return [columns.map(() => "")]
  }, [isFullscreen, inputValues, node.id, node.data.rows, columns])

  const updateRows = useCallback(
    (newRows: string[][]) => {
      if (isFullscreen) {
        onUpdateInput(node.id, "rows", newRows)
      } else {
        useWorkflowStore.getState().updateNodeData(node.id, { rows: newRows })
      }
    },
    [isFullscreen, node.id, onUpdateInput],
  )

  const handleCellChange = useCallback(
    (rowIndex: number, colIndex: number, value: string) => {
      const next = rows.map((row, ri) =>
        ri === rowIndex ? row.map((cell, ci) => (ci === colIndex ? value : cell)) : row,
      )
      updateRows(next)
    },
    [rows, updateRows],
  )

  const handleAddRow = useCallback(() => {
    if (rows.length >= maxItems) return
    updateRows([...rows, columns.map(() => "")])
  }, [rows, maxItems, columns, updateRows])

  const handleRemoveRow = useCallback(
    (index: number) => {
      if (rows.length <= 1) return
      updateRows(rows.filter((_, i) => i !== index))
    },
    [rows, updateRows],
  )

  const rowIds = useMemo(
    () => rows.map((_, i) => `row-${i}`),
    [rows],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, POINTER_SENSOR_OPTS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTS),
  )

  const handleReorderRows = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = rowIds.indexOf(active.id as string)
      const newIndex = rowIds.indexOf(over.id as string)
      if (oldIndex === -1 || newIndex === -1) return
      const next = [...rows]
      const [moved] = next.splice(oldIndex, 1)
      next.splice(newIndex, 0, moved)
      updateRows(next)
    },
    [rowIds, rows, updateRows],
  )

  const { upload } = useFileUpload()

  // Use a ref to always get fresh rows (avoids stale closure in async uploads)
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const handleMultiFileDrop = useCallback(
    async (files: File[], targetColIndex: number) => {
      const col = columns[targetColIndex]
      if (!col) return
      const mimePrefix = colTypeToMimePrefix(col.type ?? "text")
      const validFiles = Array.from(files).filter((f) => f.type.startsWith(mimePrefix))
      const slotsAvailable = maxItems - rowsRef.current.length
      const filesToProcess = validFiles.slice(0, slotsAvailable)
      if (filesToProcess.length === 0) return

      // Create new rows immediately with empty values, then fill as uploads complete
      const baseRowIndex = rowsRef.current.length
      const newRows = filesToProcess.map(() => columns.map(() => ""))
      const combined = [...rowsRef.current, ...newRows]
      updateRows(combined)

      // Upload in parallel, batch results into a single state update
      const results = new Map<number, string>()
      await Promise.allSettled(
        filesToProcess.map(async (file, i) => {
          try {
            const result = await upload(file)
            results.set(baseRowIndex + i, result.url)
          } catch {
            // Individual upload errors handled by hook
          }
        }),
      )
      if (results.size > 0) {
        const freshRows = [...rowsRef.current]
        for (const [ri, url] of results) {
          if (freshRows[ri]) {
            freshRows[ri] = freshRows[ri].map((cell, ci) =>
              ci === targetColIndex ? url : cell,
            )
          }
        }
        updateRows(freshRows)
      }
    },
    [columns, maxItems, updateRows, upload],
  )

  const firstMediaColIndex = useMemo(
    () => columns.findIndex((col) => isMediaColumn(col.type ?? "text")),
    [columns],
  )

  const atMax = rows.length >= maxItems
  const label = (node.data.label as string) || "Table"

  const { mediaColIndices, textColIndices } = useMemo(() => {
    const media: number[] = []
    const text: number[] = []
    columns.forEach((col, i) => {
      if (isMediaColumn(col.type)) media.push(i)
      else text.push(i)
    })
    return { mediaColIndices: media, textColIndices: text }
  }, [columns])

  return (
    <div>
      {/* Shared header */}
      <div className="flex items-center justify-between mb-3">
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground/70">
            {rows.length} of {maxItems} max
          </span>
          {!readOnly && (
            <button
              type="button"
              onClick={handleAddRow}
              disabled={atMax}
              className="flex items-center justify-center w-6 h-6 rounded-md bg-[#ff0073] text-white transition-opacity duration-150 disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90"
              title="Add row"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* View mode: cards or table */}
      {resolved.viewMode === "table" ? (
        <TableView
          columns={columns}
          rows={rows}
          readOnly={readOnly}
          handleCellChange={handleCellChange}
          handleRemoveRow={handleRemoveRow}
          rowIds={rowIds}
          sensors={sensors}
          onReorder={handleReorderRows}
          onMultiFileDrop={handleMultiFileDrop}
          promptHelper={promptHelper}
        />
      ) : (
        <CardsView
          columns={columns}
          rows={rows}
          readOnly={readOnly}
          resolved={resolved}
          mediaColIndices={mediaColIndices}
          textColIndices={textColIndices}
          handleCellChange={handleCellChange}
          handleRemoveRow={handleRemoveRow}
          rowIds={rowIds}
          sensors={sensors}
          onReorder={handleReorderRows}
          promptHelper={promptHelper}
        />
      )}

      {/* Multi-file drop zone */}
      {!readOnly && !atMax && firstMediaColIndex >= 0 && (
        <BottomDropZone
          onDrop={(files) => handleMultiFileDrop(files, firstMediaColIndex)}
          mimePrefix={colTypeToMimePrefix(columns[firstMediaColIndex].type ?? "text")}
        />
      )}

      {/* Mobile-only full-width add button */}
      {!readOnly && !atMax && (
        <button
          type="button"
          onClick={handleAddRow}
          className="sm:hidden w-full mt-3 py-2 border-2 border-dashed border-muted-foreground/20 rounded-lg text-xs text-muted-foreground/60 hover:border-[#ff0073]/40 hover:text-muted-foreground transition-colors"
        >
          + Add Row
        </button>
      )}

    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Shared View Types                                                  */
/* ------------------------------------------------------------------ */

interface ViewProps {
  columns: LoopColumn[]
  rows: string[][]
  readOnly?: boolean
  handleCellChange: (rowIndex: number, colIndex: number, value: string) => void
  handleRemoveRow: (index: number) => void
  rowIds: string[]
  sensors: ReturnType<typeof useSensors>
  onReorder: (event: DragEndEvent) => void
  onMultiFileDrop?: (files: File[], colIndex: number) => void
  promptHelper?: PromptContext
}

interface CardsViewProps extends ViewProps {
  resolved: Required<PresentationDisplay>
  mediaColIndices: number[]
  textColIndices: number[]
}

/* ------------------------------------------------------------------ */
/*  Sortable Row Components                                            */
/* ------------------------------------------------------------------ */

function SortableRow({
  id,
  readOnly,
  children,
}: {
  id: string
  readOnly?: boolean
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="border-b border-border/10 last:border-b-0">
      <div className="flex items-center gap-2 py-2">
        {!readOnly && (
          <div
            {...attributes}
            {...listeners}
            className="shrink-0 w-6 h-6 flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

function SortableCardRow({
  id,
  readOnly,
  children,
}: {
  id: string
  readOnly?: boolean
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="border-b border-border/10 last:border-b-0 pb-3 last:pb-0">
      <div className="flex items-start gap-2">
        {!readOnly && (
          <div
            {...attributes}
            {...listeners}
            className="shrink-0 mt-1 w-6 h-6 flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing"
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          {children}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Cards View                                                         */
/* ------------------------------------------------------------------ */

function CardsView({
  columns,
  rows,
  readOnly,
  resolved,
  mediaColIndices,
  textColIndices,
  handleCellChange,
  handleRemoveRow,
  rowIds,
  sensors,
  onReorder,
  promptHelper,
}: CardsViewProps) {
  const hasMedia = mediaColIndices.length > 0
  const imgSize = ELEMENT_SIZES.cardsImage[resolved.elementSize]

  const gridStyle = resolved.columns > 1
    ? { display: "grid", gridTemplateColumns: `repeat(${resolved.columns}, 1fr)`, gap: "0.75rem" }
    : undefined

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
      <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
        <div style={gridStyle} className={resolved.columns <= 1 ? "flex flex-col gap-3" : undefined}>
          {rows.map((row, rowIndex) => (
            <SortableCardRow key={rowIds[rowIndex]} id={rowIds[rowIndex]} readOnly={readOnly}>
              {/* Row header */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                  Row {rowIndex + 1}
                </span>
                {!readOnly && rows.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(rowIndex)}
                    className="text-[11px] text-muted-foreground/50 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>

              {/* Card body: media left, text right (or text-only stack) */}
              {hasMedia ? (
                <div className="flex gap-3">
                  {/* Media columns on the left */}
                  <div className="flex flex-col gap-2 shrink-0" style={{ width: imgSize }}>
                    {mediaColIndices.map((ci) => {
                      const col = columns[ci]
                      const colType = col.type ?? "text"
                      return (
                        <div key={col.id}>
                          <RichMediaCell
                            value={row[ci] ?? ""}
                            onChange={(val) => handleCellChange(rowIndex, ci, val)}
                            mimePrefix={colTypeToMimePrefix(colType)}
                            readOnly={readOnly}
                          />
                        </div>
                      )
                    })}
                  </div>

                  {/* Text columns on the right */}
                  {textColIndices.length > 0 && (
                    <div className="flex-1 min-w-0 flex flex-col gap-2">
                      {textColIndices.map((ci) => {
                        const col = columns[ci]
                        return (
                          <div key={col.id} className="flex flex-col gap-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-muted-foreground/70">{col.name}</span>
                              {promptHelper && (
                                <PromptHelperButton
                                  nodeType={promptHelper.nodeType}
                                  currentPrompt={row[ci] ?? ""}
                                  provider={promptHelper.provider}
                                  aspectRatio={promptHelper.aspectRatio}
                                  duration={promptHelper.duration}
                                  onAccept={(text) => handleCellChange(rowIndex, ci, text)}
                                />
                              )}
                            </div>
                            <textarea
                              value={row[ci] ?? ""}
                              onChange={(e) => handleCellChange(rowIndex, ci, e.target.value)}
                              readOnly={readOnly}
                              placeholder={`${col.name}...`}
                              className={`${TEXTAREA_CLS}${readOnly ? " opacity-70 cursor-default" : ""}`}
                            />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : (
                /* No media — text-only vertical stack */
                <div className="flex flex-col gap-2">
                  {columns.map((col, colIndex) => (
                    <div key={col.id} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-muted-foreground/70">{col.name}</span>
                        {promptHelper && (
                          <PromptHelperButton
                            nodeType={promptHelper.nodeType}
                            currentPrompt={row[colIndex] ?? ""}
                            provider={promptHelper.provider}
                            aspectRatio={promptHelper.aspectRatio}
                            duration={promptHelper.duration}
                            onAccept={(text) => handleCellChange(rowIndex, colIndex, text)}
                          />
                        )}
                      </div>
                      <textarea
                        value={row[colIndex] ?? ""}
                        onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                        readOnly={readOnly}
                        placeholder={`${col.name}...`}
                        className={`w-full min-h-[56px] bg-muted/30 border border-border rounded-lg px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-[#ff0073]/50 focus:ring-1 focus:ring-[#ff0073]/30 transition-all duration-200${readOnly ? " opacity-70 cursor-default" : ""}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </SortableCardRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}

/* ------------------------------------------------------------------ */
/*  Table View (div-based layout for dnd-kit compat)                   */
/* ------------------------------------------------------------------ */

function TableView({
  columns,
  rows,
  readOnly,
  handleCellChange,
  handleRemoveRow,
  rowIds,
  sensors,
  onReorder,
  onMultiFileDrop,
  promptHelper,
}: ViewProps) {
  return (
    <div className="w-full overflow-x-auto">
      {/* Header row — only shown when multiple columns */}
      {columns.length > 1 && (
        <div className="flex items-center gap-2 py-2 sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
          {!readOnly && <div className="shrink-0 w-6" />}
          {columns.map((col, colIndex) => {
            const colType = col.type ?? "text"
            const isMedia = isMediaColumn(colType)
            return (
              <div
                key={col.id}
                className={`flex-1 min-w-0 px-2${isMedia && !readOnly ? " cursor-copy" : ""}`}
                onDragOver={isMedia && !readOnly ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy" } : undefined}
                onDrop={isMedia && !readOnly ? (e) => {
                  e.preventDefault()
                  const files = Array.from(e.dataTransfer.files)
                  if (files.length > 0) onMultiFileDrop?.(files, colIndex)
                } : undefined}
              >
                <span className="text-[11px] text-muted-foreground/70 font-medium">
                  {col.name}
                </span>
              </div>
            )
          })}
          {!readOnly && <div className="shrink-0 w-6" />}
        </div>
      )}

      {/* Sortable rows */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
        <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
          {rows.map((row, rowIndex) => (
            <SortableRow key={rowIds[rowIndex]} id={rowIds[rowIndex]} readOnly={readOnly}>
              {columns.map((col, colIndex) => {
                const colType = col.type ?? "text"
                const cellValue = row[colIndex] ?? ""
                const isMedia = isMediaColumn(colType)
                return (
                  <div key={col.id} className="flex-1 min-w-0 px-2">
                    {isMedia ? (
                      <RichMediaCell
                        value={cellValue}
                        onChange={(val) => handleCellChange(rowIndex, colIndex, val)}
                        mimePrefix={colTypeToMimePrefix(colType)}
                        readOnly={readOnly}
                      />
                    ) : (
                      <div className="relative group/cell">
                        <input
                          type="text"
                          value={cellValue}
                          onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                          readOnly={readOnly}
                          disabled={readOnly}
                          placeholder={`${col.name}...`}
                          className={`w-full bg-transparent border-none text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none pr-8${readOnly ? " opacity-70 cursor-default" : ""}`}
                        />
                        {promptHelper && (
                          <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover/cell:opacity-100 focus-within:opacity-100 sm:opacity-0 max-sm:opacity-100 transition-opacity">
                            <PromptHelperButton
                              nodeType={promptHelper.nodeType}
                              currentPrompt={cellValue}
                              provider={promptHelper.provider}
                              aspectRatio={promptHelper.aspectRatio}
                              duration={promptHelper.duration}
                              onAccept={(text) => handleCellChange(rowIndex, colIndex, text)}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {!readOnly && (
                <div className="shrink-0 w-6 flex items-center justify-center">
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(rowIndex)}
                      className="flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                      title="Remove row"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
            </SortableRow>
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}
