import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import React from "react"
import { useLocaleStore } from "@/lib/locale-store"
import { en } from "@/lib/i18n/en"
import { he } from "@/lib/i18n/he"
import { queryKeys } from "@/lib/query-keys"
import type { UserBalance } from "@/lib/api"

/**
 * Track A — the insufficient-credits modal under a deployment payer (D12).
 *
 * This is the third of the three client gates that read `total` (the sidebar
 * card and the canvas precheck are the other two), and it is the one that
 * tells the user what to DO about it. On a deployment-payer instance both of
 * its CTAs are lies: users cannot buy the platform's credits, and no admin can
 * top anyone up (decision 5). The only fixer is the deployment's billing
 * account, so that is what the card must say — the copy pinned in D10.
 *
 * The mainline half of every case is asserted too: this modal is on the hot
 * path of every self-serve cloud user, and "prepaid" is not the same switch as
 * "deployment payer".
 */

const { mockSurface, mockSelfServe, server } = vi.hoisted(() => ({
  mockSurface: vi.fn<() => { surface: Record<string, unknown>; isLoading: boolean }>(() => ({
    surface: { deploymentPayer: false },
    isLoading: false,
  })),
  mockSelfServe: vi.fn(() => true),
  // The server, at the network boundary: the welcome-offer calls and the
  // balance the app reads back after a claim.
  server: {
    claim: vi.fn(),
    seen: vi.fn().mockResolvedValue(undefined),
    balance: vi.fn(),
    /** The signed-in account's id. */
    userId: "u1" as string | undefined,
  },
}))

vi.mock("@/hooks/use-billing-surface", () => ({ useBillingSurface: () => mockSurface() }))
vi.mock("@/lib/surface-selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-selectors")>()),
  surfaceBillingSelfServe: () => mockSelfServe(),
}))
vi.mock("@/hooks/use-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-auth")>()),
  useAuth: () => ({ user: server.userId ? { id: server.userId } : null }),
}))
vi.mock("@/lib/edition", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/edition")>()),
  hasCredits: () => true,
}))
vi.mock("@/ee/lib/ensure-signup-grant", () => ({ collectKeys: vi.fn().mockResolvedValue({}) }))
vi.mock("@/ee/components/welcome-offer/welcome-offer-api", () => ({
  SOURCE_APP: "app",
  claimWelcomeOffer: server.claim,
  markWelcomeOfferSeen: server.seen,
}))
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getUserCredits: (userId: string) => server.balance(userId),
}))

import { InsufficientCreditsModal } from "../InsufficientCreditsModal"
import { useWelcomeOfferStore } from "@/ee/components/welcome-offer/welcome-offer-store"
import { INSPECTOR_CHILD_DIALOG_Z, INSPECTOR_Z_VALUE } from "@/components/inspector/inspector-shell"

const BALANCE: UserBalance = {
  total: 0,
  subscription: 0,
  topup: 0,
  dailySpent: 0,
  dailyLimit: null,
  monthlyAllocation: 0,
  tier: "free",
  effectiveTier: "free",
  features: {},
  periodEnd: null,
  appCreditsAllowance: 0,
}

/** An account that closed the welcome pop-up without saying yes. */
const UNCLAIMED: Partial<UserBalance> = {
  freeGrantState: "unclaimed",
  welcomeOffer: { popupSeen: true, consentPending: false, credits: 1500 },
}

let client: QueryClient

/** The balance the app holds for the signed-in account when the dialog opens. */
function account(balance: Partial<UserBalance> = {}) {
  client.setQueryData(queryKeys.credits.balance("u1"), { ...BALANCE, ...balance })
}

/** What the server reads back for the account after a claim. */
function afterClaim(balance: Partial<UserBalance>) {
  server.balance.mockResolvedValue({ data: { ...BALANCE, ...balance } })
}

function dialog(props: Partial<React.ComponentProps<typeof InsufficientCreditsModal>> = {}) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InsufficientCreditsModal
          open
          onClose={() => {}}
          required={12_000}
          available={4_000}
          tier="free"
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function open(props: Partial<React.ComponentProps<typeof InsufficientCreditsModal>> = {}) {
  return render(dialog(props))
}

