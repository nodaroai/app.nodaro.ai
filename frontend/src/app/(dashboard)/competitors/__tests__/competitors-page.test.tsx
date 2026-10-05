/**
 * The Competitors page: who is where (each brand against each platform),
 * ranking by a platform and what works on it, the action cards with their
 * filters, adding / editing / scanning / scheduling / removing a brand from
 * its row, and "did it work?".
 */
import { createContext, useContext, type ReactNode } from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import type { CardAction, CompetitorCardsResult, CompetitorDetail, CompetitorDiscovery, TrackedCompetitor } from "@nodaro/shared"
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
  competitorLessons: vi.fn(),
  competitorHistory: vi.fn(),
  competitorCompare: vi.fn(),
  competitorList: vi.fn(),
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
// The row's menu as plain DOM: its items are buttons, its schedule a group of buttons.
const RadioCtx = createContext<(value: string) => void>(() => undefined)
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children, onSelect, disabled }: { children: ReactNode; onSelect?: () => void; disabled?: boolean }) => (
    <button type="button" disabled={disabled} onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
  DropdownMenuRadioGroup: ({ children, onValueChange }: { children: ReactNode; onValueChange: (value: string) => void }) => (
    <RadioCtx.Provider value={onValueChange}>{children}</RadioCtx.Provider>
  ),
  DropdownMenuRadioItem: function RadioItem({ children, value }: { children: ReactNode; value: string }) {
    const pick = useContext(RadioCtx)
    return (
      <button type="button" role="menuitemradio" onClick={() => pick(value)}>
        {children}
      </button>
    )
  },
}))

import CompetitorsPage from "../page"

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
  // Its last scan saved, with the X search failed: the server names the problem too.
  lastScanError: "The X search failed.",
  scanning: false,
  searches: 3,
  searchPlan: [
    { kind: "own", platform: "tiktok" },
    { kind: "about", platform: "reddit" },
    { kind: "about", platform: "x" },
  ],
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
}

