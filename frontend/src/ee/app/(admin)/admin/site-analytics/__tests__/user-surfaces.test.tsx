/**
 * "Surfaces used": one row per account and surface, with the person (a link
 * to the users page), the surface's label and detail, when first and last
 * seen and the touches; the section says when recording began; a kind of
 * caller is asked of the server, and the table follows what the server
 * answered; the text box narrows what came, by kind too; a long list shows
 * its first rows; a list cut at the limit says so; a server that could not
 * answer shows its reason; nobody on a surface is told apart from nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import type { SurfaceSource, UserSurfaceRow } from "../types"
import { REALTIME_OK, answer, onlineData, report, surfacesData } from "./fixtures"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))
vi.mock("@/lib/edition", () => ({ hasAdmin: () => true }))

import AdminSiteAnalyticsPage from "../page"

const DANA_EXT: UserSurfaceRow = {
  userId: "00000000-0000-4000-8000-0000000000d1",
  email: "dana@x.test",
  name: "Dana Levi",
  source: "extension",
  detail: "extension/ext.nodaro.ai@0.2.6",
  label: "EXT",
  firstSeenAt: "2026-11-09T10:00:00.000Z",
  lastSeenAt: "2026-11-10T08:30:00.000Z",
  touches: 4,
}
const DANA_WEB: UserSurfaceRow = { ...DANA_EXT, source: "web", detail: "app.nodaro.ai", label: "APP", touches: 12 }
const OMER_API: UserSurfaceRow = {
  userId: "00000000-0000-4000-8000-0000000000d2",
  email: null,
  name: null,
  source: "api",
  detail: null,
  label: "API",
  firstSeenAt: "2026-11-08T18:32:00.000Z",
  lastSeenAt: "2026-11-09T11:33:00.000Z",
  touches: 1,
}

/** The day recording began, as the page prints it wherever the test runs (the UI locale is the browser's for English). */
const SINCE_TEXT = new Date("2026-11-08T12:00:00.000Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

/** The kind a request asked for, as the server echoes it. */
const sourceOf = (url: string): SurfaceSource | null => (new URL(url, "http://x").searchParams.get("source") as SurfaceSource | null) ?? null

function serve(surfaces: (url: string) => Promise<Response>) {
  fetchMock.mockImplementation((url: string) =>
    url.includes("/user-surfaces") ? surfaces(url) : url.endsWith("/online-users") ? answer(onlineData()) : url.endsWith("/realtime") ? answer(REALTIME_OK) : answer(report()),
  )
}

const surfaceCalls = () => fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes("/user-surfaces"))

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AdminSiteAnalyticsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const section = async () => within((await screen.findByRole("heading", { name: /Surfaces used/ })).closest("section") as HTMLElement)

