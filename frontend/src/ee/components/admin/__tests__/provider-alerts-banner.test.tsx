/**
 * The provider alerts banner across the admin pages: it shows what the
 * server says needs acting on, and nothing on a server without the route.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { ReactNode } from "react"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })) }))

import { ProviderAlertsBanner } from "../provider-alerts-banner"
import { getProviderAlerts } from "@/ee/lib/provider-alerts-api"

function withQuery(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

function respond(status: number, body: unknown) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(body), { status }))
}

const LOW = {
  id: "scrapecreators-low",
  severity: "warning",
  title: "ScrapeCreators credits are low: 1,234 left (alert below 2,000).",
  action: "Top up the ScrapeCreators account.",
  checkedAt: "2026-10-03T20:00:00.000Z",
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => vi.restoreAllMocks())

describe("ProviderAlertsBanner", () => {
  it("shows each alert's problem and what to do", async () => {
    respond(200, { alerts: [LOW, { ...LOW, id: "x-refused", severity: "error", title: "The key was refused." }] })
    withQuery(<ProviderAlertsBanner enabled />)
    expect(await screen.findByText(LOW.title)).toBeInTheDocument()
    expect(screen.getAllByText(LOW.action)).toHaveLength(2)
    expect(screen.getByText("The key was refused.")).toBeInTheDocument()
  })

  it("shows nothing when there is nothing to do, or the server has no such route", async () => {
    respond(200, { alerts: [] })
    const { container } = withQuery(<ProviderAlertsBanner enabled />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    expect(await getProviderAlerts().catch(() => "threw")).toEqual([])
  })

  it("asks nothing while disabled (not an admin, or not Cloud)", () => {
    respond(200, { alerts: [LOW] })
    withQuery(<ProviderAlertsBanner enabled={false} />)
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it("reads a missing route or a refusal as no alerts, and drops malformed ones", async () => {
    respond(404, {})
    expect(await getProviderAlerts()).toEqual([])
    respond(403, {})
    expect(await getProviderAlerts()).toEqual([])
    respond(200, { alerts: [LOW, { id: 1 }, { ...LOW, severity: "loud" }] })
    expect(await getProviderAlerts()).toEqual([LOW])
  })
})
