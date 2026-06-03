"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Music, Loader2, AlertCircle, Volume2, Type, LayoutGrid, Sparkles, Mic } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { isValidSunoGenerateConnection } from "@/lib/audio-text-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { computeDeleteResultUpdates } from "@/lib/utils"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { AudioResultOverlay } from "./audio-result-overlay"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import type { SunoGenerateData } from "@/types/nodes"

const isVisualPicker = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_PROMPT      = (t: string) => isValidSunoGenerateConnection("prompt",      t, isVisualPicker)
const ACCEPTS_AUDIO_STYLE = (t: string) => isValidSunoGenerateConnection("audio-style", t, isVisualPicker)
const ACCEPTS_VOICE       = (t: string) => isValidSunoGenerateConnection("voice",       t, isVisualPicker)

function SunoGenerateNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SunoGenerateData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedAudioUrl
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showThumbnails, setShowThumbnails] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const creditModel = nodeData.model === "V5" ? "suno-v5" : "suno-generate"
  const credits = useModelCredits(creditModel, nodeData.model === "V5" ? 13 : 7)

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedAudioUrl"))
  }

  return (
    <div className="relative" style={{ width: 220, minHeight: 220, overflow: 'visible' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<Music className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<Music className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      minHeight={180}
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
        { id: "prompt",      type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
        { id: "audio-style", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 56px)', left: '-29px' }, external: true },
        { id: "voice",       type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 88px)', left: '-29px' }, external: true },
        { id: "audio",       type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
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
            <Music className="w-5 h-5" />
          </div>
        )}

        <div className="flex justify-between text-muted-foreground">
          <span className="text-xs">Suno {nodeData.model ?? "V5"}</span>
          {nodeData.title && <span className="text-xs truncate max-w-[120px]">{nodeData.title}</span>}
        </div>
      </div>
    </BaseNode>
    <HandleWithPopover nodeId={id} nodeType="suno-generate" handleId="prompt"      type="target" position={Position.Left}  label="Prompt"      color={TEXT_HANDLE_COLOR} icon={<Type />}     side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_PROMPT} />
    <HandleWithPopover nodeId={id} nodeType="suno-generate" handleId="audio-style" type="target" position={Position.Left}  label="Audio style" color={HANDLE_COLORS.audio} icon={<Sparkles />} side="left"  top="calc(100% - 56px)" accepts={ACCEPTS_AUDIO_STYLE} />
    <HandleWithPopover nodeId={id} nodeType="suno-generate" handleId="voice"       type="target" position={Position.Left}  label="Voice"       color={HANDLE_COLORS.audio} icon={<Mic />}      side="left"  top="calc(100% - 88px)" accepts={ACCEPTS_VOICE} />
    <HandleWithPopover nodeId={id} nodeType="suno-generate" handleId="audio"       type="source" position={Position.Right} label="Audio"       color={HANDLE_COLORS.audio} icon={<Music />}    side="right" top="24px" />
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

export const SunoGenerateNode = memo(SunoGenerateNodeComponent)
