/**
 * What one face-detection window may take from the box: threads, memory, time
 * and output — named, so a census test pins each (`face-detect-budget.test.ts`).
 *
 * A window's decode child and its inference run inside ONE ffmpeg admission
 * hold (`withFfmpegSlot`, #1860): the box's shared memory budget sees both,
 * and two windows that fit alone never launch together into an OOM. The
 * figures are the P3.0b holdout's (2026-10-06, the D5 venue: AMD EPYC 9655P,
 * `cpu.max` 2 vCPU, ffmpeg n8.1.2, onnxruntime-node 1.30.0); the P3.0f pricing
 * measurement on the built handler re-pins them.
 *
 * Pure, dependency-light (no onnxruntime import): the session and the census
 * test both read it.
 */
import { SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE, SPEAKER_TRACKS_MAX_BYTES } from "@nodaro/shared"
import { canvasPeakMemoryMiB } from "../../providers/video/ffmpeg-memory-model.js"
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
 * The session's working set per intra-op thread, in MiB. The holdout's
 * streaming onnxruntime-node loop on 540p frames peaked at 188–214 MB of
 * WHOLE-process RSS (Node itself included), so 256 covers the session with
 * room. Scaled by threads as an over-estimate: above one thread it is
 * unmeasured.
 */
export const FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD = 256

/** A window is at most this many proxy frames: 10 minutes of a 2 fps proxy. */
export const FACE_DETECT_MAX_FRAMES_PER_CALL = 1200

/** Hold budget per frame, ms: ~15× the measured 13–16 ms, for a busy box. */
export const FACE_DETECT_MS_PER_FRAME = 250
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
  const decode = canvasPeakMemoryMiB(frame, 1, { ...ffmpegThreads, encode: 0 })
  return decode + FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD * Math.max(1, Math.ceil(ortThreads))
}

/** How long a window of `frames` may hold its slot (the decode is killed past it). */
export function faceDetectTimeoutMs(frames: number): number {
  return FACE_DETECT_FIXED_MS + FACE_DETECT_MS_PER_FRAME * Math.max(1, Math.ceil(frames))
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
