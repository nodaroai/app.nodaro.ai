import { memo, useEffect, useState } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { AudioLines, Braces, Film, LayoutPanelTop } from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS } from "@/components/nodes/handle-with-popover"
import { USE_CASE_REFUSED_FINAL_CODES, UseCaseNodeShell, usecaseSlotTop, useUseCaseNodeRun } from "@/components/nodes/use-case-node-shell"
import { ACCEPTS_AUDIO, ACCEPTS_MEDIA } from "@/lib/ffmpeg-handles"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "@/components/nodes/video-node-defaults"
import { PreviewBadge, isPreviewQuality } from "@/components/render/preview-badge"
import { RenderReviewBar } from "@/components/render/render-review-bar"
import { useT } from "@/lib/i18n"
import { useTargetHandleShown } from "@/hooks/use-target-handle-shown"
import { usecaseCameraNoteLines } from "@/lib/use-case-cameras-note"
import { usecaseRenderFinalOffered } from "@/components/editor/workflow-editor/use-case-render-final-set"
import type { UnitNodeComponent } from "../kit"
import type { SpeakerLayoutData } from "./types"

/**
 * Speaker Layout (decided 2026-10-17): a whole recording framed by speaker,
 * the same length, no cut — the recordings in (one, or — for a viewer who may
 * use Speaker Map — several cameras and a Master audio), the framed video out
 * and the edit its render drew. Its card shows the framed video (a Preview
 * when review is on) and, under a multicam take, what its cameras report says
 * to look at. A failed run offers Continue (the shell); a Preview whose run can
 * be finished offers Render final, which continues that run to its final with
 * no edit — a layout has no plan, so no review inspector is offered. Neither
 * on a list-driven node (one run per item). The run reads the node's type
 * from React Flow (NodeProps); the pips name it as written, which the handle
 * guard reads.
 */
function SpeakerLayoutNode({ id, type, data, selected }: NodeProps) {
  const nodeData = data as SpeakerLayoutData
  const t = useT()
  const run = useUseCaseNodeRun(id, type, nodeData)
  const { status, listDriven, errorCode } = run
  // Master audio is read only for a viewer who may use Speaker Map: withheld (no pip) otherwise, unless already wired.
  const showMaster = useTargetHandleShown(id, type, "masterAudio")
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  // The take on show is a Preview — from what the take IS, never a setting.
  const showsPreview = isPreviewQuality(activeResult)
  const [mediaError, setMediaError] = useState(false)
  useEffect(() => { setMediaError(false) }, [activeUrl])
  // Result aspect drives node sizing (shared media-node-sizing invariant).
  const { aspectRatio: mediaAspectRatio, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const hasResult = status !== "running" && !!activeUrl && !mediaError
  // A refused Render final (one under way, or already made) has nothing to continue: its words, and no Continue.
  const refusedFinal = errorCode !== undefined && USE_CASE_REFUSED_FINAL_CODES.has(errorCode)
  // The take's own run (use-case-render-final-set.ts); offered while a run of the node is queued too (the bar shows it busy).
  const canRenderFinal = !listDriven && usecaseRenderFinalOffered({ type, data: nodeData as unknown as Record<string, unknown> })
  // What the last multicam run's cameras report says to look at (a speaker with no clear camera, a weak sync).
  const cameraNote = hasResult ? usecaseCameraNoteLines(nodeData.useCaseCameras, t) : []
  return (
    <UseCaseNodeShell
      id={id}
      data={nodeData}
      run={run}
      selected={selected}
      icon={LayoutPanelTop}
      sizing={videoNodeSizing(mediaAspectRatio)}
      bodyMinHeight={120}
      handles={[
        { id: "media", type: "target", at: "top" },
        ...(showMaster ? [{ id: "masterAudio", type: "target" as const, at: "bottom" as const }] : []),
        { id: "json", type: "source", at: "top" },
        { id: "media", type: "source", at: "bottom" },
      ]}
      hasResult={hasResult}
      badge={hasResult && showsPreview && <PreviewBadge className="absolute start-3 top-3 z-10 pointer-events-none" />}
      result={
        <video
          src={activeUrl}
          controls
          className="w-full flex-1 rounded-md bg-black object-contain"
          onLoadedMetadata={(e) => onLoadDimensions({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
          onError={() => setMediaError(true)}
        />
      }
      afterResult={
        <>
          {cameraNote.length > 0 && (
            <div data-testid="use-case-camera-note" className="flex flex-col gap-0.5 px-1">
              {cameraNote.map((line) => <p key={line} className="text-[11px] leading-snug text-muted-foreground">{line}</p>)}
            </div>
          )}
          {/* "pending" is the runtime-only queued state, not in the narrower data type. */}
          {hasResult && showsPreview && canRenderFinal && <RenderReviewBar renderId={id} busy={status === "pending" || status === "stopping"} />}
        </>
      }
      continueBlocked={refusedFinal}
      emptyText={t("node.speakerLayoutConnectRecording")}
      pips={
        <>
          {/* The input pips' labels are the label tables' English keys (localized by the pip); the outputs' come from the dictionary. */}
          <HandleWithPopover nodeId={id} nodeType="speaker-layout" handleId="media" type="target" position={Position.Left} label="Recordings" color={HANDLE_COLORS.video} icon={<Film />} side="left" top={usecaseSlotTop("top")} accepts={ACCEPTS_MEDIA} />
          {showMaster && <HandleWithPopover nodeId={id} nodeType="speaker-layout" handleId="masterAudio" type="target" position={Position.Left} label="Master audio" color={HANDLE_COLORS.audio} icon={<AudioLines />} side="left" top={usecaseSlotTop("bottom")} accepts={ACCEPTS_AUDIO} />}
          <HandleWithPopover nodeId={id} nodeType="speaker-layout" handleId="json" type="source" position={Position.Right} label={t("node.speakerLayoutEdit")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
          <HandleWithPopover nodeId={id} nodeType="speaker-layout" handleId="media" type="source" position={Position.Right} label={t("node.speakerLayoutVideo")} color={HANDLE_COLORS.video} icon={<Film />} side="right" top="calc(100% - 24px)" />
        </>
      }
    />
  )
}

export const NodeComponent: UnitNodeComponent = memo(SpeakerLayoutNode)
