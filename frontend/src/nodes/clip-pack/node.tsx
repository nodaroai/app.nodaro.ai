import { memo, useState, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { LayoutGrid, Braces, Film, AudioLines, CaptionsOff } from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS } from "@/components/nodes/handle-with-popover"
import { USE_CASE_REFUSED_FINAL_CODES, UseCaseNodeShell, usecaseSlotTop, useUseCaseNodeRun } from "@/components/nodes/use-case-node-shell"
import { clipPackRowKey, usecaseRunRowsOnShow } from "@/components/nodes/use-case-run-rows"
import { ACCEPTS_AUDIO, ACCEPTS_MEDIA } from "@/lib/ffmpeg-handles"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { useUnitNodeKit } from "@/components/nodes/use-unit-node-kit"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "@/components/nodes/video-node-defaults"
import { PreviewBadge, isPreviewQuality } from "@/components/render/preview-badge"
import { RenderReviewBar } from "@/components/render/render-review-bar"
import { ReviewCutButton } from "@/components/render/review-cut-button"
import { resultsGalleryPickPatch } from "@/components/editor/config-panels/results-gallery-media"
import { useT } from "@/lib/i18n"
import { useTargetHandleShown } from "@/hooks/use-target-handle-shown"
import { usecaseCameraNoteLines } from "@/lib/use-case-cameras-note"
import { cn } from "@/lib/utils"
import { usecaseTakeMedium } from "@/lib/use-case-run-result"
import { usecaseRenderFinalOffered } from "@/components/editor/workflow-editor/use-case-render-final-set"
import type { ClipPackData } from "./types"

/**
 * Clip Pack (decided 2026-10-14): one recording in — video, or audio, which
 * makes audio clips — (or, for a viewer who may use Speaker Map, the cameras
 * of one conversation and a Master audio, decided 2026-10-17: each clip cuts
 * to the speaker) a pack of short clips out, plus the plan's clip set.
 * The clips of one run are rows of that run: the first is on show, and a
 * thumbnail per clip (its still — an audio glyph for an audio clip — titled
 * by the plan) puts another on show. How many clips
 * could not be rendered is said under the take on show, and a clip whose
 * captions could not be added is marked (it is delivered uncaptioned) — both
 * of that take's own run, never a later run's. A Preview (review on) offers
 * Render final; a failed run offers Continue; neither on a list-driven node.
 */
function ClipPackNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ClipPackData
  const t = useT()
  const kit = useUnitNodeKit(id)
  const run = useUseCaseNodeRun(id, "clip-pack", nodeData)
  // Master audio is read only for a viewer who may use Speaker Map: withheld (no pip) otherwise, unless already wired.
  const showMaster = useTargetHandleShown(id, "clip-pack", "masterAudio")
  const { status, listDriven, errorCode } = run
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl ?? nodeData.generatedAudioUrl
  // The clip on show plays as the medium of its own file (the gallery's rule).
  const isAudio = activeUrl ? usecaseTakeMedium(activeUrl, nodeData as unknown as Record<string, unknown>) === "audio" : false
  const showsPreview = isPreviewQuality(activeResult)
  const [mediaError, setMediaError] = useState(false)

  useEffect(() => { setMediaError(false) }, [activeUrl])

  // Result aspect drives node sizing (shared media-node-sizing invariant).
  const { aspectRatio: mediaAspectRatio, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const hasResult = status !== "running" && !!activeUrl && !mediaError
  const refusedFinal = errorCode !== undefined && USE_CASE_REFUSED_FINAL_CODES.has(errorCode)
  const canRenderFinal = !listDriven && usecaseRenderFinalOffered({ type: "clip-pack", data: nodeData as unknown as Record<string, unknown> })
  // A chip per clip of the run on show (each clip once, in plan order).
  const clips = usecaseRunRowsOnShow(results, activeResult, clipPackRowKey)
  // What the run of the take on show could not deliver — that take's own, never a later run's.
  const failedClips = typeof activeResult?.failedClips === "number" && activeResult.failedClips > 0 ? activeResult.failedClips : 0
  const uncaptioned = clips.some((c) => c.row.captionsFailed === true)
  // What the last multicam run's cameras report says to look at (a speaker with no clear camera, a weak sync).
  const cameraNote = hasResult ? usecaseCameraNoteLines(nodeData.useCaseCameras, t) : []

  // A chip puts its clip on show the way a pick in the results gallery does
  // (the row's own plan and transcript with it).
  const show = (index: number, url: string) => {
    const patch = resultsGalleryPickPatch("clip-pack", nodeData, url, index)
    if (patch) kit.updateNodeData(patch)
  }

  return (
    <UseCaseNodeShell
      id={id}
      data={nodeData}
      run={run}
      selected={selected}
      icon={LayoutGrid}
      sizing={videoNodeSizing(mediaAspectRatio)}
      bodyMinHeight={120}
      handles={[
        { id: "media", type: "target", at: "top" },
        ...(showMaster ? [{ id: "masterAudio", type: "target" as const, at: "bottom" as const }] : []),
        { id: "json", type: "source", at: "top" },
        { id: "clips", type: "source", at: "bottom" },
      ]}
      hasResult={hasResult}
      badge={hasResult && showsPreview && <PreviewBadge className="absolute start-3 top-3 z-10 pointer-events-none" />}
      result={
        <>
          {isAudio ? (
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
          {clips.length > 0 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label={t("node.clipPackClips")}>
              {clips.map((chip, n) => {
                const title = chip.row.title ?? t("node.clipPackClip", { n: n + 1 })
                const on = chip.index === activeIndex
                const noCaptions = chip.row.captionsFailed === true
                const audio = usecaseTakeMedium(chip.url, nodeData as unknown as Record<string, unknown>) === "audio"
                const name = noCaptions ? `${title} — ${t("node.clipPackNoCaptions")}` : title
                return (
                  <button
                    key={chip.index}
                    type="button"
                    className={cn(
                      "nodrag relative h-10 w-10 shrink-0 overflow-hidden rounded border bg-muted/40",
                      on ? "border-primary ring-1 ring-primary" : "border-muted-foreground/30 hover:border-muted-foreground/60",
                    )}
                    aria-pressed={on}
                    aria-label={name}
                    title={chip.row.hook ? `${name}\n${chip.row.hook}` : name}
                    onClick={(e) => {
                      e.stopPropagation()
                      show(chip.index, chip.url)
                    }}
                  >
                    {audio ? (
                      <span className="flex h-full w-full items-center justify-center text-muted-foreground" data-testid="clip-audio-glyph"><AudioLines className="h-4 w-4" aria-hidden="true" /></span>
                    ) : chip.row.thumbnailUrl ? (
                      <img src={chip.row.thumbnailUrl} alt="" className="h-full w-full object-cover" draggable={false} />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-muted-foreground"><Film className="h-4 w-4" aria-hidden="true" /></span>
                    )}
                    {noCaptions && (
                      <span className="absolute end-0.5 top-0.5 rounded-sm bg-background/80 p-px text-amber-500" data-testid="clip-no-captions">
                        <CaptionsOff className="h-3 w-3" aria-hidden="true" />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
          {failedClips > 0 && (
            <p className="text-[10px] text-amber-500">{failedClips === 1 ? t("node.clipPackFailedOne") : t("node.clipPackFailedMany", { count: failedClips })}</p>
          )}
          {uncaptioned && <p className="text-[10px] text-amber-500">{t("node.clipPackCaptionsFailed")}</p>}
        </>
      }
      afterResult={
        <>
          {/* Hides itself where no review can open. */}
          <ReviewCutButton renderId={id} />
          {cameraNote.length > 0 && (
            <div data-testid="use-case-camera-note" className="flex flex-col gap-0.5 px-1">
              {cameraNote.map((line) => <p key={line} className="text-[10px] leading-snug text-muted-foreground">{line}</p>)}
            </div>
          )}
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
          <HandleWithPopover nodeId={id} nodeType="clip-pack" handleId="media" type="target" position={Position.Left}  label="Recordings" color={HANDLE_COLORS.video} icon={<Film />} side="left" top={usecaseSlotTop("top")} accepts={ACCEPTS_MEDIA} />
          {showMaster && <HandleWithPopover nodeId={id} nodeType="clip-pack" handleId="masterAudio" type="target" position={Position.Left} label="Master audio" color={HANDLE_COLORS.audio} icon={<AudioLines />} side="left" top={usecaseSlotTop("bottom")} accepts={ACCEPTS_AUDIO} />}
          <HandleWithPopover nodeId={id} nodeType="clip-pack" handleId="json"  type="source" position={Position.Right} label={t("node.clipPackPlan")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
          <HandleWithPopover nodeId={id} nodeType="clip-pack" handleId="clips" type="source" position={Position.Right} label={t("node.clipPackClips")} color={isAudio ? HANDLE_COLORS.audio : HANDLE_COLORS.video} icon={isAudio ? <AudioLines /> : <Film />} side="right" top="calc(100% - 24px)" />
        </>
      }
    />
  )
}

export const NodeComponent = memo(ClipPackNodeComponent)
