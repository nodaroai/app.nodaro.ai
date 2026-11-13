/**
 * BASE credits of a video-utility node (Trim Video, Loop Video, Combine
 * Videos, Assemble Narrated Video) from the graph: its own settings plus the
 * upstream lengths and the clips its wires bring. The node's price pill shows
 * it, and the workflow estimate divides it into pricing units
 * (`workflow-editor/types.ts :: getPricingUnits`), so the two read one number.
 * The estimators are the ones the routes and the workflow run charge with
 * (`@nodaro/shared`); Trim, Loop and Combine Videos are charged at the lengths
 * their run measures, so they are quoted from the measured walk. So are the
 * other steps here whose run measures its input (Mask Composite, Video
 * Overlay, Video SFX, Video Mask, Video Depth, Pitch & Tempo, Dubbing, Topaz
 * Video Upscale).
 */
import {
  assembleNarratedVideoCredits,
  VIDEO_UTIL_PRICING,
  PITCH_TEMPO_PRICING,
  NEMOTRON_TRANSCRIBE_PRICING,
  LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS,
  lipSyncAudioRateOf,
  lipSyncEstimateSeconds,
  videoOverlayVideoUnits,
} from "@nodaro/shared/credits"
import { maskCompositeUnits } from "@nodaro/shared/media"
import { fanInClipCount, forwardedVideoLengthSec, GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC, loopVideoRunFields, runWireLengthSec, withoutRecordedVideoLength, MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC, maskCompositeLeadSec, MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC, measuredWireLengthSec, runWireFps, videoDepthClipSec, videoMaskClipSec, videoSfxClipSec, dubbingQuotedMinutes, dubbingSourceHandle, VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC, VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC, trimVideoRunFields, videoOverlayBaseSec, videoOverlayBaseWireSec, videoOverlayQuotesVideo, videoUtilityUnitsOf, type MeasuredInputStepType, type MeasuredWireLengthOptions } from "@nodaro/render-rules"
import { clampTopazVideoFps, isTopazVideoResolution, NODARO_VIDEO_UPSCALE_PROVIDER, resolveTopazVideoTarget, type TopazVideoResolution, type TopazVideoSource } from "@nodaro/shared/models"
import { withWiredSettings } from "@nodaro/shared/nodes"
import { lipSyncAudioSourceId, nodaroVideoUpscaleEstimateUnits, nodaroVideoUpscaleRefusesLength, resolveGraphOrigin, topazVideoEstimateUnits } from "@nodaro/render-rules"
import { readNodeOutput } from "@/lib/node-output-reader"
import { readPlan } from "@/lib/apply-edl-estimate"
import { upstreamVideoDurationSec } from "@/lib/upstream-video-duration"
import { getCombineUpstreamDurations, getUpstreamDuration, type WireDurationReader } from "@/lib/upstream-duration"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/**
 * The length, in seconds, of the media on a wire as a RUN estimate reads it,
 * without the measured walk's slack: a render's output at the render's
 * estimated minutes, a chain of Trim / Loop / Combine Videos / Video SFX at the
 * length each passes on, and any other source at the length a run forwards
 * from it (`forwardedVideoLengthSec`), a generated video read as it was before
 * its runs recorded a length (`withoutRecordedVideoLength`). The reading the
 * server's run estimate gives the same step (`runWireLengthOf`): Transcribe on
 * Nemotron 3.5. Unknown stays `undefined`.
 *
 * @param rerunIds the nodes about to EXECUTE (empty for a single node's own price).
 */
function wireDurationReader(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string>,
): WireDurationReader {
  return (sourceId) =>
    runWireLengthSec(sourceId, nodes, edges, rerunIds, {
      planOutputOf: readPlan,
      otherSec: (origin) => forwardedVideoLengthSec(withoutRecordedVideoLength(origin)),
    })
}

