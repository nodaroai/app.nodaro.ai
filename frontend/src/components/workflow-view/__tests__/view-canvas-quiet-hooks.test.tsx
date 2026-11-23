import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook, cleanup } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

// A view-only canvas may be open to someone signed out: the node cards on it
// must not ask the server for the owner's jobs or for prices.
const api = vi.hoisted(() => ({ getJobStatus: vi.fn(), getModelCreditCost: vi.fn() }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}))
vi.mock("@/lib/edition", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/edition")>()), hasCredits: () => true }))

import { CanvasModeContext, type CanvasMode } from "@/components/nodes/read-only-canvas-context"
import { useResultGenerationSettings } from "@/hooks/use-result-generation-settings"
import { useModelCreditCost } from "@/hooks/use-model-credit-cost"

const JOB = "11111111-1111-4111-8111-111111111111"

function wrapper(mode: CanvasMode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <CanvasModeContext.Provider value={mode}>{children}</CanvasModeContext.Provider>
    </QueryClientProvider>
  )
}

describe("node hooks on a view-only canvas", () => {
  afterEach(() => {
    cleanup()
    api.getJobStatus.mockReset()
    api.getModelCreditCost.mockReset()
  })

  it("do not read a result's job", () => {
    const { result } = renderHook(() => useResultGenerationSettings(JOB), { wrapper: wrapper("view") })
    expect(result.current.fetchStatus).toBe("idle")
    expect(api.getJobStatus).not.toHaveBeenCalled()
  })

  it("do not ask a price", () => {
    const { result } = renderHook(() => useModelCreditCost("veo3"), { wrapper: wrapper("view") })
    expect(result.current.fetchStatus).toBe("idle")
  })

  it("control: in the editor the same hooks do ask", () => {
    api.getJobStatus.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useResultGenerationSettings(JOB), { wrapper: wrapper("editor") })
    expect(result.current.fetchStatus).toBe("fetching")
  })
})
