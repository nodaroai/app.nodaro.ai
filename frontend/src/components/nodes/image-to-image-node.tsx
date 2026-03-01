"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ImageIcon, Loader2, AlertCircle, X, Settings, LayoutGrid, Expand, Download } from "lucide-react"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { SaveToLibraryButton } from "@/components/editor/save-to-library-button"
import { CachedImage } from "@/components/ui/cached-image"
import { useModelCredits } from "@/hooks/use-model-credits"
import { buildCreditModelIdentifier } from "@/components/editor/config-panels/helpers"
import type { ImageToImageData } from "@/types/nodes"

function ImageToImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageToImageData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const rawUrl = activeResult?.url ?? nodeData.generatedImageUrl
  const activeUrl = rawUrl && rawUrl.trim() ? rawUrl : undefined
  const [previewOpen, setPreviewOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const creditModelId = buildCreditModelIdentifier(
    nodeData.provider ?? "nano-banana",
    nodeData as unknown as Record<string, unknown>,
  )
  const credits = useModelCredits(creditModelId, 1)

  function handleDeleteResult(indexToDelete: number) {
    const newResults = results.filter((_, i) => i !== indexToDelete)
    let newActiveIndex = activeIndex
    if (indexToDelete === activeIndex) {
      newActiveIndex = 0
    } else if (indexToDelete < activeIndex) {
      newActiveIndex = activeIndex - 1
    }
    updateNodeData(id, {
      generatedResults: newResults,
      activeResultIndex: newActiveIndex,
      generatedImageUrl: newResults[newActiveIndex]?.url,
    })
  }

  return (
    <div className="relative">
    {/* Floating label above node */}
    <div className="absolute -top-6 left-0 flex items-center gap-1.5 text-[12px] font-medium text-white/70 pointer-events-none select-none">
      <ImageIcon className="w-3.5 h-3.5" />
      <span className="truncate">{nodeData.label}</span>
    </div>
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<ImageIcon className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      hideHeader
      bottomToolbarContent={
        showThumbnails && results.length > 1 ? (
          <div className="flex gap-2 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
            {results.slice(0, 8).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                <CachedImage
                  src={r.url}
                  alt={`Result ${i + 1}`}
                  className={`w-16 h-16 object-cover rounded-lg cursor-pointer transition-all ${
                    i === activeIndex ? "ring-2 ring-[#ff0073]" : "opacity-60 hover:opacity-100"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    updateNodeData(id, { activeResultIndex: i, generatedImageUrl: r.url })
                  }}
                />
              </div>
            ))}
          </div>
        ) : undefined
      }
      toolbarActions={
        status !== "running" ? (
          <RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />
        ) : undefined
      }
      handles={[
        { id: "image", type: "target", position: Position.Left, top: "calc(75% + 33px)", customStyle: { top: 'calc(75% + 33px)', left: '-3px' } },
        { id: "out", type: "source", position: Position.Right, customStyle: { top: 'calc(25% - 33px)', right: '-29px' }, hideHandle: true },
      ]}
    >
      <div className="relative w-full group" style={{ minHeight: 180 }}>
        {/* Image fills entire node */}
        {activeUrl && status !== "running" && (
          <CachedImage
            src={activeUrl}
            alt="Result"
            className="w-full h-full object-cover rounded-xl cursor-pointer"
            style={{ minHeight: 180 }}
            onClick={() => selectNode(id)}
          />
        )}

        {/* Empty state */}
        {!activeUrl && status !== "running" && status !== "failed" && (
          <div className="flex items-center justify-center rounded-xl bg-muted/10 text-muted-foreground/40" style={{ minHeight: 180 }}>
            <ImageIcon className="w-10 h-10" />
          </div>
        )}

        {/* Running state */}
        {status === "running" && (
          <div className="flex items-center justify-center rounded-xl bg-muted/10" style={{ minHeight: 180 }}>
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/40" />
          </div>
        )}

        {/* Failed state */}
        {status === "failed" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-red-500/5 text-red-500" style={{ minHeight: 180 }}>
            <AlertCircle className="w-6 h-6" />
            {nodeData.errorMessage && <p className="text-[10px] text-center text-red-400 px-2 line-clamp-2">{nodeData.errorMessage}</p>}
          </div>
        )}

        {/* Top-left: version badge */}
        {results.length > 0 && (
          <button
            type="button"
            className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}
          >
            <LayoutGrid className="w-3 h-3" />
            <span>{results.length}</span>
          </button>
        )}

        {/* Top-right: action buttons */}
        {activeUrl && (
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Bottom-left: fullscreen + settings + download */}
        {activeUrl && (
          <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }}>
              <Expand className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => { e.stopPropagation(); selectNode(id) }}>
              <Settings className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`; a.download = `${nodeData.label || 'image'}.png`; a.click() }}>
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Bottom-right: save to library */}
        {activeUrl && (
          <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <SaveToLibraryButton url={activeUrl} type="image" className="bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full" />
          </div>
        )}
      </div>
    </BaseNode>
    {/* Output handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
      style={{ top: 'calc(25% - 47px)', right: '-29px' }}
    >
      <ImageIcon className="w-3.5 h-3.5 text-white" />
    </div>
    {activeUrl && (
      <MediaPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        type="image"
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

export const ImageToImageNode = memo(ImageToImageNodeComponent)