/**
 * The seconds the video on a wire into a step whose run measures it (Mask
 * Composite, Video Overlay, Trim / Loop / Combine Videos, and the steps of
 * `MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC`) runs, as an ESTIMATE reads it
 * (`measuredWireLengthSec`, the walk the server's workflow estimate reads too):
 * a render at its estimated length, a recording at the length a run forwards,
 * a node outside the run at the take it hands on, and a node the run executes
 * (or that holds no take) at the length it will produce at its settings, plus
 * the step's slack once on each clip a node makes on the way. Frozen nodes never count as
 * running. Unknown stays `undefined`: the step's cap. The editor knows no
 * deployment's Generate Video Pro cap, so it reads the default one.
 *
 * A take a generation that does not run hands on may carry the length its run
 * recorded (an automatic length, a Seedance Edit / Extend): the walk reads it
 * with the allowance that record leaves off (`recordedTakeSec`), never below
 * the file these steps measure.
 *
 * @param rerunIds the nodes about to EXECUTE (empty for a single node's own price).
 */
function measuredWireReader(
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string>,
  plannedClipSlackSec: number,
  /** What one step's reading adds (Lip Sync: a re-run voice at its earlier take, a minimum). */
  extra?: Pick<MeasuredWireLengthOptions, "voiceTakeAsMinimum">,
): WireDurationReader {
  return (sourceId) =>
    measuredWireLengthSec(sourceId, nodes, edges, rerunIds, {
      planOutputOf: readPlan,
      generateVideoProCapSec: GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC,
      plannedClipSlackSec,
      ...extra,
    })
}

/**
 * The seconds the clip on a wire into one of the measuring steps of
 * `MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC` (Video SFX, Video Mask, Video Depth,
 * Pitch & Tempo, Dubbing, Topaz Video Upscale) runs, as its quote reads it:
 * the measured walk ({@link measuredWireReader}) with that step's slack — the
 * reading the server's workflow estimate and the app listing share. No
 * fallback to a length the upstream node merely stores (a generation's
 * setting, an Extend Video's added seconds, an earlier take of a node that
 * runs): the server reads none either.
 */
function measuredInputReader(
  type: MeasuredInputStepType,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string>,
  extra?: Pick<MeasuredWireLengthOptions, "voiceTakeAsMinimum">,
): WireDurationReader {
  return measuredWireReader(nodes, edges, rerunIds, MEASURED_INPUT_PLANNED_CLIP_SLACK_SEC[type], extra)
}

/**
 * The clip length a RUN estimate prices a Video SFX at, in seconds: its
 * `video` wire's length as the measured walk reads it
 * ({@link measuredInputReader}: a render's output, a recording, a node outside
 * the run at its take, a node that runs at the length it will produce plus the
 * container slack on each clip made), at most the 300 seconds a run accepts
 * (`videoSfxClipSec`). `undefined` when no wire's length is known: the 300 s
 * row, the most a run is charged.
 *
 * @param rerunIds the nodes about to EXECUTE (empty for a single node's own price).
 */
