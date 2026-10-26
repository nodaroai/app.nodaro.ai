/**
 * The Hosted Deployments page: each dedicated deployment's pool and auto
 * top-up status, read-only, with a failing deployment shown as its own row
 * and a refused configuration entry explained rather than silently dropped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => ({
  getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })),
}))
vi.mock("@/lib/api", () => ({ getAuthHeaders: h.getAuthHeaders }))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))

import HostedDeploymentsPage from "../page"

function renderWith(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <HostedDeploymentsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe("Hosted Deployments", () => {
  it("shows a deployment's pool, spend and auto top-up rule", async () => {
    renderWith({
      checkedAt: "2026-10-26T15:00:00.000Z",
      invalid: [],
      data: [
        {
          name: "Acme",
          host: "acme.example.com",
          ok: true,
          balance: {
            balanceCredits: 41250,
            burn: { periodStart: "2026-10-01T00:00:00.000Z", credits: 900, generations: 2, capped: false },
            lowBalance: true,
            threshold: 50000,
            autoRecharge: { enabled: true, active: true, thresholdCredits: 5000, amountUsd: 50, failureCount: 0, lastAttemptAt: null },
          },
        },
      ],
    })
    const card = await screen.findByTestId("hosted-Acme")
    expect(within(card).getByText((41250).toLocaleString())).toBeInTheDocument()
    expect(within(card).getByText("Low balance")).toBeInTheDocument()
    expect(within(card).getByText("Active")).toBeInTheDocument()
    expect(within(card).getByText(`< ${(5000).toLocaleString()} → $50`)).toBeInTheDocument()
  })

  it("a failing deployment is its own row; a refused entry is explained", async () => {
    renderWith({
      checkedAt: "2026-10-26T15:00:00.000Z",
      invalid: [{ index: 1, name: "Full", reason: "key_not_read_only" }],
      data: [{ name: "Down", host: "down.example.com", ok: false, error: "unreachable" }],
    })
    const card = await screen.findByTestId("hosted-Down")
    expect(within(card).getByText(/Unreachable/)).toBeInTheDocument()
    expect(screen.getByTestId("hosted-invalid")).toHaveTextContent("not read-only")
  })

  it("says how to configure it when nothing is set", async () => {
    renderWith({ checkedAt: "2026-10-26T15:00:00.000Z", invalid: [], data: [] })
    expect(await screen.findByText(/No hosted deployments configured/)).toBeInTheDocument()
  })
})
