"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Music, Loader2, AlertCircle, Volume2, Type, LayoutGrid, Sparkles } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { isValidGenerateMusicConnection } from "@/lib/audio-text-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES } from "@/lib/parameter-picker-types"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { computeDeleteResultUpdates } from "@/lib/utils"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { AudioResultOverlay } from "./audio-result-overlay"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import type { GenerateMusicData } from "@/types/nodes"

const isVisualPicker = (s: string) => VISUAL_PARAMETER_PICKER_NODE_TYPES.has(s)
const ACCEPTS_PROMPT      = (t: string) => isValidGenerateMusicConnection("prompt",      t, isVisualPicker)
const ACCEPTS_REF_AUDIO   = (t: string) => isValidGenerateMusicConnection("ref-audio",   t, isVisualPicker)
const ACCEPTS_AUDIO_STYLE = (t: string) => isValidGenerateMusicConnection("audio-style", t, isVisualPicker)

function GenerateMusicNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as GenerateMusicData
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
  const credits = useModelCredits(nodeData.provider ?? "generate-music", 4)

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedAudioUrl"))
  }

  return (
    <div className="relative" style={{ width: 220, overflow: 'visible' }}>
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
      // 3 stacked input handles at top: calc(100% - 24/56/88) — node body
      // needs ~110px of vertical real estate to keep all pips visible.
      minHeight={140}
      hideHeader
      topToolbarContent={
        <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />
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
        { id: "ref-audio",   type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 56px)', left: '-29px' }, external: true },
        { id: "audio-style", type: "target", position: Position.Left,  customStyle: { top: 'calc(100% - 88px)', left: '-29px' }, external: true },
        { id: "audio",       type: "source", position: Position.Right, customStyle: { top: '24px',              right: '-29px' }, external: true },
      ]}
    >
      <div className="flex flex-col gap-2 p-3" style={{ minHeight: 140 }}>
        {status === "running" && !activeUrl && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-[96px] rounded-md bg-muted/30">
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
          <div className="flex-1 flex flex-col items-center justify-center gap-1 min-h-[96px] rounded-md bg-red-500/5 text-red-500 p-2">
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
          <span>{nodeData.provider || "musicgen"}</span>
          <span className="text-xs">{nodeData.duration}s{nodeData.genre ? ` - ${nodeData.genre}` : ""}{nodeData.instrumental ? " (inst)" : ""}</span>
        </div>
      </div>
    </BaseNode>
    <HandleWithPopover nodeId={id} nodeType="generate-music" handleId="prompt"      type="target" position={Position.Left}  label="Prompt"      color={TEXT_HANDLE_COLOR} icon={<Type />}      side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_PROMPT} />
    <HandleWithPopover nodeId={id} nodeType="generate-music" handleId="ref-audio"   type="target" position={Position.Left}  label="Ref audio"   color={HANDLE_COLORS.audio} icon={<Music />}     side="left"  top="calc(100% - 56px)" orderMatters accepts={ACCEPTS_REF_AUDIO} />
    <HandleWithPopover nodeId={id} nodeType="generate-music" handleId="audio-style" type="target" position={Position.Left}  label="Audio style" color={HANDLE_COLORS.audio} icon={<Sparkles />}  side="left"  top="calc(100% - 88px)" accepts={ACCEPTS_AUDIO_STYLE} />
    <HandleWithPopover nodeId={id} nodeType="generate-music" handleId="audio"       type="source" position={Position.Right} label="Audio"       color={HANDLE_COLORS.audio} icon={<Music />}     side="right" top="24px" />
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

export const GenerateMusicNode = memo(GenerateMusicNodeComponent)
