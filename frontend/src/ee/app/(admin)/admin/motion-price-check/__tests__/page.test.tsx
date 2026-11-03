/**
 * Admin → Motion price check: every Nodaro Motion run of a range, filtered,
 * sorted and paged, with the totals over the filtered runs, and KIE's own
 * figures read once with a pasted dashboard token.
 *
 * - The first request: the last seven local days, worst margin first, 50 a
 *   page, no flag filter, no KIE figures.
 * - A filter asks again from the first page; Next asks for the next one.
 * - A run still in flight reads "In progress" under Taken and Margin and
 *   never shows a flag.
 * - KIE: Fetch waits for a token; the result asks for the runs again with
 *   its map and reads "N of M tasks matched" (and, past the map's cap, how
 *   many were applied); a new range drops it.
 * - Loading, updating and the KIE fetch are said in live regions; every
 *   control is a 44 px target; the totals list resolutions by number.
 * - The 503 while the database lacks the functions is said in the server's
 *   own sentence and asked once.
 * - A range of more than 30 days asks for nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => {
  class FakeMotionPriceApiError extends Error {
    readonly code: string
    readonly status: number
    constructor(code: string, message: string, status: number) {
      super(message)
      this.name = "MotionPriceApiError"
      this.code = code
      this.status = status
    }
  }
  return {
    FakeMotionPriceApiError,
    fetchMotionPriceRuns: vi.fn(),
    fetchMotionPriceRun: vi.fn(),
    fetchKieReal: vi.fn(),
  }
})

vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("@/ee/lib/motion-price-check-api", () => ({
  MotionPriceApiError: h.FakeMotionPriceApiError,
  fetchMotionPriceRuns: h.fetchMotionPriceRuns,
  fetchMotionPriceRun: h.fetchMotionPriceRun,
  fetchKieReal: h.fetchKieReal,
}))

import type { KieRealResult, MotionPriceList, MotionPriceRun, MotionPriceTotal } from "@/ee/lib/motion-price-check-api"
import { rangeToIso } from "../format"
import AdminMotionPriceCheck from "../page"

const USER_ID = "00000000-0000-4000-8000-000000000100"
const idOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const NO_FLAGS = { paidAboveTaken: false, missingCost: false, aboveQuote: false }

function run(over: Partial<MotionPriceRun> = {}): MotionPriceRun {
  return {
    id: idOf(1),
    createdAt: new Date(2026, 10, 2, 9, 5).toISOString(),
    userId: USER_ID,
    email: "ops@nodaro.example",
    status: "completed",
    fullQuality: false,
    draftJobId: null,
    kind: "trend",
    trendName: "Office dance",
    engine: "prism",
    style: "precise",
    resolution: "720p",
    draft: false,
    lengthSec: 12.4,
    held: 1200,
    taken: 1063,
    settled: true,
    takenUsd: 21.26,
    recordedUsd: 12.5,
    kieUsd: null,
    paidUsd: 12.5,
    marginUsd: 8.76,
    marginPct: 41.2041,
    steps: 9,
    stepsWithoutCost: 0,
    quoteTotal: 1200,
    quoteAllowed: 1200,
    flags: NO_FLAGS,
    ...over,
  }
}

const SETTLED = run()
const PAID_ABOVE = run({
  id: idOf(2),
  trendName: "Beach walk",
  resolution: "480p",
  draft: true,
  taken: 14,
  takenUsd: 0.28,
  paidUsd: 5,
  marginUsd: -4.72,
  marginPct: -1685.7143,
  flags: { ...NO_FLAGS, paidAboveTaken: true },
})
const NO_COST = run({
  id: idOf(3),
  kind: "hand",
  trendName: null,
  engine: "pulse",
  email: null,
  stepsWithoutCost: 1,
  flags: { ...NO_FLAGS, missingCost: true },
})
const ABOVE_QUOTE = run({
  id: idOf(4),
  trendName: "Rooftop",
  fullQuality: true,
  draftJobId: idOf(9),
  resolution: "1080p",
  taken: 1300,
  // An extra ran: the allowance is above the hold, and the badge names the allowance.
  quoteTotal: 1100,
  quoteAllowed: 1200,
  stepsWithoutCost: 3,
  flags: { ...NO_FLAGS, missingCost: true, aboveQuote: true },
})
// Its flags are set on purpose: whatever an answer says, a run in flight shows none.
const IN_FLIGHT = run({
  id: idOf(5),
  trendName: "Night drive",
  status: "processing",
  settled: false,
  taken: 240,
  takenUsd: 4.8,
  paidUsd: 1.2,
  marginUsd: null,
  marginPct: null,
  flags: { paidAboveTaken: true, missingCost: true, aboveQuote: true },
})

const figures = (over: Partial<MotionPriceTotal>): MotionPriceTotal => ({
  dimension: "all",
  value: null,
  runs: 1,
  unsettled: 0,
  held: 1200,
  taken: 1063,
  takenUsd: 21.26,
  paidUsd: 12.5,
  marginUsd: 8.76,
  marginPct: 41.2041,
  ...over,
})
const TOTALS: MotionPriceTotal[] = [
  figures({ runs: 5, unsettled: 1, held: 4800, taken: 3440, takenUsd: 68.8, paidUsd: 40.1, marginUsd: 28.7, marginPct: 41.7151 }),
  figures({ dimension: "engine", value: "prism", runs: 4, unsettled: 1 }),
  figures({ dimension: "engine", value: "pulse" }),
  // The SQL orders a group's values as text: 1080p comes before 480p.
  figures({ dimension: "resolution", value: "1080p" }),
  figures({ dimension: "resolution", value: "480p" }),
  figures({ dimension: "resolution", value: "720p", runs: 3, unsettled: 1 }),
  // A group with no settled run sums to nothing.
  figures({ dimension: "style", value: "flex", unsettled: 1, held: null, taken: null, takenUsd: null, paidUsd: null, marginUsd: null, marginPct: null }),
  figures({ dimension: "style", value: "precise", runs: 4 }),
]
const LIST: MotionPriceList = {
  total: 312,
  runs: [PAID_ABOVE, NO_COST, ABOVE_QUOTE, SETTLED, IN_FLIGHT],
  totals: TOTALS,
  kieApplied: false,
}
const KIE: KieRealResult = {
  kieUsd: { "task-a": 0.42, "task-b": 1.1 },
  window: { from: rangeToIso("2026-10-28", "2026-11-03").from, to: new Date(2026, 10, 3, 12).toISOString() },
  motionTasks: 340,
  matched: 312,
  truncated: false,
  kieRecords: 5210,
  capped: ["generic"],
  errors: { "veo-generate": "401 — session token expired" },
  fetchedAt: new Date(2026, 10, 3, 12, 0).toISOString(),
}
const TOKEN = "kie-session-token"
const UNAVAILABLE = "Motion price check needs the database update that ships with the next production release."
const NOT_FETCHED = "Not fetched — paid shows recorded costs"

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <AdminMotionPriceCheck />
    </QueryClientProvider>,
  )
}

const listCalls = () => h.fetchMotionPriceRuns.mock.calls as [Record<string, unknown>, Record<string, number> | undefined][]
const lastParams = () => listCalls().at(-1)![0]
const runsTable = () => screen.findByRole("table", { name: "Runs" })
const totalsRegion = () => screen.findByRole("region", { name: "Totals" })
const tokens = (el: Element) => el.className.split(/\s+/)
const rowOfRun = (name: string) => screen.getByRole("button", { name }).closest("tr")!
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent)
const totalsRow = (table: HTMLElement, name: string) => within(table).getByRole("rowheader", { name }).closest("tr")!
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(2026, 10, 3, 12))
  h.fetchMotionPriceRuns.mockResolvedValue(LIST)
  h.fetchKieReal.mockResolvedValue(KIE)
  // A run's drawer stays on its loading line here; run-drawer.test.tsx reads what it shows.
  h.fetchMotionPriceRun.mockReturnValue(new Promise(() => undefined))
})
afterEach(() => {
  vi.useRealTimers()
})

describe("Admin → Motion price check", () => {
  it("asks for the last seven days, worst margin first, 50 a page, without KIE's figures", async () => {
    renderPage()
    await waitFor(() => expect(h.fetchMotionPriceRuns).toHaveBeenCalledTimes(1))
    const [params, kieUsd] = listCalls()[0]!
    expect(params).toStrictEqual({
      ...rangeToIso("2026-10-28", "2026-11-03"),
      flaggedOnly: false,
      sort: "margin_usd",
      dir: "asc",
      offset: 0,
      limit: 50,
    })
    expect(kieUsd).toBeUndefined()
    expect(screen.getByRole("heading", { level: 1, name: "Motion price check" })).toBeInTheDocument()
    expect(
      screen.getByText("Each Nodaro Motion run: what it held, what it took, what that is worth, and what we paid for its steps."),
    ).toBeInTheDocument()
  })

  it("reads the filters From, To, Engine, Style, Kind, Resolution, Flagged only, Sort, then the direction", async () => {
    renderPage()
    await runsTable()
    const controls = [
      screen.getByLabelText("From"),
      screen.getByLabelText("To"),
      screen.getByLabelText("Engine"),
      screen.getByLabelText("Style"),
      screen.getByLabelText("Kind"),
      screen.getByLabelText("Resolution"),
      screen.getByLabelText("Flagged only"),
      screen.getByLabelText("Sort"),
      screen.getByRole("button", { name: "Ascending" }),
    ]
    controls.slice(1).forEach((control, i) => {
      expect(controls[i]!.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })
    expect(screen.getByLabelText("From")).toHaveValue("2026-10-28")
    expect(screen.getByLabelText("To")).toHaveValue("2026-11-03")
  })

  it("shows the totals: All, then each engine, resolution (by number) and style", async () => {
    renderPage()
    const table = within(await totalsRegion()).getByRole("table")
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Group",
      "Runs (unsettled)",
      "Held",
      "Taken",
      "Taken $",
      "Paid $",
      "Margin $",
      "Margin %",
    ])
    expect(within(table).getAllByRole("rowheader").map((c) => c.textContent)).toEqual([
      "All",
      "Engine Prism",
      "Engine Pulse",
      "Resolution 480p (draft)",
      "Resolution 720p",
      "Resolution 1080p",
      "Style Flex",
      "Style Precise",
    ])
    expect(cellsOf(totalsRow(table, "All"))).toEqual(["5 (1)", "4,800", "3,440", "$68.80", "$40.10", "$28.70", "41.7%"])
    expect(cellsOf(totalsRow(table, "Style Flex"))).toEqual(["1 (1)", "—", "—", "—", "—", "—", "—"])
  })

  it("keeps the totals in a scroll box a keyboard can scroll: focusable, and named by its heading alone", async () => {
    renderPage()
    const region = await totalsRegion()
    const table = within(region).getByRole("table")
    expect(table.parentElement).toBe(region)
    expect(region).toHaveAttribute("tabindex", "0")
    expect(region.getAttribute("aria-labelledby")).toBe(screen.getByRole("heading", { level: 2, name: "Totals" }).id)
    expect(tokens(region)).toEqual(expect.arrayContaining(["overflow-x-auto", "focus-visible:ring-2"]))
    expect(table).not.toHaveAttribute("aria-label")
  })

  it("shows each run with its figures and its flags", async () => {
    renderPage()
    const table = await runsTable()
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "When",
      "Who",
      "Run",
      "Engine",
      "Resolution",
      "Clip (s)",
      "Held",
      "Taken",
      "Taken $",
      "Paid $",
      "Margin $",
      "Margin %",
      "Flags",
    ])
    // The API's order, kept.
    expect(within(table).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Beach walk",
      "Hand",
      "Rooftop Full Quality",
      "Office dance",
      "Night drive",
    ])
    expect(cellsOf(rowOfRun("Office dance"))).toEqual([
      "2026-11-02 09:05",
      "ops@nodaro.example",
      "Office dance",
      "Prism",
      "720p",
      "12.4",
      "1,200",
      "1,063",
      "$21.26",
      "$12.50",
      "$8.76",
      "41.2%",
      "",
    ])

    const paidAbove = rowOfRun("Beach walk")
    expect(within(paidAbove).getByText("480p (draft)")).toBeInTheDocument()
    expect(within(paidAbove).getByText("-$4.72")).toBeInTheDocument()
    expect(within(paidAbove).getByText("-1,685.7%")).toBeInTheDocument()
    expect(within(paidAbove).getByText("Paid > taken")).toBeInTheDocument()

    const noCost = rowOfRun("Hand")
    expect(within(noCost).getByText("No cost: 1 step")).toBeInTheDocument()
    expect(within(noCost).getByText("Pulse")).toBeInTheDocument()
    // No email: the account's id, shortened, the whole id in its title.
    expect(within(noCost).getByTitle(USER_ID)).toHaveTextContent("00000000…")

    const aboveQuote = rowOfRun("Rooftop Full Quality")
    expect(within(aboveQuote).getByText("Full Quality")).toBeInTheDocument()
    // Its reason is on screen, so a tap reads it as a hover does.
    expect(within(aboveQuote).getByText("Above quote")).not.toHaveAttribute("title")
    expect(within(aboveQuote).getByText("taken 1,300 > allowed 1,200")).toBeVisible()
    expect(within(aboveQuote).getByText("No cost: 3 steps")).toBeInTheDocument()
    expect(within(aboveQuote).queryByText("Paid > taken")).toBeNull()
  })

  it("unsettled run reads In progress", async () => {
    renderPage()
    await runsTable()
    const row = rowOfRun("Night drive")
    const cells = within(row).getAllByRole("cell")
    // Taken is the running total so far; the margin is not known yet.
    expect(within(cells[7]!).getByText("240")).toBeInTheDocument()
    expect(within(cells[7]!).getByText("In progress")).toBeInTheDocument()
    expect(within(cells[10]!).getByText("—")).toBeInTheDocument()
    expect(within(cells[10]!).getByText("In progress")).toBeInTheDocument()
    expect(cells[11]).toHaveTextContent(/^—$/)
    // Never a flag while in flight.
    expect(cells[12]).toHaveTextContent(/^$/)
  })

  it("a filter asks again from the first page; Next and Prev page through", async () => {
    const user = userEvent.setup()
    renderPage()
    await runsTable()
    expect(screen.getByText("1–50 of 312")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Prev" })).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Next" }))
    await waitFor(() => expect(lastParams()).toMatchObject({ offset: 50 }))
    expect(screen.getByText("51–100 of 312")).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText("Engine"), "pulse")
    await waitFor(() => expect(lastParams()).toMatchObject({ engine: "pulse", offset: 0 }))
    expect(screen.getByText("1–50 of 312")).toBeInTheDocument()

    await user.click(screen.getByLabelText("Flagged only"))
    await waitFor(() => expect(lastParams()).toMatchObject({ engine: "pulse", flaggedOnly: true, offset: 0 }))

    await user.selectOptions(screen.getByLabelText("Style"), "flex")
    await user.selectOptions(screen.getByLabelText("Kind"), "hand")
    await user.selectOptions(screen.getByLabelText("Resolution"), "480p")
    await waitFor(() =>
      expect(lastParams()).toMatchObject({ engine: "pulse", style: "flex", kind: "hand", resolution: "480p", offset: 0 }),
    )

    // Back to all: the key goes, never "all".
    await user.selectOptions(screen.getByLabelText("Engine"), "all")
    await waitFor(() => expect(lastParams()).not.toHaveProperty("engine"))

    await user.click(screen.getByRole("button", { name: "Next" }))
    await waitFor(() => expect(lastParams()).toMatchObject({ offset: 50 }))
    await user.click(screen.getByRole("button", { name: "Prev" }))
    await waitFor(() => expect(lastParams()).toMatchObject({ offset: 0 }))
  })

  it("Next stops at the last page", async () => {
    const user = userEvent.setup()
    h.fetchMotionPriceRuns.mockResolvedValue({ ...LIST, total: 60 })
    renderPage()
    await runsTable()
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(await screen.findByText("51–60 of 60")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled()
  })

  it("a new sort takes its own direction, and the toggle flips it", async () => {
    const user = userEvent.setup()
    renderPage()
    await runsTable()
    // The figures we pay are read biggest first, the margins worst first, as the API's own defaults.
    await user.selectOptions(screen.getByLabelText("Sort"), "paid_usd")
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: "paid_usd", dir: "desc", offset: 0 }))
    await user.click(screen.getByRole("button", { name: "Descending" }))
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: "paid_usd", dir: "asc", offset: 0 }))
    await user.selectOptions(screen.getByLabelText("Sort"), "margin_pct")
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: "margin_pct", dir: "asc" }))
  })

  it("opens a run's drawer from a real button, and marks its row while it is open", async () => {
    const user = userEvent.setup()
    renderPage()
    await runsTable()
    const open = screen.getByRole("button", { name: "Office dance" })
    // Read before the drawer opens: the modal hides the page from the accessibility tree.
    const other = rowOfRun("Beach walk")
    expect(open.tagName).toBe("BUTTON")
    expect(open.closest("tr")).not.toHaveAttribute("aria-current")
    await user.click(open)
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    expect(h.fetchMotionPriceRun).toHaveBeenCalledWith(idOf(1), undefined)
    expect(open.closest("tr")).toHaveAttribute("aria-current", "true")
    expect(other).not.toHaveAttribute("aria-current")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(open.closest("tr")).not.toHaveAttribute("aria-current")
  })

  it("a run's button: its name alone is underlined, a real space before the badge, its focus ring inside it", async () => {
    renderPage()
    await runsTable()
    const button = screen.getByRole("button", { name: "Rooftop Full Quality" })
    const classes = (el: Element) => el.className.split(/\s+/)
    // An inline box, not a flex one: the space between the name and the badge is drawn, and the badge is out of the underline's reach.
    expect(classes(button)).toEqual(expect.arrayContaining(["inline-block", "py-3", "min-h-11", "min-w-11", "focus-visible:ring-inset"]))
    expect(classes(button)).not.toContain("inline-flex")
    expect(classes(button)).not.toContain("hover:underline")
    expect(classes(within(button).getByText("Rooftop"))).toContain("group-hover:underline")
    expect(classes(within(button).getByText("Full Quality"))).not.toContain("group-hover:underline")
    expect([...button.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent === " ")).toBe(true)
    // The drawer finds its opener by the run's id.
    expect(button).toHaveAttribute("data-run-open", idOf(4))
  })

  it("says so when the range has no run", async () => {
    h.fetchMotionPriceRuns.mockResolvedValue({ ...LIST, total: 0, runs: [], totals: [figures({ runs: 0, held: null, taken: null, takenUsd: null, paidUsd: null, marginUsd: null, marginPct: null })] })
    renderPage()
    expect(await screen.findByText("No Motion runs match these filters.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull()
  })

  it("every control is a 44 px target", async () => {
    renderPage()
    const table = await runsTable()
    const heightTarget = /(^|\s)(h-11|min-h-11|size-11)(\s|$)/
    const widthTarget = /(^|\s)(min-w-11|w-full|size-11)(\s|$)/
    const controls = [...document.querySelectorAll<HTMLElement>("button, select, input:not([type=checkbox])")]
    // The filters, the token, Fetch, the direction, each run's button, Prev and Next.
    expect(controls.length).toBeGreaterThanOrEqual(5 + 2 + 2 + 5 + 2)
    controls.forEach((el) => {
      const name = el.getAttribute("aria-label") ?? el.textContent ?? el.tagName
      expect(el.className, name).toMatch(heightTarget)
    })
    // The checkbox's hit area is its whole label row.
    const flagged = screen.getByLabelText("Flagged only")
    expect(flagged.closest("label")?.className).toMatch(/(^|\s)min-h-11(\s|$)/)
    // A run's name can be one short word ("Hand"), and Prev and Next are short words too.
    const short = [...within(table).getAllByRole("button"), screen.getByRole("button", { name: "Prev" }), screen.getByRole("button", { name: "Next" })]
    for (const button of short) expect(button.className, button.textContent ?? "").toMatch(widthTarget)
  })

  it("says Loading runs… and Updating… in one live region that stays on the page", async () => {
    const user = userEvent.setup()
    let first: (list: MotionPriceList) => void = () => undefined
    h.fetchMotionPriceRuns.mockReturnValueOnce(new Promise<MotionPriceList>((resolve) => (first = resolve)))
    renderPage()
    const region = (await screen.findByText("Loading runs…")).closest('[role="status"]')
    expect(region).not.toBeNull()
    first(LIST)
    await runsTable()
    await waitFor(() => expect(region).toHaveTextContent(/^$/))

    // A new page: the rows stay while it loads, and the same region says so.
    let next: (list: MotionPriceList) => void = () => undefined
    h.fetchMotionPriceRuns.mockReturnValueOnce(new Promise<MotionPriceList>((resolve) => (next = resolve)))
    await user.click(screen.getByRole("button", { name: "Next" }))
    await waitFor(() => expect(region).toHaveTextContent("Updating…"))
    expect(screen.getByRole("table", { name: "Runs" })).toBeInTheDocument()
    next(LIST)
    await waitFor(() => expect(region).toHaveTextContent(/^$/))
    expect(region).toBeInTheDocument()
  })

  describe("KIE real costs", () => {
    it("Fetch waits for a token", async () => {
      const user = userEvent.setup()
      renderPage()
      await runsTable()
      const fetchButton = screen.getByRole("button", { name: "Fetch KIE real costs" })
      expect(fetchButton).toBeDisabled()
      expect(screen.getByText(NOT_FETCHED)).toBeInTheDocument()
      const token = screen.getByLabelText("KIE dashboard token")
      expect(token).toHaveAttribute("type", "password")
      await user.type(token, "   ")
      expect(fetchButton).toBeDisabled()
      await user.clear(token)
      await user.type(token, TOKEN)
      expect(fetchButton).toBeEnabled()
    })

    it("fetches with the token and the range, then asks for the runs with KIE's figures", async () => {
      const user = userEvent.setup()
      renderPage()
      await runsTable()
      await user.type(screen.getByLabelText("KIE dashboard token"), TOKEN)
      await user.click(screen.getByRole("button", { name: "Fetch KIE real costs" }))

      await waitFor(() => expect(h.fetchKieReal).toHaveBeenCalledWith({ token: TOKEN, ...rangeToIso("2026-10-28", "2026-11-03") }))
      await waitFor(() => expect(listCalls().at(-1)![1]).toBe(KIE.kieUsd))
      expect(lastParams()).toMatchObject({ ...rangeToIso("2026-10-28", "2026-11-03"), offset: 0 })
      expect(await screen.findByText("312 of 340 tasks matched (fetched 12:00)")).toBeInTheDocument()
      expect(screen.queryByText(NOT_FETCHED)).toBeNull()
      expect(screen.getByText("KIE real partial: veo-generate: 401 — session token expired")).toBeInTheDocument()
      expect(screen.getByText("KIE real partial: generic: stopped at the page cap; later records were not read")).toBeInTheDocument()

      // The token went to the KIE call and nowhere else.
      expect(h.fetchKieReal).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(listCalls())).not.toContain(TOKEN)
    })

    it("changing From brings back Not fetched", async () => {
      const user = userEvent.setup()
      renderPage()
      await runsTable()
      await user.type(screen.getByLabelText("KIE dashboard token"), TOKEN)
      await user.click(screen.getByRole("button", { name: "Fetch KIE real costs" }))
      await screen.findByText("312 of 340 tasks matched (fetched 12:00)")

      fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-29" } })
      expect(screen.getByText(NOT_FETCHED)).toBeInTheDocument()
      expect(screen.queryByText(/^KIE real partial/)).toBeNull()
      await waitFor(() => expect(lastParams()).toMatchObject({ ...rangeToIso("2026-10-29", "2026-11-03"), offset: 0 }))
      expect(listCalls().at(-1)![1]).toBeUndefined()

      // A new To does the same.
      await user.click(screen.getByRole("button", { name: "Fetch KIE real costs" }))
      await screen.findByText("312 of 340 tasks matched (fetched 12:00)")
      fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-02" } })
      expect(screen.getByText(NOT_FETCHED)).toBeInTheDocument()
    })

    it("a result for a range no longer shown is dropped", async () => {
      const user = userEvent.setup()
      let answer: (value: KieRealResult) => void = () => undefined
      h.fetchKieReal.mockReturnValue(new Promise<KieRealResult>((resolve) => (answer = resolve)))
      renderPage()
      await runsTable()
      await user.type(screen.getByLabelText("KIE dashboard token"), TOKEN)
      await user.click(screen.getByRole("button", { name: "Fetch KIE real costs" }))
      await waitFor(() => expect(h.fetchKieReal).toHaveBeenCalledTimes(1))

      fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-29" } })
      answer(KIE)
      await pause(20)
      expect(screen.getByText(NOT_FETCHED)).toBeInTheDocument()
      expect(listCalls().every(([, kieUsd]) => kieUsd === undefined)).toBe(true)
    })

    it("shows a failed fetch's message as it comes", async () => {
      const user = userEvent.setup()
      const message = "KIE refused the token: it has expired, or it is not a KIE dashboard session token."
      h.fetchKieReal.mockRejectedValue(new h.FakeMotionPriceApiError("kie_fetch_failed", message, 502))
      renderPage()
      await runsTable()
      await user.type(screen.getByLabelText("KIE dashboard token"), TOKEN)
      await user.click(screen.getByRole("button", { name: "Fetch KIE real costs" }))
      expect(await screen.findByText(message)).toBeInTheDocument()
      expect(screen.getByText(NOT_FETCHED)).toBeInTheDocument()
      // The runs stay on recorded costs.
      expect(listCalls().every(([, kieUsd]) => kieUsd === undefined)).toBe(true)
    })

    it("says in its live region that the fetch is under way, then its result with the partial lines", async () => {
      const user = userEvent.setup()
      let answer: (value: KieRealResult) => void = () => undefined
      h.fetchKieReal.mockReturnValue(new Promise<KieRealResult>((resolve) => (answer = resolve)))
      renderPage()
      await runsTable()
      const region = screen.getByText(NOT_FETCHED).closest('[role="status"]')
      expect(region).not.toBeNull()
      await user.type(screen.getByLabelText("KIE dashboard token"), TOKEN)
      await user.click(screen.getByRole("button", { name: "Fetch KIE real costs" }))
      await waitFor(() => expect(region).toHaveTextContent("Fetching KIE real costs…"))

      answer(KIE)
      await waitFor(() => expect(region).toHaveTextContent("312 of 340 tasks matched (fetched 12:00)"))
      const lines = within(region as HTMLElement)
      expect(lines.getByText("KIE real partial: veo-generate: 401 — session token expired")).toBeInTheDocument()
      expect(lines.getByText("KIE real partial: generic: stopped at the page cap; later records were not read")).toBeInTheDocument()
    })

    it("says when only the first tasks matched are applied", async () => {
      const user = userEvent.setup()
      const applied = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`task-${i}`, 0.01]))
      h.fetchKieReal.mockResolvedValue({ ...KIE, kieUsd: applied, matched: 12_400, motionTasks: 13_000, truncated: true, errors: {}, capped: [] })
      renderPage()
      await runsTable()
      await user.type(screen.getByLabelText("KIE dashboard token"), TOKEN)
      await user.click(screen.getByRole("button", { name: "Fetch KIE real costs" }))
      expect(
        await screen.findByText("12,400 of 13,000 tasks matched (fetched 12:00); only the first 10,000 are applied, the rest show recorded costs"),
      ).toBeInTheDocument()
    })
  })

  it("shows the database-update sentence on 503", async () => {
    h.fetchMotionPriceRuns.mockRejectedValue(new h.FakeMotionPriceApiError("motion_price_check_unavailable", UNAVAILABLE, 503))
    // A client that would otherwise try again (the app's own default retries once): only the page's rule stops it.
    renderPage(new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0 } } }))
    const sentence = await screen.findByText(UNAVAILABLE)
    // On the box's red tint, red-600 reads 4.43:1, under WCAG AA's 4.5:1.
    expect(tokens(sentence)).toContain("text-red-700")
    expect(tokens(sentence)).not.toContain("text-red-600")
    await pause(50)
    expect(h.fetchMotionPriceRuns).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("table", { name: "Runs" })).toBeNull()
    expect(screen.queryByRole("region", { name: "Totals" })).toBeNull()
  })

  it("leaves room under its last control for the fixed accessibility button, at every width", async () => {
    renderPage()
    await runsTable()
    const page = screen.getByRole("heading", { level: 1, name: "Motion price check" }).closest("header")!.parentElement!
    // The button is 44 px, 16 px from the corner: 80 px keeps Next clear of it at the end of the page.
    expect(tokens(page)).toContain("pb-20")
    // A padding shorthand would take that room back from 640 px up.
    expect(tokens(page).filter((t) => /^(sm:)?p-\d/.test(t))).toEqual([])
  })

  it("a request that got no answer is tried once more", async () => {
    h.fetchMotionPriceRuns.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue(LIST)
    renderPage(new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } }))
    await runsTable()
    expect(h.fetchMotionPriceRuns).toHaveBeenCalledTimes(2)
  })

  it("a range longer than 30 days asks for nothing", async () => {
    const user = userEvent.setup()
    renderPage()
    await runsTable()
    await user.type(screen.getByLabelText("KIE dashboard token"), TOKEN)
    expect(screen.getByRole("button", { name: "Fetch KIE real costs" })).toBeEnabled()

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-25" } })
    expect(await screen.findByText("Pick 30 days or fewer")).toBeInTheDocument()
    await pause(30)
    expect(h.fetchMotionPriceRuns).toHaveBeenCalledTimes(1)
    // Nothing of the last range is shown under it, and KIE is not asked for it.
    expect(screen.queryByRole("table", { name: "Runs" })).toBeNull()
    expect(screen.queryByRole("region", { name: "Totals" })).toBeNull()
    expect(screen.getByRole("button", { name: "Fetch KIE real costs" })).toBeDisabled()

    // 30 days is fine again.
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-05" } })
    await waitFor(() => expect(lastParams()).toMatchObject(rangeToIso("2026-10-05", "2026-11-03")))
    expect(screen.queryByText("Pick 30 days or fewer")).toBeNull()
  })

  it("a From after To asks for nothing and says why", async () => {
    renderPage()
    await runsTable()
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-04" } })
    expect(await screen.findByText("From must be on or before To")).toBeInTheDocument()
    await pause(30)
    expect(h.fetchMotionPriceRuns).toHaveBeenCalledTimes(1)
  })
})
