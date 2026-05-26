import { describe, it, expect } from "vitest"
import {
  pipelineContext,
  getPipelineSignal,
  getPipelineId,
} from "../pipeline-context.js"

describe("pipelineContext", () => {
  it("returns undefined outside an ALS frame", () => {
    expect(getPipelineSignal()).toBeUndefined()
    expect(getPipelineId()).toBeUndefined()
  })

  it("propagates signal + pipelineId to nested async code", async () => {
    const ctrl = new AbortController()
    await pipelineContext.run(
      { signal: ctrl.signal, pipelineId: "p-test" },
      async () => {
        expect(getPipelineId()).toBe("p-test")
        // Reachable through an arbitrary async boundary.
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
        expect(getPipelineSignal()).toBe(ctrl.signal)
        expect(getPipelineSignal()?.aborted).toBe(false)
        ctrl.abort()
        expect(getPipelineSignal()?.aborted).toBe(true)
      },
    )
    // Outside the frame again — back to undefined.
    expect(getPipelineSignal()).toBeUndefined()
  })

  it("isolates concurrent runs (no cross-context bleed)", async () => {
    const ctrlA = new AbortController()
    const ctrlB = new AbortController()
    const seen: Array<{ pid: string; aborted: boolean }> = []

    const runA = pipelineContext.run(
      { signal: ctrlA.signal, pipelineId: "p-A" },
      async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5))
        seen.push({
          pid: getPipelineId() ?? "??",
          aborted: getPipelineSignal()?.aborted ?? false,
        })
      },
    )

    const runB = pipelineContext.run(
      { signal: ctrlB.signal, pipelineId: "p-B" },
      async () => {
        ctrlB.abort()
        await new Promise<void>((resolve) => setTimeout(resolve, 2))
        seen.push({
          pid: getPipelineId() ?? "??",
          aborted: getPipelineSignal()?.aborted ?? false,
        })
      },
    )

    await Promise.all([runA, runB])
    // Each frame sees its own pipelineId + signal state; aborting B
    // doesn't affect A.
    const a = seen.find((s) => s.pid === "p-A")
    const b = seen.find((s) => s.pid === "p-B")
    expect(a?.aborted).toBe(false)
    expect(b?.aborted).toBe(true)
  })
})
