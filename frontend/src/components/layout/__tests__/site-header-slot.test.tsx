import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

/**
 * The core slot for the shared site header: it reaches the ee mount only on a
 * build with the flag on (read in this module, so a build without it never
 * emits the header's chunk) and only on a page where `sharedHeaderActive()`.
 */

const gate = { on: true }
const loaded = vi.fn()
const failed = vi.fn()
vi.mock("@/lib/shared-header", () => ({ sharedHeaderActive: () => gate.on, useSharedHeaderActive: () => gate.on, markSharedHeaderFailed: () => failed() }))
// The header's accessibility stylesheet, which the mount waits for (resolved at once unless a test says otherwise).
const stylesheet = { link: vi.fn(() => Promise.resolve()) }
vi.mock("@/lib/accessibility-preferences", () => ({ linkSharedAccessibilityStylesheet: () => stylesheet.link() }))
vi.mock("@/ee/shell/app-header", () => {
  loaded()
  return { default: ({ compact }: { compact: boolean }) => <div data-testid="app-header" data-compact={String(compact)} /> }
})

async function slot(flag: string) {
  vi.resetModules()
  vi.stubEnv("VITE_SHARED_HEADER", flag)
  return (await import("../site-header-slot")).SiteHeaderSlot
}

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  loaded.mockClear()
  failed.mockClear()
  stylesheet.link.mockReset()
  stylesheet.link.mockImplementation(() => Promise.resolve())
  gate.on = true
})

const noop = () => {}

describe("SiteHeaderSlot", () => {
  it("flag on and the gate open: the header, compact on editor pages", async () => {
    const SiteHeaderSlot = await slot("true")
    render(<SiteHeaderSlot compact onOpenMenu={noop} onHeaderOverlay={noop} />)
    expect(await screen.findByTestId("app-header")).toHaveAttribute("data-compact", "true")
  })

  it("flag on but the gate closed (embedded, white-label, prepaid…): nothing, and the mount is never loaded", async () => {
    gate.on = false
    const SiteHeaderSlot = await slot("true")
    const { container } = render(<SiteHeaderSlot compact={false} onOpenMenu={noop} onHeaderOverlay={noop} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container).toBeEmptyDOMElement()
    expect(loaded).not.toHaveBeenCalled()
  })

  it("flag off: nothing, and the mount is never loaded, whatever the gate says", async () => {
    const SiteHeaderSlot = await slot("")
    const { container } = render(<SiteHeaderSlot compact={false} onOpenMenu={noop} onHeaderOverlay={noop} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(container).toBeEmptyDOMElement()
    expect(loaded).not.toHaveBeenCalled()
  })

  it("the image for deployments of their own (flag \"white-label\") reaches the mount too", async () => {
    const SiteHeaderSlot = await slot("white-label")
    render(<SiteHeaderSlot compact={false} onOpenMenu={noop} onHeaderOverlay={noop} />)
    expect(await screen.findByTestId("app-header")).toBeInTheDocument()
  })

  it("the header mounts only once its accessibility stylesheet applies (it draws its menu only then)", async () => {
    let applied: () => void = () => {}
    stylesheet.link.mockImplementation(() => new Promise<void>((resolve) => (applied = resolve)))
    const SiteHeaderSlot = await slot("true")
    render(<SiteHeaderSlot compact={false} onOpenMenu={noop} onHeaderOverlay={noop} />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(screen.queryByTestId("app-header")).toBeNull()
    applied()
    expect(await screen.findByTestId("app-header")).toBeInTheDocument()
  })

  it("a stylesheet that cannot load fails the header: the page keeps its own chrome and menu", async () => {
    stylesheet.link.mockImplementation(() => Promise.reject(new Error("offline")))
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const SiteHeaderSlot = await slot("true")
    const { container } = render(<SiteHeaderSlot compact={false} onOpenMenu={noop} onHeaderOverlay={noop} />)
    await vi.waitFor(() => expect(failed).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    errors.mockRestore()
  })
})
