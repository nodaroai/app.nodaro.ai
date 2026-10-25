import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, useLocation } from "react-router-dom"
import { ACCESSIBILITY_STATEMENT_PATH } from "@/lib/accessibility-statement"
import { useSharedHeaderMounted } from "@/lib/shared-header"
import type { SiteHeaderProps } from "../types"

/**
 * The app's ONE mount of the shared site header: what it hands the header.
 * The header itself is the cloud-only package; here a stand-in records props.
 */

const seen: { props: SiteHeaderProps | null } = { props: null }
const translators = vi.fn((locale: string | undefined) => (key: string) => `${locale}:${key}`)
vi.mock("virtual:site-header", () => ({
  headerAvailable: true,
  NodaroShell: (props: SiteHeaderProps) => {
    seen.props = props
    return <div data-testid="header">{props.leadingSlot}</div>
  },
  shellTranslator: (locale: string | undefined) => translators(locale),
}))

vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: {} }) }))

const theme = { resolvedTheme: "dark" as string | undefined, setTheme: vi.fn() }
vi.mock("next-themes", () => ({ useTheme: () => theme }))

const pick = vi.fn()
vi.mock("@/hooks/use-ui-language", () => ({
  useUiLanguage: () => ({
    locale: "he",
    rows: [
      { id: "en", nativeName: "English", englishName: "English", shortCode: "EN", dir: "ltr" },
      { id: "he", nativeName: "עברית", englishName: "Hebrew", shortCode: "HE", dir: "rtl" },
    ],
    pick,
  }),
}))

const { default: AppHeader } = await import("../app-header")

let path = ""
function Where() {
  const location = useLocation()
  path = `${location.pathname}${location.search}`
  return null
}

function mount(props: Partial<Parameters<typeof AppHeader>[0]> = {}, at = "/projects") {
  const onOpenMenu = vi.fn()
  const onHeaderOverlay = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[at]}>
        <AppHeader compact={false} onOpenMenu={onOpenMenu} onHeaderOverlay={onHeaderOverlay} {...props} />
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { onOpenMenu, onHeaderOverlay, props: seen.props as SiteHeaderProps }
}

beforeEach(() => {
  seen.props = null
  theme.resolvedTheme = "dark"
})
afterEach(() => cleanup())

describe("the app's header mount", () => {
  it("is the Nodaro app itself: in-app account pages, its own grant claim, the header's welcome dialog", () => {
    const { props } = mount()
    expect(props.sourceApp).toBe("app")
    expect(props.activeWorld).toBe("app")
    expect(props.accountPages).toBe("in-app")
    expect(props.claimSignupGrant).toBe(false)
    // The header's dialog owns the welcome offer and the consent ask (the
    // layout leaves the app's popup out): its once-per-account auto-open stays on.
    expect(props.welcomeOfferAutoOpen).toBeUndefined()
    expect(props.phoneBreakpoint).toBe(768)
  })

  it("links: the App tab and the account pages are this origin; the others come from the build", () => {
    const { props } = mount()
    expect(props.worldHrefs?.app).toBe(`${window.location.origin}/projects`)
    expect(props.urls).toEqual({
      app: window.location.origin,
      login: "/login",
      accessibility: `${window.location.origin}/accessibility`,
    })
  })

  it("accessibility is the header's: its menu on, its statement link the app's one statement", () => {
    const { props } = mount()
    expect("accessibilityMenu" in props).toBe(false)
    expect(props.accessibilityButton).toBe(true)
    expect(props.urls?.accessibility).toBe(`${window.location.origin}${ACCESSIBILITY_STATEMENT_PATH}`)
  })

  it("on a canvas page the corner button is off, as the app's own menu does there", () => {
    expect(mount({}, "/projects/p1/workflows/w1").props.accessibilityButton).toBe(false)
    cleanup()
    expect(mount({}, "/editor/w1").props.accessibilityButton).toBe(false)
  })

  it("says it is on the page while mounted, so the app's own menu steps aside", () => {
    const seenMounted: boolean[] = []
    function Probe() {
      seenMounted.push(useSharedHeaderMounted())
      return null
    }
    render(<Probe />)
    expect(seenMounted.at(-1)).toBe(false)
    mount()
    expect(seenMounted.at(-1)).toBe(true)
    cleanup()
    render(<Probe />)
    expect(seenMounted.at(-1)).toBe(false)
  })

  it("phone layout: compact on editor pages, full elsewhere", () => {
    expect(mount({ compact: true }).props.phoneLayout).toBe("compact")
    cleanup()
    expect(mount({ compact: false }).props.phoneLayout).toBe("full")
  })

  it("speaks the interface language: the header's own translator for the app's locale", () => {
    const { props } = mount()
    expect(translators).toHaveBeenCalledWith("he")
    expect(props.t?.("account.settings")).toBe("he:account.settings")
    expect(props.locale).toBe("he")
  })

  it("the language pill offers the app's languages and a pick goes through the app", () => {
    const { props } = mount()
    expect(props.language?.current).toBe("he")
    expect(props.language?.options).toEqual([
      { id: "en", nativeName: "English", shortCode: "EN", dir: "ltr" },
      { id: "he", nativeName: "עברית", shortCode: "HE", dir: "rtl" },
    ])
    props.language?.onChange("en")
    expect(pick).toHaveBeenCalledWith("en")
    // An id the app does not offer is ignored, never cast through.
    pick.mockClear()
    props.language?.onChange("xx-not-a-locale")
    expect(pick).not.toHaveBeenCalled()
  })

  it("the theme pill follows next-themes, and only once it knows the theme", () => {
    const { props } = mount()
    expect(props.theme?.value).toBe("dark")
    props.theme?.onToggle()
    expect(theme.setTheme).toHaveBeenCalledWith("light")
    cleanup()
    theme.resolvedTheme = undefined
    expect(mount().props.theme).toBeUndefined()
  })

  it("account pages and same-origin world links go through the router; sign-out lands on /login", () => {
    const { props } = mount()
    act(() => props.onAccountPage?.("/billing", "billing"))
    expect(path).toBe("/billing")
    act(() => props.onNavigate?.(`${window.location.origin}/projects?tab=explore`))
    expect(path).toBe("/projects?tab=explore")
    act(() => props.onSignOut?.())
    expect(path).toBe("/login")
  })

  it("the menu button opens the sidebar drawer; a header overlay closes it", () => {
    const { onOpenMenu, onHeaderOverlay, props } = mount()
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }))
    expect(onOpenMenu).toHaveBeenCalled()
    act(() => props.onOverlayChange?.("account"))
    expect(onHeaderOverlay).toHaveBeenCalled()
    onHeaderOverlay.mockClear()
    act(() => props.onOverlayChange?.(null))
    expect(onHeaderOverlay).not.toHaveBeenCalled()
  })
})
