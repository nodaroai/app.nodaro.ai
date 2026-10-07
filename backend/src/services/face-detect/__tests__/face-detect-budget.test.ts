/**
 * The detector's admission figures, by name (the census the plan asks of every
 * reservation, like Apply EDL's slices). Each number here is a decision with a
 * measurement behind it; changing one must fail a test.
 */
import { describe, it, expect } from "vitest"
import { SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE, SPEAKER_TRACKS_MAX_BYTES } from "@nodaro/shared"
import { canvasPeakMemoryMiB } from "../../../providers/video/ffmpeg-memory-model.js"
import {
  FACE_DETECT_MAX_FRAMES_PER_CALL,
  FACE_DETECT_ORT_INTRA_OP_THREADS,
  FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD,
  faceDetectCaps,
  faceDetectPeakMemoryMiB,
  faceDetectTimeoutMs,
} from "../face-detect-budget.js"

const T2 = { decode: 2, filter: 2, encode: 2 }

describe("face-detect admission figures", () => {
  it("runs onnxruntime on ONE intra-op thread — the measured configuration, never above any CPU quota", () => {
    expect(FACE_DETECT_ORT_INTRA_OP_THREADS).toBe(1)
  })

  it("a window is at most 1,200 proxy frames (10 minutes of a 2 fps proxy)", () => {
    expect(FACE_DETECT_MAX_FRAMES_PER_CALL).toBe(1200)
  })

  it("reserves the decode child's canvas prediction plus the session's measured working set", () => {
    // The holdout's streaming onnxruntime-node loop peaked at 188–214 MB of
    // WHOLE-process RSS at one thread; 256 MiB per thread covers it.
    expect(FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD).toBe(256)
    const frame = { width: 960, height: 540 }
    // The decode child encodes nothing: its encoder threads weigh nothing.
    const decode = canvasPeakMemoryMiB(frame, 1, { ...T2, encode: 0 })
    expect(faceDetectPeakMemoryMiB(frame, 1, T2)).toBe(decode + 256)
    expect(faceDetectPeakMemoryMiB(frame, 1, T2)).toBe(336 + 256)
  })

  it("grows with the session's threads and with the decode's", () => {
    const frame = { width: 960, height: 540 }
    expect(faceDetectPeakMemoryMiB(frame, 2, T2)).toBe(faceDetectPeakMemoryMiB(frame, 1, T2) + 256)
    expect(faceDetectPeakMemoryMiB(frame, 1, { decode: 8, filter: 8, encode: 8 })).toBeGreaterThan(faceDetectPeakMemoryMiB(frame, 1, T2))
  })

  it("holds a slot at most a generous multiple of the measured 13–16 ms per frame", () => {
    expect(faceDetectTimeoutMs(1200)).toBe(60_000 + 1200 * 250)
    expect(faceDetectTimeoutMs(1)).toBe(60_000 + 250)
  })

  it("the per-call caps are the speaker-track caps", () => {
    expect(faceDetectCaps()).toEqual({ maxBoxes: SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE, maxBytes: SPEAKER_TRACKS_MAX_BYTES })
  })
})
