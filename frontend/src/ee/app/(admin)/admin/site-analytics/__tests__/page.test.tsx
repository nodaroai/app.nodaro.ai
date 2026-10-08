/**
 * The Site Analytics page: a setup that is not finished says what is missing;
 * a section Google refuses never hides the others, and says what fixes it;
 * a refresh files its answer under its own range; a page's index verdict is
 * asked once and survives tab switches; only the site's own pages are links.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { SiteAnalyticsReport } from "../types"
import { AT, EMAIL, NOT_SET_UP, REALTIME_OK, answer, report, searchData } from "./fixtures"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))
vi.mock("@/lib/edition", () => ({ hasAdmin: () => true }))

import AdminSiteAnalyticsPage from "../page"

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

/** The server: the realtime snapshot, whatever a test answers itself, and otherwise the report. */
function serve(body: SiteAnalyticsReport, extra: (url: string) => Promise<Response> | undefined = () => undefined) {
  fetchMock.mockImplementation((url: string) => extra(url) ?? (url.endsWith("/realtime") ? answer(REALTIME_OK) : answer(body)))
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AdminSiteAnalyticsPage />
    </QueryClientProvider>,
  )
}

describe("setup and refusals", () => {
  it("a setup that is not finished names every missing variable, every section waits for it, and nothing real-time is asked", async () => {
    serve(NOT_SET_UP)
    renderPage()
    expect(await screen.findByText("Finish the setup")).toBeInTheDocument()
    expect(screen.getByText("SITE_ANALYTICS_SERVICE_ACCOUNT_JSON is not set.")).toBeInTheDocument()
    expect(screen.getAllByText(/Not set up yet/)).toHaveLength(4)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/v1/admin/site-analytics?days=28")
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/realtime"))).toBe(false)
    expect(screen.queryByRole("link", { name: /Google Analytics/ })).toBeNull()
    expect(screen.queryByRole("link", { name: /Search Console/ })).toBeNull()
  })

  it("Analytics refusing access shows Google's reason and whom to grant, and Search Console still shows its numbers", async () => {
    serve(report({ traffic: { status: "error", httpStatus: 403, reason: "PERMISSION_DENIED", message: "User does not have sufficient permissions for this property." } }))
    renderPage()
    expect(await screen.findByText(/User does not have sufficient permissions for this property/)).toBeInTheDocument()
    expect(screen.getByText(/Admin → Property access management/)).toBeInTheDocument()
    expect(screen.getAllByText(EMAIL).length).toBeGreaterThan(0)
    expect(screen.getByText("4,321")).toBeInTheDocument()
  })

  it("an API that is turned off says to turn it on — not to grant access that would change nothing", async () => {
    serve(report({ traffic: { status: "error", httpStatus: 403, reason: "SERVICE_DISABLED", message: "Google Analytics Data API has not been used in project 123 before or it is disabled." } }))
    renderPage()
    expect(await screen.findByText(/Turn the API on/)).toBeInTheDocument()
    expect(screen.queryByText(/Property access management/)).toBeNull()
  })
})

