"use client"

import { memo, useState, useMemo, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Volume2, Loader2, AlertCircle, X, Film, Mic, Music, AudioWaveform, Clapperboard } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/hooks/use-model-credits"
import { CachedImage } from "@/components/ui/cached-image"
import { VideoResultOverlay } from "./video-result-overlay"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { MergeVideoAudioData } from "@/types/nodes"

const VIDEO_TYPES = new Set([
  "image-to-video", "video-to-video", "text-to-video",
  "lip-sync", "motion-transfer", "video-upscale",
  "combine-videos", "add-captions", "resize-video", "trim-video",
  "upload-video", "youtube-video",
])

function getSourceIcon(nodeType: string) {
  if (VIDEO_TYPES.has(nodeType)) return Film
  if (nodeType === "text-to-speech") return Mic
  if (nodeType === "generate-music") return Music
  if (nodeType === "text-to-audio") return AudioWaveform
  return Volume2
}

function MergeVideoAudioNodeComponent({ id, data, selected }: NodeProps) {
  const currentNodeData = useWorkflowStore((s) => s.nodes.find((n) => n.id === id)?.data) as MergeVideoAudioData | undefined
  const nodeData = currentNodeData ?? (data as MergeVideoAudioData)
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const credits = useModelCredits("ffmpeg", 1)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => { setVideoDimensions(null) }, [activeUrl])

  const hasResult = status !== "running" && !!activeUrl

  // Collect connected source info for display
  const connectedSources = useMemo(() => {
    const incoming = edges.filter((e) => e.target === id)
    return incoming
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is typeof nodes[number] => n !== undefined)
      .map((n) => ({
        id: n.id,
        type: n.type,
        label: (n.data as Record<string, unknown>).label as string ?? n.type,
        isVideo: VIDEO_TYPES.has(n.type),
      }))
  }, [edges, nodes, id])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  return (
    <div
      className="relative group/node"
      style={{
        width: hasResult ? (videoDimensions?.width ?? 220) : 220,
        height: hasResult ? (videoDimensions?.height ?? 160) : undefined,
        overflow: 'visible',
      }}
    >
      <EditableNodeLabel label={nodeData.label} icon={<Volume2 className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Volume2 className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={220}
        className={hasResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        topToolbarContent={(<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />)}
        handles={[
          { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
          { id: "video-out", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
        ]}
      >
        {hasResult ? null : (
          <div className="flex flex-col gap-1">
            {status === "running" && (
              <div className="flex flex-col items-center justify-center gap-2 h-28 rounded-md bg-muted/30">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
              </div>
            )}

            {status === "failed" && !activeUrl && (
              <div className="flex flex-col items-center justify-center gap-1 h-16 rounded-md bg-red-500/5 text-red-500 p-2">
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span className="font-medium">Failed</span>
                </div>
                {nodeData.errorMessage && (
                  <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                    {nodeData.errorMessage}
                  </p>
                )}
              </div>
            )}

            {status !== "running" && !activeUrl && status !== "failed" && (
              <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                <Volume2 className="w-5 h-5" />
              </div>
            )}

            {results.length > 1 && (
              <div className="flex gap-1 overflow-x-auto">
                {results.slice(0, 5).map((r, i) => (
                  <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                    {r.thumbnailUrl ? (
                      <CachedImage
                        src={r.thumbnailUrl}
                        alt=""
                        className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`}
                        thumbnail
                        thumbnailWidth={80}
                        onClick={(e) => {
                          e.stopPropagation()
                          updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                        }}
                      />
                    ) : (
                      <video
                        src={r.url}
                        crossOrigin="anonymous"
                        className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`}
                        onClick={(e) => { e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url }) }}
                        muted
                        playsInline
                      />
                    )}
                    <button
                      type="button"
                      aria-label="Remove" className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(i) }}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Connected sources display */}
            {connectedSources.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {connectedSources.map((src) => {
                  const Icon = getSourceIcon(src.type)
                  return (
                    <div
                      key={src.id}
                      className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] ${src.isVideo ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400"}`}
                      title={src.label}
                    >
                      <Icon className="w-2.5 h-2.5" />
                      <span className="truncate max-w-[50px]">{src.label}</span>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="flex justify-between text-muted-foreground text-[10px]">
              <span>{nodeData.keepOriginalAudio !== false ? "Keep orig audio" : "No orig audio"}</span>
              {Object.keys(nodeData.trackSettings ?? {}).length > 0 && (
                <span>{Object.keys(nodeData.trackSettings ?? {}).length} tracks</span>
              )}
            </div>
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
          onDimensionsChange={setVideoDimensions}
        />
      )}
      <HandleIcon icon={<Clapperboard />} color="steel" side="left" top="calc(100% - 20px)" />
      <HandleIcon icon={<Film />} color="steel" top="20px" />
      {activeUrl && (
        <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="video" url={activeUrl} />
      )}
      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }}
      />
    </div>
  )
}

export const MergeVideoAudioNode = memo(MergeVideoAudioNodeComponent)
