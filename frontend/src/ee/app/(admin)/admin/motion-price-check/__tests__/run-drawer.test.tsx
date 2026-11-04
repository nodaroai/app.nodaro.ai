/**
 * Admin → Motion price check: one run's drill-down, opened from its row.
 *
 * - The Run cell's button opens it and asks for that run, with KIE's figures
 *   once they were fetched; closing gives the focus back to that button,
 *   whether the click focused it or not (Safari's does not).
 * - The header: when, who, the run's name (a Full Quality with its draft's
 *   id), its facts and its figures, "KIE real" beside Paid $ once KIE's
 *   figures are in; a run in flight reads In progress.
 * - The quote: a row per line; a line beside the hold says so, and an extra
 *   says whether it ran (an auto masking quote's privacy line, beside the
 *   hold, says neither); then its hold, the settlement it expected when it
 *   carries one, and what the run was allowed. A run with no recorded quote
 *   says so.
 * - The steps: the run's own row first, then each step indented by its
 *   depth, its role counted from 1, tagged local, no recorded cost or hold
 *   open, and its quote line ("—" for none, or for a line the quote lacks).
 * - Reused, no cost: a row per entry (the clips as one row, ×N; a render's
 *   job id; its quote line). A record with nothing in it reads "Nothing
 *   reused"; a run with no record reads "Not recorded", never "Nothing
 *   reused".
 * - At a phone's width: full width, each table in its own scroll box, and a
 *   44 px Close; each box is focusable and named by its section's heading,
 *   so a keyboard scrolls it too; and axe finds nothing over the open drawer.
 * - KIE's figures landing while a run is open keep its figures on screen
 *   ("Updating…") until the new ones are in; if its button has left the
 *   page meanwhile, closing puts the focus on the runs' heading (or, with no
 *   list, the page's), never on the page itself.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
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

import type {
  KieRealResult,
  MotionPriceList,
  MotionPriceQuoteLine,
  MotionPriceReused,
  MotionPriceRun,
  MotionPriceRunDetail,
  MotionPriceStep,
} from "@/ee/lib/motion-price-check-api"
import AdminMotionPriceCheck from "../page"
import { RunDrawer } from "../run-drawer"
import { axeViolations } from "@/test/axe"

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
    style: "flex",
    resolution: "720p",
    draft: false,
    lengthSec: 12.4,
    held: 1200,
    taken: 1063,
    settled: true,
    takenUsd: 21.26,
    recordedUsd: 12.5,
    kieUsd: 11.9,
    paidUsd: 12.1,
    marginUsd: 9.16,
    marginPct: 43.0856,
    steps: 6,
    stepsWithoutCost: 1,
    quoteTotal: 1200,
    quoteAllowed: 1250,
    flags: NO_FLAGS,
    ...over,
  }
}

function line(over: Partial<MotionPriceQuoteLine> & Pick<MotionPriceQuoteLine, "line" | "label">): MotionPriceQuoteLine {
  return { quoted: 0, expected: null, outsideTotal: false, ran: null, steps: 0, held: 0, taken: 0, ...over }
}

function step(over: Partial<MotionPriceStep>): MotionPriceStep {
  return {
    jobId: idOf(100),
    parentJobId: idOf(1),
    depth: 1,
    name: "Step",
    role: null,
    route: "image-to-image",
    provider: "kie",
    model: "picture-model",
    providerTaskId: null,
    status: "completed",
    held: 0,
    taken: 0,
    open: false,
    takenUsd: 0,
    recordedUsd: 0,
    kieUsd: null,
    paidUsd: 0,
    local: false,
    missingCost: false,
    quoteLine: null,
    ...over,
  }
}

function reused(over: Partial<MotionPriceReused> & Pick<MotionPriceReused, "step" | "name">): MotionPriceReused {
  return { role: null, jobId: null, count: 1, quoteLine: null, ...over }
}

const RUN = run()
const LINES: MotionPriceQuoteLine[] = [
  line({ line: "base", label: "Base fee", quoted: 25, steps: 1, held: 1200, taken: 25 }),
  line({ line: "motion", label: "Render", quoted: 900, expected: 850, steps: 1, held: 900, taken: 888 }),
  line({ line: "references", label: "References", quoted: 215, steps: 2, held: 150, taken: 150 }),
  line({ line: "privacy", label: "Privacy", quoted: 60 }),
  line({ line: "privacyCredits", label: "Privacy retry", quoted: 50, outsideTotal: true, ran: true, steps: 1 }),
  line({ line: "referencesRetryCredits", label: "Sheet retry", quoted: 30, outsideTotal: true, ran: false }),
]
const STEPS: MotionPriceStep[] = [
  step({ jobId: RUN.id, parentJobId: null, depth: 0, name: "Run", route: "cast-swap", provider: null, model: null, held: 1200, taken: 25, takenUsd: 0.5, recordedUsd: null, paidUsd: 0, quoteLine: "base" }),
  step({ jobId: idOf(101), name: "Reference sheet", role: 0, providerTaskId: "task-sheet-1", held: 150, taken: 150, takenUsd: 3, recordedUsd: 0.4, kieUsd: 0.38, paidUsd: 0.38, quoteLine: "references" }),
  step({ jobId: idOf(102), parentJobId: idOf(101), depth: 2, name: "Photo labels", role: 1, route: "llm", provider: "openrouter", model: "text-model", recordedUsd: null, paidUsd: null, missingCost: true, quoteLine: "references" }),
  step({ jobId: idOf(103), name: "Face mesh", route: "video-face-mesh", provider: null, model: null, local: true, quoteLine: "privacyCredits" }),
  step({ jobId: idOf(104), name: "Render", route: "video-to-video", model: "render-model", providerTaskId: "task-render-1", held: 900, taken: 888, takenUsd: 17.76, recordedUsd: 11.6, kieUsd: 11.52, paidUsd: 11.52, quoteLine: "motion" }),
  step({ jobId: idOf(105), name: "Other step (video-trim)", route: "video-trim", provider: null, model: null, quoteLine: null }),
]
const DETAIL: MotionPriceRunDetail = {
  run: RUN,
  quote: { totalCredits: 1200, expectedCredits: 1150, lines: LINES },
  steps: STEPS,
  reuse: {
    recorded: "yes",
    entries: [
      // A kept cut of the trend's stored mask: the mask is the privacy line's, the clip is local work on none.
      reused({ step: "face-mask", name: "Face mask (the trend's stored mask)", quoteLine: "privacy" }),
      reused({ step: "clip", name: "Engine-ready clip (kept, local work)", count: 3 }),
      reused({ step: "reference-sheet", name: "Reference sheet (kept)", role: 1, quoteLine: "references" }),
    ],
  },
}
const FULL_QUALITY: MotionPriceRunDetail = {
  run: run({ id: idOf(4), trendName: "Rooftop", fullQuality: true, draftJobId: idOf(9), resolution: "1080p", kieUsd: null }),
  quote: {
    totalCredits: 335,
    expectedCredits: null,
    lines: [line({ line: "base", label: "Base fee", quoted: 35 }), line({ line: "motionHd", label: "1080p render", quoted: 300 })],
  },
  steps: [step({ jobId: idOf(4), parentJobId: null, depth: 0, name: "Full Quality", route: "cast-swap", quoteLine: "base" })],
  reuse: { recorded: "yes", entries: [reused({ step: "render", name: "1080p render (an earlier try's)", jobId: idOf(77), quoteLine: "motionHd" })] },
}
// An "auto" masking quote: its privacy line repeats the retry extra, beside the hold, and is no extra itself.
const AUTO_MASKING: MotionPriceRunDetail = {
  ...DETAIL,
  quote: {
    totalCredits: 925,
    expectedCredits: null,
    lines: [
      line({ line: "base", label: "Base fee", quoted: 25 }),
      line({ line: "motion", label: "Render", quoted: 900 }),
      line({ line: "privacy", label: "Privacy", quoted: 50, outsideTotal: true }),
      line({ line: "privacyCredits", label: "Privacy retry", quoted: 50, outsideTotal: true, ran: false }),
    ],
  },
}
const IN_FLIGHT: MotionPriceRunDetail = {
  ...DETAIL,
  run: run({ status: "processing", settled: false, taken: 240, takenUsd: 4.8, paidUsd: 1.2, marginUsd: null, marginPct: null }),
  steps: [STEPS[0]!, step({ jobId: idOf(104), name: "Render", status: "processing", held: 900, taken: null, takenUsd: null, open: true, quoteLine: "motion" })],
}
const NO_QUOTE: MotionPriceRunDetail = {
  run: run({ quoteTotal: null, quoteAllowed: null }),
  quote: null,
  steps: STEPS.map((s) => ({ ...s, quoteLine: null })),
  reuse: { recorded: "not-recorded", entries: [] },
}

// The same run before KIE's figures: what was paid is the recorded costs.
const RECORDED: MotionPriceRunDetail = { ...DETAIL, run: run({ kieUsd: null, paidUsd: 12.5 }) }
const OTHER = run({ id: idOf(2), trendName: "Beach walk" })

const LIST: MotionPriceList = {
  total: 1,
  runs: [RUN],
  totals: [{ dimension: "all", value: null, runs: 1, unsettled: 0, held: 1200, taken: 1063, takenUsd: 21.26, paidUsd: 12.1, marginUsd: 9.16, marginPct: 43.0856 }],
  kieApplied: false,
}
const KIE: KieRealResult = {
  kieUsd: { "task-sheet-1": 0.38, "task-render-1": 11.52 },
  window: { from: new Date(2026, 9, 28).toISOString(), to: new Date(2026, 10, 3, 12).toISOString() },
  motionTasks: 2,
  matched: 2,
  truncated: false,
  kieRecords: 40,
  capped: [],
  errors: {},
  fetchedAt: new Date(2026, 10, 3, 12, 0).toISOString(),
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

function renderPage() {
  return render(
    <QueryClientProvider client={newClient()}>
      <AdminMotionPriceCheck />
    </QueryClientProvider>,
  )
}

/** The drawer alone, open on `detail`'s run. */
async function openDrawer(detail: MotionPriceRunDetail, name = detail.run.trendName ?? "Hand") {
  h.fetchMotionPriceRun.mockResolvedValue(detail)
  render(
    <QueryClientProvider client={newClient()}>
      <RunDrawer runId={detail.run.id} kie={null} onClose={() => undefined} />
    </QueryClientProvider>,
  )
  return screen.findByRole("dialog", { name })
}

