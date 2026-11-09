import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"

const h = vi.hoisted(() => ({
  claim: vi.fn(),
  seen: vi.fn().mockResolvedValue(undefined),
  collectKeys: vi.fn().mockResolvedValue({ browserKey: "a".repeat(64) }),
  surface: {} as { deploymentPayer?: boolean },
}))

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => true, isCloud: () => true }))
vi.mock("@/ee/lib/ensure-signup-grant", () => ({ collectKeys: h.collectKeys }))
vi.mock("@/hooks/use-billing-surface", () => ({ useBillingSurface: () => ({ surface: h.surface, isLoading: false }) }))
vi.mock("../welcome-offer-api", () => ({
  SOURCE_APP: "app",
  claimWelcomeOffer: h.claim,
  markWelcomeOfferSeen: h.seen,
}))

import { useWelcomeOffer, useWelcomeOfferClaim } from "../use-welcome-offer"
import { useWelcomeOfferStore } from "../welcome-offer-store"
import { queryKeys } from "@/lib/query-keys"
import type { UserBalance } from "@/lib/api"

const BASE: UserBalance = {
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

function setup(balance: Partial<UserBalance>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.credits.balance("u1"), { ...BASE, ...balance })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.surface = {}
  useWelcomeOfferStore.setState({ claimedCredits: null, consentAskVersion: 0 })
})

afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

/**
 * The mode derivation is the whole product rule on the client; the popup and
 * banner tests mock this hook out, so the balance → mode table is pinned here.
 */
describe("useWelcomeOffer — mode from the balance", () => {
  it("offer OFF (no welcomeOffer key): nothing, even for an unclaimed account", () => {
    const { wrapper } = setup({ freeGrantState: "unclaimed" })
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    expect(result.current.mode).toBeNull()
    expect(result.current.popupDue).toBe(false)
  })

  it("unclaimed + popup not seen: offer, popup due", () => {
    const { wrapper } = setup({ freeGrantState: "unclaimed", welcomeOffer: { popupSeen: false, consentPending: false, credits: 1500 } })
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    expect(result.current.mode).toBe("offer")
    expect(result.current.popupDue).toBe(true)
  })

  it("unclaimed + popup seen: offer (banner only), popup not due", () => {
    const { wrapper } = setup({ freeGrantState: "unclaimed", welcomeOffer: { popupSeen: true, consentPending: false, credits: 1500 } })
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    expect(result.current.mode).toBe("offer")
    expect(result.current.popupDue).toBe(false)
  })

  it("granted, consent owed (extension): consent-pending", () => {
    const { wrapper } = setup({ freeGrantState: "granted", welcomeOffer: { popupSeen: false, consentPending: true, credits: 1500 } })
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    expect(result.current.mode).toBe("consent-pending")
    expect(result.current.popupDue).toBe(false)
  })

  it("withheld: nothing, even with the consent mark — the activation banner owns that state", () => {
    const { wrapper } = setup({ freeGrantState: "withheld", welcomeOffer: { popupSeen: false, consentPending: true, credits: 1500 } })
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    expect(result.current.mode).toBeNull()
  })

  it("granted and settled: nothing", () => {
    const { wrapper } = setup({ freeGrantState: "granted", welcomeOffer: { popupSeen: true, consentPending: false, credits: 1500 } })
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    expect(result.current.mode).toBeNull()
  })

  it("the credit figure is the server's (welcomeOffer.credits), never a local constant", () => {
    const { wrapper } = setup({ freeGrantState: "unclaimed", welcomeOffer: { popupSeen: false, consentPending: false, credits: 2750 } })
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    expect(result.current.mode).toBe("offer")
    expect(result.current.credits).toBe("2,750")
  })

  it("an offer without a numeric figure shows no surface (never \"0 free credits\")", () => {
    const welcomeOffer = { popupSeen: false, consentPending: false } as unknown as UserBalance["welcomeOffer"]
    const { wrapper } = setup({ freeGrantState: "unclaimed", welcomeOffer })
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    expect(result.current.mode).toBeNull()
    expect(result.current.popupDue).toBe(false)
    expect(result.current.credits).toBe("")
  })

  it("while the balance is loading: no surface and no figure", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    expect(result.current.mode).toBeNull()
    expect(result.current.popupDue).toBe(false)
    expect(result.current.credits).toBe("")
  })

  it("markSeen flips the cached popupSeen at once and posts once", async () => {
    const { client, wrapper } = setup({ freeGrantState: "unclaimed", welcomeOffer: { popupSeen: false, consentPending: false, credits: 1500 } })
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    act(() => result.current.markSeen())
    expect(client.getQueryData<UserBalance>(queryKeys.credits.balance("u1"))?.welcomeOffer?.popupSeen).toBe(true)
    await waitFor(() => expect(result.current.popupDue).toBe(false))
    expect(h.seen).toHaveBeenCalledTimes(1)
  })

  it("claim sends the fingerprints and refreshes the balance", async () => {
    const { client, wrapper } = setup({ freeGrantState: "unclaimed", welcomeOffer: { popupSeen: false, consentPending: false, credits: 1500 } })
    h.claim.mockResolvedValue({ consent: "granted", grant: "granted", credits: 1500 })
    const invalidate = vi.spyOn(client, "invalidateQueries")
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    await act(async () => {
      await result.current.claim()
    })
    expect(h.claim).toHaveBeenCalledWith({ browserKey: "a".repeat(64) })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.credits.balance("u1") })
  })
})

