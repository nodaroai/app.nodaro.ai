"use client"

import { memo, useState, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Frame, Loader2, AlertCircle, X, Clapperboard, ImageIcon, Expand, Download, Link } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleIcon } from "./handle-icon"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { CachedImage } from "@/components/ui/cached-image"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import type { ExtractFrameData } from "@/types/nodes"

function ExtractFrameNodeComponent({ id, data, selected }: NodeProps) {
  const currentNodeData = useWorkflowStore((s) => s.nodes.find((n) => n.id === id)?.data) as ExtractFrameData | undefined
  const nodeData = currentNodeData ?? (data as ExtractFrameData)
  const credits = useModelCredits("ffmpeg", 1)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedImageUrl
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [imgError, setImgError] = useState(false)

  useEffect(() => { setImgError(false) }, [activeUrl])

  const hasResult = status !== "running" && !!activeUrl && !imgError

  const modeLabel = nodeData.mode === "last" ? "Last frame" : nodeData.mode === "timestamp" ? `@ ${nodeData.timestamp ?? 0}s` : "First frame"

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedImageUrl"))
  }

  return (
    <div className="relative group/node" style={{ width: 220 }}>
      <EditableNodeLabel label={nodeData.label} icon={<Frame className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode id={id} label={nodeData.label} icon={<Frame className="h-4 w-4" />} category="processing" credits={credits} selected={selected} isRunning={status === "running"}
        hideHeader minWidth={220}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />}
        handles={[
          { id: "in", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
          { id: "image", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
        ]}
      >
        <div className="flex flex-col gap-1">
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 h-28 rounded-md bg-muted/30">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {hasResult && (
            <div className="relative group">
              <CachedImage src={activeUrl!} alt="Extracted frame" className="w-full rounded-md object-cover" thumbnail thumbnailWidth={320} onError={() => setImgError(true)} />
              <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] px-1 rounded">{modeLabel}</div>
              <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" aria-label="Expand" className="w-6 h-6 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white rounded-full" onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}><Expand className="w-3 h-3" /></button>
                <button type="button" aria-label="Download" className="w-6 h-6 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white rounded-full" onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`; a.download = `${nodeData.label || 'frame'}.png`; a.click() }}><Download className="w-3 h-3" /></button>
                <button type="button" aria-label="Copy URL" className="w-6 h-6 flex items-center justify-center bg-black/60 hover:bg-black/80 text-white rounded-full" onClick={(e) => { e.stopPropagation(); copyToClipboard(activeUrl!, "URL copied") }}><Link className="w-3 h-3" /></button>
                {results.length > 0 && (
                  <button type="button" aria-label="Remove" className="w-6 h-6 flex items-center justify-center bg-red-500/80 hover:bg-red-500 text-white rounded-full" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}><X className="w-3 h-3" /></button>
                )}
              </div>
            </div>
          )}

          {status !== "running" && activeUrl && imgError && (
            <div className="w-full h-28 rounded-md bg-amber-500/10 border border-amber-500/30 flex flex-col items-center justify-center gap-1">
              <AlertCircle className="w-5 h-5 text-amber-500" />
              <span className="text-[10px] text-amber-500">Image load failed</span>
            </div>
          )}

          {status === "failed" && !activeUrl && (
            <div className="flex flex-col items-center justify-center gap-1 h-16 rounded-md bg-red-500/5 text-red-500 p-2">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span className="font-medium">Failed</span>
              </div>
              {nodeData.errorMessage && <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>{nodeData.errorMessage}</p>}
            </div>
          )}

          {status !== "running" && !activeUrl && status !== "failed" && (
            <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <Frame className="w-5 h-5" />
            </div>
          )}

          {results.length > 1 && (
            <div className="flex gap-1 overflow-x-auto">
              {results.slice(0, 5).map((r, i) => (
                <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                  <CachedImage src={r.url} alt="" className={`w-10 h-10 object-cover rounded cursor-pointer transition-opacity ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`} thumbnail thumbnailWidth={80} onClick={(e) => { e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedImageUrl: r.url }) }} />
                  <button type="button" aria-label="Remove" className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(i) }}><X className="w-2.5 h-2.5" /></button>
                </div>
              ))}
            </div>
          )}

          {!hasResult && <p className="text-muted-foreground text-xs">{modeLabel}</p>}
        </div>
      </BaseNode>

      <HandleIcon icon={<Clapperboard />} color="steel" side="left" top="calc(100% - 20px)" />
      <HandleIcon icon={<ImageIcon />} color="steel" top="20px" />
      {activeUrl && <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="image" url={activeUrl} results={results} initialIndex={activeIndex} />}
      <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    </div>
  )
}

export const ExtractFrameNode = memo(ExtractFrameNodeComponent)