/** Starts KIE's fetch on the page; its answer lands when the returned function is called. */
async function startKieFetch(user: ReturnType<typeof userEvent.setup>) {
  let land: (value: KieRealResult) => void = () => undefined
  h.fetchKieReal.mockReturnValue(new Promise<KieRealResult>((resolve) => (land = resolve)))
  await user.type(screen.getByLabelText("KIE dashboard token"), "kie-session-token")
  await user.click(screen.getByRole("button", { name: "Fetch KIE real costs" }))
  await waitFor(() => expect(h.fetchKieReal).toHaveBeenCalledTimes(1))
  return () => land(KIE)
}

const tokens = (el: Element) => el.className.split(/\s+/)
const factOf = (dialog: HTMLElement, label: string) => within(dialog).getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement
/** A section's scroll box, named by its heading, and the table in it. */
const regionOf = (dialog: HTMLElement, name: string) => within(dialog).getByRole("region", { name })
const tableOf = (dialog: HTMLElement, name: string) => within(regionOf(dialog, name)).getByRole("table")
const headersOf = (table: HTMLElement) => within(table).getAllByRole("columnheader").map((c) => c.textContent)
const rowHeadersOf = (table: HTMLElement) => within(table).getAllByRole("rowheader")
const rowOf = (table: HTMLElement, name: string) => within(table).getByRole("rowheader", { name }).closest("tr")!
const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent)

