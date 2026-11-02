// @test-watches backend/src/services/face-mesh/model/** backend/scripts/copy-build-assets.mjs backend/src/services/face-detect/__tests__/fixtures/rt4k-540p2-gop.mp4
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { BUILD_ASSETS } from "../../../../scripts/copy-build-assets.mjs"
import { DeterministicJobError } from "../../../lib/deterministic-job-error.js"
import {
  FACE_MESH_INPUT_SIZE,
  FACE_MESH_MODEL_PATH,
  FACE_MESH_MODEL_POINTS,
  FACE_MESH_MODEL_SHA256,
  FACE_MESH_POINTS,
  FACE_MESH_UPSTREAM_BUNDLE_SHA256,
  FACE_MESH_UPSTREAM_SHA256,
  FaceMeshModelMismatchError,
  FaceMeshUnavailableError,
  readVerifiedFaceMeshModel,
} from "../face-mesh-model.js"
import {
  createFaceMeshSession,
  FACE_MESH_INPUT,
  FACE_MESH_LANDMARKS_OUTPUT,
  FACE_MESH_PRESENCE_OUTPUT,
  type FaceMeshSession,
} from "../face-mesh-session.js"
import { FACE_MESH_MIN_PRESENCE, fillFaceMeshInput, landmarksToFrame, roiOfFace, sigmoid, type FaceRoi } from "../face-mesh-crop.js"
import {
  faceMeshPeakMemoryMiB,
  faceMeshTimeoutMs,
  FACE_MESH_DRAW_PEAK_MIB,
  FACE_MESH_FIXED_MS,
  FACE_MESH_MS_PER_FRAME,
  FACE_MESH_SESSION_PEAK_MIB_PER_THREAD,
} from "../face-mesh-budget.js"
import { FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD } from "../../face-detect/face-detect-budget.js"
import { decodeYunet, fillYunetInput, paddedSize } from "../../face-detect/yunet-decode.js"
import { releaseYunetSession, yunetSession } from "../../face-detect/yunet-session.js"

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "face-mesh-model-"))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe("the pinned face landmark model", () => {
  it("is the committed file", () => {
    expect(createHash("sha256").update(readFileSync(FACE_MESH_MODEL_PATH)).digest("hex")).toBe(FACE_MESH_MODEL_SHA256)
  })

  it("is MediaPipe's FaceLandmarker landmark model: its bundle's and its tflite's pins, a 256 × 256 crop, 478 points of which 468 are drawn", () => {
    expect(FACE_MESH_MODEL_PATH.endsWith("/model/face_landmarks_detector.onnx")).toBe(true)
    expect(FACE_MESH_MODEL_SHA256).toBe("bc826d2f6cb7a6c9ef9f3a2854217314f5a75ec5bae29486b85576b9cba77bb9")
    expect(FACE_MESH_UPSTREAM_SHA256).toBe("c7d54204ce0448474c7f3fa9af494787c0965cbdd6f20fc72867e43046bd43d5")
    expect(FACE_MESH_UPSTREAM_BUNDLE_SHA256).toBe("64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff")
    expect(FACE_MESH_INPUT_SIZE).toBe(256)
    expect(FACE_MESH_MODEL_POINTS).toBe(478)
    expect(FACE_MESH_POINTS).toBe(468)
  })

  it("the build ships the model and its licence into dist/ — and nothing else from the model folder", () => {
    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
    const asset = BUILD_ASSETS.find((a) => resolve(srcRoot, a.dir) === dirname(FACE_MESH_MODEL_PATH))
    expect(asset, "services/face-mesh/model must be a BUILD_ASSETS entry, or the image has no model").toBeDefined()
    expect(asset!.match.test("face_landmarks_detector.onnx")).toBe(true)
    expect(asset!.match.test("LICENSE.mediapipe.txt")).toBe(true)
    expect(asset!.match.test("README.md")).toBe(false)
    // The former model is gone: nothing ships it.
    expect(asset!.match.test("face_landmark.onnx")).toBe(false)
  })

  it("refuses other bytes before onnxruntime sees them (deterministic: the job refunds once)", async () => {
    const other = join(dir, "other.onnx")
    writeFileSync(other, "not the model")
    const err = await readVerifiedFaceMeshModel(other).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FaceMeshModelMismatchError)
    expect(err).toBeInstanceOf(DeterministicJobError)
  })

  it("a missing file is a host without the model", async () => {
    await expect(readVerifiedFaceMeshModel(join(dir, "missing.onnx"))).rejects.toBeInstanceOf(FaceMeshUnavailableError)
  })

  it("a host where onnxruntime does not load refuses the job, never crashes", async () => {
    const err = await createFaceMeshSession({ importOrt: () => Promise.reject(new Error("no binary")) }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FaceMeshUnavailableError)
    expect(String((err as Error).message)).toMatch(/no binary/)
  })

  it("the graph takes input_12 [N, 256, 256, 3] and gives the points (Identity), the presence (Identity_1) and an unread third", async () => {
    const ort = (await import("onnxruntime-node")).default
    const s = await ort.InferenceSession.create(await readVerifiedFaceMeshModel(), { intraOpNumThreads: 1 })
    try {
      expect([FACE_MESH_INPUT, FACE_MESH_LANDMARKS_OUTPUT, FACE_MESH_PRESENCE_OUTPUT]).toEqual(["input_12", "Identity", "Identity_1"])
      expect(s.inputNames).toEqual([FACE_MESH_INPUT])
      expect(s.outputNames).toEqual([FACE_MESH_LANDMARKS_OUTPUT, FACE_MESH_PRESENCE_OUTPUT, "Identity_2"])
      // The batch dimension is free (named by the converter); the rest is pinned.
      const shapes = (meta: readonly unknown[]) =>
        meta.map((m) => (m as { shape: Array<number | string> }).shape.slice(1))
      expect(shapes(s.inputMetadata)).toEqual([[256, 256, 3]])
      expect(shapes(s.outputMetadata)).toEqual([[1, 1, FACE_MESH_MODEL_POINTS * 3], [1, 1, 1], [1]])
    } finally {
      await s.release()
    }
  })

  it("runs a crop: 478 points and a presence logit (a flat gray crop is no face)", async () => {
    const s = await createFaceMeshSession()
    try {
      const out = await s.run(new Float32Array(FACE_MESH_INPUT_SIZE * FACE_MESH_INPUT_SIZE * 3).fill(0.5))
      expect(out.landmarks).toHaveLength(478 * 3)
      expect(Number.isFinite(out.presenceLogit)).toBe(true)
      expect(sigmoid(out.presenceLogit)).toBeLessThan(FACE_MESH_MIN_PRESENCE)
      expect(s.intraOpThreads).toBe(1)
    } finally {
      await s.release()
    }
  })
})

