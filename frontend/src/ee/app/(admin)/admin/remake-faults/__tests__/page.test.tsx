/**
 * Admin → Remake faults: the range's faulted Video Remake runs, newest first,
 * filtered and paged.
 *
 * - The first request: the last seven local days, no filter, 50 a page.
 * - A row: when, who (address, else the id's start), engine, resolution,
 *   status, the faults as chips worst first (an override's intent code
 *   beside its kind), and a link to the job's page.
 * - Severity, kind (from the range's kinds) and engine ask again from the
 *   first page; Next asks for the next one.
 * - The 503 while the database lacks the function is said in the server's
 *   own sentence and asked once.
 * - A range of more than 30 days asks for nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"

const h = vi.hoisted(() => {
  class FakeRemakeFaultsApiError extends Error {
    readonly code: string
    readonly status: number
    constructor(code: string, message: string, status: number) {
      super(message)
      this.name = "RemakeFaultsApiError"
      this.code = code
      this.status = status
    }
  }
  return { FakeRemakeFaultsApiError, fetchRemakeFaults: vi.fn() }
})

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("@/ee/lib/remake-faults-api", () => ({
  RemakeFaultsApiError: h.FakeRemakeFaultsApiError,
  fetchRemakeFaults: h.fetchRemakeFaults,
}))

import type { RemakeFaultList, RemakeFaultRun } from "@/ee/lib/remake-faults-api"
import { defaultRange, rangeToIso } from "../../motion-price-check/format"
import AdminRemakeFaults from "../page"

const USER_ID = "00000000-0000-4000-8000-000000000100"
const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

function run(over: Partial<RemakeFaultRun> = {}): RemakeFaultRun {
  return {
    id: idOf(1),
    createdAt: new Date(2026, 10, 20, 9, 5).toISOString(),
    userId: USER_ID,
    email: "ops@nodaro.example",
    jobType: "cast-swap",
    status: "failed",
    fullQuality: false,
    engine: "prism",
    resolution: "720p",
    draft: false,
    worst: "blocked",
    faults: [
      { kind: "unblurred_refused", severity: "blocked", at: "2026-11-20T09:05:03Z" },
      { kind: "intent_override", severity: "recovered", at: "2026-11-20T09:05:01Z", detail: { code: "no_person" } },
      { kind: "face_check_unsure", severity: "warning" },
    ],
    ...over,
  }
}

const LIST: RemakeFaultList = {
  total: 120,
  kinds: ["face_check_unsure", "intent_override", "unblurred_refused"],
  runs: [run(), run({ id: idOf(2), email: null, engine: "pulse", fullQuality: true, status: "completed", worst: "warning", faults: [{ kind: "blur_left", severity: "warning" }] })],
}

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminRemakeFaults />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const calls = () => h.fetchRemakeFaults.mock.calls.map((c) => c[0] as Record<string, unknown>)
const lastCall = () => calls().at(-1)!
const table = () => screen.findByRole("table", { name: "Faulted runs" })

beforeEach(() => {
  h.fetchRemakeFaults.mockReset()
  h.fetchRemakeFaults.mockResolvedValue(LIST)
})

describe("Admin → Remake faults", () => {
  it("asks for the last seven local days, no filter, 50 a page", async () => {
    renderPage()
    await table()
    const { fromDay, toDay } = defaultRange(new Date())
    expect(calls()[0]).toEqual({ ...rangeToIso(fromDay, toDay), offset: 0, limit: 50 })
  })

  it("shows each run's who, engine, status, faults worst first and a link to its job page", async () => {
    renderPage()
    const rows = within(await table()).getAllByRole("row").slice(1)
    expect(rows).toHaveLength(2)
    const first = within(rows[0]!)
    first.getByText("ops@nodaro.example")
    first.getByText("Prism")
    first.getByText("failed")
    const chips = within(first.getByRole("list", { name: "Faults" })).getAllByRole("listitem")
    expect(chips.map((c) => c.getAttribute("data-fault-severity"))).toEqual(["blocked", "recovered", "warning"])
    expect(chips.map((c) => c.textContent)).toEqual(["Blockedunblurred_refused", "Recoveredintent_override: no_person", "Warningface_check_unsure"])
    expect(first.getByRole("link", { name: "Open the job page in a new tab" }).getAttribute("href")).toContain(idOf(1))
    const second = within(rows[1]!)
    second.getByText("00000000…")
    second.getByText("Pulse")
    second.getByText("Full Quality")
    expect(screen.getByText("1–50 of 120")).toBeTruthy()
  })

  it("each filter asks again from the first page; Next asks for the next one", async () => {
    const user = userEvent.setup()
    renderPage()
    await table()
    await user.click(screen.getByRole("button", { name: "Next" }))
    await waitFor(() => expect(lastCall()).toMatchObject({ offset: 50 }))

    await user.selectOptions(screen.getByLabelText("Severity"), "recovered")
    await waitFor(() => expect(lastCall()).toMatchObject({ severity: "recovered", offset: 0 }))

    const kind = screen.getByLabelText("Kind") as HTMLSelectElement
    expect([...kind.options].map((o) => o.value)).toEqual(["", "face_check_unsure", "intent_override", "unblurred_refused"])
    await user.selectOptions(kind, "intent_override")
    await waitFor(() => expect(lastCall()).toMatchObject({ severity: "recovered", kind: "intent_override", offset: 0 }))

    await user.selectOptions(screen.getByLabelText("Engine"), "pulse")
    await waitFor(() => expect(lastCall()).toMatchObject({ engine: "pulse", kind: "intent_override", offset: 0 }))

    await user.selectOptions(screen.getByLabelText("Severity"), "all")
    await waitFor(() => expect(lastCall()).not.toHaveProperty("severity"))
  })

  it("an empty page says so", async () => {
    h.fetchRemakeFaults.mockResolvedValue({ total: 0, kinds: [], runs: [] })
    renderPage()
    expect(await screen.findByText("No Video Remake run recorded a fault matching these filters.")).toBeTruthy()
  })

  it("says the server's own sentence for the 503, and asks once", async () => {
    const sentence = "Video Remake faults need the database update that ships with the next production release."
    h.fetchRemakeFaults.mockRejectedValue(new h.FakeRemakeFaultsApiError("remake_faults_unavailable", sentence, 503))
    renderPage(new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0 } } }))
    expect(await screen.findByText(sentence)).toBeTruthy()
    await new Promise((r) => setTimeout(r, 30))
    expect(h.fetchRemakeFaults).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("table", { name: "Faulted runs" })).toBeNull()
  })

  it("a range longer than 30 days asks for nothing", async () => {
    renderPage()
    await table()
    const before = h.fetchRemakeFaults.mock.calls.length
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2020-01-01" } })
    expect(await screen.findByText("Pick 30 days or fewer")).toBeTruthy()
    expect(h.fetchRemakeFaults.mock.calls.length).toBe(before)
    expect(screen.queryByRole("table", { name: "Faulted runs" })).toBeNull()
  })
})
