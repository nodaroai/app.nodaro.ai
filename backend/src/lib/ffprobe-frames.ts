import { runFfprobe, assertSafeProbeSource } from "../providers/video/ffmpeg-utils.js"

/**
 * Resolve a video-stream frame count from a container's `nb_frames` reading,
 * falling back to round(duration × fps) when `nb_frames` is absent.
 *
 * `nb_frames` is the cheap, no-decode path but MP4/MOV containers frequently
 * omit it (it is only populated for some codecs/muxers), in which case ffprobe
 * returns "N/A" / "" and we must derive the count from the stream's duration
 * and frame rate. Returns `undefined` when neither source yields a usable
 * count so callers decide whether to hard-fail or fall back to a worst-case.
 *
 * Single source of truth for the "nb_frames else duration×fps" math — shared
 * by `probeVideoFrames` (route preflight) and the worker's extract-frame
 * probe so the two can never drift.
 */
export function resolveFrameCount(
  nbFramesRaw: string | number | undefined,
  durationSeconds: number | undefined,
  fps: number | undefined,
): number | undefined {
  const nb =
    typeof nbFramesRaw === "number" ? nbFramesRaw : parseInt(String(nbFramesRaw ?? "").trim(), 10)
  if (Number.isFinite(nb) && nb > 0) return nb
  if (
    durationSeconds !== undefined &&
    fps !== undefined &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0 &&
    Number.isFinite(fps) &&
    fps > 0
  ) {
    return Math.max(1, Math.round(durationSeconds * fps))
  }
  return undefined
}

/** Parse an ffprobe `r_frame_rate` expression ("30000/1001", "24", "0/0"). */
function parseFrameRate(expr: string): number | undefined {
  const e = expr.trim()
  if (e.includes("/")) {
    const [num, den] = e.split("/").map((s) => parseFloat(s))
    if (den && Number.isFinite(num / den) && num / den > 0) return num / den
    return undefined
  }
  const n = parseFloat(e)
  if (Number.isFinite(n) && n > 0) return n
  return undefined
}

/**
 * Probe a video URL (or local path) for its frame count + pixel dimensions in a
 * single ffprobe call. Accepts a remote http(s) URL OR a local path — ffprobe
 * reads both; remote URLs go through `assertSafeProbeSource` first (SSRF guard)
 * and the call is confined via `-protocol_whitelist` so a malicious manifest
 * can't pivot to file:// or other transports.
 *
 * Frame count prefers the container's `nb_frames` (no decode); when that is
 * absent (common for MP4) it falls back to round(streamDuration × fps) via
 * `resolveFrameCount`. Hard-fails when neither the count nor the dimensions can
 * be determined so the SwitchX preflight never reserves against bogus data.
 */
export async function probeVideoFrames(
  srcUrlOrPath: string,
): Promise<{ frames: number; width: number; height: number }> {
  await assertSafeProbeSource(srcUrlOrPath)
  const output = await runFfprobe([
    "-v", "error",
    // Confine ffprobe to file + http(s) transport so a malicious manifest
    // can't pivot to other protocols. Keep `file` so local-path probes work.
    "-protocol_whitelist", "file,http,https,tcp,tls",
    "-select_streams", "v:0",
    "-show_entries", "stream=nb_frames,width,height,duration,r_frame_rate",
    "-of", "default=noprint_wrappers=1",
    srcUrlOrPath,
  ])

  const fields: Record<string, string> = {}
  for (const line of output.trim().split(/\r?\n/)) {
    const eq = line.indexOf("=")
    if (eq === -1) continue
    fields[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }

  const width = parseInt(fields.width ?? "", 10)
  const height = parseInt(fields.height ?? "", 10)
  const duration = parseFloat(fields.duration ?? "")
  const fps = parseFrameRate(fields.r_frame_rate ?? "")
  const frames = resolveFrameCount(
    fields.nb_frames,
    Number.isFinite(duration) ? duration : undefined,
    fps,
  )

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error(`probeVideoFrames: could not determine dimensions from "${output.trim()}"`)
  }
  if (frames === undefined) {
    throw new Error(
      `probeVideoFrames: could not determine frame count (nb_frames="${fields.nb_frames ?? ""}", duration="${fields.duration ?? ""}", r_frame_rate="${fields.r_frame_rate ?? ""}")`,
    )
  }

  return { frames, width, height }
}

/**
 * EXACT video frame count via ffprobe `-count_frames` (decodes the stream — far
 * slower than {@link probeVideoFrames}'s nb_frames/duration×fps estimate, but
 * precise). Used ONLY at the SwitchX 240-frame cap boundary: the cheap estimate
 * can land on 241 for a clip that is really 240, so before rejecting/trimming we
 * confirm the real count. Returns `undefined` when the count can't be read (the
 * caller falls back to the estimate). SSRF-guarded like probeVideoFrames.
 */
export async function exactFrameCount(srcUrlOrPath: string): Promise<number | undefined> {
  await assertSafeProbeSource(srcUrlOrPath)
  const output = await runFfprobe([
    "-v", "error",
    "-protocol_whitelist", "file,http,https,tcp,tls",
    "-select_streams", "v:0",
    "-count_frames",
    "-show_entries", "stream=nb_read_frames",
    "-of", "default=noprint_wrappers=1:nokey=1",
    srcUrlOrPath,
  ])
  const n = parseInt(output.trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}