describe("the model on real crops: the app's own crop, RGB in [0, 1]", () => {
  // Frame 6 of Speaker Frames' parity fixture: four people seated, 960 × 540
  // (`../../face-detect/__tests__/fixtures/README.md`).
  const FACES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "face-detect", "__tests__", "fixtures", "rt4k-540p2-gop.mp4")
  const W = 960
  const H = 540
  let bgr: Buffer
  let s: FaceMeshSession
  beforeAll(async () => {
    bgr = execFileSync("ffmpeg", ["-v", "error", "-i", FACES, "-map", "0:v:0", "-vf", "select=eq(n\\,6)", "-fps_mode", "passthrough", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "bgr24", "pipe:1"], { maxBuffer: 1e8 })
    s = await createFaceMeshSession()
  }, 60_000)
  afterAll(async () => {
    await s?.release()
    await releaseYunetSession()
  })
  const run = async (roi: FaceRoi) => {
    const input = new Float32Array(FACE_MESH_INPUT_SIZE * FACE_MESH_INPUT_SIZE * 3)
    fillFaceMeshInput(bgr, W, H, roi, input)
    return s.run(input)
  }

  it("reads the faces YuNet finds that face the camera as faces, and puts their eyes and lips inside each one's box", async () => {
    expect(bgr).toHaveLength(W * H * 3)
    const det = await yunetSession()
    const { pw, ph } = paddedSize(W, H)
    const yin = new Float32Array(3 * pw * ph)
    fillYunetInput(bgr, W, H, pw, ph, yin)
    const faces = decodeYunet(await det.run(yin, pw, ph), { pw, ph, width: W, height: H, minScore: 0.6 })
    expect(faces).toHaveLength(4)
    let present = 0
    for (const face of faces) {
      const roi = roiOfFace(face, W, H)
      const out = await run(roi)
      // The two seen side-on read absent (as with the former model); the two facing the camera read present.
      if (sigmoid(out.presenceLogit) < FACE_MESH_MIN_PRESENCE) continue
      present++
      const pts = landmarksToFrame(out.landmarks, roi, W, H)
      // The nose tip (1), the inner lips (13, 14) and the eyes' outer corners (33, 263): inside the box, a little slack.
      for (const i of [1, 13, 14, 33, 263]) {
        expect(pts[2 * i]!).toBeGreaterThan(face.x - 0.1 * face.w)
        expect(pts[2 * i]!).toBeLessThan(face.x + 1.1 * face.w)
        expect(pts[2 * i + 1]!).toBeGreaterThan(face.y - 0.1 * face.h)
        expect(pts[2 * i + 1]!).toBeLessThan(face.y + 1.1 * face.h)
      }
      // The mouth below the eyes, and the face's height (forehead 10 to chin 152) about the box's.
      expect(pts[2 * 13 + 1]!).toBeGreaterThan(Math.max(pts[2 * 33 + 1]!, pts[2 * 263 + 1]!))
      const faceHeightPx = Math.hypot((pts[2 * 10]! - pts[2 * 152]!) * W, (pts[2 * 10 + 1]! - pts[2 * 152 + 1]!) * H)
      expect(faceHeightPx / (face.h * H)).toBeGreaterThan(0.7)
      expect(faceHeightPx / (face.h * H)).toBeLessThan(1.3)
    }
    expect(present).toBe(2)
  }, 60_000)

  it("turns a hand, the trophy and a plant away (a face-sized crop of no face reads absent)", async () => {
    // Hand-placed in frame 6 (pixels): two hands on knees, the trophy on the table, the plant behind the second man.
    for (const [cx, cy, side] of [[300, 296, 70], [690, 278, 70], [480, 262, 110], [455, 118, 80]] as const) {
      const out = await run({ cx, cy, size: side * 1.5, angle: 0 })
      expect(sigmoid(out.presenceLogit), `the crop at ${cx},${cy}`).toBeLessThan(0.05)
    }
  }, 60_000)
})

