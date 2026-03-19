"use client"

import { memo, useState, useEffect } from "react"
import { Position, type NodeProps, NodeResizer, Handle } from "@xyflow/react"
import { Film, Loader2, AlertCircle, Volume2, Clapperboard } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useModelCredits } from "@/hooks/use-model-credits"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { VideoResultOverlay } from "./video-result-overlay"
import type { SunoMusicVideoData } from "@/types/nodes"

function SunoMusicVideoNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SunoMusicVideoData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const status = nodeData.executionStatus ?? "idle"
  const videoUrl = nodeData.generatedVideoUrl
  const results = (nodeData as Record<string, unknown>).generatedResults as readonly import("@/types/nodes").GeneratedResult[] | undefined
  const activeIndex = 0
  const activeUrl = videoUrl
  const credits = useModelCredits("suno-music-video", 5)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoError, setVideoError] = useState(false)
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    setVideoError(false)
    setVideoDimensions(null)
  }, [activeUrl])

  const hasResult = status !== "running" && !!activeUrl && !videoError

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results ? results.filter((_, i) => i !== indexToDelete) : []
    updateNodeData(id, {
      generatedResults: newResults,
      activeResultIndex: 0,
      generatedVideoUrl: newResults[0]?.url,
    })
  }

  return (
    <div className="relative group/node" style={{ width: hasResult ? (videoDimensions?.width ?? 220) : 220, height: hasResult ? (videoDimensions?.height ?? 160) : undefined, overflow: 'visible' }}>
      <NodeResizer
        isVisible={!!selected}
        minWidth={180}
        minHeight={180}
        lineClassName="!border-[#ff0073]"
        handleClassName="!w-2.5 !h-2.5 !bg-[#ff0073] !border-none !rounded-sm"
      />
      {/* Floating label above node */}
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
          status !== "running" ? (
            <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
          ) : undefined
        }
        handles={[]}
      >
        {hasResult ? null : (
          <div className="flex flex-col gap-2 p-3" style={{ minHeight: 180 }}>
            {status === "running" && !videoUrl && (
              <div className="flex items-center justify-center h-12 rounded-md bg-muted/30">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {status === "failed" && !videoUrl && (
              <div className="flex flex-col items-center justify-center gap-1 h-12 rounded-md bg-red-500/5 text-red-500 p-2">
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

            {status !== "running" && !videoUrl && status !== "failed" && (
              <div className="flex items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40" style={{ minHeight: 120, flex: 1 }}>
                <Film className="w-5 h-5" />
              </div>
            )}

            <span className="text-xs text-muted-foreground">Music Video</span>
          </div>
        )}
      </BaseNode>

      {hasResult && (
        <VideoResultOverlay
          url={activeUrl}
          videoAutoplay={videoAutoplay}
          label={nodeData.label}
          hasResults={!!results && results.length > 0}
          onExpand={() => setPreviewOpen(true)}
          onDelete={() => setDeleteConfirm(activeIndex)}
          onDimensionsChange={setVideoDimensions}
          onVideoError={() => setVideoError(true)}
          onVideoLoad={() => setVideoError(false)}
        />
      )}

      {/* Invisible input handle */}
      <Handle
        id="audio"
        type="target"
        position={Position.Left}
        className="!w-7 !h-7 !bg-transparent !border-0 !opacity-0 touch-manipulation"
        style={{ top: '155px', left: '-29px', transform: 'none' }}
      />
      {/* Invisible output handle */}
      <Handle
        id="video-out"
        type="source"
        position={Position.Right}
        className="!w-7 !h-7 !bg-transparent !border-0 !opacity-0 touch-manipulation"
        style={{ top: '50px', right: '-29px', transform: 'none', left: 'auto' }}
      />
      {/* Input handle icon */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
        style={{ top: '155px', left: '-29px' }}
      >
        <Volume2 className="w-3.5 h-3.5 text-white" />
      </div>
      {/* Output handle icon */}
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
        style={{ top: '50px', right: '-29px' }}
      >
        <Clapperboard className="w-3.5 h-3.5 text-white" />
      </div>
      {activeUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="video"
          url={activeUrl}
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

export const SunoMusicVideoNode = memo(SunoMusicVideoNodeComponent)
