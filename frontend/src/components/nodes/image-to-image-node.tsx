"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ImageIcon, Loader2, AlertCircle, X, Settings, LayoutGrid, Expand, Download, Link, Layers, Pencil, Aperture } from "lucide-react"
import { HandleIcon } from "./handle-icon"
import { computeDeleteResultUpdates, copyToClipboard } from "@/lib/utils"
import { NodeJobProgress } from "./node-job-progress"
import { BaseNode } from "./base-node"
import { RunNodeButton } from "./run-node-button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useConnectionCount } from "@/hooks/use-connection-count"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { CachedImage } from "@/components/ui/cached-image"
import { useFullResolution } from "@/hooks/use-full-resolution"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { buildCreditModelIdentifier } from "@/components/editor/config-panels/helpers"
import { EditableNodeLabel } from "./editable-node-label"
import { I2I_MASK_SUPPORT } from "@nodaro/shared"
import type { ImageToImageData } from "@/types/nodes"

function ImageToImageNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageToImageData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const isSettingsOpen = useWorkflowStore((s) => s.selectedNodeId === id)
  const openImageEdit = useWorkflowStore((s) => s.openImageEdit)
  const inConnectionCount = useConnectionCount(id, "image")
  const supportsMask = !!nodeData.provider && I2I_MASK_SUPPORT.has(nodeData.provider)
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
  const useFull = useFullResolution(id)
  const { aspectRatio: imgAspectRatio, onLoadDimensions: handleLoadDimensions } =
    useResultAspectRatio(id, results, activeIndex)

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedImageUrl"))
  }

  return (
    <div className="relative" style={{ width: "100%", height: "100%" }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<ImageIcon className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<ImageIcon className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      minWidth={200}
      minHeight={imgAspectRatio ? Math.round(200 / imgAspectRatio) : 150}
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
                  thumbnail
                  thumbnailWidth={128}
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
      topToolbarContent={
                  <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
      }
      handles={[
        { id: "image", type: "target", position: Position.Left, top: "calc(100% - 20px)", customStyle: { top: 'calc(100% - 20px)', left: '-29px' }, hideHandle: true },
        ...(supportsMask ? [{ id: "mask", type: "target" as const, position: Position.Left, customStyle: { top: 'calc(100% - 50px)', left: '-29px' }, hideHandle: true }] : []),
        { id: "cinematography", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 80px)', left: '-29px' }, hideHandle: true },
        { id: "out", type: "source", position: Position.Right, customStyle: { top: '20px', right: '-29px' }, hideHandle: true },
      ]}
      imageAspectRatio={imgAspectRatio}
    >
      <div className="relative w-full h-full group">
        {/* Image fills entire node */}
        {activeUrl && status !== "running" && (
          <CachedImage
            src={activeUrl}
            alt="Result"
            className="w-full h-full object-cover rounded-xl"
            thumbnail={!useFull}
            thumbnailWidth={320}
            onLoadDimensions={handleLoadDimensions}
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
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/10" style={{ minHeight: 180 }}>
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground/40" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
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
        {results.length > 1 && (
          <button
            type="button"
            className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md z-10 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}
            title="Show versions"
          >
            <LayoutGrid className="w-3 h-3" />
            <span className="text-[11px] font-medium">{results.length}</span>
          </button>
        )}

        {/* Top-right: delete */}
        {activeUrl && (
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {results.length > 0 && (
              <button type="button" aria-label="Remove result" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
                onClick={(e) => { e.stopPropagation(); setDeleteConfirm(activeIndex) }} title="Delete this result">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Bottom-left: edit + fullscreen + download + copy URL */}
        {activeUrl && (
          <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" aria-label="Edit image" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => { e.stopPropagation(); openImageEdit(id, activeUrl!, activeResult?.filerobotDesignStateUrl) }} title="Edit image">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button type="button" aria-label="Expand preview" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => { e.stopPropagation(); setPreviewOpen(true) }} title="Fullscreen">
              <Expand className="w-3.5 h-3.5" />
            </button>
            <button type="button" aria-label="Download" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = `/v1/image-proxy?url=${encodeURIComponent(activeUrl!)}&download=1`; a.download = `${nodeData.label || 'image'}.png`; a.click() }} title="Download">
              <Download className="w-3.5 h-3.5" />
            </button>
            <button type="button" aria-label="Copy URL" className="w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"
              onClick={(e) => { e.stopPropagation(); copyToClipboard(activeUrl!, "URL copied") }} title="Copy URL">
              <Link className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Bottom-right: settings */}
        {activeUrl && (
          <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button type="button" aria-label="Settings" className={`w-7 h-7 flex items-center justify-center bg-black/50 hover:bg-black/70 border border-white/10 text-white rounded-full shadow-sm${isSettingsOpen ? " ring-1 ring-white/30" : ""}`}
              onClick={(e) => { e.stopPropagation(); selectNode(isSettingsOpen ? null : id) }} title="Settings">
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </BaseNode>
    {/* Input handle icon (TYPE 1) */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073]"
      style={{ top: 'calc(100% - 20px)', left: '-29px', transform: 'translateY(-50%)' }}
    >
      <ImageIcon className="w-3.5 h-3.5 text-white" />
      <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#ff0073] text-[#ff0073] text-[8px] font-black flex items-center justify-center">+</div>
      {inConnectionCount >= 2 && (
        <div className="absolute top-1/2 -translate-y-1/2 -right-[9px] w-[13px] h-[13px] rounded-full bg-white text-[#ff0073] text-[8px] font-black flex items-center justify-center">
          {inConnectionCount}
        </div>
      )}
    </div>
    {/* Mask handle icon */}
    {supportsMask && (
      <div
        className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#a855f7]"
        style={{ top: 'calc(100% - 50px)', left: '-29px', transform: 'translateY(-50%)' }}
      >
        <Layers className="w-3.5 h-3.5 text-white" />
        <div className="absolute top-1/2 -translate-y-1/2 -left-[9px] w-[12px] h-[12px] rounded-full bg-[#111827] border border-[#a855f7] text-[#a855f7] text-[8px] font-black flex items-center justify-center">+</div>
      </div>
    )}
    {/* Cinematography input handle icon */}
    <HandleIcon icon={<Aperture />} color="indigo" side="left" top="calc(100% - 80px)" label="Cinematography" />
    {/* Output handle icon */}
    <div
      className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30"
      style={{ top: '20px', right: '-29px', transform: 'translateY(-50%)' }}
    >
      <ImageIcon className="w-3.5 h-3.5 text-white" />
    </div>
    {activeUrl && (
      <MediaPreviewModal
        isOpen={previewOpen}
        onClose={() => setPreviewOpen(false)}
        type="image"
        url={activeUrl}
        results={results}
        initialIndex={activeIndex}
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
