import { memo, useState, useEffect } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Clapperboard, Braces, Film } from "lucide-react"
import { HandleWithPopover, HANDLE_COLORS } from "@/components/nodes/handle-with-popover"
import { USE_CASE_REFUSED_FINAL_CODES, UseCaseNodeShell, useUseCaseNodeRun } from "@/components/nodes/use-case-node-shell"
import { ACCEPTS_VIDEO } from "@/lib/ffmpeg-handles"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { useUnitNodeKit } from "@/components/nodes/use-unit-node-kit"
import { useResultAspectRatio } from "@/hooks/use-result-aspect-ratio"
import { videoNodeSizing } from "@/components/nodes/video-node-defaults"
import { PreviewBadge, isPreviewQuality } from "@/components/render/preview-badge"
import { RenderReviewBar } from "@/components/render/render-review-bar"
import { ReviewCutButton } from "@/components/render/review-cut-button"
import { resultsGalleryPickPatch } from "@/components/editor/config-panels/results-gallery-media"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { usecaseRenderFinalOffered } from "@/components/editor/workflow-editor/use-case-render-final-set"
import type { GeneratedResult } from "@/types/nodes"
import type { EpisodeTrailerData } from "./types"

/**
 * Trailer (decided 2026-10-14): one video recording in — never audio only —
 * a 20–40 s trailer out in every chosen format, optionally after an intro
 * card, plus the edit it cut by. The formats of one run are rows of that run:
 * the first is on show, and a chip per format puts another on show. A format
 * that could not be rendered is named; the others are delivered. A Preview
 * (review on) offers Render final; a failed run offers Continue; neither on a
 * list-driven node.
 */
function EpisodeTrailerNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as EpisodeTrailerData
  const t = useT()
  const kit = useUnitNodeKit(id)
  const run = useUseCaseNodeRun(id, "episode-trailer", nodeData)
  const { status, listDriven, errorCode } = run
  const results = nodeData.generatedResults ?? []
  const activeIndex = nodeData.activeResultIndex ?? 0
  const activeResult = results[activeIndex]
  const activeUrl = activeResult?.url ?? nodeData.generatedVideoUrl
  const showsPreview = isPreviewQuality(activeResult)
  const [mediaError, setMediaError] = useState(false)

  useEffect(() => { setMediaError(false) }, [activeUrl])

  // Result aspect drives node sizing (shared media-node-sizing invariant).
  const { aspectRatio: mediaAspectRatio, onLoadDimensions } = useResultAspectRatio(id, results, activeIndex)
  const hasResult = status !== "running" && !!activeUrl && !mediaError
  const refusedFinal = errorCode !== undefined && USE_CASE_REFUSED_FINAL_CODES.has(errorCode)
  const canRenderFinal = !listDriven && usecaseRenderFinalOffered({ type: "episode-trailer", data: nodeData as unknown as Record<string, unknown> })
  const formats = formatChipsOf(results, activeResult)
  // The formats the run of the take on show could not render — that take's own, never a later run's.
  const failed = (activeResult?.failedFormats ?? []).filter((f) => typeof f === "string" && f !== "")

  // A chip puts its format on show the way a pick in the results gallery does
  // (the row's own plan and transcript with it).
  const show = (index: number, url: string) => {
    const patch = resultsGalleryPickPatch("episode-trailer", nodeData, url, index)
    if (patch) kit.updateNodeData(patch)
  }

  return (
    <UseCaseNodeShell
      id={id}
      data={nodeData}
      run={run}
      selected={selected}
      icon={Clapperboard}
      sizing={videoNodeSizing(mediaAspectRatio)}
      bodyMinHeight={120}
      handles={[
        { id: "media", type: "target", at: "top" },
        { id: "introCard", type: "target", at: "bottom" },
        { id: "json", type: "source", at: "top" },
        { id: "media", type: "source", at: "bottom" },
      ]}
      hasResult={hasResult}
      badge={hasResult && showsPreview && <PreviewBadge className="absolute start-3 top-3 z-10 pointer-events-none" />}
      result={
        <>
          <video
            src={activeUrl}
            controls
            className="w-full flex-1 rounded-md bg-black object-contain"
            onLoadedMetadata={(e) => onLoadDimensions({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
            onError={() => setMediaError(true)}
          />
          {formats.length > 0 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label={t("node.trailerFormats")}>
              {formats.map((chip) => (
                <button
                  key={chip.index}
                  type="button"
                  className={cn(
                    "nodrag rounded px-1.5 py-0.5 text-[10px] font-medium border",
                    chip.format === activeResult?.format ? "border-primary bg-primary/10 text-primary" : "border-muted-foreground/30 text-muted-foreground hover:bg-muted",
                  )}
                  aria-pressed={chip.format === activeResult?.format}
                  onClick={(e) => {
                    e.stopPropagation()
                    show(chip.index, chip.url)
                  }}
                >
                  {chip.format}
                </button>
              ))}
            </div>
          )}
          {failed.length > 0 && (
            <p className="text-[10px] text-amber-500" title={failed.join(", ")}>{t("node.trailerFormatsFailed", { formats: failed.join(", ") })}</p>
          )}
        </>
      }
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
          <HandleWithPopover nodeId={id} nodeType="episode-trailer" handleId="media"     type="target" position={Position.Left}  label="Recording"  color={HANDLE_COLORS.video}     icon={<Film />}         side="left"  top="24px"              accepts={ACCEPTS_VIDEO} />
          <HandleWithPopover nodeId={id} nodeType="episode-trailer" handleId="introCard" type="target" position={Position.Left}  label="Intro card" color={HANDLE_COLORS.video}     icon={<Clapperboard />} side="left"  top="calc(100% - 24px)" accepts={ACCEPTS_VIDEO} />
          <HandleWithPopover nodeId={id} nodeType="episode-trailer" handleId="json"      type="source" position={Position.Right} label={t("node.trailerPlan")} color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="24px" />
          <HandleWithPopover nodeId={id} nodeType="episode-trailer" handleId="media"     type="source" position={Position.Right} label={t("node.trailerDeliveries")} color={HANDLE_COLORS.video} icon={<Film />} side="right" top="calc(100% - 24px)" />
        </>
      }
    />
  )
}

/** One format of the run on show: its row in the results, its file and its format. */
interface FormatChip {
  readonly index: number
  readonly url: string
  readonly format: string
}

/**
 * The formats of the run whose take is on show: every row of that run (the
 * same wrapper job) that names its format, each format once (the first row
 * holding it — a run landed twice never shows a format twice), in the order the run delivered
 * them. None for a take that names no run or no format (a Preview, an older
 * take).
 */
function formatChipsOf(results: readonly GeneratedResult[], onShow: GeneratedResult | undefined): FormatChip[] {
  if (!onShow?.jobId || !onShow.format) return []
  const seen = new Set<string>()
  return results.flatMap((r, index) => {
    if (r.jobId !== onShow.jobId || typeof r.format !== "string" || r.format === "" || seen.has(r.format)) return []
    seen.add(r.format)
    return [{ index, url: r.url, format: r.format }]
  })
}

export const NodeComponent = memo(EpisodeTrailerNodeComponent)