/** `he` is a partial dict (English is the canonical key set), so its values are
 *  `string | undefined` to the compiler; every key asserted here is one this
 *  change added to both. */
function heText(key: keyof typeof en): string {
  const v = (he as Record<string, string | undefined>)[key]
  expect(v, `missing Hebrew translation for ${key}`).toBeTruthy()
  return v as string
}

/** Every purchase path the modal can offer, in whichever language it speaks. */
function purchaseCtas(): HTMLElement[] {
  const names = [
    en["credits.upgradePlanCta"],
    en["credits.buyCreditsCta"],
    heText("credits.upgradePlanCta"),
    heText("credits.buyCreditsCta"),
  ].filter(Boolean) as string[]
  return names.flatMap((n) => screen.queryAllByRole("link", { name: n }))
}

beforeEach(() => {
  vi.clearAllMocks()
  server.userId = "u1"
  useLocaleStore.setState({ locale: "en" })
  mockSurface.mockReturnValue({ surface: { deploymentPayer: false }, isLoading: false })
  mockSelfServe.mockReturnValue(true)
  useWelcomeOfferStore.setState({ claimedCredits: null, consentAskVersion: 0, claimInFlightFor: null, lastClaimAnswer: null })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // A settled account by default: the dialog exactly as it was before the offer.
  account({ freeGrantState: "granted" })
  server.balance.mockImplementation(async () => ({ data: client.getQueryData(queryKeys.credits.balance("u1")) }))
})

describe("InsufficientCreditsModal — mainline self-serve (unchanged)", () => {
  it("still offers both purchase paths", () => {
    open()
    expect(purchaseCtas().length).toBe(2)
  })

  it("leads both to the pricing page: the plans, and its top-up section", () => {
    // "Buy Credits" used to point at an address no page answers.
    open()
    expect(purchaseCtas().map((cta) => cta.getAttribute("href"))).toEqual(["/pricing", "/pricing#topup"])
  })

  it("still says how short the run is, and says nothing about an allowance", () => {
    open()
    expect(screen.getByText(en["credits.insufficientTitle"])).toBeInTheDocument()
    expect(screen.queryByText(en["credits.allowanceExceeded"])).toBeNull()
  })

  it("a PREPAID instance (no self-serve purchase) is not a payer instance", () => {
    // Two different switches. Prepaid already withheld the CTAs; it must not
    // start rendering allowance copy that does not apply to it.
    mockSelfServe.mockReturnValue(false)
    open()
    expect(purchaseCtas()).toEqual([])
    expect(screen.queryByText(en["credits.allowanceExceeded"])).toBeNull()
  })
})

describe("InsufficientCreditsModal — under a deployment payer", () => {
  beforeEach(() => {
    mockSurface.mockReturnValue({ surface: { deploymentPayer: true }, isLoading: false })
  })

  it("offers NO purchase path, even though self-serve is nominally on", () => {
    // The payer branch is independent of `surfaceBillingSelfServe()`: a
    // deployment can carry a payer AND a self-serve flag, and its users still
    // cannot buy anything.
    mockSelfServe.mockReturnValue(true)
    open()
    expect(purchaseCtas()).toEqual([])
  })

  it("names the fixer — the deployment's billing account", () => {
    open()
    expect(screen.getByText(en["credits.allowanceExceeded"])).toBeInTheDocument()
  })

  it("drops the plan badge: a tier means nothing when the pool is someone else's", () => {
    open({ tier: "free" })
    expect(screen.queryByText(en["credits.currentPlanLabel"])).toBeNull()
  })

  it("still shows the figures that refused the run", () => {
    open({ required: 12_000, available: 4_000 })
    expect(screen.getByText("12,000")).toBeInTheDocument()
    expect(screen.getByText("4,000")).toBeInTheDocument()
  })

  it("speaks Hebrew on the Hebrew-default instance this ships to", () => {
    useLocaleStore.setState({ locale: "he" })
    open()
    expect(screen.getByText(heText("credits.allowanceExceeded"))).toBeInTheDocument()
    expect(screen.getByText(heText("credits.insufficientTitle"))).toBeInTheDocument()
    expect(screen.queryByText(en["credits.insufficientTitle"])).toBeNull()
  })

  it("fails OPEN to mainline copy while the billing surface is still loading", () => {
    // The surface is fetched. Defaulting to the payer branch on a mainline
    // deployment would hide a real purchase path from a paying customer for
    // the length of one request.
    mockSurface.mockReturnValue({ surface: { deploymentPayer: undefined }, isLoading: true })
    open()
    expect(purchaseCtas().length).toBe(2)
  })
})

