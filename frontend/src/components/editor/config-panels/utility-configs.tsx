"use client"

import { useCallback, useState } from "react"
import { Plus, Trash2, FileText, ImageIcon, Film, Music, GripVertical, Eye, EyeOff, ChevronUp, ChevronDown } from "lucide-react"
import { nanoid } from "nanoid"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  CombineTextNodeData,
  SaveToStorageData,
  WebhookOutputData,
  WebhookParam,
  SplitTextData,
  PreviewNodeData,
  PreviewItem,
} from "@/types/nodes"
import { isMediaUrl } from "@/lib/media-type"
import type { ConfigProps } from "./types"

const SEPARATOR_OPTIONS = [
  { value: "newline", label: "New Line (\\n)" },
  { value: "double-newline", label: "Double New Line (\\n\\n)" },
  { value: "comma", label: "Comma (,)" },
  { value: "space", label: "Space" },
  { value: "custom", label: "Custom" },
] as const

export function CombineTextConfig({ data, onUpdate }: { data: CombineTextNodeData; onUpdate: (patch: Partial<CombineTextNodeData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Separator</Label>
        <Select value={data.separator} onValueChange={(v) => onUpdate({ separator: v as CombineTextNodeData["separator"] })}>
          <SelectTrigger aria-label="Separator"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SEPARATOR_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data.separator === "custom" && (
        <div>
          <Label>Custom Separator</Label>
          <Input value={data.customSeparator} onChange={(e) => onUpdate({ customSeparator: e.target.value })} placeholder="Enter separator..." />
        </div>
      )}

      {data.combinedText && (
        <div>
          <Label>Output Preview</Label>
          <Textarea rows={4} value={data.combinedText} readOnly className="text-xs opacity-70" />
        </div>
      )}
    </div>
  )
}

export function SaveToStorageConfig({ data, onUpdate }: ConfigProps<SaveToStorageData>) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="filename">Filename</Label>
        <Input id="filename" value={data.filename} onChange={(e) => onUpdate({ filename: e.target.value })} placeholder="output_video" />
      </div>
      <div>
        <Label>Format</Label>
        <Select value={data.format} onValueChange={(v) => onUpdate({ format: v as SaveToStorageData["format"] })}>
          <SelectTrigger aria-label="Format"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="mp4">MP4</SelectItem>
            <SelectItem value="webm">WebM</SelectItem>
            <SelectItem value="mov">MOV</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Quality</Label>
        <Select value={data.quality} onValueChange={(v) => onUpdate({ quality: v as SaveToStorageData["quality"] })}>
          <SelectTrigger aria-label="Quality"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="standard">Standard</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="4k">4K</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

