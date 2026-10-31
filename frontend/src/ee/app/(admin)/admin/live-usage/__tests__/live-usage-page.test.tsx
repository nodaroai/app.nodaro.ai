/**
 * Admin → Live usage: both views from one report, the users sorted by what
 * waits, the per-user drawer (its jobs, Cancel on a waiting job, the override
 * editor where overrides exist, the last 30 days), and the measure-only
 * state, where nothing waits and the page says what WOULD have waited.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import type { LaneUserReport, LiveReport, StoredOverride } from "../types"
import {
  AT,
  DANA_ID,
  QUEUED_JOB,
  STORED_OVERRIDE,
  WAITING_RUN,
  answer,
  config,
  enforcedReport,
  measureOnlyReport,
  providersHistory,
  userReport,
  usersHistory,
} from "./fixtures"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))
const edition = vi.hoisted(() => ({ credits: true }))
vi.mock("@/lib/edition", () => ({ hasAdmin: () => true, hasCredits: () => edition.credits }))
const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }))

import { queryClient as appQueryClient } from "@/lib/query-client"
import AdminLiveUsagePage, { VIEW_STORAGE_KEY } from "../page"
import { LIVE_USAGE_POLLING, LiveUsageError } from "../use-live-usage"

const fetchMock = vi.fn()

interface Serve {
  live?: LiveReport
  user?: LaneUserReport
  /** Answers to successive reads of the user, the last repeated. */
  users?: LaneUserReport[]
  editable?: boolean
  cancel?: () => Promise<Response>
  /** What /live answers instead of a report (a refusal). */
  liveStatus?: number
}

/** The stored override, as the PUT writes it and /users/:id reads it back. */
let stored: StoredOverride

