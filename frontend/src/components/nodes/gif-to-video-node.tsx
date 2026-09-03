"use client"

import { useT } from "@/lib/i18n"
import { memo, useState, useEffect, useMemo, useRef } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Film, Loader2, AlertCircle, X, RotateCcw, Upload, Image as ImageIcon } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { isValidGifToVideoConnection } from "@/lib/video-producer-handles"
import { incomingSourcesFingerprint } from "@/lib/node-fingerprint"
import { extractNodeOutput } from "@/components/editor/workflow-editor/execution-graph"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useFileUpload } from "@/hooks/use-file-upload"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { VideoResultOverlay } from "./video-result-overlay"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { GifToVideoData } from "@/types/nodes"

const ACCEPTS_IMAGE = (t: string) => isValidGifToVideoConnection("image", t)

function GifToVideoNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as GifToVideoData
  // Zero credits by design (local FFmpeg, no provider) — a static 0, not the
  // ee pricing hook: keeps this core file free of ee/ imports.
  const credits = 0
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const { upload, isUploading, uploadError } = useFileUpload()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)

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

  // Re-render when an incoming connection or upstream source data changes.
  const connectedFingerprint = useWorkflowStore((s) =>
    incomingSourcesFingerprint(s.nodes, s.edges, id),
  )
  const upstreamGifUrl = useMemo(() => {
    const { nodes, edges } = useWorkflowStore.getState()
    for (const edge of edges) {
      if (edge.target !== id || edge.targetHandle !== "image") continue
      const src = nodes.find((n) => n.id === edge.source)
      if (src) return extractNodeOutput(src, edge.sourceHandle ?? undefined)
    }
    return undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedFingerprint, id])

  // The GIF that will be converted: an upstream edge wins, else the one
  // uploaded through the node's own dropzone.
  const sourceGifUrl = upstreamGifUrl ?? nodeData.gifUrl
  const hasSource = Boolean(sourceGifUrl)

  async function handleFile(file: File | undefined) {
    if (!file) return
    try {
      const res = await upload(file)
      updateNodeData(id, { gifUrl: res.url, assetId: res.assetId ?? "" })
    } catch {
      // useFileUpload surfaces the error (storage modal / state); nothing else to do.
    }
  }

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  const progressPct = nodeData.currentJobProgress
  const hasResult = status !== "running" && !!activeUrl && !videoError
  const isQueued = status === "running" && (!progressPct || progressPct <= 3)
  const isEncoding = status === "running" && !isQueued
  const loopLabel = nodeData.loopToMinimum ? `loop→${nodeData.targetDuration ?? 3}s` : "as-is"
  const summaryLabel = `${loopLabel} · ${nodeData.interpolate ? "smooth" : "stepped"} · bg ${nodeData.alphaBackground ?? "white"}`

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <EditableNodeLabel label={nodeData.label} icon={<Film className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode id={id} label={nodeData.label} icon={<Film className="h-4 w-4" />} category="processing" credits={credits} selected={selected} isRunning={status === "running"}
        hideHeader
        {...videoNodeSizing(mediaAspectRatio ?? 16 / 9)}
        className={hasResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        topToolbarContent={(<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />)}
        handles={[
          { id: "image", type: "target", position: Position.Left,  customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          { id: "video", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
        ]}
      >
        {hasResult ? null : (
          <div className="h-full flex flex-col gap-1.5">
            <input
              type="file"
              accept="image/gif,image/webp,image/apng,image/png,image/jpeg"
              onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = "" }}
              className="hidden"
              ref={fileInputRef}
            />

            {/* Uploading the GIF */}
            {isUploading && (
              <div className="flex-1 min-h-24 flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-md">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Uploading GIF…</span>
              </div>
            )}

            {/* Queued */}
            {!isUploading && isQueued && (
              <div className="relative flex-1 min-h-24 rounded-md overflow-hidden bg-muted/30">
                {sourceGifUrl && <img src={sourceGifUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30 grayscale" />}
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

            {/* Converting */}
            {!isUploading && isEncoding && (
              <div className="relative flex-1 min-h-24 rounded-md overflow-hidden bg-muted/30">
                {sourceGifUrl ? (
                  <img src={sourceGifUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                )}
                <div className="absolute inset-x-0 bottom-0 px-2.5 py-2 flex flex-col gap-1 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-white">{t("node.converting")}</span>
                    <span className="text-[10px] font-mono" style={{ color: HANDLE_COLORS.video }}>{progressPct ?? 0}%</span>
                  </div>
                  <div className="h-1 rounded-full bg-white/20 overflow-hidden">
                    <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${progressPct ?? 0}%`, background: HANDLE_COLORS.video }} />
                  </div>
                </div>
              </div>
            )}

            {/* Failed */}
            {!isUploading && status === "failed" && !activeUrl && (
              <div className="flex-1 min-h-0 flex flex-col gap-1.5">
                <div className="relative flex-1 min-h-24 rounded-md overflow-hidden bg-muted/30">
                  {sourceGifUrl && <img src={sourceGifUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25 grayscale" />}
                  <div className="relative flex flex-col items-center justify-center gap-1.5 h-full p-3 text-center">
                    <div className="w-7 h-7 rounded-md bg-red-500/15 border border-red-500/50 flex items-center justify-center"><AlertCircle className="w-4 h-4 text-red-500" /></div>
                    <span className="text-[11px] text-red-400 font-medium">{t("node.failed")}</span>
                    {nodeData.errorMessage && (
                      <p className="text-[9px] font-mono text-muted-foreground line-clamp-2" title={nodeData.errorMessage}>{nodeData.errorMessage}</p>
                    )}
                  </div>
                </div>
                <button type="button" className="nodrag w-full h-8 rounded-lg border border-red-500/50 bg-red-500/10 text-red-400 text-xs hover:bg-red-500/20 transition-colors flex items-center justify-center gap-1.5"
                  onClick={(e) => { e.stopPropagation(); runSingleNode?.(id) }}>
                  <RotateCcw className="w-3 h-3" /> {t("editor.retry")}
                </button>
              </div>
            )}

            {!isUploading && status !== "running" && activeUrl && videoError && (
              <div className="relative group">
                <div className="w-full h-28 rounded-md bg-amber-500/10 border border-amber-500/30 flex flex-col items-center justify-center gap-1">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  <span className="text-[10px] text-amber-500">{t("node.videoLoadFailed")}</span>
                  <a href={activeUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 underline" onClick={(e) => e.stopPropagation()}>{t("node.openUrl")}</a>
                </div>
              </div>
            )}

            {/* Idle — source GIF preview, or the dropzone */}
            {!isUploading && status !== "running" && !activeUrl && status !== "failed" && (
              hasSource ? (
                <div className="flex-1 min-h-0 flex flex-col gap-1.5">
                  <div className="relative flex-1 min-h-24 rounded-md overflow-hidden bg-black">
                    <img src={sourceGifUrl} alt="" className="absolute inset-0 w-full h-full object-contain" />
                    <div className="absolute left-1.5 top-1.5 px-1.5 py-0.5 rounded bg-black/70 text-white text-[9px] font-mono">GIF → MP4</div>
                    {!upstreamGifUrl && (
                      <button type="button" aria-label={t("node.replaceGif")}
                        className="absolute right-1.5 top-1.5 w-6 h-6 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white rounded-full opacity-0 group-hover/node:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}>
                        <Upload className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className={`flex-1 min-h-24 flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed transition-colors cursor-pointer p-2 text-center ${
                    isDragOver ? "border-[#475569] bg-[#475569]/10" : "border-muted-foreground/20 hover:border-[#475569]/50 hover:bg-[#475569]/5"
                  }`}
                  onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true) }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); handleFile(e.dataTransfer.files[0]) }}
                >
                  <div className="flex items-center gap-1.5 text-muted-foreground/60">
                    <ImageIcon className="w-4 h-4" />
                    <span className="text-xs">{isDragOver ? "Drop GIF" : "Choose or wire a GIF"}</span>
                  </div>
                  <span className="text-[9px] text-muted-foreground/50">GIF → MP4 for use as a motion reference</span>
                </button>
              )
            )}

            {results.length > 1 && (
              <div className="flex gap-1 overflow-x-auto">
                {results.slice(0, 5).map((r, i) => (
                  <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                    {r.thumbnailUrl ? (
                      <img src={r.thumbnailUrl} alt="" className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`} onClick={(e) => { e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url }) }} />
                    ) : (
                      <video src={r.url} crossOrigin="anonymous" className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`} onClick={(e) => { e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url }) }} muted playsInline />
                    )}
                    <button type="button" aria-label={t("node.removeResult")} className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(i) }}><X className="w-2.5 h-2.5" /></button>
                  </div>
                ))}
              </div>
            )}
            {uploadError && !hasSource && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-500/10 text-red-400 text-[10px]">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span className="truncate">{uploadError}</span>
              </div>
            )}
            <p className="text-muted-foreground text-[10px]">{summaryLabel}</p>
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
      <HandleWithPopover nodeId={id} nodeType="gif-to-video" handleId="image" type="target" position={Position.Left}  label="GIF"   color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_IMAGE} />
      <HandleWithPopover nodeId={id} nodeType="gif-to-video" handleId="video" type="source" position={Position.Right} label="Video" color={HANDLE_COLORS.video} icon={<Film />}      side="right" top="24px" />
      {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="video" url={activeUrl} results={results} initialIndex={activeIndex} />}
      <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const GifToVideoNode = memo(GifToVideoNodeComponent)
