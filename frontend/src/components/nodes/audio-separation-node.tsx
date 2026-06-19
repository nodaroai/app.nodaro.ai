"use client"

import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { SplitSquareVertical, Loader2, AlertCircle, Mic, Music } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { NodeQuickStrip } from "./node-quick-strip"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { isValidAudioSeparationConnection } from "@/lib/audio-text-handles"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { computeDeleteResultUpdates } from "@/lib/utils"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/ee/hooks/use-model-credits"
import { AudioResultOverlay } from "./audio-result-overlay"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import type { AudioSeparationData } from "@/types/nodes"

const ACCEPTS_AUDIO = (t: string) => isValidAudioSeparationConnection("audio", t)

/** 7 fixed output stems — handle id, the node-data field it surfaces, label,
 *  and the vertical offset of its right-side handle. */
const STEMS = [
  { id: "vocals", field: "vocalUrl", label: "Vocals", top: "24px" },
  { id: "instrumental", field: "instrumentalUrl", label: "Instrumental", top: "52px" },
  { id: "drums", field: "drumsUrl", label: "Drums", top: "80px" },
  { id: "bass", field: "bassUrl", label: "Bass", top: "108px" },
  { id: "other", field: "otherUrl", label: "Other", top: "136px" },
  { id: "guitar", field: "guitarUrl", label: "Guitar", top: "164px" },
  { id: "piano", field: "pianoUrl", label: "Piano", top: "192px" },
] as const

/** Which stems a given mode produces (drives handle muting). */
const ACTIVE_STEMS: Record<AudioSeparationData["mode"], ReadonlySet<string>> = {
  vocal_instrumental: new Set(["vocals", "instrumental"]),
  stems: new Set(["vocals", "drums", "bass", "other", "guitar", "piano"]),
}

function AudioSeparationNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AudioSeparationData
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedAudioUrl ?? nodeData.vocalUrl
  const mode = nodeData.mode ?? "vocal_instrumental"
  const activeStems = ACTIVE_STEMS[mode] ?? ACTIVE_STEMS.vocal_instrumental
  const separateCreditId = nodeData.quality === "best" ? "audio-separation:best" : "audio-separation"
  const credits = useModelCredits(separateCreditId, nodeData.quality === "best" ? 8 : 3)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedAudioUrl"))
  }

  const presentStems = STEMS.filter((s) => nodeData[s.field as keyof AudioSeparationData])

  return (
    <div className="relative" style={{ maxWidth: '220px' }}>
    <EditableNodeLabel
      label={nodeData.label}
      icon={<SplitSquareVertical className="w-3.5 h-3.5" />}
      onSave={(newLabel) => updateNodeData(id, { label: newLabel })}
    />
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={<SplitSquareVertical className="h-4 w-4" />}
      category="ai"
      credits={credits}
      selected={selected}
      isRunning={status === "running"}
      hideHeader
      topToolbarContent={
        <NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />
      }
      handles={[
        { id: "audio", type: "target", position: Position.Left, customStyle: { top: 'calc(100% - 24px)', left: '-29px' }, external: true },
        ...STEMS.map((s) => ({
          id: s.id,
          type: "source" as const,
          position: Position.Right,
          customStyle: { top: s.top, right: '-29px' },
          external: true,
        })),
      ]}
    >
      <div className="flex flex-col gap-2 p-3" style={{ minHeight: 210 }}>
        {status === "running" && !activeUrl && (
          <div className="flex flex-col items-center justify-center gap-2 h-12 rounded-md bg-muted/30">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            <NodeJobProgress progress={nodeData.currentJobProgress} />
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

        {presentStems.map((s) => (
          <div key={s.id} className="flex flex-col gap-1 px-1">
            <span className="text-[10px] text-muted-foreground font-medium">{s.label}</span>
            <AudioResultOverlay
              url={nodeData[s.field as keyof AudioSeparationData] as string}
              label={s.label}
              hasResults={false}
              onExpand={() => setPreviewOpen(true)}
              onDelete={() => {}}
            />
          </div>
        ))}

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

        {status !== "running" && !activeUrl && presentStems.length === 0 && status !== "failed" && (
          <div className="flex items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40" style={{ minHeight: 150, flex: 1 }}>
            <SplitSquareVertical className="w-5 h-5" />
          </div>
        )}

        <span className="text-xs text-muted-foreground">
          Separate · {mode === "stems" ? "Full Stems" : "Vocal/Inst"}
        </span>
      </div>
    </BaseNode>
    <HandleWithPopover nodeId={id} nodeType="audio-separation" handleId="audio" type="target" position={Position.Left} label="Audio" color={HANDLE_COLORS.audio} icon={<SplitSquareVertical />} side="left" top="calc(100% - 24px)" accepts={ACCEPTS_AUDIO} />
    {STEMS.map((s) => (
      <HandleWithPopover
        key={s.id}
        nodeId={id}
        nodeType="audio-separation"
        handleId={s.id}
        type="source"
        position={Position.Right}
        label={s.label}
        color={HANDLE_COLORS.audio}
        icon={s.id === "vocals" ? <Mic /> : <Music />}
        side="right"
        top={s.top}
        disabled={!activeStems.has(s.id)}
      />
    ))}
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

export const AudioSeparationNode = memo(AudioSeparationNodeComponent)
