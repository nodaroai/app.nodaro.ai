/**
 * THE PINNED YUNET MODEL — the file, its hash, and the refusal when either is
 * wrong.
 *
 * The detector the v1 bar was measured on is OpenCV Zoo's
 * `face_detection_yunet_2023mar.onnx` (MIT, © 2020 Shiqi Yu) with its input
 * made dynamic-shape (`model/patch_dyn.py`, `model/README.md`). Any other bytes
 * are another detector, so the file is read whole, hashed, and refused on a
 * mismatch BEFORE onnxruntime sees it — and the session is built from those
 * same verified bytes, never by re-reading the path.
 *
 * Both refusals are deterministic (`DeterministicJobError`): a retry reads the
 * same file on the same host, so the job fails and refunds once.
 */
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"

/** sha256 of the upstream file (OpenCV Zoo, `models/face_detection_yunet/`). */
export const YUNET_UPSTREAM_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
/** sha256 of the patched file production loads. */
export const YUNET_MODEL_SHA256 = "57acd73224bfbe2a2d6d28431da2e7c5b1d643717407e7cf2cae3d4a07ce2c14"

/** The patched model. Resolved beside this module, so it is the same file under
 *  `src/` (tests, dev) and `dist/` (shipped by `scripts/copy-build-assets.mjs`). */
export const YUNET_MODEL_PATH = fileURLToPath(new URL("./model/face_detection_yunet_2023mar-dyn.onnx", import.meta.url))
/** The unmodified upstream file — kept for provenance; never loaded. */
export const YUNET_UPSTREAM_MODEL_PATH = fileURLToPath(new URL("./model/face_detection_yunet_2023mar.onnx", import.meta.url))

/** What a track set records as its `detector` (P3-7's informational field). */
export const YUNET_DETECTOR = {
  id: `yunet:2023mar-dyn@${YUNET_MODEL_SHA256.slice(0, 8)}`,
  version: YUNET_MODEL_SHA256.slice(0, 8),
} as const
export const YUNET_DETECTOR_ID = YUNET_DETECTOR.id

/** The host cannot run the detector: the model file or the native module is
 *  missing, or onnxruntime would not load or build a session. */
export class FaceDetectorUnavailableError extends DeterministicJobError {
  constructor(reason: string) {
    super(`face detector unavailable: ${reason}`)
    this.name = "FaceDetectorUnavailableError"
  }
}

/** The model on disk is not the pinned file. */
export class FaceDetectModelMismatchError extends DeterministicJobError {
  constructor(readonly actualSha256: string) {
    super(
      `face detector model sha256 ${actualSha256.slice(0, 12)}… is not the pinned ${YUNET_MODEL_SHA256.slice(0, 12)}…` +
        " — refusing to run an unmeasured detector",
    )
    this.name = "FaceDetectModelMismatchError"
  }
}

/** The model's bytes, verified against the pin. */
export async function readVerifiedYunetModel(path: string = YUNET_MODEL_PATH): Promise<Buffer> {
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    throw new FaceDetectorUnavailableError(`the model file is missing or unreadable (${code ?? String(err)})`)
  }
  const actual = createHash("sha256").update(bytes).digest("hex")
  if (actual !== YUNET_MODEL_SHA256) throw new FaceDetectModelMismatchError(actual)
  return bytes
}
