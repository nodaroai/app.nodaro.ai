"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { ListMusic, Loader2, AlertCircle, X, AudioLines } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { ACCEPTS_AUDIO, FFMPEG_COLORS } from "@/lib/ffmpeg-handles"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { computeDeleteResultUpdates } from "@/lib/utils"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { AudioResultOverlay } from "./audio-result-overlay"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import type { CombineAudioData } from "@/types/nodes"

function CombineAudioNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CombineAudioData
  const credits = useModelCredits("ffmpeg", 1)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  // Narrow subscription: a primitive incoming-edge count instead of the whole
  // `edges` array, so this node re-renders only when its own incoming-edge
  // count changes — not on every unrelated mutation that mints a fresh array.
  const connectedCount = useWorkflowStore((s) =>
    s.edges.reduce((acc, e) => (e.target === id ? acc + 1 : acc), 0),
  )
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedAudioUrl
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedAudioUrl"))
  }

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel label={nodeData.label} icon={<ListMusic className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
    <BaseNode id={id} label={nodeData.label} icon={<ListMusic className="h-4 w-4" />} category="processing" credits={credits} selected={selected} isRunning={status === "running"} hideHeader minWidth={220}
      topToolbarContent={(<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />)}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input", external: true, customStyle: { top: 'calc(100% - 24px)', left: '-29px' } },
        { id: "audio-out", type: "source", position: Position.Right, label: "Audio", external: true, customStyle: { top: '24px', right: '-29px' } },
      ]}
    >
      <div className="flex flex-col gap-1">
        {status === "running" && (
          <div className="flex flex-col items-center justify-center gap-2 h-16 rounded-md bg-muted/30"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} /></div>
        )}
        {status !== "running" && activeUrl && (
          <AudioResultOverlay
            url={activeUrl}
            label={nodeData.label}
            hasResults={results.length > 0}
            onExpand={() => setPreviewOpen(true)}
            onDelete={() => setDeleteConfirm(activeIndex)}
          />
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
          <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40"><ListMusic className="w-5 h-5" /></div>
        )}
        {results.length > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            {results.slice(0, 5).map((r, i) => (
              <div key={`${r.jobId}-${i}`} className="relative group/thumb shrink-0">
                <div role="button" aria-label="Play audio result" tabIndex={0} className={`w-10 h-10 flex items-center justify-center rounded cursor-pointer transition-opacity bg-muted ${i === activeIndex ? "opacity-100 ring-2 ring-primary" : "opacity-50 hover:opacity-80"}`} onClick={(e) => { e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedAudioUrl: r.url }) }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); updateNodeData(id, { activeResultIndex: i, generatedAudioUrl: r.url }) } }}>
                  <AudioLines className="w-4 h-4" />
                </div>
                <button type="button" aria-label="Remove" className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover/thumb:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); setDeleteConfirm(i) }}><X className="w-2.5 h-2.5" /></button>
              </div>
            ))}
          </div>
        )}
        <p className="text-muted-foreground">{connectedCount} segment{connectedCount !== 1 ? "s" : ""}</p>
      </div>
    </BaseNode>
    <HandleWithPopover nodeId={id} nodeType="combine-audio" handleId="in"        type="target" position={Position.Left}  label="Audio" color={FFMPEG_COLORS.audio} icon={<AudioLines />} side="left"  top="calc(100% - 24px)" orderMatters accepts={ACCEPTS_AUDIO} />
    <HandleWithPopover nodeId={id} nodeType="combine-audio" handleId="audio-out" type="source" position={Position.Right} label="Audio" color={FFMPEG_COLORS.audio} icon={<AudioLines />} side="right" top="24px" />
    <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
    {activeUrl && (
      <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type="audio" url={activeUrl} results={results} initialIndex={activeIndex} />
    )}
    </div>
  )
}

export const CombineAudioNode = memo(CombineAudioNodeComponent)
