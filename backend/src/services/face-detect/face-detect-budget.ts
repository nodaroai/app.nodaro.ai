/**
 * What one face-detection window may take from the box: threads, memory, time
 * and output — named, so a census test pins each (`face-detect-budget.test.ts`).
 *
 * A window's decode child and its inference run inside ONE ffmpeg admission
 * hold (`withFfmpegSlot`, #1860): the box's shared memory budget sees both,
 * and two windows that fit alone never launch together into an OOM. The
 * figures are re-pinned from the P3.0f pricing measurement on the built
 * handler (the D5 venue: AMD EPYC 9655P, `cpu.max` 2 vCPU, ffmpeg n8.1.2,
 * onnxruntime-node 1.30.0; decided 2026-10-16): about twice the worst case it
 * measured for each.
 *
 * Pure, dependency-light (no onnxruntime import): the session and the census
 * test both read it.
 */
import { SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE, SPEAKER_TRACKS_MAX_BYTES } from "@nodaro/shared/edl"
import { cameraMegapixelsOf, canvasPeakMemoryMiB } from "../../providers/video/ffmpeg-memory-model.js"
import type { FfmpegThreads } from "../../providers/video/ffmpeg-threads.js"

/**
 * onnxruntime's intra-op threads. One — the configuration every detection
 * figure was measured at (13–16 CPU-ms per frame with the decode), and so the
 * basis the node's price is derived from. A CPU quota (#1841) is never below
 * one CPU, so one thread never exceeds it; more threads would be a different,
 * unmeasured operating point, not a free speed-up.
 *
 * That one thread is the worker's MAIN JS thread, not an extra one: with one
 * intra-op thread onnxruntime-node computes synchronously on the caller
 * (`yunet-session.ts`). Inference therefore competes with everything else the
 * worker's event loop does (heartbeats, lock renewals, other jobs' JS). Nothing
 * counts it against the box's CPU quota either: the admission (`withFfmpegSlot`)
 * counts slots and memory, not threads, and #1841 only sizes each ffmpeg
 * child's own thread counts to the quota. A window's decode child, its
 * inference and other slots' ffmpegs together can ask for more than the quota;
 * the kernel throttles that as time, not memory.
 */
export const FACE_DETECT_ORT_INTRA_OP_THREADS = 1

/**
 * The session's working set per intra-op thread, in MiB: about twice the
 * worst Node growth P3.0f measured in a job's first window (the YuNet session
 * plus its frame buffers: median 81–114, max 166 MiB). The decode child is
 * reserved separately (its canvas prediction; it peaked at ≤ 92 MiB). Scaled
 * by threads as an over-estimate: above one thread it is unmeasured.
 */
export const FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD = 332

/** A window is at most this many proxy frames: 10 minutes of a 2 fps proxy. */
export const FACE_DETECT_MAX_FRAMES_PER_CALL = 1200

/** Hold budget per frame, ms: about twice the worst hold wall per frame P3.0f
 *  measured (median 9.4–10.0, p95 ≤ 13.5, max 15.6 ms). */
export const FACE_DETECT_MS_PER_FRAME = 32
/** Fixed hold budget per window, ms: the decode's start and seek. */
export const FACE_DETECT_FIXED_MS = 60_000

/**
 * The window's declared peak, MiB: the decode child's canvas prediction at the
 * threads the launcher gives it (it decodes and filters; it encodes nothing, so
 * its encoder term is zero) plus the session's working set at the threads
 * onnxruntime runs with.
 */
export function faceDetectPeakMemoryMiB(
  frame: { readonly width: number; readonly height: number },
  ortThreads: number,
  ffmpegThreads: FfmpegThreads,
): number {
  const decode = canvasPeakMemoryMiB(frame, 1, { ...ffmpegThreads, encode: 0 }, { inputs: 1, cameraMegapixels: cameraMegapixelsOf(frame) })
  return decode + FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD * Math.max(1, Math.ceil(ortThreads))
}

/**
 * The most boxes of one frame that get a face descriptor (P3.2b round 3): the
 * highest-scoring first, the rest none (a caller then abstains on them, as it
 * does for a host with no descriptors). It is what makes the per-frame term
 * below a bound. Four times the most faces any committed tuning clip holds in
 * one frame at score 0.7 (8: back's convention-floor crowd; the P3.0b and
 * holdout windows, 2026-10-08), so it never binds on podcast footage.
 */
export const FACE_DESCRIPTOR_MAX_PER_FRAME = 32

/**
 * Hold budget per frame the caller asks descriptors for, ms: about twice the
 * worst P3.0f measured on the D5 venue — 26.0–46.2 µs per box (median 28.3;
 * 7 reps × 2,000 boxes), so `FACE_DESCRIPTOR_MAX_PER_FRAME` boxes at the
 * worst 46.2 µs is 1.48 ms a frame. The work is fixed-size per box (1,024
 * bilinear luma samples and two 256-sample histograms), so it does not grow
 * with the face.
 */
export const FACE_DETECT_DESCRIPTOR_MS_PER_FRAME = 3

/**
 * How long a window of `frames` may hold its slot (the decode is killed past
 * it), `describedFrames` of them with face descriptors.
 */
export function faceDetectTimeoutMs(frames: number, describedFrames = 0): number {
  return FACE_DETECT_FIXED_MS + FACE_DETECT_MS_PER_FRAME * Math.max(1, Math.ceil(frames))
    + FACE_DETECT_DESCRIPTOR_MS_PER_FRAME * Math.max(0, Math.ceil(describedFrames))
}

/**
 * What one call may hand back: the speaker-track set's own caps (P3.1). A
 * window is a part of one source, so no window may hold more boxes than a
 * whole source may, nor more bytes than a whole set. Hit, the call fails
 * deterministically — a partial result is never presented as complete.
 */
export function faceDetectCaps(): { readonly maxBoxes: number; readonly maxBytes: number } {
  return { maxBoxes: SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE, maxBytes: SPEAKER_TRACKS_MAX_BYTES }
}
