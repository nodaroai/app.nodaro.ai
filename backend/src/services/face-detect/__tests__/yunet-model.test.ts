/**
 * The pinned model: the bytes on disk are the measured detector, or nothing
 * runs. A different file (a re-export, a corrupted copy, another YuNet) would
 * change recall silently, so the hash is checked at load and a mismatch is a
 * deterministic failure (the job fails and refunds once; a retry reads the
 * same bytes). A missing model or a native module that will not load is the
 * same class: the host cannot detect, so the job is refused.
 */
import { describe, it, expect, afterAll } from "vitest"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { BUILD_ASSETS } from "../../../../scripts/copy-build-assets.mjs"
import { DeterministicJobError } from "../../../lib/deterministic-job-error.js"
import {
  YUNET_DETECTOR_ID,
  YUNET_MODEL_PATH,
  YUNET_MODEL_SHA256,
  YUNET_UPSTREAM_MODEL_PATH,
  YUNET_UPSTREAM_SHA256,
  FaceDetectModelMismatchError,
  FaceDetectorUnavailableError,
  readVerifiedYunetModel,
} from "../yunet-model.js"
import { createYunetSession } from "../yunet-session.js"
import { YUNET_STRIDES } from "../yunet-decode.js"

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex")
const scratch = mkdtempSync(join(tmpdir(), "yunet-model-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

describe("the vendored model files", () => {
  it("the upstream file is OpenCV Zoo's face_detection_yunet_2023mar.onnx, byte for byte", () => {
    expect(YUNET_UPSTREAM_SHA256).toBe("8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4")
    expect(sha256(readFileSync(YUNET_UPSTREAM_MODEL_PATH))).toBe(YUNET_UPSTREAM_SHA256)
  })

  it("the patched file production loads matches its own pinned hash", () => {
    expect(sha256(readFileSync(YUNET_MODEL_PATH))).toBe(YUNET_MODEL_SHA256)
    expect(YUNET_MODEL_SHA256).not.toBe(YUNET_UPSTREAM_SHA256)
  })

  it("the build ships the patched model and its licence into dist/ — and nothing else from the model folder", () => {
    const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
    const asset = BUILD_ASSETS.find((a) => resolve(srcRoot, a.dir) === dirname(YUNET_MODEL_PATH))
    expect(asset, "services/face-detect/model must be a BUILD_ASSETS entry, or the image has no model").toBeDefined()
    const shipped = (name: string) => asset!.match.test(name)
    expect(shipped("face_detection_yunet_2023mar-dyn.onnx")).toBe(true)
    expect(shipped("LICENSE.yunet.txt")).toBe(true)
    expect(shipped("face_detection_yunet_2023mar.onnx")).toBe(false)
    expect(shipped("patch_dyn.py")).toBe(false)
    expect(shipped("README.md")).toBe(false)
  })

  it("the detector id names the patched model by its hash prefix", () => {
    expect(YUNET_DETECTOR_ID).toBe(`yunet:2023mar-dyn@${YUNET_MODEL_SHA256.slice(0, 8)}`)
  })
})

describe("readVerifiedYunetModel", () => {
  it("returns the pinned bytes", async () => {
    const bytes = await readVerifiedYunetModel()
    expect(sha256(bytes)).toBe(YUNET_MODEL_SHA256)
  })

  it("refuses a model whose bytes differ from the pin — deterministically", async () => {
    const tampered = Buffer.from(readFileSync(YUNET_MODEL_PATH))
    tampered[tampered.length - 1] ^= 0xff
    const path = join(scratch, "tampered.onnx")
    writeFileSync(path, tampered)
    const err = await readVerifiedYunetModel(path).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FaceDetectModelMismatchError)
    expect(err).toBeInstanceOf(DeterministicJobError)
    expect(String((err as Error).message)).toMatch(/sha256/)
  })

  it("refuses the UPSTREAM file too: only the patched bytes are the measured detector", async () => {
    await expect(readVerifiedYunetModel(YUNET_UPSTREAM_MODEL_PATH)).rejects.toBeInstanceOf(FaceDetectModelMismatchError)
  })

  it("an absent model file is a deterministic 'detector unavailable' refusal", async () => {
    const err = await readVerifiedYunetModel(join(scratch, "missing.onnx")).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FaceDetectorUnavailableError)
    expect(err).toBeInstanceOf(DeterministicJobError)
  })
})

describe("createYunetSession", () => {
  it("an onnxruntime-node that will not load (absent or wrong-ABI binary) is a deterministic refusal", async () => {
    const err = await createYunetSession({
      importOrt: () => Promise.reject(new Error("Cannot find module '../bin/napi-v6/linux/x64/onnxruntime_binding.node'")),
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FaceDetectorUnavailableError)
    expect(err).toBeInstanceOf(DeterministicJobError)
    expect(String((err as Error).message)).toMatch(/onnxruntime/)
  })

  it("checks the model hash BEFORE handing any bytes to onnxruntime", async () => {
    const tampered = Buffer.from(readFileSync(YUNET_MODEL_PATH))
    tampered[0] ^= 0xff
    const path = join(scratch, "tampered-first.onnx")
    writeFileSync(path, tampered)
    let imported = false
    const err = await createYunetSession({
      modelPath: path,
      importOrt: () => {
        imported = true
        return Promise.reject(new Error("must not be reached"))
      },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FaceDetectModelMismatchError)
    expect(imported).toBe(false)
  })

  it("loads the pinned model on the real onnxruntime-node with YuNet's twelve outputs", async () => {
    const session = await createYunetSession()
    try {
      expect(session.detector).toEqual({ id: YUNET_DETECTOR_ID, version: YUNET_MODEL_SHA256.slice(0, 8) })
      expect(session.intraOpThreads).toBe(1)
      // One zero 960×544 frame — the build-time smoke's input.
      const out = await session.run(new Float32Array(3 * 960 * 544), 960, 544)
      for (const st of YUNET_STRIDES) {
        const n = (960 / st) * (544 / st)
        expect(out[`cls_${st}`].length).toBe(n)
        expect(out[`bbox_${st}`].length).toBe(4 * n)
        expect(out[`kps_${st}`].length).toBe(10 * n)
      }
    } finally {
      await session.release()
    }
  })
})
