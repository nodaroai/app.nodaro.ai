/**
 * DRAW THE FACE MESH ON A CLIP — the core of `POST /v1/video-face-mesh`.
 *
 * Frame by frame, at the same index in every clip:
 *   1. the faces are FOUND in the original clip (`videoPath`) with YuNet (the
 *      detector Speaker Frames uses, `../face-detect/`);
 *   2. each face that passes the filters (`face-mesh-filters.ts`: inside the
 *      mask, the size limits, the zone) is cropped square around its box,
 *      turned level by its eyes, and run through the landmark model
 *      (`face-mesh-crop.ts`, `face-mesh-session.ts`); a presence under 0.5
 *      draws nothing for that face in that frame;
 *   3. a face found so gets lines only when it is found in at least 3 frames
 *      of its track (`face-mesh-tracks.ts`): one found in a frame or two (a
 *      tiny face far back, a dark gap read as a face) is never drawn. Each
 *      frame waits, held as a copy, until the 4 frames after it are read
 *      (`FACE_MESH_LOOKAHEAD_FRAMES`), then goes on to be drawn and written,
 *      in order (the end of the clip decides the last ones);
 *   4. the points of the faces drawn are smoothed over time per face
 *      (`face-mesh-smooth.ts`: every frame, in order, only the faces drawn;
 *      the irises' 10 points too when they are drawn); with the contours on,
 *      their depths too, and what each face hides of its lines
 *      (`face-mesh-visibility.ts`) is worked out from them and held steady
 *      the same way;
 *   5. the lines of the layers asked for (`parts`, or `layers`:
 *      `face-mesh-layers.ts`) are drawn on the clip they go on (`drawOnPath`:
 *      the masked or depth clip) at their place (`face-mesh-draw.ts`), as fractions of the
 *      frame — the clips may differ in size — in tones of the picture under
 *      them: a gray of the pixel's own luminance, or, given the gray depth
 *      render and the map (`depth`), a colour of the map.
 * The mask is read frame for frame when it has the clip's frame count, else
 * by TIME (`face-mesh-timing.ts`: Video Mask re-encodes a variable-rate clip
 * to a constant rate, so its mask has another count).
 * The output has EXACTLY `drawOnPath`'s frame count (every clip is counted
 * first, and a mismatch is refused), size and frame rate, its audio stream
 * copied untouched. No face anywhere is not a failure: the clip comes back
 * re-encoded with nothing drawn (`facesDrawn: 0`).
 *
 * Every decoder, both onnxruntime sessions, sharp, the frames held and the
 * encoder run inside ONE admission hold (`withFfmpegSlot`,
 * `faceMeshPeakMemoryMiB`), started
 * through the one launcher (`spawnFfmpeg`). The decoders run in lockstep with
 * `-fps_mode passthrough`, so ffmpeg never duplicates or drops a frame.
 */
import { once } from "node:events"
import { join } from "node:path"
import type { Writable } from "node:stream"
import type { VideoDepthColormap, VideoFaceMeshLayers, VideoFaceMeshParts } from "@nodaro/shared/media"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { ffmpegFailureMessage, probeVideoOverlayBase, runFfprobe, withFfmpegSlot, type VideoOverlayBaseProbe } from "../../providers/video/ffmpeg-utils.js"
import { spawnFfmpeg } from "../../providers/video/ffmpeg-process.js"
import { ffmpegEffectiveThreads } from "../../providers/video/ffmpeg-threads.js"
import { countVideoFrames } from "../../providers/video/video-mask.js"
import { decodeYunet, fillYunetInput, paddedSize, type YunetFace } from "../face-detect/yunet-decode.js"
import { yunetSession } from "../face-detect/yunet-session.js"
import { FACE_MESH_INPUT_SIZE, FACE_MESH_MODEL_POINTS, FACE_MESH_POINTS } from "./face-mesh-model.js"
import { faceMeshSession } from "./face-mesh-session.js"
import { FACE_MESH_MIN_PRESENCE, fillFaceMeshInput, landmarkDepths, landmarksToFrame, roiOfFace, sigmoid } from "./face-mesh-crop.js"
import { faceGetsMesh, type FaceMeshFilters } from "./face-mesh-filters.js"
import { FaceMeshTracker, type MeshedFace } from "./face-mesh-smooth.js"
import { FaceMeshLookahead, type DecidedFrame } from "./face-mesh-tracks.js"
import { compositeFaceMesh, faceMeshOverlay, type FaceMeshDrawing } from "./face-mesh-draw.js"
import { drawsIrises, hidesFarSide, layerSetOf, visibilityLayoutOf, visibilityOfLayout } from "./face-mesh-layers.js"
import { depthColormapTable } from "./depth-colormaps.js"
import { faceMeshPeakMemoryMiB, faceMeshTimeoutMs } from "./face-mesh-budget.js"
import { frameTimesOf, maskFramesForClip, sameSpan } from "./face-mesh-timing.js"

