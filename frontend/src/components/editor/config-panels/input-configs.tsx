"use client"

import { useState, useCallback, useRef, useMemo } from "react"
import { X, Plus, Loader2, Check, Download, AlertCircle, Upload, Film, Music, Link, GripVertical } from "lucide-react"
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
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { useFileUpload } from "@/hooks/use-file-upload"
import { StorageExceededModal } from "@/components/credits/StorageExceededModal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TagTextarea } from "./tag-textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CachedImage } from "@/components/ui/cached-image"
import { uploadAudio, fetchYouTubeOEmbed, extractYouTubeAudioApi, getJobStatus, startVideoDownload, subscribeToDownloadProgress } from "@/lib/api"
import type { DownloadProgressEvent } from "@/lib/api"
import {
  LOOP_COLUMN_TYPE_META,
  type TextPromptData,
  type ListNodeData,
  type LoopNodeData,
  type LoopColumn,
  type UploadImageData,
  type UploadVideoData,
  type UploadAudioData,
  type RSSFeedData,
  type YouTubeVideoData,
  type ReferenceAudioData,
} from "@/types/nodes"
import type { ConfigProps } from "./types"

const COLUMN_ACCEPT: Record<string, string> = {
  "image-url": "image/png,image/jpeg,image/webp,image/gif",
  "video-url": "video/mp4,video/webm,video/quicktime",
  "audio-url": "audio/mpeg,audio/wav,audio/ogg,audio/webm",
}

export function TextPromptConfig({ data, onUpdate, nodeRefs, refMap, variableDisplayMode }: ConfigProps<TextPromptData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Prompt Text</Label>
        <TagTextarea
          rows={5}
          value={data.text}
          onChange={(value) => onUpdate({ text: value })}
          placeholder="Enter your story prompt..."
          nodeRefs={nodeRefs}
          displayMode={variableDisplayMode}
          refMap={refMap}
        />
      </div>
      {!!(data as Record<string, unknown>).presentationInput && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={!!(data as Record<string, unknown>).presentationReadOnly}
            onChange={(e) => onUpdate({ presentationReadOnly: e.target.checked })}
            className="rounded border-border"
          />
          Read-only in app
        </label>
      )}
    </div>
  )
}

export function ListConfig({ data, onUpdate }: { data: ListNodeData; onUpdate: (patch: Partial<ListNodeData>) => void }) {
  const [newItem, setNewItem] = useState("")
  const itemList = (data.items || "").split("\n").filter((l) => l.trim() !== "")

  function save(updated: ReadonlyArray<string>) {
    onUpdate({ items: updated.join("\n") })
  }

  function addItem(text: string) {
    if (!text.trim()) return
    save([...itemList, text.trim()])
    setNewItem("")
  }

  function updateItem(index: number, value: string) {
    const updated = itemList.map((item, i) => (i === index ? value : item))
    save(updated)
  }

  function removeItem(index: number) {
    save(itemList.filter((_, i) => i !== index))
  }

  return (
    <div className="flex flex-col gap-3">
      <Label>Items</Label>
      <div className="flex flex-col gap-1.5">
        {itemList.map((item, i) => (
          <div key={`item-${i}`} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{i + 1}</span>
            <input
              className="flex-1 text-sm bg-muted/30 rounded px-2 py-1 border border-border focus:border-[#ff0073] focus:outline-none"
              value={item}
              onChange={(e) => updateItem(i, e.target.value)}
            />
            <button
              type="button"
              className="shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
              onClick={() => removeItem(i)}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-5 text-right shrink-0" />
          <input
            className="flex-1 text-sm bg-muted/30 rounded px-2 py-1 border border-dashed border-border focus:border-[#ff0073] focus:outline-none"
            placeholder="Add item..."
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newItem.trim()) {
                e.preventDefault()
                addItem(newItem)
              }
            }}
            onBlur={() => {
              if (newItem.trim()) addItem(newItem)
            }}
          />
          <span className="w-3 shrink-0" />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {itemList.length} item{itemList.length !== 1 ? "s" : ""}
      </p>
      <div className="flex items-center gap-2 mt-3">
        <label className="text-xs text-muted-foreground">Max items in app mode</label>
        <input
          type="number"
          min={1}
          max={20}
          value={data.maxItems ?? 10}
          onChange={(e) => onUpdate({ maxItems: parseInt(e.target.value, 10) || 10 })}
          className="w-16 bg-background border border-border rounded px-2 py-1 text-xs"
        />
      </div>
    </div>
  )
}

