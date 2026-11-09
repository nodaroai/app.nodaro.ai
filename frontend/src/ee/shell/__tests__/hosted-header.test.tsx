import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { MemoryRouter, useLocation } from "react-router-dom"
import { useSharedHeaderMounted } from "@/lib/shared-header"

/**
 * The app's mount of the hosted Nodaro header: the one `<nodaro-header page>`
 * element, the loader, and the few listeners a page keeps beside it. The
 * package is cloud-only, so the module the build resolves is a stand-in here,
 * with the contract's own names.
 */

const LOADER_URL = "https://nodaro.ai/_header/v1/loader.js"
const hosted = vi.hoisted(() => ({
  navigate: null as null | ((path: string) => void),
  fail: null as null | ((reason: string) => void),
  closeOverlays: vi.fn(),
}))

vi.mock("virtual:hosted-header", () => ({
  hostedHeaderAvailable: true,
  LOADER_URL: "https://nodaro.ai/_header/v1/loader.js",
  HEADER_TAG: "nodaro-header",
  HEADER_EVENTS: {
    navigate: "nodaro-header:navigate",
    language: "nodaro-header:language",
    signedOut: "nodaro-header:signed-out",
    overlay: "nodaro-header:overlay",
    ready: "nodaro-header:ready",
    failed: "nodaro-header:failed",
  },
  HeaderFallback: () => <div data-testid="frozen-fallback" />,
  useHeaderNavigation: (navigate: (path: string) => void) => {
    hosted.navigate = navigate
  },
  onHeaderFailure: (onFailure: (reason: string) => void) => {
    hosted.fail = onFailure
    return () => {
      hosted.fail = null
    }
  },
  closeHeaderOverlays: () => hosted.closeOverlays(),
}))

const failed = vi.hoisted(() => vi.fn())
vi.mock("@/lib/shared-header", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/shared-header")>()),
  markSharedHeaderFailed: () => failed(),
}))

const pick = vi.fn()
vi.mock("@/hooks/use-ui-language", () => ({
  useUiLanguage: () => ({
    locale: "he",
    rows: [
      { id: "en", nativeName: "English", englishName: "English", shortCode: "EN", dir: "ltr" },
      { id: "he", nativeName: "עברית", englishName: "Hebrew", shortCode: "HE", dir: "rtl" },
      { id: "pt-BR", nativeName: "Português (Brasil)", englishName: "Portuguese (Brazil)", shortCode: "PT", dir: "ltr" },
    ],
    pick,
  }),
}))

const { default: HostedHeader } = await import("../hosted-header")

let path = ""
function Where() {
  const location = useLocation()
  path = `${location.pathname}${location.search}`
  return null
}

const noop = () => {}

function mount(props: Partial<Parameters<typeof HostedHeader>[0]> = {}) {
  const onHeaderOverlay = vi.fn()
  const view = render(
    <MemoryRouter initialEntries={["/projects"]}>
      <HostedHeader compact={false} onOpenMenu={noop} onHeaderOverlay={onHeaderOverlay} drawerOpen={false} {...props} />
      <Where />
    </MemoryRouter>,
  )
  return { ...view, onHeaderOverlay }
}

const element = () => document.querySelector("nodaro-header") as HTMLElement

function cancelable(name: string, detail?: unknown) {
  return new CustomEvent(name, { detail, cancelable: true, bubbles: true, composed: true })
}

beforeEach(() => {
  hosted.navigate = null
  hosted.fail = null
  hosted.closeOverlays.mockClear()
  failed.mockClear()
  pick.mockClear()
})

afterEach(() => {
  cleanup()
  for (const node of document.head.querySelectorAll('script[src*="/_header/"], link[rel="preconnect"]')) node.remove()
  document.documentElement.removeAttribute("data-nodaro-header")
})