/** YuNet's score floor for a face to be meshed (the landmark model's presence is the second gate). */
export const FACE_MESH_MIN_DETECT_SCORE = 0.6
/** The detector reads a frame at most this long on its longer side (larger frames are sampled down for it only). */
export const FACE_MESH_DETECT_MAX_EDGE = 1280

export interface DrawFaceMeshInput {
  /** Local path of the clip the faces are found in. */
  readonly videoPath: string
  /** Local path of the clip the lines are drawn on (may be `videoPath`). */
  readonly drawOnPath: string
  /** Local path of a mask video (white = covered): only faces centred inside it are drawn. */
  readonly maskPath?: string
  /**
   * The depth map the lines go on (`drawOnPath` is, or holds, its `colormap`
   * render): `path` is the GRAYSCALE depth render of the same clip (same frame
   * count, any size), and each line is a colour of `colormap` at its tone of
   * the depth under it (`compositeFaceMesh`). Left out: each line is a gray
   * tone of the drawn-on pixel itself.
   */
  readonly depth?: { readonly path: string; readonly colormap: VideoDepthColormap }
  /**
   * What is drawn on each face (`VideoFaceMeshParts`): left out or `"full"`,
   * the wireframe and the eye and lip outlines, as before; `"features"`, the
   * eye and lip outlines alone; `"mouth"`, the lip outline alone;
   * `"contours"`, the eye and lip outlines, the oval, the brows and the nose,
   * each only where the face does not hide it.
   */
  readonly parts?: VideoFaceMeshParts
  /** What is drawn, layer by layer (`VideoFaceMeshLayers`), in place of `parts`. */
  readonly layers?: VideoFaceMeshLayers
  readonly filters: FaceMeshFilters
  /** Where the output is written. */
  readonly outputPath: string
}

export interface DrawFaceMeshResult {
  readonly outputPath: string
  readonly width: number
  readonly height: number
  readonly frames: number
  readonly framesWithFaces: number
  readonly facesDrawn: number
  /** This process's CPU inside the hold, ms (detection, landmarks, drawing, JS) — not the ffmpeg children. */
  readonly cpuMs: number
}

/** The clip cannot be used as given (unreadable, frame counts that differ, an odd size). */
export class FaceMeshInputError extends DeterministicJobError {
  constructor(message: string) {
    super(`face mesh: ${message}`)
    this.name = "FaceMeshInputError"
  }
}

interface ClipInfo {
  readonly probe: VideoOverlayBaseProbe
  readonly frames: number
}

/**
 * A frame waiting for its faces' tracks: a copy of the drawn clip's frame and,
 * when a face is found in it and the lines take a depth map's colours, of the
 * depth render's — each decoder reuses its buffer for the next frame.
 */
interface HeldFrame {
  readonly rgb: Buffer
  readonly depth?: Buffer
}