describe("links", () => {
  it("only the site's own pages are links; an address from Google that is not http(s) stays text", async () => {
    const hostile = searchData(1, [{ key: "javascript:alert(1)", clicks: 1, impressions: 2, ctr: 0.5, position: 3 }])
    serve(report({ search: { status: "ok", fetchedAt: AT, data: hostile } }))
    renderPage()
    expect(await screen.findByText("javascript:alert(1)")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "javascript:alert(1)" })).toBeNull()
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"))
    expect(links).toContain("https://nodaro.ai/docs")
    expect(links.some((href) => href?.includes("attacker"))).toBe(false)
    expect(screen.getByText("/win")).toBeInTheDocument()
    expect(screen.getByText(/Google sent its busiest 2 of 575/)).toBeInTheDocument()
  })

  it("Google Analytics and Search Console open in a new tab, GA over the page's range and with no account number", async () => {
    serve(report())
    renderPage()
    const ga = await screen.findByRole("link", { name: /Google Analytics/ })
    expect(ga).toHaveAttribute("target", "_blank")
    expect(ga.getAttribute("rel")).toContain("noopener")
    expect(ga).toHaveAttribute(
      "href",
      "https://analytics.google.com/analytics/web/#/p537345785/reports/dashboard?params=_u..nav%3Dmaui%26_u.dateOption%3Dlast28Days%26_u.comparisonOption%3Ddisabled&ruid=business-objectives-generate-leads-overview,business-objectives,generate-leads&collectionId=business-objectives&r=business-objectives-generate-leads-overview",
    )
    const searchConsole = screen.getByRole("link", { name: /Search Console/ })
    expect(searchConsole).toHaveAttribute("target", "_blank")
    expect(searchConsole).toHaveAttribute("href", "https://search.google.com/search-console/performance/search-analytics?resource_id=sc-domain%3Anodaro.ai")
    fireEvent.click(screen.getByRole("button", { name: "7 days" }))
    expect(screen.getByRole("link", { name: /Google Analytics/ }).getAttribute("href")).toContain("_u.dateOption%3Dlast7Days%26")
  })
})

describe("ranges and refresh", () => {
  it("a range switch keeps the last report on screen while the next one loads", async () => {
    let releaseSeven: (r: Response) => void = () => undefined
    serve(report(), (url) => (url.includes("days=7") ? new Promise<Response>((resolve) => (releaseSeven = resolve)) : undefined))
    renderPage()
    expect(await screen.findByText("4,321")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "7 days" }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === "/v1/admin/site-analytics?days=7")).toBe(true))
    expect(screen.getByText("4,321")).toBeInTheDocument()
    await act(async () => releaseSeven(new Response(JSON.stringify(report({ days: 7, search: { status: "ok", fetchedAt: AT, data: searchData(777) } })))))
    expect(await screen.findByText("777")).toBeInTheDocument()
  })

  it("a refresh files its answer under the range it was asked for, even after a switch", async () => {
    let releaseFresh: (r: Response) => void = () => undefined
    serve(report(), (url) => {
      if (url.includes("fresh=1")) return new Promise<Response>((resolve) => (releaseFresh = resolve))
      if (url.includes("days=7")) return answer(report({ days: 7, search: { status: "ok", fetchedAt: AT, data: searchData(777) } }))
      return undefined
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
  const inspections = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/inspect"))

  it("Check asks the server about that one page, shows Google's verdict and when it was checked, and keeps it across tabs", async () => {
    serve(report(), (url) => (url.endsWith("/inspect") ? answer({ url: "https://nodaro.ai/docs", verdict: "PASS", coverageState: "Submitted and indexed", checkedAt: AT }) : undefined))
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Check" }))
    expect(await screen.findByText("Indexed")).toBeInTheDocument()
    expect(screen.getByText("Submitted and indexed")).toBeInTheDocument()
    expect(screen.getByText(/^Checked /)).toBeInTheDocument()
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
    serve(report(), (url) =>
      url.endsWith("/inspect") ? answer({ error: { code: "daily_budget", message: "Today's budget of 900 page checks is used up. It resets at midnight Pacific time." } }, 429) : undefined,
    )
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Check" }))
    expect(await screen.findByText(/Today's budget of 900 page checks is used up/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Check" })).toBeInTheDocument()
  })

  it("Check again asks past the server's cache", async () => {
    serve(report(), (url) => (url.endsWith("/inspect") ? answer({ url: "https://nodaro.ai/docs", verdict: "FAIL", coverageState: "Crawled - currently not indexed", checkedAt: AT }) : undefined))
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Check" }))
    fireEvent.click(await screen.findByRole("button", { name: "Check again" }))
    await waitFor(() => expect(inspections()).toHaveLength(2))
    expect(JSON.parse(String((inspections()[1]?.[1] as RequestInit).body))).toEqual({ url: "https://nodaro.ai/docs", fresh: true })
  })
})
