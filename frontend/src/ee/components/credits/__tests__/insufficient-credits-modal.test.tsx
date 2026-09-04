import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"
import { useLocaleStore } from "@/lib/locale-store"
import { en } from "@/lib/i18n/en"
import { he } from "@/lib/i18n/he"

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

const { mockSurface, mockSelfServe } = vi.hoisted(() => ({
  mockSurface: vi.fn<() => { surface: Record<string, unknown>; isLoading: boolean }>(() => ({
    surface: { deploymentPayer: false },
    isLoading: false,
  })),
  mockSelfServe: vi.fn(() => true),
}))

vi.mock("@/hooks/use-billing-surface", () => ({ useBillingSurface: () => mockSurface() }))
vi.mock("@/lib/surface-selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-selectors")>()),
  surfaceBillingSelfServe: () => mockSelfServe(),
}))

import { InsufficientCreditsModal } from "../InsufficientCreditsModal"

function open(props: Partial<React.ComponentProps<typeof InsufficientCreditsModal>> = {}) {
  return render(
    <InsufficientCreditsModal
      open
      onClose={() => {}}
      required={12_000}
      available={4_000}
      tier="free"
      {...props}
    />,
  )
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
  useLocaleStore.setState({ locale: "en" })
  mockSurface.mockReturnValue({ surface: { deploymentPayer: false }, isLoading: false })
  mockSelfServe.mockReturnValue(true)
})

describe("InsufficientCreditsModal — mainline self-serve (unchanged)", () => {
  it("still offers both purchase paths", () => {
    open()
    expect(purchaseCtas().length).toBe(2)
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
