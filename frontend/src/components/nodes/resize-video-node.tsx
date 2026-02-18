"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Maximize2, Loader2, AlertCircle, X } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/hooks/use-model-credits"
import type { ResizeVideoData } from "@/types/nodes"

function ResizeVideoNodeComponent({ id, data, selected }: NodeProps) {
  // Subscribe to nodes to ensure re-render when node data changes
  const nodes = useWorkflowStore((s) => s.nodes)
  const currentNodeData = nodes.find((n) => n.id === id)?.data as ResizeVideoData | undefined
  const nodeData = currentNodeData ?? (data as ResizeVideoData)
  const credits = useModelCredits("ffmpeg", 0)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) { newActiveIndex = 0 }
    else if (indexToDelete < activeIndex) { newActiveIndex = activeIndex - 1 }
    updateNodeData(id, { generatedResults: newResults, activeResultIndex: newActiveIndex, generatedVideoUrl: newResults[newActiveIndex]?.url })
  }

  return (
    <div className="relative group/run">
    <BaseNode id={id} label={nodeData.label} icon={<Maximize2 className="h-4 w-4" />} category="processing" credits={credits} selected={selected} isRunning={status === "running"}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "video-out", type: "source", position: Position.Right, label: "Video" },
      ]}
    >
      <div className="flex flex-col gap-1">
        {status === "running" && (
          <div className="flex items-center justify-center h-28 rounded-md bg-muted/30"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
        )}
        {status !== "running" && activeUrl && (
          <div className="relative group">
            <video src={activeUrl} className="w-full h-28 object-cover rounded-md cursor-pointer" onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }} autoPlay={videoAutoplay} muted loop={videoAutoplay} playsInline />
            <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">Resized</div>
            {results.length > 0 && (
              <button type="button" className="absolute top-1 right-1 w-5 h-5 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}><X className="w-3 h-3" /></button>
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
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40"><Maximize2 className="w-5 h-5" /></div>
        )}
        {results.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {results.slice(0, 5).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                <video src={r.url} className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`} onClick={(e) => { e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedVideoUrl: r.url }) }} muted playsInline />
                <button type="button" aria-label="Remove" className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(i) }}><X className="w-2.5 h-2.5" /></button>
              </div>
            ))}
          </div>
        )}
        <p className="text-muted-foreground">{nodeData.targetAspect} ({nodeData.method})</p>
      </div>
    </BaseNode>
    <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
    {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="video" url={activeUrl} />}
    <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const ResizeVideoNode = memo(ResizeVideoNodeComponent)