describe("InsufficientCreditsModal — a run whose clips hold more than its price", () => {
  it("says why the figure it needs is more than the run was quoted at", () => {
    open({ required: 3860, available: 2000, note: "This run is priced at about 1756 credits, but while its clips render about twice their price is held." })
    expect(screen.getByTestId("insufficient-credits-note").textContent).toBe(
      "This run is priced at about 1756 credits, but while its clips render about twice their price is held.",
    )
  })

  it("says nothing more for a run that holds its price", () => {
    open()
    expect(screen.queryByTestId("insufficient-credits-note")).toBeNull()
  })
})

/**
 * The welcome credits, offered again where a run was refused. An account that
 * closed the welcome pop-up without saying yes has 0 credits and meets this
 * dialog the first time it creates: it says the free credits are still there
 * to claim, in the welcome banner's own words, above the figures.
 */
describe("InsufficientCreditsModal — while the account's welcome credits are unclaimed", () => {
  const offerTitle = "Get 1,500 free credits"
  const yes = () => screen.getByRole("button", { name: /add 1,500 credits/i })
  const offer = () => screen.queryByRole("region", { name: offerTitle })

  beforeEach(() => {
    account(UNCLAIMED)
  })

  it("offers them on top, in the welcome banner's words, and keeps both purchase paths", () => {
    open({ required: 176, available: 0 })
    const region = offer()
    expect(region).not.toBeNull()
    expect(region!.textContent).toContain(en["welcome.banner.body"])
    expect(yes()).toBeEnabled()
    // Above the figures.
    const balanceLabel = screen.getByText(en["credits.currentBalanceLabel"])
    expect(region!.compareDocumentPosition(balanceLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(purchaseCtas().length).toBe(2)
  })

  it("is today's dialog exactly when the offer is off, the grant was withheld, or the deployment gives no free credits", () => {
    const cases: Array<() => void> = [
      () => account({ freeGrantState: "unclaimed" }),
      () => account({ ...UNCLAIMED, freeGrantState: "withheld" }),
      () => { account(UNCLAIMED); mockSurface.mockReturnValue({ surface: { deploymentPayer: true }, isLoading: false }) },
      // Granted through the extension, consent still owed: the consent ask is the pop-up's, not this dialog's.
      () => account({ freeGrantState: "granted", welcomeOffer: { popupSeen: true, consentPending: true, credits: 1500 } }),
      // A deployment that sells nothing (`billing.selfServe: false`).
      () => {
        account(UNCLAIMED)
        mockSelfServe.mockReturnValue(false)
        window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: false } } }
      },
    ]
    for (const arrange of cases) {
      arrange()
      const { unmount } = open({ required: 176, available: 0 })
      expect(offer()).toBeNull()
      expect(screen.queryByRole("button", { name: /add 1,500 credits|keep creating/i })).toBeNull()
      expect(screen.queryByTestId("free-grant-withheld-banner")).toBeNull()
      unmount()
      mockSurface.mockReturnValue({ surface: { deploymentPayer: false }, isLoading: false })
      mockSelfServe.mockReturnValue(true)
      delete window.__NODARO_RUNTIME__
    }
  })

  it("Yes, and the credits now cover the run: the dialog closes (the person presses Run again)", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    afterClaim({ total: 1500, freeGrantState: "granted", welcomeOffer: { popupSeen: true, consentPending: false, credits: 1500 } })
    const onClose = vi.fn()
    open({ required: 176, available: 0, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(server.claim).toHaveBeenCalledTimes(1)
  })

  it("Yes, and still short: the dialog stays, with the new figures and without the offer", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    afterClaim({ total: 1500, freeGrantState: "granted", welcomeOffer: { popupSeen: true, consentPending: false, credits: 1500 } })
    const onClose = vi.fn()
    open({ required: 2000, available: 0, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(offer()).toBeNull())
    expect(screen.getByText("1,500")).toBeInTheDocument()
    expect(screen.getByText("2,000")).toBeInTheDocument()
    expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "500"))).toBeInTheDocument()
    expect(screen.getByText(en["credits.insufficientDescription"].replace("{required}", "2000").replace("{available}", "1500"))).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(purchaseCtas().length).toBe(2)
  })

  it("Yes, and the grant was withheld: the offer goes, and the sentence the product says for a withheld grant takes its place", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "withheld", credits: 1500 })
    afterClaim({ total: 0, freeGrantState: "withheld" })
    const onClose = vi.fn()
    open({ required: 176, available: 0, onClose })
    fireEvent.click(yes())
    const withheld = await screen.findByTestId("free-grant-withheld-banner")
    expect(withheld.textContent).toMatch(/first purchase/i)
    expect(offer()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(purchaseCtas().length).toBe(2)
  })

  it("Yes that does not go through: the button stays for another try, with the error", async () => {
    server.claim.mockRejectedValue(new Error("welcome offer claim failed (500)"))
    const onClose = vi.fn()
    open({ required: 176, available: 0, onClose })
    fireEvent.click(yes())
    expect(await screen.findByText(en["welcome.error"])).toBeInTheDocument()
    expect(yes()).toBeEnabled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("closing it without answering changes nothing about the offer (the pop-up is still due)", () => {
    // An account that never saw the welcome pop-up: closing this dialog must not stamp it as seen.
    account({ ...UNCLAIMED, welcomeOffer: { popupSeen: false, consentPending: false, credits: 1500 } })
    const onClose = vi.fn()
    open({ required: 176, available: 0, onClose })
    expect(offer()).not.toBeNull()
    fireEvent.click(screen.getByRole("button", { name: en["common.close"] }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(server.seen).not.toHaveBeenCalled()
    expect(server.claim).not.toHaveBeenCalled()
    expect(client.getQueryData<UserBalance>(queryKeys.credits.balance("u1"))?.welcomeOffer?.popupSeen).toBe(false)
    expect(client.getQueryData<UserBalance>(queryKeys.credits.balance("u1"))?.freeGrantState).toBe("unclaimed")
  })

  it("Yes, granted, and the balance read-back FAILS: the figures still count the granted credits", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    server.balance.mockRejectedValue(new Error("network"))
    const onClose = vi.fn()
    open({ required: 2000, available: 0, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(offer()).toBeNull())
    expect(screen.getByText("1,500")).toBeInTheDocument()
    expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "500"))).toBeInTheDocument()
    expect(screen.queryByText(en["credits.insufficientDescription"].replace("{required}", "2000").replace("{available}", "0"))).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("Yes, granted, and the read-back FAILS but the credits cover the run: the dialog closes", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    server.balance.mockRejectedValue(new Error("network"))
    const onClose = vi.fn()
    open({ required: 176, available: 0, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it("Yes, granted, and the read-back returns the OLD balance: the figures still count the granted credits", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    afterClaim({ ...UNCLAIMED, total: 0 })
    const onClose = vi.fn()
    open({ required: 2000, available: 0, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(offer()).toBeNull())
    expect(screen.getByText("1,500")).toBeInTheDocument()
    expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "500"))).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("Yes, withheld, and the read-back FAILS: the withheld sentence still takes the offer's place", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "withheld", credits: 1500 })
    server.balance.mockRejectedValue(new Error("network"))
    open({ required: 176, available: 0 })
    fireEvent.click(yes())
    const withheld = await screen.findByTestId("free-grant-withheld-banner")
    expect(withheld.textContent).toMatch(/first purchase/i)
    expect(offer()).toBeNull()
  })

  /** Yes in a first opening, closed before the claim answers, then a new refusal opens it again needing `required`. */
  async function reopenWhileClaimOut(required: number, available: number, onClose: () => void) {
    let settle!: (r: unknown) => void
    server.claim.mockImplementation(() => new Promise((resolve) => { settle = resolve }))
    const view = open({ required: 176, available: 0, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(server.claim).toHaveBeenCalledTimes(1))
    view.rerender(dialog({ open: false, required: 176, available: 0, onClose }))
    view.rerender(dialog({ open: true, required, available, onClose }))
    return (answer: unknown) => settle(answer)
  }

  it("while a claim from an earlier opening is out, the dialog showing offers no second live yes", async () => {
    await reopenWhileClaimOut(5000, 0, vi.fn())
    expect(yes()).toBeDisabled()
    fireEvent.click(yes())
    expect(server.claim).toHaveBeenCalledTimes(1)
  })

  it("an earlier opening's claim, granted: the dialog showing takes it against its own figures and stays when they are still short", async () => {
    afterClaim({ total: 1500, freeGrantState: "granted", welcomeOffer: { popupSeen: true, consentPending: false, credits: 1500 } })
    const onClose = vi.fn()
    const settle = await reopenWhileClaimOut(5000, 0, onClose)
    settle({ consent: "granted", grant: "granted", credits: 1500 })
    await waitFor(() => expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "3,500"))).toBeInTheDocument())
    expect(screen.getByText("1,500")).toBeInTheDocument()
    expect(screen.getByText("5,000")).toBeInTheDocument()
    expect(offer()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("an earlier opening's claim, granted: the dialog showing closes when its own run is now covered", async () => {
    afterClaim({ total: 1500, freeGrantState: "granted", welcomeOffer: { popupSeen: true, consentPending: false, credits: 1500 } })
    const onClose = vi.fn()
    const settle = await reopenWhileClaimOut(176, 0, onClose)
    settle({ consent: "granted", grant: "granted", credits: 1500 })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it("an earlier opening's claim, withheld: the dialog showing shows the withheld sentence", async () => {
    afterClaim({ total: 0, freeGrantState: "withheld" })
    const settle = await reopenWhileClaimOut(5000, 0, vi.fn())
    settle({ consent: "granted", grant: "withheld", credits: 1500 })
    const withheld = await screen.findByTestId("free-grant-withheld-banner")
    expect(withheld.textContent).toMatch(/first purchase/i)
    expect(offer()).toBeNull()
  })

  it("an answer that settled before this opening is not this opening's: a later refusal opens with its own figures", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    afterClaim({ total: 1500, freeGrantState: "granted", welcomeOffer: { popupSeen: true, consentPending: false, credits: 1500 } })
    const onClose = vi.fn()
    const view = open({ required: 5000, available: 0, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(screen.getByText("1,500")).toBeInTheDocument())
    view.rerender(dialog({ open: false, required: 5000, available: 0, onClose }))
    // The next refusal already counts the grant; nothing from the earlier answer is laid over it.
    view.rerender(dialog({ open: true, required: 9000, available: 1500, onClose }))
    expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "7,500"))).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  /**
   * The grant raises the plan credits TO its amount (the server keeps the
   * greater of the two) — it never adds on top, and the claim answers its
   * amount even when nothing moved. A fresh read-back (the account now says
   * granted) is the balance as it is; without one, the most that can be said
   * is the greater of what refused the run and the grant.
   */
  it("an account holding 300 that needs 1,700: the grant brings it to 1,500, not 1,800 — the dialog stays", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    afterClaim({ total: 1500, freeGrantState: "granted" })
    const onClose = vi.fn()
    open({ required: 1700, available: 300, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(offer()).toBeNull())
    expect(screen.getByText("1,500")).toBeInTheDocument()
    expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "200"))).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("the same account, with the read-back failing: the dialog still stays (at most the greater of 300 and the grant)", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    server.balance.mockRejectedValue(new Error("network"))
    const onClose = vi.fn()
    open({ required: 1700, available: 300, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(offer()).toBeNull())
    expect(screen.getByText("1,500")).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("a subscriber holding 4,500 that needs 5,000: the grant moves nothing — the dialog stays at 4,500", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    afterClaim({ total: 4500, freeGrantState: "granted", tier: "basic", effectiveTier: "basic" })
    const onClose = vi.fn()
    open({ required: 5000, available: 4500, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(offer()).toBeNull())
    expect(screen.getByText("4,500")).toBeInTheDocument()
    expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "500"))).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("a claim another tab already made (nothing moved): the dialog stays with what the account holds", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    afterClaim({ total: 200, freeGrantState: "granted" })
    const onClose = vi.fn()
    open({ required: 1000, available: 200, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(offer()).toBeNull())
    expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "800"))).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("a dialog opened again starts fresh: an earlier failed try leaves no error behind", async () => {
    server.claim.mockRejectedValue(new Error("welcome offer claim failed (500)"))
    const view = open({ required: 176, available: 0 })
    fireEvent.click(yes())
    expect(await screen.findByText(en["welcome.error"])).toBeInTheDocument()
    view.rerender(dialog({ open: false, required: 176, available: 0 }))
    view.rerender(dialog({ open: true, required: 176, available: 0 }))
    expect(yes()).toBeEnabled()
    expect(screen.queryByText(en["welcome.error"])).toBeNull()
  })
})

/**
 * A node's Run that opens this dialog can be pressed from inside an editor
 * that stays open over the canvas while the node runs: the scene editor and
 * the Kling 3 director (`z-[9998]`), the review inspector (`INSPECTOR_Z`).
 * The dialog portals to <body>; at the stock z-50 it would open BEHIND them —
 * and the toast it replaces no longer shows — so the person would see nothing
 * at all. It stacks where the editor's other run dialog (the run confirmation)
 * does. jsdom has no stacking contexts: this guards the class wiring itself.
 */
describe("InsufficientCreditsModal — above the editors a node's Run is pressed from", () => {
  const parseZ = (cls: string): number => {
    const m = cls.match(/z-\[(\d+)\]/)
    if (!m) throw new Error(`expected a z-[N] arbitrary value, got "${cls}"`)
    return Number(m[1])
  }

  it("the dialog and its backdrop stack above the inspector and the full-screen node editors", () => {
    open({ required: 176, available: 0 })
    const content = screen.getByRole("dialog")
    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
    expect(overlay).not.toBeNull()
    expect(parseZ(content.className)).toBeGreaterThan(INSPECTOR_Z_VALUE)
    expect(parseZ(overlay!.className)).toBeGreaterThan(INSPECTOR_Z_VALUE)
    expect(content.className).toContain(INSPECTOR_CHILD_DIALOG_Z)
  })
})

/**
 * The "yes" records marketing-email consent and claims the grant: it takes a
 * deliberate press. A person who pressed a node's Run and then Enter or Space
 * must not give it — so the dialog's first focus is its close control (the
 * welcome pop-up's first focusable is its × too), never the "Yes" button.
 */
describe("InsufficientCreditsModal — the welcome offer's yes takes a deliberate press", () => {
  beforeEach(() => {
    account(UNCLAIMED)
  })

  it("opens with focus on the close control, not on the yes", async () => {
    open({ required: 176, available: 0 })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: en["common.close"] })))
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: /add 1,500 credits/i }))
  })

  it.each(["{Enter}", " "])("pressing %s right after it opens sends no claim", async (key) => {
    const user = userEvent.setup()
    open({ required: 176, available: 0 })
    await waitFor(() => expect(document.activeElement).not.toBe(document.body))
    await user.keyboard(key)
    expect(server.claim).not.toHaveBeenCalled()
    expect(server.seen).not.toHaveBeenCalled()
  })

  it("without the offer, its first focus is what it always was (the close control)", async () => {
    account({ freeGrantState: "granted" })
    open({ required: 176, available: 0 })
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: en["common.close"] })))
  })
})

