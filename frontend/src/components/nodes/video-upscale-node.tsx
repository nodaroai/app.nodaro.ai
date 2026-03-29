"use client"

import { memo, useState, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ArrowUpFromLine, Clapperboard, Film, Loader2, AlertCircle, X } from "lucide-react"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { useModelCredits } from "@/hooks/use-model-credits"
import { VideoResultOverlay } from "./video-result-overlay"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { VideoUpscaleData } from "@/types/nodes"

function VideoUpscaleNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as VideoUpscaleData
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
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null)
  const upscaleProvider = (nodeData.provider as string | undefined) ?? "topaz-video"
  const upscaleFallback = upscaleProvider === "veo-4k" ? 38 : upscaleProvider === "veo-1080p" ? 2 : 19
  const credits = useModelCredits(upscaleProvider, upscaleFallback)

  useEffect(() => { setVideoDimensions(null) }, [activeUrl])

  const hasResult = status !== "running" && !!activeUrl

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
      <EditableNodeLabel
        label={nodeData.label}
        icon={<ArrowUpFromLine className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<ArrowUpFromLine className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        minWidth={220}
        className={hasResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        topToolbarContent={
                      <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={[
          { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
          { id: "video", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
        ]}
      >
        {hasResult ? null : (
          <div className="flex flex-col gap-1">
            {status === "running" && (
              <div className="flex flex-col items-center justify-center h-28 rounded-md bg-muted/30 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress} />
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

            {status !== "running" && !activeUrl && status !== "failed" && (
              <div className="flex items-center justify-center h-28 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                <ArrowUpFromLine className="w-6 h-6" />
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
                        className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${
                          i === activeIndex
                            ? "opacity-100 ring-2 ring-primary"
                            : "opacity-50 hover:opacity-80"
                        }`}
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
                        className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${
                          i === activeIndex
                            ? "opacity-100 ring-2 ring-primary"
                            : "opacity-50 hover:opacity-80"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation()
                          updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                        }}
                        muted
                        playsInline
                      />
                    )}
                    <button
                      type="button"
                      aria-label="Remove" className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteResult(i)
                      }}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-center text-muted-foreground text-xs">
              <span>Topaz {nodeData.upscaleFactor}x Upscale</span>
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
          onDelete={() => handleDeleteResult(activeIndex)}
          onDimensionsChange={setVideoDimensions}
        />
      )}
      <HandleIcon icon={<Clapperboard />} color="steel" side="left" top="calc(100% - 20px)" />
      <HandleIcon icon={<Film />} color="steel" top="20px" />
      {activeUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="video"
          url={activeUrl}
          results={results}
          initialIndex={activeIndex}
        />
      )}
    </div>
  )
}

export const VideoUpscaleNode = memo(VideoUpscaleNodeComponent)
