"use client"

import { memo, useState, useMemo, useEffect, Suspense } from "react"
import { lazyWithRetry as lazy } from "@/lib/lazy-with-retry"
import { Position, type NodeProps } from "@xyflow/react"
import { Clapperboard, Loader2, AlertCircle, X, Image as ImageIcon, Volume2, Maximize2, Download, Settings, LayoutGrid, Expand, Users, Link, Scissors } from "lucide-react"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { copyToClipboard } from "@/lib/utils"
const Kling3DirectorModal = lazy(() => import("@/components/editor/kling3-director-modal").then(m => ({ default: m.Kling3DirectorModal })))
import { useModelCredits } from "@/hooks/use-model-credits"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { EditableNodeLabel } from "./editable-node-label"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { ImageToVideoData, GeneratedResult } from "@/types/nodes"

// Fallback credit costs per video provider (shown until API responds)
const VIDEO_PROVIDER_FALLBACKS: Record<string, number> = {
  minimax: 18, veo3: 79, "veo3.1": 19, kling: 28, "kling-turbo": 14,
  "kling-3.0": 63, "grok-i2v": 7, "sora2-pro": 38, seedance: 7,
  "wan-i2v": 22, "wan-turbo": 13, "hailuo-2.3-pro": 20, "hailuo-2.3": 10,
  "hailuo-standard": 10, sora2: 10, "bytedance-lite": 6, "bytedance-pro": 18,
  "bytedance-pro-fast": 9, "kling-master": 50, "runway-kie": 4,
}

// Providers that support End Frame (second image for video ending)
const END_FRAME_SUPPORTED_PROVIDERS = [
  "veo3", "veo3.1",
  "minimax",
  "kling-turbo",
  "kling-3.0",
  "runway", "pika",
]

// Node types that output images
const IMAGE_OUTPUT_TYPES = new Set([
  "generate-image", "upload-image", "scene",
  "character", "object", "location",
  "edit-image", "image-to-image",
])

// Node types that output audio
const AUDIO_OUTPUT_TYPES = new Set([
  "text-to-speech", "generate-music", "text-to-audio",
  "suno-generate", "suno-cover",
  "upload-audio", "reference-audio", "trim-audio",
  "adjust-volume", "mix-audio",
])

function getNodeThumbnail(srcData: Record<string, unknown>, nodeType: string, edgeOutputMode?: string): string | undefined {
  if (!IMAGE_OUTPUT_TYPES.has(nodeType)) return undefined

  const results = (srcData.generatedResults as readonly GeneratedResult[] | undefined) ?? []
  let activeIdx = (srcData.activeResultIndex as number | undefined) ?? 0
  // Edge output mode overrides which result to show
  if (edgeOutputMode?.startsWith("item:")) {
    activeIdx = parseInt(edgeOutputMode.split(":")[1], 10)
  } else if (edgeOutputMode === "last" && results.length > 0) {
    activeIdx = results.length - 1
  }
  return (
    results[activeIdx]?.url ??
    (srcData.generatedImageUrl as string | undefined) ??
    (srcData.url as string | undefined) ??
    (srcData.portraitUrl as string | undefined) ??
    (srcData.mainImageUrl as string | undefined) ??
    (srcData.sourceImageUrl as string | undefined)
  )
}

function ImageToVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageToVideoData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const edges = useWorkflowStore((s) => s.edges)
  const nodes = useWorkflowStore((s) => s.nodes)
  const startFrameConnectionCount = edges.filter(e => e.target === id && e.targetHandle === "startFrame").length
  const videoTop = 20

  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const activeThumbnail = activeResult?.thumbnailUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [directorOpen, setDirectorOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null)
  const provider = nodeData.provider ?? "minimax"
  const credits = useModelCredits(provider, VIDEO_PROVIDER_FALLBACKS[provider] ?? 25)
  const useFull = useFullResolution(id)
  const [mediaAspectRatio, setMediaAspectRatio] = useState<number | undefined>()
  useEffect(() => {
    const url = activeThumbnail || activeUrl
    if (!url) { setMediaAspectRatio(undefined); return }
    if (activeThumbnail) {
      let cancelled = false
      const img = new window.Image()
      const setRatio = () => { if (!cancelled && img.naturalWidth > 0) setMediaAspectRatio(img.naturalWidth / img.naturalHeight) }
      img.onload = setRatio
      img.src = activeThumbnail
      if (img.complete) setRatio()
      return () => { cancelled = true }
    }
  }, [activeThumbnail, activeUrl])
  const listTotal = (nodeData as Record<string, unknown>).__listTotal as number | undefined
  const listCompleted = (nodeData as Record<string, unknown>).__listCompleted as number | undefined
  const isNodeRunning = nodeData.executionStatus === "running"
  const listProgressPercent = (listTotal && listTotal > 0 && listCompleted !== undefined)
    ? Math.round((listCompleted / listTotal) * 100)
    : undefined

  const supportsEndFrame = END_FRAME_SUPPORTED_PROVIDERS.includes(nodeData.provider)
  const isKling3 = nodeData.provider === "kling-3.0"
  const isKling3MultiShot = isKling3 && nodeData.multiShot
  const showEndFrame = supportsEndFrame && !isKling3MultiShot
  const isSora = provider === "sora2" || provider === "sora2-pro"
  const charactersConnectionCount = edges.filter(e => e.target === id && e.targetHandle === "characters").length

  const resultHeight = videoDimensions?.height ?? 445
  const startFrameTop = 445 * 0.157
  const endFrameTop = 445 * 0.36
  const audioTop = 445 * 0.53
  const charactersTop = 445 * 0.70

  useEffect(() => { if (activeUrl) setShowConfig(false) }, [activeUrl])
  useEffect(() => { setVideoDimensions(null) }, [activeUrl])

  // Resolve connected nodes per handle
  const startFrameInfo = useMemo(() => {
    const edge = edges.find((e) => e.target === id && e.targetHandle === "startFrame")
    if (!edge) return null
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) return null
    const srcData = srcNode.data as Record<string, unknown>
    const edgeMode = (edge.data as Record<string, unknown> | undefined)?.outputMode as string | undefined
    return {
      id: srcNode.id,
      label: (srcData.label as string | undefined) ?? String(srcNode.type ?? "Image"),
      thumbnailUrl: getNodeThumbnail(srcData, String(srcNode.type ?? ""), edgeMode),
    }
  }, [edges, nodes, id])

  const endFrameInfo = useMemo(() => {
    const edge = edges.find((e) => e.target === id && e.targetHandle === "endFrame")
    if (!edge) return null
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) return null
    const srcData = srcNode.data as Record<string, unknown>
    const edgeMode = (edge.data as Record<string, unknown> | undefined)?.outputMode as string | undefined
    return {
      id: srcNode.id,
      label: (srcData.label as string | undefined) ?? String(srcNode.type ?? "Image"),
      thumbnailUrl: getNodeThumbnail(srcData, String(srcNode.type ?? ""), edgeMode),
    }
  }, [edges, nodes, id])

  const audioInfo = useMemo(() => {
    const edge = edges.find((e) => e.target === id && e.targetHandle === "audio")
    if (!edge) return null
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) return null
    const srcData = srcNode.data as Record<string, unknown>
    return {
      id: srcNode.id,
      label: (srcData.label as string | undefined) ?? String(srcNode.type ?? "Audio"),
    }
  }, [edges, nodes, id])

  // Get connected text-prompt content (for Motion Prompt visual indicator)
  const connectedTextPrompt = useMemo(() => {
    const connectedEdges = edges.filter((e) => e.target === id)
    for (const edge of connectedEdges) {
      const srcNode = nodes.find((n) => n.id === edge.source)
      if (srcNode?.type === "text-prompt") {
        const srcData = srcNode.data as Record<string, unknown>
        const text = srcData.text as string | undefined
        if (text?.trim()) {
          return {
            text: text.trim(),
            nodeLabel: (srcData.label as string | undefined) ?? "Text Prompt",
          }
        }
      }
    }
    return null
  }, [edges, nodes, id])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  // Build dynamic handles
  const handles = useMemo(() => [
    { id: "startFrame", type: "target" as const, position: Position.Left, customStyle: { top: `${startFrameTop}px`, left: '-29px' }, hideHandle: true },
    ...(showEndFrame ? [{ id: "endFrame", type: "target" as const, position: Position.Left, customStyle: { top: `${endFrameTop}px`, left: '-29px' }, hideHandle: true }] : []),
    { id: "audio", type: "target" as const, position: Position.Left, customStyle: { top: `${audioTop}px`, left: '-29px' }, hideHandle: true },
    ...(isSora ? [{ id: "characters", type: "target" as const, position: Position.Left, customStyle: { top: `${charactersTop}px`, left: '-29px' }, hideHandle: true }] : []),
    { id: "video", type: "source" as const, position: Position.Right, customStyle: { top: `${videoTop}px`, right: '-29px' }, hideHandle: true },
  ], [startFrameTop, endFrameTop, audioTop, charactersTop, videoTop, activeUrl, showConfig, showEndFrame, isSora])

  const hasAnyConnection = startFrameInfo || endFrameInfo || audioInfo || (isSora && charactersConnectionCount > 0)

  return (
    <div className="relative group/node" style={{ width: (activeUrl && !showConfig) ? (videoDimensions?.width ?? 245) : 245, height: (activeUrl && !showConfig) ? (videoDimensions?.height ?? 445) : 445, minHeight: 200, overflow: 'visible', position: 'relative' }}>
    <EditableNodeLabel
      label={isKling3 ? "Kling 3.0 Studio" : nodeData.label}
      icon={<Clapperboard className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={isKling3 ? "Kling 3.0 Studio" : nodeData.label}
      icon={<Clapperboard className="h-4 w-4" />}
      category="i2v"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      className={activeUrl && !showConfig ? "!border-0 !shadow-none !bg-transparent" : undefined}
      listCount={listTotal}
      listProgress={isNodeRunning && listTotal ? `${listCompleted ?? 0}/${listTotal}` : undefined}
      listProgressPercent={isNodeRunning ? listProgressPercent : undefined}
      hideHeader
      imageAspectRatio={mediaAspectRatio}
      bottomToolbarContent={
        showThumbnails && results.length > 1 ? (
          <div className="flex gap-2 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
            {results.slice(0, 8).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative shrink-0">
                {r.thumbnailUrl ? (
                  <CachedImage
                    src={r.thumbnailUrl}
                    alt={`Result ${i + 1}`}
                    className={`w-16 h-16 object-cover rounded-lg cursor-pointer transition-all ${
                      i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                    }}
                  />
                ) : (
                  <video
                    src={r.url}
                    className={`w-16 h-16 object-cover rounded-lg cursor-pointer transition-all ${
                      i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                    }}
                    muted
                    playsInline
                  />
                )}
              </div>
            ))}
          </div>
        ) : undefined
      }
      topToolbarContent={
                  <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
      }
      handles={handles}
    >
      {activeUrl && !showConfig && !isKling3 ? (
      <div className="relative w-full h-full group/video">
        {activeThumbnail ? (
          <CachedImage src={activeThumbnail} alt="Video preview"
            className="w-full h-full object-cover rounded-xl"
            thumbnail={!useFull} thumbnailWidth={320} />
        ) : (
          <video src={activeUrl} autoPlay={videoAutoplay} loop={videoAutoplay} muted playsInline
            className="w-full h-full object-cover rounded-xl"
            onLoadedMetadata={(e) => {
              const video = e.currentTarget
              const ratio = video.videoWidth / video.videoHeight
              const baseWidth = 490
              const baseHeight = Math.round(baseWidth / ratio)
              setVideoDimensions({ width: baseWidth, height: Math.max(180, Math.min(600, baseHeight)) })
            }} />
        )}
        {/* Version badge */}
        {results.length > 1 && (
          <button type="button"
            className="absolute top-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md opacity-0 group-hover/video:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}>
            <LayoutGrid className="w-3 h-3" />
            <span>{results.length}</span>
          </button>
        )}
        {/* Top-right: delete */}
        {results.length > 0 && (
          <div className="absolute top-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
            <button type="button" aria-label="Remove result"
              className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }} title="Delete this result">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {/* Bottom-left: fullscreen + download + copy URL */}
        <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
          <button type="button" aria-label="Expand preview"
            className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }} title="Fullscreen">
            <Expand className="w-3.5 h-3.5" />
          </button>
          <button type="button" aria-label="Download"
            className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`; a.download = `${nodeData.label || 'video'}.mp4`; a.click() }} title="Download">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button type="button" aria-label="Copy URL"
            className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => { e.stopPropagation(); copyToClipboard(activeUrl!, "URL copied") }} title="Copy URL">
            <Link className="w-3.5 h-3.5" />
          </button>
          <button type="button" aria-label="Edit in FreeCut"
            className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
            onClick={(e) => { e.stopPropagation(); openFreeCut(id, activeUrl!) }} title="Edit in FreeCut">
            <Scissors className="w-3.5 h-3.5" />
          </button>
        </div>
        {/* Bottom-right: settings */}
        <div className="absolute bottom-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
          <button type="button" aria-label="Settings" className={`w-7 h-7 flex items-center justify-center bg-black/50 hover:bg-black/70 border border-white/10 text-white rounded-full shadow-sm${isSettingsOpen ? " ring-1 ring-white/30" : ""}`}
            onClick={(e) => { e.stopPropagation(); selectNode(isSettingsOpen ? null : id) }} title="Settings">
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      ) : (
      <div
        className="flex flex-col gap-2 h-full"
        onDoubleClick={isKling3 ? (e) => { e.stopPropagation(); setDirectorOpen(true) } : undefined}
      >
        {isKling3 ? (
          <>
            {/* Badges Row */}
            <div className="flex flex-wrap gap-1 items-center">
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 font-medium">
                {(nodeData as Record<string, unknown>).kling3Mode === "std" ? "Std" : "Pro"}
              </span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 font-medium">
                {nodeData.aspectRatio ?? "16:9"}
              </span>
              {(nodeData as Record<string, unknown>).kling3Sound !== false && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">
                  Sound
                </span>
              )}
              {nodeData.multiShot && nodeData.shots && nodeData.shots.length > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-medium">
                  {nodeData.shots.length} shots
                </span>
              )}
              {nodeData.elements && nodeData.elements.length > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 font-medium">
                  {nodeData.elements.length} elem
                </span>
              )}
              <button
                type="button"
                className="ml-auto p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-[#ff0073] transition-colors"
                onClick={(e) => { e.stopPropagation(); setDirectorOpen(true) }}
                title="Open Director"
              >
                <Maximize2 className="w-3 h-3" />
              </button>
            </div>

            {/* Master Prompt Preview */}
            {(nodeData.prompt || connectedTextPrompt) && (
              <div className="text-[10px] text-muted-foreground line-clamp-2 px-1" style={{ wordBreak: "break-word" }}>
                {nodeData.prompt || connectedTextPrompt?.text}
              </div>
            )}

            {/* Shots Summary */}
            {nodeData.multiShot && nodeData.shots && nodeData.shots.length > 0 && (
              <div className="flex flex-col gap-1 px-1">
                <span className="text-[9px] text-muted-foreground/60 font-medium uppercase tracking-wider">Shots</span>
                <div className="flex flex-wrap gap-1">
                  {nodeData.shots.slice(0, 4).map((shot, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground truncate max-w-[100px]">
                      {i + 1}. {shot.prompt ? (shot.prompt.length > 20 ? shot.prompt.slice(0, 20) + "..." : shot.prompt) : `${shot.duration}s`}
                    </span>
                  ))}
                  {nodeData.shots.length > 4 && (
                    <span className="text-[9px] px-1.5 py-0.5 text-muted-foreground/60">
                      +{nodeData.shots.length - 4} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Elements Summary */}
            {nodeData.elements && nodeData.elements.length > 0 && (
              <div className="flex flex-col gap-1 px-1">
                <span className="text-[9px] text-muted-foreground/60 font-medium uppercase tracking-wider">Elements</span>
                <div className="flex flex-wrap gap-1">
                  {nodeData.elements.map((el, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground flex items-center gap-1">
                      {el.type === "video" ? "\uD83C\uDFAC" : "\uD83D\uDDBC"} @{el.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Compact Start Frame */}
            {startFrameInfo?.thumbnailUrl && (
              <div className="relative h-[40px] rounded-md overflow-hidden bg-muted/30 border border-muted">
                <img
                  src={startFrameInfo.thumbnailUrl}
                  alt={startFrameInfo.label}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-0.5 left-0.5 text-[8px] bg-black/60 text-white px-1 rounded">
                  Start
                </span>
              </div>
            )}

            {/* Audio indicator (compact) */}
            {audioInfo && (
              <div className="flex items-center gap-1.5 px-1">
                <Volume2 className="w-3 h-3 text-green-500" />
                <span className="text-[9px] text-muted-foreground truncate">{audioInfo.label}</span>
              </div>
            )}
          </>
        ) : (
          <>
        {/* Toggle button - only show when activeUrl exists */}
        {activeUrl && (
          <div className="flex justify-end px-3 pt-2 opacity-0 group-hover/node:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowConfig(v => !v) }}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-white/60 hover:text-white text-[10px] transition-colors"
            >
              {showConfig ? <Clapperboard className="w-3 h-3" /> : <Settings className="w-3 h-3" />}
              {showConfig ? "Result" : "Edit"}
            </button>
          </div>
        )}

        {/* Config view */}
        {(!activeUrl || showConfig) && (
          <>
        {/* Frame Previews */}
        <div className="flex flex-col gap-2">
          {/* Start Frame */}
          <div className="flex flex-col items-center gap-1 px-3 mt-2">
            <span className="text-[10px] text-muted-foreground/60">Start Frame</span>
            {startFrameInfo?.thumbnailUrl ? (
              <div className="w-full h-[70px] rounded-md overflow-hidden bg-muted/30 border border-muted/50">
                <CachedImage src={startFrameInfo.thumbnailUrl} alt={startFrameInfo.label}
                  className="w-full h-full object-cover" thumbnail={!useFull} thumbnailWidth={320} />
              </div>
            ) : (
              <div className="w-full h-[70px] rounded-md border border-dashed border-muted-foreground/20 flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-muted-foreground/20" />
              </div>
            )}
          </div>

          {/* End Frame */}
          {showEndFrame && (
          <div className="flex flex-col items-center gap-1 px-3">
            <span className="text-[10px] text-muted-foreground/60">End Frame</span>
            {endFrameInfo?.thumbnailUrl ? (
              <div className="w-full h-[70px] rounded-md overflow-hidden bg-muted/30 border border-muted/50">
                <CachedImage src={endFrameInfo.thumbnailUrl} alt={endFrameInfo.label}
                  className="w-full h-full object-cover" thumbnail={!useFull} thumbnailWidth={320} />
              </div>
            ) : (
              <div className="w-full h-[70px] rounded-md border border-dashed border-muted-foreground/20 flex items-center justify-center">
                <ImageIcon className="w-5 h-5 text-muted-foreground/20" />
              </div>
            )}
          </div>
          )}

          {/* Audio */}
          <div className="flex flex-col items-center gap-1 px-3">
            <span className="text-[10px] text-muted-foreground/60">Audio</span>
            {audioInfo ? (
              <div className="w-full h-[28px] rounded-md bg-muted/30 border border-muted/50 flex items-center px-2">
                <Volume2 className="w-3 h-3 text-green-500 shrink-0 mr-1.5" />
                <span className="text-[10px] text-muted-foreground truncate">{audioInfo.label}</span>
              </div>
            ) : (
              <div className="w-full h-[28px] rounded-md border border-dashed border-muted-foreground/20 flex items-center justify-center gap-1.5">
                <Volume2 className="w-3 h-3 text-muted-foreground/20" />
                <span className="text-[10px] text-muted-foreground/20">Connect audio</span>
              </div>
            )}
          </div>
        </div>

        {/* Empty state when nothing connected */}
        {!hasAnyConnection && status !== "running" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-1 py-4 text-muted-foreground/60">
            <Clapperboard className="w-8 h-8" />
            <span className="text-[10px]">Connect image/audio nodes</span>
          </div>
        )}
          </>
        )}
          </>
        )}

        {/* Video Preview / Loading / Error States */}
        {status === "running" && (
          <div className="flex flex-col items-center justify-center h-28 rounded-md bg-muted/30 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          </div>
        )}

        {status !== "running" && activeUrl && (isKling3 || !showConfig) && (
          <div className="w-full h-full rounded-xl overflow-hidden" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
            <div className="relative group/video w-full h-full">
              {/* Version badge */}
              {results.length > 1 && (
                <button type="button"
                  className="absolute top-2 left-2 z-10 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md opacity-0 group-hover/video:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}>
                  <LayoutGrid className="w-3 h-3" />
                  <span>{results.length}</span>
                </button>
              )}

              {activeThumbnail ? (
                <CachedImage src={activeThumbnail} alt="Video preview"
                  className="w-full h-full object-cover"
                  thumbnail={!useFull} thumbnailWidth={320}
                />
              ) : (
                <video src={activeUrl}
                  className="w-full h-full object-cover"
                  autoPlay={videoAutoplay} muted loop={videoAutoplay} playsInline
                  onLoadedMetadata={(e) => {
                    const v = e.currentTarget
                    if (v.videoWidth > 0) setMediaAspectRatio(v.videoWidth / v.videoHeight)
                  }}
                />
              )}

              {/* Top-right: delete */}
              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
                {results.length > 0 && (
                  <button type="button"
                    aria-label="Remove result"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Bottom-left: fullscreen + download + copy URL */}
              <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <button type="button"
                  aria-label="Expand preview"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}>
                  <Expand className="w-3.5 h-3.5" />
                </button>
                <button type="button"
                  aria-label="Download"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`; a.download = `${nodeData.label || 'video'}.mp4`; a.click() }}>
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button type="button"
                  aria-label="Copy URL"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(activeUrl!, "URL copied") }}
                  title="Copy URL">
                  <Link className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Bottom-right: settings */}
              <div className="absolute bottom-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <button type="button" aria-label="Settings" className={`w-7 h-7 flex items-center justify-center bg-black/50 hover:bg-black/70 border border-white/10 text-white rounded-full shadow-sm${isSettingsOpen ? " ring-1 ring-white/30" : ""}`}
                  onClick={(e) => { e.stopPropagation(); selectNode(isSettingsOpen ? null : id) }} title="Settings">
                  <Settings className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {status === "failed" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-1 h-28 rounded-md bg-red-500/5 text-red-500 p-2">
            <div className="flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="font-medium">Failed</span>
            </div>
            {nodeData.errorMessage && (
              <p className="text-[10px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>
                {nodeData.errorMessage}
              </p>
            )}
          </div>
        )}

        {status !== "running" && !activeUrl && status !== "failed" && startFrameInfo && (
          <div className="flex flex-col items-center gap-1 px-3">
            <span className="text-[10px] text-muted-foreground/60">Video</span>
            <div className="w-full h-[70px] rounded-md border border-dashed border-muted-foreground/20 flex items-center justify-center">
              <Clapperboard className="w-5 h-5 text-muted-foreground/20" />
            </div>
          </div>
        )}

        {/* Provider & Duration Info */}
        <div className="flex justify-between text-[10px] text-muted-foreground px-2">
          <span className="pl-2">{nodeData.provider}</span>
          <span className="pr-2">
            {isKling3 && nodeData.multiShot && nodeData.shots
              ? `${nodeData.shots.reduce((sum, s) => sum + s.duration, 0)}s total`
              : `${nodeData.duration ?? 5}s`}
          </span>
        </div>
      </div>
      )}
    </BaseNode>


    {/* startFrame handle icon */}
    <div className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: `${startFrameTop - 14}px`, left: '-29px' }}>
      <ImageIcon className="w-3.5 h-3.5 text-white" />
      <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#ff0073] text-[#ff0073] text-[8px] font-black flex items-center justify-center pointer-events-none">+</div>
      {startFrameConnectionCount >= 2 && (
        <div className="absolute top-1/2 -translate-y-1/2 -right-[9px] w-[13px] h-[13px] rounded-full bg-white text-[#ff0073] text-[8px] font-black flex items-center justify-center pointer-events-none">{startFrameConnectionCount}</div>
      )}
    </div>

    {/* endFrame handle icon */}
    {showEndFrame && (
    <div className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: `${endFrameTop - 14}px`, left: '-29px' }}>
      <ImageIcon className="w-3.5 h-3.5 text-white" />
    </div>
    )}

    {/* audio handle icon */}
    <div className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: `${audioTop - 14}px`, left: '-29px' }}>
      <Volume2 className="w-3.5 h-3.5 text-white" />
    </div>

    {/* characters handle icon (Sora only) */}
    {isSora && (
      <div className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
        style={{ top: `${charactersTop - 14}px`, left: '-29px' }}>
        <Users className="w-3.5 h-3.5 text-white" />
        <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#ff0073] text-[#ff0073] text-[8px] font-black flex items-center justify-center pointer-events-none">+</div>
        {charactersConnectionCount >= 1 && (
          <div className="absolute top-1/2 -translate-y-1/2 -right-[9px] w-[13px] h-[13px] rounded-full bg-white text-[#ff0073] text-[8px] font-black flex items-center justify-center pointer-events-none">{charactersConnectionCount}</div>
        )}
      </div>
    )}

    {/* video output handle icon */}
    <div className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: `${videoTop - 14}px`, right: '-29px' }}>
      <Clapperboard className="w-3.5 h-3.5 text-white" />
    </div>

    {/* Preview Modal */}
    {activeUrl && (
      <MediaPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        type="video"
        url={activeUrl}
      />
    )}

    {/* Delete Confirmation */}
    <DeleteConfirmationDialog
      isOpen={deleteConfirm !== null}
      onClose={() => setDeleteConfirm(null)}
      onConfirm={() => {
        if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
      }}
    />

    {/* Kling 3.0 Director Modal */}
    {directorOpen && (
      <Suspense fallback={null}>
        <Kling3DirectorModal
          isOpen={directorOpen}
          onClose={() => setDirectorOpen(false)}
          nodeId={id}
        />
      </Suspense>
    )}
    </div>
  )
}

export const ImageToVideoNode = memo(ImageToVideoNodeComponent)
