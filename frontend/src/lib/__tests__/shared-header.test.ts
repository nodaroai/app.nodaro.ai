import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The ONE gate the layout, the sidebar and the editor toolbar read: the shared
 * header replaces the sidebar's own chrome only on a cloud build with the flag
 * on, on a page that is not embedded, on a deployment with Nodaro's own
 * branding, platform links and self-serve billing.
 */

const state = {
  hasSharedHeader: true,
  embedded: false,
  platformLinks: true,
  selfServe: true,
  cardHidden: false,
  brand: undefined as string | undefined,
}

vi.mock("@/lib/edition", () => ({ hasSharedHeader: () => state.hasSharedHeader }))
vi.mock("@/hooks/use-embed-session-handoff", () => ({ isEmbedded: () => state.embedded }))
vi.mock("@/lib/surface-selectors", () => ({
  surfacePlatformLinks: () => state.platformLinks,
  surfaceBillingSelfServe: () => state.selfServe,
  surfaceSidebarCreditCardHidden: () => state.cardHidden,
  surfaceConfiguredBrandName: () => state.brand,
}))

const { markSharedHeaderFailed, resetSharedHeaderFailureForTests, sharedHeaderActive, useSharedHeaderActive } = await import("../shared-header")
const { act, renderHook } = await import("@testing-library/react")

beforeEach(() => {
  Object.assign(state, { hasSharedHeader: true, embedded: false, platformLinks: true, selfServe: true, cardHidden: false, brand: undefined })
  resetSharedHeaderFailureForTests()
})

describe("when the header fails to load or render", () => {
  it("the gate closes for the rest of the page's life, so today's chrome comes back", () => {
    expect(sharedHeaderActive()).toBe(true)
    markSharedHeaderFailed()
    expect(sharedHeaderActive()).toBe(false)
  })

  it("components reading the gate re-render with it closed", () => {
    const { result } = renderHook(() => useSharedHeaderActive())
    expect(result.current).toBe(true)
    act(() => markSharedHeaderFailed())
    expect(result.current).toBe(false)
  })
})

describe("sharedHeaderActive", () => {
  it("on: cloud + flag, top-level page, Nodaro's own deployment", () => {
    expect(sharedHeaderActive()).toBe(true)
  })

  it.each([
    ["the flag is off (or not a cloud build)", { hasSharedHeader: false }],
    ["the page is embedded (a product's billing iframe)", { embedded: true }],
    ["a white-label deployment (its own brand name)", { brand: "Acme Studio" }],
    ["a deployment that hides Nodaro's platform links", { platformLinks: false }],
    ["a prepaid deployment (no self-serve billing)", { selfServe: false }],
    ["a deployment that hides the credit card", { cardHidden: true }],
  ])("off when %s", (_why, change) => {
    Object.assign(state, change)
    expect(sharedHeaderActive()).toBe(false)
  })
})