/**
 * A deployment that sells nothing (`billing.selfServe: false`) or has a single
 * payer gives no free credits of one's own, so there is no offer to make: the
 * popup and the banner read the mode, and this is where it is decided. The
 * consent ask is not an offer, and it is the only way out of a refused create
 * (`403 consent_required`), so it stays.
 */
describe("useWelcomeOffer — a deployment with no personal free credits", () => {
  const OFFER = { freeGrantState: "unclaimed", welcomeOffer: { popupSeen: false, consentPending: false, credits: 1500 } } as const
  const sellsNothing = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: false } } } as const

  it("billing.selfServe false: no offer and no popup, for an account the offer would otherwise reach", () => {
    window.__NODARO_RUNTIME__ = sellsNothing
    const { wrapper } = setup(OFFER)
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    expect(result.current.mode).toBeNull()
    expect(result.current.popupDue).toBe(false)
  })

  it("a deployment payer: no offer either", () => {
    h.surface = { deploymentPayer: true }
    const { wrapper } = setup(OFFER)
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    expect(result.current.mode).toBeNull()
    expect(result.current.popupDue).toBe(false)
  })

  it("the consent ask stays, whatever the deployment sells", () => {
    window.__NODARO_RUNTIME__ = sellsNothing
    h.surface = { deploymentPayer: true }
    const { wrapper } = setup({ freeGrantState: "granted", welcomeOffer: { popupSeen: false, consentPending: true, credits: 1500 } })
    const { result } = renderHook(() => useWelcomeOffer(), { wrapper })
    expect(result.current.mode).toBe("consent-pending")
  })
})

describe("useWelcomeOfferClaim", () => {
  it("a claim that moved nothing (grant still unclaimed) counts as a failure", async () => {
    const { wrapper } = setup({ freeGrantState: "unclaimed", welcomeOffer: { popupSeen: false, consentPending: false, credits: 1500 } })
    h.claim.mockResolvedValue({ consent: "granted", grant: "unclaimed", credits: 1500 })
    const { result } = renderHook(
      () => {
        const offer = useWelcomeOffer()
        return useWelcomeOfferClaim(offer)
      },
      { wrapper },
    )
    let outcome: unknown = "unset"
    await act(async () => {
      outcome = await result.current.run()
    })
    expect(outcome).toBeNull()
    expect(result.current.failed).toBe(true)
    expect(useWelcomeOfferStore.getState().claimedCredits).toBeNull()
  })
})
