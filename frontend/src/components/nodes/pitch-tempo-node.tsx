"use client"

import { useT } from "@/lib/i18n"
import { memo, useEffect, useState } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Music2, Loader2, AlertCircle, AudioLines, Film } from "lucide-react"
import { pitchTempoQuoteCreditId } from "@nodaro/shared"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover } from "./handle-with-popover"
import { ACCEPTS_MEDIA, FFMPEG_COLORS } from "@/lib/ffmpeg-handles"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { usePitchTempoInputSec } from "@/hooks/use-pitch-tempo-input-sec"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { computeDeleteResultUpdates } from "@/lib/utils"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { AudioResultOverlay } from "./audio-result-overlay"
import { VideoResultOverlay } from "./video-result-overlay"
import { MediaPreviewModal } from "@/components/editor/media-preview-modal"
import { videoNodeSizing } from "./video-node-defaults"
import type { PitchTempoData } from "@/types/nodes"

/** "+3 st · 0.75×" — the settings at a glance under the result. */
function settingsSummary(data: PitchTempoData, isVideo: boolean): string {
  const st = data.semitones ?? 0
  const pitch = `${st > 0 ? "+" : ""}${Number(st.toFixed(1))} st`
  const tempo = data.tempo ?? 1
  return isVideo || tempo === 1 ? pitch : `${pitch} · ${Number(tempo.toFixed(2))}×`
}

function PitchTempoNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as PitchTempoData
  // The per-minute id the route and the workflow run reserve, at the input
  // length the graph or the upstream node tells (unknown → 30 minutes, the
  // most a run that measures the file is charged).
  const credits = useModelCredits(pitchTempoQuoteCreditId(usePitchTempoInputSec(id)), 20)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const videoAutoplay = useWorkflowStore((s) => s.videoAutoplay)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const isVideoOutput = nodeData.lastInputType === "video"
  const urlField = isVideoOutput ? "generatedVideoUrl" : "generatedAudioUrl"
  const activeUrl = activeResult?.url ?? (isVideoOutput ? nodeData.generatedVideoUrl : nodeData.generatedAudioUrl)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [videoError, setVideoError] = useState(false)

  useEffect(() => {
    setVideoError(false)
  }, [activeUrl])

  // Video mode sizes like every other video node (result aspect → 16:9);
  // audio mode keeps the compact layout.
  const { aspectRatio: mediaAspectRatio, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const hasVideoResult = isVideoOutput && status !== "running" && !!activeUrl && !videoError

  function handleDeleteResult(indexToDelete: number) {
    updateNodeData(id, computeDeleteResultUpdates(results, activeIndex, indexToDelete, urlField))
  }

  // One output pip whose id follows what the node last produced. React Flow
  // caches handle bounds, so re-measure when the id flips.
  const outputHandleId = isVideoOutput ? "video-out" : "audio-out"
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, outputHandleId, updateNodeInternals])

  return (
    <div className="relative" style={isVideoOutput ? { width: "100%", height: "100%", overflow: "visible" } : { maxWidth: "220px" }}>
      <EditableNodeLabel label={nodeData.label} icon={<Music2 className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Music2 className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        {...(isVideoOutput ? videoNodeSizing(mediaAspectRatio) : {})}
        className={hasVideoResult ? "!border-0 !shadow-none !bg-transparent" : undefined}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />}
        handles={[
          { id: "in", type: "target", position: Position.Left, label: "Input", external: true, customStyle: { top: "calc(100% - 24px)", left: "-29px" } },
          { id: outputHandleId, type: "source", position: Position.Right, label: isVideoOutput ? "Video" : "Audio", external: true, customStyle: { top: "24px", right: "-29px" } },
        ]}
      >
        {hasVideoResult ? null : (
          <div className="flex flex-col gap-1">
            {status === "running" && (
              <div className="flex flex-col items-center justify-center gap-2 h-16 rounded-md bg-muted/30">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <NodeJobProgress progress={nodeData.currentJobProgress} />
              </div>
            )}
            {status !== "running" && activeUrl && !isVideoOutput && (
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
                  <span className="font-medium">{t("node.failed")}</span>
                </div>
                {nodeData.errorMessage && (
                  <p className="text-[10px] text-center text-red-400 line-clamp-1" title={nodeData.errorMessage}>
                    {nodeData.errorMessage}
                  </p>
                )}
              </div>
            )}
            {status !== "running" && !activeUrl && status !== "failed" && (
              <div className="flex items-center justify-center h-16 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
                <Music2 className="w-5 h-5" />
              </div>
            )}
            <p className="text-muted-foreground">{settingsSummary(nodeData, isVideoOutput)}</p>
          </div>
        )}
      </BaseNode>
      {hasVideoResult && (
        <VideoResultOverlay
          url={activeUrl!}
          videoAutoplay={videoAutoplay}
          label={nodeData.label}
          hasResults={results.length > 0}
          onExpand={() => setPreviewOpen(true)}
          onDelete={() => setDeleteConfirm(activeIndex)}
          onRawDimensions={onLoadDimensions}
          onVideoError={() => setVideoError(true)}
          onVideoLoad={() => setVideoError(false)}
        />
      )}
      <HandleWithPopover nodeId={id} nodeType="pitch-tempo" handleId="in" type="target" position={Position.Left} label="Media" color={FFMPEG_COLORS.media} icon={<AudioLines />} side="left" top="calc(100% - 24px)" accepts={ACCEPTS_MEDIA} />
      {isVideoOutput ? (
        <HandleWithPopover nodeId={id} nodeType="pitch-tempo" handleId="video-out" type="source" position={Position.Right} label="Video" color={FFMPEG_COLORS.video} icon={<Film />} side="right" top="24px" />
      ) : (
        <HandleWithPopover nodeId={id} nodeType="pitch-tempo" handleId="audio-out" type="source" position={Position.Right} label="Audio" color={FFMPEG_COLORS.audio} icon={<AudioLines />} side="right" top="24px" />
      )}
      <DeleteConfirmationDialog isOpen={deleteConfirm !== null} onClose={() => setDeleteConfirm(null)} onConfirm={() => { if (deleteConfirm !== null) handleDeleteResult(deleteConfirm) }} />
      {activeUrl && (
        <MediaPreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} type={isVideoOutput ? "video" : "audio"} url={activeUrl} results={results} initialIndex={activeIndex} />
      )}
    </div>
  )
}

export const PitchTempoNode = memo(PitchTempoNodeComponent)
