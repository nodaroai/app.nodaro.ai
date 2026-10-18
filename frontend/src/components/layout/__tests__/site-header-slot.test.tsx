import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

/**
 * The core slot for the shared site header: it reaches the ee mount only on a
 * build with the flag on (read in this module, so a build without it never
 * emits the header's chunk) and only on a page where `sharedHeaderActive()`.
 */

const gate = { on: true }
const loaded = vi.fn()
vi.mock("@/lib/shared-header", () => ({ sharedHeaderActive: () => gate.on, useSharedHeaderActive: () => gate.on, markSharedHeaderFailed: () => {} }))
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
})
