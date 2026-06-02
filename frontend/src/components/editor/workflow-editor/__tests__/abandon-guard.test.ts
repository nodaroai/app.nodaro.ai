import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
// `vi.mock` is hoisted above all imports/consts, so the factory must close over
// a hoisted ref — `vi.hoisted` gives us a `getState` that exists when the mock
// factory runs. (A plain `const getState` would be in the temporal dead zone.)
const { getState } = vi.hoisted(() => ({ getState: vi.fn() }))
vi.mock("@/hooks/use-workflow-store", () => ({ useWorkflowStore: { getState } }))
import { shouldAbandonNode } from "../abandon-guard"

describe("shouldAbandonNode", () => {
  it("returns false when the node's currentJobId still matches", () => {
    getState.mockReturnValue({ nodes: [{ id: "n1", data: { currentJobId: "job-1" } }] })
    expect(shouldAbandonNode("n1", "job-1")).toBe(false)
  })
  it("returns true when currentJobId was cleared or replaced (discarded)", () => {
    getState.mockReturnValue({ nodes: [{ id: "n1", data: { currentJobId: undefined } }] })
    expect(shouldAbandonNode("n1", "job-1")).toBe(true)
    getState.mockReturnValue({ nodes: [{ id: "n1", data: { currentJobId: "job-2" } }] })
    expect(shouldAbandonNode("n1", "job-1")).toBe(true)
  })
  it("returns true when the node no longer exists", () => {
    getState.mockReturnValue({ nodes: [] })
    expect(shouldAbandonNode("n1", "job-1")).toBe(true)
  })
  it("never abandons during a list fan-out (__listRunning) even on a job mismatch", () => {
    // Mid-fan-out, N concurrent iterations share one currentJobId slot, so the
    // single-job match is meaningless. The guard must NOT abandon, or parallel
    // iterations silently drop their results (the Task 6 HIGH regression).
    getState.mockReturnValue({
      nodes: [{ id: "n1", data: { __listRunning: true, currentJobId: "job-Y" } }],
    })
    expect(shouldAbandonNode("n1", "job-X")).toBe(false)
  })
  it("resumes normal abandon behavior once __listRunning clears", () => {
    getState.mockReturnValue({
      nodes: [{ id: "n1", data: { __listRunning: false, currentJobId: "job-Y" } }],
    })
    expect(shouldAbandonNode("n1", "job-X")).toBe(true)
  })
})

// __dirname shim for ESM — mirrors generate-text-parity.test.ts. This file
// sits in workflow-editor/__tests__/, so the loop modules are one level up.
const HERE = dirname(fileURLToPath(import.meta.url))

describe("abandon-guard coverage", () => {
  // Anti-drift invariant: every single-node poll loop must import the abandon
  // guard. A new poll loop added to one of these files without the guard makes
  // detach node-type-dependent (a silent bug). Source-text match (not runtime
  // import) keeps this membership check from pulling in React Flow + stores.
  it("every single-node poll loop imports the abandon guard", () => {
    for (const f of [
      "poll-job.ts",
      "node-executors.ts",
      "asset-executors.ts",
      "execute-node.ts",
      "component-executor.ts",
      "run-handlers.ts",
    ]) {
      const src = readFileSync(resolve(HERE, "..", f), "utf8")
      expect(src, f).toMatch(/shouldAbandonNode/)
    }
  })
})
