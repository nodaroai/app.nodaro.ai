/**
 * The Competitors page: the tracked brands, the action cards with the posts
 * they rest on, adding a brand from its website, scanning, the schedule, and
 * a removal that asks first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import type { CardAction, CompetitorCardsResult, CompetitorDiscovery, TrackedCompetitor } from "@nodaro/shared"
import { en } from "@/lib/i18n/en"

const api = vi.hoisted(() => ({
  listCompetitors: vi.fn(),
  competitorCards: vi.fn(),
  createCompetitor: vi.fn(),
  updateCompetitor: vi.fn(),
  deleteCompetitor: vi.fn(),
  scanCompetitor: vi.fn(),
  discoverCompetitor: vi.fn(),
  getCompetitor: vi.fn(),
  lookupSavedPosts: vi.fn(),
  savePost: vi.fn(),
  getModelCreditCost: vi.fn(),
  competitorCardActions: vi.fn(),
  markCardDone: vi.fn(),
  updateCardMark: vi.fn(),
  deleteCardMark: vi.fn(),
}))

vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), ...api }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// A Cloud build: prices are shown, read live from the server.
vi.mock("@/lib/edition", async (orig) => ({ ...(await orig<typeof import("@/lib/edition")>()), hasCredits: () => true }))

import CompetitorsPage from "../page"

const ACME: TrackedCompetitor = {
  id: "00000000-0000-4000-8000-0000000000c1",
  brand: "Acme Paint",
  website: "https://acme.example/",
  accounts: { tiktok: "acmepaint" },
  aboutPlatforms: ["reddit"],
  isOwn: false,
  schedule: "weekly",
  nextScanAt: null,
  lastScanAt: "2026-10-01T10:00:00Z",
  lastScanId: "scan-1",
  lastScanError: null,
  scanning: false,
  searches: 2,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
}

const CARDS: CompetitorCardsResult = {
  cards: [
    {
      id: "outlier:c1:p1",
      kind: "outlier",
      priority: 1,
      subjectId: ACME.id,
      params: { brand: "Acme Paint", own: false, platform: "tiktok", ratio: 5, over100: false, reach: 5000, usual: 1000, unit: "views" },
      evidence: ["tiktok:1"],
      title: "x",
      why: "x",
      action: "x",
    },
  ],
  posts: {
    "tiktok:1": {
      id: "tiktok:1",
      platform: "tiktok",
      url: "https://www.tiktok.com/@acmepaint/video/1",
      text: "Three coats, one afternoon",
      author: { handle: "acmepaint", name: "Acme" },
      metrics: { views: 5000 },
      media: { kind: "video" },
      hashtags: [],
      extra: {},
      role: "own",
    },
  },
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CompetitorsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.listCompetitors.mockResolvedValue([ACME])
  api.competitorCards.mockResolvedValue(CARDS)
  api.lookupSavedPosts.mockResolvedValue(new Map())
  // A server with no place for marks yet: no "I did this" (the tests below give it one).
  api.competitorCardActions.mockRejectedValue(Object.assign(new Error("not available"), { code: "not_available" }))
  // The live price differs from the static table (2 searches = 40), as it
  // does with a retuned price or a markup.
  api.getModelCreditCost.mockImplementation(async (model: string) => ({ data: { model, creditCost: model === "competitor-scan:2" ? 23 : 1 } }))
})

describe("Competitors page", () => {
  it("shows the cards in the reader's words, with the posts they rest on, and the tracked brands", async () => {
    renderPage()
    expect(await screen.findByText("Acme Paint's TikTok post did 5x their usual")).toBeInTheDocument()
    expect(screen.getByText("Three coats, one afternoon")).toBeInTheDocument()
    expect(screen.getByText("Acme Paint")).toBeInTheDocument()
    expect(screen.getByText("2 searches per scan")).toBeInTheDocument()
  })

  it("saves a card's post to Inspiration from its bookmark", async () => {
    api.savePost.mockResolvedValue({ id: "save-1" })
    renderPage()
    await screen.findByText("Three coats, one afternoon")
    fireEvent.click(screen.getByRole("button", { name: en["social.saveToWall"] }))
    await waitFor(() => expect(api.savePost).toHaveBeenCalledWith({ post: CARDS.posts["tiktok:1"], source: "competitors" }))
  })

  it("adds a brand from its website, marking the guessed accounts", async () => {
    api.discoverCompetitor.mockResolvedValue({
      brand: "Boltly",
      website: "https://boltly.example/",
      accounts: { instagram: { value: "boltly", from: "site" }, tiktok: { value: "boltly", from: "guess" } },
    })
    api.createCompetitor.mockResolvedValue({ ...ACME, id: "c2", brand: "Boltly" })
    renderPage()
    await screen.findByText("Acme Paint")
    fireEvent.click(screen.getByRole("button", { name: en["competitors.add"] }))

    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByPlaceholderText("acme.com"), { target: { value: "boltly.example" } })
    fireEvent.click(within(dialog).getByRole("button", { name: en["competitors.findAccounts"] }))
    await within(dialog).findByText(en["competitors.guess"])
    fireEvent.click(within(dialog).getByRole("button", { name: en["common.save"] }))

    await waitFor(() =>
      expect(api.createCompetitor).toHaveBeenCalledWith({
        brand: "Boltly",
        website: "https://boltly.example/",
        accounts: { tiktok: "boltly", instagram: "boltly" },
        aboutPlatforms: ["tiktok", "instagram", "youtube", "x", "reddit"],
        schedule: "weekly",
        isOwn: false,
      }),
    )
  })

  it("shows the price the server charges for a scan, not the static table's", async () => {
    renderPage()
    await screen.findByText("Acme Paint")
    const button = screen.getByRole("button", { name: new RegExp(en["competitors.scanNow"]) })
    await waitFor(() => expect(button).toHaveTextContent("23"))
    expect(api.getModelCreditCost).toHaveBeenCalledWith("competitor-scan:2")
  })

  it("edits a brand by sending only what changed", async () => {
    api.updateCompetitor.mockResolvedValue({ ...ACME, brand: "Acme Paints" })
    renderPage()
    await screen.findByText("Acme Paint")
    fireEvent.click(screen.getByRole("button", { name: en["competitors.edit"] }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByDisplayValue("Acme Paint"), { target: { value: "Acme Paints" } })
    fireEvent.click(within(dialog).getByRole("button", { name: en["common.save"] }))
    await waitFor(() => expect(api.updateCompetitor).toHaveBeenCalledWith(ACME.id, { brand: "Acme Paints" }))
  })

  it("drops a website lookup that answers after the form moved on to another brand", async () => {
    let answer: (found: CompetitorDiscovery) => void = () => undefined
    api.discoverCompetitor.mockImplementation(() => new Promise<CompetitorDiscovery>((resolve) => (answer = resolve)))
    renderPage()
    await screen.findByText("Acme Paint")
    fireEvent.click(screen.getByRole("button", { name: en["competitors.add"] }))
    const adding = await screen.findByRole("dialog")
    fireEvent.change(within(adding).getByPlaceholderText("acme.com"), { target: { value: "boltly.example" } })
    fireEvent.click(within(adding).getByRole("button", { name: en["competitors.findAccounts"] }))
    fireEvent.click(within(adding).getByRole("button", { name: en["common.cancel"] }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    fireEvent.click(screen.getByRole("button", { name: en["competitors.edit"] }))
    const editing = await screen.findByRole("dialog")
    answer({ brand: "Boltly", website: "https://boltly.example/", accounts: { instagram: { value: "boltly", from: "site" } } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(within(editing).getByDisplayValue("https://acme.example/")).toBeInTheDocument()
    expect(within(editing).queryByDisplayValue("boltly")).toBeNull()
  })

  it("scans a brand, and changes its schedule", async () => {
    api.scanCompetitor.mockResolvedValue({ jobId: "job-1" })
    api.updateCompetitor.mockResolvedValue({ ...ACME, schedule: "daily" })
    renderPage()
    await screen.findByText("Acme Paint")
    fireEvent.click(screen.getByRole("button", { name: new RegExp(en["competitors.scanNow"]) }))
    await waitFor(() => expect(api.scanCompetitor).toHaveBeenCalledWith(ACME.id))

    fireEvent.change(screen.getByLabelText(en["competitors.schedule"]), { target: { value: "daily" } })
    await waitFor(() => expect(api.updateCompetitor).toHaveBeenCalledWith(ACME.id, { schedule: "daily" }))
  })

  it("stops tracking a brand only after the confirmation", async () => {
    api.deleteCompetitor.mockResolvedValue(undefined)
    renderPage()
    await screen.findByText("Acme Paint")
    fireEvent.click(screen.getByRole("button", { name: en["competitors.remove"] }))
    expect(api.deleteCompetitor).not.toHaveBeenCalled()
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: en["common.remove"] }))
    await waitFor(() => expect(api.deleteCompetitor).toHaveBeenCalledWith(ACME.id))
  })

  it("explains how to start when nothing is tracked", async () => {
    api.listCompetitors.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(en["competitors.empty"])).toBeInTheDocument()
    expect(api.competitorCards).not.toHaveBeenCalled()
  })
})

describe("did it work", () => {
  const mark = (over: Partial<CardAction> = {}): CardAction => ({
    id: "00000000-0000-4000-8000-0000000000a1",
    cardId: CARDS.cards[0]!.id,
    cardKind: "outlier",
    card: { title: "x", why: "x", action: "x", priority: 1, params: CARDS.cards[0]!.params, evidence: ["tiktok:1"] },
    subjectId: ACME.id,
    postUrl: null,
    linkedAt: null,
    actedAt: "2026-10-02T00:00:00Z",
    verdict: null,
    seenAt: null,
    onWall: true,
    outcome: { state: "no_posts_yet" },
    ...over,
  })

  it("offers no button while the server has no place for marks", async () => {
    renderPage()
    await screen.findByText("Acme Paint's TikTok post did 5x their usual")
    expect(screen.queryByRole("button", { name: en["marks.iDidThis"] })).toBeNull()
  })

  it("marks a card done at once, and keeps it on the wall with a place for the post's link", async () => {
    // Nothing marked yet; once marked, the server lists the mark.
    api.competitorCardActions.mockResolvedValueOnce({ actions: [], record: [], posts: {} }).mockResolvedValue({ actions: [mark()], record: [], posts: {} })
    api.markCardDone.mockResolvedValue({ action: mark(), posts: {}, created: true })
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: en["marks.iDidThis"] }))
    await waitFor(() => expect(api.markCardDone).toHaveBeenCalledWith({ cardId: CARDS.cards[0]!.id }))
    expect(await screen.findByPlaceholderText(en["marks.linkPlaceholder"])).toBeInTheDocument()
    expect(screen.getByText("Acme Paint's TikTok post did 5x their usual")).toBeInTheDocument()
  })

  it("says when a result is in, and shows it in Tried, then marks it seen", async () => {
    const verdict = { state: "worked" as const, ratio: 2.1, reach: 8400, usual: 4000, unit: "views" as const, platform: "tiktok", postId: "tiktok:9", matchedBy: "link" as const, at: "2026-10-05T00:00:00Z" }
    const done = mark({ postUrl: "https://www.tiktok.com/@me/video/9", verdict, outcome: { state: "worked", ratio: 2.1, reach: 8400, usual: 4000, unit: "views", platform: "tiktok", postIds: ["tiktok:9"], matchedBy: "link" } })
    api.competitorCardActions.mockResolvedValue({
      actions: [done],
      record: [{ family: "outlier", tried: 3, worked: 2, flat: 1, missed: 0, avgRatio: 1.9, shown: true, tier: "proven" }],
      posts: {},
    })
    api.updateCardMark.mockResolvedValue({ action: { ...done, seenAt: "2026-10-05T01:00:00Z" }, posts: {} })
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(en["marks.resultsInOne"]) }))
    expect(await screen.findByText("Worked: 2.1x your usual")).toBeInTheDocument()
    expect(screen.getByText("2 of 3 worked for you")).toBeInTheDocument()
    await waitFor(() => expect(api.updateCardMark).toHaveBeenCalledWith(done.id, { seen: true }), { timeout: 3000 })
    expect(api.updateCardMark).toHaveBeenCalledTimes(1)
  })
})
