"use client"

import { useState, useCallback, useRef, useMemo } from "react"
import { X, Plus, Loader2, Check, Download, AlertCircle, Upload, Film, Music, Link, GripVertical, Scissors } from "lucide-react"
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
import { toast } from "sonner"
import { spliceDelimitedRows, splitByLoopDelimiter } from "@nodaro-shared/loop-delimiter"
import { applyRange, resolveIndex } from "@nodaro-shared/edge-range"
import { uploadAudio, fetchYouTubeOEmbed, extractYouTubeAudioApi, getJobStatus, startVideoDownload, subscribeToDownloadProgress } from "@/lib/api"
import type { DownloadProgressEvent } from "@/lib/api"
import {
  LOOP_COLUMN_TYPE_META,
  loopColInputHandle,
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
  type WorkflowNode,
} from "@/types/nodes"
import type { ConfigProps } from "./types"
import { PromptHelperButton } from "./prompt-helper-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { extractNodeOutputAsList, resolveLoopColumnValues } from "@/components/editor/workflow-editor/node-input-resolver"

const COLUMN_ACCEPT: Record<string, string> = {
  "image-url": "image/png,image/jpeg,image/webp,image/gif",
  "video-url": "video/mp4,video/webm,video/quicktime",
  "audio-url": "audio/mpeg,audio/wav,audio/ogg,audio/webm",
}

function getSourceLabel(
  nodes: ReadonlyArray<{ id: string; type?: string; data: Record<string, unknown> }> | undefined,
  sourceId: string | undefined,
): string {
  if (!sourceId || !nodes) return ""
  return (nodes.find((n) => n.id === sourceId)?.data?.label as string) || ""
}

