import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The ONE gate the layout, the sidebar and the editor toolbar read: the shared
 * header replaces the sidebar's own chrome only on a cloud build with the flag
 * on, on a page that is not embedded, on a deployment with Nodaro's own
 * branding, platform links and self-serve billing — or, in white-label mode,
 * where the deployment's surface profile asks for its own header.
 */

const state = {
  hasSharedHeader: true,
  hasWhiteLabelHeader: true,
  headerMode: "default" as "default" | "white-label",
  embedded: false,
  platformLinks: true,
  selfServe: true,
  cardHidden: false,
  brand: undefined as string | undefined,
}

// A build that carries the header (Vite inlines the flag; without it the mode is null before anything is asked).
vi.stubEnv("VITE_SHARED_HEADER", "true")

vi.mock("@/lib/edition", () => ({
  hasSharedHeader: () => state.hasSharedHeader,
  hasWhiteLabelHeader: () => state.hasWhiteLabelHeader,
}))
vi.mock("@/hooks/use-embed-session-handoff", () => ({ isEmbedded: () => state.embedded }))
vi.mock("@/lib/surface-selectors", () => ({
  surfaceHeaderMode: () => state.headerMode,
  surfacePlatformLinks: () => state.platformLinks,
  surfaceBillingSelfServe: () => state.selfServe,
  surfaceSidebarCreditCardHidden: () => state.cardHidden,
  surfaceConfiguredBrandName: () => state.brand,
}))

const { markSharedHeaderFailed, resetSharedHeaderFailureForTests, sharedHeaderActive, sharedHeaderMode, useSharedHeaderActive } = await import("../shared-header")
const { act, renderHook } = await import("@testing-library/react")

beforeEach(() => {
  Object.assign(state, {
    hasSharedHeader: true,
    hasWhiteLabelHeader: true,
    headerMode: "default",
    embedded: false,
    platformLinks: true,
    selfServe: true,
    cardHidden: false,
    brand: undefined,
  })
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

describe("white-label mode (surface `header: \"white-label\"`)", () => {
  const whiteLabel = { headerMode: "white-label", brand: "Acme Studio", platformLinks: false, selfServe: false, cardHidden: true } as const

  it("shows the deployment's own header where today's rule shows none", () => {
    Object.assign(state, whiteLabel)
    expect(sharedHeaderActive()).toBe(true)
    expect(sharedHeaderMode()).toBe("white-label")
  })

  it("on the image for deployments of their own (no Nodaro header in it) too", () => {
    Object.assign(state, whiteLabel, { hasSharedHeader: false })
    expect(sharedHeaderMode()).toBe("white-label")
  })

  it("keeps the embed guard, and closes when the header fails", () => {
    Object.assign(state, whiteLabel, { embedded: true })
    expect(sharedHeaderActive()).toBe(false)
    state.embedded = false
    markSharedHeaderFailed()
    expect(sharedHeaderActive()).toBe(false)
  })

  it("without the key, a build that carries only the white-label header shows none", () => {
    Object.assign(state, { hasSharedHeader: false })
    expect(sharedHeaderMode()).toBeNull()
  })

  it("Nodaro's own deployment shows Nodaro's header, as before", () => {
    expect(sharedHeaderMode()).toBe("default")
  })
})