/**
 * The offer must fit the dialog at a 375 px phone and at the desktop width, in
 * every language, left-to-right and right-to-left: the "Yes" is a long
 * sentence in Portuguese and Japanese. jsdom lays nothing out, so this pins
 * the classes that keep it inside (measured in a real browser for the PR):
 * the card's row wraps (the home banner's way), and the button wraps its text
 * within the column (the pop-up's way) — never a one-line pill that cannot
 * shrink.
 */
describe("InsufficientCreditsModal — the welcome offer fits the dialog in every language", () => {
  beforeEach(() => {
    account(UNCLAIMED)
  })

  it("the card's row wraps, and the yes wraps its text inside its column", () => {
    open({ required: 176, available: 0 })
    const button = screen.getByRole("button", { name: /add 1,500 credits/i })
    const classes = button.className.split(/\s+/)
    expect(classes).not.toContain("whitespace-nowrap")
    expect(classes).toContain("whitespace-normal")
    expect(classes).not.toContain("shrink-0")
    expect(classes).toContain("max-w-full")
    // A fixed height would clip a second line.
    expect(classes.some((c) => /^h-\d/.test(c))).toBe(false)
    const row = screen.getByRole("region", { name: "Get 1,500 free credits" }).firstElementChild as HTMLElement
    expect(row.className.split(/\s+/)).toContain("flex-wrap")
  })
})

