/**
 * Admin → Trends, the list: every trend (any status) with its status, versions
 * and badges; the status filter; the sort order and badges written through
 * PATCH; and "New trend" creating a draft and opening its editor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { fetchMock, listItem, renderWith, resetRoutes, routes, sentTo, TREND_ID } from "./harness"
import AdminTrendsPage from "../page"

const DRAFT_ID = "00000000-0000-4000-8000-0000000000a2"

beforeEach(() => {
  resetRoutes()
  vi.stubGlobal("fetch", fetchMock)
  routes["GET /v1/admin/trends"] = () => ({
    body: {
      data: [
        listItem(),
        listItem({ id: DRAFT_ID, slug: "pet-parade", name: "Pet parade", status: "draft", publishedVersion: null, draftVersion: 1, badges: [], tags: ["pets"], sortOrder: 9 }),
      ],
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe("the Trends list", () => {
  it("lists every trend with its status, versions and badges", async () => {
    renderWith(<AdminTrendsPage />)
    const row = (await screen.findByText("Office dance")).closest("[data-trend-row]") as HTMLElement
    expect(within(row).getByText("published")).toBeInTheDocument()
    expect(within(row).getByText(/draft v3/i)).toBeInTheDocument()
    expect(within(row).getByText(/published v2/i)).toBeInTheDocument()
    expect(within(row).getByRole("switch", { name: /trending/i })).toBeChecked()
    expect(screen.getByText("Pet parade")).toBeInTheDocument()
  })

  it("filters by status", async () => {
    const user = userEvent.setup()
    renderWith(<AdminTrendsPage />)
    await screen.findByText("Office dance")
    await user.click(screen.getByRole("button", { name: /^drafts?$/i }))
    expect(screen.queryByText("Office dance")).not.toBeInTheDocument()
    expect(screen.getByText("Pet parade")).toBeInTheDocument()
  })

  it("writes a new sort order through PATCH", async () => {
    const user = userEvent.setup()
    routes[`PATCH /v1/admin/trends/${TREND_ID}`] = () => ({ body: { data: {} } })
    renderWith(<AdminTrendsPage />)
    const row = (await screen.findByText("Office dance")).closest("[data-trend-row]") as HTMLElement
    const order = within(row).getByLabelText(/sort order/i)
    await user.clear(order)
    await user.type(order, "2")
    await user.tab()
    await waitFor(() => expect(sentTo(`PATCH /v1/admin/trends/${TREND_ID}`)).toEqual([{ sortOrder: 2 }]))
  })

  it("creates a trend and opens its editor", async () => {
    const user = userEvent.setup()
    routes["POST /v1/admin/trends"] = () => ({ status: 201, body: { data: { id: "00000000-0000-4000-8000-0000000000a9" } } })
    renderWith(<AdminTrendsPage />)
    await screen.findByText("Office dance")
    await user.click(screen.getByRole("button", { name: /new trend/i }))
    await user.type(screen.getByLabelText(/^slug$/i), "beach-walk")
    await user.type(screen.getByLabelText(/name \(english\)/i), "Beach walk")
    await user.click(screen.getByRole("button", { name: /^create$/i }))
    await waitFor(() => expect(sentTo("POST /v1/admin/trends")).toEqual([{ slug: "beach-walk", name: { en: "Beach walk" } }]))
    expect(await screen.findByTestId("elsewhere")).toBeInTheDocument()
  })
})
