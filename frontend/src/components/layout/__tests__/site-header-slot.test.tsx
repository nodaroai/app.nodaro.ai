import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

/**
 * The core slot for the shared site header: it reaches a header module only on
 * a build with the flag on (read in this module, so a build without it never
 * emits the header's chunks), and only the one the page's mode asks for: the
 * hosted header on Nodaro's own deployments, the white-label mount on a
 * deployment of its own.
 */

const gate = { mode: "default" as "default" | "white-label" | null }
const loadedHosted = vi.fn()
const loadedWhiteLabel = vi.fn()
const failed = vi.fn()
vi.mock("@/lib/shared-header", () => ({ useSharedHeaderMode: () => gate.mode, markSharedHeaderFailed: () => failed() }))
// The header's accessibility stylesheet, which the mount waits for (resolved at once unless a test says otherwise).
const stylesheet = { link: vi.fn(() => Promise.resolve()) }
vi.mock("@/lib/accessibility-preferences", () => ({ linkSharedAccessibilityStylesheet: () => stylesheet.link() }))
vi.mock("@/ee/shell/hosted-header", () => {
  loadedHosted()
  return { default: ({ compact }: { compact: boolean }) => <div data-testid="hosted-header" data-compact={String(compact)} /> }
})
vi.mock("@/ee/shell/white-label-header", () => {
  loadedWhiteLabel()
  return { default: ({ compact }: { compact: boolean }) => <div data-testid="white-label-header" data-compact={String(compact)} /> }
})

async function slot(flag: string) {
  vi.resetModules()
  vi.stubEnv("VITE_SHARED_HEADER", flag)
  return (await import("../site-header-slot")).SiteHeaderSlot
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  loadedHosted.mockClear()
  loadedWhiteLabel.mockClear()
  failed.mockClear()
  stylesheet.link.mockReset()
  stylesheet.link.mockImplementation(() => Promise.resolve())
  gate.mode = "default"
})

const noop = () => {}

describe("SiteHeaderSlot", () => {
  it("Nodaro's own deployment: the hosted header, compact on editor pages", async () => {
    const SiteHeaderSlot = await slot("true")
    render(<SiteHeaderSlot compact onOpenMenu={noop} onHeaderOverlay={noop} drawerOpen={false} />)
    expect(await screen.findByTestId("hosted-header")).toHaveAttribute("data-compact", "true")
    expect(loadedWhiteLabel).not.toHaveBeenCalled()
  })

  it("a white-label deployment: the white-label mount, never the hosted header", async () => {
    gate.mode = "white-label"
    const SiteHeaderSlot = await slot("true")
    render(<SiteHeaderSlot compact={false} onOpenMenu={noop} onHeaderOverlay={noop} drawerOpen={false} />)
    expect(await screen.findByTestId("white-label-header")).toHaveAttribute("data-compact", "false")
    expect(loadedHosted).not.toHaveBeenCalled()
  })

  it("the image for deployments of their own (flag \"white-label\") reaches the white-label mount, and never holds the hosted one", async () => {
    gate.mode = "white-label"
    const SiteHeaderSlot = await slot("white-label")
    render(<SiteHeaderSlot compact={false} onOpenMenu={noop} onHeaderOverlay={noop} drawerOpen={false} />)
    expect(await screen.findByTestId("white-label-header")).toBeInTheDocument()
    // Nodaro's header cannot show on that image, so its chunk is not in it.
    gate.mode = "default"
    const SameImage = await slot("white-label")
    const { container } = render(<SameImage compact={false} onOpenMenu={noop} onHeaderOverlay={noop} drawerOpen={false} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container).toBeEmptyDOMElement()
    expect(loadedHosted).not.toHaveBeenCalled()
  })

  it("flag on but the gate closed (embedded, a tenant without the key, a failed header…): nothing, and no module is loaded", async () => {
    gate.mode = null
    const SiteHeaderSlot = await slot("true")
    const { container } = render(<SiteHeaderSlot compact={false} onOpenMenu={noop} onHeaderOverlay={noop} drawerOpen={false} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container).toBeEmptyDOMElement()
    expect(loadedHosted).not.toHaveBeenCalled()
    expect(loadedWhiteLabel).not.toHaveBeenCalled()
  })

  it("flag off (every community and business build): nothing, no module, and no loader script, whatever the gate says", async () => {
    const SiteHeaderSlot = await slot("")
    const { container } = render(<SiteHeaderSlot compact={false} onOpenMenu={noop} onHeaderOverlay={noop} drawerOpen={false} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container).toBeEmptyDOMElement()
    expect(loadedHosted).not.toHaveBeenCalled()
    expect(loadedWhiteLabel).not.toHaveBeenCalled()
    expect(document.head.querySelector('script[src*="/_header/"]')).toBeNull()
  })

  it("the header mounts only once its accessibility stylesheet applies (it draws its menu only then)", async () => {
    let applied: () => void = () => {}
    stylesheet.link.mockImplementation(() => new Promise<void>((resolve) => (applied = resolve)))
    const SiteHeaderSlot = await slot("true")
    render(<SiteHeaderSlot compact={false} onOpenMenu={noop} onHeaderOverlay={noop} drawerOpen={false} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByTestId("hosted-header")).toBeNull()
    applied()
    expect(await screen.findByTestId("hosted-header")).toBeInTheDocument()
  })

  it("a stylesheet that cannot load fails the header: the page keeps its own chrome and menu", async () => {
    stylesheet.link.mockImplementation(() => Promise.reject(new Error("offline")))
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const SiteHeaderSlot = await slot("true")
    const { container } = render(<SiteHeaderSlot compact={false} onOpenMenu={noop} onHeaderOverlay={noop} drawerOpen={false} />)
    await vi.waitFor(() => expect(failed).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    errors.mockRestore()
  })
})