/**
 * The scene editor and the Kling 3 director close on any Escape the document
 * hears (scene-editor-modal.tsx, kling3-director-modal.tsx: a `keydown`
 * listener on `document`). This dialog opens above them, so one Escape must
 * close only the dialog, never the editor underneath too.
 */
describe("InsufficientCreditsModal — Escape over an editor that closes on Escape", () => {
  it("one Escape closes the dialog and reaches no document listener underneath", async () => {
    const user = userEvent.setup()
    const editorEscape = vi.fn((e: KeyboardEvent) => e.key === "Escape")
    // Attached exactly as those editors attach theirs.
    document.addEventListener("keydown", editorEscape)
    try {
      const onClose = vi.fn()
      open({ required: 176, available: 0, onClose })
      await waitFor(() => expect(document.activeElement).not.toBe(document.body))
      await user.keyboard("{Escape}")
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(editorEscape).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener("keydown", editorEscape)
    }
  })
})

/**
 * A claim's state belongs to the account that gave the "yes": another
 * account's — the one signed in before — is dropped as soon as this
 * account's editor mounts the dialog, before any of its dialogs could take it.
 */
describe("InsufficientCreditsModal — a claim's state follows the account", () => {
  it("drops another account's claim in flight and answer; keeps this account's", () => {
    useWelcomeOfferStore.setState({
      claimInFlightFor: "someone-else",
      lastClaimAnswer: { userId: "someone-else", seq: 7, grant: "granted", credits: 1500, readBack: 1500 },
    })
    render(dialog({ open: false }))
    expect(useWelcomeOfferStore.getState().claimInFlightFor).toBeNull()
    expect(useWelcomeOfferStore.getState().lastClaimAnswer).toBeNull()

    useWelcomeOfferStore.setState({
      claimInFlightFor: "u1",
      lastClaimAnswer: { userId: "u1", seq: 8, grant: "granted", credits: 1500, readBack: 1500 },
    })
    render(dialog({ open: false }))
    expect(useWelcomeOfferStore.getState().claimInFlightFor).toBe("u1")
    expect(useWelcomeOfferStore.getState().lastClaimAnswer?.userId).toBe("u1")
  })
})

