/**
 * The one 10-bit HEVC picture encode of the steps that finish a generation
 * and keep its picture (decided 2026-11-25 for an HDR loop cut, 2026-11-22
 * for every 10-bit picture an Extend joins): x265 in yuv420p10le, tagged
 * `hvc1` for players, at constant quality 20 (preset fast), with the source's
 * own colour signalling both as output tags (`colourTagArgs`) and in the HEVC
 * stream itself (its VUI, where players read it). The store keeps such a
 * file as the original beside a browser-safe preview
 * (`lib/video-result-store.ts`).
 */
import { colourTagArgs, type MatchedProbe } from "./matched-encode.js"
import { UHD_CANVAS } from "./ffmpeg-memory-model.js"
import { DEFAULT_FFMPEG_TIMEOUT_MS } from "./ffmpeg-timeouts.js"

/** The 10-bit HEVC picture arguments for a source probed as `probe` (its colour tags carried). */
export function hevc10PictureArgs(probe: MatchedProbe): string[] {
  return [
    "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-preset", "fast", "-crf", "20",
    ...colourTagArgs(probe),
    ...x265ColourParams(probe),
  ]
}

/** x265's VUI colour fields from the probed tags; a tag the probe did not read is left out. */
function x265ColourParams(probe: MatchedProbe): string[] {
  const read = (v: string | undefined) => (v && v !== "unknown" && v !== "reserved" ? v : undefined)
  const params = [
    ["colorprim", read(probe.colorPrimaries)],
    ["transfer", read(probe.colorTransfer)],
    ["colormatrix", read(probe.colorSpace)],
  ].flatMap(([k, v]) => (v ? [`${k}=${v}`] : []))
  return params.length > 0 ? ["-x265-params", params.join(":")] : []
}

/** Wall seconds a 10-bit HEVC encode is given per second of 4K picture: twice the preview's (`PREVIEW_SEC_PER_4K_SEC`, 15), as x265 is slower than x264. */
export const HEVC10_SEC_PER_4K_SEC = 30
/** The longest a 10-bit HEVC encode is given: 15 minutes. */
export const HEVC10_MAX_TIMEOUT_MS = 15 * 60 * 1000

/**
 * How long a 10-bit HEVC encode of `seconds` of picture at `size` may run:
 * {@link HEVC10_SEC_PER_4K_SEC} per second, scaled by its size against 4K,
 * never below the default ffmpeg limit and never above
 * {@link HEVC10_MAX_TIMEOUT_MS} (the preview encode's rule, `previewTimeoutMs`).
 * A length that does not read gets the maximum.
 */
export function hevc10TimeoutMs(seconds: number | undefined, size: { width?: number; height?: number }): number {
  if (seconds === undefined || !(seconds > 0)) return HEVC10_MAX_TIMEOUT_MS
  const w = size.width ?? UHD_CANVAS.width
  const h = size.height ?? UHD_CANVAS.height
  const scale = (w * h) / (UHD_CANVAS.width * UHD_CANVAS.height)
  const wanted = Math.ceil(seconds * HEVC10_SEC_PER_4K_SEC * scale * 1000)
  return Math.min(HEVC10_MAX_TIMEOUT_MS, Math.max(DEFAULT_FFMPEG_TIMEOUT_MS, wanted))
}

/** Whether a probed picture is 10-bit (or deeper): its pixel format names it (`yuv420p10le`, `p010le`, `yuv422p12le`…). */
export function isTenBitOrMore(probe: Pick<MatchedProbe, "pixFmt">): boolean {
  return /(?:p1[0-6]|p01[0-6])(?:le|be)?$/.test(probe.pixFmt ?? "")
}
