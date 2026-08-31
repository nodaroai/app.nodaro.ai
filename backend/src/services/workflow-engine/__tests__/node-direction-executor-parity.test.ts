/**
 * CROSS-TREE SOURCE GATE — the frontend single-node executor and the config
 * panel's final-prompt preview must read a node's stored `direction` /
 * `structured` through the SAME narrow readers the orchestrator uses.
 *
 * WHY A SOURCE-TEXT GATE: if only ONE executor honors the stored ids, the same
 * graph produces two different prompts depending on whether the user pressed
 * Run on the node or ran the DAG — and if the preview does not honor them, the
 * config panel's "final prompt" understates every direction-carrying run. There
 * is no executed-run harness for the frontend `generate-image` branch, so a
 * source-level assertion is the honest guard. It lives in `backend/` on purpose:
 * this file mentions a `frontend/` path, so CI's Type Check job auto-discovers
 * it and a frontend-only follow-up PR cannot dodge it (same shape as
 * `backend/src/__tests__/route-path-parity.test.ts`).
 *
 * IF THIS FAILS after a deliberate refactor: UPDATE THE PATTERN, do not delete
 * the gate — the drift it catches is silent and reaches the model.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..")

const SITES = [
  "frontend/src/components/editor/workflow-editor/execute-node.ts",
  "frontend/src/components/editor/config-panels/build-image-assemble-input.ts",
] as const

const FIX_HINT =
  "If the call moved or was renamed, update this pattern — do NOT delete the gate. " +
  "It is the only thing keeping a single-node run, a DAG run and the config-panel " +
  "preview from folding a node's stored direction differently."

describe("canvas node-data direction: frontend ↔ backend source parity", () => {
  for (const site of SITES) {
    it(`${site} narrow-reads direction and structured`, () => {
      const source = readFileSync(join(REPO_ROOT, site), "utf8")
      expect(source, `${site} must call readDirectionFields(...). ${FIX_HINT}`).toContain(
        "readDirectionFields(",
      )
      expect(source, `${site} must call readStructuredFields(...). ${FIX_HINT}`).toContain(
        "readStructuredFields(",
      )
    })
  }

  it("execute-node forwards both levers into its generate-image assembleImageInput call", () => {
    // Reading them without forwarding them is the silent half of the failure:
    // the reader runs, the fold never happens.
    const source = readFileSync(join(REPO_ROOT, SITES[0]), "utf8")
    const start = source.indexOf("const result = assembleImageInput({")
    expect(start, `execute-node's generate-image assembleImageInput call moved. ${FIX_HINT}`)
      .toBeGreaterThan(-1)
    const region = source.slice(start, start + 2500)
    expect(region, `execute-node must pass \`direction\`. ${FIX_HINT}`).toContain("{ direction:")
    expect(region, `execute-node must pass \`structured\`. ${FIX_HINT}`).toContain("{ structured:")
  })

  it("the preview builder returns both levers on its AssembleImageInput", () => {
    const source = readFileSync(join(REPO_ROOT, SITES[1]), "utf8")
    expect(source, `the preview builder must return \`direction\`. ${FIX_HINT}`).toMatch(
      /^\s*direction,\s*$/m,
    )
    expect(source, `the preview builder must return \`structured\`. ${FIX_HINT}`).toMatch(
      /^\s*structured,\s*$/m,
    )
  })
})

/**
 * The VIDEO half of the same gate (P4b). The unified `generate-video` node is
 * re-typed to image-to-video / text-to-video before the frontend composes, so
 * the fold lives in BOTH of those branches — a leg wired into only one silently
 * drops a stored look for half the graphs. `video-prompt-assembly.ts` is the
 * preview's copy of that same composition and must fold identically.
 *
 * The behavioural halves are executed elsewhere:
 * `payload-builder-video-node-direction.test.ts` (orchestrator) and
 * `frontend/…/__tests__/preview-run-parity.test.ts` (run ↔ preview). This gate
 * adds what neither can: that the two frontend BRANCHES both carry the call.
 */
const VIDEO_FIX_HINT =
  "If the fold moved or was renamed, update this pattern — do NOT delete the gate. " +
  "A generate-video node is re-typed onto BOTH branches, so a fold in only one " +
  "makes a single-node run disagree with itself depending on whether a start " +
  "frame is wired."

describe("canvas node-data direction: the VIDEO executors fold the stored ids", () => {
  it("execute-node folds in BOTH the image-to-video and text-to-video branches", () => {
    const source = readFileSync(join(REPO_ROOT, SITES[0]), "utf8")
    for (const lever of [
      "readDirectionFields(i2vData.direction)",
      "readStructuredFields(i2vData.structured)",
      "readDirectionFields(t2vData.direction)",
      "readStructuredFields(t2vData.structured)",
    ]) {
      expect(source, `execute-node must call \`${lever}\`. ${VIDEO_FIX_HINT}`).toContain(lever)
    }
    // Reading them without folding them is the silent half of the failure.
    const folds = source.split("composeVideoPromptText(").length - 1
    expect(folds, `execute-node must fold via composeVideoPromptText twice. ${VIDEO_FIX_HINT}`)
      .toBeGreaterThanOrEqual(2)
  })

  it("the video preview assembler folds through the same composer", () => {
    const source = readFileSync(join(REPO_ROOT, "frontend/src/lib/video-prompt-assembly.ts"), "utf8")
    for (const call of [
      "composeVideoPromptText(",
      "readDirectionFields(data.direction)",
      "readStructuredFields(data.structured)",
    ]) {
      expect(source, `video-prompt-assembly must call \`${call}\`. ${VIDEO_FIX_HINT}`).toContain(
        call,
      )
    }
  })
})
