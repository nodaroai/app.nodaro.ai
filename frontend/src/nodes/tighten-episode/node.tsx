import { memo, useState, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Wand2, Braces, Film, AudioLines, Music } from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS } from "@/components/nodes/handle-with-popover"
import { USE_CASE_REFUSED_FINAL_CODES, UseCaseNodeShell, useUseCaseNodeRun } from "@/components/nodes/use-case-node-shell"
import { ACCEPTS_AUDIO, ACCEPTS_MEDIA } from "@/lib/ffmpeg-handles"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "@/components/nodes/video-node-defaults"
import { PreviewBadge, isPreviewQuality } from "@/components/render/preview-badge"
import { RenderReviewBar } from "@/components/render/render-review-bar"
import { ReviewCutButton } from "@/components/render/review-cut-button"
import { useT } from "@/lib/i18n"
import { usecaseTakeMedium } from "@/lib/use-case-run-result"
import { usecaseRenderFinalOffered } from "@/components/editor/workflow-editor/use-case-render-final-set"
import type { TightenEpisodeData } from "./types"

/**
 * Tighten Episode (decided 2026-10-13): one recording in, the tightened episode
 * out — video or audio (an audio recording forces audio) — plus the edit it
 * cut by. A failed run offers Continue: the next single-node run continues
 * that run from where it failed, its finished steps kept. A Preview take
 * offers Render final, which continues the run to its final. Neither is
 * offered on a list-driven node (one run per item).
 */
function TightenEpisodeNodeComponent({ id, type, data, selected }: NodeProps) {
  const nodeData = data as TightenEpisodeData
  const t = useT()
  const run = useUseCaseNodeRun(id, type, nodeData)
  const { status, listDriven, errorCode } = run
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
  // A failed run offers Continue; a Preview on show whose run can be finished
  // offers Render final (the take's own run, use-case-render-final-set.ts).
  // Never both: no Render final while the node shows a failure.
  // A refused Render final (a final of this preview under way, or already made
  // with this edit) has nothing to continue: its words, and no Continue.
  const refusedFinal = errorCode !== undefined && USE_CASE_REFUSED_FINAL_CODES.has(errorCode)
  // Offered while a run of the node is queued too: the bar then shows it busy.
  const canRenderFinal = !listDriven && usecaseRenderFinalOffered({ type: "tighten-episode", data: nodeData as unknown as Record<string, unknown> })

  return (
    <UseCaseNodeShell
      id={id}
      data={nodeData}
      run={run}
      selected={selected}
      icon={Wand2}
      sizing={videoNodeSizing(mediaAspectRatio)}
      bodyMinHeight={120}
      handles={[
        { id: "media", type: "target", at: "top" },
        { id: "music", type: "target", at: "bottom" },
        { id: "json", type: "source", at: "top" },
        { id: "media", type: "source", at: "bottom" },
      ]}
      hasResult={hasResult}
      badge={hasResult && showsPreview && <PreviewBadge className="absolute start-3 top-3 z-10 pointer-events-none" />}
      result={isAudio ? (
        <div className="flex flex-col items-center justify-center gap-2 flex-1 rounded-md bg-muted/30 p-2">
          <AudioLines className="w-5 h-5 text-muted-foreground" />
          <audio src={activeUrl} controls className="w-full" onError={() => setMediaError(true)} />
        </div>
      ) : (
        <video
          src={activeUrl}
          controls
          className="w-full flex-1 rounded-md bg-black object-contain"
          onLoadedMetadata={(e) => onLoadDimensions({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
          onError={() => setMediaError(true)}
        />
      )}
      afterResult={
        <>
          {/* Hides itself where no review can open. */}
          <ReviewCutButton renderId={id} />
          {/* "pending" is the runtime-only queued state, not in the narrower data type. */}
          {hasResult && showsPreview && canRenderFinal && <RenderReviewBar renderId={id} busy={status === "pending" || status === "stopping"} />}
        </>
      }
      continueBlocked={refusedFinal}
      emptyText={t("node.tightenConnectRecording")}
      pips={
        <>
          {/* The input pips' labels are the label tables' English keys (localized by
              the pip); the outputs' come from the dictionary. */}
          <HandleWithPopover nodeId={id} nodeType="tighten-episode" handleId="media" type="target" position={Position.Left}  label="Recording" color={HANDLE_COLORS.video}     icon={<Film />}   side="left"  top="24px"              accepts={ACCEPTS_MEDIA} />
          <HandleWithPopover nodeId={id} nodeType="tighten-episode" handleId="music" type="target" position={Position.Left}  label="Music"     color={HANDLE_COLORS.audio}     icon={<Music />}  side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_AUDIO} />
          <HandleWithPopover nodeId={id} nodeType="tighten-episode" handleId="json"  type="source" position={Position.Right} label={t("node.tightenPlan")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
          <HandleWithPopover nodeId={id} nodeType="tighten-episode" handleId="media" type="source" position={Position.Right} label={t(isAudio ? "node.tightenEpisodeAudio" : "node.tightenEpisodeVideo")} color={isAudio ? HANDLE_COLORS.audio : HANDLE_COLORS.video} icon={isAudio ? <AudioLines /> : <Film />} side="right" top="calc(100% - 24px)" />
        </>
      }
    />
  )
}

export const NodeComponent = memo(TightenEpisodeNodeComponent)