describe("the app's hosted header", () => {
  it("is exactly one element with its page and nothing else, holding only the frozen fallback", () => {
    mount()
    expect(document.querySelectorAll("nodaro-header")).toHaveLength(1)
    const header = element()
    expect(header.getAttributeNames()).toEqual(["page"])
    expect(header.getAttribute("page")).toBe("flow")
    expect(Array.from(header.children).map((child) => child.getAttribute("data-testid"))).toEqual(["frozen-fallback"])
  })

  it("says the editor's page on editor routes, on the same element", () => {
    const view = mount({ compact: true })
    expect(element().getAttribute("page")).toBe("flow-canvas")
    const same = element()
    view.rerender(
      <MemoryRouter initialEntries={["/projects"]}>
        <HostedHeader compact={false} onOpenMenu={noop} onHeaderOverlay={noop} drawerOpen={false} />
        <Where />
      </MemoryRouter>,
    )
    expect(element()).toBe(same)
    expect(element().getAttribute("page")).toBe("flow")
  })

  it("adds the loader once, as an async module script, with a preconnect to its origin", () => {
    const view = mount()
    view.unmount()
    mount()
    const scripts = document.head.querySelectorAll<HTMLScriptElement>(`script[src="${LOADER_URL}"]`)
    expect(scripts).toHaveLength(1)
    expect(scripts[0]?.type).toBe("module")
    expect(scripts[0]?.async).toBe(true)
    const preconnects = document.head.querySelectorAll<HTMLLinkElement>('link[rel="preconnect"][href="https://nodaro.ai"]')
    expect(preconnects).toHaveLength(1)
  })

  it("when the header cannot draw, the page gets its own chrome back", () => {
    mount()
    act(() => hosted.fail?.("undefined"))
    expect(failed).toHaveBeenCalledTimes(1)
  })

  it("a header link to one of the app's own routes goes through the router", () => {
    mount()
    act(() => hosted.navigate?.("/projects?tab=explore"))
    expect(path).toBe("/projects?tab=explore")
  })

  it("a header overlay opening closes the app's drawer; one closing leaves it alone", () => {
    const { onHeaderOverlay } = mount()
    act(() => {
      window.dispatchEvent(new CustomEvent("nodaro-header:overlay", { detail: { open: "account" } }))
    })
    expect(onHeaderOverlay).toHaveBeenCalledTimes(1)
    onHeaderOverlay.mockClear()
    act(() => {
      window.dispatchEvent(new CustomEvent("nodaro-header:overlay", { detail: { open: null } }))
    })
    expect(onHeaderOverlay).not.toHaveBeenCalled()
  })

  it("opening the app's drawer closes the header's overlays, so the two never stack", () => {
    const view = mount({ drawerOpen: false })
    expect(hosted.closeOverlays).not.toHaveBeenCalled()
    view.rerender(
      <MemoryRouter initialEntries={["/projects"]}>
        <HostedHeader compact={false} onOpenMenu={noop} onHeaderOverlay={noop} drawerOpen />
        <Where />
      </MemoryRouter>,
    )
    expect(hosted.closeOverlays).toHaveBeenCalledTimes(1)
  })

  it("a language the app offers is switched in place: the header's reload is cancelled", () => {
    mount()
    const event = cancelable("nodaro-header:language", { id: "pt-BR" })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(pick).toHaveBeenCalledWith("pt-BR")
  })

  it("a language the app does not offer is left to the header (it saved the cookie and reloads)", () => {
    mount()
    const event = cancelable("nodaro-header:language", { id: "xx-not-a-locale" })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(false)
    expect(pick).not.toHaveBeenCalled()
  })

  it("signing out in the header lands on /login, not a reload that would send the next sign-in back here", () => {
    mount()
    const event = cancelable("nodaro-header:signed-out")
    act(() => {
      window.dispatchEvent(event)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(path).toBe("/login")
  })

  it("says it is on the page only once it has drawn (the app's accessibility menu steps aside then)", () => {
    const seen: boolean[] = []
    function Probe() {
      seen.push(useSharedHeaderMounted())
      return null
    }
    render(<Probe />)
    const view = mount()
    expect(seen.at(-1)).toBe(false)
    act(() => {
      element().dispatchEvent(new CustomEvent("nodaro-header:ready", { detail: { version: "1.0.0" }, bubbles: true, composed: true }))
    })
    expect(seen.at(-1)).toBe(true)
    view.unmount()
    expect(seen.at(-1)).toBe(false)
  })

  it("a failed header never says it is on the page", () => {
    const seen: boolean[] = []
    function Probe() {
      seen.push(useSharedHeaderMounted())
      return null
    }
    render(<Probe />)
    mount()
    act(() => hosted.fail?.("load: 404"))
    expect(seen.at(-1)).toBe(false)
  })
})