function MediaCellInput({
  value,
  colType,
  onChange,
}: {
  value: string
  colType: LoopColumn["type"]
  onChange: (value: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { upload, isUploading, uploadError, clearError, storageExceeded, clearStorageExceeded } = useFileUpload()

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    clearError()
    try {
      const result = await upload(file)
      onChange(result.url)
    } catch {
      // handled by useFileUpload state
    }
    e.target.value = ""
  }

  const accept = COLUMN_ACCEPT[colType] ?? ""

  if (colType === "text") {
    return null
  }

  return (
    <div className="space-y-1">
      <input type="file" accept={accept} onChange={handleFileSelect} className="hidden" ref={fileInputRef} />

      {isUploading ? (
        <div className="flex items-center justify-center gap-2 py-3 rounded-md border border-border bg-muted/20">
          <Loader2 className="w-4 h-4 animate-spin text-[#38BDF8]" />
          <span className="text-xs text-muted-foreground">Uploading...</span>
        </div>
      ) : value ? (
        <div className="relative group">
          {colType === "image-url" ? (
            <div className="w-full aspect-video rounded-md overflow-hidden bg-muted/30">
              <CachedImage src={value} alt="" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="flex items-center gap-2 px-2 py-2 rounded-md border border-border bg-muted/20">
              {colType === "video-url" ? <Film className="w-4 h-4 text-[#818CF8]" /> : <Music className="w-4 h-4 text-[#22c55e]" />}
              <span className="text-xs text-muted-foreground truncate flex-1">{value.split("/").pop() || "media file"}</span>
            </div>
          )}
          <button
            type="button"
            className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-red-600/80 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onChange("")}
            title="Remove"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-md border-2 border-dashed border-muted-foreground/20 hover:border-[#38BDF8]/50 hover:bg-[#38BDF8]/5 text-muted-foreground/60 hover:text-[#38BDF8] transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="text-xs">Choose {colType === "image-url" ? "Image" : colType === "video-url" ? "Video" : "Audio"}</span>
          </button>
          <div className="flex items-center gap-1.5">
            <Link className="w-3 h-3 text-muted-foreground/40 shrink-0" />
            <input
              type="text"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="or paste URL..."
              className="w-full bg-transparent border-b border-muted-foreground/20 text-xs py-1 outline-none focus:border-[#38BDF8] transition-colors placeholder:text-muted-foreground/30"
            />
          </div>
        </>
      )}

      {uploadError && (
        <div className="flex items-center gap-1 text-[10px] text-red-400">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span className="truncate">{uploadError}</span>
        </div>
      )}

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

function SortableRow({
  id,
  children,
}: {
  id: string
  children: (props: { attributes: ReturnType<typeof useSortable>["attributes"]; listeners: ReturnType<typeof useSortable>["listeners"] }) => React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <tr
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {children({ attributes, listeners })}
    </tr>
  )
}

const COLUMN_TYPES = Object.entries(LOOP_COLUMN_TYPE_META).map(([value, meta]) => ({
  value,
  label: meta.label,
  color: meta.color,
}))

export function LoopConfig({ data, onUpdate }: { data: LoopNodeData; onUpdate: (patch: Partial<LoopNodeData>) => void }) {
  const [activeTab, setActiveTab] = useState<"configure" | "data">("configure")
  const columns = data.columns ?? []
  const rows = data.rows ?? []

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Stable row IDs for sortable
  const rowIds = useMemo(() => rows.map((_, i) => `row-${i}`), [rows.length])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = rowIds.indexOf(active.id as string)
    const newIndex = rowIds.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return
    onUpdate({ rows: arrayMove(rows, oldIndex, newIndex) })
  }

  function addColumn() {
    const id = crypto.randomUUID()
    const name = `Column ${columns.length + 1}`
    const newCol: LoopColumn = { id, name, handleId: `col_${id}`, type: "text" }
    const updatedRows = rows.map((row) => [...row, ""])
    onUpdate({ columns: [...columns, newCol], rows: updatedRows })
  }

  function removeColumn(colIndex: number) {
    const updatedCols = columns.filter((_, i) => i !== colIndex)
    const updatedRows = rows.map((row) => row.filter((_, i) => i !== colIndex))
    onUpdate({ columns: updatedCols, rows: updatedRows })
  }

  function renameColumn(colIndex: number, name: string) {
    const updatedCols = columns.map((col, i) =>
      i === colIndex ? { ...col, name } : col,
    )
    onUpdate({ columns: updatedCols })
  }

  function updateColumnType(colIndex: number, type: LoopColumn["type"]) {
    const newColumns = columns.map((c, i) =>
      i === colIndex ? { ...c, type } : c
    )
    onUpdate({ columns: newColumns })
  }

  function addRow() {
    const newRow = columns.map(() => "")
    onUpdate({ rows: [...rows, newRow] })
  }

  function removeRow(rowIndex: number) {
    onUpdate({ rows: rows.filter((_, i) => i !== rowIndex) })
  }

  function updateCell(rowIndex: number, colIndex: number, value: string) {
    const updatedRows = rows.map((row, ri) =>
      ri === rowIndex ? row.map((cell, ci) => (ci === colIndex ? value : cell)) : row,
    )
    onUpdate({ rows: updatedRows })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 mb-3">
        <button
          type="button"
          onClick={() => setActiveTab("configure")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeTab === "configure"
              ? "bg-[#ff0073]/15 text-[#ff0073]"
              : "text-muted-foreground hover:bg-muted/50"
          }`}
        >
          Configure
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("data")}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            activeTab === "data"
              ? "bg-[#ff0073]/15 text-[#ff0073]"
              : "text-muted-foreground hover:bg-muted/50"
          }`}
        >
          Data
        </button>
      </div>

      {activeTab === "configure" && (
        <>
          <div className="flex items-center justify-between">
            <Label>Table</Label>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={addColumn}
            >
              <Plus className="w-3 h-3" />
              Add Column
            </button>
          </div>

          {columns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/50">
              <p className="text-sm">No columns yet</p>
              <p className="text-xs mt-1">Add a column to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="w-6" />
                    {columns.map((col, ci) => (
                      <th key={col.id} className="pb-1 px-0.5">
                        <div className="flex items-center gap-0.5">
                          <input
                            className="flex-1 min-w-[60px] text-xs font-medium bg-muted/30 rounded px-1.5 py-1 border border-border focus:border-[#ff0073] focus:outline-none"
                            value={col.name}
                            onChange={(e) => renameColumn(ci, e.target.value)}
                          />
                          <button
                            type="button"
                            className="shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
                            onClick={() => removeColumn(ci)}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <Select
                          value={col.type ?? "text"}
                          onValueChange={(v) => updateColumnType(ci, v as LoopColumn["type"])}
                        >
                          <SelectTrigger className="h-5 mt-0.5 px-1.5 text-[10px] border-none bg-transparent hover:bg-muted/30 gap-0.5">
                            <span
                              className="inline-block rounded-full px-1.5 py-0 text-[10px] font-medium leading-4 text-white"
                              style={{ backgroundColor: COLUMN_TYPES.find((t) => t.value === (col.type ?? "text"))?.color ?? "#38BDF8" }}
                            >
                              {COLUMN_TYPES.find((t) => t.value === (col.type ?? "text"))?.label ?? "Text"}
                            </span>
                          </SelectTrigger>
                          <SelectContent position="popper">
                            {COLUMN_TYPES.map((ct) => (
                              <SelectItem key={ct.value} value={ct.value}>
                                <span className="flex items-center gap-1.5">
                                  <span
                                    className="inline-block w-2 h-2 rounded-full"
                                    style={{ backgroundColor: ct.color }}
                                  />
                                  {ct.label}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
                    <tbody>
                      {rows.map((row, ri) => (
                        <SortableRow key={rowIds[ri]} id={rowIds[ri]}>
                          {({ attributes, listeners }) => (
                            <>
                              <td className="pr-1 text-right align-middle">
                                <div className="flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    className="shrink-0 text-muted-foreground/30 hover:text-muted-foreground cursor-grab active:cursor-grabbing touch-none"
                                    {...attributes}
                                    {...listeners}
                                  >
                                    <GripVertical className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    className="shrink-0 text-muted-foreground/40 hover:text-red-500 transition-colors"
                                    onClick={() => removeRow(ri)}
                                  >
                                    <X className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              </td>
                              {columns.map((col, ci) => (
                                <td key={`${col.id}-${ri}`} className="px-0.5 py-0.5">
                                  {col.type && col.type !== "text" ? (
                                    <MediaCellInput
                                      value={row[ci] ?? ""}
                                      colType={col.type}
                                      onChange={(val) => updateCell(ri, ci, val)}
                                    />
                                  ) : (
                                    <input
                                      className="w-full min-w-[60px] text-xs bg-muted/30 rounded px-1.5 py-1 border border-border focus:border-[#ff0073] focus:outline-none"
                                      value={row[ci] ?? ""}
                                      onChange={(e) => updateCell(ri, ci, e.target.value)}
                                      placeholder={col.name}
                                    />
                                  )}
                                </td>
                              ))}
                            </>
                          )}
                        </SortableRow>
                      ))}
                    </tbody>
                  </SortableContext>
                </DndContext>
              </table>

              <button
                type="button"
                className="flex items-center gap-1 mt-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={addRow}
              >
                <Plus className="w-3 h-3" />
                Add Row
              </button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {rows.length} row{rows.length !== 1 ? "s" : ""} &times; {columns.length} column{columns.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <label className="text-xs text-muted-foreground">Max items in app mode</label>
            <input
              type="number"
              min={1}
              max={20}
              value={data.maxItems ?? 10}
              onChange={(e) => onUpdate({ maxItems: parseInt(e.target.value, 10) || 10 })}
              className="w-16 bg-background border border-border rounded px-2 py-1 text-xs"
            />
          </div>
        </>
      )}

      {activeTab === "data" && (
        <div className="space-y-2">
          {columns.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No columns configured. Switch to Configure tab to add columns.
            </p>
          ) : (
            <div className="max-h-[400px] overflow-auto rounded-lg border border-gray-200 dark:border-[#2D2D2D]">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 dark:bg-[#1a1a1a] sticky top-0">
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-8">#</th>
                    {columns.map((col) => {
                      const meta = LOOP_COLUMN_TYPE_META[col.type ?? "text"] ?? LOOP_COLUMN_TYPE_META.text
                      return (
                        <th key={col.id} className="px-3 py-2 text-left">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded"
                              style={{ background: `${meta.color}20`, color: meta.color }}>
                              {meta.shortLabel}
                            </span>
                            <span className="text-[11px] font-medium text-muted-foreground">{col.name}</span>
                          </div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 1 ? "bg-muted/5" : ""}>
                      <td className="px-3 py-2 text-[10px] text-muted-foreground/50 font-mono">{ri + 1}</td>
                      {columns.map((col, ci) => {
                        const val = row[ci] ?? ""
                        const isMedia = col.type !== "text"
                        return (
                          <td key={col.id} className="px-3 py-2 text-sm text-foreground">
                            {isMedia && val ? (
                              col.type === "image-url" ? (
                                <img src={val} alt="" className="w-12 h-12 rounded object-cover" />
                              ) : (
                                <span className="text-xs text-muted-foreground italic">
                                  {col.type === "video-url" ? "Video file" : "Audio file"}
                                </span>
                              )
                            ) : (
                              <span className={val ? "" : "text-muted-foreground/40"}>{val || "—"}</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/50 text-center">
            {rows.length} row{rows.length !== 1 ? "s" : ""} × {columns.length} column{columns.length !== 1 ? "s" : ""}
          </p>
        </div>
      )}
    </div>
  )
}

export function UploadImageConfig({ data, onUpdate }: ConfigProps<UploadImageData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="image-url">Image URL</Label>
        <Input
          id="image-url"
          value={data.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://example.com/image.png"
        />
      </div>
    </div>
  )
}

export function UploadVideoConfig({ data, onUpdate }: ConfigProps<UploadVideoData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="video-url">Video URL</Label>
        <Input
          id="video-url"
          value={data.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://example.com/video.mp4"
        />
      </div>
    </div>
  )
}

export function UploadAudioConfig({ data, onUpdate }: ConfigProps<UploadAudioData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="audio-url">Audio URL</Label>
        <Input
          id="audio-url"
          value={data.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://example.com/audio.mp3"
        />
      </div>
    </div>
  )
}

export function RSSFeedConfig({ data, onUpdate }: ConfigProps<RSSFeedData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="feed-url">Feed URL</Label>
        <Input
          id="feed-url"
          value={data.feedUrl}
          onChange={(e) => onUpdate({ feedUrl: e.target.value })}
          placeholder="https://example.com/feed.xml"
        />
      </div>
      <div>
        <Label htmlFor="item-index">Item Index</Label>
        <Input
          id="item-index"
          type="number"
          min={0}
          value={data.itemIndex}
          onChange={(e) => onUpdate({ itemIndex: parseInt(e.target.value, 10) || 0 })}
        />
      </div>
    </div>
  )
}

function detectVideoPlatform(url: string): string {
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube"
  if (/facebook\.com|fb\.watch|fb\.com/.test(url)) return "facebook"
  if (/tiktok\.com/.test(url)) return "tiktok"
  if (/instagram\.com/.test(url)) return "instagram"
  if (/(?:twitter\.com|x\.com)/.test(url)) return "twitter"
  return "unknown"
}

function extractVideoUrlId(url: string): string | null {
  const ytMatch = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/
  )
  if (ytMatch) return ytMatch[1]
  const tiktokMatch = url.match(/tiktok\.com\/@[\w.-]+\/video\/(\d+)/)
  if (tiktokMatch) return tiktokMatch[1]
  const igMatch = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/)
  if (igMatch) return igMatch[1]
  const twMatch = url.match(/(?:twitter\.com|x\.com)\/[\w]+\/status\/(\d+)/)
  if (twMatch) return twMatch[1]
  const fbMatch = url.match(/facebook\.com\/.*\/videos\/(\d+)/)
  if (fbMatch) return fbMatch[1]
  const fbShareMatch = url.match(/facebook\.com\/share\/(?:v|r)\/([A-Za-z0-9_-]+)/)
  if (fbShareMatch) return fbShareMatch[1]
  const fbReelMatch = url.match(/facebook\.com\/reel\/([A-Za-z0-9_-]+)/)
  if (fbReelMatch) return fbReelMatch[1]
  if (/fb\.watch/.test(url)) return url
  const platform = detectVideoPlatform(url)
  if (platform !== "unknown" && platform !== "youtube") return url
  return null
}

const VIDEO_PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
  tiktok: "TikTok",
  instagram: "Instagram",
  twitter: "Twitter/X",
  unknown: "Video",
}

export function YouTubeVideoConfig({ data, onUpdate }: ConfigProps<YouTubeVideoData>) {
  const [loading, setLoading] = useState(false)

  const platform = detectVideoPlatform(data.youtubeUrl || "")
  const isYouTube = platform === "youtube"
  const downloadStatus = data.downloadStatus ?? "idle"
  const isDownloading = downloadStatus === "downloading"
  const displayThumbnail = data.downloadedThumbnailUrl || data.thumbnailUrl

  const handleUrlChange = useCallback(async (url: string) => {
    onUpdate({
      youtubeUrl: url,
      downloadedVideoUrl: "",
      downloadedThumbnailUrl: "",
      downloadStatus: "idle",
      downloadError: "",
      downloadPercent: 0,
    })

    const videoId = extractVideoUrlId(url)
    if (!videoId) {
      onUpdate({ videoId: "", title: "", thumbnailUrl: "" })
      return
    }

    const detectedPlatform = detectVideoPlatform(url)
    onUpdate({ videoId })
    setLoading(true)
    try {
      if (detectedPlatform === "youtube") {
        const meta = await fetchYouTubeOEmbed(url)
        onUpdate({ title: meta.title, thumbnailUrl: meta.thumbnail_url })
      } else {
        onUpdate({ title: `${VIDEO_PLATFORM_LABELS[detectedPlatform]} Video`, thumbnailUrl: "" })
      }
    } catch {
      if (detectedPlatform === "youtube") {
        onUpdate({ title: "", thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` })
      } else {
        onUpdate({ title: `${VIDEO_PLATFORM_LABELS[detectedPlatform]} Video`, thumbnailUrl: "" })
      }
    } finally {
      setLoading(false)
    }
  }, [onUpdate])

  const handleDownload = useCallback(async () => {
    const url = data.youtubeUrl?.trim()
    if (!url) return
    onUpdate({
      downloadStatus: "downloading",
      downloadPercent: 0,
      downloadError: "",
      downloadedVideoUrl: "",
      downloadedThumbnailUrl: "",
    })
    try {
      const { downloadId } = await startVideoDownload(url)
      subscribeToDownloadProgress(downloadId, (event: DownloadProgressEvent) => {
        if (event.phase === "completed" && event.videoUrl) {
          onUpdate({
            downloadedVideoUrl: event.videoUrl,
            downloadedThumbnailUrl: event.thumbnailUrl ?? "",
            downloadStatus: "completed",
            downloadPercent: 100,
            thumbnailUrl: event.thumbnailUrl ?? data.thumbnailUrl,
          })
        } else if (event.phase === "failed") {
          onUpdate({
            downloadStatus: "failed",
            downloadError: event.error ?? "Download failed",
            downloadPercent: 0,
          })
        } else {
          onUpdate({ downloadPercent: event.percent, downloadPhase: event.phase })
        }
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Download failed"
      onUpdate({
        downloadStatus: "failed",
        downloadError: message,
        downloadPercent: 0,
      })
    }
  }, [data.youtubeUrl, data.thumbnailUrl, onUpdate])

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="video-url">Video URL</Label>
        <Input
          id="video-url"
          value={data.youtubeUrl}
          onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="YouTube, Facebook, TikTok, Instagram, or X URL"
        />
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Fetching metadata...</span>
        </div>
      )}
      {!loading && displayThumbnail && (
        <div className="rounded-md overflow-hidden">
          <CachedImage
            src={displayThumbnail}
            alt={data.title || "Video"}
            className="w-full rounded-md"
            thumbnail
            thumbnailWidth={480}
          />
        </div>
      )}
      {data.title && (
        <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg px-3 py-2">
          <span className="font-medium">Title:</span> {data.title}
        </div>
      )}

      {!loading && data.videoId && !isYouTube && (
        <div className="flex flex-col gap-2">
          {(downloadStatus === "idle" || downloadStatus === "failed") && (
            <>
              {downloadStatus === "failed" && data.downloadError && (
                <div className="flex items-center gap-1.5 p-2 rounded-md bg-red-500/10 text-red-500 text-xs">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span className="line-clamp-2">{data.downloadError}</span>
                </div>
              )}
              <Button
                size="sm"
                onClick={handleDownload}
                className="w-full bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
              >
                <Download className="w-3.5 h-3.5 mr-1.5" />
                {downloadStatus === "failed" ? "Retry Download" : "Download Video"}
              </Button>
            </>
          )}

          {isDownloading && (
            <div className="flex flex-col gap-1.5 p-2 bg-muted/30 rounded-md">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#ff0073]" />
                <span>{data.downloadPhase === "uploading" ? "Uploading..." : data.downloadPhase === "processing" ? "Processing..." : "Downloading video..."}</span>
                <span className="ml-auto font-mono text-[#ff0073]">{data.downloadPercent ?? 0}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-muted-foreground/20 overflow-hidden">
                <div
                  className="h-full bg-[#ff0073] rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${data.downloadPercent ?? 0}%` }}
                />
              </div>
            </div>
          )}

          {downloadStatus === "completed" && (
            <div className="flex items-center gap-2 text-xs text-green-500 p-2 bg-green-500/10 rounded-md">
              <Check className="w-3.5 h-3.5" />
              <span>Downloaded and ready</span>
            </div>
          )}
        </div>
      )}

      {!loading && data.videoId && isYouTube && (
        <div className="flex items-center gap-2 text-xs text-green-500 p-2 bg-green-500/10 rounded-md">
          <Check className="w-3.5 h-3.5" />
          <span>Direct streaming</span>
        </div>
      )}
    </div>
  )
}

export function ReferenceAudioConfig({ data, onUpdate }: ConfigProps<ReferenceAudioData>) {
  const [extracting, setExtracting] = useState(false)
  const [fetchingMeta, setFetchingMeta] = useState(false)

  const handleYouTubeUrlChange = useCallback(async (url: string) => {
    onUpdate({ youtubeUrl: url })
    if (!url.trim()) return
    try {
      const parsed = new URL(url)
      if (!parsed.hostname.includes("youtube.com") && !parsed.hostname.includes("youtu.be")) return
    } catch {
      return
    }
    setFetchingMeta(true)
    try {
      const meta = await fetchYouTubeOEmbed(url)
      onUpdate({ videoTitle: meta.title, videoThumbnail: meta.thumbnail_url })
    } catch {
      // ignore metadata fetch errors
    } finally {
      setFetchingMeta(false)
    }
  }, [onUpdate])

  const handleExtract = useCallback(async () => {
    const url = data.youtubeUrl?.trim()
    if (!url) return
    setExtracting(true)
    onUpdate({ extractionStatus: "extracting" })
    try {
      const { jobId } = await extractYouTubeAudioApi(url)
      const poll = async (): Promise<string> => {
        const status = await getJobStatus(jobId)
        if (status.status === "completed" && status.output_data?.audioUrl) {
          return status.output_data.audioUrl
        }
        if (status.status === "failed") {
          throw new Error(status.error_message ?? "Extraction failed")
        }
        await new Promise((r) => setTimeout(r, 2000))
        return poll()
      }
      const audioUrl = await poll()
      onUpdate({ extractedAudioUrl: audioUrl, extractionStatus: "ready" })
    } catch {
      onUpdate({ extractionStatus: "failed" })
    } finally {
      setExtracting(false)
    }
  }, [data.youtubeUrl, onUpdate])

  const handleFileUpload = useCallback(async (file: File) => {
    setExtracting(true)
    onUpdate({ extractionStatus: "extracting" })
    try {
      const result = await uploadAudio(file)
      onUpdate({ uploadedFileUrl: result.url, extractedAudioUrl: result.url, extractionStatus: "ready" })
    } catch {
      onUpdate({ extractionStatus: "failed" })
    } finally {
      setExtracting(false)
    }
  }, [onUpdate])

  const handleDirectUrlSet = useCallback(() => {
    const url = data.directUrl?.trim()
    if (url) {
      onUpdate({ extractedAudioUrl: url, extractionStatus: "ready" })
    }
  }, [data.directUrl, onUpdate])

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Source</Label>
        <Select
          value={data.sourceType || "youtube"}
          onValueChange={(v) => onUpdate({ sourceType: v as ReferenceAudioData["sourceType"], extractedAudioUrl: "", extractionStatus: "idle", videoTitle: "", videoThumbnail: "" })}
        >
          <SelectTrigger aria-label="Source type"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="youtube">YouTube</SelectItem>
            <SelectItem value="upload">Upload File</SelectItem>
            <SelectItem value="url">Direct URL</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(data.sourceType === "youtube" || !data.sourceType) && (
        <div className="flex flex-col gap-2">
          <div>
            <Label htmlFor="yt-url">YouTube URL</Label>
            <Input
              id="yt-url"
              value={data.youtubeUrl || ""}
              onChange={(e) => handleYouTubeUrlChange(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
            />
          </div>
          {fetchingMeta && <p className="text-xs text-muted-foreground">Fetching video info...</p>}
          {data.videoThumbnail && (
            <div className="rounded-md overflow-hidden bg-muted border border-border">
              <CachedImage src={data.videoThumbnail} alt="" className="w-full aspect-video object-cover" thumbnail thumbnailWidth={480} />
              {data.videoTitle && <p className="text-xs px-2 py-1.5 truncate text-foreground">{data.videoTitle}</p>}
            </div>
          )}
          <Button
            size="sm"
            onClick={handleExtract}
            disabled={extracting || !data.youtubeUrl?.trim()}
          >
            {extracting ? "Extracting..." : "Extract Audio"}
          </Button>
        </div>
      )}

      {data.sourceType === "upload" && (
        <div className="flex flex-col gap-2">
          <Label>Audio File</Label>
          <Input
            type="file"
            accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,.mp3,.wav,.m4a,.aac"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleFileUpload(file)
            }}
          />
          {extracting && <p className="text-xs text-muted-foreground">Uploading...</p>}
        </div>
      )}

      {data.sourceType === "url" && (
        <div className="flex flex-col gap-2">
          <div>
            <Label htmlFor="direct-url">Audio URL</Label>
            <Input
              id="direct-url"
              value={data.directUrl || ""}
              onChange={(e) => onUpdate({ directUrl: e.target.value })}
              placeholder="https://example.com/audio.mp3"
            />
          </div>
          <Button size="sm" onClick={handleDirectUrlSet} disabled={!data.directUrl?.trim()}>
            Set URL
          </Button>
        </div>
      )}

      {data.extractionStatus === "ready" && data.extractedAudioUrl && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-green-600">Audio ready</p>
          <audio src={data.extractedAudioUrl} controls className="w-full h-8" />
        </div>
      )}
      {data.extractionStatus === "failed" && (
        <p className="text-xs text-red-500">Extraction failed. Try again.</p>
      )}
    </div>
  )
}