/** The video stream's frame times from its first frame, sorted; null when ffprobe cannot say. */
async function frameTimes(path: string): Promise<number[] | null> {
  try {
    return frameTimesOf(await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", path]))
  } catch {
    return null
  }
}

/**
 * For each clip frame, the mask frame read with it: index to index when the
 * counts agree, else the mask frame shown at the clip frame's moment. Refused
 * when the times cannot be read, or the two do not span the same time.
 */
async function maskFrameMap(videoPath: string, maskPath: string, frames: number, maskFrames: number): Promise<Int32Array> {
  if (maskFrames === frames) return Int32Array.from({ length: frames }, (_, i) => i)
  const [clip, mask] = await Promise.all([frameTimes(videoPath), frameTimes(maskPath)])
  if (!clip || !mask || clip.length !== frames || mask.length !== maskFrames) {
    throw new FaceMeshInputError(`the mask has ${maskFrames} frames, the video ${frames}, and their frame times could not be read`)
  }
  if (!sameSpan(clip, mask)) {
    throw new FaceMeshInputError(`the mask spans ${mask.at(-1)!.toFixed(2)} s and the video ${clip.at(-1)!.toFixed(2)} s: it is not this video's mask`)
  }
  return maskFramesForClip(clip, mask)
}

async function clipInfo(path: string, what: string): Promise<ClipInfo> {
  let probe: VideoOverlayBaseProbe
  try {
    probe = await probeVideoOverlayBase(path)
  } catch (err) {
    if ((err as { timedOut?: unknown }).timedOut === true) throw err
    throw new FaceMeshInputError(`the ${what} could not be read`)
  }
  if (!(probe.width > 0 && probe.height > 0)) throw new FaceMeshInputError(`the ${what} has no picture`)
  const frames = (await countVideoFrames(path)) ?? probe.frameCount
  if (!frames) throw new FaceMeshInputError(`the ${what}'s frames could not be counted`)
  return { probe, frames }
}

/**
 * The drawn clip's colour: the YUV↔RGB matrix and range its frames are read
 * and written with, and the tags the output carries — the clip's own, so the
 * frames come back as they went in (a re-encode with untagged BT.601 output
 * would shift every colour a player shows, and the depth clip's colours are
 * what the video model reads). Untagged = BT.709, limited range.
 */
export interface ClipColour {
  /** swscale's matrix name. */
  readonly matrix: "bt709" | "bt601" | "bt2020"
  readonly range: "tv" | "pc"
  /** The output's tags (ffmpeg's names). */
  readonly space: string
  readonly primaries: string
  readonly transfer: string
}

/** The colour of a probed stream's tags (pure). */
export function clipColourOf(tags: { color_space?: string; color_range?: string; color_primaries?: string; color_transfer?: string }): ClipColour {
  const space = tags.color_space ?? ""
  const matrix = space === "smpte170m" || space === "bt470bg" ? "bt601" : space.startsWith("bt2020") ? "bt2020" : "bt709"
  const known = (v: string | undefined) => (v && v !== "unknown" && v !== "reserved" ? v : undefined)
  return {
    matrix,
    range: tags.color_range === "pc" ? "pc" : "tv",
    space: known(space) ?? (matrix === "bt601" ? "smpte170m" : matrix === "bt2020" ? "bt2020nc" : "bt709"),
    primaries: known(tags.color_primaries) ?? (matrix === "bt601" ? "smpte170m" : matrix === "bt2020" ? "bt2020" : "bt709"),
    transfer: known(tags.color_transfer) ?? (matrix === "bt2020" ? "bt2020-10" : matrix === "bt601" ? "smpte170m" : "bt709"),
  }
}

/** The colour tags of `path`'s first video stream (`clipColourOf`; untagged when ffprobe cannot say). */
export async function probeColour(path: string): Promise<ClipColour> {
  try {
    const out = await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_space,color_range,color_primaries,color_transfer", "-of", "json", path])
    const s = (JSON.parse(out) as { streams?: Array<Record<string, string>> }).streams?.[0] ?? {}
    return clipColourOf(s)
  } catch {
    return clipColourOf({})
  }
}

/**
 * The frame rate the drawn clip is encoded at: its nominal rate for a
 * constant-rate clip (the average within 1 % of it); a variable-rate one at
 * its AVERAGE (its frames over its length), so it keeps its length and its
 * copied audio stays in sync, its frames evenly spaced over it — raw frames on
 * a pipe carry no times of their own. Pure.
 */
export function frameRateOf(p: Pick<VideoOverlayBaseProbe, "rFrameRate" | "avgFrameRate">): string {
  const value = (r: string | undefined): number | undefined => {
    if (!r || !/^\d+(?:\/\d+)?$/.test(r)) return undefined
    const [n, d] = r.split("/").map(Number)
    const v = n! / (d ?? 1)
    return Number.isFinite(v) && v > 0 ? v : undefined
  }
  const nominal = value(p.rFrameRate)
  const average = value(p.avgFrameRate)
  if (nominal !== undefined && (average === undefined || Math.abs(average - nominal) <= 0.01 * nominal)) return p.rFrameRate!
  if (average !== undefined) return p.avgFrameRate!
  return "30/1"
}

const fpsOf = (rate: string): number => {
  const [n, d] = rate.split("/").map(Number)
  return d ? n! / d : n!
}

/**
 * Decode `path` as raw frames of `width × height` (`pixFmt`: 3 bytes a pixel
 * for bgr24 / rgb24, 1 for gray), one REUSED buffer at a time, in display
 * orientation, never a frame duplicated or dropped. Spawned only inside the
 * caller's hold (this file's `drawFaceMeshVideo`, and the mask outline's
 * `drawMaskOutlineVideo`, which hold theirs around it). `what` names the step
 * in a timeout's message.
 */
export async function* streamFrames(
  path: string,
  opts: { pixFmt: "bgr24" | "rgb24" | "gray"; width: number; height: number; timeoutMs: number; colour?: ClipColour; what?: string },
): AsyncGenerator<Buffer> {
  const read = opts.colour ? `:in_color_matrix=${opts.colour.matrix}:in_range=${opts.colour.range}` : ""
  const args = [
    "-nostdin", "-v", "error",
    "-i", path,
    "-map", "0:v:0", "-an", "-sn", "-dn",
    "-vf", `scale=${opts.width}:${opts.height}${read}`,
    "-fps_mode", "passthrough",
    "-f", "rawvideo", "-pix_fmt", opts.pixFmt,
    "pipe:1",
  ]
  const proc = spawnFfmpeg(args, { stdio: ["ignore", "pipe", "pipe"] })
  let stderr = ""
  proc.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString()).slice(-8_000) })
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    proc.on("error", reject)
    proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => resolve({ code, signal }))
  })
  closed.catch(() => undefined)
  let timedOut = false
  const watchdog = setTimeout(() => { timedOut = true; proc.kill("SIGKILL") }, opts.timeoutMs)
  const size = opts.width * opts.height * (opts.pixFmt === "gray" ? 1 : 3)
  const frame = Buffer.allocUnsafe(size)
  let filled = 0
  try {
    for await (const chunk of proc.stdout as AsyncIterable<Buffer>) {
      let at = 0
      while (at < chunk.length) {
        const take = Math.min(size - filled, chunk.length - at)
        chunk.copy(frame, filled, at, at + take)
        filled += take
        at += take
        if (filled === size) {
          filled = 0
          yield frame
        }
      }
    }
    const { code, signal } = await closed
    if (timedOut) throw new Error(`${opts.what ?? "face mesh"}: a decode passed its ${Math.round(opts.timeoutMs / 1000)} s budget`)
    if (code !== 0) throw new Error(ffmpegFailureMessage(stderr, signal ? `killed (${signal})` : `exit ${code}`))
  } finally {
    clearTimeout(watchdog)
    if (proc.exitCode === null) proc.kill("SIGKILL")
  }
}

