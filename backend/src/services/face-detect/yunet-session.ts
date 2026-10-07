/**
 * The onnxruntime-node session for YuNet — one per worker process, created on
 * first use.
 *
 * `onnxruntime-node` is a native module (a prebuilt `libonnxruntime.so`). It is
 * imported LAZILY, so a process that never detects a face (every community
 * install, the API, the orchestrator) never loads it; a host where it cannot
 * load (no binary for the platform, a glibc/ABI mismatch) refuses the job with
 * `FaceDetectorUnavailableError` instead of crashing at boot. The Docker build
 * runs one zero frame through it so an ABI mismatch fails the image, not the
 * first job (`scripts/face-detect-smoke.mjs`).
 *
 * The session options are the measured configuration (P3.0b holdout,
 * 2026-10-06): one intra-op thread, one inter-op thread, sequential execution,
 * every graph optimization. Runs on the shared session are serialized: each
 * caller holds its own admission (`detect-faces.ts`), and one thread per run is
 * the operating point the price is derived from.
 *
 * WHERE IT RUNS: on the worker's main JS thread. onnxruntime-node 1.30.0's
 * `run()` is `setImmediate(() => resolve(nativeSession.run(...)))` — a
 * synchronous native call — and with one intra-op thread onnxruntime computes
 * on the calling thread. So each frame blocks the event loop for its whole
 * inference (~10–16 ms at 540p), and a window keeps the loop busy for most of
 * its length; concurrent windows in one worker take turns on it through the
 * queue below. Each stall is short (the heartbeat test in
 * `detect-faces.parity.test.ts` bounds it); the total busy time is not. If the
 * P3.0f measurement shows heartbeat or lock-renewal lag under concurrent
 * windows, the remedy is the P3.3 fallback: run the session in a
 * `worker_threads` worker.
 */
import { DeterministicJobError } from "../../lib/deterministic-job-error.js"
import { FACE_DETECT_ORT_INTRA_OP_THREADS } from "./face-detect-budget.js"
import { FaceDetectorUnavailableError, YUNET_DETECTOR, YUNET_MODEL_PATH, readVerifiedYunetModel } from "./yunet-model.js"
import type { YunetOutputs } from "./yunet-decode.js"

type OrtModule = typeof import("onnxruntime-node")

export interface YunetSession {
  readonly detector: { readonly id: string; readonly version: string }
  /** The intra-op thread count the session runs with — what the admission reserves for. */
  readonly intraOpThreads: number
  /** Run one padded `1 × 3 × ph × pw` frame. Serialized per session; blocks
   *  the calling (main JS) thread for the inference itself. */
  run(input: Float32Array, pw: number, ph: number): Promise<YunetOutputs>
  release(): Promise<void>
}

export interface CreateYunetSessionOptions {
  /** Default: the pinned model beside this module. */
  readonly modelPath?: string
  /** Default: `import("onnxruntime-node")`. A test seam for the absent-binary refusal. */
  readonly importOrt?: () => Promise<OrtModule | { default: OrtModule }>
}

const defaultImportOrt = () => import("onnxruntime-node")

/** Build a session from the verified model bytes. Not cached — see `yunetSession`. */
export async function createYunetSession(opts: CreateYunetSessionOptions = {}): Promise<YunetSession> {
  // The hash first: onnxruntime never sees bytes that are not the pin.
  const model = await readVerifiedYunetModel(opts.modelPath ?? YUNET_MODEL_PATH)
  let ort: OrtModule
  try {
    const mod = await (opts.importOrt ?? defaultImportOrt)()
    ort = ((mod as { default?: OrtModule }).default ?? mod) as OrtModule
  } catch (err) {
    throw new FaceDetectorUnavailableError(`onnxruntime-node did not load (${(err as Error)?.message ?? String(err)})`)
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
    throw new FaceDetectorUnavailableError(`onnxruntime could not build the YuNet session (${(err as Error)?.message ?? String(err)})`)
  }
  const inputName = session.inputNames[0] ?? "input"

  let queue: Promise<unknown> = Promise.resolve()
  const run = (input: Float32Array, pw: number, ph: number): Promise<YunetOutputs> => {
    const next = queue.then(async () => {
      const outs = await session.run({ [inputName]: new ort.Tensor("float32", input, [1, 3, ph, pw]) })
      const flat: Record<string, ArrayLike<number>> = {}
      for (const [name, tensor] of Object.entries(outs)) flat[name] = tensor.data as Float32Array
      return flat as YunetOutputs
    })
    // The queue survives a failed run; the caller still sees the failure.
    queue = next.catch(() => undefined)
    return next
  }

  return {
    detector: YUNET_DETECTOR,
    intraOpThreads,
    run,
    release: async () => {
      await queue
      await session.release()
    },
  }
}

let shared: Promise<YunetSession> | undefined

/** The process's session, created on first use. A failed creation is not
 *  cached: the next call tries again (and fails the same way, deterministically). */
export function yunetSession(): Promise<YunetSession> {
  if (!shared) {
    shared = createYunetSession()
    shared.catch(() => {
      shared = undefined
    })
  }
  return shared
}

/** Release the process's session (tests; a worker shutting down). */
export async function releaseYunetSession(): Promise<void> {
  const s = shared
  shared = undefined
  if (s) await (await s.catch(() => undefined))?.release()
}
