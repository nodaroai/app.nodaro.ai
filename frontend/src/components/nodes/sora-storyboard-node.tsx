"use client"

import { memo, useState, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Clapperboard, Loader2, AlertCircle, X, Image as ImageIcon, LayoutGrid, Expand, Download } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { useModelCredits } from "@/hooks/use-model-credits"
import { CachedImage } from "@/components/ui/cached-image"
import { useCanvasZoom } from "@/components/editor/canvas-zoom-context"
import { EditableNodeLabel } from "./editable-node-label"
import type { SoraStoryboardData, GeneratedResult } from "@/types/nodes"

function SoraStoryboardNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SoraStoryboardData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const edges = useWorkflowStore((s) => s.edges)
  const nodes = useWorkflowStore((s) => s.nodes)

  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const activeThumbnail = activeResult?.thumbnailUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showThumbnails, setShowThumbnails] = useState(false)

  const nFrames = nodeData.nFrames ?? "10"
  const creditModelId = nFrames === "10" ? "sora-storyboard" : "sora-storyboard:15"
  const defaultCost = nFrames === "10" ? 47 : 85
  const credits = useModelCredits(creditModelId, defaultCost)
  const { zoom } = useCanvasZoom()
  const useFull = zoom >= 0.8

  const shotCount = nodeData.shots?.length ?? 0

  // Check for connected image inputs
  const hasImageConnection = useMemo(() => {
    return edges.some((e) => {
      if (e.target !== id) return false
      const srcNode = nodes.find((n) => n.id === e.source)
      if (!srcNode) return false
      const t = String(srcNode.type ?? "")
      return ["generate-image", "upload-image", "scene", "character", "object", "location", "face", "image-to-image", "edit-image"].includes(t)
    })
  }, [edges, nodes, id])

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) newActiveIndex = 0
    else if (indexToDelete < activeIndex) newActiveIndex = activeIndex - 1
    updateNodeData(id, {
      generatedResults: newResults,
      activeResultIndex: newActiveIndex,
      generatedVideoUrl: newResults[newActiveIndex]?.url,
    })
  }

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Clapperboard className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />

    <div style={{ width: '85%' }}>
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Clapperboard className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      hideHeader
      bottomToolbarContent={
        showThumbnails && results.length > 1 ? (
          <div className="flex gap-2 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
            {results.slice(0, 8).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative shrink-0">
                {r.thumbnailUrl ? (
                  <CachedImage
                    src={r.thumbnailUrl}
                    alt={`Result ${i + 1}`}
                    className={`w-16 h-16 object-cover rounded-lg cursor-pointer transition-all ${
                      i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                    }}
                  />
                ) : (
                  <video
                    src={r.url}
                    className={`w-16 h-16 object-cover rounded-lg cursor-pointer transition-all ${
                      i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url })
                    }}
                    muted
                    playsInline
                  />
                )}
              </div>
            ))}
          </div>
        ) : undefined
      }
      topToolbarContent={
        status !== "running" ? (
          <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
        ) : undefined
      }
      handles={[
        { id: "image", type: "target", position: Position.Left, customStyle: { top: '35%', left: '-29px' }, hideHandle: true },
        { id: "video", type: "source", position: Position.Right, customStyle: { top: 'calc(35% - 33px)', right: '-29px' }, hideHandle: true },
      ]}
    >
      <div className="flex flex-col gap-2" style={{ minHeight: 180 }}>
        {/* Shot count badge */}
        {!activeUrl && status !== "running" && status !== "failed" && (
          <div className="flex flex-col items-center justify-center gap-1 py-4 text-muted-foreground/60">
            <Clapperboard className="w-8 h-8" />
            <span className="text-[10px] text-center">
              {shotCount} shot{shotCount !== 1 ? "s" : ""} configured
            </span>
            {hasImageConnection && (
              <div className="flex items-center gap-1.5 mt-1">
                <ImageIcon className="w-3 h-3 text-green-400" />
                <span className="text-[10px]">Image connected</span>
              </div>
            )}
          </div>
        )}

        {/* Video Preview / Loading / Error States */}
        <div className="relative w-full group/video" style={{ minHeight: activeUrl || status === "running" || status === "failed" ? 180 : undefined }}>
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/10" style={{ minHeight: 180 }}>
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/40" />
            </div>
          )}

          {status !== "running" && activeUrl && (
            <>
              {activeThumbnail ? (
                <CachedImage
                  src={activeThumbnail}
                  alt="Video preview"
                  className="w-full h-full object-cover rounded-xl"
                  style={{ minHeight: 180 }}
                  thumbnail={!useFull}
                  thumbnailWidth={320}
                />
              ) : (
                <video
                  src={activeUrl}
                  className="w-full object-cover rounded-xl"
                  style={{ minHeight: 180 }}
                  autoPlay={videoAutoplay}
                  muted
                  loop={videoAutoplay}
                  playsInline
                />
              )}

              <span className="absolute top-2 right-10 text-[10px] text-white/70 bg-black/50 backdrop-blur-sm px-1.5 py-0.5 rounded opacity-0 group-hover/video:opacity-100 transition-opacity">
                Sora 2 Pro Storyboard
              </span>

              {results.length > 0 && (
                <button
                  type="button"
                  className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md opacity-0 group-hover/video:opacity-100 transition-opacity"
                  onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}
                >
                  <LayoutGrid className="w-3 h-3" />
                  <span>{results.length}</span>
                </button>
              )}

              {results.length > 0 && (
                <div className="absolute top-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
                  <button
                    type="button"
                    className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                    onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <button
                  type="button"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}
                >
                  <Expand className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                  onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`; a.download = `${nodeData.label || 'storyboard'}.mp4`; a.click() }}
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="absolute bottom-2 right-2 opacity-0 group-hover/video:opacity-100 transition-opacity">
                <SaveToLibraryButton url={activeUrl} type="video" />
              </div>
            </>
          )}

          {status === "failed" && !activeUrl && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-red-500/5 text-red-500" style={{ minHeight: 180 }}>
              <AlertCircle className="w-6 h-6" />
              {nodeData.errorMessage && (
                <p className="text-[10px] text-center text-red-400 px-2 line-clamp-2">{nodeData.errorMessage}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </BaseNode>
    </div>

    {/* image input handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: 'calc(35% - 14px)', left: '-29px' }}
    >
      <ImageIcon className="w-3.5 h-3.5 text-white" />
    </div>

    {/* video output handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: 'calc(25% - 47px)', right: '-29px' }}
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

export const SoraStoryboardNode = memo(SoraStoryboardNodeComponent)
