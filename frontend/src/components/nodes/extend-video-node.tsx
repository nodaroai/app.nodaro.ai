"use client"

import { memo, useState, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Film, Loader2, AlertCircle, X, Clapperboard } from "lucide-react"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/hooks/use-model-credits"
import { VideoResultOverlay } from "./video-result-overlay"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { ExtendVideoData } from "@/types/nodes"

function ExtendVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ExtendVideoData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const openFreeCut = useWorkflowStore((s) => s.openFreeCut)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoError, setVideoError] = useState(false)
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null)
  const extendProvider = nodeData.provider || "veo-extend"
  const credits = useModelCredits(extendProvider, extendProvider === "runway-extend" ? 32 : 40)

  useEffect(() => {
    setVideoError(false)
    setVideoDimensions(null)
  }, [activeUrl])

  const hasResult = status !== "running" && !!activeUrl && !videoError

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  return (
    <div className="relative group/node" style={{ width: hasResult ? (videoDimensions?.width ?? 220) : 220, height: hasResult ? (videoDimensions?.height ?? 160) : undefined, overflow: 'visible' }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<Film className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Film className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        className={hasResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        hideHeader
        topToolbarContent={
                      <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
        }
        handles={[
          { id: "in", type: "target", position: Position.Top, customStyle: { top: '-29px', left: '50%' }, hideHandle: true },
          { id: "video", type: "source", position: Position.Bottom, customStyle: { bottom: '-29px', left: '50%' }, hideHandle: true },
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

            {status !== "running" && activeUrl && videoError && (
              <div className="relative group">
                <div className="w-full h-28 rounded-md bg-amber-500/10 border border-amber-500/30 flex flex-col items-center justify-center gap-1">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  <span className="text-[10px] text-amber-500">Video load failed</span>
                  <a href={activeUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 underline" onClick={(e) => e.stopPropagation()}>Open URL</a>
                </div>
                <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">Extended</div>
                {results.length > 0 && (
                  <button type="button" aria-label="Remove" className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}><X className="w-3 h-3" /></button>
                )}
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
                <Film className="w-6 h-6" />
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
                      aria-label="Remove"
                      className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteConfirm(i)
                      }}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-center text-muted-foreground text-xs">
              <span>{nodeData.provider === "runway-extend" ? "Runway" : "VEO"} Extend</span>
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
          hasResults={results.length > 1}
          onExpand={() => setPreviewOpen(true)}
          onDelete={() => setDeleteConfirm(activeIndex)}
          onDimensionsChange={setVideoDimensions}
          onVideoError={() => setVideoError(true)}
          onVideoLoad={() => setVideoError(false)}
          onSettings={() => selectNode(isSettingsOpen ? null : id)}
          isSettingsOpen={isSettingsOpen}
        />
      )}

      {/* Input handle icon */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
        style={{ top: '-29px', left: 'calc(50% - 14px)' }}
      >
        <Clapperboard className="w-3.5 h-3.5 text-white" />
      </div>
      {/* Video output handle icon */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
        style={{ bottom: '-29px', left: 'calc(50% - 14px)' }}
      >
        <Film className="w-3.5 h-3.5 text-white" />
      </div>
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
      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
        }}
      />
    </div>
  )
}

export const ExtendVideoNode = memo(ExtendVideoNodeComponent)
