/**
 * The Site Analytics page: a setup that is not finished says what is missing;
 * a section Google refuses never hides the other, and says what fixes it;
 * a refresh files its answer under its own range; a page's index verdict is
 * asked once and survives tab switches; only the site's own pages are links.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { SearchReport, SiteAnalyticsReport, TrafficReport } from "../types"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))
vi.mock("@/lib/edition", () => ({ hasAdmin: () => true }))

import AdminSiteAnalyticsPage from "../page"

const EMAIL = "reader@nodaro-analytics.iam.gserviceaccount.com"
const SETUP = { serviceAccountEmail: EMAIL, ga4PropertyId: "537345785", searchConsoleSite: "sc-domain:nodaro.ai", problems: [] }

const NOT_SET_UP: SiteAnalyticsReport = {
  days: 28,
  setup: {
    serviceAccountEmail: null,
    ga4PropertyId: null,
    searchConsoleSite: null,
    problems: ["SITE_ANALYTICS_SERVICE_ACCOUNT_JSON is not set.", "SITE_ANALYTICS_GA4_PROPERTY_ID is not set.", "SITE_ANALYTICS_SEARCH_CONSOLE_SITE is not set."],
  },
  traffic: { status: "not_configured" },
  search: { status: "not_configured" },
}

const searchData = (clicks: number, pages = [{ key: "https://nodaro.ai/docs", clicks: 300, impressions: 5000, ctr: 0.06, position: 4.2 }]): SearchReport => ({
  window: { startDate: "2026-09-10", endDate: "2026-10-07" },
  totals: { clicks, impressions: 98765, ctr: 0.0437, position: 12.3 },
  daily: [
    { date: "2026-10-06", clicks: 100, impressions: 2000 },
    { date: "2026-10-07", clicks: 120, impressions: 2100 },
  ],
  pages,
  pagesCapped: false,
  queries: [{ key: "nodaro", clicks: 250, impressions: 400, ctr: 0.625, position: 1.1 }],
  queriesCapped: false,
  sitemaps: [],
})

const trafficData: TrafficReport = {
  totals: { views: 1200, activeUsers: 300, engagementSeconds: 54000, events: 5000 },
  daily: [],
  pages: [
    { key: "nodaro.ai/docs", host: "nodaro.ai", path: "/docs", views: 500, activeUsers: 90, engagementSeconds: 900, events: 700 },
    { key: "nodaro.ai.attacker.tld/win", host: "nodaro.ai.attacker.tld", path: "/win", views: 3, activeUsers: 1, engagementSeconds: 0, events: 3 },
  ],
  pagesTotal: 575,
  titles: [],
  titlesTotal: 0,
}

const report = (over: Partial<SiteAnalyticsReport> = {}): SiteAnalyticsReport => ({
  days: 28,
  setup: SETUP,
  traffic: { status: "ok", fetchedAt: "2026-10-08T12:00:00.000Z", data: trafficData },
  search: { status: "ok", fetchedAt: "2026-10-08T12:00:00.000Z", data: searchData(4321) },
  ...over,
})

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdminSiteAnalyticsPage />
    </QueryClientProvider>,
  )
}

describe("setup and refusals", () => {
  it("a setup that is not finished names every missing variable, and both sections wait for it", async () => {
    fetchMock.mockImplementation(() => answer(NOT_SET_UP))
    renderPage()
    expect(await screen.findByText("Finish the setup")).toBeInTheDocument()
    expect(screen.getByText("SITE_ANALYTICS_SERVICE_ACCOUNT_JSON is not set.")).toBeInTheDocument()
    expect(screen.getAllByText(/Not set up yet/)).toHaveLength(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/v1/admin/site-analytics?days=28")
  })

  it("Analytics refusing access shows Google's reason and whom to grant, and Search Console still shows its numbers", async () => {
    fetchMock.mockImplementation(() =>
      answer(report({ traffic: { status: "error", httpStatus: 403, reason: "PERMISSION_DENIED", message: "User does not have sufficient permissions for this property." } })),
    )
    renderPage()
    expect(await screen.findByText(/User does not have sufficient permissions for this property/)).toBeInTheDocument()
    expect(screen.getByText(/Admin → Property access management/)).toBeInTheDocument()
    expect(screen.getAllByText(EMAIL).length).toBeGreaterThan(0)
    expect(screen.getByText("4,321")).toBeInTheDocument()
  })

  it("an API that is turned off says to turn it on — not to grant access that would change nothing", async () => {
    fetchMock.mockImplementation(() =>
      answer(report({ traffic: { status: "error", httpStatus: 403, reason: "SERVICE_DISABLED", message: "Google Analytics Data API has not been used in project 123 before or it is disabled." } })),
    )
    renderPage()
    expect(await screen.findByText(/Turn the API on/)).toBeInTheDocument()
    expect(screen.queryByText(/Property access management/)).toBeNull()
  })
})

describe("links", () => {
  it("only the site's own pages are links; an address from Google that is not http(s) stays text", async () => {
    const hostile = searchData(1, [{ key: "javascript:alert(1)", clicks: 1, impressions: 2, ctr: 0.5, position: 3 }])
    fetchMock.mockImplementation(() => answer(report({ search: { status: "ok", fetchedAt: "2026-10-08T12:00:00.000Z", data: hostile } })))
    renderPage()
    expect(await screen.findByText("javascript:alert(1)")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "javascript:alert(1)" })).toBeNull()
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"))
    expect(links).toContain("https://nodaro.ai/docs")
    expect(links.some((href) => href?.includes("attacker"))).toBe(false)
    expect(screen.getByText("/win")).toBeInTheDocument()
    expect(screen.getByText(/Google sent its busiest 2 of 575/)).toBeInTheDocument()
  })
})

describe("ranges and refresh", () => {
  it("a range switch keeps the last report on screen while the next one loads", async () => {
    let releaseSeven: (r: Response) => void = () => undefined
    fetchMock.mockImplementation((url: string) =>
      url.includes("days=7") ? new Promise<Response>((resolve) => (releaseSeven = resolve)) : answer(report()),
    )
    renderPage()
    expect(await screen.findByText("4,321")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "7 days" }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === "/v1/admin/site-analytics?days=7")).toBe(true))
    expect(screen.getByText("4,321")).toBeInTheDocument()
    await act(async () => releaseSeven(new Response(JSON.stringify(report({ days: 7, search: { status: "ok", fetchedAt: "2026-10-08T12:00:00.000Z", data: searchData(777) } })))))
    expect(await screen.findByText("777")).toBeInTheDocument()
  })

  it("a refresh files its answer under the range it was asked for, even after a switch", async () => {
    let releaseFresh: (r: Response) => void = () => undefined
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("fresh=1")) return new Promise<Response>((resolve) => (releaseFresh = resolve))
      if (url.includes("days=7")) return answer(report({ days: 7, search: { status: "ok", fetchedAt: "2026-10-08T12:00:00.000Z", data: searchData(777) } }))
      return answer(report())
    })
    renderPage()
    expect(await screen.findByText("4,321")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }))
    fireEvent.click(screen.getByRole("button", { name: "7 days" }))
    expect(await screen.findByText("777")).toBeInTheDocument()
    await act(async () => releaseFresh(new Response(JSON.stringify(report({ search: { status: "ok", fetchedAt: "2026-10-08T12:05:00.000Z", data: searchData(2828) } })))))
    // Still the 7-day report on the 7-day button; the refreshed one waits under 28.
    expect(screen.getByText("777")).toBeInTheDocument()
    expect(screen.queryByText("2,828")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "28 days" }))
    expect(await screen.findByText("2,828")).toBeInTheDocument()
    expect(String(fetchMock.mock.calls.find(([url]) => String(url).includes("fresh=1"))?.[0])).toBe("/v1/admin/site-analytics?days=28&fresh=1")
  })
})

describe("index checks", () => {
  it("Check asks the server about that one page, shows Google's verdict and when it was checked, and keeps it across tabs", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/inspect")
        ? answer({ url: "https://nodaro.ai/docs", verdict: "PASS", coverageState: "Submitted and indexed", checkedAt: "2026-10-08T12:00:00.000Z" })
        : answer(report()),
    )
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Check" }))
    expect(await screen.findByText("Indexed")).toBeInTheDocument()
    expect(screen.getByText("Submitted and indexed")).toBeInTheDocument()
    expect(screen.getByText(/^Checked /)).toBeInTheDocument()
    const inspections = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/inspect"))
    expect(JSON.parse(String((inspections()[0]?.[1] as RequestInit).body))).toEqual({ url: "https://nodaro.ai/docs", fresh: false })

    const searchSection = within(screen.getByRole("heading", { name: /Google Search/ }).closest("section") as HTMLElement)
    fireEvent.click(searchSection.getByRole("button", { name: "Searches" }))
    expect(screen.queryByText("Indexed")).toBeNull()
    // Long enough for a cache that forgets unwatched answers to forget this one.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)))
    fireEvent.click(searchSection.getByRole("button", { name: "Pages" }))
    expect(await screen.findByText("Indexed")).toBeInTheDocument()
    expect(inspections()).toHaveLength(1)
  })

  it("a check the server refuses shows its reason in the row, and Check stays", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/inspect")
        ? answer({ error: { code: "daily_budget", message: "Today's budget of 900 page checks is used up. It resets at midnight Pacific time." } }, 429)
        : answer(report()),
    )
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Check" }))
    expect(await screen.findByText(/Today's budget of 900 page checks is used up/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Check" })).toBeInTheDocument()
  })

  it("Check again asks past the server's cache", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/inspect") ? answer({ url: "https://nodaro.ai/docs", verdict: "FAIL", coverageState: "Crawled - currently not indexed", checkedAt: "2026-10-08T12:00:00.000Z" }) : answer(report()),
    )
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Check" }))
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/inspect"))).toHaveLength(2))
    const last = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/inspect"))[1]
    expect(JSON.parse(String((last?.[1] as RequestInit).body))).toEqual({ url: "https://nodaro.ai/docs", fresh: true })
  })
})
