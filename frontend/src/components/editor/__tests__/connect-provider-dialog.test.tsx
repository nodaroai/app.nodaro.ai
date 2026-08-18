import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

vi.mock("@/lib/api", () => ({ getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })) }))

import { ConnectProviderDialog } from "../connect-provider-dialog"

/**
 * Mounts the REAL dialog. The watcher's suite mocks this component to test the
 * decision logic, which meant the JSX itself had never rendered anywhere —
 * Radix's DialogTitle requirement, the router-dependent Link and any runtime
 * crash were all invisible to that suite (#771 review).
 */
function renderDialog(props: Partial<Parameters<typeof ConnectProviderDialog>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ConnectProviderDialog open nodeLabel="Generate Video" onOpenChange={() => {}} {...props} />
    </MemoryRouter>,
  )
}

describe("ConnectProviderDialog renders", () => {
  let originalLocation: PropertyDescriptor | null = null

  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    vi.restoreAllMocks()
    if (originalLocation) {
      Object.defineProperty(window, "location", originalLocation)
      originalLocation = null
    }
  })

  it("mounts with an accessible dialog name", () => {
    renderDialog()
    // Radix exposes role="dialog"; the accessible name comes from DialogTitle.
    // A raw <h2> would leave this unnamed and make Radix log an error.
    expect(screen.getByRole("dialog", { name: /connect a provider to generate/i })).toBeTruthy()
  })

  it("does not trip Radix's missing-title console error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    renderDialog()
    const complaints = spy.mock.calls.map((c) => String(c[0])).filter((m) => /DialogTitle|aria-describedby/i.test(m))
    expect(complaints).toEqual([])
  })

  it("names the node that stopped and reassures about the run", () => {
    renderDialog({ nodeLabel: "Suno Generate" })
    expect(screen.getByText(/run stopped/i).textContent).toContain("Suno Generate")
    expect(screen.getByText(/nothing was consumed/i)).toBeTruthy()
  })

  it("reports what else stopped without claiming a connection repairs it", () => {
    renderDialog({ alsoBlockedCount: 2 })
    expect(screen.getByText(/2 other nodes in this run also stopped/i)).toBeTruthy()
  })

  it("says nothing about other nodes when this is the only one", () => {
    renderDialog({ alsoBlockedCount: 0 })
    expect(screen.queryByText(/other node/i)).toBeNull()
  })

  it("renders the integrations link inside the router", () => {
    renderDialog()
    expect(screen.getByRole("link", { name: /all integrations/i }).getAttribute("href")).toBe("/integrations")
  })

  // Retry re-runs the node. Offering it before a provider exists would send the
  // run straight back into the same wall, so it appears only once a key has
  // actually been saved (Connect navigates away, so that is the only in-dialog
  // path to a configured install).
  it("withholds Retry until a provider has been configured", () => {
    renderDialog({ onRetry: vi.fn() })
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull()
  })

  it("a saved key opens the 4b routing-choice dialog, and Retry is reachable once it closes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ set: true }), { status: 200 }))
    const onRetry = vi.fn()
    renderDialog({ onRetry })

    fireEvent.change(screen.getByPlaceholderText("NODARO_API_KEY"), { target: { value: "ndr_live_key" } })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))

    // The paste is a fresh connection — the routing-choice dialog follows it
    // on every paste surface ("dialog on both lanes"), layered over this one.
    const scopeTitle = await screen.findByText(/how should nodaro\.ai be used/i)
    expect(scopeTitle).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))

    const retry = await screen.findByRole("button", { name: /retry/i })
    fireEvent.click(retry)
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("never offers Retry when the editor registered no runner", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ set: true }), { status: 200 }))
    renderDialog()
    fireEvent.change(screen.getByPlaceholderText("NODARO_API_KEY"), { target: { value: "ndr_live_key" } })
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(screen.queryByRole("button", { name: /retry/i })).toBeNull()
  })
  it("keeps the pasted key out of the DOM as readable text", () => {
    renderDialog()
    const input = screen.getByPlaceholderText("NODARO_API_KEY") as HTMLInputElement
    fireEvent.change(input, { target: { value: "secret-value" } })
    expect(input.type).toBe("password")
    expect(document.body.textContent).not.toContain("secret-value")
  })

  it("remembers where to return to before sending the browser to the consent screen", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ authorizeUrl: "https://app.nodaro.ai/consent" }), { status: 200 }),
    )
    // jsdom does not implement navigation, so href has to be stubbed. It is
    // restored in afterEach — replacing window.location without putting it back
    // leaked into unrelated suites that share this environment.
    const hrefs: string[] = []
    originalLocation = Object.getOwnPropertyDescriptor(window, "location") ?? null
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, get href() { return "" }, set href(v: string) { hrefs.push(v) } },
    })

    renderDialog()
    fireEvent.click(screen.getByRole("button", { name: /^connect$/i }))

    await waitFor(() => expect(window.localStorage.getItem("nodaro_connect_from")).toBe("editor"))
    expect(window.localStorage.getItem("nodaro_connect_return")).toBeTruthy()
  })
})
