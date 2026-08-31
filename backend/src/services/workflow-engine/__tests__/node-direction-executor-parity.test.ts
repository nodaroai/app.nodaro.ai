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
