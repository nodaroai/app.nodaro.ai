import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Which shared header a DEPLOYMENT shows, before any reason of one page's
 * (embedded, the header failed): what the locale and accessibility stores
 * follow, and what the page gate (`lib/shared-header.ts`) narrows.
 *
 *   - Nodaro's header: a build that may show it ("true", staging) on Nodaro's
 *     own deployment, exactly today's rule;
 *   - white-label: the surface profile says `header: "white-label"` on a build
 *     that carries the header (either value);
 *   - otherwise none — in particular on the image built for deployments of
 *     their own ("white-label") wherever the profile does not ask for it.
 */

const state = {
  nodaroHeader: true,
  whiteLabelHeader: true,
  headerMode: "default" as "default" | "white-label",
  platformLinks: true,
  selfServe: true,
  cardHidden: false,
  brand: undefined as string | undefined,
}

// A build that carries the header (Vite inlines the flag; without it the mode is null before anything is asked).
vi.stubEnv("VITE_SHARED_HEADER", "true")

vi.mock("@/lib/edition", () => ({
  hasSharedHeader: () => state.nodaroHeader,
  hasWhiteLabelHeader: () => state.whiteLabelHeader,
}))
vi.mock("@/lib/surface-selectors", () => ({
  surfaceHeaderMode: () => state.headerMode,
  surfacePlatformLinks: () => state.platformLinks,
  surfaceBillingSelfServe: () => state.selfServe,
  surfaceSidebarCreditCardHidden: () => state.cardHidden,
  surfaceConfiguredBrandName: () => state.brand,
}))

const { siteHeaderMode, siteHeaderCookieOptions } = await import("../site-header-mode")

beforeEach(() => {
  Object.assign(state, {
    nodaroHeader: true,
    whiteLabelHeader: true,
    headerMode: "default",
    platformLinks: true,
    selfServe: true,
    cardHidden: false,
    brand: undefined,
  })
})

describe("siteHeaderMode", () => {
  it("Nodaro's header on Nodaro's own deployment, on a build that may show it (today's rule)", () => {
    expect(siteHeaderMode()).toBe("default")
  })

  it.each([
    ["a build without Nodaro's header (the image for deployments of their own)", { nodaroHeader: false }],
    ["a deployment with a brand name of its own", { brand: "Acme Studio" }],
    ["a deployment that hides Nodaro's platform links", { platformLinks: false }],
    ["a prepaid deployment (no self-serve billing)", { selfServe: false }],
    ["a deployment that hides the credit card", { cardHidden: true }],
  ])("no header without the white-label key on %s", (_why, change) => {
    Object.assign(state, change)
    expect(siteHeaderMode()).toBeNull()
  })

  it("white-label where the profile asks for it, whatever else the profile says", () => {
    Object.assign(state, { headerMode: "white-label", brand: "Acme Studio", platformLinks: false, selfServe: false, cardHidden: true })
    expect(siteHeaderMode()).toBe("white-label")
    // The image for deployments of their own carries it too.
    state.nodaroHeader = false
    expect(siteHeaderMode()).toBe("white-label")
  })

  it("white-label asked for on a build without the header: none", () => {
    Object.assign(state, { headerMode: "white-label", nodaroHeader: false, whiteLabelHeader: false })
    expect(siteHeaderMode()).toBeNull()
  })
})

describe("siteHeaderCookieOptions", () => {
  it("host-only on a white-label deployment, the header's own rule anywhere else", () => {
    expect(siteHeaderCookieOptions()).toEqual({})
    state.headerMode = "white-label"
    expect(siteHeaderCookieOptions()).toEqual({ cookieDomain: null })
  })
})

describe("a build without the header", () => {
  it("answers none before asking the edition or the surface profile", () => {
    vi.stubEnv("VITE_SHARED_HEADER", "")
    try {
      Object.assign(state, { headerMode: "white-label" })
      expect(siteHeaderMode()).toBeNull()
      expect(siteHeaderCookieOptions()).toEqual({})
    } finally {
      vi.stubEnv("VITE_SHARED_HEADER", "true")
    }
  })

  it("the image for deployments of their own (\"white-label\") carries it", () => {
    vi.stubEnv("VITE_SHARED_HEADER", "white-label")
    try {
      Object.assign(state, { headerMode: "white-label", nodaroHeader: false })
      expect(siteHeaderMode()).toBe("white-label")
    } finally {
      vi.stubEnv("VITE_SHARED_HEADER", "true")
    }
  })
})
