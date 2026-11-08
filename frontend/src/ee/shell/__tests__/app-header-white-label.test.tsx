import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, useLocation } from "react-router-dom"
import { __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { WHITE_LABEL_WORLD_PATHS } from "../site"
import type { SiteHeaderProps } from "../types"

/**
 * The header mount on a deployment whose surface profile says
 * `header: "white-label"`: the header's white-label mode, wired from the
 * deployment's profile and runtime config, with nothing of Nodaro's in it.
 * And, beside it, the proof that every other deployment's header is wired
 * exactly as before: the same props, no more and no fewer.
 */

const seen: { props: SiteHeaderProps | null } = { props: null }
vi.mock("virtual:site-header", () => ({
  headerAvailable: true,
  NodaroShell: (props: SiteHeaderProps) => {
    seen.props = props
    return <div data-testid="header" />
  },
  shellTranslator: (locale: string | undefined) => (key: string) => `${locale}:${key}`,
}))
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: {} }) }))
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }))
vi.mock("@/hooks/use-ui-language", () => ({
  useUiLanguage: () => ({
    locale: "he",
    rows: [
      { id: "en", nativeName: "English", englishName: "English", shortCode: "EN", dir: "ltr" },
      { id: "he", nativeName: "עברית", englishName: "Hebrew", shortCode: "HE", dir: "rtl" },
      { id: "ja", nativeName: "日本語", englishName: "Japanese", shortCode: "JA", dir: "ltr" },
    ],
    pick: vi.fn(),
  }),
}))

const mode = vi.hoisted(() => ({ value: "white-label" as "default" | "white-label" | null }))
vi.mock("@/lib/site-header-mode", () => ({
  siteHeaderMode: () => mode.value,
  siteHeaderCookieOptions: () => (mode.value === "white-label" ? { cookieDomain: null } : {}),
}))

// The SDK's balance read, as the server answers it on a single-payer deployment with its own unit.
const sdk = vi.hoisted(() => ({
  balance: async () => ({
    subscription: 0, topup: 0, total: 0, tier: "free", effectiveTier: "free", dailySpent: 0, dailyLimit: null, monthlyAllocation: 0,
    allowance: { granted: 2000, remaining: 1500, enforced: true },
    display: { unit: "tokens", decimals: 0, total: 0, subscription: 0, topup: 0, dailySpent: 0, dailyLimit: null, monthlyAllocation: 0, appCreditsAllowance: 0, allowance: { granted: 8000000, remaining: 6000000 } },
  }),
}))
vi.mock("@nodaro/sdk/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/sdk/client")>()),
  createClient: () => ({ credits: { balance: sdk.balance }, me: {}, billing: {}, request: vi.fn() }),
}))

const opened = vi.hoisted(() => [] as string[])
vi.mock("../white-label", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../white-label")>()),
  openSitePage: (href: string) => opened.push(href),
}))

const { default: AppHeader } = await import("../app-header")

const WHITE_LABEL_SURFACE = {
  header: "white-label",
  brand: { productName: "Acme Studio", logo: "https://media.acme.example/brand/logo.svg", platformLinks: false },
  billing: { selfServe: false },
  worlds: { allow: ["image", "video", "music", "app", "explore", "studio"], order: ["app", "video"] },
  locale: { offered: ["he", "en"] },
}

let path = ""
function Where() {
  const location = useLocation()
  path = `${location.pathname}${location.search}`
  return null
}

function mount(client = new QueryClient()) {
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/projects"]}>
        <AppHeader compact={false} onOpenMenu={vi.fn()} onHeaderOverlay={vi.fn()} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { view, client, props: () => seen.props as SiteHeaderProps }
}

beforeEach(() => {
  seen.props = null
  opened.length = 0
  mode.value = "white-label"
  window.__NODARO_RUNTIME__ = { surface: WHITE_LABEL_SURFACE } as unknown as typeof window.__NODARO_RUNTIME__
})
afterEach(() => {
  cleanup()
  __resetSurfaceAvailabilityForTests(null)
  delete window.__NODARO_RUNTIME__
})

