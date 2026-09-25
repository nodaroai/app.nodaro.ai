// backend/src/providers/video/video-overlay.ts
/**
 * Video Overlay provider — spec §4.2, in the order that makes a bad input
 * cheap: base → probe → validate + clamp → images (fetched and gated one at a
 * time) → geometry → ONE sharp pre-fit pass (decision D1) inside one shared
 * ffmpeg slot → the pure graph → a cancel check → ONE ffmpeg render. The
 * caller (the worker handler) owns `workDir` and removes it on every path.
 */
import { join } from "node:path"
import {
  VIDEO_OVERLAY_DEFAULT_BACKGROUND,
  expandVideoOverlayPresets,
  formatVideoOverlayError,
  resolveVideoOverlayGeometry,
  validateVideoOverlayRequest,
  videoOverlayCanvas,
  videoOverlayLayerLabel,
  type VideoOverlayFit,
  type VideoOverlayLayer,
  type VideoOverlayLayerInput,
  type VideoOverlayOutputAspect,
  type VideoOverlayWarning,
} from "@nodaro/shared"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { throwIfJobCancelled } from "../../lib/job-cancellation.js"
import { downloadFile, probeVideoOverlayBase, runFfmpeg, withFfmpegSlot } from "./ffmpeg-utils.js"
import { buildVideoOverlayGraph, type VideoOverlayGraphLayer } from "./video-overlay-graph.js"
import { fetchVideoOverlayImage, gateVideoOverlayImage, inspectVideoOverlayImage, type VideoOverlayImageTotals } from "./video-overlay-images.js"
import { prefitVideoOverlayLayer } from "./video-overlay-prefit.js"

/** The queue payload (the route's expanded body, or payload-builder's). */
export interface VideoOverlayJobPayload {
  readonly videoUrl: string
  readonly layers: ReadonlyArray<VideoOverlayLayerInput | null>
  readonly outputAspect?: VideoOverlayOutputAspect
  readonly baseFit?: VideoOverlayFit
  readonly backgroundColor?: string
  /**
   * The freshness key (`videoOverlayCompositionKey`) a DAG payload stamps, or
   * the canvas sends with a REST single-node Run; the handler echoes it into
   * output_data. Not read by the render; absent from a REST call that sent none.
   */
  readonly resultCompositionKey?: string
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
    const ref = { layer: index, ...(layer.slot !== undefined ? { slot: layer.slot } : {}) }
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
  ref: { readonly layer: number; readonly slot?: number },
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
  // 4. Validate (the last net: a queue payload can come from either engine), then clamp.
  const layers = expandVideoOverlayPresets(payload.layers ?? [])
  const verdict = validateVideoOverlayRequest({ ...payload, layers })
  if (!verdict.ok) throw new DeterministicJobError(formatVideoOverlayError(verdict))
  const { kept, warnings } = clampVideoOverlayLayers(layers, probe.streamDurationSec)
  // 5. Fetch and gate every kept image, one at a time — a bad image stops the next download.
  let totals: VideoOverlayImageTotals = { bytes: 0, pixels: 0 }
  const images: Array<{
    readonly kept: KeptVideoOverlayLayer
    readonly ref: { readonly layer: number; readonly slot?: number }
    readonly path: string
    readonly aspect: number
  }> = []
  for (const k of kept) {
    const ref = { layer: k.index, ...(k.layer.slot !== undefined ? { slot: k.layer.slot } : {}) }
    const path = join(workDir, `image-${k.index}`)
    await fetchVideoOverlayImage(k.layer.imageUrl!, path, ref)
    const gate = gateVideoOverlayImage(await inspectVideoOverlayImage(path), totals, ref)
    totals = gate.totals
    if (gate.warning) warnings.push(gate.warning)
    images.push({ kept: k, ref, path, aspect: gate.aspect })
  }
  // 6–7. Geometry on the output canvas, then ONE pre-fit pass inside ONE shared
  // ffmpeg slot — released before the render acquires its own (a nested acquire
  // would hold two slots per job and can deadlock at concurrency 4).
  const canvas = videoOverlayCanvas(probe, payload.outputAspect)!
  const graphLayers = await withFfmpegSlot(async () => {
    const out: VideoOverlayGraphLayer[] = []
    for (const img of images) {
      const { layer } = img.kept
      const { drawn } = resolveVideoOverlayGeometry(canvas, layer, img.aspect)
      const path = join(workDir, `layer-${img.kept.index}.png`)
      const prefit = await prefitVideoOverlayLayerOrRefuse(img.path, path, { width: drawn.width, height: drawn.height }, layer.fit, img.ref)
      out.push({
        index: img.kept.index,
        ...(layer.slot !== undefined ? { slot: layer.slot } : {}),
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
  })
  // 8. The pure graph.
  const outputPath = join(workDir, "output.mp4")
  const graph = buildVideoOverlayGraph({
    inputPath,
    outputPath,
    probe,
    canvas,
    ...(payload.outputAspect ? { outputAspect: payload.outputAspect } : {}),
    baseFit: payload.baseFit ?? "cover",
    backgroundColor: payload.backgroundColor ?? VIDEO_OVERLAY_DEFAULT_BACKGROUND,
    layers: graphLayers,
  })
  if (graph.audioReencoded) warnings.push({ code: "audio_reencoded", detail: `the base's ${probe.audioCodec} audio was re-encoded to AAC` })
  // 9. A cancel during the downloads costs no render. Once the base probed
  // cleanly every render failure is a pure function of the inputs: one attempt,
  // a refund, ffmpeg's tail for the operator only.
  await throwIfJobCancelled()
  try {
    await runFfmpeg(graph.args)
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
