import { describe, expect, it, vi, beforeEach } from "vitest"

const mockToastSuccess = vi.fn()
const mockToastInfo = vi.fn()
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
    error: vi.fn(),
  },
}))
vi.mock("@/lib/i18n", () => ({
  tx: (key: string, vars?: Record<string, string | number>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
}))

import { toastBackendRunCompleted } from "../run-ended-toast"

/**
 * The end-of-run toast for a backend run that completed: "nothing new" with
 * the skipped count when the run skipped a node for want of input, the plain
 * success otherwise — one rule (`executionOutcome`) for the three places a
 * run's end reaches the editor.
 */
describe("toastBackendRunCompleted", () => {
  beforeEach(() => {
    mockToastSuccess.mockClear()
    mockToastInfo.mockClear()
  })

  it("a run that skipped nodes for want of input says so, with the count", () => {
    toastBackendRunCompleted({
      feed: { status: "completed" },
      llm: { status: "skipped", skipReason: "empty_input" },
      tts: { status: "skipped", skipReason: "empty_input" },
    })
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastInfo).toHaveBeenCalledWith("run.backendNothingNew", { description: 'run.backendNothingNewDesc:{"n":2}' })
  })

  it("one skipped node takes the singular", () => {
    toastBackendRunCompleted({ llm: { status: "skipped", skipReason: "empty_input" } })
    expect(mockToastInfo).toHaveBeenCalledWith("run.backendNothingNew", { description: "run.backendNothingNewDescOne" })
  })

  it("a run whose only skips are router gates is a plain success, as is an empty or missing state map", () => {
    toastBackendRunCompleted({ a: { status: "completed" }, b: { status: "skipped" } })
    toastBackendRunCompleted(undefined)
    expect(mockToastInfo).not.toHaveBeenCalled()
    expect(mockToastSuccess).toHaveBeenCalledTimes(2)
    expect(mockToastSuccess).toHaveBeenCalledWith("run.backendCompleted")
  })
})
