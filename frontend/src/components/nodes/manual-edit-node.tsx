"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Scissors, Loader2, AlertCircle, X, Clapperboard, Film } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/hooks/use-model-credits"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { ManualEditData } from "@/types/nodes"

function ManualEditNodeComponent({ id, data, selected }: NodeProps) {
  const currentNodeData = useWorkflowStore((s) => s.nodes.find((n) => n.id === id)?.data) as ManualEditData | undefined
  const nodeData = currentNodeData ?? (data as ManualEditData)
  const credits = useModelCredits("ffmpeg", 1)
  const useFull = useFullResolution(id)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const activeThumbnail = activeResult?.thumbnailUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [videoError, setVideoError] = useState(false)

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedVideoUrl"))
  }

  function handleOpenEditor(e: React.MouseEvent) {
    e.stopPropagation()
    updateNodeData(id, { isEditorOpen: true })
  }

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
      <EditableNodeLabel label={nodeData.label} icon={<Scissors className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
    <BaseNode id={id} label={nodeData.label} icon={<Scissors className="h-4 w-4" />} category="processing" credits={credits} selected={selected} isRunning={status === "running"}
      hideHeader
      minWidth={220}
      topToolbarContent={(<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />)}
      handles={[
        { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
        { id: "video-out", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
      ]}
    >
      <div className="flex flex-col gap-1">
        {status === "running" && (
          <div className="flex items-center justify-center h-28 rounded-md bg-muted/30"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        )}
        {status === "awaiting-user" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-2 h-28 rounded-md bg-amber-500/10 border-2 border-amber-500/40 animate-pulse">
            <Scissors className="w-6 h-6 text-amber-500" />
            <span className="text-xs font-medium text-amber-500">Awaiting Edit</span>
            <button
              type="button"
              onClick={handleOpenEditor}
              className="px-3 py-1 text-xs font-medium rounded-md bg-amber-500 text-white hover:bg-amber-600 transition-colors"
            >
              Open Editor
            </button>
          </div>
        )}
        {status !== "running" && status !== "awaiting-user" && activeUrl && !videoError && (
          <div className="relative group">
            {activeThumbnail ? (
              <CachedImage
                src={activeThumbnail}
                alt="Video preview"
                className="w-full h-28 object-cover rounded-md"
                thumbnail={!useFull}
                thumbnailWidth={320}
              />
            ) : (
              <video
                src={activeUrl}
                crossOrigin="anonymous"
                className="w-full h-28 object-cover rounded-md bg-black"
                autoPlay={videoAutoplay}
                muted
                loop={videoAutoplay}
                playsInline
                onError={() => setVideoError(true)}
                onLoadedData={() => setVideoError(false)}
              />
            )}
            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">Edited</div>
            {results.length > 0 && (
              <button type="button" aria-label="Remove" className="absolute top-1 right-1 w-6 h-6 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}><X className="w-3 h-3" /></button>
            )}
          </div>
        )}
        {status !== "running" && status !== "awaiting-user" && activeUrl && videoError && (
          <div className="relative group">
            <div className="w-full h-28 rounded-md bg-amber-500/10 border border-amber-500/30 flex flex-col items-center justify-center gap-1">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              <span className="text-[10px] text-amber-500">Video load failed</span>
              <a href={activeUrl} target="_blank" rel="noopener noreferrer" className="text-[9px] text-blue-500 underline" onClick={(e) => e.stopPropagation()}>Open URL</a>
            </div>
            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">Edited</div>
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
        {status !== "running" && status !== "awaiting-user" && !activeUrl && status !== "failed" && (
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40"><Scissors className="w-5 h-5" /></div>
        )}
        {results.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {results.slice(0, 5).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                {r.thumbnailUrl ? (
                  <CachedImage src={r.thumbnailUrl} alt="" className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`} thumbnail thumbnailWidth={80} onClick={(e) => { e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url }) }} />
                ) : (
                  <video src={r.url} crossOrigin="anonymous" className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`} onClick={(e) => { e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url }) }} muted playsInline />
                )}
                <button type="button" aria-label="Remove" className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(i) }}><X className="w-2.5 h-2.5" /></button>
              </div>
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-xs">Manual video editing</p>
      </div>
    </BaseNode>
    <HandleIcon icon={<Clapperboard />} color="steel" side="left" top="calc(100% - 20px)" />
    <HandleIcon icon={<Film />} color="steel" top="20px" />
    {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="video" url={activeUrl} results={results} initialIndex={activeIndex} />}
    <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const ManualEditNode = memo(ManualEditNodeComponent)
