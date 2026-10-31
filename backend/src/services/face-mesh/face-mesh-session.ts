/**
 * The onnxruntime-node session for the face landmark model — one per worker
 * process, created on first use (YuNet's pattern, `../face-detect/yunet-session.ts`).
 *
 * `onnxruntime-node` is imported LAZILY: a process that never draws a mesh
 * never loads it, and a host where it cannot load refuses the job with
 * `FaceMeshUnavailableError` instead of crashing at boot. Same operating point
 * as YuNet: one intra-op thread (`FACE_DETECT_ORT_INTRA_OP_THREADS`), one
 * inter-op thread, sequential execution — so the inference runs synchronously
 * on the worker's main JS thread, each crop a short stall (a few ms), and the
 * runs on the shared session are serialized.
 */
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { FACE_DETECT_ORT_INTRA_OP_THREADS } from "../face-detect/face-detect-budget.js"
import {
  FACE_MESH_INPUT_SIZE,
  FACE_MESH_MODEL_PATH,
  FACE_MESH_POINTS,
  FaceMeshUnavailableError,
  readVerifiedFaceMeshModel,
} from "./face-mesh-model.js"

type OrtModule = typeof import("onnxruntime-node")

/** The graph's output holding 468 × (x, y, z) in crop pixels. */
export const FACE_MESH_LANDMARKS_OUTPUT = "conv2d_21"
/** The graph's output holding the face presence logit. */
export const FACE_MESH_PRESENCE_OUTPUT = "conv2d_31"

export interface FaceMeshOutput {
  /** 468 × (x, y, z), x and y in pixels of the 192 × 192 crop. */
  readonly landmarks: Float32Array
  /** The presence logit (sigmoid > 0.5 = a face). */
  readonly presenceLogit: number
}

export interface FaceMeshSession {
  /** The intra-op thread count the session runs with — what the admission reserves for. */
  readonly intraOpThreads: number
  /** Run one `1 × 192 × 192 × 3` NHWC RGB crop in [0, 1]. Serialized per session. */
  run(input: Float32Array): Promise<FaceMeshOutput>
  release(): Promise<void>
}

export interface CreateFaceMeshSessionOptions {
  /** Default: the pinned model beside this module. */
  readonly modelPath?: string
  /** Default: `import("onnxruntime-node")`. A test seam for the absent-binary refusal. */
  readonly importOrt?: () => Promise<OrtModule | { default: OrtModule }>
}

const defaultImportOrt = () => import("onnxruntime-node")

/** Build a session from the verified model bytes. Not cached — see `faceMeshSession`. */
export async function createFaceMeshSession(opts: CreateFaceMeshSessionOptions = {}): Promise<FaceMeshSession> {
  const model = await readVerifiedFaceMeshModel(opts.modelPath ?? FACE_MESH_MODEL_PATH)
  let ort: OrtModule
  try {
    const mod = await (opts.importOrt ?? defaultImportOrt)()
    ort = ((mod as { default?: OrtModule }).default ?? mod) as OrtModule
  } catch (err) {
    throw new FaceMeshUnavailableError(`onnxruntime-node did not load (${(err as Error)?.message ?? String(err)})`)
  }
  const intraOpThreads = FACE_DETECT_ORT_INTRA_OP_THREADS
  let session: Awaited<ReturnType<OrtModule["InferenceSession"]["create"]>>
  try {
    session = await ort.InferenceSession.create(model, {
      intraOpNumThreads: intraOpThreads,
      interOpNumThreads: 1,
      executionMode: "sequential",
      graphOptimizationLevel: "all",
    })
  } catch (err) {
    if (err instanceof DeterministicJobError) throw err
    throw new FaceMeshUnavailableError(`onnxruntime could not build the face mesh session (${(err as Error)?.message ?? String(err)})`)
  }
  const inputName = session.inputNames[0] ?? "input_1"
  const size = FACE_MESH_INPUT_SIZE

  let queue: Promise<unknown> = Promise.resolve()
  const run = (input: Float32Array): Promise<FaceMeshOutput> => {
    const next = queue.then(async () => {
      const outs = await session.run({ [inputName]: new ort.Tensor("float32", input, [1, size, size, 3]) })
      const landmarks = outs[FACE_MESH_LANDMARKS_OUTPUT]?.data as Float32Array | undefined
      const presence = outs[FACE_MESH_PRESENCE_OUTPUT]?.data as Float32Array | undefined
      if (!landmarks || landmarks.length !== FACE_MESH_POINTS * 3 || !presence || presence.length !== 1) {
        throw new FaceMeshUnavailableError("the model's outputs are not the pinned graph's")
      }
      // Copied: the tensor's buffer is the session's, reused by the next run.
      return { landmarks: Float32Array.from(landmarks), presenceLogit: presence[0]! }
    })
    // The queue survives a failed run; the caller still sees the failure.
    queue = next.catch(() => undefined)
    return next
  }

  return {
    intraOpThreads,
    run,
    release: async () => {
      await queue
      await session.release()
    },
  }
}

let shared: Promise<FaceMeshSession> | undefined

/** The process's session, created on first use. A failed creation is not cached. */
export function faceMeshSession(): Promise<FaceMeshSession> {
  if (!shared) {
    shared = createFaceMeshSession()
    shared.catch(() => {
      shared = undefined
    })
  }
  return shared
}

/** Release the process's session (tests; a worker shutting down). */
export async function releaseFaceMeshSession(): Promise<void> {
  const s = shared
  shared = undefined
  if (s) await (await s.catch(() => undefined))?.release()
}
