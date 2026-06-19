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

/** Which stems a (mode, quality) pair produces — drives handle muting.
 *  Mirrors the backend pickModel: full-stems "fast" uses htdemucs (4 stems),
 *  auto/best use htdemucs_6s (adds guitar+piano). */
function activeStemsFor(
  mode: AudioSeparationData["mode"],
  quality: AudioSeparationData["quality"],
): ReadonlySet<string> {
  if (mode === "stems") {
    const base = ["vocals", "drums", "bass", "other"]
    if (quality !== "fast") base.push("guitar", "piano")
    return new Set(base)
  }
  return new Set(["vocals", "instrumental"])
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
  const activeStems = activeStemsFor(mode, nodeData.quality ?? "auto")
  const separateCreditId = nodeData.quality === "best" ? "audio-separation:best" : "audio-separation"
  const credits = useModelCredits(separateCreditId, nodeData.quality === "best" ? 8 : 3)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  function handleDeleteResult(indexToDelete: number) {
    // Also clear the per-stem fields — they belong to the active run, not to
    // generatedResults, so computeDeleteResultUpdates won't touch them.
    updateNodeData(id, {
      ...computeDeleteResultUpdates(results, activeIndex, indexToDelete, "generatedAudioUrl"),
      vocalUrl: undefined, instrumentalUrl: undefined, drumsUrl: undefined,
      bassUrl: undefined, otherUrl: undefined, guitarUrl: undefined, pianoUrl: undefined,
    })
  }

  // Per-stem previews — exclude the one already shown in the primary overlay.
  const presentStems = STEMS.filter((s) => {
    const url = nodeData[s.field as keyof AudioSeparationData]
    return url && url !== activeUrl
  })

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
    {/* Static handle ids (NOT a .map) so the handle-color guard + edge-color
        registry stay statically analyzable. Muted per mode via `disabled`. */}
    <HandleWithPopover nodeId={id} nodeType="audio-separation" handleId="vocals"       type="source" position={Position.Right} label="Vocals"       color={HANDLE_COLORS.audio} icon={<Mic />}   side="right" top="24px"  disabled={!activeStems.has("vocals")} />
    <HandleWithPopover nodeId={id} nodeType="audio-separation" handleId="instrumental" type="source" position={Position.Right} label="Instrumental" color={HANDLE_COLORS.audio} icon={<Music />} side="right" top="52px"  disabled={!activeStems.has("instrumental")} />
    <HandleWithPopover nodeId={id} nodeType="audio-separation" handleId="drums"        type="source" position={Position.Right} label="Drums"        color={HANDLE_COLORS.audio} icon={<Music />} side="right" top="80px"  disabled={!activeStems.has("drums")} />
    <HandleWithPopover nodeId={id} nodeType="audio-separation" handleId="bass"         type="source" position={Position.Right} label="Bass"         color={HANDLE_COLORS.audio} icon={<Music />} side="right" top="108px" disabled={!activeStems.has("bass")} />
    <HandleWithPopover nodeId={id} nodeType="audio-separation" handleId="other"        type="source" position={Position.Right} label="Other"        color={HANDLE_COLORS.audio} icon={<Music />} side="right" top="136px" disabled={!activeStems.has("other")} />
    <HandleWithPopover nodeId={id} nodeType="audio-separation" handleId="guitar"       type="source" position={Position.Right} label="Guitar"       color={HANDLE_COLORS.audio} icon={<Music />} side="right" top="164px" disabled={!activeStems.has("guitar")} />
    <HandleWithPopover nodeId={id} nodeType="audio-separation" handleId="piano"        type="source" position={Position.Right} label="Piano"        color={HANDLE_COLORS.audio} icon={<Music />} side="right" top="192px" disabled={!activeStems.has("piano")} />
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
