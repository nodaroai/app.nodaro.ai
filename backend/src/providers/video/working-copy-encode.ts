/**
 * The WORKING COPY encode: the picture a server-side child step hands to the
 * next step of its parent's run (never to a person), as close to lossless as
 * 8-bit H.264 gets, so a chain of steps does not lose detail at every hop.
 * A step's delivery encode stays what it is; a step encodes a working copy
 * only when its child job asked for one and the request was a child's
 * (`lib/working-copy-request.ts`). Used by Mask Composite and Video Face Mesh,
 * through this one module so the two cannot drift:
 *
 * - libx264, `-preset fast`, constant quality `-crf 6`, bounded by a rate
 *   cap (`-maxrate 50M -bufsize 100M`) so heavy grain cannot blow the file up;
 * - the source's own pixel format where 8-bit H.264 holds it (4:2:0 stays
 *   4:2:0, 4:2:2 stays 4:2:2, 4:4:4 stays 4:4:4), else 4:2:0 — the same rule
 *   as the matched re-encode (`keptPixFmt`, matched-encode.ts);
 * - the source's colour tags (`colourTagArgs`), where the step does not tag
 *   its output itself.
 *
 * Frames, timestamps, size and sound are each step's own, exactly as in its
 * delivery encode.
 */
import { colourTagArgs, keptPixFmt, type KeptPixFmt, type MatchedProbe } from "./matched-encode.js"

/** The working copy's constant quality. */
export const WORKING_COPY_CRF = "6"
/** The working copy's x264 preset. */
export const WORKING_COPY_PRESET = "fast"
/**
 * The working copy's rate cap (x264 VBV), in bits per second, and its buffer
 * in bits (twice the rate). CRF 6 alone has no ceiling: on heavily grained
 * 1080p it measured about 150 Mbit/s, so a 30 s copy ran to several hundred
 * MB, which the next step downloads under a fixed timeout. Capped, a copy's
 * video is at most `WORKING_COPY_MAX_RATE × seconds + WORKING_COPY_BUFFER`
 * bits (15 s: 106 MB; 30 s: 200 MB). 50 Mbit/s is the same ceiling Video
 * Remake's own working copies use (decided 2026-11-24), so a clip keeps one
 * ceiling across every step of the chain. Ordinary footage at CRF 6 sits
 * under the cap, so it is encoded as before. A copy that goes on to a video
 * engine is re-encoded within that engine's size limit on the way
 * (`providers/kie/reference-video-reencode.ts`), so the cap is no engine's limit.
 */
export const WORKING_COPY_MAX_RATE = 50_000_000
export const WORKING_COPY_BUFFER = 100_000_000

/** What a working copy reads of its source: the picture's pixel format and colour tags (`probeMatched`). */
export type WorkingCopySource = Pick<MatchedProbe, "pixFmt" | "colorSpace" | "colorPrimaries" | "colorTransfer" | "colorRange">

/** The pixel format the working copy of `source` is encoded in (`keptPixFmt`). */
export function workingCopyPixFmt(source: WorkingCopySource): KeptPixFmt {
  return keptPixFmt(source.pixFmt)
}

/** The same format with an alpha plane, for a graph that overlays through a mask (`yuv444p` → `yuva444p`). */
export function withAlphaPlane(pixFmt: KeptPixFmt): string {
  return `yuva${pixFmt.slice("yuv".length)}`
}

/** The encoder's arguments: codec, preset, quality, rate cap and pixel format, no colour tags. */
export function workingCopyCodecArgs(pixFmt: KeptPixFmt): string[] {
  return [
    "-c:v", "libx264", "-preset", WORKING_COPY_PRESET, "-crf", WORKING_COPY_CRF,
    "-maxrate", `${WORKING_COPY_MAX_RATE / 1_000_000}M`, "-bufsize", `${WORKING_COPY_BUFFER / 1_000_000}M`,
    "-pix_fmt", pixFmt,
  ]
}

/** The encoder's arguments with the source's colour tags: for a step that writes no tags of its own. */
export function workingCopyPictureArgs(source: WorkingCopySource): string[] {
  return [...workingCopyCodecArgs(workingCopyPixFmt(source)), ...colourTagArgs(source)]
}

/**
 * Bytes a pixel of each kept format holds, against 4:2:0's: a 4:4:4 picture
 * is twice a 4:2:0 one, a 4:2:2 one a third more.
 */
const PLANE_FACTOR: Readonly<Record<KeptPixFmt, number>> = { yuv420p: 1, yuv422p: 4 / 3, yuv444p: 2 }

/**
 * A step's declared ffmpeg peak (`ffmpeg-memory-model.ts`, fitted on 4:2:0
 * pictures) for a working copy in `pixFmt`: scaled whole by how much more a
 * pixel holds. The quality does not move the peak; the pixel format does
 * (1080p, 4 threads, preset fast: 4:2:0 at CRF 18 and at CRF 6 both peaked at
 * 487 MiB, 4:4:4 at CRF 6 at 820 MiB, 1.68×). Scaling the fixed terms too
 * over-reserves, which only makes a launch wait. 4:2:0 keeps the peak as it is.
 */
export function workingCopyPeakMemoryMiB(peakMiB: number, pixFmt: KeptPixFmt): number {
  return Math.ceil(peakMiB * PLANE_FACTOR[pixFmt])
}
