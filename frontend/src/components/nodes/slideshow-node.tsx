"use client"

import { useT } from "@/lib/i18n"
import { memo, useState, useEffect, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { GalleryHorizontalEnd, Loader2, AlertCircle, X, Images as ImagesIcon, Volume2, Film, ArrowLeftRight, RotateCcw } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { isValidSlideshowConnection } from "@/lib/video-producer-handles"
import { incomingSourcesFingerprint } from "@/lib/node-fingerprint"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { extractNodeOutputAsList } from "@/components/editor/workflow-editor/node-input-resolver"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useProbedAudioDuration, formatClipLength } from "@/hooks/use-probed-audio-duration"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { VideoResultOverlay } from "./video-result-overlay"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { computeDeleteResultUpdates } from "@/lib/utils"
import { FAN_OUT_EACH_TYPES, getParameterValue } from "@nodaro/shared"
import type { SlideshowData } from "@/types/nodes"

const ASPECT_TO_NUMBER: Record<SlideshowData["aspectRatio"], number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:3": 4 / 3,
}

const ACCEPTS_IMAGES = (t: string) => isValidSlideshowConnection("images", t)
const ACCEPTS_AUDIO = (t: string) => isValidSlideshowConnection("audio", t)
const ACCEPTS_TRANSITION = (t: string) => isValidSlideshowConnection("transition", t)

const MAX_IMAGES = 100

function SlideshowNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as SlideshowData
  // Zero credits by design (local FFmpeg, no provider) — static 0, no ee
  // pricing hook (check-ee-imports; matches still-to-video).
  const credits = 0
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const { aspectRatio: mediaAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoError, setVideoError] = useState(false)

  useEffect(() => {
    setVideoError(false)
  }, [activeUrl])

  // Upstream: ordered slide images (a list contributes its whole image
  // column; direct edges contribute one each — wire order), optional audio,
  // optional transition pick.
  const connectedFingerprint = useWorkflowStore((s) =>
    incomingSourcesFingerprint(s.nodes, s.edges, id),
  )
  const { slideUrls, upstreamAudioUrl, hasAudioEdge, transitionPick } = useMemo(() => {
    const { nodes, edges } = useWorkflowStore.getState()
    const urls: string[] = []
    let audioUrl: string | undefined
    let audioEdge = false
    let transition: string | undefined
    for (const edge of edges) {
      if (edge.target !== id) continue
      const src = nodes.find((n) => n.id === edge.source)
      if (!src) continue
      if (edge.targetHandle === "audio") {
        audioEdge = true
        if (!audioUrl) audioUrl = extractNodeOutput(src, edge.sourceHandle ?? undefined)
        continue
      }
      if (edge.targetHandle === "transition" || src.type === "transition") {
        // Parameter nodes carry their pick on data, not as an extracted output.
        if (!transition) transition = getParameterValue(src.data as Record<string, unknown>, "transition")
        continue
      }
      if (FAN_OUT_EACH_TYPES.has(src.type ?? "")) {
        const items = extractNodeOutputAsList(src) ?? []
        for (const item of items) if (item) urls.push(item)
      } else {
        const single = extractNodeOutput(src, edge.sourceHandle ?? undefined)
        if (single) urls.push(single)
      }
    }
    return { slideUrls: urls, upstreamAudioUrl: audioUrl, hasAudioEdge: audioEdge, transitionPick: transition }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedFingerprint, id])

  const n = slideUrls.length
  const fps = nodeData.fps ?? 30
  const audioDuration = useProbedAudioDuration(upstreamAudioUrl)

  // The timeline: slide widths ARE their durations. Canvas has no per-row
  // overrides today, so the strip shows the equal split (audio-driven) or
  // perImageDuration (silent). The worker's plan is the same math.
  const perSlideSeconds =
    audioDuration && n > 0 ? audioDuration / n : nodeData.perImageDuration ?? 3
  const totalSeconds = audioDuration ?? (n > 0 ? n * (nodeData.perImageDuration ?? 3) : 0)

  const progressPct = nodeData.currentJobProgress
  const isQueued = status === "running" && (!progressPct || progressPct <= 3)
  const isEncoding = status === "running" && !isQueued
  // Worker phases: segments 5→70, concat 70→88, mux 88→95.
  const encodingPhase =
    (progressPct ?? 0) >= 88 ? "mux" : (progressPct ?? 0) >= 70 ? "concat" : "segments"
  const segmentOfN =
    isEncoding && encodingPhase === "segments" && n > 0
      ? Math.min(n, Math.max(1, Math.ceil((((progressPct ?? 5) - 5) / 65) * n)))
      : undefined

  const motion = nodeData.motion ?? "none"
  const configuredAspect = ASPECT_TO_NUMBER[nodeData.aspectRatio ?? "16:9"] ?? 16 / 9
  const summaryLabel = `${nodeData.resolution ?? "1080p"} · ${fps}fps · ${nodeData.lastAppliedTransition ?? "cut"}${nodeData.transitionDuration ? ` ${nodeData.transitionDuration}s` : ""}`

  const hasResult = status !== "running" && !!activeUrl && !videoError
  const tooFew = n === 1
  const tooMany = n > MAX_IMAGES

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  return (
    <div className="relative group/node" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      <EditableNodeLabel label={nodeData.label} icon={<GalleryHorizontalEnd className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode id={id} label={nodeData.label} icon={<GalleryHorizontalEnd className="h-4 w-4" />} category="processing" credits={credits} selected={selected} isRunning={status === "running"}
        hideHeader
        {...videoNodeSizing(mediaAspectRatio ?? configuredAspect)}
        className={hasResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        topToolbarContent={(<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />)}
        handles={[
          { id: "images",     type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 88px)', left: '-29px' }, external: true },
          { id: "audio",      type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 56px)', left: '-29px' }, external: true },
          { id: "transition", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
          { id: "video",      type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
        ]}
      >
        {hasResult ? null : (
          <div className="h-full flex flex-col gap-1.5">
            {/* Validation walls — redirects, not dead ends */}
            {tooFew && !isEncoding && !isQueued && (
              <div className="flex-1 min-h-24 flex flex-col items-center justify-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-center">
                <div className="w-7 h-7 rounded-md bg-red-500/15 border border-red-500/50 flex items-center justify-center text-red-500 text-sm">!</div>
                <span className="text-[11px] text-red-400 font-medium">{t("node.only1Image")}</span>
                <span className="text-[10px] text-muted-foreground leading-snug">{t("node.slideshowNeedsAtLeast2")} <span className="text-foreground">{t("node.stillToVideo")}</span> — same output, no list needed.</span>
              </div>
            )}
            {tooMany && !isEncoding && !isQueued && (
              <div className="flex-1 min-h-24 flex flex-col items-center justify-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/5 p-3 text-center">
                <div className="w-7 h-7 rounded-md bg-red-500/15 border border-red-500/50 flex items-center justify-center text-red-500 text-sm">!</div>
                <span className="text-[11px] text-red-400 font-medium">{n} images</span>
                <span className="text-[10px] text-muted-foreground leading-snug">{t("node.capIs")} {MAX_IMAGES}. Trim the set upstream — rendering this would take hours rather than fail fast.</span>
              </div>
            )}

            {/* Queued */}
            {isQueued && (
              <div className="flex-1 min-h-24 flex flex-col items-center justify-center gap-2 rounded-md bg-muted/30">
                <div className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-foreground/70 animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-foreground/70 animate-pulse [animation-delay:200ms]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-foreground/70 animate-pulse [animation-delay:400ms]" />
                </div>
                <span className="text-xs text-foreground/90">{t("node.queued")}</span>
              </div>
            )}

            {/* Rendering — per-segment disclosure, matching the worker's phases */}
            {isEncoding && (
              <div className="relative flex-1 min-h-24 rounded-md overflow-hidden bg-muted/30">
                {slideUrls[0] && (
                  <CachedImage src={slideUrls[Math.min((segmentOfN ?? 1) - 1, n - 1)]!} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
                )}
                <div className="absolute inset-x-0 bottom-0 px-2.5 py-2 flex flex-col gap-1 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-white">
                      {encodingPhase === "segments" && segmentOfN !== undefined ? `Rendering — segment ${segmentOfN} of ${n}` : encodingPhase === "concat" ? "Joining slides" : "Muxing audio"}
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: HANDLE_COLORS.video }}>{progressPct ?? 0}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-white/20 overflow-hidden">
                    <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${progressPct ?? 0}%`, background: HANDLE_COLORS.video }} />
                  </div>
                  <span className="text-[9px] font-mono text-white/60">building silent segments · then {nodeData.lastAppliedTransition === "cut" ? "concat" : "xfade"} · then mux</span>
                </div>
              </div>
            )}

            {/* Failed */}
            {status === "failed" && !activeUrl && (
              <div className="flex-1 min-h-0 flex flex-col gap-1.5">
                <div className="relative flex-1 min-h-24 rounded-md overflow-hidden bg-muted/30">
                  {slideUrls[0] && (
                    <CachedImage src={slideUrls[0]} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25 grayscale" />
                  )}
                  <div className="relative flex flex-col items-center justify-center gap-1.5 h-full p-3 text-center">
                    <div className="w-7 h-7 rounded-md bg-red-500/15 border border-red-500/50 flex items-center justify-center"><AlertCircle className="w-4 h-4 text-red-500" /></div>
                    <span className="text-[11px] text-red-400 font-medium">{t("node.failed")}</span>
                    {nodeData.errorMessage && (
                      <p className="text-[9px] font-mono text-muted-foreground line-clamp-2" title={nodeData.errorMessage}>{nodeData.errorMessage}</p>
                    )}
                  </div>
                </div>
                <button type="button" className="nodrag w-full h-8 rounded-lg border border-red-500/50 bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 transition-colors flex items-center justify-center gap-1.5" onClick={(e) => { e.stopPropagation(); runSingleNode?.(id) }}>
                  <RotateCcw className="w-3 h-3" /> {t("editor.retry")}
                </button>
              </div>
            )}

            {/* Idle — the FILMSTRIP TIMELINE: slide widths are their real durations */}
            {status !== "running" && !activeUrl && status !== "failed" && !tooFew && !tooMany && (
              n >= 2 ? (
                <div className="flex-1 min-h-0 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-[9px] font-mono text-muted-foreground">{n} images{n > 5 ? ` · showing all` : ""}</span>
                    <span className="text-[9px] font-mono text-muted-foreground">{motion === "none" ? "no motion" : `${motion} · ${nodeData.intensity ?? 3}`} · {nodeData.aspectRatio ?? "16:9"}</span>
                  </div>
                  {/* The strip: equal split today (canvas has no per-row overrides), so equal widths tell the truth */}
                  <div className="flex-1 min-h-16 flex gap-[3px] rounded-md overflow-hidden">
                    {slideUrls.slice(0, 24).map((url, i) => (
                      <div key={`${url}-${i}`} className="relative flex-1 min-w-0 bg-muted/40">
                        <CachedImage src={url} alt="" className="absolute inset-0 w-full h-full object-cover" />
                        <span className="absolute bottom-0.5 left-1 text-[8px] font-mono text-white/90 drop-shadow">{perSlideSeconds >= 0.1 ? `${perSlideSeconds.toFixed(1)}s` : ""}</span>
                      </div>
                    ))}
                    {n > 24 && (
                      <div className="flex-1 min-w-0 flex items-center justify-center bg-muted/40 text-[9px] font-mono text-muted-foreground">+{n - 24}</div>
                    )}
                  </div>
                  {/* The ruler: the audio underneath is what everything is measured against */}
                  <div className="flex items-center gap-2 h-5 px-1.5 rounded bg-muted/40">
                    {upstreamAudioUrl ? (
                      <>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: HANDLE_COLORS.audio }} />
                        <span className="text-[9px] font-mono text-muted-foreground flex-1 truncate">audio-driven · equal split</span>
                        <span className="text-[10px] font-mono text-foreground">{audioDuration ? formatClipLength(audioDuration) : "…"}</span>
                      </>
                    ) : hasAudioEdge ? (
                      <span className="text-[9px] font-mono text-muted-foreground">audio sets the length</span>
                    ) : (
                      <span className="text-[9px] font-mono text-muted-foreground flex-1">no audio track · output will be silent · total {totalSeconds.toFixed(1)}s</span>
                    )}
                  </div>
                  {nodeData.lastScaleFactor !== undefined && nodeData.lastScaleFactor !== null && (
                    <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30">
                      <span className="text-amber-500 text-[10px] leading-none mt-0.5">⚠</span>
                      <span className="text-[9px] text-amber-600 dark:text-amber-300 leading-snug">Your durations were scaled ×{nodeData.lastScaleFactor.toFixed(2)} to fill the audio track.</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 min-h-24 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/20 p-2 text-center">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-lg border border-dashed flex items-center justify-center" style={{ borderColor: HANDLE_COLORS.control }}><ImagesIcon className="w-3.5 h-3.5" style={{ color: HANDLE_COLORS.control }} /></div>
                      <span className="text-[8px] text-muted-foreground/60">images</span>
                    </div>
                    <span className="text-xs text-muted-foreground/40 -mt-3">+</span>
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-lg border border-dashed flex items-center justify-center" style={{ borderColor: HANDLE_COLORS.audio }}><Volume2 className="w-3.5 h-3.5" style={{ color: HANDLE_COLORS.audio }} /></div>
                      <span className="text-[8px] text-muted-foreground/60">audio</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground/70">Wire 2–100 images — a List or Collect feeds them in order</span>
                  <span className="text-[9px] font-mono text-muted-foreground/40">audio optional — wired, it sets the length</span>
                </div>
              )
            )}

            {results.length > 1 && (
              <div className="flex gap-1 overflow-x-auto">
                {results.slice(0, 5).map((r, i) => (
                  <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                    {r.thumbnailUrl ? (
                      <CachedImage src={r.thumbnailUrl} alt="" className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`} thumbnail thumbnailWidth={80} onClick={(e) => { e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url }) }} />
                    ) : (
                      <video src={r.url} crossOrigin="anonymous" className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`} onClick={(e) => { e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url }) }} muted playsInline />
                    )}
                    <button type="button" aria-label={t("node.removeResult")} className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(i) }}><X className="w-2.5 h-2.5" /></button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-muted-foreground">{transitionPick ? `${summaryLabel} · pick: ${transitionPick}` : summaryLabel}</p>
          </div>
        )}
      </BaseNode>
      {hasResult && (
        <VideoResultOverlay
          url={activeUrl}
          onEdit={() => openFreeCut(id, activeUrl!, activeResult?.freecutProjectUrl)}
          videoAutoplay={videoAutoplay}
          label={nodeData.label}
          hasResults={results.length > 0}
          onExpand={() => setPreviewOpen(true)}
          onDelete={() => setDeleteConfirm(activeIndex)}
          onRawDimensions={handleLoadDimensions}
          onVideoError={() => setVideoError(true)}
          onVideoLoad={() => setVideoError(false)}
        />
      )}
      <HandleWithPopover nodeId={id} nodeType="slideshow" handleId="images"     type="target" position={Position.Left}  label="Images"     color={HANDLE_COLORS.control} icon={<ImagesIcon />}     side="left"  top="calc(100% - 88px)" accepts={ACCEPTS_IMAGES} />
      <HandleWithPopover nodeId={id} nodeType="slideshow" handleId="audio"      type="target" position={Position.Left}  label="Audio"      color={HANDLE_COLORS.audio}   icon={<Volume2 />}        side="left"  top="calc(100% - 56px)" accepts={ACCEPTS_AUDIO} />
      <HandleWithPopover nodeId={id} nodeType="slideshow" handleId="transition" type="target" position={Position.Left}  label="Transition" color={HANDLE_COLORS.control} icon={<ArrowLeftRight />} side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_TRANSITION} />
      <HandleWithPopover nodeId={id} nodeType="slideshow" handleId="video"      type="source" position={Position.Right} label="Video"      color={HANDLE_COLORS.video}   icon={<Film />}           side="right" top="24px" />
      {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="video" url={activeUrl} results={results} initialIndex={activeIndex} />}
      <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const SlideshowNode = memo(SlideshowNodeComponent)
