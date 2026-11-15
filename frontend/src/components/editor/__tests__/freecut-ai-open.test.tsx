import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"

const slot = vi.hoisted(() => ({ onLayout: null as ((wide: boolean) => void) | null }))

vi.mock("@/lib/edition", async (orig) => ({ ...(await orig<typeof import("@/lib/edition")>()), hasCredits: () => true }))
// The panel itself is tested on its own; here it is a stand-in that can ask for the wide layout.
vi.mock("../freecut-ai-slot", async (orig) => ({
  ...(await orig<typeof import("../freecut-ai-slot")>()),
  FreeCutAiSlot: (props: { onLayout?: (wide: boolean) => void }) => {
    slot.onLayout = props.onLayout ?? null
    return <div data-testid="ai-panel" />
  },
}))

import { FreeCutEditorModal } from "../freecut-editor-modal"

const EDITOR = "https://freecut.example.internal"
const VIDEO = "https://cdn.example.internal/videos/x.mp4"
const ABLE = ["edit-ops", "timeline-read", "playback", "presence"]

function wideWindow(wide: boolean) {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: wide && query.includes("min-width"), media: query, addEventListener() {}, removeEventListener() {} })))
}

function openEditor() {
  render(<FreeCutEditorModal videoUrl={VIDEO} onExportComplete={async () => {}} onClose={() => {}} />)
  const frame = document.querySelector("iframe") as HTMLIFrameElement
  Object.defineProperty(frame.contentWindow, "postMessage", { value: vi.fn(), configurable: true })
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: "FREECUT_READY", capabilities: ABLE }, origin: EDITOR, source: frame.contentWindow }))
  })
}

/**
 * Edit with AI is open from the start, wherever the window has room beside the
 * editor: closing it is the exception. On a narrow window it waits for its
 * button, so it never covers the editor there.
 */
describe("Edit with AI beside the editor", () => {
  beforeEach(() => {
    window.__NODARO_RUNTIME__ = { freecutUrl: EDITOR }
    vi.stubGlobal("fetch", vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })))
    slot.onLayout = null
  })

  afterEach(() => {
    delete window.__NODARO_RUNTIME__
    vi.unstubAllGlobals()
  })

  it("is open as soon as the editor says it can be edited, on a wide window", () => {
    wideWindow(true)
    openEditor()
    const panel = screen.getByTestId("ai-panel")
    expect(panel.parentElement?.className).toContain("flex")
    expect(panel.parentElement?.className).not.toContain("hidden")
    expect(screen.getByRole("button", { name: "Edit with AI" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("waits for its button on a narrow window", () => {
    wideWindow(false)
    openEditor()
    expect(screen.queryByTestId("ai-panel")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Edit with AI" }))
    expect(screen.getByTestId("ai-panel")).toBeTruthy()
  })

  it("covers the editor while it shows the original, and gives the editor back", () => {
    wideWindow(true)
    openEditor()
    const box = () => screen.getByTestId("ai-panel").parentElement!
    act(() => slot.onLayout?.(true))
    expect(box().className).toContain("absolute")
    expect(box().className).toContain("inset-0")
    act(() => slot.onLayout?.(false))
    expect(box().className).not.toContain("absolute")
  })
})

/**
 * Edit with AI needs the editor: it is offered only once the editor's own
 * handshake says it can be edited from here. With the editor switched off
 * there is no frame, so no handshake, and it is never offered.
 */
describe("Edit with AI with the editor switched off", () => {
  afterEach(() => {
    delete window.__NODARO_RUNTIME__
    vi.unstubAllGlobals()
  })

  it("is not offered, and no panel opens, even on a wide window", () => {
    window.__NODARO_RUNTIME__ = { freecutUrl: "off" }
    wideWindow(true)
    render(<FreeCutEditorModal videoUrl={VIDEO} onExportComplete={async () => {}} onClose={() => {}} />)
    expect(document.querySelector("iframe")).toBeNull()
    expect(screen.queryByRole("button", { name: "Edit with AI" })).toBeNull()
    expect(screen.queryByTestId("ai-panel")).toBeNull()
  })
})
