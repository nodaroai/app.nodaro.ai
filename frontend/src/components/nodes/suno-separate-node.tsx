"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Scissors, Loader2, AlertCircle, Volume2, LayoutGrid, Mic, Music } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { isValidSunoSeparateConnection } from "@/lib/audio-text-handles"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { computeDeleteResultUpdates } from "@/lib/utils"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { AudioResultOverlay } from "./audio-result-overlay"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import type { SunoSeparateData } from "@/types/nodes"

const ACCEPTS_AUDIO = (t: string) => isValidSunoSeparateConnection("audio", t)

function SunoSeparateNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SunoSeparateData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedAudioUrl ?? nodeData.vocalUrl
  const separateCreditId = nodeData.type === "split_stem" ? "suno-separate-stem" : "suno-separate"
  const credits = useModelCredits(separateCreditId, nodeData.type === "split_stem" ? 10 : 5)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedAudioUrl"))
  }

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Scissors className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Scissors className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      hideHeader
      topToolbarContent={
        <RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />
      }
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
      handles={[
        { id: "audio",        type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
        { id: "vocals",       type: "source", position: Position.Right, customStyle: { top: '30%',               right: '-29px' }, external: true },
        { id: "instrumental", type: "source", position: Position.Right, customStyle: { top: '70%',               right: '-29px' }, external: true },
      ]}
    >
      <div className="flex flex-col gap-2 p-3" style={{ minHeight: 180 }}>
        {status === "running" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-2 h-12 rounded-md bg-muted/30">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
          </div>
        )}

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
        {activeUrl && (
          <div className="px-3 py-2">
            <AudioResultOverlay
              url={activeUrl}
              label={nodeData.label}
              hasResults={results.length > 0}
              onExpand={() => setPreviewOpen(true)}
              onDelete={() => setDeleteConfirm(activeIndex)}
            />
          </div>
        )}
        {nodeData.vocalUrl && (
          <div className="flex flex-col gap-1 px-1">
            <span className="text-[10px] text-muted-foreground font-medium">Vocal</span>
            <AudioResultOverlay url={nodeData.vocalUrl} label="Vocal" hasResults={false} onExpand={() => setPreviewOpen(true)} onDelete={() => {}} />
          </div>
        )}
        {nodeData.instrumentalUrl && (
          <div className="flex flex-col gap-1 px-1">
            <span className="text-[10px] text-muted-foreground font-medium">Instrumental</span>
            <AudioResultOverlay url={nodeData.instrumentalUrl} label="Instrumental" hasResults={false} onExpand={() => setPreviewOpen(true)} onDelete={() => {}} />
          </div>
        )}

        {status === "failed" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-1 h-12 rounded-md bg-red-500/5 text-red-500 p-2">
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
          <div className="flex items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40" style={{ minHeight: 120, flex: 1 }}>
            <Scissors className="w-5 h-5" />
          </div>
        )}

        <span className="text-xs text-muted-foreground">
          Separate · {nodeData.type === "split_stem" ? "12 Stems" : "Vocal/Inst"}
        </span>
      </div>
    </BaseNode>
    <HandleWithPopover nodeId={id} nodeType="suno-separate" handleId="audio"        type="target" position={Position.Left}  label="Audio"        color="#F59E0B" icon={<Scissors />} side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_AUDIO} />
    <HandleWithPopover nodeId={id} nodeType="suno-separate" handleId="vocals"       type="source" position={Position.Right} label="Vocals"       color="#F59E0B" icon={<Mic />}      side="right" top="30%" />
    <HandleWithPopover nodeId={id} nodeType="suno-separate" handleId="instrumental" type="source" position={Position.Right} label="Instrumental" color="#F59E0B" icon={<Music />}    side="right" top="70%" />
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
        results={results}
        initialIndex={activeIndex}
      />
    )}
    </div>
  )
}

export const SunoSeparateNode = memo(SunoSeparateNodeComponent)
