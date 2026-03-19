"use client"

import { memo, useState } from "react"
import { Position, type NodeProps, NodeResizer, Handle } from "@xyflow/react"
import { ArrowRight, Loader2, AlertCircle, Volume2, LayoutGrid } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { computeDeleteResultUpdates } from "@/lib/utils"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/hooks/use-model-credits"
import { AudioResultOverlay } from "./audio-result-overlay"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import type { SunoUploadExtendData } from "@/types/nodes"

function SunoUploadExtendNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SunoUploadExtendData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedAudioUrl
  const credits = useModelCredits("suno-upload-extend", 4)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedAudioUrl"))
  }

  return (
    <div className="relative" style={{ width: 220, minHeight: 220, overflow: 'visible' }}>
    <NodeResizer isVisible={!!selected} minWidth={180} minHeight={180} lineClassName="!border-[#ff0073]" handleClassName="!w-2.5 !h-2.5 !bg-[#ff0073] !border-none !rounded-sm" />
    <EditableNodeLabel label={nodeData.label} icon={<ArrowRight className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<ArrowRight className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      hideHeader
      topToolbarContent={status !== "running" ? (<RunNodeButton nodeId={id} credits={credits} isRunning={false} onRun={(nid) => runSingleNode?.(nid)} />) : undefined}
      bottomToolbarContent={
        showThumbnails && results.length > 1 ? (
          <div className="flex gap-2 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
            {results.slice(0, 8).map((r, i) => (
              <button
                key={`${r.jobId}-${i}`}
                type="button"
                aria-label={`Result ${i + 1}`}
                className={`w-10 h-10 flex items-center justify-center rounded-lg cursor-pointer transition-all ${
                  i === activeIndex
                    ? "ring-2 ring-[#ff0073] bg-[#ff0073]/20"
                    : "opacity-50 hover:opacity-80 bg-white/10"
                }`}
                onClick={(e) => {
                  e.stopPropagation()
                  updateNodeData(id, { activeResultIndex: i, generatedAudioUrl: r.url })
                }}
              >
                <Volume2 className="w-4 h-4 text-white" />
              </button>
            ))}
          </div>
        ) : undefined
      }
      handles={[]}
    >
      <div className="flex flex-col gap-2 p-3" style={{ minHeight: 180 }}>
        {status === "running" && !activeUrl && (<div className="flex flex-col items-center justify-center gap-2 h-12 rounded-md bg-muted/30"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} /></div>)}
        {activeUrl && results.length > 0 && (
          <div className="flex justify-end px-3">
            <button
              type="button"
              className="flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md"
              onClick={(e) => { e.stopPropagation(); setShowThumbnails(v => !v) }}
            >
              <LayoutGrid className="w-3 h-3" />
              <span>{results.length}</span>
            </button>
          </div>
        )}
        {activeUrl && (<div className="px-3 py-2"><AudioResultOverlay url={activeUrl} label={nodeData.label} hasResults={results.length > 0} onExpand={() => setPreviewOpen(true)} onDelete={() => setDeleteConfirm(activeIndex)} /></div>)}
        {status === "failed" && !activeUrl && (<div className="flex flex-col items-center justify-center gap-1 h-12 rounded-md bg-red-500/5 text-red-500 p-2"><div className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4 shrink-0" /><span className="font-medium">Failed</span></div>{nodeData.errorMessage && (<p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>{nodeData.errorMessage}</p>)}</div>)}
        {status !== "running" && !activeUrl && status !== "failed" && (<div className="flex items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40" style={{ minHeight: 120, flex: 1 }}><ArrowRight className="w-5 h-5" /></div>)}
        <span className="text-xs text-muted-foreground">Upload Extend</span>
      </div>
    </BaseNode>
    <Handle id="audio" type="target" position={Position.Left} className="!w-7 !h-7 !bg-transparent !border-0 !opacity-0 touch-manipulation" style={{ top: '155px', left: '-29px', transform: 'none' }} />
    <Handle id="audio-out" type="source" position={Position.Right} className="!w-7 !h-7 !bg-transparent !border-0 !opacity-0 touch-manipulation" style={{ top: '50px', right: '-29px', transform: 'none', left: 'auto' }} />
    <div className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30" style={{ top: '155px', left: '-29px' }}><Volume2 className="w-3.5 h-3.5 text-white" /></div>
    <div className="absolute pointer-events-none z-20 flex items-center justify-center w-7 h-7 rounded-full bg-[#ff0073] shadow-lg shadow-pink-500/30" style={{ top: '50px', right: '-29px' }}><ArrowRight className="w-3.5 h-3.5 text-white" /></div>
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
        type="audio"
        url={activeUrl}
      />
    )}
    </div>
  )
}

export const SunoUploadExtendNode = memo(SunoUploadExtendNodeComponent)
