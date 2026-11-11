// backend/src/providers/video/video-overlay.ts
/**
 * Video Overlay provider — spec §4.2, in the order that makes a bad input
 * cheap: base → probe → validate + layout + clamp → each kept layer, one at a
 * time (an image fetched and gated; a video fetched and probed) → geometry →
 * ONE sharp pre-fit pass of the images (decision D1) inside one shared ffmpeg
 * slot → the pure graph → a cancel check → ONE ffmpeg render. A video layer is
 * never pre-fitted (its fit is in the graph); its fetch and its probe are
 * `video-overlay-video-layers.ts`, its placement `placeVideoOverlayVideos`
 * (@nodaro/shared, the one the canvas preview draws with). The caller (the worker
 * handler) owns `workDir` and removes it on every path.
 */
import { join } from "node:path"
import {
  VIDEO_OVERLAY_DEFAULT_BACKGROUND,
  expandVideoOverlayLayout,
  expandVideoOverlayPresets,
  firstVideoLayerIndex,
  formatVideoOverlayError,
  placeVideoOverlayVideos,
  resolveVideoOverlayGeometry,
  validateVideoOverlayRequest,
  videoOverlayCanvas,
  videoOverlayLayerLabel,
  type VideoOverlayBox,
  type VideoOverlayBoxInput,
  type VideoOverlayFit,
  type VideoOverlayLayer,
  type VideoOverlayLayerInput,
  type VideoOverlayOutputAspect,
  type VideoOverlayWarning,
} from "@nodaro/shared/video"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { videoOverlayRefusalAtLength, videoOverlayRefusalForCharge } from "../../lib/video-overlay-refusal.js"
import { throwIfJobCancelled } from "../../lib/job-cancellation.js"
import { downloadFile, probeVideoOverlayBase, runFfmpeg, withFfmpegSlot, type VideoOverlayBaseProbe } from "./ffmpeg-utils.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "./ffmpeg-timeouts.js"
import { buildVideoOverlayGraph, type VideoOverlayGraphLayer } from "./video-overlay-graph.js"
import { fetchVideoOverlayImage, gateVideoOverlayImage, inspectVideoOverlayImage, type VideoOverlayImageTotals } from "./video-overlay-images.js"
import { prefitVideoOverlayLayer } from "./video-overlay-prefit.js"
import {
  fetchVideoOverlayVideoLayer,
  videoOverlayAudioOffset,
  videoOverlayDisplayAspect,
  videoOverlayPeakMemoryMiB,
} from "./video-overlay-video-layers.js"

/** The queue payload (the route's expanded body, or payload-builder's). */
export interface VideoOverlayJobPayload {
  readonly videoUrl: string
  readonly layers: ReadonlyArray<VideoOverlayLayerInput | null>
  readonly outputAspect?: VideoOverlayOutputAspect
  readonly baseFit?: VideoOverlayFit
  readonly backgroundColor?: string
  /** Where the base sits, as written (the validator refuses a malformed one). */
  readonly baseBox?: VideoOverlayBoxInput | null
  /** A named layout (`expandVideoOverlayLayout`); `""` / null = none. */
  readonly layout?: string | null
  /**
   * The freshness key (`videoOverlayCompositionKey`) a DAG payload stamps, or
   * the canvas sends with a REST single-node Run; the handler echoes it into
   * output_data. Not read by the render; absent from a REST call that sent none.
   */
  readonly resultCompositionKey?: string
  /**
   * A run with a video layer: the units of the video row it was charged for —
   * written by the route or the workflow run from its own measurement of the
   * base (a client's field is stripped before the payload is built). The render
   * refuses a base that has grown past them (`videoOverlayRefusalForCharge`).
   */
  readonly billedUnits?: number
}

export interface VideoOverlayRenderResult {
  readonly outputPath: string
  readonly warnings: VideoOverlayWarning[]
  /** The output canvas. */
  readonly width: number
  readonly height: number
  /** The base's video-stream duration = the output's. */
  readonly durationSec: number
}

