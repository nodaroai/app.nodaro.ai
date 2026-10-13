/**
 * DOES THIS CLIP SHOW A FACE? (decided 2026-10-12, R2) — the cheap run-start
 * check a template opts into so a clip with nobody to follow is refused before
 * anything is charged.
 *
 * A few frames, spread across the clip, each seeked on its own (an input seek
 * is cheap however long the file is), scaled to the detection proxy's height
 * and run through the SAME YuNet session and the SAME decode launcher Speaker
 * Frames uses, inside ONE admission hold sized by the same budget. The first
 * face ends the look.
 *
 * Three answers, because the third matters: `present`; `none` — only when
 * enough frames were decoded and judged and none held a face; and `unknown` —
 * the host cannot detect (no model, no native binary: every community install
 * without the pack), the size or length is unusable, or too few frames decoded
 * to say. A rule that refuses on faces refuses on `none` alone, so the
 * measurement never fails and a run is never refused for a probe that could
 * not look.
 *
 * Several evenly spread frames rather than the first few: a title card or a
 * black lead-in must not make a talking-head clip read as faceless. A clip
 * whose only faces appear between the sampled frames still reads `none`; that
 * is the cost of "a few frames", and the node that opts in says so in its docs.
 */
import { withFfmpegSlot } from "../../providers/video/ffmpeg-utils.js"
import { ffmpegEffectiveThreads } from "../../providers/video/ffmpeg-threads.js"
import { streamBgrFrames } from "./detect-faces.js"
import { faceDetectPeakMemoryMiB, faceDetectTimeoutMs } from "./face-detect-budget.js"
import { decodeYunet, fillYunetInput, paddedSize } from "./yunet-decode.js"
import { yunetSession } from "./yunet-session.js"

export type FacePresence = "present" | "none" | "unknown"

/** Frames looked at, spread evenly across the clip. */
export const FACE_PRESENCE_SAMPLES = 8
/** Fewer decoded frames than this cannot support a "none". */
export const FACE_PRESENCE_MIN_JUDGED = 3
/** The score floor Speaker Frames keeps. */
export const FACE_PRESENCE_MIN_SCORE = 0.7
/** The detection proxy's height: a frame is never enlarged past its own. */
const SAMPLE_HEIGHT = 540

const even = (n: number): number => Math.max(2, 2 * Math.round(n / 2))

/** The sampled frame's size: the displayed shape at the proxy's height, never larger than the source. */
function sampleSize(width: number, height: number): { w: number; h: number } {
  if (height <= SAMPLE_HEIGHT) return { w: even(width), h: even(height) }
  return { w: even((width * SAMPLE_HEIGHT) / height), h: SAMPLE_HEIGHT }
}

export async function detectFacePresence(
  source: string,
  clip: { readonly durationMs: number; readonly width?: number; readonly height?: number },
): Promise<FacePresence> {
  const { durationMs, width, height } = clip
  if (!(durationMs > 0) || !(typeof width === "number" && width > 0) || !(typeof height === "number" && height > 0)) return "unknown"
  let session: Awaited<ReturnType<typeof yunetSession>>
  try {
    session = await yunetSession()
  } catch {
    return "unknown"
  }
  const { w, h } = sampleSize(width, height)
  const { pw, ph } = paddedSize(w, h)
  const timeoutMs = faceDetectTimeoutMs(FACE_PRESENCE_SAMPLES)
  const peakMemoryMiB = faceDetectPeakMemoryMiB({ width: w, height: h }, session.intraOpThreads, ffmpegEffectiveThreads())

  try {
    return await withFfmpegSlot(async (): Promise<FacePresence> => {
      const input = new Float32Array(3 * pw * ph)
      let judged = 0
      for (let i = 0; i < FACE_PRESENCE_SAMPLES; i++) {
        const seekSec = (durationMs * (i + 0.5)) / FACE_PRESENCE_SAMPLES / 1000
        try {
          for await (const bgr of streamBgrFrames(source, { seekSec, frames: 1, width: w, height: h, timeoutMs, scaleTo: true })) {
            judged++
            fillYunetInput(bgr, w, h, pw, ph, input)
            const outputs = await session.run(input, pw, ph)
            if (decodeYunet(outputs, { pw, ph, width: w, height: h, minScore: FACE_PRESENCE_MIN_SCORE }).length > 0) return "present"
          }
        } catch {
          // One sample that would not decode is not the clip: the rest still count.
        }
      }
      return judged >= FACE_PRESENCE_MIN_JUDGED ? "none" : "unknown"
    }, { timeoutMs, peakMemoryMiB, label: "face-presence" })
  } catch {
    return "unknown"
  }
}
