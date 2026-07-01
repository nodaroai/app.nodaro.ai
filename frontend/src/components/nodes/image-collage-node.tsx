"use client"

import { memo, useState, useCallback } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import {
  LayoutGrid,
  Loader2,
  AlertCircle,
  X,
  Image as ImageIcon,
  Expand,
  Pencil,
  Download,
  Link,
  Images,
} from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { isValidImageCollageConnection } from "@/lib/image-producer-handles"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { ResultsThumbnailsPanel } from "./results-thumbnails-panel"
import { imageNodeSizing } from "./video-node-defaults"
import { useUpstreamImageAspect } from "@/hooks/use-upstream-image-aspect"
import { NodeQuickStrip } from "./node-quick-strip"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { EditableNodeLabel } from "./editable-node-label"
import { ImageCollageResultInfo } from "./image-collage-result-info"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import type { ImageCollageData, GeneratedResult } from "@/types/nodes"

const ACCEPTS_IMAGE = (t: string) => isValidImageCollageConnection("in", t)

function ImageCollageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageCollageData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const openImageEdit = useWorkflowStore((s) => s.openImageEdit)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)

  const status = nodeData.executionStatus ?? "idle"
  const results: ReadonlyArray<GeneratedResult> = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedImageUrl

  const credits = useModelCredits("image-collage", 2)

  const [previewOpen, setPreviewOpen] = useState(false)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [aspectRatio, setAspectRatio] = useState<number | undefined>(undefined)
  const upstreamImageAspect = useUpstreamImageAspect(id)

  const handleLoadDimensions = useCallback((dim: { width: number; height: number }) => {
    if (dim.width > 0 && dim.height > 0) setAspectRatio(dim.width / dim.height)
  }, [])

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedImageUrl"))
  }

  const hasResult = status !== "running" && !!activeUrl
  const canBrowseAlternates = !!activeUrl && results.length > 1

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<LayoutGrid className="w-3.5 h-3.5" />}
        onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<LayoutGrid className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        {...imageNodeSizing(aspectRatio, upstreamImageAspect)}
        hideHeader
        topToolbarContent={
          <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />
        }
        bottomToolbarContent={
          showThumbnails && canBrowseAlternates ? (
            <ResultsThumbnailsPanel
              results={results}
              activeIndex={activeIndex}
              nodeSelected={!!selected || isSettingsOpen}
              mediaType="image"
              onSelect={(i) => updateNodeData(id, { activeResultIndex: i, generatedImageUrl: results[i].url })}
              onDelete={(i) => setDeleteConfirm(i)}
            />
          ) : undefined
        }
        handles={[
          { id: "in", type: "target", position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          { id: "image", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
        ]}
      >
        <div className="relative w-full h-full group/collage flex flex-col">
          <div className="relative flex-1 min-h-0">
            {status === "running" && (
              <div className="flex flex-col items-center justify-center gap-2 bg-muted/30 rounded-xl w-full h-full min-h-[120px]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress} />
              </div>
            )}

            {status !== "running" && !hasResult && status !== "failed" && (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/10 text-muted-foreground/40 h-[160px] px-3 text-center">
                <Images className="w-10 h-10" />
                <span className="text-[10px] leading-tight">
                  Connect 2+ images to arrange them into a collage
                </span>
              </div>
            )}

            {status === "failed" && !hasResult && (
              <div className="flex flex-col items-center justify-center gap-1 rounded-xl bg-red-500/5 text-red-500 h-[160px] p-2">
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

            {status !== "running" && hasResult && activeUrl && (
              <>
                {/* Versions toggle — brand-pink + pinned when open, else hover-revealed (matches Generate Image). */}
                {results.length > 1 && (
                  <button
                    type="button"
                    className={`absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 backdrop-blur-sm border rounded-md z-10 transition-opacity ${
                      showThumbnails
                        ? "bg-[#ff0073] hover:bg-[#ff0073]/90 border-[#ff0073] text-white opacity-100"
                        : "bg-black/40 hover:bg-black/60 border-white/10 text-white opacity-0 group-hover/collage:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowThumbnails((v) => !v)
                    }}
                    title={showThumbnails ? "Hide versions" : "Show versions"}
                    aria-pressed={showThumbnails}
                  >
                    <LayoutGrid className="w-3 h-3" />
                    <span className="text-[11px] font-medium">{results.length}</span>
                  </button>
                )}

                <CachedImage
                  src={activeUrl}
                  alt="Collage"
                  className="w-full h-full object-contain rounded-xl bg-black/20"
                  thumbnail
                  thumbnailWidth={640}
                  onLoadDimensions={handleLoadDimensions}
                />

                {/* Top-right: delete this result. */}
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/collage:opacity-100 transition-opacity">
                  {results.length > 0 && (
                    <button
                      type="button"
                      aria-label="Remove result"
                      className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteConfirm(activeIndex)
                      }}
                      title="Delete this result"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Bottom-left: Edit · Expand · Download · Copy URL (matches Generate Image, minus i2i-specific Refine/Extract). */}
                <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/collage:opacity-100 transition-opacity">
                  <button
                    type="button"
                    aria-label="Edit image"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      openImageEdit(id, activeUrl!, activeResult?.filerobotDesignStateUrl)
                    }}
                    title="Edit image"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Expand preview"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPreviewOpen(true)
                    }}
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
                      const a = document.createElement("a")
                      a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`
                      a.download = `${nodeData.label || "collage"}.png`
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
                      copyToClipboard(activeUrl!, "URL copied")
                    }}
                    title="Copy URL"
                  >
                    <Link className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Bottom-right: settings badge (Layout · Aspect · Resolution + apply). Pinned while the versions panel is open. */}
                <div className={`absolute bottom-2 right-2 transition-opacity ${showThumbnails ? "opacity-100" : "opacity-0 group-hover/collage:opacity-100"}`}>
                  <ImageCollageResultInfo nodeId={id} result={activeResult} data={nodeData} />
                </div>
              </>
            )}
          </div>
        </div>
      </BaseNode>

      <HandleWithPopover nodeId={id} nodeType="image-collage" handleId="in"    type="target" position={Position.Left}  label="Image" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="left"  top="calc(100% - 24px)" orderMatters accepts={ACCEPTS_IMAGE} />
      <HandleWithPopover nodeId={id} nodeType="image-collage" handleId="image" type="source" position={Position.Right} label="Image" color={HANDLE_COLORS.image} icon={<ImageIcon />} side="right" top="24px" />

      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm !== null) handleDeleteResult(deleteConfirm)
        }}
      />

      {activeUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="image"
          url={activeUrl}
          results={results.map((r) => ({ url: r.url }))}
          initialIndex={activeIndex}
        />
      )}
    </div>
  )
}

export const ImageCollageNode = memo(ImageCollageNodeComponent)
