import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

/**
 * The Draft badge reads a result's job only where the result can be a draft:
 * a Wan / Runway video-to-video result never is, so it must not cost a
 * GET /v1/jobs/:id per result; a result already stamped `draft` needs none.
 */

const api = vi.hoisted(() => ({ getJobStatus: vi.fn() }))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getJobStatus: api.getJobStatus,
}))

import { SeedanceDraftResultBadge } from "../seedance-draft-result-badge"

const RESULT = { url: "https://r2/v.mp4", jobId: "11111111-2222-4333-8444-555555555555", timestamp: "t" }

function renderBadge(props: Parameters<typeof SeedanceDraftResultBadge>[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SeedanceDraftResultBadge {...props} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.getJobStatus.mockReset()
  api.getJobStatus.mockResolvedValue({ input_data: { draft: true }, output_data: {} })
})

describe("SeedanceDraftResultBadge job lookup", () => {
  it("a result that cannot be a draft (lookup off) is never looked up", async () => {
    const { container } = renderBadge({ result: RESULT, lookup: false })
    await new Promise((r) => setTimeout(r, 20))
    expect(api.getJobStatus).not.toHaveBeenCalled()
    expect(container.textContent).toBe("")
  })

  it("a result stamped as a draft shows the badge without a lookup", async () => {
    renderBadge({ result: { ...RESULT, draft: true } })
    expect(screen.getByText(/draft/i)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 20))
    expect(api.getJobStatus).not.toHaveBeenCalled()
  })

  it("a draft-capable result is read from its job (workflow-run drafts)", async () => {
    renderBadge({ result: RESULT })
    await waitFor(() => expect(screen.getByText(/draft/i)).toBeTruthy())
    expect(api.getJobStatus).toHaveBeenCalledTimes(1)
  })
})