/**
 * After a claim's answer, the open dialog keeps reading the balance it already
 * subscribes to: once a balance arrives that says the grant happened, its
 * figure replaces the lower bound the dialog had to show (when the read-back
 * failed or came back stale), and the dialog closes when its own run is now
 * covered. A balance that does not yet say "granted" changes nothing, and a
 * dialog with no claim answered never follows the balance at all.
 */
describe("InsufficientCreditsModal — the balance after a claim", () => {
  const yes = () => screen.getByRole("button", { name: /add 1,500 credits/i })
  /** An unclaimed account holding 300 in top-up credits (none from a plan). */
  const TOPUP_300: Partial<UserBalance> = { ...UNCLAIMED, total: 300, topup: 300, subscription: 0 }
  /** The balance the app reads some time after the claim. */
  const arrives = (balance: Partial<UserBalance>) =>
    act(() => {
      client.setQueryData(queryKeys.credits.balance("u1"), { ...BALANCE, ...balance })
    })

  beforeEach(() => {
    account(TOPUP_300)
  })

  it("top-up 300, needs 1,700, read-back failed: the lower bound shows, then the fresh 1,800 closes it", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    server.balance.mockRejectedValue(new Error("network"))
    const onClose = vi.fn()
    open({ required: 1700, available: 300, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "200"))).toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    await arrives({ total: 1800, topup: 300, subscription: 1500, freeGrantState: "granted" })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it("the same account needing 2,000: it ends at 1,800, short by 200, and stays open", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    server.balance.mockRejectedValue(new Error("network"))
    const onClose = vi.fn()
    open({ required: 2000, available: 300, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "500"))).toBeInTheDocument())
    await arrives({ total: 1800, topup: 300, subscription: 1500, freeGrantState: "granted" })
    await waitFor(() => expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "200"))).toBeInTheDocument())
    expect(screen.getByText("1,800")).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("top-up 300, needs 1,700, with a fresh read-back: the 1,800 it reads covers the run and the dialog closes at once", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    afterClaim({ total: 1800, topup: 300, subscription: 1500, freeGrantState: "granted" })
    const onClose = vi.fn()
    open({ required: 1700, available: 300, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it("a balance that still says unclaimed changes nothing (it never moves the figure)", async () => {
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    server.balance.mockRejectedValue(new Error("network"))
    const onClose = vi.fn()
    open({ required: 2000, available: 300, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "500"))).toBeInTheDocument())
    await arrives({ ...TOPUP_300, total: 100 })
    await arrives({ ...TOPUP_300, total: 5000 })
    expect(screen.getByText("1,500")).toBeInTheDocument()
    expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "500"))).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it("a dialog with no claim answered ignores balance changes", async () => {
    const onClose = vi.fn()
    open({ required: 2000, available: 300, onClose })
    await arrives({ total: 5000, freeGrantState: "granted" })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText("300")).toBeInTheDocument()
    expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "1,700"))).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

