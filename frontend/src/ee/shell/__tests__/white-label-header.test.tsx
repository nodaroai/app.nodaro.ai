import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, useLocation } from "react-router-dom"
import { useLocaleStore } from "@/lib/locale-store"
import { __failSurfaceAvailabilityForTests, __resetSurfaceAvailabilityForTests } from "@/lib/surface-availability"
import { WHITE_LABEL_WORLD_PATHS } from "../site"
import type { SiteHeaderProps } from "../types"

/**
 * The header mount on a deployment whose surface profile says
 * `header: "white-label"`: the npm header's white-label mode (the hosted
 * element has none), wired from the deployment's profile and runtime config,
 * with nothing of Nodaro's in it.
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
// The viewer's language, and the rows the one helper hands out for it (as the real hook does).
const ui = vi.hoisted(() => ({ locale: "he" }))
vi.mock("@/hooks/use-ui-language", async () => {
  const { languageMenuRows } = await vi.importActual<typeof import("@/lib/i18n/offered-locales")>("@/lib/i18n/offered-locales")
  return { useUiLanguage: () => ({ locale: ui.locale, rows: languageMenuRows(ui.locale as never), pick: vi.fn() }) }
})

vi.mock("@/lib/site-header-mode", () => ({
  siteHeaderMode: () => "white-label",
  siteHeaderCookieOptions: () => ({ cookieDomain: null }),
}))

// The SDK's balance read, as the server answers it on a single-payer deployment with its own unit.
const sdk = vi.hoisted(() => ({
  balance: async (): Promise<Record<string, unknown>> => ({
    subscription: 0, topup: 0, total: 0, tier: "free", effectiveTier: "free", dailySpent: 0, dailyLimit: null, monthlyAllocation: 0,
    allowance: { granted: 2000, remaining: 1500, enforced: true },
    display: { unit: "tokens", decimals: 0, total: 0, subscription: 0, topup: 0, dailySpent: 0, dailyLimit: null, monthlyAllocation: 0, appCreditsAllowance: 0, allowance: { granted: 8000000, remaining: 6000000 } },
  }),
}))
vi.mock("@nodaro/sdk/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nodaro/sdk/client")>()),
  createClient: () => ({ credits: { balance: () => sdk.balance() }, me: {}, billing: {}, request: vi.fn() }),
}))

const opened = vi.hoisted(() => [] as string[])
vi.mock("../white-label", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../white-label")>()),
  openSitePage: (href: string) => opened.push(href),
}))

const { default: WhiteLabelHeader } = await import("../white-label-header")

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
        <WhiteLabelHeader compact={false} onOpenMenu={vi.fn()} onHeaderOverlay={vi.fn()} drawerOpen={false} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { view, client, props: () => seen.props as SiteHeaderProps }
}

beforeEach(() => {
  seen.props = null
  opened.length = 0
  ui.locale = "he"
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

  it("may draw images from the deployment's media host, beside the logo's", () => {
    window.__NODARO_RUNTIME__ = { surface: WHITE_LABEL_SURFACE, mediaOrigin: "https://cdn.acme.example" } as unknown as typeof window.__NODARO_RUNTIME__
    expect(mount().props().imageOrigins).toEqual(["https://media.acme.example", "https://cdn.acme.example"])
  })

  it("with no media host in /config.js, or one that is not an https origin: the logo's host alone, as before", () => {
    expect(mount().props().imageOrigins).toEqual(["https://media.acme.example"])
    cleanup()
    window.__NODARO_RUNTIME__ = { surface: WHITE_LABEL_SURFACE, mediaOrigin: "http://cdn.acme.example" } as unknown as typeof window.__NODARO_RUNTIME__
    expect(mount().props().imageOrigins).toEqual(["https://media.acme.example"])
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
          <WhiteLabelHeader compact={false} onOpenMenu={vi.fn()} onHeaderOverlay={vi.fn()} drawerOpen={false} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(seen.props?.worlds).toEqual(["video", "app"])
  })

  it("Video's menu opens Translate only once the viewer's answer offers dubbing", () => {
    const { view, client } = mount()
    const rerender = () =>
      view.rerender(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/projects"]}>
            <WhiteLabelHeader compact={false} onOpenMenu={vi.fn()} onHeaderOverlay={vi.fn()} drawerOpen={false} />
          </MemoryRouter>
        </QueryClientProvider>,
      )
    // Before the answer: no page below a world, so none is drawn and then taken away.
    expect(seen.props?.worldMenus).toEqual({ video: { pages: [] } })
    act(() => __resetSurfaceAvailabilityForTests({ nodes: [], models: [], worlds: ["video", "app"] }))
    rerender()
    expect(seen.props?.worldMenus).toEqual({ video: { pages: ["translate"] } })
    act(() => __resetSurfaceAvailabilityForTests({ nodes: ["dubbing"], models: [], worlds: ["video", "app"] }))
    rerender()
    expect(seen.props?.worldMenus).toEqual({ video: { pages: [] } })
  })

  it("a read of the viewer's answer that failed falls back to the deployment's profile: Translate, where it does not deny dubbing", () => {
    mount()
    expect(seen.props?.worldMenus).toEqual({ video: { pages: [] } })
    // The header follows the store on its own (no re-render from outside).
    act(() => __failSurfaceAvailabilityForTests())
    expect(seen.props?.worldMenus).toEqual({ video: { pages: ["translate"] } })
    // An answer landing afterwards is the answer.
    act(() => __resetSurfaceAvailabilityForTests({ nodes: ["dubbing"], models: [] }))
    expect(seen.props?.worldMenus).toEqual({ video: { pages: [] } })
  })

  it("a read that failed on a deployment whose profile denies dubbing: no Translate", () => {
    window.__NODARO_RUNTIME__ = { surface: { ...WHITE_LABEL_SURFACE, nodes: { deny: ["dubbing"], allow: [] } } } as unknown as typeof window.__NODARO_RUNTIME__
    mount()
    act(() => __failSurfaceAvailabilityForTests())
    expect(seen.props?.worldMenus).toEqual({ video: { pages: [] } })
    // Another node the profile denies does not touch it.
    cleanup()
    window.__NODARO_RUNTIME__ = { surface: { ...WHITE_LABEL_SURFACE, nodes: { deny: ["suno-generate"], allow: [] } } } as unknown as typeof window.__NODARO_RUNTIME__
    mount()
    act(() => __failSurfaceAvailabilityForTests())
    expect(seen.props?.worldMenus).toEqual({ video: { pages: ["translate"] } })
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

  it("the balance the header reads names the unit in the language on screen at that moment", async () => {
    const balance = sdk.balance
    sdk.balance = async () => ({
      subscription: 0, topup: 0, total: 0, tier: "free", effectiveTier: "free", dailySpent: 0, dailyLimit: null, monthlyAllocation: 0,
      display: { unit: "טוקנים", unitLabels: { en: "tokens", he: "טוקנים" }, decimals: 0, total: 5, subscription: 0, topup: 0, dailySpent: 0, dailyLimit: null, monthlyAllocation: 0, appCreditsAllowance: 0 },
    })
    try {
      const props = mount().props()
      useLocaleStore.setState({ locale: "en" })
      expect((await props.sdk.credits.balance()).display?.unit).toBe("tokens")
      useLocaleStore.setState({ locale: "he" })
      expect((await props.sdk.credits.balance()).display?.unit).toBe("טוקנים")
      useLocaleStore.setState({ locale: "ja" })
      expect((await props.sdk.credits.balance()).display?.unit).toBe("טוקנים")
    } finally {
      sdk.balance = balance
      useLocaleStore.setState({ locale: "en" })
    }
  })

  it("a language change reads the balance again, so the unit's word follows it (only where the deployment gave words)", () => {
    const client = new QueryClient()
    const refetch = vi.spyOn(client, "invalidateQueries")
    client.setQueryData(["credits"], { total: 1, display: { unit: "טוקנים", unitLabels: { en: "tokens", he: "טוקנים" } } })
    const first = mount(client)
    expect(refetch).not.toHaveBeenCalled()
    ui.locale = "en"
    first.view.rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/projects"]}>
          <WhiteLabelHeader compact={false} onOpenMenu={vi.fn()} onHeaderOverlay={vi.fn()} drawerOpen={false} />
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(refetch).toHaveBeenCalledOnce()
    expect(refetch).toHaveBeenCalledWith({ queryKey: ["credits"], exact: true })

    // A deployment with one label: nothing to re-word, no extra request.
    cleanup()
    const single = new QueryClient()
    const noRefetch = vi.spyOn(single, "invalidateQueries")
    single.setQueryData(["credits"], { total: 1, display: { unit: "tokens" } })
    ui.locale = "he"
    const second = mount(single)
    ui.locale = "en"
    second.view.rerender(
      <QueryClientProvider client={single}>
        <MemoryRouter initialEntries={["/projects"]}>
          <WhiteLabelHeader compact={false} onOpenMenu={vi.fn()} onHeaderOverlay={vi.fn()} drawerOpen={false} />
          <Where />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(noRefetch).not.toHaveBeenCalled()
  })

  it("no unit (the payer's own read, or none configured): the header's own credit words", () => {
    const client = new QueryClient()
    client.setQueryData(["credits"], { total: 1500 })
    expect(mount(client).props().t?.("credits.label")).toBe("he:credits.label")
  })
})
