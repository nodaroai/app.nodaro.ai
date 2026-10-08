/**
 * "Now on site" and "Traffic sources": the card shows the last 30 minutes,
 * says how often the server asks Google, and stops asking from a page nobody
 * is using; a refusal stays in the card and says when Google is asked again.
 * Each sources table narrows to the rows that say where a visit came from
 * only where that means something, and landing pages are paths, never links.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import type { RealtimeSnapshot, SectionResult, SiteAnalyticsReport, SourceRow } from "../types"
import { AT, answer, onlineData, realtimeData, report, sourcesData } from "./fixtures"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))
vi.mock("@/lib/edition", () => ({ hasAdmin: () => true }))

import AdminSiteAnalyticsPage from "../page"
import { hasUtmTags } from "../sources-section"
import { REALTIME_IDLE_MS, REALTIME_POLLING } from "../use-site-analytics"

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const OK: SectionResult<RealtimeSnapshot> = { status: "ok", fetchedAt: AT, data: realtimeData() }

function serve(realtime: SectionResult<RealtimeSnapshot> = OK, body: SiteAnalyticsReport = report()) {
  fetchMock.mockImplementation((url: string) =>
    url.endsWith("/realtime") ? answer(realtime) : url.endsWith("/online-users") ? answer(onlineData()) : answer(body),
  )
}

const realtimeCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === "/v1/admin/site-analytics/realtime").length

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AdminSiteAnalyticsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** A section, once the page has drawn it. */
const section = async (heading: RegExp) => within((await screen.findByRole("heading", { name: heading })).closest("section") as HTMLElement)
const card = () => section(/Now on site/)
const sources = () => section(/Traffic sources/)

