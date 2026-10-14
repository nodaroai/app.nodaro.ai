"use client"

import { memo, useState, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Wand2, Braces, Film, AudioLines, Music, Loader2, AlertCircle, RotateCcw } from "lucide-react"
import { BaseNode } from "./base-node"
import { NodeJobProgress } from "./node-job-progress"
import { RunNodeButton } from "./run-node-button"
import { EditableNodeLabel } from "./editable-node-label"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { ACCEPTS_AUDIO, ACCEPTS_MEDIA } from "@/lib/ffmpeg-handles"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useTightenEpisodeCredits } from "@/hooks/use-tighten-episode-credits"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "./video-node-defaults"
import { PreviewBadge, isPreviewQuality } from "@/components/render/preview-badge"
import { RenderReviewBar } from "@/components/render/render-review-bar"
import { ReviewCutButton } from "@/components/render/review-cut-button"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"
import { executionErrorText, nodeErrorCodeText } from "@/lib/execution-error-text"
import { RENDER_FINAL_ALREADY_RENDERED } from "@nodaro/shared/nodes"
import { cn } from "@/lib/utils"
import { usecaseTakeMedium } from "@/lib/use-case-run-result"
import { usecaseListDriven, usecaseRenderFinalOffered } from "@/components/editor/workflow-editor/use-case-render-final-set"
import type { TightenEpisodeData } from "@/types/nodes"

/**
 * Tighten Episode (decided 2026-10-13): one recording in, the tightened episode
 * out — video or audio (an audio recording forces audio) — plus the edit it
 * cut by. A failed run offers Continue: the next single-node run continues
 * that run from where it failed, its finished steps kept. A Preview take
 * offers Render final, which continues the run to its final. Neither is
 * offered on a list-driven node (one run per item).
 */
/** The refusals of a Render final that leave nothing to continue (a final under way, or this edit already rendered). */
const REFUSED_FINAL_CODES: ReadonlySet<string> = new Set([RENDER_FINAL_ALREADY_RENDERED, "already_running"])

function TightenEpisodeNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TightenEpisodeData
  const t = useT()
  const credits = useTightenEpisodeCredits(id)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const runSingleNode = useWorkflowStore((s) => s.runSingleNode)
  const status = nodeData.executionStatus ?? "idle"
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl ?? nodeData.generatedAudioUrl
  // The take on show plays as the medium of its own file (the gallery's rule).
  const isAudio = activeUrl ? usecaseTakeMedium(activeUrl, nodeData as unknown as Record<string, unknown>) === "audio" : nodeData.output === "audio"
  // The take on show is a Preview — from what the take IS, never a setting.
  const showsPreview = isPreviewQuality(activeResult)
  const [mediaError, setMediaError] = useState(false)

  useEffect(() => { setMediaError(false) }, [activeUrl])

  // Result aspect drives node sizing (shared media-node-sizing invariant).
  const { aspectRatio: mediaAspectRatio, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const hasResult = status !== "running" && !!activeUrl && !mediaError
  const jobId = nodeData.useCaseJobId
  // A list-driven node runs once per item: no one run for Continue or Render final to name.
  const listDriven = useWorkflowStore((s) => {
    const self = s.nodes.find((n) => n.id === id)
    return self ? usecaseListDriven(self, s.nodes, s.edges) : false
  })
  // A failed run offers Continue; a Preview on show whose run can be finished
  // offers Render final (the take's own run, use-case-render-final-set.ts).
  // Never both: no Render final while the node shows a failure.
  // A refused Render final (a final of this preview under way, or already made
  // with this edit) has nothing to continue: its words, and no Continue.
  const errorCode = (nodeData as { errorCode?: unknown }).errorCode
  const refusedFinal = typeof errorCode === "string" && REFUSED_FINAL_CODES.has(errorCode)
  // A preview refusal on this node names its own remedy (its review), not a render's.
  const coded = typeof errorCode === "string" ? (nodeErrorCodeText(errorCode, "tighten-episode") ?? executionErrorText(errorCode)) : null
  const shownError = coded && coded !== errorCode ? coded : nodeData.errorMessage
  const canContinue = !!jobId && !listDriven && !refusedFinal
  // Offered while a run of the node is queued too: the bar then shows it busy.
  const canRenderFinal = !listDriven && usecaseRenderFinalOffered({ type: "tighten-episode", data: nodeData as unknown as Record<string, unknown> })

  // The continuation is this click's run option, never node data: a click that
  // never starts (the price confirm declined, the balance refused) leaves
  // nothing behind, and the next Run is a fresh run.
  const continueRun = () => {
    if (!jobId) return
    runSingleNode?.(id, { usecaseContinue: { mode: "from-failed", jobId } })
  }

  return (
    <div className="relative group/node" style={{ width: "100%", height: "100%", overflow: "visible" }}>
      <EditableNodeLabel label={nodeData.label} icon={<Wand2 className="w-3.5 h-3.5" />} onSave={(newLabel) => updateNodeData(id, { label: newLabel })} />
      <BaseNode
        id={id}
        label={nodeData.label}
        icon={<Wand2 className="h-4 w-4" />}
        category="processing"
        credits={credits}
        selected={selected}
        isRunning={status === "running"}
        hideHeader
        {...videoNodeSizing(mediaAspectRatio)}
        topToolbarContent={<RunNodeButton nodeId={id} credits={credits} isRunning={status === "running"} onRun={(nid) => runSingleNode?.(nid)} />}
        handles={[
          { id: "media", type: "target", position: Position.Left,  customStyle: { top: "24px",              left: "-29px" },  external: true },
          { id: "music", type: "target", position: Position.Left,  customStyle: { top: "calc(100% - 24px)", left: "-29px" },  external: true },
          { id: "json",  type: "source", position: Position.Right, customStyle: { top: "24px",              right: "-29px" }, external: true },
          { id: "media", type: "source", position: Position.Right, customStyle: { top: "calc(100% - 24px)", right: "-29px" }, external: true },
        ]}
      >
        <div className="relative flex flex-col gap-1 p-2 h-full" style={{ minHeight: 120 }}>
          {hasResult && showsPreview && <PreviewBadge className="absolute start-3 top-3 z-10 pointer-events-none" />}
          {status === "running" && (
            <div className="flex flex-col items-center justify-center gap-2 flex-1 rounded-md bg-muted/30">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              <NodeJobProgress progress={nodeData.currentJobProgress} />
            </div>
          )}

          {hasResult && !isAudio && (
            <video
              src={activeUrl}
              controls
              className="w-full flex-1 rounded-md bg-black object-contain"
              onLoadedMetadata={(e) => onLoadDimensions({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
              onError={() => setMediaError(true)}
            />
          )}

          {hasResult && isAudio && (
            <div className="flex flex-col items-center justify-center gap-2 flex-1 rounded-md bg-muted/30 p-2">
              <AudioLines className="w-5 h-5 text-muted-foreground" />
              <audio src={activeUrl} controls className="w-full" onError={() => setMediaError(true)} />
            </div>
          )}

          {/* Hides itself where no review can open. */}
          <ReviewCutButton renderId={id} />

          {/* "pending" is the runtime-only queued state, not in the narrower data type. */}
          {hasResult && showsPreview && canRenderFinal && <RenderReviewBar renderId={id} busy={(status as string) === "pending" || (status as string) === "stopping"} />}

          {/* Under an earlier take it is a compact strip; alone it fills the card. */}
          {status === "failed" && (
            <div className={cn("flex flex-col items-center justify-center gap-1 rounded-md bg-red-500/5 text-red-500 p-2", !hasResult && "flex-1")}>
              <div className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4 shrink-0" /><span className="font-medium">{t("node.failed")}</span></div>
              {shownError && (
                <p className="text-[10px] text-center text-red-400 line-clamp-2" title={shownError}>{shownError}</p>
              )}
              {canContinue && (
                <Button size="sm" variant="secondary" className="nodrag" onClick={continueRun} title={t("node.tightenContinueHint")}>
                  <RotateCcw className="w-3.5 h-3.5 me-1" />{t("node.tightenContinue")}
                </Button>
              )}
            </div>
          )}

          {status !== "running" && !hasResult && status !== "failed" && (
            <div className="flex flex-col items-center justify-center gap-1 flex-1 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
              <Wand2 className="w-5 h-5" />
              <span className="text-[10px] text-center px-2">{t("node.tightenConnectRecording")}</span>
            </div>
          )}
        </div>
      </BaseNode>

      {/* The input pips' labels are the label tables' English keys (localized by
          the pip); the outputs' come from the dictionary. */}
      <HandleWithPopover nodeId={id} nodeType="tighten-episode" handleId="media" type="target" position={Position.Left}  label="Recording" color={HANDLE_COLORS.video}     icon={<Film />}   side="left"  top="24px"              accepts={ACCEPTS_MEDIA} />
      <HandleWithPopover nodeId={id} nodeType="tighten-episode" handleId="music" type="target" position={Position.Left}  label="Music"     color={HANDLE_COLORS.audio}     icon={<Music />}  side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_AUDIO} />
      <HandleWithPopover nodeId={id} nodeType="tighten-episode" handleId="json"  type="source" position={Position.Right} label={t("node.tightenPlan")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
      <HandleWithPopover nodeId={id} nodeType="tighten-episode" handleId="media" type="source" position={Position.Right} label={t(isAudio ? "node.tightenEpisodeAudio" : "node.tightenEpisodeVideo")} color={isAudio ? HANDLE_COLORS.audio : HANDLE_COLORS.video} icon={isAudio ? <AudioLines /> : <Film />} side="right" top="calc(100% - 24px)" />
    </div>
  )
}

export const TightenEpisodeNode = memo(TightenEpisodeNodeComponent)
