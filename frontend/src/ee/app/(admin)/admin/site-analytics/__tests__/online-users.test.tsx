/**
 * "Signed in now": each person once, with where they are (APP, STUDIO, EXT…),
 * country, address, device and when last seen; a name opens them on the users
 * page; a list the server could not read says so rather than "nobody"; the
 * list is asked for twice a minute from a tab in view, and not from an idle page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import type { OnlineUser } from "../types"
import { AT, REALTIME_OK, answer, onlineData, report } from "./fixtures"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))
vi.mock("@/lib/edition", () => ({ hasAdmin: () => true }))

import AdminSiteAnalyticsPage from "../page"
import { agoText, countryText, deviceText } from "../presence-format"
import { ONLINE_USERS_POLLING, REALTIME_IDLE_MS } from "../use-site-analytics"

const CHROME_WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
const AT_MS = new Date(AT).getTime()

const DANA: OnlineUser = {
  userId: "00000000-0000-4000-8000-0000000000d1",
  email: "dana@x.test",
  name: "Dana Levi",
  lastSeenAt: AT,
  surfaces: [
    { source: "web", detail: "studio.nodaro.ai", label: "STUDIO", address: "203.0.113.7", country: "IL", userAgent: CHROME_WINDOWS, lastSeenAt: AT },
    { source: "extension", detail: "abcdefgh", label: "EXT", address: "203.0.113.7", country: "IL", userAgent: null, lastSeenAt: new Date(AT_MS - 3 * 60_000).toISOString() },
  ],
}
const NAMELESS: OnlineUser = {
  userId: "00000000-0000-4000-8000-0000000000d2",
  email: null,
  name: null,
  lastSeenAt: new Date(AT_MS - 4 * 60_000).toISOString(),
  surfaces: [{ source: "cli", detail: "cli/1.4.0", label: "CLI", address: null, country: null, userAgent: "node", lastSeenAt: new Date(AT_MS - 4 * 60_000).toISOString() }],
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  vi.useFakeTimers({ shouldAdvanceTime: true, now: AT_MS + 30_000 })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function serve(online: () => Promise<Response>) {
  fetchMock.mockImplementation((url: string) => (url.endsWith("/online-users") ? online() : url.endsWith("/realtime") ? answer(REALTIME_OK) : answer(report())))
}

const onlineCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === "/v1/admin/online-users").length

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AdminSiteAnalyticsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const section = async () => within((await screen.findByRole("heading", { name: /Signed in now/ })).closest("section") as HTMLElement)

describe("Signed in now", () => {
  it("each person once, with where they are, country, address, device and when last seen", async () => {
    serve(() => answer(onlineData([DANA, NAMELESS])))
    renderPage()
    const list = await section()
    expect(await list.findByRole("heading", { name: "Signed in now · 2" })).toBeInTheDocument()
    const dana = list.getByRole("link", { name: "Dana Levi" }).closest("tr") as HTMLElement
    expect(within(dana).getByText("dana@x.test")).toBeInTheDocument()
    expect(within(dana).getByText("STUDIO")).toHaveAttribute("title", "studio.nodaro.ai · 203.0.113.7 · Israel (IL) · Chrome · Windows · just now")
    expect(within(dana).getByText("EXT")).toBeInTheDocument()
    expect(within(dana).getByText("Israel (IL)")).toBeInTheDocument()
    expect(within(dana).getByText("203.0.113.7")).toBeInTheDocument()
    expect(within(dana).getByText("Chrome · Windows")).toBeInTheDocument()
    expect(within(dana).getByText("just now")).toBeInTheDocument()
    const nameless = list.getByRole("link", { name: NAMELESS.userId }).closest("tr") as HTMLElement
    expect(within(nameless).getByText("CLI")).toBeInTheDocument()
    expect(within(nameless).getByText("node")).toBeInTheDocument()
    expect(within(nameless).getByText("4 min ago")).toBeInTheDocument()
  })

  it("a name opens that person on the users page", async () => {
    serve(() => answer(onlineData([DANA])))
    renderPage()
    expect(await (await section()).findByRole("link", { name: "Dana Levi" })).toHaveAttribute("href", `/admin/users?user=${DANA.userId}`)
  })

  it("nobody, and a list the server could not read, are told apart", async () => {
    serve(() => answer(onlineData()))
    const first = renderPage()
    expect(await (await section()).findByText("Nobody is signed in right now.")).toBeInTheDocument()
    first.unmount()
    serve(() => answer(onlineData([], { available: false })))
    renderPage()
    expect(await (await section()).findByText(/could not read who is signed in/)).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Signed in now" })).toBeInTheDocument()
  })

  it("asks twice a minute, says when a refresh failed, and stops on a page nobody touches", async () => {
    expect(ONLINE_USERS_POLLING).toEqual({ refetchInterval: 30_000, refetchIntervalInBackground: false })
    let fail = false
    serve(() => (fail ? answer({ error: { code: "x", message: "Server busy" } }, 503) : answer(onlineData([DANA]))))
    renderPage()
    await (await section()).findByRole("link", { name: "Dana Levi" })
    const first = onlineCalls()
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(onlineCalls()).toBe(first + 1)
    fail = true
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(await (await section()).findByText(/Could not refresh \(Server busy\)/)).toBeInTheDocument()
    expect((await section()).getByRole("link", { name: "Dana Levi" })).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(REALTIME_IDLE_MS))
    const paused = onlineCalls()
    await act(() => vi.advanceTimersByTimeAsync(5 * 60_000))
    expect(onlineCalls()).toBe(paused)
  })
})

describe("Signed in now, without Google", () => {
  it("shows whoever is here even when the Google report could not load", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/online-users") ? answer(onlineData([DANA])) : answer({ error: { code: "internal_error", message: "Google is down" } }, 500),
    )
    renderPage()
    expect(await (await section()).findByRole("link", { name: "Dana Levi" })).toBeInTheDocument()
    expect(screen.getByText("Google is down")).toBeInTheDocument()
  })
})

describe("presence-format", () => {
  it("names a browser and its system, or a tool by its own first word", () => {
    expect(deviceText(CHROME_WINDOWS)).toBe("Chrome · Windows")
    expect(deviceText("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe("Safari · macOS")
    expect(deviceText("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1")).toBe("Chrome · iOS")
    expect(deviceText(`${CHROME_WINDOWS} Edg/141.0.0.0`)).toBe("Edge · Windows")
    expect(deviceText("Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox · Linux")
    expect(deviceText("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36")).toBe("Chrome · Android")
    expect(deviceText("curl/8.4.0")).toBe("curl/8.4.0")
    expect(deviceText(null)).toBe("—")
  })

  it("names a country, and says nothing without one", () => {
    expect(countryText("IL")).toBe("Israel (IL)")
    expect(countryText("US")).toBe("United States (US)")
    expect(countryText(null)).toBe("—")
  })

  it("just now, minutes ago, then the time of day", () => {
    expect(agoText(AT, AT_MS + 59_000)).toBe("just now")
    expect(agoText(AT, AT_MS + 4 * 60_000 + 5_000)).toBe("4 min ago")
    expect(agoText(AT, AT_MS + 2 * 3_600_000)).not.toMatch(/ago|now/)
  })
})
