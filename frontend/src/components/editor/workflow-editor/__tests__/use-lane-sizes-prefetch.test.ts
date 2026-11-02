import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"

const mockRefresh = vi.fn()
vi.mock("../list-fan-out-width", () => ({ refreshLaneSizes: (...a: unknown[]) => mockRefresh(...a) }))

import { useLaneSizesPrefetch } from "../use-lane-sizes-prefetch"

describe("useLaneSizesPrefetch", () => {
  beforeEach(() => mockRefresh.mockReset())

  it("reads the line sizes when a workflow opens, and again for another workflow", () => {
    const { rerender } = renderHook(({ id }) => useLaneSizesPrefetch(id, true), { initialProps: { id: "wf-1" } })
    rerender({ id: "wf-2" })
    expect(mockRefresh.mock.calls).toEqual([["wf-1"], ["wf-2"]])
  })

  it("reads nothing until the workflow's id is known, then reads for it once", () => {
    const { rerender } = renderHook(({ id }) => useLaneSizesPrefetch(id, true), { initialProps: { id: null as string | null | undefined } })
    rerender({ id: undefined })
    rerender({ id: "" })
    expect(mockRefresh).not.toHaveBeenCalled()
    rerender({ id: "wf-1" })
    expect(mockRefresh.mock.calls).toEqual([["wf-1"]])
  })

  it("reads nothing in a read-only editor, where no run can start", () => {
    renderHook(() => useLaneSizesPrefetch("wf-1", false))
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
