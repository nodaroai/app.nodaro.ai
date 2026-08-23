/**
 * The store is mostly plain state; the one thing worth pinning is that
 * registering the bridge with values it already holds is a genuine no-op —
 * the panel re-registers on every editor render, and a fresh object each time
 * would re-render every subscriber for nothing.
 */
import { describe, expect, it } from "vitest"
import { useCopilotStore } from "../turn-store"

describe("setBridge", () => {
  it("does not replace the bridge when nothing changed", () => {
    const run = async () => ({ executionId: null })
    useCopilotStore.getState().setBridge({ run, creditEstimate: 12 })
    const first = useCopilotStore.getState().bridge

    useCopilotStore.getState().setBridge({ run, creditEstimate: 12 })

    expect(useCopilotStore.getState().bridge).toBe(first)
  })

  it("replaces it when a value actually moved", () => {
    useCopilotStore.getState().setBridge({ creditEstimate: 12 })
    const first = useCopilotStore.getState().bridge

    useCopilotStore.getState().setBridge({ creditEstimate: 13 })

    expect(useCopilotStore.getState().bridge).not.toBe(first)
    expect(useCopilotStore.getState().bridge.creditEstimate).toBe(13)
  })
})
