/**
 * The Topics page: the topics a person follows with their scan price by
 * pages, adding one (the payload), removing one, a topic's window (posts by
 * reach, its cards, its scans over time), the locked state of a plan without
 * topics, and a server without topic routes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { topicScanPages, type TopicDetail, type TopicListResult, type TrackedTopic } from "@nodaro/shared/social"
import { en } from "@/lib/i18n/en"

const api = vi.hoisted(() => ({
  listTopics: vi.fn(),
  getTopic: vi.fn(),
  topicHistory: vi.fn(),
  topicCards: vi.fn(),
  createTopic: vi.fn(),
  updateTopic: vi.fn(),
  deleteTopic: vi.fn(),
  scanTopic: vi.fn(),
  lookupSavedPosts: vi.fn(),
  savePost: vi.fn(),
  getModelCreditCost: vi.fn(),
}))
const sale = vi.hoisted(() => ({ on: true }))

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ...api }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// A Cloud build: prices are shown, read live from the server.
vi.mock("@/lib/edition", async (orig) => ({ ...(await orig<typeof import("@/lib/edition")>()), hasCredits: () => true }))
vi.mock("@/lib/plans-on-sale", () => ({ plansOnSale: () => sale.on }))

import TopicsPage from "../page"
import { scanBlocks } from "@/components/topics/topic-scan-rights"
import { topicsBodyState } from "@/components/topics/use-topics-page"

const AI_VIDEO: TrackedTopic = {
  id: "00000000-0000-4000-8000-0000000000t1",
  name: "AI video",
  term: "#aivideo",
  platforms: ["tiktok", "youtube"],
  postCount: 40,
  schedule: "weekly",
  nextScanAt: null,
  lastScanAt: "2026-11-10T10:00:00Z",
  lastScanId: "scan-1",
  lastScanError: null,
  scanning: false,
  pages: 3,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
}

const LIST: TopicListResult = { data: [AI_VIDEO], limits: { topics: 10 }, historyMonths: 3 }

function post(id: string, platform: "tiktok" | "youtube", text: string, views: number) {
  return {
    id,
    platform,
    url: `https://example.com/${id}`,
    text,
    author: { handle: `maker_${id}`, name: "" },
    publishedAt: "2026-11-09T10:00:00Z",
    metrics: { views },
    media: { kind: "text" as const },
    hashtags: [],
    extra: {},
  }
}

const DETAIL: TopicDetail = {
  ...AI_VIDEO,
  latestScan: {
    id: "scan-1",
    at: "2026-11-10T10:00:00Z",
    counts: { posts: 3, searches: 2, failedSearches: 0 },
    posts: [post("p1", "tiktok", "Small reach", 100), post("p2", "youtube", "Huge reach", 90_000), post("p3", "tiktok", "Middle reach", 5_000)],
    cards: [
      {
        id: "spreading:t1:p2",
        kind: "spreading",
        priority: 1,
        subjectId: AI_VIDEO.id,
        params: { brand: "AI video", platform: "youtube", reach: 90_000, perDay: 30_000, unit: "views", firstLine: "Huge reach" },
        evidence: ["p2"],
        title: "x",
        why: "x",
        action: "x",
      },
    ],
  },
  scans: [],
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TopicsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  sale.on = true
  api.listTopics.mockResolvedValue(LIST)
  api.topicCards.mockResolvedValue({ cards: [], posts: {} })
  api.topicHistory.mockResolvedValue({ scans: [] })
  api.lookupSavedPosts.mockResolvedValue(new Map())
  api.getModelCreditCost.mockImplementation(async (model: string) => ({ data: { model, creditCost: model === "topic-scan:per-page:3u" ? 47 : 1 } }))
})

describe("the topics", () => {
  it("lists each topic with its term, depth, schedule and last scan, and scans it at the price of its pages", async () => {
    api.scanTopic.mockResolvedValue({ jobId: "job-1" })
    renderPage()
    const name = await screen.findByRole("button", { name: en["topics.openTopic"].replace("{name}", "AI video") })
    const row = name.closest("li") as HTMLElement
    expect(within(row).getByText("#aivideo")).toBeInTheDocument()
    expect(within(row).getByText(en["topics.postsPerSearch"].replace("{n}", "40"))).toBeInTheDocument()
    expect(within(row).getByText(en["competitors.scheduleWeekly"])).toBeInTheDocument()
    expect(within(row).getByText(/Last scan/)).toBeInTheDocument()
    const scan = within(row).getByRole("button", { name: new RegExp(en["competitors.scanNow"]) })
    await waitFor(() => expect(scan).toHaveTextContent("47"))
    expect(api.getModelCreditCost).toHaveBeenCalledWith("topic-scan:per-page:3u")
    fireEvent.click(scan)
    await waitFor(() => expect(api.scanTopic).toHaveBeenCalledWith(AI_VIDEO.id))
  })

  it("adds a topic: the name, the term, the platforms, the posts per search and the schedule, priced by pages", async () => {
    api.createTopic.mockResolvedValue({ ...AI_VIDEO, id: "t2", name: "Robot vacuums" })
    renderPage()
    await screen.findByRole("button", { name: en["topics.openTopic"].replace("{name}", "AI video") })
    fireEvent.click(screen.getByRole("button", { name: en["topics.add"] }))
    const dialog = await screen.findByRole("dialog")
    const save = within(dialog).getByRole("button", { name: en["common.save"] })
    expect(save).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText(en["topics.name"]), { target: { value: "Robot vacuums" } })
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${en["topics.term"]}`)), { target: { value: "  #robot  vacuum " } })
    // Off TikTok, onto Reddit; 40 posts per search.
    fireEvent.click(within(dialog).getByRole("button", { name: "TikTok" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Reddit" }))
    fireEvent.click(within(dialog).getByRole("radio", { name: en["topics.postCountOption"].replace("{n}", "40") }))
    const pages = topicScanPages({ platforms: ["instagram", "youtube", "x", "reddit"], postCount: 40 })
    await waitFor(() => expect(api.getModelCreditCost).toHaveBeenCalledWith(`topic-scan:per-page:${pages}u`))
    expect(within(dialog).getByText(en["topics.priceLine"].replace("{n}", String(pages)))).toBeInTheDocument()
    fireEvent.click(save)
    await waitFor(() =>
      expect(api.createTopic).toHaveBeenCalledWith({
        name: "Robot vacuums",
        term: "#robot vacuum",
        platforms: ["instagram", "youtube", "x", "reddit"],
        postCount: 40,
        schedule: "weekly",
      }),
    )
  })

  it("searches the name when no term is typed, and needs a platform", async () => {
    api.createTopic.mockResolvedValue({ ...AI_VIDEO, id: "t3", name: "Cold brew" })
    renderPage()
    await screen.findByRole("button", { name: en["topics.openTopic"].replace("{name}", "AI video") })
    fireEvent.click(screen.getByRole("button", { name: en["topics.add"] }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(en["topics.name"]), { target: { value: "Cold brew" } })
    for (const p of ["TikTok", "Instagram", "YouTube", "X"]) fireEvent.click(within(dialog).getByRole("button", { name: p }))
    expect(within(dialog).getByText(en["topics.pickPlatform"])).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: en["common.save"] })).toBeDisabled()
    fireEvent.click(within(dialog).getByRole("button", { name: "X" }))
    fireEvent.click(within(dialog).getByRole("button", { name: en["common.save"] }))
    await waitFor(() => expect(api.createTopic).toHaveBeenCalledWith({ name: "Cold brew", term: "Cold brew", platforms: ["x"], postCount: 20, schedule: "weekly" }))
  })

  it("edits a topic by sending only what changed", async () => {
    api.updateTopic.mockResolvedValue({ ...AI_VIDEO, postCount: 60 })
    renderPage()
    const name = await screen.findByRole("button", { name: en["topics.openTopic"].replace("{name}", "AI video") })
    fireEvent.click(within(name.closest("li") as HTMLElement).getByRole("button", { name: en["competitors.edit"] }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("radio", { name: en["topics.postCountOption"].replace("{n}", "60") }))
    fireEvent.click(within(dialog).getByRole("button", { name: en["common.save"] }))
    await waitFor(() => expect(api.updateTopic).toHaveBeenCalledWith(AI_VIDEO.id, { postCount: 60 }))
  })

  it("stops following a topic only after the confirmation", async () => {
    api.deleteTopic.mockResolvedValue(undefined)
    renderPage()
    const name = await screen.findByRole("button", { name: en["topics.openTopic"].replace("{name}", "AI video") })
    fireEvent.click(within(name.closest("li") as HTMLElement).getByRole("button", { name: en["competitors.remove"] }))
    const confirm = await screen.findByRole("alertdialog")
    expect(within(confirm).getByText(en["topics.removeTitle"].replace("{name}", "AI video"))).toBeInTheDocument()
    fireEvent.click(within(confirm).getByRole("button", { name: en["common.remove"] }))
    await waitFor(() => expect(api.deleteTopic).toHaveBeenCalledWith(AI_VIDEO.id))
  })

  it("explains how to start when nothing is followed", async () => {
    api.listTopics.mockResolvedValue({ ...LIST, data: [] })
    renderPage()
    expect(await screen.findByText(en["topics.empty"])).toBeInTheDocument()
    expect(api.topicCards).not.toHaveBeenCalled()
  })

  it("offers no new topic once the plan's are all in use", async () => {
    api.listTopics.mockResolvedValue({ ...LIST, limits: { topics: 1 } })
    renderPage()
    expect(await screen.findByText(en["topics.atCapOne"])).toBeInTheDocument()
    expect(screen.getByRole("button", { name: en["topics.add"] })).toBeDisabled()
  })
})

describe("a topic's window", () => {
  it("shows its cards, its posts most reached first, and its scans per platform", async () => {
    api.getTopic.mockResolvedValue(DETAIL)
    api.topicHistory.mockResolvedValue({
      scans: [
        { id: "scan-0", at: "2026-11-03T10:00:00Z", platforms: [{ platform: "tiktok", posts: 4, reach: 1200 }] },
        { id: "scan-1", at: "2026-11-10T10:00:00Z", platforms: [{ platform: "tiktok", posts: 2, reach: 5100 }, { platform: "youtube", posts: 1, reach: null }] },
      ],
    })
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: en["topics.openTopic"].replace("{name}", "AI video") }))
    const dialog = await screen.findByRole("dialog")
    expect(await within(dialog).findByText("A post about AI video is spreading fast")).toBeInTheDocument()
    const grid = within(dialog).getByText(en["topics.postsTitle"]).closest("section") as HTMLElement
    const texts = ["Huge reach", "Middle reach", "Small reach"].map((text) => within(grid).getAllByText(text)[0]!)
    expect(texts[0]!.compareDocumentPosition(texts[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(texts[1]!.compareDocumentPosition(texts[2]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const table = await within(dialog).findByRole("table")
    const rows = within(table).getAllByRole("row")
    // The header, then the newest scan first: TikTok 2 and YouTube 1, then TikTok 4 with nothing on YouTube.
    expect(rows).toHaveLength(3)
    expect(rows[1]).toHaveTextContent("2")
    expect(rows[1]).toHaveTextContent("1")
    expect(rows[2]).toHaveTextContent("4")
    expect(rows[2]).toHaveTextContent("—")
  })
})

describe("plans and servers without topics", () => {
  it("shows the plans a press away when the plan has no topics, and offers no topic to add", async () => {
    api.listTopics.mockResolvedValue({ data: [], limits: { topics: 0 }, historyMonths: 1 })
    renderPage()
    expect(await screen.findByRole("link", { name: en["credits.viewPlans"] })).toHaveAttribute("href", "/pricing")
    expect(screen.queryByRole("button", { name: en["topics.add"] })).toBeNull()
    expect(screen.queryByText(en["topics.empty"])).toBeNull()
  })

  it("says the plan has no topics without a purchase link where nothing can be bought", async () => {
    sale.on = false
    api.listTopics.mockResolvedValue({ data: [], limits: { topics: 0 }, historyMonths: 1 })
    renderPage()
    expect(await screen.findByText(en["topics.locked"])).toBeInTheDocument()
    expect(screen.queryByRole("link")).toBeNull()
  })

  it("says topic tracking is not available on a server without its routes (404)", async () => {
    api.listTopics.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByText(en["topics.unavailable"])).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: en["topics.add"] })).toBeNull()
  })

  it("says the same while the server is not ready for topics", async () => {
    api.listTopics.mockRejectedValue(Object.assign(new Error("Topics are not available yet."), { code: "not_ready" }))
    renderPage()
    expect(await screen.findByText(en["topics.unavailable"])).toBeInTheDocument()
    expect(screen.queryByText(en["apiErr.loadTopics"])).toBeNull()
  })

  it("keeps the topics of a plan that no longer has any, and offers them no scan, with why", async () => {
    api.listTopics.mockResolvedValue({ data: [AI_VIDEO], limits: { topics: 0 }, historyMonths: 1 })
    api.getTopic.mockResolvedValue(DETAIL)
    renderPage()
    const name = await screen.findByRole("button", { name: en["topics.openTopic"].replace("{name}", "AI video") })
    expect(screen.getByRole("link", { name: en["credits.viewPlans"] })).toBeInTheDocument()
    const row = name.closest("li") as HTMLElement
    const scan = within(row).getByRole("button", { name: new RegExp(en["competitors.scanNow"]) })
    expect(scan).toBeDisabled()
    expect(scan).toHaveAccessibleDescription(new RegExp(en["topics.scanBlockedLocked"]))
    fireEvent.click(name)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("button", { name: new RegExp(en["competitors.scanNow"]) })).toBeDisabled()
    expect(within(dialog).getByText(en["topics.scanBlockedLocked"])).toBeInTheDocument()
  })

  it("after a downgrade, scans only the oldest topics the plan allows (by creation, then id)", async () => {
    const newer: TrackedTopic = { ...AI_VIDEO, id: "00000000-0000-4000-8000-0000000000t2", name: "Robot vacuums", createdAt: "2026-11-05T00:00:00Z" }
    const sameTime: TrackedTopic = { ...AI_VIDEO, id: "00000000-0000-4000-8000-0000000000t0", name: "Cold brew" }
    api.listTopics.mockResolvedValue({ data: [newer, AI_VIDEO, sameTime], limits: { topics: 2 }, historyMonths: 1 })
    renderPage()
    const rowOf = async (topic: string) => (await screen.findByRole("button", { name: en["topics.openTopic"].replace("{name}", topic) })).closest("li") as HTMLElement
    const scanOf = async (topic: string) => within(await rowOf(topic)).getByRole("button", { name: new RegExp(en["competitors.scanNow"]) })
    expect(await scanOf("Cold brew")).toBeEnabled()
    expect(await scanOf("AI video")).toBeEnabled()
    expect(await scanOf("Robot vacuums")).toBeDisabled()
    expect(within(await rowOf("Robot vacuums")).getByText(en["topics.scanBlockedOverCap"].replace("{n}", "2"))).toBeInTheDocument()
    // At the cap: no new topic.
    expect(screen.getByRole("button", { name: en["topics.add"] })).toBeDisabled()
  })

  it("treats a list without the plan's limits as unknown, not locked: no banner, Add on, every topic scans", async () => {
    api.listTopics.mockResolvedValue({ data: [AI_VIDEO] })
    renderPage()
    const name = await screen.findByRole("button", { name: en["topics.openTopic"].replace("{name}", "AI video") })
    expect(within(name.closest("li") as HTMLElement).getByRole("button", { name: new RegExp(en["competitors.scanNow"]) })).toBeEnabled()
    expect(screen.getByRole("button", { name: en["topics.add"] })).toBeEnabled()
    expect(screen.queryByRole("link", { name: en["credits.viewPlans"] })).toBeNull()
    expect(screen.queryByText(en["topics.locked"])).toBeNull()
  })
})

describe("the page body's state", () => {
  it("keeps a list already read when a later read fails, and tells a missing server from a failure", () => {
    const err = new Error("down")
    expect(topicsBodyState({ data: undefined, error: null })).toBe("loading")
    expect(topicsBodyState({ data: LIST, error: err })).toBe("ready")
    expect(topicsBodyState({ data: undefined, error: err })).toBe("error")
    expect(topicsBodyState({ data: null, error: null })).toBe("unavailable")
    expect(topicsBodyState({ data: undefined, error: Object.assign(new Error("x"), { code: "not_ready" }) })).toBe("unavailable")
  })
})

describe("which topics can scan", () => {
  const topic = (id: string, createdAt: string) => ({ id, createdAt })
  it("none on a plan without topics, all with no cap or within it, and past it only the oldest", () => {
    const topics = [topic("b", "2026-11-02T00:00:00Z"), topic("a", "2026-11-02T00:00:00.000+00:00"), topic("c", "2026-11-01T00:00:00Z")]
    expect([...scanBlocks(topics, 0).entries()]).toEqual([["b", "locked"], ["a", "locked"], ["c", "locked"]])
    expect(scanBlocks(topics, null).size).toBe(0)
    expect(scanBlocks(topics, undefined).size).toBe(0)
    expect(scanBlocks(topics, 3).size).toBe(0)
    // c is oldest; a and b were made at the same moment (written two ways), so the smaller id goes first.
    expect([...scanBlocks(topics, 2).entries()]).toEqual([["b", "overCap"]])
  })
})