const BOLTLY: TrackedCompetitor = {
  ...ACME,
  id: "00000000-0000-4000-8000-0000000000c2",
  brand: "Boltly",
  accounts: { instagram: "boltly" },
  aboutPlatforms: [],
  lastScanAt: null,
  lastScanId: null,
  lastScanError: null,
  searches: 1,
  searchPlan: [{ kind: "own", platform: "instagram" }],
  createdAt: "2026-09-05T00:00:00Z",
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
  brands: {
    [ACME.id]: {
      scanId: "scan-1",
      at: "2026-10-01T10:00:00Z",
      platforms: [
        { platform: "tiktok", own: 4, about: 0, searched: ["own"], failed: [], usual: 1000, unit: "views", top: null },
        { platform: "x", own: 0, about: 0, searched: ["about"], failed: ["about"], usual: null, unit: null, top: null },
        { platform: "reddit", own: 0, about: 3, searched: ["about"], failed: [], usual: null, unit: null, top: null },
      ],
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

/** The table's row of a brand. */
async function rowOf(brand: string): Promise<HTMLElement> {
  // The counts arrive with the cards; wait for them, not only for the brand list.
  await screen.findByText("Acme Paint's TikTok post did 5x their usual")
  const name = await screen.findByRole("button", { name: en["competitors.openBrand"].replace("{brand}", brand) })
  return name.closest("tr") as HTMLElement
}

/** The scan offered on the line under a brand's name (the row's menu has one too). */
function sublineScan(row: HTMLElement, label: RegExp): HTMLElement {
  const found = within(row)
    .getAllByRole("button", { name: label })
    .find((b) => b.hasAttribute("aria-describedby"))
  if (!found) throw new Error(`no scan on the brand's line matching ${label}`)
  return found
}

/** The cards, with ACME's saved scan clean on every platform. */
const CLEAN_CARDS: CompetitorCardsResult = {
  ...CARDS,
  brands: {
    [ACME.id]: {
      ...CARDS.brands![ACME.id]!,
      platforms: CARDS.brands![ACME.id]!.platforms.map((p) => ({ ...p, failed: [] })),
    },
  },
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.listCompetitors.mockResolvedValue([ACME])
  api.competitorCards.mockResolvedValue(CARDS)
  api.competitorHistory.mockResolvedValue({ scans: [] })
  api.competitorList.mockResolvedValue({ data: [ACME], historyMonths: 1 })
  api.competitorCompare.mockResolvedValue({ periods: [], posts: {} })
  api.lookupSavedPosts.mockResolvedValue(new Map())
  // A server with no place for marks yet: no "I did this" (the tests below give it one).
  api.competitorCardActions.mockRejectedValue(Object.assign(new Error("not available"), { code: "not_available" }))
  // The live price differs from the static table (3 searches = 60), as it
  // does with a retuned price or a markup.
  api.getModelCreditCost.mockImplementation(async (model: string) => ({ data: { model, creditCost: model === "competitor-scan:3" ? 23 : 1 } }))
})

describe("who is where", () => {
  it("shows each brand against each platform it reads, and a partly failed scan as its totals with a sign", async () => {
    renderPage()
    const row = await rowOf("Acme Paint")
    const cells = within(row).getAllByRole("cell")
    // The rank's header is named for screen readers only; then the platforms in the page's order.
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent)
    expect(headers[0]).toBe(en["competitors.colRank"])
    expect(headers.slice(2)).toEqual(["X", "TikTok", "Reddit"])
    expect(cells[1]).toHaveTextContent(en["competitors.cellFailed"])
    // Why it failed, for a screen reader too (not only in a tooltip).
    expect(cells[1]).toHaveTextContent(en["competitors.failedAbout"])
    expect(cells[2]).toHaveTextContent("4")
    expect(cells[3]).toHaveTextContent(en["competitors.cellAboutOnlyCount"].replace("{n}", "3"))
    // The saved scan's own failure: its numbers, never "Last scan failed".
    expect(within(row).getByText("4 theirs · 3 about")).toBeInTheDocument()
    expect(within(row).queryByText(en["competitors.lastScanFailed"])).toBeNull()
    fireEvent.click(within(row).getByRole("button", { name: en["competitors.scanProblem"] }))
    expect(await screen.findByText("The X search failed.")).toBeInTheDocument()
  })

  it("offers the first scan of a brand that has none, and waits for it on the platforms it reads", async () => {
    api.listCompetitors.mockResolvedValue([ACME, BOLTLY])
    api.scanCompetitor.mockResolvedValue({ jobId: "job-2" })
    renderPage()
    const row = await rowOf("Boltly")
    expect(within(row).getAllByText(en["competitors.neverScanned"]).length).toBeGreaterThan(0)
    expect(within(row).getByText(en["competitors.cellPendingHint"])).toBeInTheDocument()
    fireEvent.click(sublineScan(row, new RegExp(en["competitors.scanNow"])))
    await waitFor(() => expect(api.scanCompetitor).toHaveBeenCalledWith(BOLTLY.id))
  })

  it("says a scan that did not happen failed, with its reason and the date the numbers are from, and offers to scan again at its price", async () => {
    api.listCompetitors.mockResolvedValue([{ ...ACME, lastScanError: "Not enough credits." }])
    api.competitorCards.mockResolvedValue(CLEAN_CARDS)
    api.scanCompetitor.mockResolvedValue({ jobId: "job-3" })
    renderPage()
    const row = await rowOf("Acme Paint")
    expect(within(row).queryByText("4 theirs · 3 about")).toBeNull()
    fireEvent.click(within(row).getByRole("button", { name: en["competitors.lastScanFailed"] }))
    expect(await screen.findByText("Not enough credits.")).toBeInTheDocument()
    expect(screen.getByText(/The numbers shown are from the scan of/)).toBeInTheDocument()
    const again = sublineScan(row, new RegExp(en["competitors.scanAgain"]))
    // Named with the brand for a screen reader, priced like every scan.
    expect(again).toHaveAccessibleDescription("Acme Paint")
    await waitFor(() => expect(again).toHaveTextContent("23"))
    fireEvent.click(again)
    await waitFor(() => expect(api.scanCompetitor).toHaveBeenCalledWith(ACME.id))
  })

  it("keeps a failed scan stored before failures were kept by name as partial: its numbers stand", async () => {
    api.competitorCards.mockResolvedValue({
      ...CLEAN_CARDS,
      brands: { [ACME.id]: { ...CLEAN_CARDS.brands![ACME.id]!, platforms: CLEAN_CARDS.brands![ACME.id]!.platforms.map((p) => ({ ...p, failed: null })) } },
    })
    renderPage()
    const row = await rowOf("Acme Paint")
    expect(within(row).getByText("4 theirs · 3 about")).toBeInTheDocument()
    expect(within(row).getByRole("button", { name: en["competitors.scanProblem"] })).toBeInTheDocument()
    expect(within(row).queryByText(en["competitors.lastScanFailed"])).toBeNull()
  })

  it("never claims a failure or zeros before the counts arrive", async () => {
    api.competitorCards.mockReturnValue(new Promise(() => undefined))
    renderPage()
    const name = await screen.findByRole("button", { name: en["competitors.openBrand"].replace("{brand}", "Acme Paint") })
    const row = name.closest("tr") as HTMLElement
    expect(within(row).queryByText(en["competitors.lastScanFailed"])).toBeNull()
    expect(within(row).queryByText(/theirs ·/)).toBeNull()
  })

  it("says a brand's first scan failed when it never had one saved", async () => {
    api.listCompetitors.mockResolvedValue([ACME, { ...BOLTLY, lastScanError: "Every search failed." }])
    renderPage()
    const row = await rowOf("Boltly")
    expect(within(row).getByRole("button", { name: en["competitors.lastScanFailed"] })).toBeInTheDocument()
    expect(sublineScan(row, new RegExp(en["competitors.scanAgain"]))).toBeInTheDocument()
  })

  it("sends a brand with nothing to search to its settings instead of offering a scan", async () => {
    api.listCompetitors.mockResolvedValue([ACME, { ...BOLTLY, accounts: {}, searches: 0, searchPlan: [] }])
    renderPage()
    const row = await rowOf("Boltly")
    expect(within(row).getByText(en["competitors.noSearches"])).toBeInTheDocument()
    const edit = within(row)
      .getAllByRole("button", { name: en["competitors.edit"] })
      .find((b) => b.hasAttribute("aria-describedby"))!
    fireEvent.click(edit)
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
  })

  it("ranks by a platform, shows what works there, and keeps only the cards about it", async () => {
    renderPage()
    await screen.findByText("Acme Paint's TikTok post did 5x their usual")
    const tiktok = screen.getByRole("button", { name: "TikTok" })
    fireEvent.click(tiktok)
    expect(tiktok).toHaveAttribute("aria-pressed", "true")
    const compare = screen.getByRole("heading", { name: "On TikTok: what works for each brand" }).closest("section") as HTMLElement
    // The usual reach, read without the direction marks numbers carry.
    expect(compare.textContent?.replace(/[‎‏]/g, "")).toContain("1K views")
    expect(screen.getByText("Acme Paint's TikTok post did 5x their usual")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "X" }))
    expect(screen.getByText(en["competitors.searchFailed"])).toBeInTheDocument()
    expect(screen.getByText(en["competitors.nothingToAct"])).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: en["competitors.compareBack"] }))
    expect(screen.queryByRole("heading", { name: /what works for each brand/ })).toBeNull()
  })
})