export interface KeptVideoOverlayLayer {
  readonly index: number
  readonly layer: VideoOverlayLayer
  /** Clamped to the base's duration. */
  readonly end: number
}

/**
 * Step 4 — clamp to the base's VIDEO-stream duration D: `end` absent → D;
 * `end > D` → D + warning `clipped`; `start ≥ D` → dropped + warning
 * `skipped` (its image is never fetched); nothing left → a deterministic
 * refusal (§10 Q2).
 */
export function clampVideoOverlayLayers(
  layers: ReadonlyArray<VideoOverlayLayer>,
  durationSec: number,
): { kept: KeptVideoOverlayLayer[]; warnings: VideoOverlayWarning[] } {
  const d = durationSec.toFixed(2)
  const kept: KeptVideoOverlayLayer[] = []
  const warnings: VideoOverlayWarning[] = []
  layers.forEach((layer, index) => {
    const ref = { layer: index, ...(layer.slot !== undefined ? { slot: layer.slot } : {}), ...(layer.planLayer !== undefined ? { planLayer: layer.planLayer } : {}) }
    if (layer.start >= durationSec) {
      warnings.push({ ...ref, code: "skipped", detail: `starts at ${layer.start} s, after the video ends (${d} s)` })
      return
    }
    let end = layer.end ?? durationSec
    if (end > durationSec) {
      warnings.push({ ...ref, code: "clipped", detail: `ends at ${end} s, clipped to the video end (${d} s)` })
      end = durationSec
    }
    kept.push({ index, layer, end })
  })
  if (kept.length === 0) throw new DeterministicJobError(`Every layer starts after the video ends (${d} s)`)
  return { kept, warnings }
}

/**
 * The pre-fit, with a decode failure filed where spec §4.2 step 5.3 files it:
 * `sharp().metadata()` reads only the header, so a truncated or corrupt JPEG /
 * PNG passes the gate and fails HERE ("VipsJpeg: premature end of JPEG image",
 * "pngload: end of stream"). That is a pure function of the file — one
 * attempt, a refund, the gate's own words; libvips' text for the operator
 * only. A system error (errno `code`: disk full, too many open files) is not
 * the image's fault and is rethrown as is, so BullMQ retries it.
 */
async function prefitVideoOverlayLayerOrRefuse(
  src: string,
  dest: string,
  size: { readonly width: number; readonly height: number },
  fit: VideoOverlayFit,
  ref: { readonly layer: number; readonly slot?: number; readonly planLayer?: number },
): Promise<{ width: number; height: number }> {
  try {
    return await prefitVideoOverlayLayer(src, dest, size, fit)
  } catch (err) {
    if (typeof (err as { code?: unknown } | null)?.code === "string") throw err
    const detail = err instanceof Error ? err.message : String(err)
    throw Object.assign(
      new DeterministicJobError(`${videoOverlayLayerLabel(ref)}: not an image (PNG, JPEG or WebP)`, { cause: err }),
      { internalDetails: detail },
    )
  }
}