/**
 * A dialog opened for one account's refusal is not another account's: if the
 * signed-in account changes while it is open (the editor still mounted), it
 * closes, and never takes the new account's balance as its own.
 */
describe("InsufficientCreditsModal — the signed-in account changes while it is open", () => {
  const yes = () => screen.getByRole("button", { name: /add 1,500 credits/i })

  /** Account A (u1) said yes and is still short: the dialog shows 1,500, short by 500. */
  async function grantedButShortForA(onClose: () => void) {
    account(UNCLAIMED)
    server.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    afterClaim({ total: 1500, freeGrantState: "granted" })
    const view = open({ required: 2000, available: 0, onClose })
    fireEvent.click(yes())
    await waitFor(() => expect(screen.getByText(en["credits.shortByAmount"].replace("{n}", "500"))).toBeInTheDocument())
    return view
  }

  /** Account B (u2) is now signed in, holding `total`. */
  function becomesB(view: ReturnType<typeof render>, total: number, onClose: () => void) {
    client.setQueryData(queryKeys.credits.balance("u2"), { ...BALANCE, total, freeGrantState: "granted" })
    server.userId = "u2"
    view.rerender(dialog({ required: 2000, available: 0, onClose }))
  }

  it("B holding enough for A's run: the dialog closes for the switch, never showing B's balance", async () => {
    const onClose = vi.fn()
    const view = await grantedButShortForA(onClose)
    becomesB(view, 5000, onClose)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByText("5,000")).toBeNull()
  })

  it("B holding less: B's figures never show under A's refusal, and the dialog closes", async () => {
    const onClose = vi.fn()
    const view = await grantedButShortForA(onClose)
    becomesB(view, 1800, onClose)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(screen.queryByText("1,800")).toBeNull()
    expect(screen.queryByText(en["credits.shortByAmount"].replace("{n}", "200"))).toBeNull()
  })

  it("signing out closes it too", async () => {
    const onClose = vi.fn()
    const view = await grantedButShortForA(onClose)
    server.userId = undefined
    view.rerender(dialog({ required: 2000, available: 0, onClose }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