export function WebhookOutputConfig({ data, onUpdate }: ConfigProps<WebhookOutputData>) {
  const params = data.params ?? []

  const addParam = () => {
    onUpdate({
      params: [...params, { id: nanoid(), name: "", type: "text" }],
    })
  }

  const updateParam = (index: number, patch: Partial<WebhookParam>) => {
    const updated = params.map((p, i) => (i === index ? { ...p, ...patch } : p))
    onUpdate({ params: updated })
  }

  const removeParam = (index: number) => {
    onUpdate({ params: params.filter((_, i) => i !== index) })
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="webhook-url">Webhook URL</Label>
        <Input
          id="webhook-url"
          value={data.url}
          onChange={(e) => onUpdate({ url: e.target.value })}
          placeholder="https://example.com/webhook"
          className="text-xs font-mono"
        />
        <p className="text-[10px] text-muted-foreground mt-1">
          The URL to POST the collected data to.
        </p>
      </div>

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between mb-2">
          <Label>Input Parameters</Label>
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addParam}>
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>

        {params.length === 0 && (
          <p className="text-[10px] text-muted-foreground bg-muted/30 rounded-md px-3 py-2 border border-dashed border-border">
            No parameters defined. All upstream data will be sent as a single payload.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {params.map((param, i) => (
            <div key={param.id} className="flex items-center gap-1.5">
              <Input
                value={param.name}
                onChange={(e) => updateParam(i, { name: e.target.value })}
                placeholder="name"
                className="text-xs h-8 flex-1"
              />
              <Select
                value={param.type}
                onValueChange={(v) => updateParam(i, { type: v as WebhookParam["type"] })}
              >
                <SelectTrigger className="h-8 w-[100px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="imageUrl">Image URL</SelectItem>
                  <SelectItem value="videoUrl">Video URL</SelectItem>
                  <SelectItem value="audioUrl">Audio URL</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeParam(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function SplitTextConfig({ data, onUpdate }: { data: SplitTextData; onUpdate: (patch: Partial<SplitTextData>) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Separator</Label>
        <Input value={data.separator} onChange={(e) => onUpdate({ separator: e.target.value })} placeholder="Enter separator (e.g. * or ===NEXT===)" />
        <p className="text-[10px] text-muted-foreground mt-1">
          The delimiter used to split the input text into items
        </p>
      </div>

      <div className="flex items-center justify-between">
        <Label>Trim whitespace</Label>
        <Button
          variant={data.trimWhitespace !== false ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onUpdate({ trimWhitespace: data.trimWhitespace === false })}
        >
          {data.trimWhitespace !== false ? "On" : "Off"}
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <Label>Remove empty</Label>
        <Button
          variant={data.removeEmpty !== false ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onUpdate({ removeEmpty: data.removeEmpty === false })}
        >
          {data.removeEmpty !== false ? "On" : "Off"}
        </Button>
      </div>

      {data.splitResults && data.splitResults.length > 0 && (
        <div>
          <Label>Preview ({data.splitResults.length} items)</Label>
          <Textarea
            rows={Math.min(data.splitResults.length, 6)}
            value={data.splitResults.map((item, i) => `${i + 1}. ${item}`).join("\n")}
            readOnly
            className="text-xs opacity-70"
          />
        </div>
      )}
    </div>
  )
}

const PREVIEW_TYPE_ICON: Record<PreviewItem["type"], React.ReactNode> = {
  text: <FileText className="w-3.5 h-3.5 text-blue-400" />,
  image: <ImageIcon className="w-3.5 h-3.5 text-pink-400" />,
  video: <Film className="w-3.5 h-3.5 text-purple-400" />,
  audio: <Music className="w-3.5 h-3.5 text-amber-400" />,
  data: <FileText className="w-3.5 h-3.5 text-slate-400" />,
}

export function PreviewConfig({ data, onUpdate }: { data: PreviewNodeData; onUpdate: (patch: Partial<PreviewNodeData>) => void }) {
  const items = data.previewItems ?? []
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const toggleVisibility = useCallback((index: number) => {
    const updated = items.map((item, i) =>
      i === index ? { ...item, visible: !item.visible } : item
    )
    onUpdate({
      previewItems: updated,
      itemOrder: updated.map((item) => item.sourceNodeId),
    })
  }, [items, onUpdate])

  const moveItem = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    const updated = [...items]
    const [moved] = updated.splice(fromIndex, 1)
    updated.splice(toIndex, 0, moved)
    onUpdate({
      previewItems: updated,
      itemOrder: updated.map((item) => item.sourceNodeId),
    })
  }, [items, onUpdate])

  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }, [])

  const handleDrop = useCallback((index: number) => {
    if (dragIndex !== null && dragIndex !== index) {
      moveItem(dragIndex, index)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }, [dragIndex, moveItem])

  const handleDragEnd = useCallback(() => {
    setDragIndex(null)
    setDragOverIndex(null)
  }, [])

  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-3 border border-dashed border-border text-center">
        Connect upstream nodes and run to see their values here.
      </p>
    )
  }

  const visibleCount = items.filter((i) => i.visible !== false).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Label>Connected Values ({items.length})</Label>
        <span className="text-[10px] text-muted-foreground">{visibleCount} visible</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map((item, i) => {
          const isVisible = item.visible !== false
          const isDragging = dragIndex === i
          const isDragOver = dragOverIndex === i && dragIndex !== i

          return (
            <div
              key={`${item.sourceNodeId}-${i}`}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={handleDragEnd}
              className={
                "rounded-lg border bg-muted/20 transition-all " +
                (isDragging ? "opacity-40 border-dashed border-muted-foreground/40 " : "") +
                (isDragOver ? "border-[#ff0073] ring-1 ring-[#ff0073]/30 " : "border-border ")
              }
            >
              {/* Header row: drag handle, icon, label, type badge, visibility toggle, arrows */}
              <div className="flex items-center gap-1 px-2 py-1.5">
                <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 cursor-grab shrink-0" />
                {PREVIEW_TYPE_ICON[item.type]}
                <span className="text-xs font-medium text-foreground/80 truncate flex-1 min-w-0">
                  {item.sourceNodeLabel}
                </span>
                <span className="text-[9px] text-muted-foreground uppercase shrink-0">{item.type}</span>
                <button
                  type="button"
                  className="p-0.5 rounded hover:bg-muted/50 transition-colors shrink-0"
                  onClick={() => { if (i > 0) moveItem(i, i - 1) }}
                  disabled={i === 0}
                >
                  <ChevronUp className={"w-3 h-3 " + (i === 0 ? "text-muted-foreground/20" : "text-muted-foreground")} />
                </button>
                <button
                  type="button"
                  className="p-0.5 rounded hover:bg-muted/50 transition-colors shrink-0"
                  onClick={() => { if (i < items.length - 1) moveItem(i, i + 1) }}
                  disabled={i === items.length - 1}
                >
                  <ChevronDown className={"w-3 h-3 " + (i === items.length - 1 ? "text-muted-foreground/20" : "text-muted-foreground")} />
                </button>
                <button
                  type="button"
                  className={"p-0.5 rounded hover:bg-muted/50 transition-colors shrink-0 " + (isVisible ? "text-foreground/70" : "text-muted-foreground/40")}
                  onClick={() => toggleVisibility(i)}
                  title={isVisible ? "Hide on canvas" : "Show on canvas"}
                >
                  {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Preview content */}
              <div className={"px-2.5 pb-2 " + (!isVisible ? "opacity-40" : "")}>
                {item.type === "image" && isMediaUrl(item.value) ? (
                  <img src={item.value} alt="" className="w-full max-h-40 object-contain rounded border border-border" loading="lazy" />
                ) : item.type === "video" && isMediaUrl(item.value) ? (
                  <video src={item.value} className="w-full max-h-40 object-contain rounded border border-border" controls muted playsInline preload="none" />
                ) : item.type === "audio" && isMediaUrl(item.value) ? (
                  <audio src={item.value} className="w-full" controls />
                ) : (
                  <Textarea rows={Math.min((item.value.match(/\n/g) || []).length + 1, 6)} value={item.value} readOnly className="text-xs opacity-70" />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
