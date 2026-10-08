// The notice runs the REAL price hook. It must hand it stable arrays: a fresh
// copy per render re-fires the hook's prefetch effect on every render, and with
// a failing price fetch (nothing cached, so the effect never exits early) that
// is an unbounded fetch -> setState -> refetch loop.
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, cleanup, waitFor } from "@testing-library/react"

const prefetch = vi.fn(async (_models: readonly string[]) => undefined)
vi.mock("@/hooks/use-model-credit-cost", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCachedModelCredits: () => undefined,
  prefetchModelCreditCosts: (models: readonly string[]) => prefetch(models),
}))
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: Object.assign((s: (x: unknown) => unknown) => s({ runUpToHere: vi.fn() }), { getState: () => ({}) }),
}))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasCredits: () => true,
}))

import { RunUpToHereNotice } from "../run-up-to-here-notice"

const node = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } })
const nodes = [node("img", "generate-image", { provider: "flux-2-pro", prompt: "a cat" }), node("sv", "speaker-view")] as never
const edges = [{ id: "img->sv", source: "img", target: "sv", targetHandle: "edl" }] as never

afterEach(() => {
  cleanup()
  prefetch.mockClear()
})

describe("RunUpToHereNotice price prefetch", () => {
  it("fetches a bounded number of times when the price fetch keeps failing", async () => {
    render(<RunUpToHereNotice nodeId="sv" nodes={nodes} edges={edges} />)
    await waitFor(() => expect(prefetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 100))
    expect(prefetch.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