function serve(s: Serve = {}) {
  stored = STORED_OVERRIDE
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url)
    if (u === "/v1/admin/lanes/live") {
      return s.liveStatus ? answer({ error: { code: "forbidden", message: "Admin access required" } }, s.liveStatus) : answer(s.live ?? enforcedReport())
    }
    if (u === "/v1/admin/lanes/config") return answer(config(s.editable ?? true))
    if (u.startsWith("/v1/admin/lanes/users/") && (!init?.method || init.method === "GET")) {
      const next = s.users && s.users.length > 1 ? s.users.shift() : s.users?.[0]
      return answer({ ...(next ?? s.user ?? userReport()), own: stored })
    }
    if (u === `/v1/admin/lanes/users/${DANA_ID}` && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as Record<string, number | string | null>
      const lanes = Object.fromEntries(["provider", "llm", "local", "run"].filter((l) => body[l] !== null).map((l) => [l, body[l]]))
      const override = Object.keys(lanes).length > 0 ? lanes : null
      const note = override ? (body.note as string | null) : null
      stored = { available: true, override, note, updatedAt: AT }
      return answer({ userId: DANA_ID, override, note })
    }
    if (u.startsWith("/v1/admin/lanes/history")) return answer(u.includes("view=providers") ? providersHistory() : usersHistory())
    if (u.endsWith("/cancel") && init?.method === "POST") return s.cancel ? s.cancel() : answer({ cancelled: true, inFlight: false, userId: DANA_ID })
    return answer({ error: { code: "not_found", message: `unexpected ${u}` } }, 404)
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  localStorage.clear()
  toastError.mockReset()
  edition.credits = true
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(AT).getTime() })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderPage() {
  return render(
    // The app's own defaults (a retry, an error toast on every mutation): the page must hold under them.
    <QueryClientProvider client={new QueryClient({ defaultOptions: appQueryClient.getDefaultOptions() })}>
      <MemoryRouter>
        <AdminLiveUsagePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const usersTable = async () => screen.findByRole("table", { name: "Users" })
const userButtons = (table: HTMLElement) => within(table).getAllByRole("button").map((b) => b.textContent)

describe("Live usage", () => {
  it("renders both views from a fixture", async () => {
    serve()
    renderPage()
    const users = await usersTable()
    expect(within(users).getByRole("button", { name: "Dana Levi" })).toBeInTheDocument()
    // Dana's two payer lines are two rows under her one name.
    expect(within(users).getAllByText("Personal")).toHaveLength(3)
    const workspace = within(users).getByText(/^Workspace/).closest("tr") as HTMLElement
    expect(workspace.previousElementSibling?.textContent).toContain("Dana Levi")
    expect(within(users).getAllByRole("button", { name: "Dana Levi" })).toHaveLength(1)
    expect(within(users).getByText("+46 queued")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Servers" })).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Providers" }))
    const providers = await screen.findByRole("table", { name: "Providers" })
    expect(within(providers).getByText("kie")).toBeInTheDocument()
    expect(within(providers).getByText("9 / 100")).toBeInTheDocument()
    expect(within(providers).getByText("6.0%")).toBeInTheDocument()
    // No outcome in 15 minutes is no rate, not 0 %.
    const quiet = within(providers).getByText("elevenlabs").closest("tr") as HTMLElement
    expect(within(quiet).getAllByText("—")).toHaveLength(2)
    expect(screen.getByText("Not limited — runs for hours at the provider")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Ungated" })).toBeInTheDocument()
    expect(screen.getByText("scene3d-render")).toBeInTheDocument()
    // The view is remembered on this browser.
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe("providers")
  })

  it("names the MCP clients on a line, with the rest as others; a line with no names shows the count", async () => {
    const report = enforcedReport()
    const live = { ...report, lines: report.lines.map((l) => (l.payer === `user:${DANA_ID}` ? { ...l, mcpClients: [{ name: "client-a", count: 3 }, { name: "client-b", count: 1 }] } : l)) }
    serve({ live })
    renderPage()
    const users = await usersTable()
    expect(within(users).getByText("MCP · client-a 3, client-b 1, others 1")).toBeInTheDocument()
    serve({ live: enforcedReport() })
    await vi.advanceTimersByTimeAsync(3_000)
    expect(await within(users).findByText("MCP · 5")).toBeInTheDocument()
  })

  it("sorting by queued", async () => {
    serve()
    renderPage()
    const users = await usersTable()
    // Server order is Mia, Dana, Yossi; Yossi waits 46, Dana 9, Mia nothing.
    expect(userButtons(users)).toEqual(["yossi@x.test", "Dana Levi", "mia@x.test"])
  })

  it("polls every 3 s while the tab is in view, stops on a refusal, and says since when the counters count", async () => {
    expect(LIVE_USAGE_POLLING).toMatchObject({ refetchIntervalInBackground: false, retry: false })
    const every = (error: Error | null) => LIVE_USAGE_POLLING.refetchInterval({ state: { error } })
    expect(every(null)).toBe(3_000)
    expect(every(new LiveUsageError("busy", 503))).toBe(3_000)
    expect(every(new LiveUsageError("Admin access required", 403))).toBe(false)
    // Rate-limited passes: keep asking.
    expect(every(new LiveUsageError("Too many requests", 429))).toBe(3_000)
    serve()
    renderPage()
    await usersTable()
    await userEvent.click(screen.getByRole("button", { name: "Providers" }))
    expect(await screen.findByText(/Counted since/)).toBeInTheDocument()
  })

  it("a refused /live is asked once, not every 3 s", async () => {
    serve({ liveStatus: 403 })
    renderPage()
    expect(await screen.findByText("Admin access required")).toBeInTheDocument()
    await vi.advanceTimersByTimeAsync(7_000)
    expect(fetchMock.mock.calls.filter(([u]) => String(u) === "/v1/admin/lanes/live")).toHaveLength(1)
  })

  it("a rate-limited /live (429) is asked again on the next tick", async () => {
    serve({ liveStatus: 429 })
    renderPage()
    await waitFor(() => expect(fetchMock.mock.calls.filter(([u]) => String(u) === "/v1/admin/lanes/live")).toHaveLength(1))
    await vi.advanceTimersByTimeAsync(7_000)
    expect(fetchMock.mock.calls.filter(([u]) => String(u) === "/v1/admin/lanes/live").length).toBeGreaterThanOrEqual(2)
  })

  it("the drawer cancel calls the route", async () => {
    serve()
    renderPage()
    await userEvent.click(within(await usersTable()).getByRole("button", { name: "Dana Levi" }))
    const drawer = await screen.findByRole("dialog")
    expect(await within(drawer).findByText("image-to-video")).toBeInTheDocument()
    // One Cancel: the queued job. Not the running one, a run waiting to start, nor a call waiting inside a job.
    expect(within(drawer).getByText("workflow")).toBeInTheDocument()
    const cancels = within(drawer).getAllByRole("button", { name: "Cancel job" })
    expect(cancels).toHaveLength(1)
    const posted = () => fetchMock.mock.calls.some(([u, init]) => String(u).endsWith("/cancel") && (init as RequestInit | undefined)?.method === "POST")
    // It asks first, with focus on the button that changes nothing; dismissing it sends nothing.
    await userEvent.click(cancels[0]!)
    let ask = within(drawer).getByRole("alertdialog", { name: "Cancel this job and refund it?" })
    expect(within(ask).getByRole("button", { name: "Keep job" })).toHaveFocus()
    await userEvent.click(within(ask).getByRole("button", { name: "Keep job" }))
    expect(within(drawer).queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(posted()).toBe(false)
    await userEvent.click(within(drawer).getByRole("button", { name: "Cancel job" }))
    ask = within(drawer).getByRole("alertdialog", { name: "Cancel this job and refund it?" })
    await userEvent.click(within(ask).getByRole("button", { name: "Cancel job" }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(`/v1/admin/lanes/jobs/${QUEUED_JOB}/cancel`, expect.objectContaining({ method: "POST" })),
    )
    expect(await within(drawer).findByText("Cancelled; its credits were refunded.")).toBeInTheDocument()
    expect(within(drawer).queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("without credits the cancel asks and answers with no refund", async () => {
    edition.credits = false
    serve()
    renderPage()
    await userEvent.click(within(await usersTable()).getByRole("button", { name: "Dana Levi" }))
    const drawer = await screen.findByRole("dialog")
    await userEvent.click(await within(drawer).findByRole("button", { name: "Cancel job" }))
    const ask = within(drawer).getByRole("alertdialog", { name: "Cancel this job?" })
    await userEvent.click(within(ask).getByRole("button", { name: "Cancel job" }))
    expect(await within(drawer).findByText("Cancelled.")).toBeInTheDocument()
    expect(within(drawer).queryByText(/refund/)).not.toBeInTheDocument()
  })

  it("the drawer shows the server's reason when a cancel is refused", async () => {
    serve({ cancel: () => answer({ error: { code: "not_this_environment", message: "This job is not waiting in this environment's lanes; cancel it where it waits." } }, 409) })
    renderPage()
    await userEvent.click(within(await usersTable()).getByRole("button", { name: "Dana Levi" }))
    const drawer = await screen.findByRole("dialog")
    await userEvent.click(await within(drawer).findByRole("button", { name: "Cancel job" }))
    await userEvent.click(within(within(drawer).getByRole("alertdialog")).getByRole("button", { name: "Cancel job" }))
    expect(await within(drawer).findByText(/not waiting in this environment's lanes/)).toBeInTheDocument()
    // Said in place, not again in the app's error toast.
    expect(toastError).not.toHaveBeenCalled()
  })

  it("shows no internal ids: no user id in the drawer, no workspace id on a line", async () => {
    serve()
    const { container } = renderPage()
    const users = await usersTable()
    expect(within(users).getByText("Workspace")).toBeInTheDocument()
    expect(container.innerHTML).not.toContain("ws000000")
    await userEvent.click(within(users).getByRole("button", { name: "Dana Levi" }))
    const drawer = await screen.findByRole("dialog")
    await within(drawer).findByText("image-to-video")
    expect(drawer.innerHTML).not.toContain(DANA_ID)
    expect(document.body.innerHTML).not.toContain(WAITING_RUN)
  })

  it("the drawer shows 30-day history", async () => {
    serve()
    renderPage()
    await userEvent.click(within(await usersTable()).getByRole("button", { name: "Dana Levi" }))
    const drawer = await screen.findByRole("dialog")
    const history = await within(drawer).findByRole("table", { name: "Last 30 days" })
    expect(within(history).getByText("2026-10-29")).toBeInTheDocument()
    expect(within(history).getByText("87")).toBeInTheDocument()
    // Each lane's peak on its own, never a sum across lanes.
    expect(within(history).getByText("Provider 4 · LLM 2 · Runs 1")).toBeInTheDocument()
    expect(within(history).getByText("5m 12s")).toBeInTheDocument()
  })

  it("the override editor shows the stored override and note over the user's plan", async () => {
    serve({ editable: true })
    renderPage()
    await userEvent.click(within(await usersTable()).getByRole("button", { name: "Dana Levi" }))
    const drawer = await screen.findByRole("dialog")
    expect(await within(drawer).findByRole("heading", { name: "Lane override" })).toBeInTheDocument()
    expect(within(drawer).getByLabelText("Provider")).toHaveValue(6)
    expect(within(drawer).getByLabelText("Note")).toHaveValue("studio account")
    expect(within(drawer).getByLabelText("LLM")).toHaveAttribute("placeholder", "8")
  })

  it("a save keeps the note and the editor then shows what is stored; a removal clears it", async () => {
    serve({ editable: true })
    renderPage()
    await userEvent.click(within(await usersTable()).getByRole("button", { name: "Dana Levi" }))
    const drawer = await screen.findByRole("dialog")
    const provider = await within(drawer).findByLabelText("Provider")
    await userEvent.clear(provider)
    await userEvent.type(provider, "8")
    await userEvent.click(within(drawer).getByRole("button", { name: "Save override" }))
    expect(await within(drawer).findByText("Saved.")).toBeInTheDocument()
    const put = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
    expect(JSON.parse(String((put?.[1] as RequestInit).body))).toEqual({ provider: 8, llm: null, local: null, run: null, note: "studio account" })
    expect(within(drawer).getByLabelText("Provider")).toHaveValue(8)

    await userEvent.click(within(drawer).getByRole("button", { name: "Remove override" }))
    expect(await within(drawer).findByText("Override removed.")).toBeInTheDocument()
    expect(within(drawer).getByLabelText("Provider")).toHaveValue(null)
    expect(within(drawer).getByLabelText("Note")).toHaveValue("")
    expect(within(drawer).getByRole("button", { name: "Remove override" })).toBeDisabled()
    // A refresh reads the same back: nothing stale returns.
    await vi.advanceTimersByTimeAsync(3_100)
    expect(within(drawer).getByLabelText("Provider")).toHaveValue(null)
    expect(toastError).not.toHaveBeenCalled()
  })

  it("the override editor keeps what the admin typed when a refresh drops the user's own line", async () => {
    // First read: Dana's own line. Later reads: nothing on her lines; the stored override is unchanged.
    serve({ editable: true, users: [userReport(), userReport({ lines: [] })] })
    renderPage()
    await userEvent.click(within(await usersTable()).getByRole("button", { name: "Dana Levi" }))
    const drawer = await screen.findByRole("dialog")
    const provider = await within(drawer).findByLabelText("Provider")
    expect(provider).toHaveValue(6)
    await userEvent.clear(provider)
    await userEvent.type(provider, "9")
    const reads = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/v1/admin/lanes/users/")).length
    const before = reads()
    await vi.advanceTimersByTimeAsync(3_100)
    await waitFor(() => expect(reads()).toBeGreaterThan(before))
    await within(drawer).findByText("Nothing running or waiting right now.")
    expect(within(drawer).getByLabelText("Provider")).toHaveValue(9)
  })

  it("Save is not offered with every lane blank: only Remove deletes an override", async () => {
    serve({ editable: true })
    renderPage()
    await userEvent.click(within(await usersTable()).getByRole("button", { name: "Dana Levi" }))
    const drawer = await screen.findByRole("dialog")
    await userEvent.clear(await within(drawer).findByLabelText("Provider"))
    expect(within(drawer).getByRole("button", { name: "Save override" })).toBeDisabled()
    expect(within(drawer).getByRole("button", { name: "Remove override" })).toBeEnabled()
  })

  it("the override editor is hidden when editable:false", async () => {
    serve({ editable: false })
    renderPage()
    await userEvent.click(within(await usersTable()).getByRole("button", { name: "Dana Levi" }))
    const drawer = await screen.findByRole("dialog")
    await within(drawer).findByText("image-to-video")
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u) === "/v1/admin/lanes/config")).toBe(true))
    expect(within(drawer).queryByRole("heading", { name: "Lane override" })).not.toBeInTheDocument()
  })

  it("the drawer says when the lanes could not be read", async () => {
    serve({ user: userReport({ linesAvailable: false, lines: [] }) })
    renderPage()
    await userEvent.click(within(await usersTable()).getByRole("button", { name: "Dana Levi" }))
    const drawer = await screen.findByRole("dialog")
    expect(await within(drawer).findByText(/could not be read/)).toBeInTheDocument()
    expect(within(drawer).getByRole("table", { name: "Last 30 days" })).toBeInTheDocument()
  })

  it("measure-only banner and would-wait column show when enforcement is off", async () => {
    serve({ live: measureOnlyReport() })
    renderPage()
    const users = await usersTable()
    expect(screen.getByText(/Measure-only/)).toBeInTheDocument()
    expect(screen.getByText(/cannot be turned on in this release/)).toBeInTheDocument()
    expect(within(users).getByRole("columnheader", { name: "Would wait" })).toBeInTheDocument()
    expect(screen.getByText("would wait")).toBeInTheDocument()
    expect(within(users).getByText("5 would wait")).toBeInTheDocument()
    expect(screen.getByText(/may be missing/)).toBeInTheDocument()
    expect(screen.getByText(/mystery-job/)).toBeInTheDocument()
  })

  it("no measure-only banner or would-wait column when enforcement is on", async () => {
    serve({ live: enforcedReport() })
    renderPage()
    const users = await usersTable()
    expect(screen.queryByText(/Measure-only/)).not.toBeInTheDocument()
    expect(within(users).queryByRole("columnheader", { name: "Would wait" })).not.toBeInTheDocument()
  })

  it("the Last 30 days tab reads each view's history", async () => {
    serve()
    renderPage()
    await usersTable()
    await userEvent.click(screen.getByRole("button", { name: "Last 30 days" }))
    const users = await screen.findByRole("table", { name: "Users, last 30 days" })
    expect(within(users).getByText("Dana Levi")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Providers" }))
    const providers = await screen.findByRole("table", { name: "Providers, last 30 days" })
    expect(within(providers).getByText("kie")).toBeInTheDocument()
    expect(within(providers).getByText("71")).toBeInTheDocument()
    expect(screen.getByText(/newest rows only/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([u]) => String(u) === "/v1/admin/lanes/history?days=30&view=providers")).toBe(true)
  })
})
