"use client"

import { useEffect, useCallback, useState, useRef, useMemo } from "react"
import { createPortal } from "react-dom"
import {
  X, Play, Loader2, Image as ImageIcon, Volume2, ChevronUp, ChevronDown,
  Trash2, Plus, Film, Settings, ChevronDown as ChevronDownIcon, Users,
  Upload, GitBranch,
} from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useAuth } from "@/hooks/use-auth"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { uploadFile } from "@/lib/api"
import type { ImageToVideoData, GeneratedResult } from "@/types/nodes"

// ─── Types ──────────────────────────────────────────────────────────────────

type DirectorTab = "scene" | "shots" | "elements"

interface Kling3DirectorModalProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly nodeId: string
}

// Node types that output images
const IMAGE_OUTPUT_TYPES = new Set([
  "generate-image", "upload-image", "scene",
  "character", "object", "location",
  "edit-image", "image-to-image",
])

function getNodeThumbnail(srcData: Record<string, unknown>, nodeType: string): string | undefined {
  if (!IMAGE_OUTPUT_TYPES.has(nodeType)) return undefined
  const results = (srcData.generatedResults as readonly GeneratedResult[] | undefined) ?? []
  const activeIdx = (srcData.activeResultIndex as number | undefined) ?? 0
  return (
    results[activeIdx]?.url ??
    (srcData.generatedImageUrl as string | undefined) ??
    (srcData.url as string | undefined) ??
    (srcData.portraitUrl as string | undefined) ??
    (srcData.mainImageUrl as string | undefined)
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

export function Kling3DirectorModal({ isOpen, onClose, nodeId }: Kling3DirectorModalProps) {
  const { user } = useAuth()
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)

  const [activeTab, setActiveTab] = useState<DirectorTab>("scene")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  const [workflowDropdownIndex, setWorkflowDropdownIndex] = useState<number | null>(null)
  const [copiedName, setCopiedName] = useState<string | null>(null)
  const workflowDropdownRef = useRef<HTMLDivElement | null>(null)
  const fileInputRefs = useRef<Record<number, HTMLInputElement | null>>({})
  const elementNameRefs = useRef<Record<number, HTMLInputElement | null>>({})

  const node = nodes.find((n) => n.id === nodeId)
  const data = node?.data as ImageToVideoData | undefined

  const credits = useModelCredits(data?.provider ?? "kling-3.0", 10)

  // ── Resolve connected start frame ──
  const startFrameUrl = useMemo(() => {
    const edge = edges.find((e) => e.target === nodeId && e.targetHandle === "startFrame")
    if (!edge) return undefined
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) return undefined
    return getNodeThumbnail(srcNode.data as Record<string, unknown>, String(srcNode.type ?? ""))
  }, [edges, nodes, nodeId])

  // ── Resolve connected end frame ──
  const endFrameUrl = useMemo(() => {
    const edge = edges.find((e) => e.target === nodeId && e.targetHandle === "endFrame")
    if (!edge) return undefined
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) return undefined
    return getNodeThumbnail(srcNode.data as Record<string, unknown>, String(srcNode.type ?? ""))
  }, [edges, nodes, nodeId])

  // ── Resolve connected audio ──
  const audioLabel = useMemo(() => {
    const edge = edges.find((e) => e.target === nodeId && e.targetHandle === "audio")
    if (!edge) return undefined
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) return undefined
    const srcData = srcNode.data as Record<string, unknown>
    return (srcData.label as string | undefined) ?? String(srcNode.type ?? "Audio")
  }, [edges, nodes, nodeId])

  // ── Escape key ──
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose()
  }, [onClose])

  useEffect(() => {
    if (!isOpen) return
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, handleKeyDown])

  // Reset tab on open
  useEffect(() => {
    if (isOpen) setActiveTab("scene")
  }, [isOpen])

  // Auto-focus empty element name input
  useEffect(() => {
    const els = data?.elements ?? []
    const lastIdx = els.length - 1
    if (lastIdx >= 0 && els[lastIdx]?.name === "") {
      elementNameRefs.current[lastIdx]?.focus()
    }
  }, [data?.elements?.length])

  // ── Workflow image nodes for "From Workflow" picker ──
  const IMAGE_NODE_TYPES = useMemo(() => new Set([
    "generate-image", "upload-image", "scene", "character", "object", "location", "edit-image", "image-to-image",
  ]), [])

  const workflowImageNodes = useMemo(() => {
    return nodes
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
  }, [nodes, IMAGE_NODE_TYPES])

  // Close workflow dropdown on outside click
  useEffect(() => {
    if (workflowDropdownIndex === null) return
    const handleClickOutside = (e: MouseEvent) => {
      if (workflowDropdownRef.current && !workflowDropdownRef.current.contains(e.target as Node)) {
        setWorkflowDropdownIndex(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [workflowDropdownIndex])

  if (!isOpen || !data) return null

  const status = data.executionStatus ?? "idle"
  const videoResults = data.generatedResults ?? []
  const activeIndex = data.activeResultIndex ?? 0
  const activeVideoUrl = videoResults[activeIndex]?.url ?? data.generatedVideoUrl

  // ── Helpers (immutable updates) ──
  function handleUpdate(updates: Record<string, unknown>) {
    updateNodeData(nodeId, updates)
  }

  const shots = data.shots ?? []
  const totalDuration = shots.reduce((sum, s) => sum + s.duration, 0)
  const elements = data.elements ?? []

  function handleAddShot() {
    handleUpdate({ shots: [...shots, { prompt: "", duration: 3 }] })
  }
  function handleRemoveShot(index: number) {
    handleUpdate({ shots: shots.filter((_, i) => i !== index) })
  }
  function handleUpdateShot(index: number, field: "prompt" | "duration", value: string | number) {
    handleUpdate({ shots: shots.map((s, i) => i === index ? { ...s, [field]: value } : s) })
  }
  function handleMoveShot(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= shots.length) return
    const next = [...shots]
    const temp = next[index]
    next[index] = next[target]!
    next[target] = temp!
    handleUpdate({ shots: next })
  }

  function handleAddElement() {
    handleUpdate({ elements: [...elements, { name: "", description: "", type: "image" as const, urls: [] }] })
  }
  function handleRemoveElement(index: number) {
    handleUpdate({ elements: elements.filter((_, i) => i !== index) })
  }
  function handleUpdateElement(index: number, field: string, value: unknown) {
    handleUpdate({ elements: elements.map((el, i) => i === index ? { ...el, [field]: value } : el) })
  }
  function handleRemoveElementUrl(elementIndex: number, urlIndex: number) {
    handleUpdate({
      elements: elements.map((el, i) =>
        i === elementIndex ? { ...el, urls: el.urls.filter((_, ui) => ui !== urlIndex) } : el
      ),
    })
  }

  async function handleElementUpload(elementIndex: number, file: File) {
    setUploadingIndex(elementIndex)
    try {
      const result = await uploadFile(file, user?.id)
      const detectedType = file.type.startsWith("video/") ? "video" as const : "image" as const
      const currentData = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)?.data as ImageToVideoData | undefined
      const currentElements = currentData?.elements ?? []
      handleUpdate({
        elements: currentElements.map((el, i) =>
          i === elementIndex
            ? { ...el, urls: [...el.urls, result.url], type: el.urls.length === 0 ? detectedType : el.type }
            : el
        ),
      })
    } catch (err) {
      // Upload failed silently - user sees no spinner
      void err
    } finally {
      setUploadingIndex(null)
    }
  }

  function handleAddFromWorkflow(elementIndex: number, url: string) {
    handleUpdate({
      elements: elements.map((el, i) =>
        i === elementIndex ? { ...el, urls: [...el.urls, url] } : el
      ),
    })
    setWorkflowDropdownIndex(null)
  }

  // ── Tab button styling (pill style like SceneEditorModal) ──
  const tabClass = (tab: DirectorTab) =>
    `flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all ${
      activeTab === tab
        ? "bg-[#ff0073] text-white shadow-md"
        : "text-gray-500 dark:text-[#94A3B8] bg-gray-100 dark:bg-[#2D2D2D] hover:bg-gray-200 dark:hover:bg-[#3D3D3D] hover:text-gray-700 dark:hover:text-white"
    }`

  return createPortal(
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm dark:bg-black/70 dark:backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative bg-background dark:bg-[#1E1E1E] border border-border dark:border-[#2D2D2D] rounded-xl w-[90vw] h-[85vh] max-w-6xl flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ═══ Header ═══ */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] shrink-0">
          <div className="flex items-center gap-3">
            <Film className="w-4 h-4 text-[#ff0073]" />
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-700 dark:text-[#ff0073]">
              Kling 3.0 Director
            </h2>
            {/* Status badges */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 font-medium">
                {(data as Record<string, unknown>).kling3Mode === "std" ? "Std" : "Pro"}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">
                {data.aspectRatio ?? "16:9"}
              </span>
              {(data as Record<string, unknown>).kling3Sound !== false && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">
                  Sound
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="p-1.5 text-gray-400 dark:text-[#64748B] hover:text-gray-700 dark:hover:text-white rounded-lg hover:bg-gray-100 dark:hover:bg-[#2D2D2D] transition-colors"
            onClick={onClose}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ═══ Body ═══ */}
        <div className="flex flex-1 overflow-hidden">
          {/* ─── Left Panel: Preview ─── */}
          <div className="w-[35%] flex flex-col border-r border-gray-200 dark:border-[#2D2D2D] overflow-y-auto bg-white dark:bg-[#1E1E1E]">
            <div className="p-4 flex flex-col gap-4">
              {/* Start Frame */}
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
                  Start Frame
                </span>
                {startFrameUrl ? (
                  <img
                    src={startFrameUrl}
                    alt="Start frame"
                    className="w-full rounded-xl object-contain max-h-[30vh] bg-[#F8FAFC] dark:bg-[#121212] border border-gray-200 dark:border-[#2D2D2D]"
                  />
                ) : (
                  <div className="flex items-center justify-center h-32 rounded-xl border-2 border-dashed border-gray-300 dark:border-[#2D2D2D] bg-[#F8FAFC] dark:bg-[#121212] text-gray-400 dark:text-[#64748B]">
                    <div className="flex flex-col items-center gap-1.5">
                      <ImageIcon className="w-6 h-6" />
                      <span className="text-[10px] font-mono">Connect an image node to Start Frame</span>
                    </div>
                  </div>
                )}
              </div>

              {/* End Frame */}
              {data.multiShot ? (
                <p className="text-[10px] text-muted-foreground italic">End frame not available in multi-shot mode</p>
              ) : (
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
                    End Frame
                  </span>
                  {endFrameUrl ? (
                    <img
                      src={endFrameUrl}
                      alt="End frame"
                      className="w-full rounded-xl object-contain max-h-[30vh] bg-[#F8FAFC] dark:bg-[#121212] border border-gray-200 dark:border-[#2D2D2D]"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-32 rounded-xl border-2 border-dashed border-gray-300 dark:border-[#2D2D2D] bg-[#F8FAFC] dark:bg-[#121212] text-gray-400 dark:text-[#64748B]">
                      <div className="flex flex-col items-center gap-1.5">
                        <ImageIcon className="w-6 h-6" />
                        <span className="text-[10px] font-mono">Connect an image node to End Frame</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Video Player / Loading / Placeholder */}
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
                  Generated Video
                </span>
                {status === "running" && (
                  <div className="flex items-center justify-center h-48 rounded-xl bg-[#F8FAFC] dark:bg-[#121212] border border-gray-200 dark:border-[#2D2D2D]">
                    <div className="flex flex-col items-center gap-2">
                      <Loader2 className="w-8 h-8 animate-spin text-[#ff0073]" />
                      <span className="text-xs text-gray-500 dark:text-[#94A3B8] font-mono">Generating video...</span>
                      {data.currentJobProgress != null && data.currentJobProgress > 0 && (
                        <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#ff0073] transition-all duration-300 ease-out"
                            style={{ width: `${data.currentJobProgress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {status !== "running" && activeVideoUrl && (
                  <video
                    key={activeVideoUrl}
                    src={activeVideoUrl}
                    controls
                    className="w-full rounded-xl max-h-[40vh] bg-black border border-gray-200 dark:border-[#2D2D2D]"
                  />
                )}

                {status !== "running" && !activeVideoUrl && (
                  <div className="flex items-center justify-center h-36 rounded-xl border-2 border-dashed border-gray-300 dark:border-[#2D2D2D] bg-[#F8FAFC] dark:bg-[#121212] text-gray-400 dark:text-[#64748B]">
                    <div className="flex flex-col items-center gap-1.5">
                      <Film className="w-6 h-6" />
                      <span className="text-[10px] font-mono">No video generated yet</span>
                    </div>
                  </div>
                )}

                {/* Video version history */}
                {videoResults.length > 1 && (
                  <div className="flex gap-1.5 overflow-x-auto mt-2 pb-1">
                    {videoResults.map((r, i) => (
                      <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                        <div
                          className={`w-14 h-14 rounded-md cursor-pointer transition-opacity flex items-center justify-center bg-muted ${
                            i === activeIndex
                              ? "opacity-100 ring-2 ring-primary"
                              : "opacity-50 hover:opacity-80"
                          }`}
                          onClick={() => updateNodeData(nodeId, { activeResultIndex: i, generatedVideoUrl: r.url })}
                        >
                          <Film className="w-4 h-4 text-muted-foreground" />
                          <span className="text-[9px] text-muted-foreground ml-0.5">{i + 1}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Audio indicator */}
              {audioLabel && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-500/5 border border-green-500/20">
                  <Volume2 className="w-4 h-4 text-green-500" />
                  <span className="text-xs text-green-700 dark:text-green-400">{audioLabel}</span>
                </div>
              )}

              {/* Element Thumbnails Grid */}
              {elements.length > 0 && elements.some((el) => el.urls.length > 0) && (
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-2 block">
                    Element References
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {elements.filter((el) => el.urls.length > 0).map((el) => (
                      <div key={el.name} className="flex flex-col items-center gap-1">
                        <div className="w-16 h-16 rounded-lg overflow-hidden border border-border">
                          <img src={el.urls[0]!} alt={el.name} className="w-full h-full object-cover" />
                        </div>
                        <span className="text-[9px] text-muted-foreground font-mono">@{el.name}</span>
                        {el.urls.length > 1 && (
                          <span className="text-[8px] text-muted-foreground/60">+{el.urls.length - 1} more</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ─── Right Panel: Config Tabs ─── */}
          <div className="w-[65%] flex flex-col overflow-hidden bg-white dark:bg-[#1E1E1E]">
            {/* Tab Bar (pill style) */}
            <div className="px-5 pt-5 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <button type="button" className={tabClass("scene")} onClick={() => setActiveTab("scene")}>
                  Scene
                </button>
                <button type="button" className={tabClass("shots")} onClick={() => setActiveTab("shots")}>
                  Shots {data.multiShot && shots.length > 0 ? `(${shots.length})` : ""}
                </button>
                <button type="button" className={tabClass("elements")} onClick={() => setActiveTab("elements")}>
                  Elements {elements.length > 0 ? `(${elements.length})` : ""}
                </button>
              </div>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto px-6 pb-4">

              {/* ═══ SCENE TAB ═══ */}
              {activeTab === "scene" && (
                <div className="flex flex-col gap-4">
                  {/* Scene Name */}
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-1.5 block">
                      Scene Name
                    </label>
                    <input
                      type="text"
                      value={(data as Record<string, unknown>).sceneName as string ?? ""}
                      onChange={(e) => handleUpdate({ sceneName: e.target.value })}
                      placeholder="e.g. Opening Chase, Rooftop Dialogue..."
                      className="w-full h-10 px-3 text-base font-medium rounded-lg border border-border bg-muted/30 focus:border-[#ff0073] focus:ring-1 focus:ring-[#ff0073]/20 outline-none transition-colors"
                    />
                  </div>

                  {/* Master Prompt */}
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-1.5 block">
                      Master Prompt
                    </label>
                    <textarea
                      value={(data.motionPrompt as string) ?? ""}
                      onChange={(e) => handleUpdate({ motionPrompt: e.target.value })}
                      placeholder="Describe the overall scene, characters, and setting. Use @name to reference elements. Add dialogue with 'character says ...'"
                      rows={5}
                      className="w-full p-3 text-sm min-h-[150px] rounded-lg border border-border bg-muted/30 focus:border-[#ff0073] focus:ring-1 focus:ring-[#ff0073]/20 outline-none resize-none leading-relaxed transition-colors"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Tip: reference elements with <span className="font-mono text-[#ff0073]">@name</span> and include dialogue with quotes.
                    </p>
                  </div>

                  {/* Generation Settings (collapsible) */}
                  <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setSettingsOpen(!settingsOpen)}
                      className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B]">
                          Generation Settings
                        </span>
                      </div>
                      <ChevronDownIcon className={`w-4 h-4 text-muted-foreground transition-transform ${settingsOpen ? "rotate-180" : ""}`} />
                    </button>
                    {settingsOpen && (
                      <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-[10px] text-muted-foreground mb-1 block">Mode</label>
                            <select
                              value={(data as Record<string, unknown>).kling3Mode as string ?? "pro"}
                              onChange={(e) => handleUpdate({ kling3Mode: e.target.value })}
                              className="w-full h-8 px-2 text-xs rounded-md border border-border bg-muted/30 outline-none"
                            >
                              <option value="pro">Pro</option>
                              <option value="std">Standard</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-muted-foreground mb-1 block">Aspect Ratio</label>
                            <select
                              value={data.aspectRatio ?? "16:9"}
                              onChange={(e) => handleUpdate({ aspectRatio: e.target.value })}
                              className="w-full h-8 px-2 text-xs rounded-md border border-border bg-muted/30 outline-none"
                            >
                              <option value="16:9">16:9</option>
                              <option value="9:16">9:16</option>
                              <option value="1:1">1:1</option>
                            </select>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 py-1" title={data.multiShot ? "Sound is required in multi-shot mode" : undefined}>
                          <input
                            type="checkbox"
                            id="directorSound"
                            checked={data.multiShot ? true : (data as Record<string, unknown>).kling3Sound !== false}
                            onChange={(e) => handleUpdate({ kling3Sound: e.target.checked })}
                            disabled={!!data.multiShot}
                            className="rounded border-muted-foreground/40 accent-[#ff0073] disabled:opacity-50"
                          />
                          <label htmlFor="directorSound" className={`text-xs ${data.multiShot ? "text-muted-foreground" : ""}`}>Sound Effects</label>
                          {data.multiShot ? (
                            <span className="text-[10px] text-muted-foreground ml-auto italic">Required for multi-shot</span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground ml-auto">Lip-sync + SFX</span>
                          )}
                        </div>

                        <div>
                          <label className="text-[10px] text-muted-foreground mb-1 block">Duration</label>
                          {data.multiShot ? (
                            <div className="flex items-center gap-2 h-8 px-3 rounded-md border border-border bg-muted/30 text-xs text-muted-foreground">
                              {totalDuration}s (from shots)
                            </div>
                          ) : (
                            <select
                              value={String(data.duration || 5)}
                              onChange={(e) => handleUpdate({ duration: parseInt(e.target.value, 10) })}
                              className="w-full h-8 px-2 text-xs rounded-md border border-border bg-muted/30 outline-none"
                            >
                              {[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((d) => (
                                <option key={d} value={String(d)}>{d}s</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                    Kling 3.0 generates cinematic video with native audio, lip-synced dialogue, multi-shot storyboarding, and element references.
                  </p>
                </div>
              )}

              {/* ═══ SHOTS TAB ═══ */}
              {activeTab === "shots" && (
                <div className="flex flex-col gap-4">
                  {/* Toggle */}
                  <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="directorMultiShot"
                          checked={data.multiShot ?? false}
                          onChange={(e) => {
                            const checked = e.target.checked
                            if (checked && shots.length === 0) {
                              handleUpdate({ multiShot: true, shots: [{ prompt: "", duration: 3 }] })
                            } else {
                              handleUpdate({ multiShot: checked })
                            }
                          }}
                          className="rounded border-muted-foreground/40 accent-[#ff0073]"
                        />
                        <label htmlFor="directorMultiShot" className="text-sm font-medium">Multi-Shot Mode</label>
                      </div>
                      {data.multiShot && (
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${totalDuration > 15 ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400" : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400"}`}>
                          {totalDuration}s / 15s max
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Split your video into 2-6 scenes, each with its own prompt and timing (max 15s total).
                    </p>
                  </div>

                  {data.multiShot ? (
                    <div className="flex flex-col gap-3">
                      {/* Director Tips */}
                      <div className="rounded-xl border border-border bg-gradient-to-br from-[#ff0073]/5 to-purple-500/5 p-4 space-y-2">
                        <span className="text-xs font-semibold text-foreground">Director Tips</span>
                        <div className="grid grid-cols-1 gap-1">
                          <span className="text-[11px] text-muted-foreground">Dialogue: character says &quot;...&quot; or whispers &quot;...&quot;</span>
                          <span className="text-[11px] text-muted-foreground">Voice tone: calm, excited, sad, angry, whispering</span>
                          <span className="text-[11px] text-muted-foreground">Camera: dolly zoom, tracking, close-up, wide establishing</span>
                          <span className="text-[11px] text-muted-foreground">Languages: English, Chinese, Japanese, Korean, Spanish</span>
                        </div>
                      </div>

                      {/* Shot Cards */}
                      {shots.map((shot, i) => (
                        <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
                          <div className="flex items-center gap-2">
                            <span className="text-base font-bold text-foreground shrink-0">Shot {i + 1}</span>
                            <select
                              value={String(shot.duration)}
                              onChange={(e) => handleUpdateShot(i, "duration", parseInt(e.target.value, 10))}
                              className="h-8 w-24 text-sm rounded-md border border-border bg-muted/30 px-2 outline-none"
                            >
                              {Array.from({ length: 12 }, (_, k) => k + 1).map((d) => (
                                <option key={d} value={String(d)}>{d}s</option>
                              ))}
                            </select>
                            <div className="flex-1" />
                            <button
                              type="button"
                              onClick={() => handleMoveShot(i, -1)}
                              disabled={i === 0}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                              title="Move up"
                            >
                              <ChevronUp className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveShot(i, 1)}
                              disabled={i === shots.length - 1}
                              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                              title="Move down"
                            >
                              <ChevronDown className="w-4 h-4" />
                            </button>
                            {shots.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveShot(i)}
                                className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 transition-colors"
                                title="Delete shot"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          <textarea
                            value={shot.prompt}
                            onChange={(e) => handleUpdateShot(i, "prompt", e.target.value)}
                            placeholder="Describe what happens: camera angle, action, dialogue. e.g. Close-up, she whispers 'I knew you'd come back.' Soft rain falls."
                            rows={4}
                            className="w-full p-3 text-sm min-h-[100px] rounded-lg border border-border bg-muted/30 focus:border-[#ff0073] focus:ring-1 focus:ring-[#ff0073]/20 outline-none resize-none leading-relaxed transition-colors"
                          />
                          <p className="text-[10px] text-muted-foreground/60">
                            Hint: Include dialogue in quotes, add camera directions and mood.
                          </p>
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

                      {/* Add Shot */}
                      <button
                        type="button"
                        onClick={handleAddShot}
                        disabled={shots.length >= 6}
                        className="w-full py-3 rounded-xl border-2 border-dashed border-border hover:border-[#ff0073]/50 hover:bg-[#ff0073]/5 text-sm font-medium text-muted-foreground hover:text-[#ff0073] transition-colors disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground disabled:hover:bg-transparent flex items-center justify-center gap-2"
                      >
                        <Plus className="w-4 h-4" /> Add Shot {shots.length < 6 && `(${shots.length}/6)`}
                      </button>

                      {/* Total Duration */}
                      {totalDuration > 15 && (
                        <p className="text-xs text-red-500 text-center font-medium">
                          Total duration ({totalDuration}s) exceeds 15s limit. Reduce shot durations.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-32 text-muted-foreground/60">
                      <p className="text-sm">Enable Multi-Shot to add individual scene shots.</p>
                    </div>
                  )}
                </div>
              )}

              {/* ═══ ELEMENTS TAB ═══ */}
              {activeTab === "elements" && (
                <div className="flex flex-col gap-4">
                  {elements.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                      <Users className="w-12 h-12 text-muted-foreground/30" />
                      <span className="text-sm font-medium text-foreground">No elements yet</span>
                      <p className="text-xs text-muted-foreground max-w-[300px] text-center">
                        Elements let you create consistent characters and objects across shots. Click below to add your first one.
                      </p>
                    </div>
                  )}

                  {elements.map((el, i) => (
                    <div key={i} className="rounded-xl border-2 border-border hover:border-[#ff0073]/30 bg-gradient-to-b from-card to-card/80 p-5 shadow-lg space-y-4 transition-colors">
                      {/* HEADER ROW */}
                      <div className="flex items-center gap-3">
                        <span className="text-2xl text-[#ff0073] font-black shrink-0">@</span>
                        <input
                          ref={(ref) => { elementNameRefs.current[i] = ref }}
                          type="text"
                          value={el.name}
                          onChange={(e) => handleUpdateElement(i, "name", e.target.value.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""))}
                          placeholder="name your character..."
                          className={`h-9 min-w-[150px] max-w-[200px] px-1 text-base font-semibold bg-transparent border-b-2 font-mono outline-none transition-all ${el.name === "" ? "border-red-500" : "border-[#ff0073]"} focus:border-[#ff0073] focus:shadow-[0_2px_8px_rgba(255,0,115,0.15)]`}
                        />
                        <button
                          type="button"
                          onClick={() => handleUpdateElement(i, "type", el.type === "image" ? "video" : "image")}
                          className={`px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors shrink-0 ${
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
                          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                          title="Delete element"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      {/* DESCRIPTION */}
                      <div>
                        <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">Description</span>
                        <textarea
                          value={el.description}
                          onChange={(e) => handleUpdateElement(i, "description", e.target.value.slice(0, 100))}
                          maxLength={100}
                          placeholder="Describe appearance, clothing, voice tone... e.g. 'Young woman with red hair, green jacket, confident warm voice'"
                          className="w-full min-h-[60px] px-3 py-2 text-sm rounded-xl border-2 border-border bg-background outline-none focus:border-[#ff0073] resize-none leading-relaxed transition-colors"
                        />
                        <span className={`text-[9px] mt-0.5 block text-right ${el.description.length >= 100 ? "text-red-500" : el.description.length > 80 ? "text-yellow-500" : "text-muted-foreground"}`}>
                          {el.description.length}/100
                        </span>
                      </div>

                      {/* REFERENCE IMAGES */}
                      <div>
                        <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 block">{`Reference ${el.type === "video" ? "Videos" : "Images"} (2-4 recommended)`}</span>
                        {el.urls.length > 0 ? (
                          <div className="flex items-center gap-3 flex-wrap">
                            {el.urls.map((url, ui) => (
                              <div key={ui} className="relative group/thumb w-20 h-20 shrink-0">
                                <img src={url} alt={`${el.name} ${ui + 1}`} className="w-20 h-20 rounded-lg object-cover border border-border" />
                                <button
                                  type="button"
                                  aria-label="Remove"
                                  className="absolute -top-1.5 -right-1.5 w-6 h-6 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity shadow-sm"
                                  onClick={() => handleRemoveElementUrl(i, ui)}
                                  title="Remove"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-col items-center justify-center h-[100px] rounded-xl border-2 border-dashed border-[#ff0073]/30 bg-[#ff0073]/5 text-[#ff0073]/40">
                            <ImageIcon className="w-8 h-8 mb-1.5" />
                            <span className="text-xs">Drop media here or use buttons below</span>
                          </div>
                        )}
                      </div>

                      {/* Row 4: Add media buttons */}
                      <div className="flex items-center gap-2.5 relative">
                        <button
                          type="button"
                          className="h-9 px-4 rounded-lg border border-dashed border-border hover:border-[#ff0073]/50 text-xs text-muted-foreground hover:text-[#ff0073] transition-colors flex items-center gap-1.5"
                          onClick={() => alert("Coming soon")}
                        >
                          <ImageIcon className="w-3.5 h-3.5" /> Library
                        </button>
                        <button
                          type="button"
                          className="h-9 px-4 rounded-lg border border-dashed border-border hover:border-[#ff0073]/50 text-xs text-muted-foreground hover:text-[#ff0073] transition-colors disabled:opacity-40 flex items-center gap-1.5"
                          disabled={uploadingIndex === i}
                          onClick={() => fileInputRefs.current[i]?.click()}
                        >
                          {uploadingIndex === i ? (
                            <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Uploading</span>
                          ) : (
                            <><Upload className="w-3.5 h-3.5" /> Upload</>
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
                          className="h-9 px-4 rounded-lg border border-dashed border-border hover:border-[#ff0073]/50 text-xs text-muted-foreground hover:text-[#ff0073] transition-colors flex items-center gap-1.5"
                          onClick={() => setWorkflowDropdownIndex(workflowDropdownIndex === i ? null : i)}
                        >
                          <GitBranch className="w-3.5 h-3.5" /> Workflow
                        </button>

                        {/* From Workflow dropdown */}
                        {workflowDropdownIndex === i && (
                          <div
                            ref={workflowDropdownRef}
                            className="absolute top-full left-0 mt-1 w-64 max-h-52 overflow-y-auto z-50 rounded-xl border border-border bg-card shadow-lg"
                          >
                            {workflowImageNodes.length === 0 ? (
                              <p className="text-[11px] text-muted-foreground p-3 text-center">No image nodes in workflow</p>
                            ) : (
                              workflowImageNodes.map((wfNode) => (
                                <button
                                  key={wfNode.id}
                                  type="button"
                                  className="flex items-center gap-2 w-full px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                                  disabled={!wfNode.thumbUrl}
                                  onClick={() => wfNode.thumbUrl && handleAddFromWorkflow(i, wfNode.thumbUrl)}
                                >
                                  {wfNode.thumbUrl ? (
                                    <img src={wfNode.thumbUrl} alt={wfNode.label} className="w-8 h-8 rounded-lg object-cover border border-border shrink-0" />
                                  ) : (
                                    <div className="w-8 h-8 rounded-lg bg-muted/30 border border-dashed border-muted-foreground/20 flex items-center justify-center shrink-0">
                                      <ImageIcon className="w-3.5 h-3.5 text-muted-foreground/40" />
                                    </div>
                                  )}
                                  <div className="flex flex-col min-w-0">
                                    <span className="text-xs font-medium truncate">{wfNode.label}</span>
                                    <span className="text-[10px] text-muted-foreground">{wfNode.type}</span>
                                  </div>
                                  {!wfNode.thumbUrl && <span className="text-[10px] text-muted-foreground/60 ml-auto">No output</span>}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      </div>

                      {/* VOICE HINT */}
                      {el.type === "image" && (
                        <p className="text-[10px] text-muted-foreground/70 leading-relaxed">
                          Tip: Add voice description like &quot;deep calm male voice&quot; in the description to enable dialogue
                        </p>
                      )}
                    </div>
                  ))}

                  {/* Add Element */}
                  <button
                    type="button"
                    onClick={handleAddElement}
                    disabled={elements.length >= 5}
                    className="w-full py-3 rounded-xl border-2 border-dashed border-border hover:border-[#ff0073]/50 hover:bg-[#ff0073]/5 text-sm font-medium text-muted-foreground hover:text-[#ff0073] transition-colors disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground disabled:hover:bg-transparent flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> Add Element {elements.length < 5 && `(${elements.length}/5)`}
                  </button>

                  {/* Example */}
                  <div className="rounded-xl border border-border bg-gradient-to-br from-[#ff0073]/5 to-transparent p-4">
                    <p className="text-[11px] text-muted-foreground">
                      Example: <span className="font-mono text-foreground">&quot;Close-up of @hero walking through rain, @hero says &apos;I never thought I&apos;d see this place again&apos;&quot;</span>
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* ═══ Bottom Bar ═══ */}
            <div className="px-5 py-4 border-t border-gray-200 dark:border-[#2D2D2D] shrink-0 flex items-center justify-between bg-white dark:bg-[#1E1E1E]">
              <button
                type="button"
                disabled={status === "running"}
                className="flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-medium bg-[#ff0073] hover:bg-[#e00066] disabled:opacity-50 text-white rounded-lg transition-all shadow-md hover:shadow-lg"
                onClick={() => runSingleNode?.(nodeId)}
              >
                {status === "running" ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                ) : (
                  <><Play className="w-4 h-4" /> Run This Node ({credits} CR)</>
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 text-sm font-medium rounded-lg border border-border hover:bg-muted/50 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
