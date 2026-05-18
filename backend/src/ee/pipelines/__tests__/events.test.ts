import { describe, it, expect, vi } from "vitest"
import { pipelineEvents } from "../events.js"

describe("pipelineEvents", () => {
  it("delivers events to subscribers of the matching pipelineId only", () => {
    const cb1 = vi.fn()
    const cb2 = vi.fn()
    pipelineEvents.subscribe("p1", cb1)
    pipelineEvents.subscribe("p2", cb2)
    pipelineEvents.publish({ type: "pipeline:status", pipelineId: "p1", status: "running" })
    expect(cb1).toHaveBeenCalledTimes(1)
    expect(cb2).not.toHaveBeenCalled()
  })

  it("unsubscribe removes the listener", () => {
    const cb = vi.fn()
    const unsub = pipelineEvents.subscribe("p3", cb)
    unsub()
    pipelineEvents.publish({ type: "pipeline:status", pipelineId: "p3", status: "completed" })
    expect(cb).not.toHaveBeenCalled()
  })
})