describe("Now on site", () => {
  it("shows the people on the site, each minute, the pages they are on, and that it refreshes every minute", async () => {
    serve()
    renderPage()
    expect(await (await card()).findByText("7")).toBeInTheDocument()
    expect((await card()).getByText("active users")).toBeInTheDocument()
    expect((await card()).getByText(/12 views · 30 events/)).toBeInTheDocument()
    expect((await card()).getByText("Pricing")).toBeInTheDocument()
    expect((await card()).getByText(/every minute while this page is open/)).toBeInTheDocument()
  })

  it("draws the minutes oldest on the left and this minute on the right", async () => {
    serve()
    renderPage()
    const chart = await (await card()).findByRole("img", { name: /Active users per minute/ })
    const bars = [...chart.querySelectorAll("rect")]
    // realtimeData: two people in each of the last three minutes, nobody before.
    expect(bars.map((bar) => Number(bar.getAttribute("height")) > 0)).toEqual([...Array<boolean>(27).fill(false), true, true, true])
    expect(bars.at(-1)?.getAttribute("data-minutes-ago")).toBe("0")
  })

  it("lists only pages someone is on", async () => {
    const pages = [
      { title: "Pricing", activeUsers: 3, views: 4 },
      { title: "Left already", activeUsers: 0, views: 1 },
    ]
    serve({ status: "ok", fetchedAt: AT, data: realtimeData({ pages }) })
    renderPage()
    expect(await (await card()).findByText("Pricing")).toBeInTheDocument()
    expect((await card()).queryByText("Left already")).toBeNull()
  })

  it("says so when the server has slowed down to spare Google's allowance", async () => {
    serve({ status: "ok", fetchedAt: AT, data: realtimeData({ refreshMinutes: 5 }) })
    renderPage()
    expect(await (await card()).findByText(/Google's allowance is running low, so every 5 minutes/)).toBeInTheDocument()
  })

  it("Google's refusal stays in the card with when Google is asked again; the rest of the page is untouched", async () => {
    serve({ status: "error", httpStatus: 429, reason: "RESOURCE_EXHAUSTED", message: "Exhausted property tokens per project per hour.", retryMinutes: 15 })
    renderPage()
    expect(await (await card()).findByText(/Exhausted property tokens per project per hour/)).toBeInTheDocument()
    expect((await card()).getByText("Google will be asked again in 15 minutes")).toBeInTheDocument()
    expect(screen.getByText("4,321")).toBeInTheDocument()
  })

  it("one minute is one minute", async () => {
    serve({ status: "error", httpStatus: 403, reason: "PERMISSION_DENIED", message: "No access.", retryMinutes: 1 })
    renderPage()
    expect(await (await card()).findByText("Google will be asked again in 1 minute")).toBeInTheDocument()
  })
})

describe("Now on site — asking only while someone is there", () => {
  it("once a minute, paused after 20 minutes without activity, and only from a tab in view", () => {
    expect(REALTIME_POLLING).toEqual({ refetchInterval: 60_000, refetchIntervalInBackground: false })
    expect(REALTIME_IDLE_MS).toBe(20 * 60_000)
  })

  it("asks every minute, stops on a page nobody touches, keeps the last snapshot, and resumes on the next movement", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    serve()
    renderPage()
    expect(await (await card()).findByText("7")).toBeInTheDocument()
    const first = realtimeCalls()
    await act(() => vi.advanceTimersByTimeAsync(3 * 60_000))
    expect(realtimeCalls()).toBe(first + 3)

    await act(() => vi.advanceTimersByTimeAsync(REALTIME_IDLE_MS))
    expect((await card()).getByText(/Paused after 20 minutes without activity/)).toBeInTheDocument()
    const paused = realtimeCalls()
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000))
    expect(realtimeCalls()).toBe(paused)
    expect((await card()).getByText("7")).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event("pointermove"))
    })
    await waitFor(() => expect(realtimeCalls()).toBe(paused + 1))
    expect((await card()).getByText(/every minute while this page is open/)).toBeInTheDocument()
  })

  it("a refresh that fails says so, and the last snapshot stays without passing for a live one", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    serve()
    renderPage()
    expect(await (await card()).findByText("7")).toBeInTheDocument()
    fetchMock.mockImplementation((url: string) => (url.endsWith("/realtime") ? answer({ error: { code: "unauthorized", message: "Session expired" } }, 401) : answer(report())))
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(await (await card()).findByText(/Could not refresh \(Session expired\) — showing/)).toBeInTheDocument()
    expect((await card()).getByText("7")).toBeInTheDocument()
    expect((await card()).queryByText(/every minute while this page is open/)).toBeNull()
  })

  it("a tab in the background asks nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    serve()
    renderPage()
    expect(await (await card()).findByText("7")).toBeInTheDocument()
    const before = realtimeCalls()
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden")
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000))
    expect(realtimeCalls()).toBe(before)
  })
})

