"use client"

import { useT } from "@/lib/i18n"
import { memo, useState, useEffect, useMemo, useRef } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ImagePlay, Loader2, AlertCircle, X, Image as ImageIcon, Volume2, Film, RotateCcw } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { isValidStillToVideoConnection } from "@/lib/video-producer-handles"
import { incomingSourcesFingerprint } from "@/lib/node-fingerprint"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useProbedAudioDuration, formatClipLength } from "@/hooks/use-probed-audio-duration"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { VideoResultOverlay } from "./video-result-overlay"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { StillToVideoData } from "@/types/nodes"

/** Configured aspect → number, so the IDLE box already frames like the render
 *  will (9:16 config = portrait card). A real result's aspect still wins. */
const ASPECT_TO_NUMBER: Record<StillToVideoData["aspectRatio"], number> = {
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "1:1": 1,
  "4:3": 4 / 3,
}

const ACCEPTS_IMAGE = (t: string) => isValidStillToVideoConnection("image", t)
const ACCEPTS_AUDIO = (t: string) => isValidStillToVideoConnection("audio", t)

/** Canvas preview animation per motion preset (keyframes in globals.css) —
 *  the design's "live motion preview": the wired still moves the way the
 *  render will, before any credits-free render is even started. */
const MOTION_PREVIEW_ANIMATION: Record<StillToVideoData["motion"], string | undefined> = {
  "none": undefined,
  "zoom-in": "stv-zoom-in 8s ease-in-out infinite alternate",
  "zoom-out": "stv-zoom-out 8s ease-in-out infinite alternate",
  "pan-left": "stv-pan-left 9s ease-in-out infinite alternate",
  "pan-right": "stv-pan-right 9s ease-in-out infinite alternate",
  "ken-burns": "stv-ken-burns 9s ease-in-out infinite",
}

/** Deterministic pseudo-waveform heights (30–90%), stable per audio URL —
 *  a decorative "audio wired, this sets the length" indicator (the real
 *  waveform would need a full decode; the strip's job is presence + length). */
function pseudoWaveformHeights(seed: string, count = 240): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (h >>> 15), 2246822519)
    h ^= h >>> 13
    out.push(30 + (Math.abs(h) % 61))
  }
  return out
}

function StillToVideoNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as StillToVideoData
  // Zero credits by design (local FFmpeg, no provider) — a static 0, not the
  // ee pricing hook: keeps this core file free of ee/ imports (check-ee-imports)
  // and needs no credits query in Community. The badge matches the seeded
  // model_pricing row (0) and STATIC_CREDIT_COSTS.
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
  // Result aspect drives node sizing — 16:9 until a result lands, then snaps to
  // the real video aspect (raw dims fed in via the overlay's onRawDimensions).
  const { aspectRatio: mediaAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoError, setVideoError] = useState(false)

  useEffect(() => {
    setVideoError(false)
  }, [activeUrl])

  // Re-render only when an incoming connection or upstream source data
  // changes (the lip-sync fingerprint pattern) — the preview shows the wired
  // still + audio, and the placeholder names what's missing.
  const connectedFingerprint = useWorkflowStore((s) =>
    incomingSourcesFingerprint(s.nodes, s.edges, id),
  )
  const { upstreamImageUrl, upstreamAudioUrl, hasAudioEdge } = useMemo(() => {
    const { nodes, edges } = useWorkflowStore.getState()
    let imageUrl: string | undefined
    let audioUrl: string | undefined
    let audioEdge = false
    for (const edge of edges) {
      if (edge.target !== id) continue
      const src = nodes.find((n) => n.id === edge.source)
      if (edge.targetHandle === "audio") {
        audioEdge = true
        if (src && !audioUrl) audioUrl = extractNodeOutput(src, edge.sourceHandle ?? undefined)
      } else if (edge.targetHandle === "image" && !imageUrl) {
        if (src) imageUrl = extractNodeOutput(src, edge.sourceHandle ?? undefined)
      }
    }
    return { upstreamImageUrl: imageUrl, upstreamAudioUrl: audioUrl, hasAudioEdge: audioEdge }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedFingerprint, id])

  // The hero fact: the audio's duration IS the output length. Probed from the
  // wired audio's metadata so it shows BEFORE any render (design: the node has
  // no duration field — it shows the resolved length instead).
  const fps = nodeData.fps ?? 30
  const audioDuration = useProbedAudioDuration(upstreamAudioUrl)
  const totalFrames = audioDuration ? Math.ceil(audioDuration * fps) : undefined
  const waveformHeights = useMemo(
    () => (upstreamAudioUrl ? pseudoWaveformHeights(upstreamAudioUrl) : []),
    [upstreamAudioUrl],
  )

  // Encode ETA — estimated from the real progress rate (the worker maps
  // ffmpeg's frame counter onto 5→90). Reset outside of active encoding.
  const progressPct = nodeData.currentJobProgress
  const etaSampleRef = useRef<{ t: number; pct: number } | null>(null)
  const [etaSeconds, setEtaSeconds] = useState<number | undefined>(undefined)
  useEffect(() => {
    if (status !== "running" || !progressPct || progressPct <= 3 || progressPct >= 90) {
      etaSampleRef.current = null
      setEtaSeconds(undefined)
      return
    }
    const now = Date.now()
    const prev = etaSampleRef.current
    etaSampleRef.current = { t: now, pct: progressPct }
    if (prev && progressPct > prev.pct && now > prev.t) {
      const pctPerSec = (progressPct - prev.pct) / ((now - prev.t) / 1000)
      if (pctPerSec > 0) setEtaSeconds(Math.max(1, Math.round((90 - progressPct) / pctPerSec)))
    }
  }, [progressPct, status])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  const motion = nodeData.motion ?? "none"
  const configuredAspect = ASPECT_TO_NUMBER[nodeData.aspectRatio ?? "16:9"] ?? 16 / 9
  const motionLabel = motion === "none" ? "no motion" : `${motion} · ${nodeData.intensity ?? 3}`
  const summaryLabel = `${nodeData.resolution ?? "1080p"} · ${fps}fps · ${nodeData.fit ?? "cover"}`
  const previewAnimation = MOTION_PREVIEW_ANIMATION[motion]

  const hasResult = status !== "running" && !!activeUrl && !videoError
  // Queued (waiting for a worker) vs Encoding — the worker stamps progress 3
  // the moment it picks the job up, so "Queued" is honest queue time only.
  const isQueued = status === "running" && (!progressPct || progressPct <= 3)
  const isEncoding = status === "running" && !isQueued
  const isFinishing = isEncoding && (progressPct ?? 0) >= 90
  // Approximate encoded-frame counter, inverted from the worker's 5→90 map.
  const encodedFrames =
    isEncoding && totalFrames && !isFinishing
      ? Math.min(totalFrames, Math.max(0, Math.round((((progressPct ?? 5) - 5) / 85) * totalFrames)))
      : undefined

  return (
    <div className="relative group/node" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      <EditableNodeLabel label={nodeData.label} icon={<ImagePlay className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode id={id} label={nodeData.label} icon={<ImagePlay className="h-4 w-4" />} category="processing" credits={credits} selected={selected} isRunning={status === "running"}
        hideHeader
        {...videoNodeSizing(mediaAspectRatio ?? configuredAspect)}
        className={hasResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        topToolbarContent={(<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />)}
        handles={[
          { id: "image", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 56px)', left: '-29px' }, external: true },
          { id: "audio", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
          { id: "video", type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
        ]}
      >
        {hasResult ? null : (
          <div className="h-full flex flex-col gap-1.5">
            {/* 03 · Queued — waiting for a worker slot */}
            {isQueued && (
              <div className="relative flex-1 min-h-24 rounded-md overflow-hidden bg-muted/30">
                {upstreamImageUrl && (
                  <CachedImage src={upstreamImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30 grayscale" />
                )}
                <div className="relative flex flex-col items-center justify-center gap-2 h-full">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-foreground/70 animate-pulse" />
                    <span className="w-1.5 h-1.5 rounded-full bg-foreground/70 animate-pulse [animation-delay:200ms]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-foreground/70 animate-pulse [animation-delay:400ms]" />
                  </div>
                  <span className="text-xs text-foreground/90">{t("node.queued")}</span>
                </div>
              </div>
            )}

            {/* 04 · Rendering — real frame-based progress from the worker */}
            {isEncoding && (
              <div className="relative flex-1 min-h-24 rounded-md overflow-hidden bg-muted/30">
                {upstreamImageUrl ? (
                  <CachedImage src={upstreamImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" style={previewAnimation ? { animation: previewAnimation } : undefined} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                )}
                <div className="absolute inset-x-0 bottom-0 px-2.5 py-2 flex flex-col gap-1 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-white">{isFinishing ? "Finishing" : "Encoding"}</span>
                    <span className="text-[10px] font-mono" style={{ color: HANDLE_COLORS.video }}>{progressPct ?? 0}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-white/20 overflow-hidden">
                    <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${progressPct ?? 0}%`, background: HANDLE_COLORS.video }} />
                  </div>
                  <div className="flex justify-between text-[9px] font-mono text-white/60">
                    <span>{encodedFrames !== undefined && totalFrames ? `frame ${encodedFrames} / ${totalFrames}` : isFinishing ? "uploading" : " "}</span>
                    <span>{etaSeconds !== undefined && !isFinishing ? `~${etaSeconds}s left` : " "}</span>
                  </div>
                </div>
              </div>
            )}

            {/* 06 · Error — dimmed still + retry */}
            {status === "failed" && !activeUrl && (
              <div className="flex-1 min-h-0 flex flex-col gap-1.5">
                <div className="relative flex-1 min-h-24 rounded-md overflow-hidden bg-muted/30">
                  {upstreamImageUrl && (
                    <CachedImage src={upstreamImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25 grayscale" />
                  )}
                  <div className="relative flex flex-col items-center justify-center gap-1.5 h-full p-3 text-center">
                    <div className="w-7 h-7 rounded-md bg-red-500/15 border border-red-500/50 flex items-center justify-center"><AlertCircle className="w-4 h-4 text-red-500" /></div>
                    <span className="text-[11px] text-red-400 font-medium">{t("node.failed")}</span>
                    {nodeData.errorMessage && (
                      <p className="text-[9px] font-mono text-muted-foreground line-clamp-2" title={nodeData.errorMessage}>
                        {nodeData.errorMessage}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="nodrag w-full h-8 rounded-lg border border-red-500/50 bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 transition-colors flex items-center justify-center gap-1.5"
                  onClick={(e) => { e.stopPropagation(); runSingleNode?.(id) }}
                >
                  <RotateCcw className="w-3 h-3" /> {t("editor.retry")}
                </button>
              </div>
            )}

            {status !== "running" && activeUrl && videoError && (
              <div className="relative group">
                <div className="w-full h-28 rounded-md bg-amber-500/10 border border-amber-500/30 flex flex-col items-center justify-center gap-1">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  <span className="text-[10px] text-amber-500">{t("node.videoLoadFailed")}</span>
                  <a href={activeUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 underline" onClick={(e) => e.stopPropagation()}>{t("node.openUrl")}</a>
                </div>
                {results.length > 0 && (
                  <button type="button" aria-label={t("node.removeResult")} className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}><X className="w-3 h-3" /></button>
                )}
              </div>
            )}

            {/* 01 / 02 · Idle — placeholder, or the live motion preview + Render */}
            {status !== "running" && !activeUrl && status !== "failed" && (
              upstreamImageUrl ? (
                <div className="flex-1 min-h-0 flex flex-col gap-1.5">
                  <div className="relative flex-1 min-h-24 rounded-md overflow-hidden bg-black">
                    <CachedImage src={upstreamImageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" style={previewAnimation ? { animation: previewAnimation } : undefined} />
                    <div className="absolute left-1.5 top-1.5 px-1.5 py-0.5 rounded bg-black/70 text-white text-[9px] font-mono">{motionLabel}</div>
                    <div className="absolute right-1.5 top-1.5 px-1.5 py-0.5 rounded bg-black/70 text-white text-[9px] font-mono">{nodeData.aspectRatio ?? "16:9"}</div>
                    <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 flex items-center gap-2 bg-gradient-to-t from-black/85 to-transparent">
                      {upstreamAudioUrl && waveformHeights.length > 0 ? (
                        <>
                          <div className="flex-1 min-w-0 flex items-end gap-[2px] h-3 overflow-hidden">
                            {waveformHeights.map((h, i) => (
                              <div key={i} className="w-[3px] flex-none rounded-[1px] opacity-70" style={{ height: `${h}%`, background: HANDLE_COLORS.audio }} />
                            ))}
                          </div>
                          <span className="text-[10px] font-mono text-white">{audioDuration ? formatClipLength(audioDuration) : "…"}</span>
                        </>
                      ) : hasAudioEdge ? (
                        <span className="text-[9px] font-mono text-white/70">audio sets the length</span>
                      ) : (
                        <span className="text-[9px] text-amber-300">Wire an audio track — it sets the length</span>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex-1 min-h-24 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-muted-foreground/20 p-2 text-center">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-lg border border-dashed flex items-center justify-center" style={{ borderColor: HANDLE_COLORS.image }}><ImageIcon className="w-3.5 h-3.5" style={{ color: HANDLE_COLORS.image }} /></div>
                      <span className="text-[8px] text-muted-foreground/60">image</span>
                    </div>
                    <span className="text-xs text-muted-foreground/40 -mt-3">+</span>
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-8 h-8 rounded-lg border border-dashed flex items-center justify-center" style={{ borderColor: HANDLE_COLORS.audio }}><Volume2 className="w-3.5 h-3.5" style={{ color: HANDLE_COLORS.audio }} /></div>
                      <span className="text-[8px] text-muted-foreground/60">audio</span>
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground/70">{t("node.wireAnImageAndAn")}</span>
                  <span className="text-[9px] font-mono text-muted-foreground/40">audio sets the length</span>
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
            <p className="text-muted-foreground">{summaryLabel}</p>
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
      <HandleWithPopover nodeId={id} nodeType="still-to-video" handleId="image" type="target" position={Position.Left}  label={t("node.stillImage")} color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left"  top="calc(100% - 56px)" accepts={ACCEPTS_IMAGE} />
      <HandleWithPopover nodeId={id} nodeType="still-to-video" handleId="audio" type="target" position={Position.Left}  label="Audio"       color={HANDLE_COLORS.audio} icon={<Volume2 />}   side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_AUDIO} />
      <HandleWithPopover nodeId={id} nodeType="still-to-video" handleId="video" type="source" position={Position.Right} label="Video"       color={HANDLE_COLORS.video} icon={<Film />}      side="right" top="24px" />
      {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="video" url={activeUrl} results={results} initialIndex={activeIndex} />}
      <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const StillToVideoNode = memo(StillToVideoNodeComponent)