export async function renderVideoOverlay(payload: VideoOverlayJobPayload, workDir: string): Promise<VideoOverlayRenderResult> {
  // 2. The base first. A failed download is an ordinary error: BullMQ retries.
  const inputPath = join(workDir, "input.mp4")
  await downloadFile(payload.videoUrl, inputPath)
  // 3. Probe BEFORE any image is fetched — a base that is not a video fails once, here.
  const probe = await probeVideoOverlayBase(inputPath)
  // 4. Validate (the last net: a queue payload can come from either engine),
  // then write what the layout writes (the verdict is the same either side), then clamp.
  const expanded = expandVideoOverlayPresets(payload.layers ?? [])
  const verdict = validateVideoOverlayRequest({ ...payload, layers: expanded })
  if (!verdict.ok) throw new DeterministicJobError(formatVideoOverlayError(verdict))
  const request = expandVideoOverlayLayout({ ...payload, layers: expanded })
  const layers = request.layers
  // What the base's length decides — the cap for a run with a video layer, and a
  // length that leaves nothing to draw or nothing to stack — by the rule the
  // route and the workflow run refused it with before charging; then that the
  // run was charged for this length (the base may have changed since its price
  // was measured). Refused before anything is fetched, and refunded.
  const lengthRefusal = videoOverlayRefusalAtLength(request, probe.streamDurationSec) ?? videoOverlayRefusalForCharge(layers, payload.billedUnits, probe.streamDurationSec)
  if (lengthRefusal) throw new DeterministicJobError(lengthRefusal.message)
  const { kept, warnings } = clampVideoOverlayLayers(layers, probe.streamDurationSec)
  const firstVideo = firstVideoLayerIndex(layers)
  // 5. Fetch every kept layer, one at a time — a bad one stops the next download.
  // An image is fetched and gated; a video is fetched under its own byte cap and
  // probed (its bytes are not the images' total).
  let totals: VideoOverlayImageTotals = { bytes: 0, pixels: 0 }
  const images: Array<{
    readonly kept: KeptVideoOverlayLayer
    readonly ref: { readonly layer: number; readonly slot?: number; readonly planLayer?: number }
    readonly path: string
    readonly aspect: number
  }> = []
  const videos: Array<{ readonly kept: KeptVideoOverlayLayer; readonly path: string; readonly probe: VideoOverlayBaseProbe; readonly aspect: number }> = []
  for (const k of kept) {
    const ref = { layer: k.index, ...(k.layer.slot !== undefined ? { slot: k.layer.slot } : {}), ...(k.layer.planLayer !== undefined ? { planLayer: k.layer.planLayer } : {}) }
    if (k.layer.videoUrl) {
      const path = join(workDir, `video-${k.index}`)
      const fetched = await fetchVideoOverlayVideoLayer(k.layer.videoUrl, path, ref)
      if (k.layer.sound && fetched.probe.audioCodec === null) {
        warnings.push({ ...ref, code: "layer_no_audio", detail: "the video has no sound, so none was mixed in" })
      }
      videos.push({ kept: k, path, ...fetched })
      continue
    }
    const path = join(workDir, `image-${k.index}`)
    await fetchVideoOverlayImage(k.layer.imageUrl!, path, ref)
    const gate = gateVideoOverlayImage(await inspectVideoOverlayImage(path), totals, ref)
    totals = gate.totals
    if (gate.warning) warnings.push(gate.warning)
    images.push({ kept: k, ref, path, aspect: gate.aspect })
  }
  // 6–7. Geometry on the output canvas, then ONE pre-fit pass inside ONE shared
  // ffmpeg slot — released before the render acquires its own (a nested acquire
  // would hold two slots per job and can deadlock at concurrency 4). A run with
  // no image holds no slot here.
  const canvas = videoOverlayCanvas(probe, payload.outputAspect)!
  const placement = placeVideoOverlayVideos({
    canvas,
    layout: request.layout,
    ...(request.baseBox != null ? { baseBox: request.baseBox as VideoOverlayBox } : {}),
    baseAspect: videoOverlayDisplayAspect(probe),
    firstVideo,
    videos: videos.map((v) => ({ index: v.kept.index, layer: v.kept.layer, aspect: v.aspect })),
  })
  const videoLayers: VideoOverlayGraphLayer[] = videos.map((v) => {
    const { layer } = v.kept
    const { drawn, fit } = placement.layers.get(v.kept.index)!
    return {
      index: v.kept.index,
      ...(layer.slot !== undefined ? { slot: layer.slot } : {}),
      ...(layer.planLayer !== undefined ? { planLayer: layer.planLayer } : {}),
      path: v.path,
      // No pre-fit runs for a video: the graph fits it to `drawn`.
      prefit: { width: drawn.width, height: drawn.height },
      start: layer.start,
      end: v.kept.end,
      drawn,
      opacity: layer.opacity,
      animate: layer.animate,
      ...(layer.zIndex !== undefined ? { zIndex: layer.zIndex } : {}),
      video: { fit, hasAudio: v.probe.audioCodec !== null, ...(layer.sound ? { sound: layer.sound } : {}), ...videoOverlayAudioOffset(v.probe) },
    }
  })
  const imageLayers = images.length === 0 ? [] : await withFfmpegSlot(async () => {
    const out: VideoOverlayGraphLayer[] = []
    for (const img of images) {
      const { layer } = img.kept
      const { drawn } = resolveVideoOverlayGeometry(canvas, layer, img.aspect)
      const path = join(workDir, `layer-${img.kept.index}.png`)
      const prefit = await prefitVideoOverlayLayerOrRefuse(img.path, path, { width: drawn.width, height: drawn.height }, layer.fit, img.ref)
      out.push({
        index: img.kept.index,
        ...(layer.slot !== undefined ? { slot: layer.slot } : {}),
        ...(layer.planLayer !== undefined ? { planLayer: layer.planLayer } : {}),
        path,
        prefit,
        start: layer.start,
        end: img.kept.end,
        drawn,
        opacity: layer.opacity,
        animate: layer.animate,
        ...(layer.zIndex !== undefined ? { zIndex: layer.zIndex } : {}),
      })
    }
    return out
    // Raster prefits in an ffmpeg slot: the same limit as an ffmpeg run, so the
    // slot is always released (Track 0.13, decided 2026-10-04).
  }, { timeoutMs: DEFAULT_FFMPEG_TIMEOUT_MS, label: "Video Overlay layer prefit" })
  // 8. The pure graph, its layers in kept order (the graph orders them for drawing).
  const byIndex = new Map([...imageLayers, ...videoLayers].map((l) => [l.index, l]))
  const graphLayers = kept.map((k) => byIndex.get(k.index)!)
  const { basePlacement } = placement
  const outputPath = join(workDir, "output.mp4")
  const graph = buildVideoOverlayGraph({
    inputPath,
    outputPath,
    probe,
    canvas,
    ...(payload.outputAspect ? { outputAspect: payload.outputAspect } : {}),
    baseFit: payload.baseFit ?? "cover",
    backgroundColor: payload.backgroundColor ?? VIDEO_OVERLAY_DEFAULT_BACKGROUND,
    ...(basePlacement ? { basePlacement } : {}),
    layers: graphLayers,
  })
  // A mixed soundtrack is AAC by construction: nothing of the base's codec is kept to report.
  if (graph.audioReencoded && !graph.audioMixed) warnings.push({ code: "audio_reencoded", detail: `the base's ${probe.audioCodec} audio was re-encoded to AAC` })
  // 9. A cancel during the downloads costs no render. Once the base probed
  // cleanly every render failure is a pure function of the inputs: one attempt,
  // a refund, ffmpeg's tail for the operator only. A run that decodes more than
  // the base (a video layer, or the base's canvas copy) reserves for it; an
  // image-only run launches exactly as before, on the default estimate.
  await throwIfJobCancelled()
  try {
    if (videos.length === 0 && !basePlacement) await runFfmpeg(graph.args)
    else {
      const decoded = [probe, ...videos.map((v) => v.probe)]
      await runFfmpeg(graph.args, DEFAULT_FFMPEG_TIMEOUT_MS, { peakMemoryMiB: videoOverlayPeakMemoryMiB(canvas, decoded, !!basePlacement) })
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const message =
      (err as { timedOut?: unknown }).timedOut === true
        ? "Render exceeded the 10-minute limit"
        : "Video Overlay could not render this combination of video and layers"
    throw Object.assign(new DeterministicJobError(message, { cause: err }), { internalDetails: detail })
  }
  return { outputPath, warnings, width: canvas.w, height: canvas.h, durationSec: probe.streamDurationSec }
}
