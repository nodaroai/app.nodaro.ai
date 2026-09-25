"use client"

import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { AlertCircle, Film, Image as ImageIcon, Layers, LayoutGrid, Loader2, Plus } from "lucide-react"
import {
  VIDEO_OVERLAY_DEFAULT_BACKGROUND,
  VIDEO_OVERLAY_HANDLE_IDS,
  assembleVideoOverlayRequest,
  expandVideoOverlayLayer,
  validateVideoOverlayRequest,
  videoOverlayCanvas,
  videoOverlayCompositionKey,
  videoOverlaySlotSources,
} from "@nodaro/shared"
import { useT } from "@/lib/i18n"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { useUpstreamVideoProbe } from "@/hooks/use-upstream-video-probe"
import { useVideoOverlayUpstream } from "@/hooks/use-video-overlay-upstream"
import { useVideoOverlayLayers } from "@/hooks/use-video-overlay-layers"
import { useVideoOverlaySelection } from "@/hooks/use-video-overlay-selection"
import { isValidVideoOverlayConnection } from "@/lib/image-producer-handles"
import { FFMPEG_COLORS } from "@/lib/ffmpeg-handles"
import { videoOverlayResultFresh } from "@/lib/video-overlay-composition"
import { videoOverlayIssueText } from "@/lib/video-overlay-i18n"
import { computeDeleteResultUpdates } from "@/lib/utils"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { OVERLAY_MAX_LAYERS, visibleOverlayLayerCount, type VideoOverlayData } from "@/types/nodes"
import { BaseNode } from "./base-node"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { NodeJobProgress } from "./node-job-progress"
import { NodeQuickStrip } from "./node-quick-strip"
import { ResultsThumbnailsPanel } from "./results-thumbnails-panel"
import { VideoResultOverlay } from "./video-result-overlay"
import { videoNodeSizing } from "./video-node-defaults"
import { OVERLAY_BASE_HANDLE_TOP, overlayAddButtonTop, overlayHandleTop } from "./image-overlay-layout"
import { VideoOverlayPreview } from "./video-overlay-preview"

const BASE_TOP = `${OVERLAY_BASE_HANDLE_TOP}px`
const HANDLE_TOP = (i: number) => `${overlayHandleTop(i)}px`

function VideoOverlayNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as VideoOverlayData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const updateNodeInternals = useUpdateNodeInternals()
  const credits = useModelCredits("video-overlay", 20)

  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const layers = useMemo(() => (Array.isArray(nodeData.layers) ? nodeData.layers : []), [nodeData.layers])

  const upstream = useVideoOverlayUpstream(id)
  // Base duration + display size, cached on the node — the one probe mechanism (UX §2.3).
  useUpstreamVideoProbe(id, "video", nodeData.probedVideo, updateNodeData)
  const probed = nodeData.probedVideo && upstream.base && nodeData.probedVideo.url === upstream.base ? nodeData.probedVideo : undefined

  const handleCount = visibleOverlayLayerCount(nodeData.layerCount, Math.min(layers.length, OVERLAY_MAX_LAYERS), upstream.layers.length)
  useEffect(() => { updateNodeInternals(id) }, [handleCount, id, updateNodeInternals])

  const { setLayer, reorder, removeLayer } = useVideoOverlayLayers(id)
  const [selectedLayer, setSelectedLayer] = useVideoOverlaySelection(id)
  const sources = useMemo(() => videoOverlaySlotSources(layers, upstream.layers), [layers, upstream.layers])
  const expanded = useMemo(() => sources.map((_, i) => expandVideoOverlayLayer(layers[i])), [sources, layers])

  // Preview ⇄ Result (UX-8): automatic until the user picks; a composition
  // change resets to automatic, and only a result stamped with the current
  // composition counts as fresh (no size fallback — audit U10).
  const compositionKey = videoOverlayCompositionKey({ baseUrl: upstream.base, sources, data: nodeData })
  const [view, setView] = useState<"preview" | "result" | null>(null)
  const [seenComposition, setSeenComposition] = useState(compositionKey)
  useEffect(() => {
    if (compositionKey === seenComposition) return
    setSeenComposition(compositionKey)
    setView(null)
  }, [compositionKey, seenComposition])
  const hasResult = status !== "running" && !!activeUrl
  const resultFresh = videoOverlayResultFresh(compositionKey, activeResult as { resultCompositionKey?: unknown } | undefined)
  const canPreview = !!upstream.base
  const effectiveView = view ?? (hasResult && resultFresh ? "result" : "preview")
  const showPreview = status !== "running" && canPreview && (effectiveView === "preview" || !hasResult)

  // Sizing (audit U11): the result's aspect → the output aspect → the source's.
  const { aspectRatio: resultAspect, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const outputCanvas = videoOverlayCanvas(null, nodeData.outputAspect)
  const outputAspect = outputCanvas ? outputCanvas.w / outputCanvas.h : undefined
  const sourceAspect = probed?.width && probed.height ? probed.width / probed.height : undefined
  const sizingAspect = showPreview ? (outputAspect ?? sourceAspect) : (resultAspect ?? outputAspect ?? sourceAspect)

  // The strip's Run button: sugar over the real refusal in execute-node (C-4).
  const verdict = validateVideoOverlayRequest(assembleVideoOverlayRequest({ videoUrl: upstream.base ?? "", data: nodeData, wiredImageUrls: upstream.layers }))
  const disabledReason = !upstream.base ? t("node.videoOverlayNoBase") : verdict.ok ? undefined : videoOverlayIssueText(verdict, t)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const canBrowseAlternates = !!activeUrl && results.length > 1
  const thumbResults = useMemo(() => results.map((r) => ({ url: r.thumbnailUrl ?? r.url, jobId: r.jobId })), [results])
  const handleSelectResult = useCallback(
    (i: number) => updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: results[i]!.url }),
    [id, updateNodeData, results],
  )
  const requestDelete = useCallback((i: number) => { const jobId = results[i]?.jobId; if (jobId) setDeleteConfirm(jobId) }, [results])

  const addLayer = useCallback(() => {
    if (handleCount >= OVERLAY_MAX_LAYERS) return
    updateNodeData(id, { layerCount: handleCount + 1 })
  }, [handleCount, id, updateNodeData])

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel label={nodeData.label} icon={<Layers className="w-3.5 h-3.5" />} onSave={(label) => updateNodeData(id, { label })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Layers className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        {...videoNodeSizing(sizingAspect)}
        hideHeader
        topToolbarContent={
          <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} disabled={!!disabledReason} disabledReason={disabledReason} />
        }
        bottomToolbarContent={
          showThumbnails && canBrowseAlternates && !showPreview ? (
            <ResultsThumbnailsPanel results={thumbResults} activeIndex={activeIndex} nodeSelected={!!selected || isSettingsOpen} mediaType="video" onSelect={handleSelectResult} onDelete={requestDelete} />
          ) : undefined
        }
        handles={[
          { id: "video", type: "target", position: Position.Left, customStyle: { top: BASE_TOP, left: "-29px" }, external: true },
          ...VIDEO_OVERLAY_HANDLE_IDS.slice(0, handleCount).map((h, i) => ({
            id: h,
            type: "target" as const,
            position: Position.Left,
            customStyle: { top: HANDLE_TOP(i), left: "-29px" },
            external: true,
          })),
          { id: "video-out", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
        ]}
      >
        <div className="relative w-full h-full group/overlay flex flex-col">
          <div className="relative flex-1 min-h-0">
            {status === "running" && (
              <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[120px]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress} />
              </div>
            )}

            {status !== "running" && !canPreview && !hasResult && status !== "failed" && (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40 h-full min-h-[160px] px-3 text-center">
                <Layers className="w-10 h-10" />
                <span className="text-[10px] leading-tight">{t("node.videoOverlayConnect")}</span>
              </div>
            )}

            {status === "failed" && !hasResult && !canPreview && (
              <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-red-500/5 text-red-500 h-[160px] p-2">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">{t("node.failed")}</span>
                </div>
                {nodeData.errorMessage && (
                  <p className="text-[10px] text-center text-red-400 line-clamp-2" title={nodeData.errorMessage}>{nodeData.errorMessage}</p>
                )}
              </div>
            )}

            {showPreview && upstream.base && (
              <VideoOverlayPreview
                baseUrl={upstream.base}
                sources={sources}
                layers={expanded}
                outputAspect={nodeData.outputAspect}
                baseFit={nodeData.baseFit ?? "cover"}
                backgroundColor={nodeData.backgroundColor ?? VIDEO_OVERLAY_DEFAULT_BACKGROUND}
                fallbackDisplay={probed?.width && probed.height ? { width: probed.width, height: probed.height } : undefined}
                selected={selectedLayer}
                onSelect={setSelectedLayer}
                onLayerChange={setLayer}
                onReorder={(i, direction) => reorder(i, direction, handleCount)}
                onRemove={(i) => { removeLayer(i); setSelectedLayer(null) }}
              />
            )}

            {showPreview && status === "failed" && nodeData.errorMessage && (
              <div className="pointer-events-none absolute top-2 left-2 right-24 z-20 px-2 py-1 rounded-md bg-red-600/80 text-white text-[10px] leading-snug line-clamp-2" title={nodeData.errorMessage}>
                {nodeData.errorMessage}
              </div>
            )}

            {showPreview && !hasResult && (
              <div className="pointer-events-none absolute bottom-2 right-2 z-20 max-w-[60%] px-2 py-1 rounded-md bg-black/55 backdrop-blur-sm border border-white/10 text-white/90 text-[10px] leading-snug">
                {t("node.videoOverlayRunHint")}
              </div>
            )}

            {status !== "running" && canPreview && hasResult && (
              <div className="nodrag nopan absolute top-2 right-2 z-30 flex rounded-md overflow-hidden border border-white/10 bg-black/50 backdrop-blur-sm text-[10px] font-medium">
                <button type="button" aria-pressed={showPreview} className={`px-2 py-1 ${showPreview ? "bg-[#ff0073] text-white" : "text-white/80 hover:bg-white/10"}`} onClick={(e) => { e.stopPropagation(); setView("preview") }}>
                  {t("node.overlayPreview")}
                </button>
                <button type="button" aria-pressed={!showPreview} className={`px-2 py-1 ${!showPreview ? "bg-[#ff0073] text-white" : "text-white/80 hover:bg-white/10"}`} onClick={(e) => { e.stopPropagation(); setView("result") }}>
                  {resultFresh ? t("node.overlayResult") : t("node.overlayResultOld")}
                </button>
              </div>
            )}

            {hasResult && activeUrl && !showPreview && (
              <>
                <VideoResultOverlay
                  url={activeUrl}
                  onEdit={() => openFreeCut(id, activeUrl, activeResult?.freecutProjectUrl)}
                  videoAutoplay={videoAutoplay}
                  label={nodeData.label}
                  hasResults={results.length > 0}
                  onExpand={() => setPreviewOpen(true)}
                  onDelete={() => { if (activeResult?.jobId) setDeleteConfirm(activeResult.jobId) }}
                  onRawDimensions={onLoadDimensions}
                  onSettings={() => selectNode(isSettingsOpen ? null : id)}
                  isSettingsOpen={isSettingsOpen}
                />
                {canBrowseAlternates && (
                  <button
                    type="button"
                    className={`absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 backdrop-blur-sm border rounded-md z-20 transition-opacity ${
                      showThumbnails ? "bg-[#ff0073] hover:bg-[#ff0073]/90 border-[#ff0073] text-white opacity-100" : "bg-black/40 hover:bg-black/60 border-white/10 text-white opacity-0 group-hover/overlay:opacity-100"
                    }`}
                    onClick={(e) => { e.stopPropagation(); setShowThumbnails((v) => !v) }}
                    title={showThumbnails ? t("node.hideVersions") : t("node.showVersions")}
                    aria-pressed={showThumbnails}
                  >
                    <LayoutGrid className="w-3 h-3" />
                    <span className="text-[11px] font-medium">{results.length}</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </BaseNode>

      <HandleWithPopover nodeId={id} nodeType="video-overlay" handleId="video" type="target" position={Position.Left} label="Video" color={FFMPEG_COLORS.video} icon={<Film />} side="left" top={BASE_TOP} accepts={(s) => isValidVideoOverlayConnection("video", s)} />
      {VIDEO_OVERLAY_HANDLE_IDS.slice(0, handleCount).map((h, i) => (
        <HandleWithPopover
          key={h}
          nodeId={id}
          nodeType="video-overlay"
          handleId={h}
          type="target"
          position={Position.Left}
          label={`Layer ${i + 1}`}
          color={HANDLE_COLORS.image}
          icon={<ImageIcon />}
          side="left"
          top={HANDLE_TOP(i)}
          accepts={(s) => isValidVideoOverlayConnection(h, s)}
        />
      ))}
      {handleCount < OVERLAY_MAX_LAYERS && (
        <button
          type="button"
          className="nodrag nopan absolute -left-[29px] w-5 h-5 flex items-center justify-center rounded-full border border-dashed border-muted-foreground/50 text-muted-foreground/70 hover:text-[#ff0073] hover:border-[#ff0073] bg-background/80"
          style={{ top: `${overlayAddButtonTop(handleCount)}px`, transform: "translateY(2px)" }}
          title={t("node.overlayAddLayer")}
          aria-label={t("node.overlayAddLayer")}
          onClick={(e) => { e.stopPropagation(); addLayer() }}
        >
          <Plus className="w-3 h-3" />
        </button>
      )}
      <HandleWithPopover nodeId={id} nodeType="video-overlay" handleId="video-out" type="source" position={Position.Right} label="Video" color={FFMPEG_COLORS.video} icon={<Film />} side="right" top="24px" />

      {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="video" url={activeUrl} results={results} initialIndex={activeIndex} />}
      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          // Resolve the stored jobId to its CURRENT index — a poll may have prepended a result meanwhile.
          const i = results.findIndex((r) => r.jobId === deleteConfirm)
          if (i >= 0) updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, i, "generatedVideoUrl"))
          setDeleteConfirm(null)
        }}
      />
    </div>
  )
}

export const VideoOverlayNode = memo(VideoOverlayNodeComponent)