describe("Surfaces used", () => {
  it("one row per account and surface, with the person, the surface, when seen and the touches, since recording began", async () => {
    serve(() => answer(surfacesData([DANA_EXT, DANA_WEB, OMER_API])))
    renderPage()
    const list = await section()
    expect(await list.findByRole("heading", { name: "Surfaces used · 2 people" })).toBeInTheDocument()
    expect(list.getByText(`Every surface each account has used since ${SINCE_TEXT}, when recording began — the latest first`)).toBeInTheDocument()

    const dana = list.getAllByRole("link", { name: "Dana Levi" })
    expect(dana).toHaveLength(2)
    expect(dana[0]).toHaveAttribute("href", `/admin/users?user=${DANA_EXT.userId}`)
    const ext = dana[0]!.closest("tr") as HTMLElement
    expect(within(ext).getByText("dana@x.test")).toBeInTheDocument()
    expect(within(ext).getByText("EXT")).toBeInTheDocument()
    expect(within(ext).getByText("extension/ext.nodaro.ai@0.2.6")).toBeInTheDocument()
    expect(within(ext).getByText("4")).toHaveAttribute("title", "About one touch per hour the surface was in use")
    expect(within(dana[1]!.closest("tr") as HTMLElement).getByText("APP")).toBeInTheDocument()

    const omer = list.getByRole("link", { name: OMER_API.userId }).closest("tr") as HTMLElement
    expect(within(omer).getByText("API")).toBeInTheDocument()
    expect(within(omer).getByText("—")).toBeInTheDocument()
    expect(within(omer).getByText("1")).toBeInTheDocument()
  })

  it("a kind of caller is asked of the server, and the table follows the answer; the text box narrows what came, by kind too", async () => {
    serve((url) => answer(surfacesData(sourceOf(url) === "extension" ? [DANA_EXT] : [DANA_EXT, DANA_WEB, OMER_API], { source: sourceOf(url) })))
    renderPage()
    const list = await section()
    await list.findByRole("heading", { name: "Surfaces used · 2 people" })
    expect(surfaceCalls()).toEqual(["/v1/admin/user-surfaces"])

    fireEvent.click(list.getByRole("button", { name: "Extension" }))
    expect(await list.findByRole("heading", { name: "Surfaces used · 1 person" })).toBeInTheDocument()
    expect(surfaceCalls()).toEqual(["/v1/admin/user-surfaces", "/v1/admin/user-surfaces?source=extension"])
    expect(list.getByText("EXT")).toBeInTheDocument()
    expect(list.queryByText("APP")).toBeNull()

    fireEvent.click(list.getByRole("button", { name: "All" }))
    expect(await list.findByText("APP")).toBeInTheDocument()
    // The chip row keeps its "API" button; the row for Omer is what the filter drops.
    const box = list.getByPlaceholderText(/Filter by name/)
    fireEvent.change(box, { target: { value: "dana" } })
    expect(list.getAllByRole("link", { name: "Dana Levi" })).toHaveLength(2)
    expect(list.queryByRole("link", { name: OMER_API.userId })).toBeNull()
    // The kind's own name matches, though the badge says EXT.
    fireEvent.change(box, { target: { value: "extension" } })
    expect(list.getAllByRole("link", { name: "Dana Levi" })).toHaveLength(1)
    expect(list.queryByText("APP")).toBeNull()
    fireEvent.change(box, { target: { value: "nobody" } })
    expect(list.getByText("Nothing matches the filter.")).toBeInTheDocument()
  })

  it("a long list shows its first 25 rows, then all of them", async () => {
    const rows = Array.from({ length: 30 }, (_, i): UserSurfaceRow => ({ ...OMER_API, userId: `person-${i}` }))
    serve(() => answer(surfacesData(rows)))
    renderPage()
    const list = await section()
    expect(await list.findByText("Showing 25 of 30")).toBeInTheDocument()
    expect(list.getAllByRole("link", { name: /person-/ })).toHaveLength(25)
    fireEvent.click(list.getByRole("button", { name: "Show all" }))
    expect(list.getAllByRole("link", { name: /person-/ })).toHaveLength(30)
  })

  it("a list cut at the limit says so; a server that could not answer shows its reason; nobody is told apart from nothing", async () => {
    serve(() => answer(surfacesData([DANA_EXT, DANA_WEB], { total: 1_230, truncated: true })))
    const first = renderPage()
    expect(await (await section()).findByText(/the newest 2 rows of 1,230, people counted among them/)).toBeInTheDocument()
    first.unmount()

    serve(() => answer({ error: { code: "user_surfaces_unavailable", message: 'The surfaces list could not be read: relation "user_surfaces" does not exist' } }, 503))
    const second = renderPage()
    expect(await (await section()).findByText(/relation "user_surfaces" does not exist/)).toBeInTheDocument()
    second.unmount()

    serve((url) => answer(surfacesData([], { source: sourceOf(url), recordedSince: null })))
    renderPage()
    const list = await section()
    expect(await list.findByText("Nothing recorded yet.")).toBeInTheDocument()
    expect(list.getByText(/used since recording began — the latest first/)).toBeInTheDocument()
    fireEvent.click(list.getByRole("button", { name: "CLI" }))
    expect(await list.findByText("Nobody has used this surface since recording began.")).toBeInTheDocument()
  })
})
