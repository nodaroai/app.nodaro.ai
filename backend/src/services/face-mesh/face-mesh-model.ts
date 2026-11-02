/**
 * THE PINNED FACE LANDMARK MODEL — the file, its hash, and the refusal when
 * either is wrong (the same discipline as YuNet's, `../face-detect/yunet-model.ts`).
 *
 * MediaPipe's FaceLandmarker landmark model, `face_landmarks_detector.tflite`
 * from the `face_landmarker.task` bundle (Apache-2.0, © The MediaPipe
 * Authors): the refined mesh, its lips and eyes read closer than the basic
 * `face_landmark.tflite` it replaced (2026-11-02). Converted to ONNX with
 * tf2onnx (`model/README.md`). Any other bytes are another mesh, so the file
 * is read whole, hashed, and refused on a mismatch BEFORE onnxruntime sees it
 * — and the session is built from those same verified bytes, never by
 * re-reading the path.
 *
 * Both refusals are deterministic (`DeterministicJobError`): a retry reads the
 * same file on the same host, so the job fails and refunds once.
 */
// @reads backend/src/services/face-mesh/model/**
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"

/** sha256 of the upstream bundle, `face_landmarker.task` (mediapipe-models, float16, version 1), the tflite was taken from. */
export const FACE_MESH_UPSTREAM_BUNDLE_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"
/** sha256 of the upstream `face_landmarks_detector.tflite` (inside that bundle) the file was converted from. */
export const FACE_MESH_UPSTREAM_SHA256 = "c7d54204ce0448474c7f3fa9af494787c0965cbdd6f20fc72867e43046bd43d5"
/** sha256 of the converted ONNX file production loads. */
export const FACE_MESH_MODEL_SHA256 = "bc826d2f6cb7a6c9ef9f3a2854217314f5a75ec5bae29486b85576b9cba77bb9"

/** The model. Resolved beside this module, so it is the same file under
 *  `src/` (tests, dev) and `dist/` (shipped by `scripts/copy-build-assets.mjs`). */
export const FACE_MESH_MODEL_PATH = fileURLToPath(new URL("./model/face_landmarks_detector.onnx", import.meta.url))

/** The crop the model reads: 256 × 256 RGB. */
export const FACE_MESH_INPUT_SIZE = 256
/** Points the model answers per face: the face's 468, then the two irises' 5 each (468–477). */
export const FACE_MESH_MODEL_POINTS = 478
/** Points drawn per face: the model's first 468, the face mesh's topology (`face-mesh-topology.ts`). The irises are not drawn. */
export const FACE_MESH_POINTS = 468

/** The host cannot run the mesh: the model file or the native module is
 *  missing, or onnxruntime would not load or build a session. */
export class FaceMeshUnavailableError extends DeterministicJobError {
  constructor(reason: string) {
    super(`face mesh unavailable: ${reason}`)
    this.name = "FaceMeshUnavailableError"
  }
}

/** The model on disk is not the pinned file. */
export class FaceMeshModelMismatchError extends DeterministicJobError {
  constructor(readonly actualSha256: string) {
    super(
      `face mesh model sha256 ${actualSha256.slice(0, 12)}… is not the pinned ${FACE_MESH_MODEL_SHA256.slice(0, 12)}…` +
        " — refusing to run an unmeasured model",
    )
    this.name = "FaceMeshModelMismatchError"
  }
}

/** The model's bytes, verified against the pin. */
export async function readVerifiedFaceMeshModel(path: string = FACE_MESH_MODEL_PATH): Promise<Buffer> {
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    throw new FaceMeshUnavailableError(`the model file is missing or unreadable (${code ?? String(err)})`)
  }
  const actual = createHash("sha256").update(bytes).digest("hex")
  if (actual !== FACE_MESH_MODEL_SHA256) throw new FaceMeshModelMismatchError(actual)
  return bytes
}
