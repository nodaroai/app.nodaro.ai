/**
 * The Trend Radar admin pages over a fake SDK resource: the queue shows the
 * run's tiles and the candidates, filters by status and sorts through the
 * resource; a candidate's "Open as draft trend" approves and goes to the
 * trend editor, "Reject" needs a reason; the settings page saves the draft
 * whole and only when something changed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import type { TrendCandidate, TrendCandidateCard, TrendRadarSettings, TrendRadarSummary } from "@nodaro/sdk/trend-radar"

const fake = vi.hoisted(() => ({
  summary: vi.fn(),
  candidates: vi.fn(),
  candidate: vi.fn(),
  approve: vi.fn(),
  watch: vi.fn(),
  reject: vi.fn(),
  settings: vi.fn(),
  updateSettings: vi.fn(),
  run: vi.fn(),
}))

const fakeRights = vi.hoisted(() => ({
  declaration: vi.fn(),
  confirm: vi.fn(),
}))

vi.mock("../client", () => ({ radarClient: { trendRadar: fake, contentRights: fakeRights } }))
vi.mock("@/lib/edition", () => ({ hasAdmin: () => true }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import AdminTrendRadarPage from "../page"
import AdminTrendCandidatePage from "../candidate-page"
import AdminTrendRadarSettingsPage from "../settings-page"

const SUMMARY: TrendRadarSummary = {
  lastRun: { at: new Date().toISOString(), sourcesRead: 7, namesSeen: 41, searchesUsed: 38 },
  counts: { candidates: 5, watching: 12, slowing: 3 },
  searchesToday: 38,
  dailySearchBudget: 60,
}

const card = (over: Partial<TrendCandidateCard> = {}): TrendCandidateCard => ({
  id: "c1",
  name: "Phone on the Train",
  slug: "phone-on-the-train",
  status: "candidate",
  label: "hot",
  soundName: "subway phone remix",
  durationSec: 10,
  creators: 14,
  plays: 430_000_000,
  dayChangePct: 3.1,
  firstSeen: { kind: "template-site", name: "Site A", url: "https://a.test/templates/phone-on-the-train", firstSeenAt: "2026-10-23T06:00:00Z" },
  topPost: null,
  passedAt: "2026-10-27T06:00:00Z",
  trendId: null,
  createdAt: "2026-10-23T06:00:00Z",
  updatedAt: "2026-11-01T06:00:00Z",
  ...over,
})

const full = (over: Partial<TrendCandidate> = {}): TrendCandidate => ({
  ...card(),
  summary: null,
  posts: [{ platform: "tiktok", url: "https://www.tiktok.com/@a/video/1", author: "a", postedAt: "2026-10-03", plays: 8_400_000, likes: null, soundName: "subway phone remix", stillUrl: null, embedUrl: null, durationSec: 10 }],
  readings: [
    { date: "2026-10-31", creators: 9, plays: 300_000_000, posts: 20 },
    { date: "2026-11-01", creators: 14, plays: 430_000_000, posts: 20 },
  ],
  templatesElsewhere: [{ site: "Site A", url: "https://a.test/templates/phone-on-the-train", since: "2026-10-23", note: null }],
  search: { suggest: true, interest7d: null, checkedAt: "2026-10-27T06:00:00Z" },
  history: [{ at: "2026-10-27T06:00:00Z", event: "passed", detail: "14 creators" }],
  checklist: [
    { key: "creators", label: "5 or more distinct creators", hint: "14 found", auto: true },
    { key: "length", label: "Clip is 30s or less", hint: "10s", auto: true },
  ],
  rejectReason: null,
  ...over,
})

const SETTINGS: TrendRadarSettings = {
  sources: [{ id: "s1", name: "Site A", kind: "sitemap", url: "https://a.test/sitemap.xml", enabled: true, lastReadAt: null, pages: 320, newToday: 3, lastError: null }],
  thresholds: { minCreators: 5, windowDays: 21, risingPct: 15, slowingPct: 1, maxClipSec: 30, dailySearchBudget: 60 },
  alerts: { slackNewCandidate: true, slackDailySummary: false },
  retentionDays: 90,
  runAt: "06:00",
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin/trend-radar" element={<AdminTrendRadarPage />} />
          <Route path="/admin/trend-radar/settings" element={<AdminTrendRadarSettingsPage />} />
          <Route path="/admin/trend-radar/:id" element={<AdminTrendCandidatePage />} />
          <Route path="/admin/trends/:id" element={<div>trend editor</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  for (const fn of Object.values(fake)) fn.mockReset()
  fake.summary.mockResolvedValue(SUMMARY)
  fake.candidates.mockResolvedValue({ data: [card(), card({ id: "c2", name: "Tiny Desk", slug: "tiny-desk", status: "watching", label: "rising", creators: 6, plays: 4_600_000, dayChangePct: 18 })], next: null })
  fake.candidate.mockResolvedValue(full())
  fake.settings.mockResolvedValue(SETTINGS)
  // The server answers what it saved, and reads it back the same way after.
  fake.updateSettings.mockImplementation(async (patch: Partial<TrendRadarSettings>) => {
    const next = { ...SETTINGS, ...patch, sources: SETTINGS.sources }
    fake.settings.mockResolvedValue(next)
    return next
  })
  fake.approve.mockResolvedValue({ trendId: "t-1", clip: "attaching" })
  fakeRights.declaration.mockReset()
  fakeRights.confirm.mockReset()
  fakeRights.declaration.mockResolvedValue({ version: 1, text: "I confirm that I hold the rights to this content." })
  fakeRights.confirm.mockResolvedValue({ id: "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01", declarationVersion: 1, expiresAt: "2026-11-02T07:00:00Z" })
  fake.watch.mockResolvedValue(card({ status: "watching" }))
  fake.reject.mockResolvedValue(card({ status: "rejected" }))
  fake.run.mockResolvedValue({ runId: "r", startedAt: new Date().toISOString() })
})
afterEach(() => vi.clearAllMocks())

describe("the queue", () => {
  it("shows the run's tiles and the candidates, and asks the resource again for a filter and a sort", async () => {
    renderAt("/admin/trend-radar")
    expect(await screen.findByText("Phone on the Train")).toBeInTheDocument()
    expect(screen.getByText("Tiny Desk")).toBeInTheDocument()
    expect(screen.getByText("7 sources read · 41 names seen")).toBeInTheDocument()
    expect(screen.getByText("of 60 daily budget")).toBeInTheDocument()
    expect(screen.getByText("430M")).toBeInTheDocument()
    expect(screen.getByText("+3.1%")).toBeInTheDocument()
    expect(fake.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "creators" }))
    expect(fake.candidates).not.toHaveBeenLastCalledWith(expect.objectContaining({ status: expect.anything() }))

    fireEvent.click(screen.getByRole("button", { name: /Watching/, pressed: false }))
    await waitFor(() => expect(fake.candidates).toHaveBeenLastCalledWith(expect.objectContaining({ status: "watching", sort: "creators" })))
    const review = screen.getAllByRole("link", { name: "Review" })
    expect(review[0]).toHaveAttribute("href", "/admin/trend-radar/c1")
  })

  it("Run now starts the run through the resource", async () => {
    renderAt("/admin/trend-radar")
    await screen.findByText("Phone on the Train")
    fireEvent.click(screen.getByRole("button", { name: /Run now/ }))
    await waitFor(() => expect(fake.run).toHaveBeenCalledTimes(1))
  })

  it("says so where the radar is not available", async () => {
    fake.summary.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }))
    fake.candidates.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }))
    renderAt("/admin/trend-radar")
    expect(await screen.findByText("Trend Radar is not available on this server yet.")).toBeInTheDocument()
  })
})

describe("one candidate", () => {
  const TOP_POST = { platform: "tiktok" as const, url: "https://www.tiktok.com/@a/video/1", author: "a", postedAt: "2026-10-03", plays: 8_400_000, likes: null, soundName: "subway phone remix", stillUrl: null, embedUrl: null, durationSec: 10 }

  it("shows the readings, posts and thresholds; Open as draft trend approves and goes to the editor", async () => {
    fake.candidate.mockResolvedValue(full({ topPost: TOP_POST }))
    renderAt("/admin/trend-radar/c1")
    expect(await screen.findByRole("heading", { name: "Phone on the Train" })).toBeInTheDocument()
    expect(screen.getByText("14 creators")).toBeInTheDocument()
    expect(screen.getByRole("img", { name: /Creators 9 to 14/ })).toBeInTheDocument()
    expect(screen.getByText("@a")).toBeInTheDocument()
    expect(screen.getByText("5 or more distinct creators")).toBeInTheDocument()
    // The clip's download needs the admin's confirmation of the declaration for the top post's link.
    const approveButton = screen.getByRole("button", { name: /Open as draft trend/ })
    expect(approveButton).toBeDisabled()
    expect(await screen.findByText("I confirm that I hold the rights to this content.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the declaration/ }))
    await waitFor(() => expect(approveButton).toBeEnabled())
    fireEvent.click(approveButton)
    await waitFor(() => expect(fakeRights.confirm).toHaveBeenCalledWith({ url: "https://www.tiktok.com/@a/video/1", declarationVersion: 1 }))
    await waitFor(() => expect(fake.approve).toHaveBeenCalledWith("c1", { confirmationId: "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01" }))
    expect(await screen.findByText("trend editor")).toBeInTheDocument()
  })

  it("a declaration that fails to load says so and offers another try; the button stays off", async () => {
    fake.candidate.mockResolvedValue(full({ topPost: TOP_POST }))
    // The query retries once on its own; both reads fail here.
    fakeRights.declaration.mockRejectedValue(new Error("Network down"))
    renderAt("/admin/trend-radar/c1")
    await screen.findByRole("heading", { name: "Phone on the Train" })
    // The query's one retry waits a second before the error shows.
    expect(await screen.findByText("Network down", {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Open as draft trend/ })).toBeDisabled()
    fakeRights.declaration.mockResolvedValue({ version: 1, text: "I confirm that I hold the rights to this content." })
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("I confirm that I hold the rights to this content.")).toBeInTheDocument()
  })

  it("a confirmation that cannot be recorded stops the approve", async () => {
    fake.candidate.mockResolvedValue(full({ topPost: TOP_POST }))
    fakeRights.confirm.mockRejectedValue(new Error("The declaration changed; read the current text and confirm again."))
    renderAt("/admin/trend-radar/c1")
    await screen.findByText("I confirm that I hold the rights to this content.")
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the declaration/ }))
    await waitFor(() => expect(screen.getByRole("button", { name: /Open as draft trend/ })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: /Open as draft trend/ }))
    const { toast } = await import("sonner")
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("The declaration changed; read the current text and confirm again."))
    expect(fake.approve).not.toHaveBeenCalled()
  })

  it("a candidate with no top post is approved without a confirmation", async () => {
    renderAt("/admin/trend-radar/c1")
    await screen.findByRole("heading", { name: "Phone on the Train" })
    expect(screen.queryByRole("checkbox", { name: /I confirm the declaration/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Open as draft trend/ }))
    await waitFor(() => expect(fake.approve).toHaveBeenCalledWith("c1", {}))
    expect(fakeRights.confirm).not.toHaveBeenCalled()
  })

  it("Keep watching sends the candidate back; a failed approve says why", async () => {
    fake.candidate.mockResolvedValue(full({ topPost: TOP_POST }))
    renderAt("/admin/trend-radar/c1")
    await screen.findByRole("heading", { name: "Phone on the Train" })
    fireEvent.click(screen.getByRole("button", { name: "Keep watching" }))
    await waitFor(() => expect(fake.watch).toHaveBeenCalledWith("c1"))
    fake.approve.mockRejectedValue(new Error("A trend with this name exists already"))
    await screen.findByText("I confirm that I hold the rights to this content.")
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm the declaration/ }))
    await waitFor(() => expect(screen.getByRole("button", { name: /Open as draft trend/ })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: /Open as draft trend/ }))
    const { toast } = await import("sonner")
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("A trend with this name exists already"))
    expect(screen.queryByText("trend editor")).not.toBeInTheDocument()
  })

  it("Reject needs a reason and sends it", async () => {
    renderAt("/admin/trend-radar/c1")
    await screen.findByRole("heading", { name: "Phone on the Train" })
    fireEvent.click(screen.getByRole("button", { name: "Reject…" }))
    const dialog = await screen.findByRole("dialog")
    const confirm = within(dialog).getByRole("button", { name: "Reject" })
    expect(confirm).toBeDisabled()
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Reason" }), { target: { value: "a filter, not a clip" } })
    fireEvent.click(confirm)
    await waitFor(() => expect(fake.reject).toHaveBeenCalledWith("c1", { reason: "a filter, not a clip" }))
  })

  it("an approved candidate offers only its draft", async () => {
    fake.candidate.mockResolvedValue(full({ status: "approved", trendId: "t-9" }))
    renderAt("/admin/trend-radar/c1")
    const open = await screen.findByRole("link", { name: "Open the draft trend" })
    expect(open).toHaveAttribute("href", "/admin/trends/t-9")
    expect(screen.queryByRole("button", { name: /Open as draft trend/ })).not.toBeInTheDocument()
  })
})

describe("the settings", () => {
  it("saves the draft whole, only once something changed and it is valid, and is clean again after", async () => {
    renderAt("/admin/trend-radar/settings")
    const save = await screen.findByRole("button", { name: "Save" })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Candidate: distinct creators/), { target: { value: "7" } })
    fireEvent.click(screen.getByRole("button", { name: /Add source/ }))
    // A new source without a name or an address cannot be saved yet.
    expect(save).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent("Every source needs a name.")
    fireEvent.change(screen.getByLabelText("Name of source 2"), { target: { value: "Site B" } })
    fireEvent.change(screen.getByLabelText("Sitemap address of Site B"), { target: { value: "https://b.test/sitemap.xml" } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(fake.updateSettings).toHaveBeenCalledTimes(1))
    expect(fake.updateSettings).toHaveBeenCalledWith({
      sources: [
        { id: "s1", name: "Site A", kind: "sitemap", url: "https://a.test/sitemap.xml", enabled: true },
        { name: "Site B", kind: "sitemap", url: "https://b.test/sitemap.xml", enabled: true },
      ],
      thresholds: { ...SETTINGS.thresholds, minCreators: 7 },
      alerts: SETTINGS.alerts,
      retentionDays: 90,
      runAt: "06:00",
    })
    // The saved answer is the new clean state: nothing to save again.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled())
  })

  it("Discard puts the server's values back; Remove takes a source out; a cleared number blocks Save", async () => {
    renderAt("/admin/trend-radar/settings")
    const save = await screen.findByRole("button", { name: "Save" })
    fireEvent.change(screen.getByLabelText(/Window, days/), { target: { value: "" } })
    expect(save).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent("Window, days needs a number of at least 1.")
    fireEvent.click(screen.getByRole("button", { name: "Discard" }))
    expect(screen.getByLabelText(/Window, days/)).toHaveValue(21)
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Remove Site A" }))
    expect(screen.getByText("No sources yet. Add a template site's sitemap to start.")).toBeInTheDocument()
    expect(save).toBeEnabled()
  })

  it("says so where the radar is not available", async () => {
    fake.settings.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }))
    renderAt("/admin/trend-radar/settings")
    expect(await screen.findByText("Trend Radar is not available on this server yet.")).toBeInTheDocument()
  })
})
