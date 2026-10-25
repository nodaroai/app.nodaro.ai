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

  it("keeps archived trends out of All and shows them under Archived", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends"] = () => ({
      body: { data: [listItem(), listItem({ id: DRAFT_ID, slug: "old-dance", name: "Old dance", status: "archived" })] },
    })
    renderWith(<AdminTrendsPage />)
    await screen.findByText("Office dance")
    expect(screen.queryByText("Old dance")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: /^archived$/i }))
    expect(screen.getByText("Old dance")).toBeInTheDocument()
    expect(screen.queryByText("Office dance")).not.toBeInTheDocument()
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

  it("refuses the reserved slugs when creating", async () => {
    const user = userEvent.setup()
    renderWith(<AdminTrendsPage />)
    await screen.findByText("Office dance")
    await user.click(screen.getByRole("button", { name: /new trend/i }))
    await user.type(screen.getByLabelText(/name \(english\)/i), "Tags")
    for (const slug of ["tags", "runs"]) {
      await user.clear(screen.getByLabelText(/^slug$/i))
      await user.type(screen.getByLabelText(/^slug$/i), slug)
      expect(screen.getByRole("button", { name: /^create$/i })).toBeDisabled()
    }
  })

  it("edits a tag's labels per language, and clears them", async () => {
    const user = userEvent.setup()
    routes["GET /v1/admin/trends/tags"] = () => ({
      body: {
        data: [
          { tag: "dance", labels: { en: "Dance" }, trends: 2, published: 1 },
          { tag: "pets", labels: {}, trends: 1, published: 0 },
        ],
      },
    })
    routes["PUT /v1/admin/trends/tags"] = () => ({ body: { data: { tag: "dance", labels: {} } } })
    renderWith(<AdminTrendsPage />)
    await screen.findByText("Office dance")
    await user.click(screen.getByRole("button", { name: /tag labels/i }))

    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText(/2 trends · 1 published/i)
    const row = (tag: string) => dialog.querySelector(`[data-tag-row="${tag}"]`) as HTMLElement
    const dance = row("dance")
    expect(within(dance).getByText(/2 trends · 1 published/i)).toBeInTheDocument()
    await user.click(within(dance).getByRole("button", { name: "HE" }))
    await user.type(within(dance).getByLabelText(/\(hebrew\)/i), "ריקוד")
    await user.click(within(dance).getByRole("button", { name: /^save$/i }))
    await waitFor(() =>
      expect(sentTo("PUT /v1/admin/trends/tags")).toEqual([{ tag: "dance", labels: { en: "Dance", he: "ריקוד" } }]),
    )

    const pets = row("pets")
    // A tag with no label shows as itself to users; nothing to save until one is typed.
    expect(within(pets).getByRole("button", { name: /^save$/i })).toBeDisabled()
    await user.click(within(dance).getByRole("button", { name: /^clear$/i }))
    await waitFor(() => expect(sentTo("PUT /v1/admin/trends/tags")).toHaveLength(2))
    expect(sentTo("PUT /v1/admin/trends/tags")[1]).toEqual({ tag: "dance", labels: {} })
  })
})