export function estimateVideoSfxClipSec(
  node: Pick<WorkflowNode, "id">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | undefined {
  const inputs = edges.filter((e) => e.target === node.id)
  const lengthOf = measuredInputReader("video-sfx", nodes, edges, rerunIds)
  return videoSfxClipSec(inputs, inputs.map((e) => lengthOf(e.source)))
}

/**
 * The clip length, in seconds, a Video SFX is QUOTED at, or `null` when it is
 * not known (the 300 s row): {@link estimateVideoSfxClipSec}, the server's
 * reading. The one reading behind the node's own Run button, its toolbar, the
 * confirm dialog and the workflow badge, so they quote one row.
 */
export function videoSfxQuotedSec(
  node: Pick<WorkflowNode, "id">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | null {
  return estimateVideoSfxClipSec(node, nodes, edges, rerunIds) ?? null
}

/**
 * The input length, in seconds, a Pitch & Tempo is QUOTED at, or `null` when
 * unknown (the 30-minute id): the first wire whose length the measured walk
 * knows ({@link measuredInputReader}: an upload's — audio uploads included —, a
 * render's output, a node outside the run at its take, a node that runs at
 * the length it will produce plus the container slack), the server's reading.
 * Capped at the 30 minutes a run accepts. The run itself measures the real file.
 */
export function pitchTempoQuotedSec(
  node: Pick<WorkflowNode, "id">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | null {
  const lengthOf = measuredInputReader("pitch-tempo", nodes, edges, rerunIds)
  const sec = edges.filter((e) => e.target === node.id).map((e) => lengthOf(e.source)).find((v) => v !== undefined)
  return sec === undefined ? null : Math.min(sec, PITCH_TEMPO_PRICING.MAX_DURATION_SEC)
}

/**
 * The file length, in seconds, a Transcribe on Nemotron 3.5 Transcribe (priced
 * per started minute) is QUOTED at, or `null` when unknown (the 60-minute
 * price): the length the graph gives its `audio` wire, else what the upstream
 * node itself reports (an upload's length). Capped at the 60 minutes a run
 * accepts. The run itself measures the real file.
 */
export function transcribeQuotedSec(
  node: Pick<WorkflowNode, "id">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | null {
  const lengthOf = wireDurationReader(nodes, edges, rerunIds)
  const fromGraph = edges.filter((e) => e.target === node.id).map((e) => lengthOf(e.source)).find((v) => v !== undefined)
  const sec = fromGraph ?? upstreamVideoDurationSec(node.id, "audio", nodes, edges)
  return sec === null || sec === undefined ? null : Math.min(sec, NEMOTRON_TRANSCRIBE_PRICING.MAX_DURATION_SEC)
}

/**
 * The video length, in seconds, an Add Captions transcribing on Nemotron 3.5
 * Transcribe (one charge: the render plus the video's started minutes) is
 * QUOTED at, or `null` when unknown (the 60-minute price): the length the graph
 * gives its video wire (`in`), else what the upstream node itself reports.
 * Capped at the 60 minutes a run accepts. The run itself measures the video.
 */
export function addCaptionsQuotedSec(
  node: Pick<WorkflowNode, "id">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | null {
  const lengthOf = wireDurationReader(nodes, edges, rerunIds)
  const fromGraph = edges
    .filter((e) => e.target === node.id && (e.targetHandle === "in" || e.targetHandle == null))
    .map((e) => lengthOf(e.source))
    .find((v) => v !== undefined)
  const sec = fromGraph ?? upstreamVideoDurationSec(node.id, "in", nodes, edges)
  return sec === null || sec === undefined ? null : Math.min(sec, NEMOTRON_TRANSCRIBE_PRICING.MAX_DURATION_SEC)
}

/**
 * The source length, in seconds, a Dubbing is QUOTED at, or `undefined` when
 * it is unknown: its source wire's (`video` wins over `audio`, as the node
 * dubs; a `sourceUrl` replaces both and is measured by the run) as the
 * measured walk reads it ({@link measuredInputReader}), the server's reading.
 * The span and its started minutes are `dubbingQuotedMinutes`
 * (`@nodaro/render-rules`), the rule the server's run estimate reads too.
 */
export function dubbingQuotedSourceSec(
  node: Pick<WorkflowNode, "id" | "data">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | undefined {
  const inputs = edges.filter((e) => e.target === node.id)
  const handle = dubbingSourceHandle((node.data ?? {}) as Record<string, unknown>, inputs.map((e) => e.targetHandle))
  const wire = handle === undefined ? undefined : inputs.find((e) => e.targetHandle === handle)
  if (!wire || !handle) return undefined
  return measuredInputReader("dubbing", nodes, edges, rerunIds)(wire.source)
}

/** The started minutes a Dubbing is QUOTED at (1 to 30; 1 when the span is not known) — its pill, its Run button, the confirm and the badge. */
export function dubbingQuotedMinutesOf(
  node: Pick<WorkflowNode, "id" | "data">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number {
  return dubbingQuotedMinutes((node.data ?? {}) as Record<string, unknown>, dubbingQuotedSourceSec(node, nodes, edges, rerunIds))
}

/**
 * The PRICED clip length, in seconds, a Video Mask is QUOTED at, or `null`
 * when it is unknown (the longest price row): the clip its `video` wire
 * brings as the measured walk reads it ({@link measuredInputReader}, the
 * container slack on each clip a node makes), at the 30 fps basis when that
 * wire's origin declares a frame rate (`videoMaskClipSec` / `runWireFps` in
 * @nodaro/render-rules — an upload's `fps`, through teleports, Trim, Loop and
 * a Combine Videos whose clips share one rate), the reading the server's run
 * estimate prices Video Mask by, so the node's Run button, the confirm dialog,
 * the workflow badge and the server quote one row. Rows above the cap
 * collapse onto the last row inside `videoMaskCreditId`.
 */
export function videoMaskQuotedSec(
  node: Pick<WorkflowNode, "id">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | null {
  const inputs = edges.filter((e) => e.target === node.id)
  const lengthOf = measuredInputReader("video-mask", nodes, edges, rerunIds)
  return videoMaskClipSec(inputs, inputs.map((e) => lengthOf(e.source)), inputs.map((e) => runWireFps(e.source, nodes, edges))) ?? null
}

/**
 * The clip length, in seconds, a Video Depth is QUOTED at, or `null` when it
 * is unknown (the provider's highest reachable row): its `video` wire's (else
 * the first wire's with a known length — `videoDepthClipSec`) as the measured
 * walk reads it ({@link measuredInputReader}, the container slack on each clip
 * a node makes), the server's reading. An upload whose file records no
 * length is read at the length the editor's own read of that file found
 * (`probedVideo`, cached on the node by `useUpstreamVideoProbe`, trusted only
 * for the file the upload hands on) — as the server's estimate probes an
 * upload's file. The node's pill, its Run button, the confirm and the badge
 * all read this.
 */
export function videoDepthQuotedSec(
  node: Pick<WorkflowNode, "id" | "data">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | null {
  const inputs = edges.filter((e) => e.target === node.id)
  const lengthOf = measuredInputReader("video-depth", nodes, edges, rerunIds)
  const known = videoDepthClipSec(inputs, inputs.map((e) => lengthOf(e.source)))
  if (known !== undefined) return known
  const wire = inputs.find((e) => e.targetHandle === "video") ?? inputs[0]
  const source = wire ? nodes.find((n) => n.id === wire.source) : undefined
  const url = source?.type === "upload-video" ? (source.data as { url?: unknown }).url : undefined
  const probed = ((node.data ?? {}) as { probedVideo?: { url?: unknown; durationSec?: unknown } }).probedVideo
  const sec = probed?.durationSec
  return typeof url === "string" && url.trim() !== "" && probed?.url === url.trim() && typeof sec === "number" && Number.isFinite(sec) && sec > 0 ? sec : null
}

/**
 * BASE credits of a video-utility node, as the workflow badge, the confirm, its
 * Run button and its pill quote it. Trim, Loop and Combine Videos run measure
 * each clip they are given before they reserve, so each wire is read by the
 * measured walk ({@link measuredWireReader}, the reading the server's workflow
 * estimate and the app listing share): a clip another node makes in this run
 * at the length that node will produce plus
 * {@link VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC} for each clip made on the way, a
 * node outside the run at the take it hands on, an upload at its measured
 * length. A clip nothing can size before the run stands at the estimators'
 * 8-second fallback — a minimum, since the run is charged the length it
 * measures. Units are counted by the one rule the charge counts by
 * (`videoUtilityUnitsOf`: each clip less the frame grace, then the node's
 * formula), a Trim over the fields its run sends (`trimVideoRunFields`).
 *
 * @param rerunIds the nodes about to EXECUTE (empty for a single node's own price).
 */
export function estimateVideoUtilityBaseCredits(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | undefined {
  const data = node.data as Record<string, unknown>
  const durationOf = measuredWireReader(nodes, edges, rerunIds, VIDEO_UTILITY_PLANNED_CLIP_SLACK_SEC)
  const credits = (units: number | undefined) => (units === undefined ? undefined : units * VIDEO_UTIL_PRICING.CREDIT_UNIT)
  switch (node.type) {
    case "loop-video":
    case "trim-video":
      return credits(videoUtilityUnitsOf(
        node.type,
        node.type === "trim-video" ? trimVideoRunFields(data) : loopVideoRunFields(data),
        [getUpstreamDuration(node.id, nodes, edges, durationOf)],
      ))
    case "combine-videos":
      // One length per clip it receives: a Bundle from a fanned-out source hands it every run's clip
      // (`fanInClipCount`, the count the server's estimate reads).
      return credits(videoUtilityUnitsOf(
        node.type,
        data,
        getCombineUpstreamDurations(node, nodes, edges, durationOf, (e) => fanInClipCount(e, nodes, edges, rerunIds)),
      ))
    case "assemble-narrated-video": {
      // Block count = edges wired into the "video" handle (the `blocks` array
      // driver — see execute-node.ts). No inputs wired yet still prices the
      // 1-block floor (never shows the unreachable N=0 value).
      const wired = edges
        .filter((e) => e.target === node.id && e.targetHandle === "video")
        .reduce((n, e) => n + fanInClipCount(e, nodes, edges, rerunIds), 0)
      return assembleNarratedVideoCredits(Math.max(1, wired))
    }
    default:
      return undefined
  }
}

/** Pricing units of a video-utility node: its base credits over one unit (its own one-unit price row). */
export function videoUtilityPricingUnits(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number {
  const base = estimateVideoUtilityBaseCredits(node, nodes, edges, rerunIds)
  return base === undefined ? 1 : base / VIDEO_UTIL_PRICING.CREDIT_UNIT
}

/**
 * The length, in seconds, a Mask Composite is QUOTED at, or `null` when it is
 * not known (the 300 s cap): its leading video's — the foreground on its
 * `video` wire, or, with a pixelate / blur fill, the background on its
 * `background-video` wire — as the measured walk reads it
 * ({@link measuredWireReader}, `maskCompositeLeadSec`), exactly the server's
 * workflow estimate's reading on every graph. A video another node makes in
 * this run is quoted at the length that node will produce, with
 * {@link MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC} on each clip a node makes (the run
 * charges the container's length); a node that does not run, at the take it
 * hands on. The run is always charged the length it measures. No fallback to a
 * length the upstream node merely stores (metadata with no result row for its
 * file, an earlier file's length, a Video link's whole length): the server does
 * not read one either.
 */
export function maskCompositeQuotedSec(
  node: Pick<WorkflowNode, "id" | "data">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | null {
  const data = (node.data ?? {}) as Record<string, unknown>
  const inputs = edges.filter((e) => e.target === node.id)
  const lengthOf = measuredWireReader(nodes, edges, rerunIds, MASK_COMPOSITE_PLANNED_CLIP_SLACK_SEC)
  return maskCompositeLeadSec(data, inputs, inputs.map((e) => lengthOf(e.source))) ?? null
}

/**
 * Mask Composite's pricing units: one per started 5 s of its result
 * ({@link maskCompositeQuotedSec}), or the 300 s cap's 60 when that length is
 * not known yet — an upper bound, as the server's run estimate quotes it.
 */
export function maskCompositePricingUnits(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number {
  return maskCompositeUnits(maskCompositeQuotedSec(node, nodes, edges, rerunIds))
}

/**
 * Whether a Video Overlay is QUOTED on its video row — the shared rule the
 * server's run estimate reads (`videoOverlayQuotesVideo`): a stored video
 * layer on a slot no wire replaces, a layer handle wired from a source that
 * can carry a video, or a layer-plan wire. Otherwise its flat image row.
 */
export function videoOverlayQuotesVideoOf(
  node: Pick<WorkflowNode, "id" | "type" | "data">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): boolean {
  return videoOverlayQuotesVideo({ id: node.id, type: node.type, data: node.data }, nodes, edges)
}

/**
 * The base length, in seconds, a Video Overlay with a video layer is QUOTED
 * at, or `null` when it is not known (the 60 s cap): its `video` wire's length
 * as the measured walk reads it ({@link measuredWireReader},
 * `videoOverlayBaseSec`) — exactly the server's workflow estimate's reading. A
 * video another node makes in this run is quoted at the length that node will
 * produce, with {@link VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC} on each generated
 * clip (the run charges the video stream's length). No fallback to a length the
 * upstream node merely stores (an upload's earlier file): the server does not
 * read one, and a quote below the run, or one that differs between paths, is
 * what this rule rules out.
 */
export function videoOverlayQuotedSec(
  node: Pick<WorkflowNode, "id" | "data">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | null {
  const inputs = edges.filter((e) => e.target === node.id)
  const lengthOf = measuredWireReader(nodes, edges, rerunIds, VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC)
  return videoOverlayBaseSec(inputs, inputs.map((e) => lengthOf(e.source))) ?? null
}

/**
 * The base's length, in seconds, from the SAME wire reading the quote uses
 * ({@link videoOverlayQuotedSec}), before the quote's cap — or `null` when it
 * is not known. The panel warns a base past the cap from it (show-only: the
 * server measures the real file and decides).
 */
export function videoOverlayWireBaseSec(
  node: Pick<WorkflowNode, "id">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): number | null {
  const inputs = edges.filter((e) => e.target === node.id)
  const lengthOf = measuredWireReader(nodes, edges, new Set(), VIDEO_OVERLAY_PLANNED_CLIP_SLACK_SEC)
  return videoOverlayBaseWireSec(inputs, inputs.map((e) => lengthOf(e.source))) ?? null
}

/**
 * Video Overlay's pricing units: 1 for an image-only node (its flat row); one
 * per started 5 s of the base ({@link videoOverlayQuotedSec}) for a node with a
 * video layer, or the 60 s cap's 12 when that length is not known yet — an
 * upper bound, as the server's run estimate quotes it.
 */
export function videoOverlayPricingUnits(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number {
  if (!videoOverlayQuotesVideoOf(node, nodes, edges)) return 1
  return videoOverlayVideoUnits(videoOverlayQuotedSec(node, nodes, edges, rerunIds))
}

/** Is a Video Upscale set to Topaz — the provider a node that names none runs on? */
export function isTopazVideoUpscaleProvider(provider: unknown): boolean {
  return provider === undefined || provider === null || provider === "" || provider === "topaz"
}

/**
 * The source length, in seconds, a Topaz Video Upscale is QUOTED at, or
 * `undefined` when it is not known (the estimate's fallback length then
 * stands in): the length the measured walk gives its video wire
 * ({@link measuredInputReader}, one frame of slack on each clip a node makes —
 * the hold counts the video stream's frames), the reading the server's run
 * estimate prices it by. The run measures the real clip before it reserves.
 */
export function topazVideoQuotedSourceSec(
  node: Pick<WorkflowNode, "id">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | undefined {
  const lengthOf = measuredInputReader("video-upscale", nodes, edges, rerunIds)
  return edges.filter((e) => e.target === node.id).map((e) => lengthOf(e.source)).find((v) => v !== undefined)
}

/** The old relative levers a saved Video Upscale may still hold (the shared resolver's own set). */
const TOPAZ_LEGACY_FACTORS: ReadonlySet<string> = new Set(["1", "2", "4"])

/**
 * The old 1×/2×/4× factor a Topaz Video Upscale still runs by — only while it
 * names no resolution Topaz takes (a target, once set, replaces it). `undefined`
 * for a node set the current way.
 */
export function topazVideoLegacyFactor(data: Record<string, unknown> | undefined): string | undefined {
  if (!data || isTopazVideoResolution(data.targetResolution)) return undefined
  const factor = typeof data.upscaleFactor === "string" ? data.upscaleFactor.trim() : ""
  return TOPAZ_LEGACY_FACTORS.has(factor) ? factor : undefined
}

const positivePx = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined)

/**
 * The pixel size of the video wired into a Video Upscale's `video` input, when
 * the editor has measured it: the source (through teleports) hands on a url,
 * and the result row holding that url records its width and height (an
 * upload records them at upload, any other video when its result is first
 * shown — `useResultAspectRatio`); an upload with no such row, its upload
 * metadata while that upload is still the file it hands on. `undefined`
 * otherwise — an aspect ratio or a resolution SETTING is not a size.
 */
export function topazVideoQuotedSourceSize(
  node: Pick<WorkflowNode, "id">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): Pick<TopazVideoSource, "width" | "height"> | undefined {
  const edge = edges.find((e) => e.target === node.id && e.targetHandle === "video")
  if (!edge) return undefined
  const src = nodes.find((n) => n.id === edge.source)
  const origin = resolveGraphOrigin(src, nodes as WorkflowNode[], edges as WorkflowEdge[])
  if (!origin) return undefined
  const out = readNodeOutput(origin, origin === src ? edge.sourceHandle ?? undefined : undefined)
  const url = typeof out === "string" ? out.trim() : ""
  if (url === "") return undefined
  const data = (origin.data ?? {}) as Record<string, unknown>
  const rows = Array.isArray(data.generatedResults) ? (data.generatedResults as Array<Record<string, unknown> | null | undefined>) : []
  for (const r of rows) {
    if (typeof r?.url !== "string" || r.url.trim() !== url) continue
    const width = positivePx(r.width)
    const height = positivePx(r.height)
    if (width !== undefined && height !== undefined) return { width, height }
  }
  if (origin.type === "upload-video" && !data.externalUrl && typeof data.url === "string" && data.url.trim() === url) {
    const meta = (data.metadata ?? {}) as Record<string, unknown>
    const width = positivePx(meta.width)
    const height = positivePx(meta.height)
    if (width !== undefined && height !== undefined) return { width, height }
  }
  return undefined
}

/**
 * The resolution a Topaz Video Upscale is SHOWN and QUOTED at — the one place
 * the config panel and every estimate read it, so they cannot disagree — and
 * the old factor it runs by, if any. Both from its settings as it runs (a wired
 * Settings input included): a target wins; a saved node that holds only the
 * old factor maps it the way the run does (`resolveTopazVideoTarget`: the
 * factor × the source's short side, to the nearest target) when the wired
 * clip's size is known ({@link topazVideoQuotedSourceSize}), else 1080p.
 */
export function topazVideoQuotedTarget(
  node: Pick<WorkflowNode, "id" | "type" | "data">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): { resolution: TopazVideoResolution; legacyFactor?: string } {
  const data = (withWiredSettings(node, nodes, edges).data ?? {}) as Record<string, unknown>
  const legacyFactor = topazVideoLegacyFactor(data)
  const { resolution } = resolveTopazVideoTarget({
    targetResolution: typeof data.targetResolution === "string" ? data.targetResolution : undefined,
    upscaleFactor: legacyFactor,
    source: legacyFactor === undefined ? undefined : topazVideoQuotedSourceSize(node, nodes, edges),
  })
  return legacyFactor === undefined ? { resolution } : { resolution, legacyFactor }
}

/** The resolution of {@link topazVideoQuotedTarget}. */
export function topazVideoQuotedResolution(
  node: Pick<WorkflowNode, "id" | "type" | "data">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): TopazVideoResolution {
  return topazVideoQuotedTarget(node, nodes, edges).resolution
}

/**
 * The length of the clip a Nodaro Video Upscale node is given, when the graph
 * KNOWS it is past the longest clip a run takes — an upload, a measured Library
 * clip or a take's recorded length (the measured walk's `knownOnly` reading) —
 * such a run is refused before anything is held, so the node's pill shows no
 * figure and the Run confirm says the node is not priced
 * (`nodaroVideoUpscaleRefusesLength`, the rule the server's run estimate reads
 * too). Undefined for any other node, provider or length: a planned length
 * past the limit is quoted at it (`nodaroVideoUpscaleEstimateUnits`), and a
 * length the graph does not know is measured by the run.
 */
export function nodaroVideoUpscaleRefusedSec(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | undefined {
  if (node.type !== "video-upscale") return undefined
  // As it runs: a wired Settings input can set the provider.
  const data = (withWiredSettings(node, nodes, edges).data ?? {}) as Record<string, unknown>
  if (data.provider !== NODARO_VIDEO_UPSCALE_PROVIDER) return undefined
  const knownOf = (sourceId: string) => measuredWireLengthSec(sourceId, nodes, edges, rerunIds, { planOutputOf: readPlan, knownOnly: true })
  const sec = edges.filter((e) => e.target === node.id).map((e) => knownOf(e.source)).find((v) => v !== undefined)
  return nodaroVideoUpscaleRefusesLength(sec) ? sec : undefined
}

/**
 * The Topaz units a Video Upscale is QUOTED at (`topazVideoEstimateUnits`, the
 * rule the server's run estimate reads): its resolution as
 * {@link topazVideoQuotedResolution} reads it, and its frame rate (else 30
 * fps), at the length {@link topazVideoQuotedSourceSec} gives, on a 16:9
 * frame. One unit for every other provider, whose row is the whole price. The
 * node's pill, its Run button, the confirm and the workflow badge all read this.
 */
export function videoUpscalePricingUnits(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number {
  // Priced as it runs: a wired Settings input can set the provider and the target.
  const data = (withWiredSettings(node, nodes, edges).data ?? {}) as Record<string, unknown>
  // Nodaro Video Upscale: a quarter of its tier's four-second row per billed
  // second of the clip, at the length the graph gives (else 10 s), at most the
  // longest clip a run takes — the rule the server's run estimate reads
  // (`nodaroVideoUpscaleEstimateUnits`). A clip the graph KNOWS is past the
  // limit is never priced ({@link nodaroVideoUpscaleRefusedSec}).
  if (data.provider === NODARO_VIDEO_UPSCALE_PROVIDER) {
    return nodaroVideoUpscaleEstimateUnits(topazVideoQuotedSourceSec(node, nodes, edges, rerunIds))
  }
  if (!isTopazVideoUpscaleProvider(data.provider)) return 1
  return topazVideoEstimateUnits({
    resolution: topazVideoQuotedResolution(node, nodes, edges),
    fps: typeof data.targetFps === "number" && Number.isFinite(data.targetFps) ? clampTopazVideoFps(data.targetFps) : undefined,
    durationSec: topazVideoQuotedSourceSec(node, nodes, edges, rerunIds),
  })
}

/**
 * The length, in seconds, of the audio a Lip Sync priced by its audio's length
 * is QUOTED on, or `undefined` when it is not known yet: the audio the
 * editor's own Run of the node plays (`lipSyncAudioSourceId`, decided
 * 2026-11-13: the dropdown-selected node, else the last wired `audio`) as the
 * measured walk reads it ({@link measuredInputReader}: an upload at the length
 * the platform recorded for it, the container slack on audio a node makes in
 * the run, and a voice made again in the run at the take it holds — a
 * minimum). Never a length the Lip Sync node itself carries
 * (`audioDurationSec`, a browser's reading or a client's word): with no audio
 * node to read it is unknown, and a model priced by a length tier is quoted at
 * its top tier. The run measures the real audio before it holds.
 */
export function lipSyncQuotedAudioSec(
  node: Pick<WorkflowNode, "id" | "data">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number | undefined {
  const source = lipSyncAudioSourceId(node, nodes, edges, "editor")
  return source === undefined ? undefined : measuredInputReader("lip-sync", nodes, edges, rerunIds, { voiceTakeAsMinimum: true })(source)
}

/**
 * OmniHuman 2.0's quoted length (decided 2026-11-11, unchanged): the audio the
 * editor's Run plays ({@link lipSyncQuotedAudioSec}), else, with none to read,
 * the length the node measured at its last run (`audioDurationSec`) — its
 * figure is then shown as an estimate only when neither is known.
 */
function rateModelQuotedAudioSec(
  node: Pick<WorkflowNode, "id" | "data">,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string>,
): number | undefined {
  if (lipSyncAudioSourceId(node, nodes, edges, "editor") !== undefined) return lipSyncQuotedAudioSec(node, nodes, edges, rerunIds)
  const own = (node.data as { audioDurationSec?: unknown } | undefined)?.audioDurationSec
  return typeof own === "number" && Number.isFinite(own) && own > 0 ? own : undefined
}

/**
 * The seconds a Lip Sync on a model charged per second of its audio
 * (OmniHuman 2.0) is QUOTED at — the billed seconds of the audio
 * ({@link rateModelQuotedAudioSec}), or, while its length is not known, the
 * 15 seconds every model priced by its audio shows (an estimate) — and 1 for
 * every other model, whose row is the whole price. The node's pill, its Run
 * button, the confirm and the workflow badge all read this.
 */
export function lipSyncPricingUnits(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): number {
  const rate = lipSyncAudioRateOf((withWiredSettings(node, nodes, edges).data as { provider?: unknown } | undefined)?.provider)
  if (!rate) return 1
  return lipSyncEstimateSeconds(rate, rateModelQuotedAudioSec(node, nodes, edges, rerunIds), LIP_SYNC_UNMEASURED_ESTIMATE_SECONDS)
}

/** Is this Lip Sync quoted on a length it does not know yet (a per-second-rate model with no audio length)? Its figure is then an estimate. */
export function lipSyncQuoteIsEstimate(
  node: WorkflowNode,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  rerunIds: ReadonlySet<string> = new Set(),
): boolean {
  const rate = lipSyncAudioRateOf((withWiredSettings(node, nodes, edges).data as { provider?: unknown } | undefined)?.provider)
  return rate !== undefined && rateModelQuotedAudioSec(node, nodes, edges, rerunIds) === undefined
}
