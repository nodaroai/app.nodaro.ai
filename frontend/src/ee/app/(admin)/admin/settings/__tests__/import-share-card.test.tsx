/**
 * The imports-with-a-declaration card: the count of imports started without a
 * declaration first, then the share that carried one (rounded down), then the
 * ones without by way in, where and app; the day counting began when the
 * window reaches back past it; another window reads that window; an empty
 * window and a failed read each say so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import userEvent from "@testing-library/user-event"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))

import { ImportShareCard, countingDay, sharePercent, summarizeImportShare, wayInLabel, whereLabel, type ImportShareRow } from "../import-share-card"

const fetchMock = vi.fn()
const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }))

const ROWS: ImportShareRow[] = [
  { declaration: "checkbox", lane: null, via: null, appId: null, imports: 5 },
  { declaration: "derived", lane: null, via: null, appId: null, imports: 3 },
  { declaration: "none", lane: "run", via: "api", appId: null, imports: 1 },
  { declaration: "none", lane: "run", via: "api", appId: null, imports: 2 },
  { declaration: "none", lane: "route", via: "app", appId: "app-7", imports: 4 },
  { declaration: "none", lane: "run", via: null, appId: null, imports: 1 },
  { declaration: "none", lane: "route", via: "app", appId: "app-9", imports: 1 },
]

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImportShareCard />
    </QueryClientProvider>,
  )
}

describe("summarizeImportShare", () => {
  it("totals the window and groups the imports without a declaration, the most first", () => {
    expect(summarizeImportShare(ROWS)).toEqual({
      total: 17,
      withDeclaration: 8,
      without: 9,
      groups: [
        { via: "app", lane: "route", appId: "app-7", imports: 4 },
        { via: "api", lane: "run", appId: null, imports: 3 },
        { via: null, lane: "run", appId: null, imports: 1 },
        { via: "app", lane: "route", appId: "app-9", imports: 1 },
      ],
    })
    expect(summarizeImportShare([])).toEqual({ total: 0, withDeclaration: 0, without: 0, groups: [] })
  })

  it("names each way in and place, and shows an unknown one as it is", () => {
    expect(wayInLabel("api")).toBe("An API key")
    expect(wayInLabel(null)).toBe("None (a step of the server)")
    expect(wayInLabel("pager")).toBe("pager")
    expect(whereLabel("run")).toBe("A workflow run")
    expect(whereLabel("plugin")).toBe("A plugin's download")
    expect(whereLabel("studio")).toBe("studio")
  })

  it("rounds the share down, so it never reads 100% while one import carried none", () => {
    expect(sharePercent(999, 1000)).toBe(99)
    expect(sharePercent(8, 8)).toBe(100)
    expect(countingDay("2026-11-02T23:30:00.000Z")).toBe("2 November 2026")
  })
})

describe("ImportShareCard", () => {
  it("shows the imports without a declaration first, the share that carried one, and the ones without by way in", async () => {
    fetchMock.mockImplementation(() => answer({ data: ROWS, days: 7, countingSince: null }))
    renderCard()
    expect(await screen.findByText("started without a declaration")).toHaveTextContent("9 started without a declaration")
    expect(screen.getByText("8 of 17 carried one (47%)")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith("/v1/admin/content-rights/import-share?days=7", expect.objectContaining({ headers: { Authorization: "Bearer t" } }))
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1)
    expect(rows.map((r) => r.textContent)).toEqual([
      "A connected appA direct requestapp-74",
      "An API keyA workflow run—3",
      "None (a step of the server)A workflow run—1",
      "A connected appA direct requestapp-91",
    ])
    expect(screen.queryByText(/Counting began/)).toBeNull()
  })

  it("a window reaching back past the day counting began says from which day the figures run", async () => {
    fetchMock.mockImplementation(() => answer({ data: ROWS, days: 30, countingSince: "2026-11-02T10:00:00.000Z" }))
    renderCard()
    expect(await screen.findByText("Counting began on 2 November 2026: imports before that day are not in these figures.")).toBeInTheDocument()
  })

  it("another window reads that window", async () => {
    fetchMock.mockImplementation((url: string) => answer({ data: url.endsWith("days=30") ? [] : ROWS, days: 7, countingSince: null }))
    renderCard()
    expect(await screen.findByText("8 of 17 carried one (47%)")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("combobox", { name: "Time window" }))
    await userEvent.click(screen.getByRole("option", { name: "Last 30 days" }))
    expect(await screen.findByText("No imports in the last 30 days.")).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith("/v1/admin/content-rights/import-share?days=30", expect.anything())
  })

  it("a window with no imports says so", async () => {
    fetchMock.mockImplementation(() => answer({ data: [], days: 7, countingSince: null }))
    renderCard()
    expect(await screen.findByText("No imports in the last 7 days.")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("every import carried a declaration: no table of the ones without", async () => {
    fetchMock.mockImplementation(() => answer({ data: ROWS.filter((r) => r.declaration !== "none"), days: 7, countingSince: null }))
    renderCard()
    expect(await screen.findByText("8 of 8 carried one (100%)")).toBeInTheDocument()
    expect(screen.queryByRole("table")).toBeNull()
  })

  it("loading is announced, and a failed read shows the server's message as an alert", async () => {
    fetchMock.mockImplementation(() => answer({ error: { code: "forbidden", message: "Admin access required" } }, 403))
    renderCard()
    expect(screen.getByRole("status")).toHaveTextContent("Loading")
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Admin access required"))
  })
})
