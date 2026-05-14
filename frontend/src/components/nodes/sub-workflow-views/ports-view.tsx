"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import type { SubWorkflowViewProps } from "./view-mode-registry"
import type { GeneratedResult } from "@/types/nodes"
import { CachedImage } from "@/components/ui/cached-image"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { NodeJobProgress } from "../node-job-progress"
import { useFullResolution } from "@/hooks/use-full-resolution"

export function PortsView({ nodeId, data }: SubWorkflowViewProps) {
  const useFull = useFullResolution(nodeId)
  const status = data.executionStatus ?? "idle"

  const visibleOutputPortId = data.routeSnapshot?.visibleOutputPortId
  const visibleResult = visibleOutputPortId && data.outputResults?.[visibleOutputPortId]
  const generatedResults = (data.generatedResults ?? []) as GeneratedResult[]
  const activeIdx = data.activeResultIndex ?? 0
  const previewUrl = generatedResults[activeIdx]?.url ?? visibleResult

  const progress = data.subWorkflowProgress
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const isImage = typeof previewUrl === "string" && /\.(jpg|jpeg|png|webp|gif)$/i.test(previewUrl)
  const isVideo = typeof previewUrl === "string" && /\.(mp4|webm|mov)$/i.test(previewUrl)
  const isAudio = typeof previewUrl === "string"
    && /\.(mp3|wav|ogg|flac|aac|m4a|webm)$/i.test(previewUrl) && !isVideo

  return (
    <>
      <div>
        {!data.referencedWorkflowId ? (
          <p className="text-sm text-muted-foreground">Select a workflow...</p>
        ) : (
          <p className="text-xs font-medium truncate">{data.referencedWorkflowName || "Unnamed"}</p>
        )}

        {status === "running" && progress && (
          <div className="mt-2">
            <div className="flex flex-col items-center gap-1.5 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{progress.completed}/{progress.total}</span>
              </div>
              <NodeJobProgress progress={data.currentJobProgress} />
            </div>
            <div className="mt-1 h-1 bg-[#2D2D2D] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#ff0073] transition-all duration-300"
                style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}

        {status === "failed" && data.errorMessage && (
          <p className="text-[10px] text-red-400 mt-1 truncate">{data.errorMessage}</p>
        )}

        {status === "completed" && previewUrl && (
          isAudio ? (
            <div className="mt-2">
              <audio src={previewUrl} crossOrigin="anonymous" controls className="w-full h-8" />
            </div>
          ) : (
            <div className="mt-2 cursor-pointer" onClick={() => setLightboxOpen(true)}>
              {isImage ? (
                <CachedImage src={previewUrl} alt="Output"
                  className="w-full h-20 object-cover rounded hover:opacity-80 transition-opacity"
                  thumbnail={!useFull} thumbnailWidth={320} />
              ) : isVideo ? (
                generatedResults[activeIdx]?.thumbnailUrl ? (
                  <CachedImage src={generatedResults[activeIdx]!.thumbnailUrl!} alt="Output"
                    className="w-full h-20 object-cover rounded hover:opacity-80 transition-opacity"
                    thumbnail={!useFull} thumbnailWidth={320} />
                ) : (
                  <video src={previewUrl} crossOrigin="anonymous"
                    className="w-full h-20 object-cover rounded hover:opacity-80 transition-opacity" muted />
                )
              ) : (
                <p className="text-[10px] text-muted-foreground truncate">{previewUrl}</p>
              )}
            </div>
          )
        )}
      </div>

      {lightboxOpen && isImage && (
        <ImageLightbox src={previewUrl as string} onClose={() => setLightboxOpen(false)} />
      )}
      {lightboxOpen && isVideo && (
        <MediaPreviewModal isOpen type="video" url={previewUrl as string} onClose={() => setLightboxOpen(false)} />
      )}
    </>
  )
}
