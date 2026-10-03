/**
 * A notice's View is one-shot: the Executions tab opens the run it was asked
 * to, and a later visit to the tab — or another workflow — opens nothing.
 */
import { describe, it, expect } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useRunFocus } from "../use-run-focus"

const FOCUS = { executionId: "run-1", openResult: true, at: 1 }

function setup() {
  return renderHook(({ tab, workflowId }) => useRunFocus(tab, workflowId), {
    initialProps: { tab: "editor", workflowId: "wf-1" as string | null },
  })
}

describe("useRunFocus", () => {
  it("holds the run while the Executions tab shows it", () => {
    const { result, rerender } = setup()
    act(() => result.current[1](FOCUS))
    rerender({ tab: "executions", workflowId: "wf-1" })
    expect(result.current[0]).toEqual(FOCUS)
  })

  it("leaving the tab drops it, so coming back opens nothing", () => {
    const { result, rerender } = setup()
    act(() => result.current[1](FOCUS))
    rerender({ tab: "executions", workflowId: "wf-1" })
    rerender({ tab: "editor", workflowId: "wf-1" })
    rerender({ tab: "executions", workflowId: "wf-1" })
    expect(result.current[0]).toBeNull()
  })

  it("another workflow drops it", () => {
    const { result, rerender } = setup()
    act(() => result.current[1](FOCUS))
    rerender({ tab: "executions", workflowId: "wf-1" })
    rerender({ tab: "executions", workflowId: "wf-2" })
    expect(result.current[0]).toBeNull()
  })
})