/** The encoder's argv: raw RGB frames on stdin at the drawn clip's size and rate, its audio copied. Pure. */
export function buildFaceMeshEncodeArgs(o: { width: number; height: number; frameRate: string; audioFrom: string; outputPath: string; colour?: ClipColour }): string[] {
  const c = o.colour ?? clipColourOf({})
  return [
    "-y", "-nostdin", "-v", "error",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${o.width}x${o.height}`, "-framerate", o.frameRate,
    "-i", "pipe:0",
    "-i", o.audioFrom,
    "-map", "0:v:0", "-map", "1:a:0?",
    "-fps_mode", "passthrough",
    // Written back with the clip's own matrix and range, and tagged as it was.
    "-vf", `scale=out_color_matrix=${c.matrix}:out_range=${c.range},format=yuv420p,setparams=colorspace=${c.space}:color_primaries=${c.primaries}:color_trc=${c.transfer}:range=${c.range}`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p",
    "-colorspace", c.space, "-color_primaries", c.primaries, "-color_trc", c.transfer, "-color_range", c.range,
    "-c:a", "copy",
    "-movflags", "+faststart",
    o.outputPath,
  ]
}

async function writeFrame(stdin: Writable, frame: Buffer): Promise<void> {
  if (!stdin.write(frame)) await once(stdin, "drain")
}

const even = (n: number) => n % 2 === 0

/** Sample a packed BGR frame down (nearest pixel) to `dw × dh`. */
function sampleDown(bgr: Buffer, w: number, h: number, dw: number, dh: number, out: Uint8Array): void {
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / dh))
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / dw))
      const s = (sy * w + sx) * 3
      const d = (y * dw + x) * 3
      out[d] = bgr[s]!
      out[d + 1] = bgr[s + 1]!
      out[d + 2] = bgr[s + 2]!
    }
  }
}

export async function drawFaceMeshVideo(input: DrawFaceMeshInput): Promise<DrawFaceMeshResult> {
  // Refuse before anything is decoded: no model or no native module is deterministic.
  const detector = await yunetSession()
  const mesh = await faceMeshSession()

  const found = await clipInfo(input.videoPath, "video")
  const drawOn = input.drawOnPath === input.videoPath ? found : await clipInfo(input.drawOnPath, "video to draw on")
  const mask = input.maskPath ? await clipInfo(input.maskPath, "mask") : undefined
  const depthClip = input.depth ? await clipInfo(input.depth.path, "depth video") : undefined
  if (drawOn.frames !== found.frames) {
    throw new FaceMeshInputError(`the video to draw on has ${drawOn.frames} frames, the video ${found.frames}`)
  }
  if (depthClip && depthClip.frames !== found.frames) {
    throw new FaceMeshInputError(`the depth video has ${depthClip.frames} frames, the video ${found.frames}`)
  }
  const frames = found.frames
  // The mask may come from Video Mask's constant-rate copy of a variable-rate clip: matched by time then.
  const maskOf = mask && input.maskPath ? await maskFrameMap(input.videoPath, input.maskPath, frames, mask.frames) : undefined
  const det = { width: found.probe.width, height: found.probe.height }
  const draw = { width: drawOn.probe.width, height: drawOn.probe.height }
  if (!even(draw.width) || !even(draw.height)) {
    throw new FaceMeshInputError(`the video to draw on is ${draw.width}×${draw.height}: an H.264 copy needs an even width and height`)
  }
  const maskSize = mask ? { width: mask.probe.width, height: mask.probe.height } : undefined
  const depthSize = depthClip ? { width: depthClip.probe.width, height: depthClip.probe.height } : undefined
  const depthTable = input.depth ? depthColormapTable(input.depth.colormap) : undefined
  const depthColour = input.depth ? await probeColour(input.depth.path) : undefined
  // The detector's own picture: the frame, sampled down when it is very large.
  const k = Math.min(1, FACE_MESH_DETECT_MAX_EDGE / Math.max(det.width, det.height))
  const dw = Math.max(2, Math.round(det.width * k))
  const dh = Math.max(2, Math.round(det.height * k))
  const { pw, ph } = paddedSize(dw, dh)
  const frameRate = frameRateOf(drawOn.probe)
  const colour = await probeColour(input.drawOnPath)
  const timeoutMs = faceMeshTimeoutMs(frames)
  const peakMemoryMiB = faceMeshPeakMemoryMiB(
    { detect: det, draw, ...(maskSize ? { mask: maskSize } : {}), ...(depthSize ? { depth: depthSize } : {}) },
    Math.max(detector.intraOpThreads, mesh.intraOpThreads),
    ffmpegEffectiveThreads(),
  )

  const counted = await withFfmpegSlot(async () => {
    const cpu0 = process.cpuUsage()
    const enc = spawnFfmpeg(
      buildFaceMeshEncodeArgs({ ...draw, frameRate, audioFrom: input.drawOnPath, outputPath: input.outputPath, colour }),
      { stdio: ["pipe", "ignore", "pipe"] },
    )
    let encErr = ""
    enc.stderr.on("data", (c: Buffer) => { encErr = (encErr + c.toString()).slice(-8_000) })
    const encClosed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      enc.on("error", reject)
      enc.on("close", (code: number | null, signal: NodeJS.Signals | null) => resolve({ code, signal }))
    })
    encClosed.catch(() => undefined)
    enc.stdin.on("error", () => { /* surfaced by close */ })
    const watchdog = setTimeout(() => enc.kill("SIGKILL"), timeoutMs)

    // The clip and the clip drawn on, in lockstep; the mask read forward to the frame each clip frame takes.
    const sources = [
      streamFrames(input.videoPath, { pixFmt: "bgr24", ...det, timeoutMs }),
      streamFrames(input.drawOnPath, { pixFmt: "rgb24", ...draw, timeoutMs, colour }),
      // The depth, read as RGB with its own colour (its luminance the depth) in lockstep.
      ...(input.depth && depthSize ? [streamFrames(input.depth.path, { pixFmt: "rgb24", ...depthSize, timeoutMs, colour: depthColour })] : []),
    ]
    const maskStream = input.maskPath && maskSize ? streamFrames(input.maskPath, { pixFmt: "gray", ...maskSize, timeoutMs }) : undefined
    let maskAt = -1
    let maskGray: Buffer | undefined
    const maskFor = async (frame: number): Promise<Buffer | undefined> => {
      if (!maskStream || !maskOf) return undefined
      const want = maskOf[frame]!
      while (maskAt < want) {
        const r = await maskStream.next()
        if (r.done) throw new FaceMeshInputError(`the mask ran out of frames at mask frame ${maskAt + 1} (video frame ${frame})`)
        maskGray = r.value
        maskAt++
      }
      return maskGray
    }
    const tracker = new FaceMeshTracker(fpsOf(frameRate))
    const drawing: FaceMeshDrawing = input.layers ? { layers: input.layers } : (input.parts ?? "full")
    const layers = layerSetOf(drawing)
    // With the contours on, every line leaves out what the face hides: only then are the depths needed.
    const contours = hidesFarSide(layers)
    const layout = contours ? visibilityLayoutOf(layers) : undefined
    const contourVisibility = (points: Float64Array, depth: Float64Array) => visibilityOfLayout(points, depth, layout!)
    // The irises' points (468–477) are read only when they are drawn.
    const points = drawsIrises(layers) ? FACE_MESH_MODEL_POINTS : FACE_MESH_POINTS
    // Each frame is held until its faces' tracks are decided (only a face found in enough frames is drawn).
    const lookahead = new FaceMeshLookahead<HeldFrame, MeshedFace>()
    const small = k < 1 ? new Uint8Array(dw * dh * 3) : undefined
    const yunetInput = new Float32Array(3 * pw * ph)
    const meshInput = new Float32Array(FACE_MESH_INPUT_SIZE * FACE_MESH_INPUT_SIZE * 3)
    let n = 0
    let written = 0
    let framesWithFaces = 0
    let facesDrawn = 0
    /**
     * A decided frame, drawn and written: the smoothing gets every frame, in
     * order, with only the faces drawn on it (a face left out of a frame is
     * forgotten), and the counts are what is drawn.
     */
    const writeDecided = async ({ item, drawn }: DecidedFrame<HeldFrame, MeshedFace>): Promise<void> => {
      const tracked = tracker.track(drawn, contours ? contourVisibility : undefined)
      const smoothed = tracked.map((f) => f.points.map((v, i) => v / (i % 2 === 0 ? det.width : det.height)))
      const overlay = faceMeshOverlay(smoothed, draw.width, draw.height, drawing, contours ? tracked.map((f) => f.visibility) : undefined)
      if (overlay) {
        framesWithFaces++
        facesDrawn += smoothed.length
        const depth = item.depth && depthSize && depthTable ? { rgb: item.depth, ...depthSize, table: depthTable } : undefined
        await writeFrame(enc.stdin, await compositeFaceMesh(item.rgb, draw.width, draw.height, overlay, depth))
      } else {
        await writeFrame(enc.stdin, item.rgb)
      }
      written++
    }
    try {
      for (;;) {
        const next = await Promise.all(sources.map((s) => s.next()))
        const ended = next.filter((r) => r.done).length
        if (ended === next.length) break
        if (ended > 0) throw new FaceMeshInputError(`the clips ran out of frames at different points (frame ${n})`)
        const bgr = next[0]!.value as Buffer
        const rgb = next[1]!.value as Buffer
        const depthRgb = next[2]?.value as Buffer | undefined
        if (n >= frames) throw new FaceMeshInputError(`the clips hold more than the ${frames} frames counted`)
        const maskGray = await maskFor(n)

        if (small) sampleDown(bgr, det.width, det.height, dw, dh, small)
        fillYunetInput(small ?? bgr, dw, dh, pw, ph, yunetInput)
        const faces: YunetFace[] = decodeYunet(await detector.run(yunetInput, pw, ph), {
          pw, ph, width: dw, height: dh, minScore: FACE_MESH_MIN_DETECT_SCORE,
        })
        // The faces FOUND in this frame: through the filters, and present to the landmark model.
        const found: MeshedFace[] = []
        for (const face of faces) {
          if (!faceGetsMesh(face, input.filters, maskGray && maskSize ? { gray: maskGray, ...maskSize } : undefined)) continue
          const roi = roiOfFace(face, det.width, det.height)
          fillFaceMeshInput(bgr, det.width, det.height, roi, meshInput)
          const out = await mesh.run(meshInput)
          if (sigmoid(out.presenceLogit) < FACE_MESH_MIN_PRESENCE) continue
          const fractions = landmarksToFrame(out.landmarks, roi, det.width, det.height, FACE_MESH_INPUT_SIZE, points)
          // The tracker smooths in pixels of the found clip (the depths too: `landmarkDepths` is in the same pixels).
          const pixels = fractions.map((v, i) => v * (i % 2 === 0 ? det.width : det.height))
          found.push(contours ? { box: face, points: pixels, depth: landmarkDepths(out.landmarks, roi, FACE_MESH_INPUT_SIZE, points) } : { box: face, points: pixels })
        }
        // Held as copies (the decoders reuse their buffers); a frame with no face found never gets lines, so no depth.
        const held: HeldFrame = { rgb: Buffer.from(rgb), ...(depthRgb && found.length > 0 ? { depth: Buffer.from(depthRgb) } : {}) }
        for (const decided of lookahead.push(held, found)) await writeDecided(decided)
        n++
      }
      // The clip's end decides the frames still held.
      for (const decided of lookahead.flush()) await writeDecided(decided)
      if (written !== n) throw new Error(`face mesh: ${written} of the ${n} frames read were written`)
      // A mask with frames past the clip's last moment: the rest is never read (its decode is stopped).
      await maskStream?.return(undefined)
      enc.stdin.end()
      const { code, signal } = await encClosed
      if (code !== 0) throw new Error(`face mesh encode: ${ffmpegFailureMessage(encErr, signal ? `killed (${signal})` : `exit ${code}`)}`)
    } catch (err) {
      enc.kill("SIGKILL")
      await Promise.all([...sources, ...(maskStream ? [maskStream] : [])].map((s) => s.return(undefined).catch(() => undefined)))
      throw err
    } finally {
      clearTimeout(watchdog)
    }
    if (n !== frames) throw new FaceMeshInputError(`the clips gave ${n} of the ${frames} frames counted`)
    const cpu = process.cpuUsage(cpu0)
    return { framesWithFaces, facesDrawn, cpuMs: Math.round((cpu.user + cpu.system) / 1000) }
  }, { timeoutMs, peakMemoryMiB, label: "video face mesh" })

  return { outputPath: input.outputPath, ...draw, frames, ...counted }
}

/** The output's local path in `workDir`. */
export const faceMeshOutputPath = (workDir: string): string => join(workDir, "face-mesh.mp4")