export function TextPromptConfig({ data, onUpdate, nodeRefs, refMap, variableDisplayMode }: ConfigProps<TextPromptData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>Prompt Text</Label>
          <PromptHelperButton
            nodeType="text-prompt"
            currentPrompt={data.text || ""}
            onAccept={(prompt) => onUpdate({ text: prompt })}
          />
        </div>
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

const DELIMITER_PRESETS = [
  { label: "Comma", value: "," },
  { label: "Pipe", value: "|" },
  { label: "Semicolon", value: ";" },
  { label: "Newline", value: "\n" },
  { label: "Three Stars", value: "***" },
] as const

const DELIMITER_OPTIONS = [
  { label: "None", value: "__none__" },
  { label: "Comma", value: "," },
  { label: "Pipe", value: "|" },
  { label: "Semicolon", value: ";" },
  { label: "Newline", value: "\n" },
  { label: "Three Stars (***)", value: "***" },
  { label: "Custom", value: "__custom__" },
] as const

function DelimiterSelect({
  column,
  colIndex,
  onDelimiterChange,
  onSplit,
}: {
  column: LoopColumn
  colIndex: number
  onDelimiterChange: (colIndex: number, delimiter: string | undefined) => void
  onSplit: (colIndex: number) => void
}) {
  const current = column.splitDelimiter
  const isPreset = DELIMITER_PRESETS.some((p) => p.value === current)
  const isCustom = !!current && !isPreset
  const [customValue, setCustomValue] = useState(isCustom ? current : "")
  // Track "user is editing custom" separately from "delimiter has a custom value",
  // so the custom input renders immediately when the user picks Custom, before they type.
  const [customMode, setCustomMode] = useState(isCustom)

  const selectValue = customMode
    ? "__custom__"
    : !current
      ? "__none__"
      : current

  function handleChange(value: string) {
    if (value === "__none__") {
      setCustomMode(false)
      onDelimiterChange(colIndex, undefined)
    } else if (value === "__custom__") {
      setCustomMode(true)
      if (customValue) onDelimiterChange(colIndex, customValue)
    } else {
      setCustomMode(false)
      onDelimiterChange(colIndex, value)
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <Select value={selectValue} onValueChange={handleChange}>
        <SelectTrigger
          className={`h-5 px-1.5 text-[10px] border-none gap-0.5 ${
            current ? "text-[#ff0073]" : "text-muted-foreground"
          }`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper">
          {DELIMITER_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selectValue === "__custom__" && (
        <input
          className="w-full text-xs bg-muted/30 rounded px-1.5 py-0.5 border border-border focus:border-[#ff0073] focus:outline-none"
          value={customValue}
          onChange={(e) => {
            setCustomValue(e.target.value)
            if (e.target.value) onDelimiterChange(colIndex, e.target.value)
          }}
          placeholder="Delimiter..."
        />
      )}
      {!!current && (
        <button
          type="button"
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-muted-foreground hover:bg-muted/50 transition-colors"
          onClick={() => onSplit(colIndex)}
        >
          <Scissors className="w-3 h-3" />
          Split
        </button>
      )}
    </div>
  )
}

export function LoopConfig({ data, onUpdate, onRemoveColumnEdges, nodes, nodeId, singleColumn }: {
  data: LoopNodeData
  onUpdate: (patch: Partial<LoopNodeData>) => void
  onRemoveColumnEdges?: (colHandleId: string) => void
  nodes?: ReadonlyArray<{ id: string; type?: string; data: Record<string, unknown> }>
  nodeId?: string
  singleColumn?: boolean
}) {
  const [activeTab, setActiveTab] = useState<"configure" | "data">("configure")
  const columns = data.columns ?? []
  const rows = data.rows ?? []
  const edges = useWorkflowStore((s) => s.edges)
  const allNodes = useWorkflowStore((s) => s.nodes)

  /** Resolve connected rows — respects edge outputMode & useAllResults. */
  const connectedRows = useMemo<string[][] | null>(() => {
    if (!nodeId || columns.length === 0) return null

    function resolveEdge(
      edge: { source: string; sourceHandle?: string | null; data?: unknown },
      upstream: WorkflowNode,
    ): string[] | null {
      const ed = edge.data as Record<string, unknown> | undefined
      const edgeMode = ed?.outputMode as string | undefined
      // Table columns exist to collect items — default to "each" (show all results)
      const outputMode = edgeMode ?? "each"
      const useAll = !!ed?.useAllResults
      const runsExpr = ed?.runsExpression as string | undefined

      // Resolve all outputs — loop nodes need special handling
      const allOutputs = (upstream.type === "loop" || upstream.type === "list")
        ? resolveLoopColumnValues(
            { id: upstream.id, data: upstream.data as Record<string, unknown> },
            edge.sourceHandle ?? undefined,
            edges as Array<{ source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>,
            allNodes as Array<{ id: string; type?: string; data: Record<string, unknown> }>,
          )
        : (extractNodeOutputAsList(upstream, useAll, runsExpr) ?? [])

      if (outputMode === "item") {
        const itemIndex = ed?.itemIndex as string | undefined
        if (allOutputs.length > 0) {
          const idx = resolveIndex(itemIndex ?? "1", allOutputs.length)
          return [allOutputs[idx] ?? allOutputs[0]]
        }
        const single = extractNodeOutput(upstream, edge.sourceHandle ?? undefined)
        return single ? [single] : null
      }
      if (outputMode.startsWith("item:")) {
        const idx = parseInt(outputMode.split(":")[1], 10)
        if (allOutputs.length > 0) return [allOutputs[idx] ?? allOutputs[0]]
        const single = extractNodeOutput(upstream, edge.sourceHandle ?? undefined)
        return single ? [single] : null
      }
      if (outputMode === "last") {
        if (allOutputs.length > 0) return [allOutputs[allOutputs.length - 1]]
        const single = extractNodeOutput(upstream, edge.sourceHandle ?? undefined)
        return single ? [single] : null
      }
      if (outputMode === "each" || outputMode === "all") {
        if (allOutputs.length > 0) {
          return applyRange(
            allOutputs,
            ed?.rangeFrom as string | undefined,
            ed?.rangeTo as string | undefined,
            ed?.rangeStep as number | undefined,
          )
        }
        const single = extractNodeOutput(upstream, edge.sourceHandle ?? undefined)
        if (!single) return null
        return splitByLoopDelimiter(single, columns)
      }
      const single = extractNodeOutput(upstream, edge.sourceHandle ?? undefined)
      if (!single) return null
      return splitByLoopDelimiter(single, columns)
    }

    const colValues: (string[] | null)[] = columns.map((col) => {
      const colInEdges = edges.filter(
        (e) => e.target === nodeId && e.targetHandle === loopColInputHandle(col.handleId),
      )
      if (colInEdges.length === 0) return null
      const allValues: string[] = []
      for (const edge of colInEdges) {
        const upstream = allNodes.find((n) => n.id === edge.source)
        if (!upstream) continue
        const vals = resolveEdge(edge, upstream as WorkflowNode)
        if (vals) allValues.push(...vals)
      }
      return allValues.length > 0 ? allValues : null
    })

    const legacyEdge = edges.find((e) => e.target === nodeId && e.targetHandle === "in")
    let legacyValues: string[] | null = null
    if (legacyEdge) {
      const upstream = allNodes.find((n) => n.id === legacyEdge.source)
      if (upstream) legacyValues = resolveEdge(legacyEdge, upstream as WorkflowNode)
    }

    if (!colValues.some((d) => d !== null) && !legacyValues) return null

    const maxRows = Math.max(...colValues.map((d) => d?.length ?? 0), legacyValues?.length ?? 0)
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
  }, [nodeId, columns, edges, allNodes])

  const displayRows = connectedRows ?? rows
  const isConnectedData = connectedRows !== null

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
    const col = columns[colIndex]
    if (col && onRemoveColumnEdges) {
      onRemoveColumnEdges(col.handleId)
    }
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

  function updateColumnDelimiter(colIndex: number, delimiter: string | undefined) {
    const newColumns = columns.map((c, i) =>
      i === colIndex ? { ...c, splitDelimiter: delimiter } : c
    )
    onUpdate({ columns: newColumns })
  }

  function splitColumnRows(colIndex: number) {
    const delimiter = columns[colIndex]?.splitDelimiter
    if (!delimiter) return

    const maxItems = data.maxItems ?? Infinity
    const newRows: string[][] = []

    for (const row of rows) {
      const cellValue = row[colIndex] ?? ""
      const parts = cellValue.split(delimiter).map((s) => s.trim()).filter((s) => s.length > 0)
      if (parts.length <= 1) {
        newRows.push(row)
        continue
      }
      const firstRow = [...row]
      firstRow[colIndex] = parts[0]
      newRows.push(firstRow)
      for (let p = 1; p < parts.length; p++) {
        const newRow = columns.map(() => "")
        newRow[colIndex] = parts[p]
        newRows.push(newRow)
      }
    }

    if (newRows.length > maxItems) {
      toast.warning(`Split produced ${newRows.length} rows but max is ${maxItems}. Truncated to ${maxItems}.`)
      onUpdate({ rows: newRows.slice(0, maxItems) })
    } else {
      onUpdate({ rows: newRows })
    }
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
            <Label>{singleColumn ? "List" : "Table"}</Label>
            {!singleColumn && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={addColumn}
              >
                <Plus className="w-3 h-3" />
                Add Column
              </button>
            )}
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
                            className={`flex-1 min-w-[60px] text-xs font-medium bg-muted/30 rounded px-1.5 py-1 border border-border focus:border-[#ff0073] focus:outline-none ${col.connectedSourceId ? "opacity-70" : ""}`}
                            value={col.name}
                            onChange={(e) => renameColumn(ci, e.target.value)}
                            readOnly={!!col.connectedSourceId}
                          />
                          {col.connectedSourceId && (
                            <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-muted-foreground/60" title="Connected to upstream node">
                              <Link className="w-3 h-3" />
                              {getSourceLabel(nodes, col.connectedSourceId)}
                            </span>
                          )}
                          {(col.type ?? "text") === "text" && (
                            <DelimiterSelect
                              column={col}
                              colIndex={ci}
                              onDelimiterChange={updateColumnDelimiter}
                              onSplit={splitColumnRows}
                            />
                          )}
                          {!singleColumn && (
                            <button
                              type="button"
                              className="shrink-0 text-muted-foreground hover:text-red-500 transition-colors"
                              onClick={() => removeColumn(ci)}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
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
                                  ) : col.connectedSourceId ? (
                                    <div className="w-full min-w-[60px] text-xs bg-muted/20 rounded px-1.5 py-1 border border-border opacity-70 truncate">
                                      {row[ci] || <span className="text-muted-foreground/50 italic">Waiting...</span>}
                                    </div>
                                  ) : (
                                    <input
                                      className="w-full min-w-[60px] text-xs bg-muted/30 rounded px-1.5 py-1 border border-border focus:border-[#ff0073] focus:outline-none"
                                      value={row[ci] ?? ""}
                                      onChange={(e) => updateCell(ri, ci, e.target.value)}
                                      onPaste={(e) => {
                                        const delimiter = col.splitDelimiter
                                        if (!delimiter) return
                                        const pasted = e.clipboardData.getData("text/plain")
                                        if (!pasted.includes(delimiter)) return
                                        e.preventDefault()
                                        const { newRows, truncated, totalProduced } = spliceDelimitedRows(rows, ri, ci, pasted, delimiter, columns.length, data.maxItems ?? Infinity)
                                        if (truncated) toast.warning(`Paste produced ${totalProduced} rows but max is ${data.maxItems}. Truncated to ${data.maxItems}.`)
                                        onUpdate({ rows: newRows })
                                      }}
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
          <div className="flex items-center gap-2 mt-2">
            <label className="text-xs text-muted-foreground">Min rows to run</label>
            <input
              type="number"
              min={0}
              max={data.maxItems ?? 10}
              value={data.minRows ?? 0}
              onChange={(e) => {
                const val = Math.max(0, Math.min(parseInt(e.target.value, 10) || 0, data.maxItems ?? 10))
                const updates: Partial<LoopNodeData> = { minRows: val }
                if (val > (data.defaultRows ?? 1)) updates.defaultRows = val
                onUpdate(updates)
              }}
              className="w-16 bg-background border border-border rounded px-2 py-1 text-xs"
            />
          </div>
          <div className="flex items-center gap-2 mt-2">
            <label className="text-xs text-muted-foreground">Default rows in app</label>
            <input
              type="number"
              min={data.minRows ?? 0}
              max={data.maxItems ?? 10}
              value={data.defaultRows ?? 1}
              onChange={(e) => {
                const min = data.minRows ?? 0
                const max = data.maxItems ?? 10
                const val = Math.max(min, Math.min(parseInt(e.target.value, 10) || 1, max))
                onUpdate({ defaultRows: val })
              }}
              className="w-16 bg-background border border-border rounded px-2 py-1 text-xs"
            />
          </div>
          <div className="flex items-center gap-2 mt-2">
            <label className="text-xs text-muted-foreground">Gallery items per row</label>
            <input
              type="number"
              min={1}
              max={6}
              value={data.galleryCols ?? 3}
              onChange={(e) => onUpdate({ galleryCols: Math.max(1, Math.min(6, parseInt(e.target.value, 10) || 3)) })}
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
          ) : displayRows.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No data yet. Add rows manually or connect an upstream node.
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
                            <span className={`text-[11px] font-medium text-muted-foreground ${col.connectedSourceId ? "opacity-70" : ""}`}>{col.name}</span>
                            {col.connectedSourceId && (
                              <span className="shrink-0 flex items-center gap-0.5 text-[9px] text-muted-foreground/60">
                                <Link className="w-3 h-3" />
                                {getSourceLabel(nodes, col.connectedSourceId)}
                              </span>
                            )}
                          </div>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, ri) => (
                    <tr key={ri} className={ri % 2 === 1 ? "bg-muted/5" : ""}>
                      <td className="px-3 py-2 text-[10px] text-muted-foreground/50 font-mono">{ri + 1}</td>
                      {columns.map((col, ci) => {
                        const val = row[ci] ?? ""
                        const isMedia = col.type !== "text"
                        const isConnected = isConnectedData || !!col.connectedSourceId
                        return (
                          <td key={col.id} className={`px-3 py-2 text-sm text-foreground ${isConnected ? "opacity-70" : ""}`}>
                            {isMedia && val ? (
                              col.type === "image-url" ? (
                                <img src={val} alt="" className="w-12 h-12 rounded object-cover" />
                              ) : col.type === "video-url" ? (
                                <video src={val} crossOrigin="anonymous" className="w-16 h-12 rounded object-cover" muted playsInline />
                              ) : (
                                <audio src={val} controls className="h-8 w-full max-w-[160px]" style={{ minWidth: 0 }} />
                              )
                            ) : isConnected ? (
                              <span className="text-muted-foreground/70">{val || <span className="italic text-muted-foreground/50">Waiting...</span>}</span>
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
            {displayRows.length} row{displayRows.length !== 1 ? "s" : ""} × {columns.length} column{columns.length !== 1 ? "s" : ""}
            {isConnectedData && " (from connected node)"}
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