describe("Traffic sources", () => {
  it("starts on channels, every row shown, with nothing to hide", async () => {
    serve()
    renderPage()
    expect(await (await sources()).findByText("Direct")).toBeInTheDocument()
    expect((await sources()).getByText("Organic Search")).toBeInTheDocument()
    expect((await sources()).queryByRole("checkbox")).toBeNull()
  })

  it("source / medium shows every row; the switch hides direct and unknown visits", async () => {
    serve()
    renderPage()
    fireEvent.click(await (await sources()).findByRole("button", { name: "Source / medium" }))
    expect((await sources()).getByText("(direct)")).toBeInTheDocument()
    const box = (await sources()).getByRole("checkbox", { name: "Hide direct and unknown" })
    expect(box).not.toBeChecked()
    fireEvent.click(box)
    expect((await sources()).queryByText("(direct)")).toBeNull()
    expect((await sources()).getByText("google")).toBeInTheDocument()
  })

  it("campaigns start with named campaigns only; the switch shows GA's own rows again", async () => {
    serve()
    renderPage()
    fireEvent.click(await (await sources()).findByRole("button", { name: "Campaigns" }))
    expect((await sources()).getByText("launch-oct")).toBeInTheDocument()
    expect((await sources()).queryByText("(direct)")).toBeNull()
    fireEvent.click((await sources()).getByRole("checkbox", { name: "Named campaigns only" }))
    expect((await sources()).getByText("(direct)")).toBeInTheDocument()
  })

  it("with no named campaign at all, the table says so — and the switch is still there", async () => {
    const campaigns = { rows: [{ labels: ["(direct)"], sessions: 9, activeUsers: 8, newUsers: 7, engagementRate: 0.5, keyEvents: 0 }], total: 1 }
    serve(OK, report({ sources: { status: "ok", fetchedAt: AT, data: { ...sourcesData, campaigns } } }))
    renderPage()
    fireEvent.click(await (await sources()).findByRole("button", { name: "Campaigns" }))
    expect((await sources()).getByText("No visits from a named campaign in this range.")).toBeInTheDocument()
    expect((await sources()).getByRole("checkbox", { name: "Named campaigns only" })).toBeChecked()
  })

  it("a tab with nothing to hide shows no switch", async () => {
    const utm = { rows: [{ labels: ["newsletter", "email", "launch-oct", "hero-video", "ai video"], sessions: 40, activeUsers: 30, newUsers: 28, engagementRate: 0.5, keyEvents: 1 }], total: 1 }
    serve(OK, report({ sources: { status: "ok", fetchedAt: AT, data: { ...sourcesData, utm } } }))
    renderPage()
    fireEvent.click(await (await sources()).findByRole("button", { name: "UTM" }))
    expect((await sources()).getByText("newsletter")).toBeInTheDocument()
    expect((await sources()).queryByRole("checkbox")).toBeNull()
  })

  it("UTM shows all five fields and starts with tagged visits — a tag without a campaign included, an untagged search not", async () => {
    serve()
    renderPage()
    fireEvent.click(await (await sources()).findByRole("button", { name: "UTM" }))
    const table = await sources()
    expect(table.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Source",
      "Medium",
      "Campaign",
      "Content",
      "Term",
      "Sessions",
      "Users",
      "New users",
      "Engagement rate",
      "Key events",
    ])
    expect(table.getByText("newsletter")).toBeInTheDocument()
    expect(table.getByText("card-character-open")).toBeInTheDocument()
    expect(table.queryByText("google")).toBeNull()
    fireEvent.click(table.getByRole("checkbox", { name: "Tagged visits only" }))
    expect((await sources()).getByText("google")).toBeInTheDocument()
  })

  it("landing pages are paths — no host, no links, nothing to hide — and say when Google sent only its top rows", async () => {
    serve()
    renderPage()
    fireEvent.click(await (await sources()).findByRole("button", { name: "Landing pages" }))
    const table = await sources()
    expect(table.getByText("/pricing")).toBeInTheDocument()
    expect(table.queryAllByRole("link")).toHaveLength(0)
    expect(table.queryByRole("checkbox")).toBeNull()
    expect(table.getByText(/Google sent its top 2 of 9/)).toBeInTheDocument()
  })
})

describe("hasUtmTags", () => {
  const row = (labels: string[]): SourceRow => ({ labels, sessions: 1, activeUsers: 1, newUsers: 1, engagementRate: 1, keyEvents: 0 })

  it("a link without tags: GA fills the source and medium itself and names the channel as the campaign", () => {
    expect(hasUtmTags(row(["google", "organic", "(organic)", "(not set)", "(not provided)"]))).toBe(false)
    expect(hasUtmTags(row(["claude.ai", "ai-assistant", "(ai-assistant)", "(not set)", "(not set)"]))).toBe(false)
    expect(hasUtmTags(row(["github.com", "referral", "(referral)", "(not set)", "(not set)"]))).toBe(false)
    expect(hasUtmTags(row(["(not set)", "(not set)", "(not set)", "", ""]))).toBe(false)
  })

  it("a tagged link, with or without a campaign", () => {
    expect(hasUtmTags(row(["extension", "card-character-open", "(not set)", "(not set)", "(not set)"]))).toBe(true)
    expect(hasUtmTags(row(["chatgpt.com", "(not set)", "(not set)", "(not set)", "(not set)"]))).toBe(true)
    expect(hasUtmTags(row(["newsletter", "email", "launch-oct", "", ""]))).toBe(true)
  })
})
