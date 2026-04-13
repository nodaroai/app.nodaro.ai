"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Plus, Trash2, FileText, ImageIcon, Film, Music, GripVertical, Eye, EyeOff, ChevronUp, ChevronDown, Copy, Check, Download, X } from "lucide-react"
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
import {
  isTeleportDefaultLabel,
  TELEPORTER_PAN_EVENT,
  type CombineTextNodeData,
  type SaveToStorageData,
  type WebhookOutputData,
  type WebhookParam,
  type SplitTextData,
  type PreviewNodeData,
  type PreviewItem,
  type TeleportSendData,
  type TeleportReceiveData,
} from "@/types/nodes"
import { isMediaUrl } from "@/lib/media-type"
import { downloadFile } from "@/components/presentation/output-cards/shared"
import type { ConfigProps } from "./types"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

const SEPARATOR_OPTIONS = [
  { value: "newline", label: "New Line (\\n)" },
  { value: "double-newline", label: "Double New Line (\\n\\n)" },
  { value: "comma", label: "Comma (,)" },
  { value: "space", label: "Space" },
  { value: "stars", label: "Three Stars (***)" },
  { value: "custom", label: "Custom" },
] as const

const SEPARATOR_PRESET_VALUES: readonly string[] = SEPARATOR_OPTIONS.map((o) => o.value)

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
  // Legacy workflows may store a literal separator string (e.g. "===NEXT===") in `separator`.
  // Surface those as "custom" in the dropdown and pre-fill the custom field.
  const isPreset = SEPARATOR_PRESET_VALUES.includes(data.separator)
  const selectValue = isPreset ? data.separator : "custom"
  const customValue = isPreset ? (data.customSeparator ?? "") : data.separator

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label>Separator</Label>
        <Select
          value={selectValue}
          onValueChange={(v) => {
            if (v === "custom") {
              onUpdate({ separator: "custom", customSeparator: customValue })
            } else {
              onUpdate({ separator: v })
            }
          }}
        >
          <SelectTrigger aria-label="Separator"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SEPARATOR_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground mt-1">
          The delimiter used to split the input text into items
        </p>
      </div>

      {selectValue === "custom" && (
        <div>
          <Label>Custom Separator</Label>
          <Input
            value={customValue}
            onChange={(e) => onUpdate({ separator: "custom", customSeparator: e.target.value })}
            placeholder="Enter separator (e.g. ===NEXT===)"
          />
        </div>
      )}

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
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCopy = useCallback((value: string, idx: number) => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    navigator.clipboard.writeText(value)
    setCopiedIdx(idx)
    copyTimeoutRef.current = setTimeout(() => setCopiedIdx(null), 2000)
  }, [])

  useEffect(() => {
    return () => { if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current) }
  }, [])

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

              {/* Action buttons */}
              <div className={"flex gap-1.5 px-2.5 pb-2 " + (!isVisible ? "opacity-40" : "")}>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs h-7"
                  onClick={() => handleCopy(item.value, i)}
                >
                  {copiedIdx === i ? (
                    <Check className="w-3 h-3 mr-1 text-green-500" />
                  ) : (
                    <Copy className="w-3 h-3 mr-1" />
                  )}
                  {copiedIdx === i ? "Copied" : item.type === "text" ? "Copy Text" : item.type === "data" ? "Copy Data" : "Copy URL"}
                </Button>
                {(item.type === "image" || item.type === "video" || item.type === "audio") && isMediaUrl(item.value) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-xs h-7"
                    onClick={() => {
                      const ext = item.type === "video" ? "mp4" : item.type === "audio" ? "mp3" : "png"
                      downloadFile(item.value, `${item.sourceNodeLabel}.${ext}`)
                    }}
                  >
                    <Download className="w-3 h-3 mr-1" />
                    Download
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TeleporterConfig({ data, onUpdate, nodeType }: { data: TeleportSendData | TeleportReceiveData; onUpdate: (patch: Partial<TeleportSendData | TeleportReceiveData>) => void; nodeType: string }) {
  const { nodes, updateNodeData, syncTeleporterEdges } = useWorkflowStore()
  const isSend = nodeType === "teleport-send"

  const partners = nodes.filter((n) => {
    if (isSend) return n.type === "teleport-receive" && (n.data as TeleportReceiveData).channel === data.channel
    return n.type === "teleport-send" && (n.data as TeleportSendData).channel === data.channel
  })

  const availableChannels = nodes
    .filter((n) => n.type === "teleport-send")
    .map((n) => ({
      channel: (n.data as Record<string, unknown>).channel as string,
      channelColor: (n.data as Record<string, unknown>).channelColor as string,
      label: (n.data as Record<string, unknown>).label as string,
    }))
    .filter((c, i, arr) => arr.findIndex((a) => a.channel === c.channel) === i)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Channel</label>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full" style={{ backgroundColor: data.channelColor }} />
          <span className="text-sm font-semibold" style={{ color: data.channelColor }}>{data.channel}</span>
        </div>
      </div>

      {!isSend && availableChannels.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Switch Channel</label>
          <select
            className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background"
            value={data.channel}
            onChange={(e) => {
              const selected = availableChannels.find((c) => c.channel === e.target.value)
              if (!selected) return
              const oldChannel = data.channel
              onUpdate({
                channel: selected.channel,
                channelColor: selected.channelColor,
              })
              // Sync hidden edges: remove from old channel, add to new
              syncTeleporterEdges(oldChannel)
              syncTeleporterEdges(selected.channel)
            }}
          >
            {availableChannels.map((ch) => (
              <option key={ch.channel} value={ch.channel}>
                Channel {ch.channel} — {ch.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Channel Name</label>
        <input
          type="text"
          className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background"
          value={isTeleportDefaultLabel(data.label, data.channel) ? "" : data.label}
          placeholder="Name this channel..."
          onChange={(e) => {
            const newLabel = e.target.value || data.channel
            onUpdate({ label: newLabel })
            for (const partner of partners) {
              updateNodeData(partner.id, { label: newLabel })
            }
          }}
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          {isSend ? "Receives on this channel" : "Send node"}
        </label>
        {partners.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No partner nodes found</p>
        ) : (
          <div className="space-y-1">
            {partners.map((p) => (
              <button
                key={p.id}
                type="button"
                className="w-full text-left text-xs px-2 py-1 rounded hover:bg-accent/10 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => {
                  const event = new CustomEvent(TELEPORTER_PAN_EVENT, { detail: { nodeId: p.id } })
                  window.dispatchEvent(event)
                }}
              >
                {p.data.label as string} ({p.id})
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function RouterConfig({ data, onUpdate }: { data: Record<string, unknown>; onUpdate: (d: Record<string, unknown>) => void }) {
  const mode = (data.mode as string) ?? "radio"
  const routes = (data.routes as Array<{ id: string; name: string; active: boolean }>) ?? []

  const updateRoute = (index: number, patch: Partial<{ name: string; active: boolean }>) => {
    const updated = routes.map((r, i) => {
      if (i !== index) {
        if (patch.active && mode === "radio") return { ...r, active: false }
        return r
      }
      return { ...r, ...patch }
    })
    onUpdate({ routes: updated })
  }

  const addRoute = () => {
    if (routes.length >= 10) return
    const letter = String.fromCharCode(65 + routes.length)
    onUpdate({
      routes: [...routes, { id: crypto.randomUUID(), name: `Route ${letter}`, active: false }],
    })
  }

  const removeRoute = (index: number) => {
    if (routes.length <= 2) return
    const updated = routes.filter((_, i) => i !== index)
    // If radio mode and we removed the active one, activate first
    if (mode === "radio" && !updated.some((r) => r.active) && updated.length > 0) {
      updated[0] = { ...updated[0], active: true }
    }
    onUpdate({ routes: updated })
  }

  const switchMode = (newMode: string) => {
    if (newMode === "radio" && routes.filter((r) => r.active).length > 1) {
      const firstActiveIdx = routes.findIndex((r) => r.active)
      const updated = routes.map((r, i) => ({ ...r, active: i === firstActiveIdx }))
      onUpdate({ mode: newMode, routes: updated })
    } else {
      onUpdate({ mode: newMode })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Mode</Label>
        <Select value={mode} onValueChange={switchMode}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="radio">Radio (one active)</SelectItem>
            <SelectItem value="checkbox">Checkbox (any combination)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Routes</Label>
        <div className="flex flex-col gap-2">
          {routes.map((route, i) => (
            <div key={route.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateRoute(i, { active: mode === "radio" ? true : !route.active })}
                className="shrink-0"
              >
                {mode === "radio" ? (
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${route.active ? "border-green-500" : "border-muted-foreground/40"}`}>
                    {route.active && <div className="w-2 h-2 rounded-full bg-green-500" />}
                  </div>
                ) : (
                  <div className={`w-7 h-4 rounded-full relative transition-colors ${route.active ? "bg-green-500" : "bg-muted-foreground/30"}`}>
                    <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all ${route.active ? "right-0.5" : "left-0.5"}`} />
                  </div>
                )}
              </button>
              <Input
                value={route.name}
                onChange={(e) => updateRoute(i, { name: e.target.value })}
                className="h-8 text-sm flex-1"
              />
              {routes.length > 2 && (
                <button type="button" onClick={() => removeRoute(i)} className="text-muted-foreground hover:text-destructive">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {routes.length < 10 && (
          <button
            type="button"
            onClick={addRoute}
            className="mt-2 text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add Route
          </button>
        )}
      </div>
    </div>
  )
}
