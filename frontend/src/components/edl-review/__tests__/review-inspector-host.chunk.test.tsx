// A stale tab's inspector chunk 404s after a deploy (A3-5): the failed load must
// not take the canvas down with it. Its own file: the module mock throws.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError } }))
// The module loads, then its export cannot be used: the same rejection shape as
// a chunk that fails to fetch, without a mock factory that throws.
vi.mock("../review-inspector", () => ({
  get ReviewInspector(): never {
    throw new Error("boom")
  },
}))

import { openReview, useReviewOpenStore } from "@/hooks/use-review-open-store"
import { ReviewInspectorHost } from "../review-inspector-host"
import { loadCanvas } from "./review-canvas"

beforeEach(() => {
  loadCanvas()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  toastError.mockClear()
  useReviewOpenStore.setState({ renderId: null, hostMounted: false })
})

describe("a review whose code fails to load", () => {
  it("leaves its siblings mounted, says so, and closes the review", async () => {
    render(
      <MemoryRouter initialEntries={["/editor"]}>
        <div data-testid="canvas-sibling" />
        <ReviewInspectorHost />
      </MemoryRouter>,
    )
    act(() => openReview("cut"))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.getByTestId("canvas-sibling")).toBeTruthy()
    await waitFor(() => expect(useReviewOpenStore.getState().renderId).toBeNull())
    // The host is still there: the next open is possible.
    expect(useReviewOpenStore.getState().hostMounted).toBe(true)
  })
})
