import { memo, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { AlertCircle, AudioLines, LayoutGrid, Loader2, Type, Volume2 } from "lucide-react"
import { BaseNode } from "@/components/nodes/base-node"
import { EditableNodeLabel } from "@/components/nodes/editable-node-label"
import { HandleWithPopover, HANDLE_COLORS, TEXT_HANDLE_COLOR } from "@/components/nodes/handle-with-popover"
import { NodeJobProgress } from "@/components/nodes/node-job-progress"
import { NodeQuickStrip } from "@/components/nodes/node-quick-strip"
import { AudioResultOverlay } from "@/components/nodes/audio-result-overlay"
import { useUnitNodeKit } from "@/components/nodes/use-unit-node-kit"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { unitInputConnectionAccepted } from "@/lib/ffmpeg-handles"
import { useT } from "@/lib/i18n"
import { computeDeleteResultUpdates } from "@/lib/utils"
import type { UnitNodeComponent } from "../kit"
import { useRunCredits } from "./config"
import { definition } from "./definition.generated"
import type { SunoSpeechData } from "./types"

// The pip glow follows the manifest's declared input — the rule the canvas
// and the add-node popup judge a wire into it by (unit-connections.ts).
const ACCEPTS_TEXT = (t: string) => unitInputConnectionAccepted(definition, "prompt", t)

// Laid out as the other Suno nodes are: the active take with its player, a
// strip to switch between a run's two takes, the pips beside BaseNode.
function SunoSpeechNode({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as SunoSpeechData
  const kit = useUnitNodeKit(id)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeUrl = results[activeIndex]?.url ?? nodeData.generatedAudioUrl
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [showTakes, setShowTakes] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const credits = useRunCredits()

  return (
    <div className="relative" style={{ maxWidth: "220px" }}>
      <EditableNodeLabel
        label={nodeData.label}
        icon={<AudioLines className="w-3.5 h-3.5" />}
        onSave={(label) => kit.updateNodeData({ label })}
      />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<AudioLines className="h-4 w-4" />}
        category="ai"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        topToolbarContent={<NodeQuickStrip nodeId={id} credits={credits} isRunning={status === "running"} />}
        bottomToolbarContent={
          showTakes && results.length > 1 ? (
            <div className="flex gap-2 px-2 py-1.5 bg-black/60 backdrop-blur-sm rounded-xl border border-white/10">
              {results.slice(0, 8).map((r, i) => (
                <button
                  key={`${r.jobId}-${i}`}
                  type="button"
                  aria-label={t("node.resultN", { n: i + 1 })}
                  className={`w-10 h-10 flex items-center justify-center rounded-lg cursor-pointer transition-all ${
                    i === activeIndex ? "ring-2 ring-[#ff0073] bg-[#ff0073]/20" : "opacity-50 hover:opacity-80 bg-white/10"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    kit.updateNodeData({ activeResultIndex: i, generatedAudioUrl: r.url })
                  }}
                >
                  <Volume2 className="w-4 h-4 text-white" />
                </button>
              ))}
            </div>
          ) : undefined
        }
        handles={[
          { id: "prompt", type: "target", position: Position.Left, customStyle: { top: "calc(100% - 24px)", left: "-29px" }, external: true },
          { id: "audio", type: "source", position: Position.Right, customStyle: { top: "24px", right: "-29px" }, external: true },
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
                aria-label={t("sunoSpeech.takes")}
                className="flex items-center gap-1 px-1.5 py-0.5 bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white text-[11px] rounded-md"
                onClick={(e) => { e.stopPropagation(); setShowTakes((v) => !v) }}
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
                <span className="font-medium">{t("node.failed")}</span>
              </div>
              {nodeData.errorMessage && (
                <p className="text-[11px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                  {nodeData.errorMessage}
                </p>
              )}
            </div>
          )}
          {status !== "running" && !activeUrl && status !== "failed" && (
            <div className="flex items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground" style={{ minHeight: 120, flex: 1 }}>
              <AudioLines className="w-5 h-5" />
            </div>
          )}
          <div className="flex justify-between text-muted-foreground">
            <span className="text-xs">{nodeData.mode === "script" ? t("sunoSpeech.modeScript") : t("sunoSpeech.modeBrief")}</span>
          </div>
        </div>
      </BaseNode>
      <HandleWithPopover nodeId={id} nodeType="suno-speech" handleId="prompt" type="target" position={Position.Left} label="Prompt" color={TEXT_HANDLE_COLOR} icon={<Type />} side="left" top="calc(100% - 24px)" accepts={ACCEPTS_TEXT} />
      <HandleWithPopover nodeId={id} nodeType="suno-speech" handleId="audio" type="source" position={Position.Right} label="Audio" color={HANDLE_COLORS.audio} icon={<AudioLines />} side="right" top="24px" />
      <DeleteConfirmationDialog
        isOpen={deleteConfirm !== null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => {
          if (deleteConfirm !== null) kit.updateNodeData(computeDeleteResultUpdates([...results], activeIndex, deleteConfirm, "generatedAudioUrl"))
        }}
      />
      {activeUrl && (
        <MediaPreviewModal
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          type="audio"
          url={activeUrl}
          results={[...results]}
          initialIndex={activeIndex}
        />
      )}
    </div>
  )
}

export const NodeComponent: UnitNodeComponent = memo(SunoSpeechNode)
