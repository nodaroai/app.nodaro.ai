/**
 * The OAuth landing on the integrations card (#771 rework + 4b):
 *   - a connect that started from the EDITOR holds its return path until the
 *     routing-choice dialog closes — the dialog is never skipped ("dialog on
 *     both lanes"), and the interrupted run is one navigation away after it;
 *   - the guided-setup origin still bounces straight to /setup (its page owns
 *     the dialog there);
 *   - regression: the card actually RENDERS the scope dialog. #780 set the
 *     open state but never mounted the component, so the integrations-origin
 *     lane silently skipped the choice.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"

vi.mock("@/lib/api", () => ({ getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })) }))
vi.mock("@/lib/edition", () => ({ isCloud: () => false, hasCredits: () => false }))
vi.mock("@/hooks/use-nodaro-connection", () => ({ invalidateNodaroConnectionCache: vi.fn() }))

import { NodaroCloudCard } from "../nodaro-cloud-card"

let originalLocation: PropertyDescriptor | null = null
const replaced: string[] = []

beforeEach(() => {
  replaced.length = 0
  localStorage.clear()
  window.history.replaceState(null, "", "/integrations?nodaro=connected")
  originalLocation = Object.getOwnPropertyDescriptor(window, "location") ?? null
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      pathname: "/integrations",
      search: "?nodaro=connected",
      replace: (url: string) => replaced.push(url),
    },
  })
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ connected: true, source: "oauth", balance: null, prefs: null }), { status: 200 }),
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalLocation) Object.defineProperty(window, "location", originalLocation)
})

describe("NodaroCloudCard — OAuth landing", () => {
  it("editor origin: shows the routing-choice dialog FIRST, then returns to the held workflow path on close", async () => {
    localStorage.setItem("nodaro_connect_from", "editor")
    localStorage.setItem("nodaro_connect_return", "/p/proj-1/w/wf-9")
    render(<NodaroCloudCard />)

    // The choice is never skipped — the dialog mounts here, on this card.
    const title = await screen.findByText(/how should nodaro\.ai be used/i)
    expect(title).toBeTruthy()
    expect(replaced).toEqual([])

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))
    await waitFor(() => expect(replaced).toEqual(["/p/proj-1/w/wf-9"]))
    // Both markers were consumed — nothing lingers for the next landing.
    expect(localStorage.getItem("nodaro_connect_from")).toBeNull()
    expect(localStorage.getItem("nodaro_connect_return")).toBeNull()
  })

  it("editor origin with an unsafe stored path: the dialog still shows, and NO navigation happens", async () => {
    localStorage.setItem("nodaro_connect_from", "editor")
    localStorage.setItem("nodaro_connect_return", "https://evil.example/phish")
    render(<NodaroCloudCard />)

    await screen.findByText(/how should nodaro\.ai be used/i)
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }))
    await waitFor(() => expect(screen.queryByText(/how should nodaro\.ai be used/i)).toBeNull())
    expect(replaced).toEqual([])
  })

  it("guided-setup origin: bounces straight to /setup, whose page owns the dialog", async () => {
    localStorage.setItem("nodaro_connect_from", "setup")
    render(<NodaroCloudCard />)
    await waitFor(() => expect(replaced).toEqual(["/setup?nodaro=connected"]))
    expect(screen.queryByText(/how should nodaro\.ai be used/i)).toBeNull()
  })
})
