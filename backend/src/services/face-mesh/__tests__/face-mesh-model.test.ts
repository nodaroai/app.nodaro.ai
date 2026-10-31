// @test-watches backend/src/services/face-mesh/model/** backend/scripts/copy-build-assets.mjs
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { BUILD_ASSETS } from "../../../../scripts/copy-build-assets.mjs"
import { DeterministicJobError } from "../../../lib/deterministic-job-error.js"
import {
  FACE_MESH_MODEL_PATH,
  FACE_MESH_MODEL_SHA256,
  FaceMeshModelMismatchError,
  FaceMeshUnavailableError,
  readVerifiedFaceMeshModel,
} from "../face-mesh-model.js"
import { createFaceMeshSession } from "../face-mesh-session.js"
import { faceMeshPeakMemoryMiB, faceMeshTimeoutMs, FACE_MESH_FIXED_MS, FACE_MESH_MS_PER_FRAME } from "../face-mesh-budget.js"

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "face-mesh-model-"))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe("the pinned face landmark model", () => {
  it("is the committed file", () => {
    expect(createHash("sha256").update(readFileSync(FACE_MESH_MODEL_PATH)).digest("hex")).toBe(FACE_MESH_MODEL_SHA256)
  })

  it("the build ships the model and its licence into dist/ — and nothing else from the model folder", () => {
    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
    const asset = BUILD_ASSETS.find((a) => resolve(srcRoot, a.dir) === dirname(FACE_MESH_MODEL_PATH))
    expect(asset, "services/face-mesh/model must be a BUILD_ASSETS entry, or the image has no model").toBeDefined()
    expect(asset!.match.test("face_landmark.onnx")).toBe(true)
    expect(asset!.match.test("LICENSE.mediapipe.txt")).toBe(true)
    expect(asset!.match.test("README.md")).toBe(false)
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

  it("runs a crop: 468 points and a presence logit", async () => {
    const s = await createFaceMeshSession()
    try {
      const out = await s.run(new Float32Array(192 * 192 * 3).fill(0.5))
      expect(out.landmarks).toHaveLength(468 * 3)
      expect(Number.isFinite(out.presenceLogit)).toBe(true)
      expect(s.intraOpThreads).toBe(1)
    } finally {
      await s.release()
    }
  })
})

describe("the run's budget", () => {
  it("grows with the frames", () => {
    expect(faceMeshTimeoutMs(0)).toBe(FACE_MESH_FIXED_MS + FACE_MESH_MS_PER_FRAME)
    expect(faceMeshTimeoutMs(720)).toBe(FACE_MESH_FIXED_MS + 720 * FACE_MESH_MS_PER_FRAME)
  })

  it("reserves both sessions, the decoders and the encoder, more for a larger picture and a mask", () => {
    const threads = { decode: 2, filter: 2, encode: 2 }
    const hd = { width: 720, height: 1280 }
    const base = faceMeshPeakMemoryMiB({ detect: hd, draw: hd }, 1, threads)
    expect(base).toBeGreaterThan(332 + 128)
    expect(faceMeshPeakMemoryMiB({ detect: hd, draw: hd, mask: hd }, 1, threads)).toBeGreaterThanOrEqual(base)
    expect(faceMeshPeakMemoryMiB({ detect: { width: 1080, height: 1920 }, draw: { width: 1080, height: 1920 } }, 1, threads)).toBeGreaterThan(base)
  })
})