describe("the cards", () => {
  it("shows a card in the reader's words, whose it is and where, with the post it rests on", async () => {
    renderPage()
    const title = await screen.findByText("Acme Paint's TikTok post did 5x their usual")
    const card = title.closest("article") as HTMLElement
    expect(within(card).getByText("Acme Paint")).toBeInTheDocument()
    expect(within(card).getByText("TikTok")).toBeInTheDocument()
    expect(within(card).getByText(en["cards.priority1"])).toBeInTheDocument()
    expect(within(card).getByText("@acmepaint")).toBeInTheDocument()
    // With no words of the post to quote, the line under the title is our own sentence: it follows the page direction.
    expect(card.querySelector("blockquote")).not.toHaveAttribute("dir")
    expect(card.querySelector("h3")).not.toHaveAttribute("dir")
  })

  it("filters the cards by brand", async () => {
    api.listCompetitors.mockResolvedValue([ACME, BOLTLY])
    api.competitorCards.mockResolvedValue({
      ...CARDS,
      cards: [...CARDS.cards, { ...CARDS.cards[0]!, id: "launch:c2", kind: "launch", subjectId: BOLTLY.id, params: { brand: "Boltly", firstLine: "Bolts, faster" }, evidence: [] }],
    })
    renderPage()
    await screen.findByText("Acme Paint's TikTok post did 5x their usual")
    const chips = screen.getByRole("button", { name: /All brands/ }).parentElement as HTMLElement
    fireEvent.click(within(chips).getByRole("button", { name: /Boltly/ }))
    expect(screen.queryByText("Acme Paint's TikTok post did 5x their usual")).toBeNull()
    expect(screen.getByText("Boltly announced something new")).toBeInTheDocument()
    fireEvent.click(within(chips).getByRole("button", { name: /Boltly/ }))
    expect(screen.getByText("Acme Paint's TikTok post did 5x their usual")).toBeInTheDocument()
  })

  it("saves a card's post to Inspiration from its bookmark", async () => {
    api.savePost.mockResolvedValue({ id: "save-1" })
    renderPage()
    await screen.findByText("@acmepaint")
    fireEvent.click(screen.getByRole("button", { name: en["social.saveToWall"] }))
    await waitFor(() => expect(api.savePost).toHaveBeenCalledWith({ post: CARDS.posts["tiktok:1"], source: "competitors" }))
  })
})

