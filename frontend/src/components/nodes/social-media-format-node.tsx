"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Share2, Loader2, AlertCircle, X, Expand, FileVideo, FileImage, Type, Download, Link } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { HandleIcon } from "./handle-icon"
import { EditableNodeLabel } from "./editable-node-label"
import { PlatformPreview } from "./platform-preview"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/hooks/use-model-credits"
import { isVideoUrl } from "@/lib/media-type"
import { PLATFORM_SPECS, PLATFORM_LABELS } from "@/lib/social-media-specs"
import type { SocialMediaFormatData } from "@/types/nodes"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import type { SocialMediaPlatform } from "@/lib/social-media-specs"

function SocialMediaFormatNodeComponent({ id, data, selected }: NodeProps) {
  const currentNodeData = useWorkflowStore((s) => s.nodes.find((n) => n.id === id)?.data) as SocialMediaFormatData | undefined
  const nodeData = currentNodeData ?? (data as SocialMediaFormatData)
  const credits = useModelCredits("ffmpeg", 1)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl ?? nodeData.generatedImageUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  const spec = PLATFORM_SPECS[nodeData.specKey]
  const specIsVideo = spec?.isVideo !== false
  // Detect actual media type from URL — spec says "can be video" but result might be image
  const urlIsVideo = activeUrl ? isVideoUrl(activeUrl) : specIsVideo
  const platformLabel = PLATFORM_LABELS[nodeData.platform as SocialMediaPlatform] ?? nodeData.platform

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, { ...computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"), generatedImageUrl: undefined })
  }

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    {/* Floating label above node */}
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Share2 className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Share2 className="h-4 w-4" />}
      category="processing"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      minWidth={220}
      minHeight={200}
      hideHeader
      topToolbarContent={
        status !== "running" ? (
          <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
        ) : undefined
      }
      handles={[
        { id: "media-in", type: "target", position: Position.Left, top: "35%", customStyle: { top: '35%', left: '-29px' }, hideHandle: true },
        { id: "text-in", type: "target", position: Position.Left, top: "65%", customStyle: { top: '65%', left: '-29px' }, hideHandle: true },
        { id: "media-out", type: "source", position: Position.Right, top: "35%", customStyle: { top: '35%', right: '-29px' }, hideHandle: true },
        { id: "text-out", type: "source", position: Position.Right, top: "65%", customStyle: { top: '65%', right: '-29px' }, hideHandle: true },
      ]}
    >
      <div className="relative w-full group">
        {/* Running state */}
        {status === "running" && (
          <div className="flex items-center justify-center bg-muted/30 rounded-xl h-[180px]">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          </div>
        )}

        {/* Preview state (idle or has result) */}
        {status !== "running" && status !== "failed" && (
          <>
            <div>
              <PlatformPreview
                platform={(nodeData.platform ?? "instagram") as SocialMediaPlatform}
                specKey={nodeData.specKey}
                mediaUrl={activeUrl}
                isVideo={urlIsVideo}
                caption={nodeData.formattedText}
                size="sm"
              />
            </div>
            {/* Hover overlay buttons */}
            {activeUrl && (
              <>
                <div className="absolute bottom-8 left-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    aria-label="Expand preview"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}
                    title="Fullscreen"
                  >
                    <Expand className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Download"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      const a = document.createElement('a')
                      a.href = '/v1/image-proxy?url=' + encodeURIComponent(activeUrl) + '&download=1'
                      a.download = (nodeData.label || 'video') + '.mp4'
                      a.click()
                    }}
                    title="Download"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Copy URL"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      copyToClipboard(activeUrl, "URL copied")
                    }}
                    title="Copy URL"
                  >
                    <Link className="w-3.5 h-3.5" />
                  </button>
                  <SaveToLibraryButton url={activeUrl} type="video" className="w-7 h-7 rounded-full" />
                </div>
                {results.length > 0 && (
                  <button
                    type="button"
                    aria-label="Remove result"
                    className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}
                    title="Delete this result"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            )}
          </>
        )}

        {/* Failed state */}
        {status === "failed" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-red-500/5 text-red-500 p-2 h-[180px]">
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

        {/* Platform label below preview */}
        <p className="text-[11px] text-muted-foreground text-center mt-1">{platformLabel} — {spec?.label ?? nodeData.contentType}</p>
      </div>
    </BaseNode>

    {/* Input handle icons */}
    <HandleIcon icon={specIsVideo ? <FileVideo /> : <FileImage />} color="steel" side="left" top="35%"  />
    <HandleIcon icon={<Type />} color="steel" side="left" top="65%" />

    {/* Output handle icons */}
    <HandleIcon icon={specIsVideo ? <FileVideo /> : <FileImage />} color="steel" side="right" top="35%" />
    <HandleIcon icon={<Type />} color="steel" side="right" top="65%" />

    {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type={urlIsVideo ? "video" : "image"} url={activeUrl} />}
    <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const SocialMediaFormatNode = memo(SocialMediaFormatNodeComponent)