describe("the run's budget", () => {
  it("re-measured for the 256 × 256 model: 160 MiB of session a thread, 400 ms a frame on top of 120 s", () => {
    expect(FACE_MESH_SESSION_PEAK_MIB_PER_THREAD).toBe(160)
    expect(FACE_MESH_MS_PER_FRAME).toBe(400)
    expect(FACE_MESH_FIXED_MS).toBe(120_000)
  })

  it("grows with the frames", () => {
    expect(faceMeshTimeoutMs(0)).toBe(FACE_MESH_FIXED_MS + FACE_MESH_MS_PER_FRAME)
    expect(faceMeshTimeoutMs(720)).toBe(FACE_MESH_FIXED_MS + 720 * FACE_MESH_MS_PER_FRAME)
  })

  it("reserves both sessions, the decoders and the encoder, more for a larger picture, a mask and a depth render", () => {
    const threads = { decode: 2, filter: 2, encode: 2 }
    const hd = { width: 720, height: 1280 }
    const base = faceMeshPeakMemoryMiB({ detect: hd, draw: hd }, 1, threads)
    expect(base).toBeGreaterThan(FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD + FACE_MESH_SESSION_PEAK_MIB_PER_THREAD + FACE_MESH_DRAW_PEAK_MIB)
    // A second intra-op thread reserves both sessions' working set again.
    expect(faceMeshPeakMemoryMiB({ detect: hd, draw: hd }, 2, threads) - base).toBe(FACE_DETECT_SESSION_PEAK_MIB_PER_THREAD + FACE_MESH_SESSION_PEAK_MIB_PER_THREAD)
    expect(faceMeshPeakMemoryMiB({ detect: hd, draw: hd, mask: hd }, 1, threads)).toBeGreaterThanOrEqual(base)
    // The depth render read beside the drawn clip is one more decoder.
    const withMask = faceMeshPeakMemoryMiB({ detect: hd, draw: hd, mask: hd }, 1, threads)
    expect(faceMeshPeakMemoryMiB({ detect: hd, draw: hd, mask: hd, depth: hd }, 1, threads)).toBeGreaterThanOrEqual(withMask)
    expect(faceMeshPeakMemoryMiB({ detect: { width: 1080, height: 1920 }, draw: { width: 1080, height: 1920 } }, 1, threads)).toBeGreaterThan(base)
  })
})