beforeEach(() => {
  vi.clearAllMocks()
  h.fetchMotionPriceRuns.mockResolvedValue(LIST)
  h.fetchMotionPriceRun.mockResolvedValue(DETAIL)
  h.fetchKieReal.mockResolvedValue(KIE)
})

describe("Admin → Motion price check: a run's drill-down", () => {
  it("a run's button opens its drawer and asks for that run, with KIE's figures once they were fetched", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("button", { name: "Office dance" }))
    await screen.findByRole("dialog", { name: "Office dance" })
    expect(h.fetchMotionPriceRun).toHaveBeenCalledTimes(1)
    expect(h.fetchMotionPriceRun).toHaveBeenCalledWith(RUN.id, undefined)
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    await user.type(screen.getByLabelText("KIE dashboard token"), "kie-session-token")
    await user.click(screen.getByRole("button", { name: "Fetch KIE real costs" }))
    await screen.findByText("2 of 2 tasks matched (fetched 12:00)")
    await user.click(screen.getByRole("button", { name: "Office dance" }))
    await screen.findByRole("dialog", { name: "Office dance" })
    await waitFor(() => expect(h.fetchMotionPriceRun).toHaveBeenLastCalledWith(RUN.id, KIE.kieUsd))
  })

  it("closing gives the focus back to the run's button, by Escape and by Close", async () => {
    const user = userEvent.setup()
    renderPage()
    const opener = await screen.findByRole("button", { name: "Office dance" })
    // Safari does not focus a button it clicks: open it that way.
    fireEvent.click(opener)
    expect(opener).not.toHaveFocus()
    await screen.findByRole("dialog", { name: "Office dance" })
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(opener).toHaveFocus())

    opener.blur()
    fireEvent.click(opener)
    const dialog = await screen.findByRole("dialog", { name: "Office dance" })
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it("KIE's figures landing while a run is open keep its figures on screen, updating, until the new ones are in", async () => {
    const user = userEvent.setup()
    let withKie: (detail: MotionPriceRunDetail) => void = () => undefined
    h.fetchMotionPriceRun.mockImplementation((_id: string, kieUsd?: Record<string, number>) =>
      kieUsd === undefined ? Promise.resolve(RECORDED) : new Promise<MotionPriceRunDetail>((resolve) => (withKie = resolve)),
    )
    renderPage()
    await screen.findByRole("button", { name: "Office dance" })
    // Fetch is pressed, and a run opened before KIE answers.
    const land = await startKieFetch(user)
    await user.click(screen.getByRole("button", { name: "Office dance" }))
    const dialog = await screen.findByRole("dialog", { name: "Office dance" })
    expect(factOf(dialog, "Paid $")).toHaveTextContent(/^\$12\.50$/)

    land()
    await waitFor(() => expect(h.fetchMotionPriceRun).toHaveBeenLastCalledWith(RUN.id, KIE.kieUsd))
    await waitFor(() => expect(within(dialog).getByRole("status")).toHaveTextContent(/^Updating…$/))
    // The same drawer, its figures still there: never back to the loading line.
    expect(screen.getByRole("dialog", { name: "Office dance" })).toBe(dialog)
    expect(factOf(dialog, "Paid $")).toHaveTextContent(/^\$12\.50$/)
    expect(within(dialog).queryByText("Loading the run…")).toBeNull()

    withKie(DETAIL)
    await waitFor(() => expect(factOf(dialog, "Paid $")).toHaveTextContent(/^\$12\.10 KIE real$/))
    expect(within(dialog).getByRole("status")).toHaveTextContent(/^$/)
  })

  it("closing, the focus goes to the runs' heading when the run's button has left the page", async () => {
    const user = userEvent.setup()
    // With KIE's figures, the list sorts the open run onto another page.
    h.fetchMotionPriceRuns.mockImplementation((_params: unknown, kieUsd?: Record<string, number>) =>
      Promise.resolve(kieUsd === undefined ? LIST : { ...LIST, runs: [OTHER] }),
    )
    renderPage()
    const opener = await screen.findByRole("button", { name: "Office dance" })
    const land = await startKieFetch(user)
    fireEvent.click(opener)
    await screen.findByRole("dialog", { name: "Office dance" })
    land()
    await waitFor(() => expect(opener).not.toBeInTheDocument())
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Runs" })).toHaveFocus())
  })

  it("closing with no list on the page any more, the focus goes to the page's own heading, never to the page", async () => {
    const user = userEvent.setup()
    // With KIE's figures, the list cannot be read: its error takes the tables' place.
    h.fetchMotionPriceRuns.mockImplementation((_params: unknown, kieUsd?: Record<string, number>) =>
      kieUsd === undefined
        ? Promise.resolve(LIST)
        : Promise.reject(new h.FakeMotionPriceApiError("motion_price_check_unavailable", "The database needs an update.", 503)),
    )
    renderPage()
    const opener = await screen.findByRole("button", { name: "Office dance" })
    const land = await startKieFetch(user)
    fireEvent.click(opener)
    await screen.findByRole("dialog", { name: "Office dance" })
    land()
    await waitFor(() => expect(opener).not.toBeInTheDocument())
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Motion price check" })).toHaveFocus())
    expect(document.body).not.toHaveFocus()
  })

  it("the open drawer passes axe's WCAG 2 A and AA checks", async () => {
    const dialog = await openDrawer(DETAIL)
    expect(await axeViolations(dialog)).toEqual([])
  })

  it("shows the run's header: when, who, its name, its facts and its figures", async () => {
    const dialog = await openDrawer(DETAIL)
    expect(within(dialog).getByText("2026-11-02 09:05 · ops@nodaro.example")).toBeInTheDocument()
    expect(factOf(dialog, "Engine")).toHaveTextContent(/^Prism$/)
    expect(factOf(dialog, "Style")).toHaveTextContent(/^Flex$/)
    expect(factOf(dialog, "Resolution")).toHaveTextContent(/^720p$/)
    expect(factOf(dialog, "Clip")).toHaveTextContent(/^12\.4 s$/)
    expect(factOf(dialog, "Status")).toHaveTextContent(/^completed$/)
    expect(factOf(dialog, "Held")).toHaveTextContent(/^1,200$/)
    expect(factOf(dialog, "Taken")).toHaveTextContent(/^1,063$/)
    expect(factOf(dialog, "Taken $")).toHaveTextContent(/^\$21\.26$/)
    // KIE's own figures went into what was paid.
    expect(factOf(dialog, "Paid $")).toHaveTextContent(/^\$12\.10 KIE real$/)
    expect(factOf(dialog, "Margin $")).toHaveTextContent(/^\$9\.16$/)
    expect(factOf(dialog, "Margin %")).toHaveTextContent(/^43\.1%$/)
    expect(within(dialog).queryByText("In progress")).toBeNull()
  })

  it("names a Full Quality run with its badge and its draft's id; Paid $ reads recorded costs without KIE's", async () => {
    const dialog = await openDrawer(FULL_QUALITY, "Rooftop Full Quality")
    expect(within(dialog).getByRole("heading", { name: "Rooftop Full Quality" })).toBeInTheDocument()
    const draft = within(dialog).getByText(idOf(9))
    expect(draft.closest("p")).toHaveTextContent(`Draft ${idOf(9)}`)
    // A whole id wraps at a phone's width.
    expect(tokens(draft)).toContain("break-all")
    expect(factOf(dialog, "Resolution")).toHaveTextContent(/^1080p$/)
    expect(factOf(dialog, "Paid $")).toHaveTextContent(/^\$12\.10$/)
  })

  it("a draft's resolution says so; KIE real shows for a run KIE charged nothing", async () => {
    const detail = { ...DETAIL, run: run({ resolution: "480p", draft: true, kieUsd: 0, email: null }) }
    const dialog = await openDrawer(detail)
    expect(factOf(dialog, "Resolution")).toHaveTextContent(/^480p \(draft\)$/)
    expect(factOf(dialog, "Paid $")).toHaveTextContent(/KIE real$/)
    // No email: the account's id.
    expect(within(dialog).getByText(`2026-11-02 09:05 · ${USER_ID}`)).toBeInTheDocument()
  })

  it("a run in flight reads In progress under Taken and its margin, and its open hold is tagged", async () => {
    const dialog = await openDrawer(IN_FLIGHT)
    expect(factOf(dialog, "Taken")).toHaveTextContent(/^240\s*In progress$/)
    expect(factOf(dialog, "Margin $")).toHaveTextContent(/^—\s*In progress$/)
    expect(factOf(dialog, "Margin %")).toHaveTextContent(/^—$/)
    expect(factOf(dialog, "Status")).toHaveTextContent(/^processing$/)
    const steps = tableOf(dialog, "Steps")
    expect(rowHeadersOf(steps).map((c) => c.textContent)).toEqual(["Run", "Render hold open"])
  })

  it("lists the quote's lines: a line beside the hold says so, an extra whether it ran, and what was allowed", async () => {
    const dialog = await openDrawer(DETAIL)
    const quote = tableOf(dialog, "Quote")
    expect(headersOf(quote)).toEqual(["Line", "Quoted", "Expected", "Steps", "Held", "Taken"])
    expect(rowHeadersOf(quote).map((c) => c.textContent)).toEqual([
      "Base fee",
      "Render",
      "References",
      "Privacy",
      // Said once: the tag, never the label too.
      "Privacy retry outside the hold ran",
      "Sheet retry outside the hold did not run",
    ])
    // Expected is the render's alone.
    expect(cellsOf(rowOf(quote, "Render"))).toEqual(["900", "850", "1", "900", "888"])
    expect(cellsOf(rowOf(quote, "Base fee"))).toEqual(["25", "—", "1", "1,200", "25"])
    expect(cellsOf(rowOf(quote, "Privacy"))).toEqual(["60", "—", "0", "0", "0"])
    expect(within(dialog).getByText("Allowed: 1,250 (the hold plus the extras that ran)")).toBeInTheDocument()
    expect(within(dialog).queryByText(/^No quote recorded/)).toBeNull()
  })

  describe("the quote's hold and expected settlement", () => {
    const sentences = (dialog: HTMLElement) =>
      within(dialog).getAllByText(/^(Quoted hold|Expected settlement|Allowed):/).map((el) => el.textContent)

    it("reads them above what was allowed", async () => {
      expect(sentences(await openDrawer(DETAIL))).toEqual([
        "Quoted hold: 1,200",
        "Expected settlement: 1,150",
        "Allowed: 1,250 (the hold plus the extras that ran)",
      ])
    })

    it("a quote that carries no expected settlement reads its hold alone", async () => {
      const dialog = await openDrawer(FULL_QUALITY, "Rooftop Full Quality")
      expect(sentences(dialog)).toEqual(["Quoted hold: 335", "Allowed: 1,250 (the hold plus the extras that ran)"])
    })

    it("a quote that expected to settle at 0 says so", async () => {
      const dialog = await openDrawer({ ...DETAIL, quote: { ...DETAIL.quote!, expectedCredits: 0 } })
      expect(sentences(dialog)).toContain("Expected settlement: 0")
    })
  })

  it("an auto masking quote's privacy line is beside the hold, and says nothing about running", async () => {
    const dialog = await openDrawer(AUTO_MASKING)
    expect(rowHeadersOf(tableOf(dialog, "Quote")).map((c) => c.textContent)).toEqual([
      "Base fee",
      "Render",
      "Privacy outside the hold",
      "Privacy retry outside the hold did not run",
    ])
  })

  it("says so when the run has no recorded quote", async () => {
    const dialog = await openDrawer(NO_QUOTE)
    expect(within(dialog).getByText("No quote recorded — a run from before quotes were recorded")).toBeInTheDocument()
    expect(within(dialog).queryByRole("region", { name: "Quote" })).toBeNull()
    expect(within(dialog).queryByText(/^(Quoted hold|Expected settlement|Allowed):/)).toBeNull()
    const steps = tableOf(dialog, "Steps")
    for (const row of within(steps).getAllByRole("row").slice(1)) expect(cellsOf(row).at(-1)).toBe("—")
  })

  it("lists the steps in order, indented by depth, the role from 1, tagged, and on their quote line", async () => {
    const PHOTO_LABELS = "Photo labels role 2 no recorded cost (nested step of Reference sheet role 1)"
    const dialog = await openDrawer(DETAIL)
    const steps = tableOf(dialog, "Steps")
    expect(headersOf(steps)).toEqual([
      "Step",
      "Route",
      "Provider · model",
      "Task id",
      "Status",
      "Held",
      "Taken",
      "Taken $",
      "Recorded $",
      "KIE real $",
      "Paid $",
      "Quote line",
    ])
    const names = rowHeadersOf(steps)
    expect(names.map((c) => c.textContent)).toEqual([
      "Run",
      "Reference sheet role 1",
      "Photo labels role 2 no recorded cost (nested step of Reference sheet role 1)",
      "Face mesh local",
      "Render",
      "Other step (video-trim)",
    ])
    expect(names.map((c) => tokens(c).find((t) => /^ps-\d+$/.test(t)))).toEqual(["ps-2", "ps-6", "ps-10", "ps-6", "ps-6", "ps-6"])

    expect(cellsOf(rowOf(steps, "Run"))).toEqual(["cast-swap", "—", "—", "completed", "1,200", "25", "$0.50", "—", "—", "$0.00", "Base fee"])
    expect(cellsOf(rowOf(steps, "Reference sheet role 1"))).toEqual([
      "image-to-image",
      "kie · picture-model",
      "task-sheet-1",
      "completed",
      "150",
      "150",
      "$3.00",
      "$0.40",
      "$0.38",
      "$0.38",
      "References",
    ])
    expect(cellsOf(rowOf(steps, PHOTO_LABELS)).slice(7)).toEqual(["—", "—", "—", "References"])
    // Its depth is said, not only drawn: a step of a step names the step it is under, for a screen reader alone.
    const nested = within(rowOf(steps, PHOTO_LABELS)).getByText("(nested step of Reference sheet role 1)")
    expect(tokens(nested)).toContain("sr-only")
    expect(within(steps).getAllByText(/nested step/)).toEqual([nested])
    expect(cellsOf(rowOf(steps, "Face mesh local")).at(-1)).toBe("Privacy retry")
    // A step no line covers.
    expect(cellsOf(rowOf(steps, "Other step (video-trim)")).at(-1)).toBe("—")
  })

  it("a step on a line its quote does not carry reads —", async () => {
    const detail = { ...DETAIL, steps: [STEPS[0]!, step({ jobId: idOf(110), name: "Styled role picture", role: 0, quoteLine: "styleRefs" })] }
    const dialog = await openDrawer(detail)
    expect(cellsOf(rowOf(tableOf(dialog, "Steps"), "Styled role picture role 1")).at(-1)).toBe("—")
  })

  it("lists what the run reused: the clips as one row, the mask on privacy and the clip on none", async () => {
    const dialog = await openDrawer(DETAIL)
    const reuse = tableOf(dialog, "Reused, no cost")
    expect(headersOf(reuse)).toEqual(["Step", "Job", "Quote line"])
    expect(rowHeadersOf(reuse).map((c) => c.textContent)).toEqual([
      "Face mask (the trend's stored mask)",
      "Engine-ready clip (kept, local work) ×3",
      "Reference sheet (kept) role 2",
    ])
    expect(cellsOf(rowOf(reuse, "Face mask (the trend's stored mask)"))).toEqual(["—", "Privacy"])
    expect(cellsOf(rowOf(reuse, "Engine-ready clip (kept, local work) ×3"))).toEqual(["—", "—"])
    expect(cellsOf(rowOf(reuse, "Reference sheet (kept) role 2"))).toEqual(["—", "References"])
    // Reused steps are not steps: the privacy line counts none of them.
    expect(cellsOf(rowOf(tableOf(dialog, "Quote"), "Privacy"))[2]).toBe("0")
  })

  it("a Full Quality try that reused a render names that render's job", async () => {
    const dialog = await openDrawer(FULL_QUALITY, "Rooftop Full Quality")
    const reuse = tableOf(dialog, "Reused, no cost")
    expect(cellsOf(rowOf(reuse, "1080p render (an earlier try's)"))).toEqual([idOf(77), "1080p render"])
  })

  it("a record with nothing in it reads Nothing reused", async () => {
    const view = await openDrawer({ ...DETAIL, reuse: { recorded: "yes", entries: [] } })
    expect(within(view).getByText("Nothing reused")).toBeInTheDocument()
    expect(within(view).queryByRole("region", { name: "Reused, no cost" })).toBeNull()
  })

  it("a run with a quote but no reuse record reads Not recorded, never Nothing reused", async () => {
    const dialog = await openDrawer({ ...DETAIL, reuse: { recorded: "none", entries: [] } })
    expect(within(dialog).getByText("Not recorded")).toBeInTheDocument()
    expect(within(dialog).queryByText("Nothing reused")).toBeNull()
  })

  it("a run from before reuse was recorded says so", async () => {
    const dialog = await openDrawer(NO_QUOTE)
    expect(within(dialog).getByText("Not recorded — a run from before reuse was recorded")).toBeInTheDocument()
    expect(within(dialog).queryByText("Nothing reused")).toBeNull()
  })

  it("says it is loading, then the server's sentence when the run cannot be read, asked once", async () => {
    let fail: (error: Error) => void = () => undefined
    h.fetchMotionPriceRun.mockReturnValue(new Promise((_, reject) => (fail = reject)))
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0 } } })}>
        <RunDrawer runId={RUN.id} kie={null} onClose={() => undefined} />
      </QueryClientProvider>,
    )
    const dialog = await screen.findByRole("dialog", { name: "Motion run" })
    expect(within(dialog).getByRole("status")).toHaveTextContent("Loading the run…")
    fail(new h.FakeMotionPriceApiError("not_found", "Motion run not found", 404))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Motion run not found")
    // On the box's red tint, red-600 reads 4.43:1, under WCAG AA's 4.5:1.
    expect(tokens(within(dialog).getByText("Motion run not found"))).toContain("text-red-700")
    expect(within(dialog).getByRole("status")).toHaveTextContent(/^$/)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(h.fetchMotionPriceRun).toHaveBeenCalledTimes(1)
  })

  it("fits a phone and a keyboard: full width, each table in a focusable scroll box its heading names, a 44 px Close", async () => {
    const dialog = await openDrawer(DETAIL)
    // Full width on a phone, the admin drawers' 48rem from 640 px (a tablet, an iPad on its side), 64rem from 1280 px.
    expect(tokens(dialog)).toEqual(expect.arrayContaining(["w-full", "overflow-y-auto", "sm:max-w-3xl", "xl:max-w-5xl"]))
    expect(tokens(dialog)).not.toContain("lg:max-w-5xl")
    for (const name of ["Quote", "Steps", "Reused, no cost"]) {
      const region = regionOf(dialog, name)
      const table = within(region).getByRole("table")
      expect(table.parentElement, name).toBe(region)
      // A keyboard scrolls it sideways as a finger or a wheel does; its one name is its section's heading.
      expect(region).toHaveAttribute("tabindex", "0")
      expect(region.getAttribute("aria-labelledby")).toBe(within(dialog).getByRole("heading", { level: 3, name }).id)
      expect(tokens(region), name).toEqual(expect.arrayContaining(["overflow-x-auto", "focus-visible:ring-2"]))
      expect(table).not.toHaveAttribute("aria-label")
    }
    const buttons = within(dialog).getAllByRole("button")
    expect(buttons.map((b) => b.getAttribute("aria-label") ?? b.textContent)).toEqual(["Close"])
    for (const button of buttons) expect(tokens(button)).toContain("size-11")
    // Long ids wrap rather than push the drawer sideways.
    expect(tokens(within(dialog).getByText("2026-11-02 09:05 · ops@nodaro.example"))).toContain("break-words")
  })
})
