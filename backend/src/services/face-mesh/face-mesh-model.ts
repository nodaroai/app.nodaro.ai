/**
 * THE PINNED FACE LANDMARK MODEL — the file, its hash, and the refusal when
 * either is wrong (the same discipline as YuNet's, `../face-detect/yunet-model.ts`).
 *
 * MediaPipe's `face_landmark.tflite` (Apache-2.0, © The MediaPipe Authors),
 * converted to ONNX with tf2onnx (`model/README.md`). Any other bytes are
 * another mesh, so the file is read whole, hashed, and refused on a mismatch
 * BEFORE onnxruntime sees it — and the session is built from those same
 * verified bytes, never by re-reading the path.
 *
 * Both refusals are deterministic (`DeterministicJobError`): a retry reads the
 * same file on the same host, so the job fails and refunds once.
 */
// @reads backend/src/services/face-mesh/model/**
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"

/** sha256 of the upstream `face_landmark.tflite` (mediapipe-assets) the file was converted from. */
export const FACE_MESH_UPSTREAM_SHA256 = "1055cb9d4a9ca8b8c688902a3a5194311138ba256bcc94e336d8373a5f30c814"
/** sha256 of the converted ONNX file production loads. */
export const FACE_MESH_MODEL_SHA256 = "2e1fedebb790b9a2b23856ca4182e1feadb39ad94a59014a7e65824d07a7d6c4"

/** The model. Resolved beside this module, so it is the same file under
 *  `src/` (tests, dev) and `dist/` (shipped by `scripts/copy-build-assets.mjs`). */
export const FACE_MESH_MODEL_PATH = fileURLToPath(new URL("./model/face_landmark.onnx", import.meta.url))

/** The crop the model reads: 192 × 192 RGB. */
export const FACE_MESH_INPUT_SIZE = 192
/** Points per face. */
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
