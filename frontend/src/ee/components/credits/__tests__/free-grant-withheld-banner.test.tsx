import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import React from "react"

const { mockBalance, billing } = vi.hoisted(() => ({
  mockBalance: vi.fn<() => { data: Record<string, unknown> | undefined }>(() => ({ data: undefined })),
  billing: { surface: {} as { deploymentPayer?: boolean } },
}))
vi.mock("@/hooks/use-billing-surface", () => ({ useBillingSurface: () => ({ surface: billing.surface, isLoading: false }) }))
vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({
  useUserCredits: () => mockBalance(),
}))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}))
vi.mock("lucide-react", () => ({
  Sparkles: () => React.createElement("span"),
}))

import { FreeGrantWithheldBanner } from "../FreeGrantWithheldBanner"

function renderAt(path: string) {
  return render(
    React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(FreeGrantWithheldBanner)),
  )
}

const withheldFree = { total: 0, freeGrantState: "withheld", effectiveTier: "free" }

beforeEach(() => {
  vi.clearAllMocks()
  mockBalance.mockReturnValue({ data: undefined })
  billing.surface = {}
})

afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

describe("FreeGrantWithheldBanner", () => {
  it("renders nothing while the balance is unknown", () => {
    renderAt("/projects")
    expect(screen.queryByTestId("free-grant-withheld-banner")).toBeNull()
  })

  it("renders nothing for a granted account, and for a build that predates the gate", () => {
    mockBalance.mockReturnValue({ data: { total: 1500, freeGrantState: "granted", effectiveTier: "free" } })
    renderAt("/projects")
    expect(screen.queryByTestId("free-grant-withheld-banner")).toBeNull()

    mockBalance.mockReturnValue({ data: { total: 1500 } })
    renderAt("/projects")
    expect(screen.queryByTestId("free-grant-withheld-banner")).toBeNull()
  })

  it("renders nothing for a withheld account that already pays — the grant is not a paid account's business", () => {
    for (const effectiveTier of ["payg", "basic", "pro"]) {
      mockBalance.mockReturnValue({ data: { total: 8500, freeGrantState: "withheld", effectiveTier } })
      const { unmount } = renderAt("/projects")
      expect(screen.queryByTestId("free-grant-withheld-banner")).toBeNull()
      unmount()
    }
  })

  it("tells a withheld free account that the credits come with the first purchase — never 'denied', never a card step", () => {
    mockBalance.mockReturnValue({ data: withheldFree })
    renderAt("/projects")
    const banner = screen.getByTestId("free-grant-withheld-banner")
    expect(banner.textContent).toMatch(/first purchase/i)
    expect(banner.textContent).toMatch(/1,?500/)
    expect(banner.textContent).not.toMatch(/denied|blocked|abuse|fraud|nothing is charged|payment method/i)
  })

  it("tells an account withheld only for an unmeasured browser what to do — a regular browser and a reload, no purchase", () => {
    mockBalance.mockReturnValue({ data: { ...withheldFree, freeGrantNotice: "browser_unmeasured" } })
    renderAt("/projects")
    expect(screen.queryByTestId("free-grant-withheld-banner")).toBeNull()
    const banner = screen.getByTestId("free-grant-browser-banner")
    expect(banner.textContent).toMatch(/browser/i)
    expect(banner.textContent).toMatch(/reload/i)
    expect(banner.textContent).toMatch(/1,?500/)
    expect(banner.textContent).not.toMatch(/purchase|denied|blocked|abuse|fraud/i)
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("keeps the purchase banner for a withhold that carries no notice", () => {
    mockBalance.mockReturnValue({ data: withheldFree })
    renderAt("/projects")
    expect(screen.queryByTestId("free-grant-browser-banner")).toBeNull()
    expect(screen.getByTestId("free-grant-withheld-banner")).toBeTruthy()
  })

  it("renders nothing, in either variant, on a deployment that gives no free credits of one's own", () => {
    const variants = [withheldFree, { ...withheldFree, freeGrantNotice: "browser_unmeasured" }]
    for (const data of variants) {
      mockBalance.mockReturnValue({ data })

      window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: false } } }
      const sellsNothing = renderAt("/projects")
      expect(sellsNothing.container.innerHTML).toBe("")
      sellsNothing.unmount()
      delete window.__NODARO_RUNTIME__

      billing.surface = { deploymentPayer: true }
      const payer = renderAt("/projects")
      expect(payer.container.innerHTML).toBe("")
      payer.unmount()
      billing.surface = {}
    }
  })

  it("sends the user to the pricing page, where packs are bought — no Stripe step of its own", () => {
    mockBalance.mockReturnValue({ data: withheldFree })
    renderAt("/projects")
    const link = screen.getByRole("link")
    expect(link.getAttribute("href")).toBe("/pricing")
    expect(screen.queryByRole("button")).toBeNull()
  })
})
