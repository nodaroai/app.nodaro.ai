"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Share2, Loader2, AlertCircle, X } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/hooks/use-model-credits"
import { PLATFORM_SPECS, PLATFORM_LABELS } from "@/lib/social-media-specs"
import type { SocialMediaFormatData } from "@/types/nodes"
import type { SocialMediaPlatform } from "@/lib/social-media-specs"

function SocialMediaFormatNodeComponent({ id, data, selected }: NodeProps) {
  const currentNodeData = useWorkflowStore((s) => s.nodes.find((n) => n.id === id)?.data) as SocialMediaFormatData | undefined
  const nodeData = currentNodeData ?? (data as SocialMediaFormatData)
  const credits = useModelCredits("ffmpeg", 0)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl ?? nodeData.generatedImageUrl
  const activeThumbnail = activeResult?.thumbnailUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoError, setVideoError] = useState(false)

  const spec = PLATFORM_SPECS[nodeData.specKey]
  const isVideo = spec?.isVideo !== false
  const platformLabel = PLATFORM_LABELS[nodeData.platform as SocialMediaPlatform] ?? nodeData.platform
  const specLabel = spec ? `${spec.width}×${spec.height}` : ""

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) { newActiveIndex = 0 }
    else if (indexToDelete < activeIndex) { newActiveIndex = activeIndex - 1 }
    updateNodeData(id, {
      generatedResults: newResults,
      activeResultIndex: newActiveIndex,
      generatedVideoUrl: newResults[newActiveIndex]?.url,
      generatedImageUrl: undefined,
    })
  }

  return (
    <div className="relative group/run">
    <BaseNode id={id} label={nodeData.label} icon={<Share2 className="h-4 w-4" />} category="processing" credits={credits} selected={selected} isRunning={status === "running"}
      handles={[
        { id: "media-in", type: "target", position: Position.Left, label: "Media" },
        { id: "text-in", type: "target", position: Position.Left, label: "Text" },
        { id: "media-out", type: "source", position: Position.Right, label: "Media" },
        { id: "text-out", type: "source", position: Position.Right, label: "Text" },
      ]}
    >
      <div className="flex flex-col gap-1">
        {status === "running" && (
          <div className="flex items-center justify-center h-28 rounded-md bg-muted/30"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        )}
        {status !== "running" && activeUrl && !videoError && (
          <div className="relative group">
            {isVideo && !activeThumbnail ? (
              <video
                src={activeUrl}
                className="w-full h-28 object-cover rounded-md cursor-pointer"
                onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}
                autoPlay={videoAutoplay}
                muted
                loop={videoAutoplay}
                playsInline
                onError={() => setVideoError(true)}
                onLoadedData={() => setVideoError(false)}
              />
            ) : (
              <CachedImage
                src={activeThumbnail ?? activeUrl}
                alt="Media preview"
                className="w-full h-28 object-cover rounded-md cursor-pointer"
                thumbnail
                thumbnailWidth={320}
                onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}
              />
            )}
            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">{specLabel}</div>
            {results.length > 0 && (
              <button type="button" aria-label="Remove" className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}><X className="w-3 h-3" /></button>
            )}
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
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40"><Share2 className="w-5 h-5" /></div>
        )}
        <p className="text-muted-foreground">{platformLabel} — {spec?.label ?? nodeData.contentType}</p>
      </div>
    </BaseNode>
    <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
    {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type={isVideo ? "video" : "image"} url={activeUrl} />}
    <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const SocialMediaFormatNode = memo(SocialMediaFormatNodeComponent)
