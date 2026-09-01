import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import React from "react"

const { mockBalance, mockStart, mockComplete, mockInvalidate, mockToast } = vi.hoisted(() => ({
  mockBalance: vi.fn<() => { data: Record<string, unknown> | undefined }>(() => ({ data: undefined })),
  mockStart: vi.fn(),
  mockComplete: vi.fn(),
  mockInvalidate: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({
  useUserCredits: () => mockBalance(),
}))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}))
vi.mock("@/lib/api", () => ({
  startFreeGrantActivation: () => mockStart(),
  completeFreeGrantActivation: (id: string) => mockComplete(id),
}))
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}))
vi.mock("sonner", () => ({ toast: mockToast }))

vi.mock("lucide-react", () => ({
  CreditCard: () => React.createElement("span"),
  Loader2: () => React.createElement("span", { "data-testid": "loader" }),
  Sparkles: () => React.createElement("span"),
}))

import { FreeGrantWithheldBanner } from "../FreeGrantWithheldBanner"

function renderAt(path: string) {
  return render(
    React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(FreeGrantWithheldBanner)),
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBalance.mockReturnValue({ data: undefined })
})

describe("FreeGrantWithheldBanner", () => {
  it("renders nothing while the balance is unknown", () => {
    renderAt("/billing")
    expect(screen.queryByTestId("free-grant-withheld-banner")).toBeNull()
  })

  it("renders nothing for a granted account, and for a build that predates the gate", () => {
    mockBalance.mockReturnValue({ data: { total: 1500, freeGrantState: "granted" } })
    renderAt("/billing")
    expect(screen.queryByTestId("free-grant-withheld-banner")).toBeNull()

    mockBalance.mockReturnValue({ data: { total: 1500 } })
    renderAt("/billing")
    expect(screen.queryByTestId("free-grant-withheld-banner")).toBeNull()
  })

  it("shows the activation path for a withheld account — 'activate', never 'denied'", () => {
    mockBalance.mockReturnValue({ data: { total: 0, freeGrantState: "withheld" } })
    renderAt("/projects")
    const banner = screen.getByTestId("free-grant-withheld-banner")
    expect(banner.textContent).toMatch(/Activate your/)
    expect(banner.textContent).toMatch(/nothing is charged/i)
    expect(banner.textContent).not.toMatch(/denied|blocked|abuse|fraud/i)
  })

  it("START: sends the browser to the hosted Stripe page", async () => {
    mockBalance.mockReturnValue({ data: { total: 0, freeGrantState: "withheld" } })
    mockStart.mockResolvedValue({ data: { url: "https://checkout.stripe.test/s" } })
    const assign = vi.fn()
    Object.defineProperty(window, "location", { value: { assign }, writable: true })

    renderAt("/projects")
    fireEvent.click(screen.getByRole("button"))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/s"))
  })

  it("COMPLETE: posts the returned session id exactly once and refreshes the balance", async () => {
    mockBalance.mockReturnValue({ data: { total: 0, freeGrantState: "withheld" } })
    mockComplete.mockResolvedValue({ state: "granted", activated: true })

    const { rerender } = renderAt("/billing?activate_grant=cs_test_1")
    await waitFor(() => expect(mockComplete).toHaveBeenCalledWith("cs_test_1"))
    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled())
    expect(mockToast.success).toHaveBeenCalled()

    // A re-render with the same id must not replay the completion.
    rerender(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/billing?activate_grant=cs_test_1"] },
        React.createElement(FreeGrantWithheldBanner),
      ),
    )
    expect(mockComplete).toHaveBeenCalledTimes(1)
  })

  it("COMPLETE: surfaces a refusal (card already used) as an error toast", async () => {
    mockBalance.mockReturnValue({ data: { total: 0, freeGrantState: "withheld" } })
    mockComplete.mockRejectedValue(new Error("This card has already activated free credits on another account"))
    renderAt("/billing?activate_grant=cs_test_2")
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(expect.stringMatching(/already activated/)))
    expect(mockInvalidate).not.toHaveBeenCalled()
  })
})
