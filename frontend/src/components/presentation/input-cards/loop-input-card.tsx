import { useCallback, useMemo, useRef, useState } from "react"
import { Plus, X, Upload, Film, Music } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useFileUpload } from "@/hooks/use-file-upload"
import { hasCredits } from "@/lib/edition"
import { CachedImage } from "@/components/ui/cached-image"
import { LOOP_COLUMN_TYPE_META, type WorkflowNode, type LoopColumn, type PresentationDisplay } from "@/types/nodes"
import { resolveDisplay, ELEMENT_SIZES, isMediaColumn, colTypeToMimePrefix } from "@/lib/presentation-display"
import { GlassCard } from "../output-cards/shared"

interface LoopInputCardProps {
  node: WorkflowNode
  isFullscreen: boolean
  inputValues: Record<string, Record<string, unknown>>
  onUpdateInput: (nodeId: string, key: string, value: unknown) => void
  readOnly?: boolean
  maxItems: number
  display?: PresentationDisplay
}

function getFilenameFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const segments = pathname.split("/")
    return segments[segments.length - 1] || "file"
  } catch {
    return "file"
  }
}

/** Upload + preview cell for image, video, and audio columns */
function MediaCellInput({
  value,
  onChange,
  mimePrefix,
  readOnly,
  thumbnailSize,
}: {
  value: string
  onChange: (val: string) => void
  mimePrefix: string
  readOnly?: boolean
  thumbnailSize?: number
}) {
  const { upload, isUploading } = useFileUpload()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

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

  const thumbPx = thumbnailSize ?? 48
  const thumbStyle = { width: thumbPx, height: thumbPx }

  if (value) {
    return (
      <div className="flex items-center gap-2 bg-muted/30 border border-border rounded-lg px-2 py-1.5">
        {mimePrefix === "image/" && (
          <CachedImage
            src={value}
            alt="upload"
            className="object-cover rounded-md shrink-0"
            style={thumbStyle}
          />
        )}
        {mimePrefix === "video/" && (
          <div className="rounded-md bg-muted/50 flex items-center justify-center shrink-0" style={thumbStyle}>
            <Film className="w-5 h-5 text-[#818CF8]" />
          </div>
        )}
        {mimePrefix === "audio/" && (
          <div className="rounded-md bg-muted/50 flex items-center justify-center shrink-0" style={thumbStyle}>
            <Music className="w-5 h-5 text-[#22c55e]" />
          </div>
        )}
        <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
          {getFilenameFromUrl(value)}
        </span>
        {!readOnly && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Remove"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    )
  }

  if (readOnly) {
    return (
      <div className="flex items-center justify-center h-14 bg-muted/20 rounded-lg border border-border text-xs text-muted-foreground/50">
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
          <span className="hidden sm:inline text-xs text-muted-foreground">Drop or click to upload</span>
          <span className="sm:hidden text-xs text-muted-foreground">Tap to upload</span>
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

export function LoopInputCard({
  node,
  isFullscreen,
  inputValues,
  onUpdateInput,
  readOnly,
  maxItems,
  display,
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
    <GlassCard>
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
          resolved={resolved}
          handleCellChange={handleCellChange}
          handleRemoveRow={handleRemoveRow}
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

      {hasCredits() && (
        <div className="mt-3 px-3 py-2 rounded-md bg-[#ff007310] border border-[#ff007330] flex justify-between items-center">
          <span className="text-xs text-[#ff0073]">Fan-out</span>
          <span className="text-sm font-semibold text-[#ff0073]">
            {rows.length} {rows.length === 1 ? "iteration" : "iterations"}
          </span>
        </div>
      )}
    </GlassCard>
  )
}

/* ------------------------------------------------------------------ */
/*  Cards View                                                         */
/* ------------------------------------------------------------------ */

interface ViewProps {
  columns: LoopColumn[]
  rows: string[][]
  readOnly?: boolean
  resolved: Required<PresentationDisplay>
  handleCellChange: (rowIndex: number, colIndex: number, value: string) => void
  handleRemoveRow: (index: number) => void
}

interface CardsViewProps extends ViewProps {
  mediaColIndices: number[]
  textColIndices: number[]
}

function CardsView({
  columns,
  rows,
  readOnly,
  resolved,
  mediaColIndices,
  textColIndices,
  handleCellChange,
  handleRemoveRow,
}: CardsViewProps) {
  const hasMedia = mediaColIndices.length > 0
  const imgSize = ELEMENT_SIZES.cardsImage[resolved.elementSize]

  const gridStyle = resolved.columns > 1
    ? { display: "grid", gridTemplateColumns: `repeat(${resolved.columns}, 1fr)`, gap: "0.75rem" }
    : undefined

  return (
    <div style={gridStyle} className={resolved.columns <= 1 ? "flex flex-col gap-3" : undefined}>
      {rows.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="border border-border/50 rounded-lg p-3 bg-muted/10"
        >
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
                      <MediaCellInput
                        value={row[ci] ?? ""}
                        onChange={(val) => handleCellChange(rowIndex, ci, val)}
                        mimePrefix={colTypeToMimePrefix(colType)}
                        readOnly={readOnly}
                        thumbnailSize={imgSize}
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
                        <span className="text-[11px] text-muted-foreground/70">{col.name}</span>
                        <textarea
                          value={row[ci] ?? ""}
                          onChange={(e) => handleCellChange(rowIndex, ci, e.target.value)}
                          readOnly={readOnly}
                          placeholder={`${col.name}...`}
                          className={`w-full min-h-[56px] bg-muted/30 border border-border rounded-lg px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-[#ff0073]/50 focus:ring-1 focus:ring-[#ff0073]/30 transition-all duration-200${readOnly ? " opacity-70 cursor-default" : ""}`}
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
                  <span className="text-[11px] text-muted-foreground/70">{col.name}</span>
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
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Table View                                                         */
/* ------------------------------------------------------------------ */

function TableView({
  columns,
  rows,
  readOnly,
  resolved,
  handleCellChange,
  handleRemoveRow,
}: ViewProps) {
  const thumbSize = ELEMENT_SIZES.tableThumbnail[resolved.elementSize]

  return (
    <div className="w-full overflow-x-auto rounded-lg border border-border/50">
      <table className="w-full text-sm">
        {/* Sticky header */}
        <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur-sm">
          <tr>
            {columns.map((col) => {
              const colType = col.type ?? "text"
              const meta = LOOP_COLUMN_TYPE_META[colType as LoopColumn["type"]] ?? LOOP_COLUMN_TYPE_META.text
              return (
                <th key={col.id} className="px-3 py-2 text-left">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground/70 font-medium">
                      {col.name}
                    </span>
                    <span
                      className="text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded"
                      style={{
                        color: meta.color,
                        backgroundColor: `${meta.color}15`,
                      }}
                    >
                      {meta.shortLabel}
                    </span>
                  </div>
                </th>
              )
            })}
            {/* Delete column header */}
            {!readOnly && <th className="w-8 px-2 py-2" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className={rowIndex % 2 === 1 ? "bg-muted/5" : undefined}
            >
              {columns.map((col, colIndex) => {
                const colType = col.type ?? "text"
                const cellValue = row[colIndex] ?? ""
                const isMedia = colType !== "text"

                return (
                  <td key={col.id} className="px-3 py-2 align-middle">
                    {isMedia ? (
                      <div style={{ width: thumbSize }}>
                        <MediaCellInput
                          value={cellValue}
                          onChange={(val) => handleCellChange(rowIndex, colIndex, val)}
                          mimePrefix={
                            colType === "image-url"
                              ? "image/"
                              : colType === "video-url"
                                ? "video/"
                                : "audio/"
                          }
                          readOnly={readOnly}
                          thumbnailSize={thumbSize}
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={cellValue}
                        onChange={(e) => handleCellChange(rowIndex, colIndex, e.target.value)}
                        readOnly={readOnly}
                        disabled={readOnly}
                        placeholder={`${col.name}...`}
                        className={`w-full bg-transparent border-none text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none${readOnly ? " opacity-70 cursor-default" : ""}`}
                      />
                    )}
                  </td>
                )
              })}
              {/* Per-row delete button */}
              {!readOnly && (
                <td className="px-2 py-2 align-middle">
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
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
