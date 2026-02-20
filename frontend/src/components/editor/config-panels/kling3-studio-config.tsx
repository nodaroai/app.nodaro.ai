"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { ImageIcon, FileText, Plus, Loader2, Trash2, ChevronUp, ChevronDown, Users, X } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAuth } from "@/hooks/use-auth"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { prefetchModelCredits } from "@/hooks/use-model-credits"
import { toast } from "sonner"
import { uploadFile } from "@/lib/api"
import type { ImageToVideoData } from "@/types/nodes"
import { VIDEO_I2V_MODELS, PROVIDERS_WITH_END_FRAME } from "./model-options"
import { ModelSelectOption } from "./model-select-option"
import { MappableField } from "./mappable-field"
import type { ConfigProps } from "./types"

type Kling3Tab = "scene" | "shots" | "elements"

export function Kling3StudioConfig({ data, onUpdate, sources, fieldMappings, onMapField, onUpdateNode }: ConfigProps<ImageToVideoData>) {
  useEffect(() => { prefetchModelCredits(VIDEO_I2V_MODELS.map((m) => m.value)) }, [])
  const { user } = useAuth()
  const allNodes = useWorkflowStore((s) => s.nodes)
  const [activeTab, setActiveTab] = useState<Kling3Tab>("scene")
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  const [workflowDropdownIndex, setWorkflowDropdownIndex] = useState<number | null>(null)
  const [copiedName, setCopiedName] = useState<string | null>(null)
  const workflowDropdownRef = useRef<HTMLDivElement | null>(null)
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const elementNameRefs = useRef<Record<number, HTMLInputElement | null>>({})

  const supportsEndFrame = PROVIDERS_WITH_END_FRAME.includes(data.provider || "minimax")

  const connectedTextPrompts = useMemo(() => {
    return sources.filter((s) => s.type === "text-prompt").map((s) => ({
      id: s.id,
      label: s.label,
      text: (s.nodeData?.text as string) || "",
      targetHandle: s.targetHandle,
    }))
  }, [sources])

  const connectedImages = useMemo(() => {
    const imageTypes = ["generate-image", "upload-image", "character", "object", "location", "edit-image", "image-to-image", "scene"]
    return sources.filter((s) => imageTypes.includes(s.type)).map((s) => {
      let imageUrl: string | undefined
      const nodeData = s.nodeData || {}
      if (s.type === "upload-image") {
        imageUrl = (nodeData.url as string) || undefined
      } else if (s.type === "generate-image" || s.type === "edit-image" || s.type === "image-to-image" || s.type === "scene") {
        const results = nodeData.generatedResults as Array<{ url?: string }> | undefined
        const activeIndex = (nodeData.activeResultIndex as number) ?? 0
        if (results && results.length > 0) {
          imageUrl = results[activeIndex]?.url || results[0]?.url
        }
        if (!imageUrl) {
          imageUrl = (nodeData.generatedImageUrl as string) || undefined
        }
      } else if (s.type === "character" || s.type === "object" || s.type === "location") {
        imageUrl = (nodeData.sourceImageUrl as string) || undefined
      }
      let displayLabel = s.label
      if (s.targetHandle === "startFrame") displayLabel = `Start: ${s.label}`
      else if (s.targetHandle === "endFrame") displayLabel = `End: ${s.label}`
      return { id: s.id, type: s.type, label: displayLabel, imageUrl, targetHandle: s.targetHandle }
    })
  }, [sources])

  const handleTextPromptChange = useCallback((nodeId: string, newText: string) => {
    if (onUpdateNode) onUpdateNode(nodeId, { text: newText })
  }, [onUpdateNode])

  // Shot helpers
  const shots = data.shots ?? []
  const totalDuration = shots.reduce((sum, s) => sum + s.duration, 0)

  const handleAddShot = useCallback(() => {
    onUpdate({ shots: [...shots, { prompt: "", duration: 3 }] })
  }, [shots, onUpdate])

  const handleRemoveShot = useCallback((index: number) => {
    onUpdate({ shots: shots.filter((_, i) => i !== index) })
  }, [shots, onUpdate])

  const handleUpdateShot = useCallback((index: number, field: "prompt" | "duration", value: string | number) => {
    onUpdate({ shots: shots.map((s, i) => i === index ? { ...s, [field]: value } : s) })
  }, [shots, onUpdate])

  const handleMoveShot = useCallback((index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= shots.length) return
    const next = [...shots]
    const temp = next[index]
    next[index] = next[target]!
    next[target] = temp!
    onUpdate({ shots: next })
  }, [shots, onUpdate])

  // Element helpers
  const elements = data.elements ?? []

  const handleAddElement = useCallback(() => {
    onUpdate({ elements: [...elements, { name: "", description: "", type: "image" as const, urls: [] }] })
  }, [elements, onUpdate])

  const handleRemoveElement = useCallback((index: number) => {
    onUpdate({ elements: elements.filter((_, i) => i !== index) })
  }, [elements, onUpdate])

  const handleUpdateElement = useCallback((index: number, field: string, value: unknown) => {
    onUpdate({ elements: elements.map((el, i) => i === index ? { ...el, [field]: value } : el) })
  }, [elements, onUpdate])

  const handleRemoveElementUrl = useCallback((elementIndex: number, urlIndex: number) => {
    onUpdate({
      elements: elements.map((el, i) =>
        i === elementIndex ? { ...el, urls: el.urls.filter((_, ui) => ui !== urlIndex) } : el
      ),
    })
  }, [elements, onUpdate])

  const handleElementUpload = useCallback(async (elementIndex: number, file: File) => {
    setUploadingIndex(elementIndex)
    try {
      const result = await uploadFile(file, user?.id)
      const detectedType = file.type.startsWith("video/") ? "video" as const : "image" as const
      onUpdate({
        elements: elements.map((el, i) =>
          i === elementIndex
            ? { ...el, urls: [...el.urls, result.url], type: el.urls.length === 0 ? detectedType : el.type }
            : el
        ),
      })
    } catch {
      toast.error("Upload failed")
    } finally {
      setUploadingIndex(null)
    }
  }, [elements, onUpdate, user?.id])

  const IMAGE_NODE_TYPES = useMemo(() => new Set([
    "generate-image", "upload-image", "scene", "character", "object", "location", "edit-image", "image-to-image",
  ]), [])

  const workflowImageNodes = useMemo(() => {
    return allNodes
      .filter((n) => IMAGE_NODE_TYPES.has(String(n.type ?? "")))
      .map((n) => {
        const nd = n.data as Record<string, unknown>
        const results = nd.generatedResults as Array<{ url?: string }> | undefined
        const activeIdx = (nd.activeResultIndex as number) ?? 0
        const thumbUrl =
          results?.[activeIdx]?.url ??
          (nd.generatedImageUrl as string | undefined) ??
          (nd.url as string | undefined) ??
          (nd.portraitUrl as string | undefined) ??
          (nd.mainImageUrl as string | undefined)
        return { id: n.id, type: String(n.type), label: (nd.label as string) ?? String(n.type), thumbUrl }
      })
  }, [allNodes, IMAGE_NODE_TYPES])

  const handleAddFromWorkflow = useCallback((elementIndex: number, url: string) => {
    onUpdate({
      elements: elements.map((el, i) =>
        i === elementIndex ? { ...el, urls: [...el.urls, url] } : el
      ),
    })
    setWorkflowDropdownIndex(null)
  }, [elements, onUpdate])

  useEffect(() => {
    if (workflowDropdownIndex === null) return
    function handleClickOutside(e: MouseEvent) {
      if (workflowDropdownRef.current && !workflowDropdownRef.current.contains(e.target as Node)) {
        setWorkflowDropdownIndex(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [workflowDropdownIndex])

  useEffect(() => {
    const lastIdx = elements.length - 1
    if (lastIdx >= 0 && elements[lastIdx]?.name === "") {
      elementNameRefs.current[lastIdx]?.focus()
    }
  }, [elements.length])

  const hasEndFrame = connectedImages.some((img) => img.targetHandle === "endFrame")

  const tabClass = (tab: Kling3Tab) =>
    `px-3 py-2 text-xs font-medium transition-colors ${
      activeTab === tab
        ? "border-b-2 border-[#ff0073] text-[#ff0073] font-semibold"
        : "text-muted-foreground hover:text-foreground"
    }`

  return (
    <div className="flex flex-col gap-4">
      {/* Connected Images */}
      {connectedImages.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
            Connected Images ({connectedImages.length})
          </Label>
          <div className="flex flex-col gap-2">
            {connectedImages.map((img) => (
              <div key={img.id} className="flex items-center gap-2">
                <span className="text-[10px] text-gray-500 dark:text-[#64748B] font-medium w-16 shrink-0 leading-tight truncate" title={img.label}>
                  {img.label}
                </span>
                <div
                  className="flex-1 h-16 rounded-lg border border-border overflow-hidden cursor-pointer hover:ring-2 hover:ring-[#ff0073] transition-all bg-muted/30"
                  onClick={() => img.imageUrl && setLightboxImage(img.imageUrl)}
                  title={`Click to view: ${img.label}`}
                >
                  {img.imageUrl ? (
                    <img src={img.imageUrl} alt={img.label} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Click to view full size</p>
        </div>
      )}

      {/* Connected Text Prompts */}
      {connectedTextPrompts.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
            Motion Prompt (from connected node)
          </Label>
          {connectedTextPrompts.map((prompt, idx) => (
            <div key={`${prompt.id}-${idx}`} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 mb-1">
                <FileText className="w-3 h-3 text-[#ff0073]" />
                <span className="text-[10px] text-[#ff0073] font-medium">{prompt.label}</span>
              </div>
              <Textarea
                value={prompt.text}
                onChange={(e) => handleTextPromptChange(prompt.id, e.target.value)}
                placeholder="Enter motion prompt..."
                rows={3}
                className="text-xs bg-muted/30 border-border resize-none"
              />
            </div>
          ))}
        </div>
      )}

      {/* Manual Motion Prompt */}
      {connectedTextPrompts.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
            Motion Prompt
          </Label>
          <Textarea
            value={data.motionPrompt || ""}
            onChange={(e) => onUpdate({ motionPrompt: e.target.value })}
            placeholder="Describe the overall scene, characters, and setting. Use @name to reference elements. Add dialogue with 'character says ...'"
            rows={3}
            className="text-xs bg-muted/30 border-border resize-none"
          />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Tip: Connect a Text Prompt node for reusable prompts
          </p>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex border-b border-gray-200 dark:border-[#2D2D2D]">
        <button type="button" className={tabClass("scene")} onClick={() => setActiveTab("scene")}>Scene</button>
        <button type="button" className={tabClass("shots")} onClick={() => setActiveTab("shots")}>Shots</button>
        <button type="button" className={tabClass("elements")} onClick={() => setActiveTab("elements")}>Elements</button>
      </div>

      {/* SCENE TAB */}
      {activeTab === "scene" && (
        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Provider</Label>
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <MappableField field="provider" label="Model" sources={sources} fieldMappings={fieldMappings} onMapField={onMapField} providerCategory="video">
                <Select
                  value={data.provider || "minimax"}
                  onValueChange={(v) => onUpdate({ provider: v as ImageToVideoData["provider"] })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VIDEO_I2V_MODELS.map((m) => (
                      <ModelSelectOption key={m.value} value={m.value} label={m.label} desc={m.desc} />
                    ))}
                  </SelectContent>
                </Select>
              </MappableField>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">Generation Settings</Label>
            <div className="rounded-xl border border-border bg-card p-3 shadow-sm space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-1 block">Mode</Label>
                  <Select
                    value={(data as Record<string, unknown>).kling3Mode as string ?? "pro"}
                    onValueChange={(v) => onUpdate({ kling3Mode: v })}
                  >
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pro">Pro</SelectItem>
                      <SelectItem value="std">Standard</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground mb-1 block">Aspect Ratio</Label>
                  <Select
                    value={data.aspectRatio ?? "16:9"}
                    onValueChange={(v) => onUpdate({ aspectRatio: v })}
                  >
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="16:9">16:9</SelectItem>
                      <SelectItem value="9:16">9:16</SelectItem>
                      <SelectItem value="1:1">1:1</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-2 py-1" title={data.multiShot ? "Sound is required in multi-shot mode" : undefined}>
                <input
                  type="checkbox"
                  id="kling3Sound"
                  checked={data.multiShot ? true : (data as Record<string, unknown>).kling3Sound !== false}
                  onChange={(e) => onUpdate({ kling3Sound: e.target.checked })}
                  disabled={!!data.multiShot}
                  className="rounded border-muted-foreground/40 accent-[#ff0073] disabled:opacity-50"
                />
                <label htmlFor="kling3Sound" className={`text-xs ${data.multiShot ? "text-muted-foreground" : ""}`}>Sound Effects</label>
                {data.multiShot ? (
                  <span className="text-[10px] text-muted-foreground ml-auto italic">Required for multi-shot</span>
                ) : (
                  <span className="text-[10px] text-muted-foreground ml-auto">Lip-sync + SFX</span>
                )}
              </div>

              <div>
                <Label className="text-[10px] text-muted-foreground mb-1 block">Duration</Label>
                {data.multiShot ? (
                  <div className="flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
                    {totalDuration}s (from shots)
                  </div>
                ) : (
                  <Select
                    value={String(data.duration || 5)}
                    onValueChange={(v) => onUpdate({ duration: parseInt(v, 10) })}
                  >
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((d) => (
                        <SelectItem key={d} value={String(d)}>{d}s</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>

          {supportsEndFrame && !data.multiShot && (
            <p className="text-[10px] text-muted-foreground px-1">
              Connect an image node to the &quot;End Frame&quot; handle for start-to-end frame generation.
            </p>
          )}

          <p className="text-[10px] text-muted-foreground/70 px-1 leading-relaxed">
            Kling 3.0 generates cinematic video with native audio, lip-synced dialogue, multi-shot storyboarding, and element references.
          </p>
        </div>
      )}

      {/* SHOTS TAB */}
      {activeTab === "shots" && (
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="multiShotToggle"
                  checked={data.multiShot ?? false}
                  onChange={(e) => {
                    const checked = e.target.checked
                    if (checked && shots.length === 0) {
                      onUpdate({ multiShot: true, shots: [{ prompt: "", duration: 3 }] })
                    } else {
                      onUpdate({ multiShot: checked })
                    }
                  }}
                  className="rounded border-muted-foreground/40 accent-[#ff0073]"
                />
                <label htmlFor="multiShotToggle" className="text-xs font-medium">Multi-Shot Mode</label>
              </div>
              {data.multiShot && (
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${totalDuration > 15 ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"}`}>
                  {totalDuration}s / 15s
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5">
              Split your video into 2-6 scenes, each with its own prompt and timing.
            </p>
          </div>

          {data.multiShot ? (
            <div className="flex flex-col gap-3">
              {hasEndFrame && (
                <p className="text-[10px] text-amber-500 px-1">End frame is not supported in multi-shot mode.</p>
              )}

              {shots.map((shot, i) => (
                <div key={i} className="rounded-xl border border-border bg-card p-3 shadow-sm space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold text-foreground shrink-0">Shot {i + 1}</span>
                    <Select
                      value={String(shot.duration)}
                      onValueChange={(v) => handleUpdateShot(i, "duration", parseInt(v, 10))}
                    >
                      <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, k) => k + 1).map((d) => (
                          <SelectItem key={d} value={String(d)}>{d}s</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => handleMoveShot(i, -1)}
                      disabled={i === 0}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                      title="Move up"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveShot(i, 1)}
                      disabled={i === shots.length - 1}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                      title="Move down"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                    {shots.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveShot(i)}
                        className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 transition-colors"
                        title="Delete shot"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <Textarea
                    value={shot.prompt}
                    onChange={(e) => handleUpdateShot(i, "prompt", e.target.value)}
                    placeholder="Camera angle, action, dialogue... e.g. Close-up, she whispers 'I knew you'd come back.' Soft rain."
                    rows={2}
                    className="text-xs bg-muted/30 border-border resize-none"
                  />
                  {elements.some((el) => el.name.trim()) && (
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-[9px] text-muted-foreground">Reference:</span>
                      {copiedName && <span className="text-[9px] text-green-400 animate-pulse">Copied!</span>}
                      {elements.filter((el) => el.name.trim()).map((el) => (
                        <span
                          key={el.name}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-400 cursor-pointer hover:bg-pink-500/20 transition-colors"
                          title="Click to copy @name"
                          onClick={() => {
                            navigator.clipboard.writeText(`@${el.name}`)
                            setCopiedName(el.name)
                            setTimeout(() => setCopiedName(null), 1500)
                          }}
                        >
                          @{el.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <div className="rounded-xl border border-border bg-gradient-to-br from-[#ff0073]/5 to-purple-500/5 p-3 space-y-1.5">
                <span className="text-[11px] font-semibold text-foreground">Director Tips</span>
                <div className="grid grid-cols-1 gap-1">
                  <span className="text-[10px] text-muted-foreground">Dialogue: character says &quot;...&quot; or whispers &quot;...&quot;</span>
                  <span className="text-[10px] text-muted-foreground">Voice tone: calm, excited, sad, angry, whispering</span>
                  <span className="text-[10px] text-muted-foreground">Camera: dolly zoom, tracking, close-up, wide establishing</span>
                  <span className="text-[10px] text-muted-foreground">Languages: English, Chinese, Japanese, Korean, Spanish</span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleAddShot}
                disabled={shots.length >= 6}
                className="w-full py-2.5 rounded-xl border-2 border-dashed border-border hover:border-[#ff0073]/50 text-xs text-muted-foreground hover:text-[#ff0073] transition-colors disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add Shot {shots.length < 6 && `(${shots.length}/6)`}
              </button>
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground/70 px-1">
              Single continuous shot using the master prompt and duration from the Scene tab.
            </p>
          )}
        </div>
      )}

      {/* ELEMENTS TAB */}
      {activeTab === "elements" && (
        <div className="flex flex-col gap-4">
          {elements.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 gap-2.5">
              <Users className="w-10 h-10 text-muted-foreground/30" />
              <span className="text-xs font-medium text-foreground">No elements yet</span>
              <p className="text-[10px] text-muted-foreground max-w-[220px] text-center">
                Elements let you create consistent characters and objects across shots.
              </p>
            </div>
          )}

          {elements.map((el, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-3 shadow-sm space-y-3">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-[#ff0073] font-bold shrink-0">@</span>
                <input
                  ref={(ref) => { elementNameRefs.current[i] = ref }}
                  type="text"
                  value={el.name}
                  onChange={(e) => handleUpdateElement(i, "name", e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""))}
                  placeholder="name your character..."
                  className={`h-7 w-28 px-1 text-xs font-medium bg-transparent border-b-2 font-mono outline-none transition-colors ${el.name === "" ? "border-red-500" : "border-[#ff0073]"} focus:border-[#ff0073]`}
                />
                <button
                  type="button"
                  onClick={() => handleUpdateElement(i, "type", el.type === "image" ? "video" : "image")}
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors shrink-0 ${
                    el.type === "image"
                      ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400"
                      : "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400"
                  }`}
                >
                  {el.type === "image" ? "Image" : "Video"}
                </button>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => handleRemoveElement(i)}
                  className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                  title="Delete element"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div>
                <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block">Description</span>
                <input
                  type="text"
                  value={el.description}
                  onChange={(e) => handleUpdateElement(i, "description", e.target.value.slice(0, 100))}
                  maxLength={100}
                  placeholder="Describe appearance, clothing, voice tone... e.g. 'Young woman with red hair, green jacket, confident warm voice'"
                  className="w-full h-8 px-2.5 text-xs rounded-lg border-2 border-border bg-background outline-none focus:border-[#ff0073] transition-colors"
                />
                <span className={`text-[9px] mt-0.5 block text-right ${el.description.length >= 100 ? "text-red-500" : el.description.length > 80 ? "text-yellow-500" : "text-muted-foreground"}`}>
                  {el.description.length}/100
                </span>
              </div>

              <div>
                <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1 block">References (2-4 recommended)</span>
                {el.urls.length > 0 ? (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {el.urls.map((url, ui) => (
                      <div key={ui} className="relative group/thumb w-12 h-12 shrink-0">
                        <img src={url} alt={`${el.name} ${ui + 1}`} className="w-12 h-12 rounded-lg object-cover border border-border" />
                        <button
                          type="button"
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity shadow-sm"
                          onClick={() => handleRemoveElementUrl(i, ui)}
                          title="Remove"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-14 rounded-lg border-2 border-dashed border-border bg-muted/20 text-muted-foreground/50">
                    <ImageIcon className="w-5 h-5 mb-0.5" />
                    <span className="text-[10px]">Drop images or use buttons below</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 relative">
                <button
                  type="button"
                  className="h-7 px-2.5 rounded-lg border border-dashed border-border hover:border-[#ff0073]/50 text-[10px] text-muted-foreground hover:text-[#ff0073] transition-colors"
                  onClick={() => alert("Coming soon")}
                >
                  + Library
                </button>
                <button
                  type="button"
                  className="h-7 px-2.5 rounded-lg border border-dashed border-border hover:border-[#ff0073]/50 text-[10px] text-muted-foreground hover:text-[#ff0073] transition-colors disabled:opacity-40"
                  disabled={uploadingIndex === i}
                  onClick={() => fileInputRefs.current[i]?.click()}
                >
                  {uploadingIndex === i ? (
                    <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Uploading</span>
                  ) : (
                    "+ Upload"
                  )}
                </button>
                <input
                  ref={(ref) => { fileInputRefs.current[i] = ref }}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleElementUpload(i, file)
                    e.target.value = ""
                  }}
                />
                <button
                  type="button"
                  className="h-7 px-2.5 rounded-lg border border-dashed border-border hover:border-[#ff0073]/50 text-[10px] text-muted-foreground hover:text-[#ff0073] transition-colors"
                  onClick={() => setWorkflowDropdownIndex(workflowDropdownIndex === i ? null : i)}
                >
                  + Workflow
                </button>

                {workflowDropdownIndex === i && (
                  <div
                    ref={workflowDropdownRef}
                    className="absolute top-full left-0 mt-1 w-56 max-h-48 overflow-y-auto z-50 rounded-xl border border-border bg-card shadow-lg"
                  >
                    {workflowImageNodes.length === 0 ? (
                      <p className="text-[10px] text-muted-foreground p-3 text-center">No image nodes in workflow</p>
                    ) : (
                      workflowImageNodes.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors"
                          disabled={!node.thumbUrl}
                          onClick={() => node.thumbUrl && handleAddFromWorkflow(i, node.thumbUrl)}
                        >
                          {node.thumbUrl ? (
                            <img src={node.thumbUrl} alt={node.label} className="w-7 h-7 rounded-lg object-cover border border-border shrink-0" />
                          ) : (
                            <div className="w-7 h-7 rounded-lg bg-muted/30 border border-dashed border-muted-foreground/20 flex items-center justify-center shrink-0">
                              <ImageIcon className="w-3 h-3 text-muted-foreground/40" />
                            </div>
                          )}
                          <div className="flex flex-col min-w-0">
                            <span className="text-[10px] font-medium truncate">{node.label}</span>
                            <span className="text-[9px] text-muted-foreground">{node.type}</span>
                          </div>
                          {!node.thumbUrl && <span className="text-[9px] text-muted-foreground/60 ml-auto">No output</span>}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {el.type === "image" && (
                <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                  Tip: Add voice description like &quot;deep calm male voice&quot; to enable dialogue
                </p>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={handleAddElement}
            disabled={elements.length >= 5}
            className="w-full py-2.5 rounded-xl border-2 border-dashed border-border hover:border-[#ff0073]/50 text-xs text-muted-foreground hover:text-[#ff0073] transition-colors disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" /> Add Element {elements.length < 5 && `(${elements.length}/5)`}
          </button>

          <div className="rounded-xl border border-border bg-gradient-to-br from-[#ff0073]/5 to-transparent p-3">
            <p className="text-[10px] text-muted-foreground">
              Example: <span className="font-mono text-foreground">&quot;Close-up of @hero walking through rain&quot;</span>
            </p>
          </div>
        </div>
      )}

      {/* Image Lightbox */}
      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage}
          alt="Connected image"
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  )
}