describe("the header mount on a white-label deployment", () => {
  it("is the header's white-label mode, with the deployment's name, logo, billing and cookies", () => {
    const props = mount().props()
    expect(props.whiteLabel).toBe(true)
    expect(props.brandName).toBe("Acme Studio")
    expect(props.logo).toEqual({ src: "https://media.acme.example/brand/logo.svg", alt: "Acme Studio" })
    expect(props.imageOrigins).toEqual(["https://media.acme.example"])
    expect(props.selfServe).toBe(false)
    expect(props.cookieDomain).toBeNull()
    // Still the app itself: its own account pages and sign-in, no grant claim of the header's.
    expect(props.accountPages).toBe("in-app")
    expect(props.claimSignupGrant).toBe(false)
  })

  it("every link is the deployment's: worlds by path on this site, home the site's root, sign-in this app's page", () => {
    const props = mount().props()
    expect(props.worldHrefs).toEqual(WHITE_LABEL_WORLD_PATHS)
    expect(Object.values(props.worldHrefs ?? {}).every((href) => href?.startsWith("/") && !href.startsWith("//"))).toBe(true)
    expect(props.homeUrl).toBe("/")
    // No Nodaro address — not even the accessibility statement, which is Nodaro's.
    expect(props.urls).toEqual({ app: window.location.origin, login: "/login", home: "/" })
  })

  it("draws the profile's worlds in its order before the server answers, then the viewer's", () => {
    const { view, client } = mount()
    // Explore and Studio have no address on the site, so they are never drawn.
    expect(seen.props?.worlds).toEqual(["app", "video", "image", "music"])
    act(() => __resetSurfaceAvailabilityForTests({ nodes: [], models: [], worlds: ["video", "app"] }))
    view.rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/projects"]}>
          <AppHeader compact={false} onOpenMenu={vi.fn()} onHeaderOverlay={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(seen.props?.worlds).toEqual(["video", "app"])
  })

  it("the app's own pages go through the router; another app's page on the site is a full page load", () => {
    const props = mount().props()
    act(() => props.onNavigate?.("/projects?tab=templates"))
    expect(path).toBe("/projects?tab=templates")
    act(() => props.onNavigate?.("/image"))
    act(() => props.onNavigate?.("/"))
    expect(opened).toEqual(["/image", "/"])
    expect(path).toBe("/projects?tab=templates")
  })

  it("offers only the deployment's languages, and no language pill where it hides the choice", () => {
    expect(mount().props().language?.options.map((o) => o.id)).toEqual(["en", "he"])
    cleanup()
    window.__NODARO_RUNTIME__ = { surface: { ...WHITE_LABEL_SURFACE, locale: { offered: ["he", "en"], picker: false } } } as unknown as typeof window.__NODARO_RUNTIME__
    expect(mount().props().language).toBeUndefined()
  })

  it("the credit pill shows the server's converted allowance, worded in the deployment's unit", async () => {
    const props = mount().props()
    const balance = await props.sdk.credits.balance()
    expect(balance).toMatchObject({ total: 6000000, subscription: 6000000, monthlyAllocation: 8000000 })
    // Before the header has the balance: its own words.
    expect(props.t?.("credits.label")).toBe("he:credits.label")
  })

  it("once the header holds a balance in the deployment's unit, its credit words name that unit", () => {
    const client = new QueryClient()
    client.setQueryData(["credits"], { total: 6000000, display: { unit: "tokens" } })
    const props = mount(client).props()
    expect(props.t?.("credits.label")).toBe("tokens")
    expect(props.t?.("credits.balance", { credits: "6,000,000" })).toBe("6,000,000 tokens")
    expect(props.t?.("account.creditsLeft")).toBe("tokens left")
    expect(props.t?.("account.settings")).toBe("he:account.settings")
  })

  it("no unit (the payer's own read, or none configured): the header's own credit words", () => {
    const client = new QueryClient()
    client.setQueryData(["credits"], { total: 1500 })
    expect(mount(client).props().t?.("credits.label")).toBe("he:credits.label")
  })
})

describe("every other deployment's header is wired exactly as before", () => {
  // The props today's mount passes: no white-label key, and none of today's missing.
  const TODAY = [
    "accessibilityButton", "accountMenuExtras", "accountPages", "activeWorld", "claimSignupGrant", "homeUrl", "language",
    "leadingSlot", "locale", "onAccountPage", "onNavigate", "onOverlayChange", "onSignOut", "phoneBreakpoint",
    "phoneLayout", "queryClient", "ref", "sdk", "sourceApp", "supabase", "t", "theme", "urls", "worldHrefs",
  ]

  it.each([["Nodaro's own header", "default"], ["no header mode at all", null]] as const)("%s: today's props", (_label, value) => {
    mode.value = value
    delete window.__NODARO_RUNTIME__
    const props = mount().props()
    expect(Object.keys(props).sort()).toEqual(TODAY)
    expect(props.urls).toEqual({ app: window.location.origin, login: "/login", accessibility: `${window.location.origin}/accessibility` })
    expect(props.worldHrefs?.app).toBe(`${window.location.origin}/projects`)
    expect(props.language?.options.map((o) => o.id)).toEqual(["en", "he", "ja"])
    // The header's own translator, unwrapped.
    expect(props.t?.("credits.label")).toBe("he:credits.label")
  })

  it("Nodaro's header gets the SDK client as it is: the balance is the server's, untouched", async () => {
    mode.value = "default"
    delete window.__NODARO_RUNTIME__
    const balance = await mount().props().sdk.credits.balance()
    expect(balance).toMatchObject({ total: 0, subscription: 0, monthlyAllocation: 0 })
  })
})
