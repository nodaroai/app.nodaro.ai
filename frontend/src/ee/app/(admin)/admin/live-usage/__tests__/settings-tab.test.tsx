/**
 * Admin → Live usage → Settings: each plan's sizes, the providers' ceilings
 * and the two waiting limits (shared by every environment on this database),
 * and this environment's switch with its preconditions. The switch asks before
 * it changes anything, and while limits cannot be turned on in this release it
 * is disabled and never offers to turn them on anyway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import type { LaneConfig } from "../types"
import { AT, answer, config, enforcedReport, lockedConfig, unmetConfig } from "./fixtures"

vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({ Authorization: "Bearer t" }) }))
vi.mock("@/lib/edition", () => ({ hasAdmin: () => true, hasCredits: () => true }))
const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }))

import { queryClient as appQueryClient } from "@/lib/query-client"
import AdminLiveUsagePage from "../page"

const fetchMock = vi.fn()

interface Serve {
  config?: LaneConfig
  /** What /live answers instead of a report. */
  liveStatus?: number
  /** What PUT /enforced answers (default: the switch as asked). */
  enforced?: (body: { on: boolean; confirmUnmet?: boolean }) => Promise<Response>
}

/** Every write the page sent: method, path and body. */
const writes = () =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
    .map(([url, init]) => ({ url: String(url), body: JSON.parse(String((init as RequestInit).body)) as unknown }))