describe("a brand's row", () => {
  it("adds a brand from its website, marking the guessed accounts", async () => {
    api.discoverCompetitor.mockResolvedValue({
      brand: "Boltly",
      website: "https://boltly.example/",
      accounts: { instagram: { value: "boltly", from: "site" }, tiktok: { value: "boltly", from: "guess" } },
    })
    api.createCompetitor.mockResolvedValue({ ...ACME, id: "c2", brand: "Boltly" })
    renderPage()
    await rowOf("Acme Paint")
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

  it("scans a brand at the price the server charges, not the static table's", async () => {
    api.scanCompetitor.mockResolvedValue({ jobId: "job-1" })
    renderPage()
    const row = await rowOf("Acme Paint")
    const scan = within(row).getByRole("button", { name: new RegExp(en["competitors.scanNow"]) })
    await waitFor(() => expect(scan).toHaveTextContent("23"))
    expect(api.getModelCreditCost).toHaveBeenCalledWith("competitor-scan:3")
    fireEvent.click(scan)
    await waitFor(() => expect(api.scanCompetitor).toHaveBeenCalledWith(ACME.id))
  })

  it("changes a brand's schedule from its row, and sends nothing for the one it already has", async () => {
    api.updateCompetitor.mockResolvedValue({ ...ACME, schedule: "daily" })
    renderPage()
    const row = await rowOf("Acme Paint")
    fireEvent.click(within(row).getByRole("menuitemradio", { name: en["competitors.scheduleWeekly"] }))
    fireEvent.click(within(row).getByRole("menuitemradio", { name: en["competitors.scheduleDaily"] }))
    await waitFor(() => expect(api.updateCompetitor).toHaveBeenCalledWith(ACME.id, { schedule: "daily" }))
    expect(api.updateCompetitor).toHaveBeenCalledTimes(1)
  })

  it("keeps a brand's scan busy until its own answer, whatever other brands are doing", async () => {
    const CORVO: TrackedCompetitor = { ...BOLTLY, id: "00000000-0000-4000-8000-0000000000c3", brand: "Corvo" }
    api.listCompetitors.mockResolvedValue([ACME, BOLTLY, CORVO])
    const answers = new Map<string, () => void>()
    api.scanCompetitor.mockImplementation((id: string) => new Promise((resolve) => answers.set(id, () => resolve({ jobId: `job-${id}` }))))
    renderPage()
    const boltly = sublineScan(await rowOf("Boltly"), new RegExp(en["competitors.scanNow"]))
    const corvo = sublineScan(await rowOf("Corvo"), new RegExp(en["competitors.scanNow"]))
    fireEvent.click(boltly)
    await waitFor(() => expect(boltly).toBeDisabled())
    fireEvent.click(corvo)
    await waitFor(() => expect(corvo).toBeDisabled())
    // A second brand's scan does not release the first.
    expect(boltly).toBeDisabled()
    answers.get(BOLTLY.id)!()
    await waitFor(() => expect(boltly).toBeEnabled())
    expect(corvo).toBeDisabled()
  })

  it("puts focus back on the brand's name when its window closes", async () => {
    const detail: CompetitorDetail = { ...ACME, latestScan: null, platforms: null, scans: [] }
    api.getCompetitor.mockResolvedValue(detail)
    api.competitorLessons.mockResolvedValue({ lessons: { minPosts: 8, platforms: [] }, posts: {} })
    renderPage()
    const name = await screen.findByRole("button", { name: en["competitors.openBrand"].replace("{brand}", "Acme Paint") })
    fireEvent.click(name)
    const dialog = await screen.findByRole("dialog")
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(name))
  })

  it("says the cards could not be read, and reads them again on request", async () => {
    api.competitorCards.mockRejectedValueOnce(new Error("down")).mockResolvedValue(CARDS)
    renderPage()
    expect(await screen.findByText(en["apiErr.loadCompetitorCards"])).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: en["common.retry"] }))
    expect(await screen.findByText("Acme Paint's TikTok post did 5x their usual")).toBeInTheDocument()
  })

  it("edits a brand by sending only what changed", async () => {
    api.updateCompetitor.mockResolvedValue({ ...ACME, brand: "Acme Paints" })
    renderPage()
    const row = await rowOf("Acme Paint")
    fireEvent.click(within(row).getByRole("button", { name: en["competitors.edit"] }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByDisplayValue("Acme Paint"), { target: { value: "Acme Paints" } })
    fireEvent.click(within(dialog).getByRole("button", { name: en["common.save"] }))
    await waitFor(() => expect(api.updateCompetitor).toHaveBeenCalledWith(ACME.id, { brand: "Acme Paints" }))
  })

  it("drops a website lookup that answers after the form moved on to another brand", async () => {
    let answer: (found: CompetitorDiscovery) => void = () => undefined
    api.discoverCompetitor.mockImplementation(() => new Promise<CompetitorDiscovery>((resolve) => (answer = resolve)))
    renderPage()
    const row = await rowOf("Acme Paint")
    fireEvent.click(screen.getByRole("button", { name: en["competitors.add"] }))
    const adding = await screen.findByRole("dialog")
    fireEvent.change(within(adding).getByPlaceholderText("acme.com"), { target: { value: "boltly.example" } })
    fireEvent.click(within(adding).getByRole("button", { name: en["competitors.findAccounts"] }))
    fireEvent.click(within(adding).getByRole("button", { name: en["common.cancel"] }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    fireEvent.click(within(row).getByRole("button", { name: en["competitors.edit"] }))
    const editing = await screen.findByRole("dialog")
    answer({ brand: "Boltly", website: "https://boltly.example/", accounts: { instagram: { value: "boltly", from: "site" } } })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(within(editing).getByDisplayValue("https://acme.example/")).toBeInTheDocument()
    expect(within(editing).queryByDisplayValue("boltly")).toBeNull()
  })

  it("stops tracking a brand only after the confirmation, and not at all on cancel", async () => {
    api.deleteCompetitor.mockResolvedValue(undefined)
    renderPage()
    const row = await rowOf("Acme Paint")
    fireEvent.click(within(row).getByRole("button", { name: en["competitors.remove"] }))
    const cancel = await screen.findByRole("alertdialog")
    fireEvent.click(within(cancel).getByRole("button", { name: en["common.cancel"] }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(api.deleteCompetitor).not.toHaveBeenCalled()

    fireEvent.click(within(row).getByRole("button", { name: en["competitors.remove"] }))
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
