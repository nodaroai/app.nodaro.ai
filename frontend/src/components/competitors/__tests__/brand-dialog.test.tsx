/**
 * The brand window: a card per platform, the platforms side by side, and on a
 * platform what works there, what people say, and the posts; a failed
 * platform offers a full rescan at the price the server charges.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ActionCard, CompetitorDetail, CompetitorLessonsResult, CompetitorPost, TrackedCompetitor } from "@nodaro/shared"
import { en } from "@/lib/i18n/en"

const api = vi.hoisted(() => ({
  getCompetitor: vi.fn(),
  competitorLessons: vi.fn(),
  competitorHistory: vi.fn(),
  competitorCompare: vi.fn(),
  competitorList: vi.fn(),
  competitorCardActions: vi.fn(),
  lookupSavedPosts: vi.fn(),
  savePost: vi.fn(),
  getModelCreditCost: vi.fn(),
}))

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ...api }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/edition", async (orig) => ({ ...(await orig<typeof import("@/lib/edition")>()), hasCredits: () => true }))

import { BrandDialog } from "../brand-dialog"

const ACME: TrackedCompetitor = {
  id: "00000000-0000-4000-8000-0000000000c1",
  brand: "Acme Paint",
  website: "https://acme.example/",
  accounts: { tiktok: "acmepaint" },
  aboutPlatforms: ["reddit", "x"],
  isOwn: false,
  schedule: "weekly",
  nextScanAt: null,
  lastScanAt: "2026-10-01T10:00:00Z",
  lastScanId: "scan-1",
  lastScanError: null,
  scanning: false,
  searches: 3,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
}

function post(id: string, platform: CompetitorPost["platform"], role: CompetitorPost["role"], text: string, views: number): CompetitorPost {
  return {
    id,
    platform,
    url: `https://example.com/${id}`,
    text,
    author: { handle: role === "own" ? "acmepaint" : "a_painter", name: "" },
    publishedAt: "2026-09-30T10:00:00Z",
    metrics: { views },
    media: { kind: "text" },
    hashtags: [],
    extra: {},
    role,
  }
}

const lesson = {
  id: "tiktok:weekday:2",
  kind: "weekday" as const,
  platform: "tiktok",
  params: { day: 2, lift: 3.1, liftLabel: "3.1x", posts: 4, winners: 2, unit: "views" },
  evidence: ["t1"],
  strength: 3.1,
  text: "Their posts on Tuesday: 3.1x their usual views",
}

const DETAIL: CompetitorDetail = {
  ...ACME,
  latestScan: {
    id: "scan-1",
    at: "2026-10-01T10:00:00Z",
    counts: { own: 2, about: 1, searches: 3, failedSearches: 1 },
    posts: [post("t1", "tiktok", "own", "Two coats in an hour", 9000), post("t2", "tiktok", "own", "Brush care basics", 400), post("r1", "reddit", "about", "Has anyone tried Acme Paint?", 120)],
    cards: [],
  },
  scans: [],
  platforms: [
    { platform: "tiktok", own: 2, about: 0, searched: ["own"], failed: [], usual: 1500, unit: "views", top: lesson },
    { platform: "x", own: 0, about: 0, searched: ["about"], failed: ["about"], usual: null, unit: null, top: null },
    { platform: "reddit", own: 0, about: 1, searched: ["about"], failed: [], usual: null, unit: null, top: null },
  ],
}

const LESSONS: CompetitorLessonsResult = {
  lessons: {
    subjectId: ACME.id,
    isOwn: false,
    minPosts: 8,
    platforms: [{ platform: "tiktok", posts: 12, usual: 1500, unit: "views", winners: ["t1"], misses: [], lessons: [lesson] }],
  },
  posts: { t1: DETAIL.latestScan!.posts[0]! },
}

const COMPLAINT: ActionCard = {
  id: "complaints:c1",
  kind: "complaints",
  priority: 1,
  subjectId: ACME.id,
  params: { brand: "Acme Paint", count: 2, example: "Peeled after a week" },
  evidence: ["r1"],
  title: "x",
  why: "x",
  action: "x",
}

function renderDialog(opts: { platform?: "tiktok" | "x" | "reddit" | null; onScan?: () => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <BrandDialog
        target={{ competitor: ACME, platform: opts.platform ?? null }}
        cards={[COMPLAINT]}
        posts={{ r1: DETAIL.latestScan!.posts[2]! }}
        busy={false}
        onScan={opts.onScan ?? vi.fn()}
        onEdit={vi.fn()}
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>,
  )
}

const strip = (s: string | null | undefined) => (s ?? "").replace(/[‎‏]/g, "")

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.getCompetitor.mockResolvedValue(DETAIL)
  api.competitorLessons.mockResolvedValue(LESSONS)
  api.competitorHistory.mockResolvedValue({ scans: [] })
  api.competitorList.mockResolvedValue({ data: [ACME], historyMonths: 3 })
  api.competitorCompare.mockResolvedValue({ periods: [], posts: {} })
  api.lookupSavedPosts.mockResolvedValue(new Map())
  api.competitorCardActions.mockRejectedValue(Object.assign(new Error("not available"), { code: "not_available" }))
  api.getModelCreditCost.mockImplementation(async (model: string) => ({ data: { model, creditCost: model === "competitor-scan:3" ? 23 : 1 } }))
})

describe("the brand window", () => {
  it("opens on every platform: a card each, and the platforms side by side", async () => {
    renderDialog()
    const tabs = await screen.findByRole("tablist", { name: en["competitors.platformsLabel"] })
    const cards = within(tabs).getAllByRole("tab")
    expect(cards.map((c) => c.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false"])
    // In the page's platform order: X, TikTok, Reddit.
    expect(cards[1]).toHaveTextContent(en["competitors.searchFailedCard"])
    expect(cards[2]).toHaveTextContent("TikTok")
    expect(cards[3]).toHaveTextContent("Reddit")
    expect(screen.getByText(en["competitors.allTitle"])).toBeInTheDocument()
    // The table's top insight: the stored lesson, a failed search, what people say.
    const table = strip(screen.getByRole("table").textContent)
    // The weekday is named in the machine's language, so only the rest of the line is pinned.
    expect(table).toMatch(/Posted on [^:]+: 3\.1x the usual views/)
    expect(table).toContain(en["competitors.searchFailedThisScan"])
    expect(table).toContain("People complain: “Has anyone tried Acme Paint?”")
  })

  it("on a platform: what works there, and its posts, best first", async () => {
    renderDialog({ platform: "tiktok" })
    expect(await screen.findByRole("heading", { name: "TikTok" })).toBeInTheDocument()
    expect(await screen.findByText(en["competitors.insightsOn"].replace("{platform}", "TikTok"))).toBeInTheDocument()
    expect(await screen.findByText("4 posts, 2 of the best")).toBeInTheDocument()
    const tab = screen.getByRole("tab", { name: "Their posts (2)" })
    expect(tab).toHaveAttribute("aria-selected", "true")
    const texts = screen.getAllByText(/Two coats in an hour|Brush care basics/).map((el) => el.textContent)
    expect(texts[0]).toContain("Two coats in an hour")
    expect(strip(screen.getByRole("heading", { name: "TikTok" }).parentElement?.textContent)).toContain("1.5K views")
  })

  it("opens a platform only searched for posts about the brand on those posts", async () => {
    renderDialog({ platform: "reddit" })
    const tab = await screen.findByRole("tab", { name: "About them (1)" })
    expect(tab).toHaveAttribute("aria-selected", "true")
    expect(screen.queryByRole("tab", { name: /Their posts/ })).toBeNull()
    expect(screen.getAllByText("Has anyone tried Acme Paint?").length).toBeGreaterThan(0)
  })

  it("on a failed platform offers to scan the whole brand again, at the price the server charges", async () => {
    const onScan = vi.fn()
    renderDialog({ platform: "x", onScan })
    expect(await screen.findByText("The X search failed on the last scan, so there is nothing to show yet.")).toBeInTheDocument()
    expect(screen.getByText(en["competitors.rescanHint"])).toBeInTheDocument()
    const again = screen.getByRole("button", { name: /Scan Acme Paint again/ })
    await waitFor(() => expect(again).toHaveTextContent("23"))
    fireEvent.click(again)
    expect(onScan).toHaveBeenCalledWith(expect.objectContaining({ id: ACME.id }))
  })

  it("speaks to the person about their own brand", async () => {
    api.getCompetitor.mockResolvedValue({ ...DETAIL, isOwn: true })
    renderDialog()
    expect(await screen.findByText(en["competitors.allTitleOwn"])).toBeInTheDocument()
    expect(screen.getAllByText(en["competitors.legendYours"]).length).toBeGreaterThan(0)
  })

  it("speaks of the person's own posts on a platform as theirs", async () => {
    api.getCompetitor.mockResolvedValue({ ...DETAIL, isOwn: true })
    renderDialog({ platform: "tiktok" })
    expect(await screen.findByRole("tab", { name: "Your posts (2)" })).toHaveAttribute("aria-selected", "true")
  })

  it("counts each card in a whole phrase, singular for one", async () => {
    renderDialog()
    const tabs = await screen.findByRole("tablist", { name: en["competitors.platformsLabel"] })
    const cards = within(tabs).getAllByRole("tab")
    expect(strip(cards[0]!.textContent)).toContain("2 posts by them")
    expect(strip(cards[3]!.textContent)).toContain("1 post about them")
  })

  it("moves along the platforms with the arrow keys, and shows the chosen one's panel", async () => {
    renderDialog()
    const tabs = await screen.findByRole("tablist", { name: en["competitors.platformsLabel"] })
    const cards = within(tabs).getAllByRole("tab")
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", cards[0]!.id)
    cards[0]!.focus()
    fireEvent.keyDown(cards[0]!, { key: "ArrowRight" })
    await waitFor(() => expect(cards[1]).toHaveAttribute("aria-selected", "true"))
    expect(document.activeElement).toBe(cards[1])
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", cards[1]!.id)
  })

  it("says so when what works there could not be read", async () => {
    api.competitorLessons.mockRejectedValue(new Error("down"))
    renderDialog({ platform: "tiktok" })
    expect(await screen.findByText(en["apiErr.loadCompetitorLessons"])).toBeInTheDocument()
  })
})

describe("the brand window over time", () => {
  const point = (id: string, at: string, followers: number | null, own: number) => ({ id, at, platforms: [{ platform: "tiktok", own, about: 0, followers, usual: null, unit: "views" }] })

  it("offers the scans to show and opens the brand as of the chosen one", async () => {
    api.competitorHistory.mockResolvedValue({ scans: [point("00000000-0000-4000-8000-0000000000a1", "2026-09-24T10:00:00Z", 1000, 2), point("00000000-0000-4000-8000-0000000000a2", "2026-10-01T10:00:00Z", 1200, 3)] })
    renderDialog()
    const picker = await screen.findByLabelText(en["competitors.pickScan"])
    // The dates are named in the machine's language, so the order and the ids are what is pinned: the latest, then newest first.
    const options = within(picker).getAllByRole("option")
    expect(options[0]!.textContent).toBe(en["competitors.viewLatest"])
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(["", "00000000-0000-4000-8000-0000000000a2", "00000000-0000-4000-8000-0000000000a1"])
    expect(options.slice(1).every((o) => o.textContent?.startsWith("Scan of "))).toBe(true)
    fireEvent.change(picker, { target: { value: "00000000-0000-4000-8000-0000000000a1" } })
    await waitFor(() => expect(api.getCompetitor).toHaveBeenCalledWith(ACME.id, "00000000-0000-4000-8000-0000000000a1"))
  })

  it("compares the last seven days with the seven before, platform by platform", async () => {
    api.competitorCompare.mockResolvedValue({
      periods: [
        { from: "a", to: "a", platforms: [{ platform: "tiktok", own: 3, about: 1, usual: 600, unit: "views", followers: { value: 1200, at: "2026-10-04T00:00:00Z" }, change: 100, lessons: [lesson], best: ["t1"] }] },
        { from: "b", to: "b", platforms: [{ platform: "tiktok", own: 1, about: 0, usual: null, unit: "views", followers: { value: 1100, at: "2026-09-27T00:00:00Z" }, change: null, lessons: [], best: [] }] },
      ],
      posts: { t1: DETAIL.latestScan!.posts[0]! },
    })
    renderDialog()
    fireEvent.click(await screen.findByRole("button", { name: en["competitors.viewOverTime"] }))
    expect(await screen.findByText(en["competitors.historyKept"].replace("{n}", "3"))).toBeInTheDocument()
    const row = (await screen.findByRole("rowheader", { name: /TikTok/ })).closest("tr") as HTMLElement
    const cells = within(row).getAllByRole("cell").map((c) => strip(c.textContent))
    expect(cells.slice(0, 4)).toEqual(["3", "1", "600 views", "1.2K followers+100"])
    expect(cells[4]).toMatch(/3\.1x the usual views/)
    expect(cells.slice(6, 10)).toEqual(["1", "0", "—", "1.1K followers"])
    const input = api.competitorCompare.mock.calls[0]![1] as { vsFrom?: string }
    expect(input.vsFrom).toBeDefined()
    expect(within(row).getAllByRole("button", { name: new RegExp(`^${en["social.readPost"]}:`) }).length).toBeGreaterThan(0)
  })

  it("a single day stands alone, and backwards custom dates are refused", async () => {
    renderDialog()
    fireEvent.click(await screen.findByRole("button", { name: en["competitors.viewOverTime"] }))
    fireEvent.click(await screen.findByRole("button", { name: en["competitors.presetDay"] }))
    await waitFor(() => expect(api.competitorCompare).toHaveBeenLastCalledWith(ACME.id, expect.not.objectContaining({ vsFrom: expect.anything() })))
    fireEvent.click(screen.getByRole("button", { name: en["competitors.presetCustom"] }))
    const calls = api.competitorCompare.mock.calls.length
    const from = screen.getAllByLabelText(en["competitors.periodFrom"])[0] as HTMLInputElement
    fireEvent.change(from, { target: { value: "2026-12-31" } })
    expect(await screen.findByText(en["competitors.periodInvalid"])).toBeInTheDocument()
    expect(api.competitorCompare.mock.calls.length).toBe(calls)
  })

  it("a point on the followers line opens that scan", async () => {
    api.competitorHistory.mockResolvedValue({ scans: [point("00000000-0000-4000-8000-0000000000a1", "2026-09-24T10:00:00Z", 1000, 2), point("00000000-0000-4000-8000-0000000000a2", "2026-10-01T10:00:00Z", 1200, 3)] })
    renderDialog()
    fireEvent.click(await screen.findByRole("button", { name: en["competitors.viewOverTime"] }))
    // Oldest first along the line: the first point is the September scan.
    const dots = await screen.findAllByRole("button", { name: /Open the scan of/ })
    expect(dots).toHaveLength(2)
    fireEvent.click(dots[0]!)
    await waitFor(() => expect(api.getCompetitor).toHaveBeenCalledWith(ACME.id, "00000000-0000-4000-8000-0000000000a1"))
    expect(screen.getByRole("button", { name: en["competitors.viewLatest"] })).toHaveAttribute("aria-pressed", "true")
  })
})