function serve(s: Serve = {}) {
  let current = s.config ?? config(true)
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const u = String(url)
    const method = init?.method ?? "GET"
    if (u === "/v1/admin/lanes/live") {
      return s.liveStatus ? answer({ error: { code: "in_app_only", message: "Signed in to the app only" } }, s.liveStatus) : answer(enforcedReport())
    }
    if (u === "/v1/admin/lanes/config" && method === "GET") return answer(current)
    if (method === "PUT" && u === "/v1/admin/lanes/enforced") {
      const body = JSON.parse(String(init?.body)) as { on: boolean; confirmUnmet?: boolean }
      if (s.enforced) return s.enforced(body)
      current = { ...current, enforced: body.on }
      return answer({ enforced: body.on, env: current.env, woke: 0, mirrored: true })
    }
    if (method === "PUT" && u.startsWith("/v1/admin/lanes/plans/")) {
      const tier = u.slice("/v1/admin/lanes/plans/".length)
      const sizes = JSON.parse(String(init?.body)) as LaneConfig["plans"][string]
      current = { ...current, plans: { ...current.plans, [tier]: sizes } }
      return answer({ tier, sizes })
    }
    if (method === "PUT" && u.startsWith("/v1/admin/lanes/providers/")) {
      const provider = u.slice("/v1/admin/lanes/providers/".length)
      const { ceiling } = JSON.parse(String(init?.body)) as { ceiling: number | null }
      const rest = Object.fromEntries(Object.entries(current.providerCeilings).filter(([p]) => p !== provider))
      current = { ...current, providerCeilings: ceiling === null ? rest : { ...rest, [provider]: ceiling } }
      return answer({ provider, ceiling, applied: true })
    }
    if (method === "PUT" && u === "/v1/admin/lanes/settings") {
      const body = JSON.parse(String(init?.body)) as { queueTimeoutMinutes: number; liveWaitMinutes: number }
      current = { ...current, settings: { ...current.settings, ...body } }
      return answer({ settings: { ...body, liveWaitMaxMinutes: 60 } })
    }
    return answer({ error: { code: "not_found", message: `unexpected ${method} ${u}` } }, 404)
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
  localStorage.clear()
  toastError.mockReset()
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(AT).getTime() })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function renderPage() {
  return render(
    // The app's own defaults (a retry, an error toast on every mutation): the tab must hold under them.
    <QueryClientProvider client={new QueryClient({ defaultOptions: appQueryClient.getDefaultOptions() })}>
      <MemoryRouter>
        <AdminLiveUsagePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function openSettings() {
  await userEvent.click(await screen.findByRole("button", { name: "Settings" }))
  return screen.findByRole("region", { name: "Lane settings" })
}

const planTable = async () => screen.findByRole("table", { name: "Plan sizes" })
const planRow = async (tier: string) => within(await planTable()).getByRole("row", { name: new RegExp(`^${tier}\\b`, "i") })

describe("Live usage → Settings", () => {
  it("says the sizes, ceilings and limits are shared by every environment, while the switch is this environment's", async () => {
    serve()
    renderPage()
    const tab = await openSettings()
    expect(within(tab).getByText(/shared by every environment/)).toBeInTheDocument()
    expect(within(tab).getByText(/only for production/)).toBeInTheDocument()
    // The Users / Providers toggle means nothing here.
    expect(screen.queryByRole("group", { name: "View" })).not.toBeInTheDocument()
  })

  it("editing a plan cell sends the whole row to the plan's PUT", async () => {
    serve()
    renderPage()
    await openSettings()
    const row = await planRow("basic")
    const llm = within(row).getByRole("spinbutton", { name: "basic LLM" })
    await userEvent.clear(llm)
    await userEvent.type(llm, "10")
    await userEvent.click(within(row).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(writes()).toEqual([{ url: "/v1/admin/lanes/plans/basic", body: { provider: 4, llm: 10, local: 8, run: 4 } }]))
    expect(await within(await planRow("basic")).findByText("Saved.")).toBeInTheDocument()
  })

  it("range validation message: a size, the queue timeout and the live-wait limit outside their bounds cannot be saved", async () => {
    serve()
    renderPage()
    await openSettings()
    const row = await planRow("free")
    const provider = within(row).getByRole("spinbutton", { name: "free Provider" })
    await userEvent.clear(provider)
    await userEvent.type(provider, "600")
    expect(within(row).getByText("Provider: a whole number from 1 to 500.")).toBeInTheDocument()
    expect(within(row).getByRole("button", { name: "Save" })).toBeDisabled()

    const limits = screen.getByRole("group", { name: "Waiting limits" })
    const queue = within(limits).getByRole("spinbutton", { name: /Queue timeout/ })
    await userEvent.clear(queue)
    await userEvent.type(queue, "2")
    expect(within(limits).getByText("Queue timeout: a whole number of minutes from 5 to 1440.")).toBeInTheDocument()
    const live = within(limits).getByRole("spinbutton", { name: /Live-wait limit/ })
    await userEvent.clear(live)
    await userEvent.type(live, "61")
    // The maximum is the server's (liveWaitMaxMinutes), not a copy.
    expect(within(limits).getByText("Live-wait limit: a whole number of minutes from 1 to 60.")).toBeInTheDocument()
    expect(within(limits).getByRole("button", { name: "Save limits" })).toBeDisabled()
    expect(writes()).toEqual([])
  })

  it("saves both waiting limits together", async () => {
    serve()
    renderPage()
    await openSettings()
    const limits = screen.getByRole("group", { name: "Waiting limits" })
    const queue = within(limits).getByRole("spinbutton", { name: /Queue timeout/ })
    await userEvent.clear(queue)
    await userEvent.type(queue, "90")
    await userEvent.click(within(limits).getByRole("button", { name: "Save limits" }))
    await waitFor(() => expect(writes()).toEqual([{ url: "/v1/admin/lanes/settings", body: { queueTimeoutMinutes: 90, liveWaitMinutes: 10 } }]))
  })

  it("sets, adds and removes a provider ceiling", async () => {
    serve()
    renderPage()
    await openSettings()
    const ceilings = await screen.findByRole("table", { name: "Provider ceilings" })
    const kie = within(ceilings).getByRole("spinbutton", { name: "kie ceiling" })
    await userEvent.clear(kie)
    await userEvent.type(kie, "80")
    await userEvent.click(within(within(ceilings).getByRole("row", { name: /^kie/ })).getByRole("button", { name: "Save" }))
    await waitFor(() => expect(writes()).toContainEqual({ url: "/v1/admin/lanes/providers/kie", body: { ceiling: 80 } }))

    await userEvent.type(screen.getByRole("textbox", { name: "New provider" }), "replicate")
    await userEvent.type(screen.getByRole("spinbutton", { name: "New provider ceiling" }), "20")
    await userEvent.click(screen.getByRole("button", { name: "Add ceiling" }))
    await waitFor(() => expect(writes()).toContainEqual({ url: "/v1/admin/lanes/providers/replicate", body: { ceiling: 20 } }))

    const removed = () => writes().some((w) => w.url === "/v1/admin/lanes/providers/kie" && (w.body as { ceiling: unknown }).ceiling === null)
    const kieRow = () => within(within(screen.getByRole("table", { name: "Provider ceilings" })).getByRole("row", { name: /^kie/ }))
    // Remove asks first, with focus on the button that changes nothing; dismissing it removes nothing.
    await userEvent.click(kieRow().getByRole("button", { name: "Remove" }))
    let ask = screen.getByRole("alertdialog", { name: "Remove the kie ceiling?" })
    expect(within(ask).getByRole("button", { name: "Keep ceiling" })).toHaveFocus()
    await userEvent.click(within(ask).getByRole("button", { name: "Keep ceiling" }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(removed()).toBe(false)
    await userEvent.click(kieRow().getByRole("button", { name: "Remove" }))
    ask = screen.getByRole("alertdialog", { name: "Remove the kie ceiling?" })
    await userEvent.click(within(ask).getByRole("button", { name: "Remove ceiling" }))
    await waitFor(() => expect(removed()).toBe(true))
  })

  it("is read-only when editable:false: the env sizes, no inputs, no saves", async () => {
    serve({ config: config(false) })
    renderPage()
    const tab = await openSettings()
    expect(within(tab).getByText(/set by the server's environment/)).toBeInTheDocument()
    // No plans here, so nothing is shared through the database; only the switch is per environment.
    expect(within(tab).queryByText(/shared by every environment/)).not.toBeInTheDocument()
    expect(within(tab).getByText(/come from each server's environment variables/)).toBeInTheDocument()
    expect(within(tab).queryByRole("spinbutton")).not.toBeInTheDocument()
    expect(within(tab).queryByRole("button", { name: /Save/ })).not.toBeInTheDocument()
    const row = within(await planTable()).getByRole("row", { name: /^Every line/ })
    expect(within(row).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Every line", "12", "24", "24", "12"])
  })

  it("shows the Settings tab when /live is refused", async () => {
    serve({ liveStatus: 403 })
    renderPage()
    expect(await openSettings()).toBeInTheDocument()
  })
})

describe("Live usage → the switch", () => {
  const switchFor = () => screen.getByRole("switch", { name: /Concurrency limits/ })

  it("in this release it is disabled, says limits cannot be turned on, still lists every precondition, and never offers to turn them on anyway", async () => {
    serve({ config: lockedConfig() })
    renderPage()
    const tab = await openSettings()
    expect(switchFor()).toBeDisabled()
    expect(within(tab).getByText("Not available yet — limits can't be turned on in this release.")).toBeInTheDocument()
    const list = within(tab).getByRole("list", { name: "Preconditions" })
    expect(within(list).getByText("Lane columns are in this database")).toBeInTheDocument()
    expect(within(list).getByText("Every plugin job type declares its lane (2 undeclared)")).toBeInTheDocument()
    expect(within(list).getByText("The live-wait ceiling has been measured")).toBeInTheDocument()
    expect(within(list).getByText("At least 7 days of measure-only data")).toBeInTheDocument()
    expect(within(list).getByText(/3 days so far/)).toBeInTheDocument()
    await userEvent.click(switchFor())
    expect(screen.queryByRole("button", { name: "Turn on anyway" })).not.toBeInTheDocument()
    expect(writes()).toEqual([])
  })

  it("the switch lists unmet preconditions and needs confirmation", async () => {
    serve({ config: unmetConfig() })
    renderPage()
    const tab = await openSettings()
    expect(within(tab).getByText("Turning this on makes jobs wait for a free slot instead of starting at once. Check every item below first.")).toBeInTheDocument()
    const list = within(tab).getByRole("list", { name: "Preconditions" })
    expect(within(list).getByText("Every plugin job type declares its lane (1 undeclared)").closest("li")).toHaveAttribute("data-met", "false")
    expect(within(list).getByText("Lane columns are in this database").closest("li")).toHaveAttribute("data-met", "true")
    await userEvent.click(switchFor())
    const confirm = screen.getByRole("alertdialog", { name: "Turn concurrency limits on?" })
    expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus()
    expect(within(confirm).getByText(/2 items below are not met/)).toBeInTheDocument()
    expect(within(confirm).queryByRole("button", { name: "Turn on" })).not.toBeInTheDocument()
    expect(writes()).toEqual([])
    await userEvent.click(within(confirm).getByRole("button", { name: "Turn on anyway" }))
    await waitFor(() => expect(writes()).toEqual([{ url: "/v1/admin/lanes/enforced", body: { on: true, confirmUnmet: true } }]))
    await waitFor(() => expect(switchFor()).toBeChecked())
  })

  it("with every item met it still asks once before turning limits on", async () => {
    serve({ config: config(true, { enforced: false }) })
    renderPage()
    await openSettings()
    await userEvent.click(switchFor())
    const confirm = screen.getByRole("alertdialog", { name: "Turn concurrency limits on?" })
    expect(within(confirm).queryByRole("button", { name: "Turn on anyway" })).not.toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole("button", { name: "Turn on" }))
    await waitFor(() => expect(writes()).toEqual([{ url: "/v1/admin/lanes/enforced", body: { on: true } }]))
  })

  it("turning off asks for confirmation", async () => {
    serve({ config: config(true, { enforced: true }) })
    renderPage()
    await openSettings()
    expect(switchFor()).toBeChecked()
    await userEvent.click(switchFor())
    const confirm = screen.getByRole("alertdialog", { name: "Turn concurrency limits off?" })
    expect(within(confirm).getByText("Turning this off starts every waiting job now.")).toBeInTheDocument()
    expect(writes()).toEqual([])
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(writes()).toEqual([])
    await userEvent.click(switchFor())
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Turn off" }))
    await waitFor(() => expect(writes()).toEqual([{ url: "/v1/admin/lanes/enforced", body: { on: false } }]))
    await waitFor(() => expect(switchFor()).not.toBeChecked())
  })

  it("the plugin item says when plugins failed to load in this process", async () => {
    serve({ config: unmetConfig({ pluginLoadFailed: true, undeclaredPluginTypes: [] }) })
    renderPage()
    const list = within(await openSettings()).getByRole("list", { name: "Preconditions" })
    expect(within(list).getByText(/plugins failed to load in this process/)).toBeInTheDocument()
    // No count while unread: "0 undeclared" would read as "none".
    expect(within(list).getByText("Every plugin job type declares its lane (not checked)")).toBeInTheDocument()
    expect(within(list).queryByText(/0 undeclared/)).not.toBeInTheDocument()
  })

  it("the plugin item carries no count before the plugins were read in this process", async () => {
    serve({ config: unmetConfig({ pluginTypesKnown: false, undeclaredPluginTypes: [] }) })
    renderPage()
    const list = within(await openSettings()).getByRole("list", { name: "Preconditions" })
    expect(within(list).getByText("Every plugin job type declares its lane (not checked)")).toBeInTheDocument()
    expect(within(list).getByText("Not checked yet in this process.")).toBeInTheDocument()
  })

  it("a refusal from the server shows beside the switch, never as a toast", async () => {
    serve({
      config: config(true, { enforced: false }),
      enforced: () => answer({ error: { code: "preconditions_unmet", message: "Some preconditions are not met; confirm to turn lanes on anyway." }, unmet: ["measureDays"] }, 409),
    })
    renderPage()
    const tab = await openSettings()
    await userEvent.click(switchFor())
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Turn on" }))
    expect(await within(tab).findByText(/Some preconditions are not met/)).toBeInTheDocument()
    expect(switchFor()).not.toBeChecked()
    expect(toastError).not.toHaveBeenCalled()
  })
})
