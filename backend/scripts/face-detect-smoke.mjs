#!/usr/bin/env node
/**
 * Build-time smoke for the face detector's native runtime: load
 * onnxruntime-node, build a session on the YuNet model, and run one zero
 * 960×544 frame (a padded 540p frame, the production input).
 *
 * The Docker build runs it in the stage that installs the production
 * dependencies, on the same glibc as the runner, AFTER the other platforms'
 * binaries are pruned — so a glibc/ABI mismatch, or a prune that removed the
 * binary this platform needs, fails the IMAGE, not the first Speaker Frames job.
 * The model's hash is checked at runtime (src/services/face-detect/yunet-model.ts),
 * not here.
 *
 * Usage: node face-detect-smoke.mjs <model.onnx>
 */
import { readFileSync } from "node:fs"
import ort from "onnxruntime-node"

const modelPath = process.argv[2]
if (!modelPath) {
  console.error("usage: face-detect-smoke.mjs <model.onnx>")
  process.exit(2)
}

const session = await ort.InferenceSession.create(readFileSync(modelPath), {
  intraOpNumThreads: 1,
  interOpNumThreads: 1,
  executionMode: "sequential",
  graphOptimizationLevel: "all",
})
const [pw, ph] = [960, 544]
const outs = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", new Float32Array(3 * pw * ph), [1, 3, ph, pw]) })
const cls8 = outs.cls_8
if (!cls8 || cls8.data.length !== (pw / 8) * (ph / 8)) {
  console.error(`face-detect smoke: unexpected outputs (${Object.keys(outs).join(", ")})`)
  process.exit(1)
}
await session.release()
console.log(`face-detect smoke: onnxruntime-node ${ort.env.versions?.common ?? "?"} ran YuNet on ${process.platform}/${process.arch}`)
