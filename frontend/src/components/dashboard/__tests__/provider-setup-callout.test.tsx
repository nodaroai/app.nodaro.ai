import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

const edition = vi.hoisted(() => ({ cloud: false }))
vi.mock("@/lib/edition", () => ({ isCloud: () => edition.cloud }))

import { ProviderSetupCallout } from "../provider-setup-callout"

function mockStatus(providersOk: boolean) {
  // A fresh Response per call — a body can be consumed only once, and the
  // per-user test renders the component several times.
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ checks: { providers: { ok: providersOk, nodaroCloud: false } } }), { status: 200 }),
  )
}
const renderIt = (userId = "u1") =>
  render(
    <MemoryRouter>
      <ProviderSetupCallout userId={userId} />
    </MemoryRouter>,
  )

describe("ProviderSetupCallout (release check 8, #706)", () => {
  beforeEach(() => {
    edition.cloud = false
    window.localStorage.clear()
  })
  afterEach(() => vi.restoreAllMocks())

  it("shows the callout on a keyless, unconnected install with both levers", async () => {
    mockStatus(false)
    renderIt()
    await waitFor(() => expect(screen.getByTestId("provider-setup-callout")).toBeInTheDocument())
    expect(screen.getByText(/can.t generate yet/i)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Connect nodaro\.ai/i })).toHaveAttribute("href", "/setup")
    expect(screen.getByRole("link", { name: /Paste a key/i })).toHaveAttribute("href", "/integrations")
  })

  it("stays hidden when the install has a provider (key or connection)", async () => {
    mockStatus(true)
    renderIt()
    // let the fetch resolve
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId("provider-setup-callout")).not.toBeInTheDocument()
  })

  it("dismiss is remembered per user, and forgotten once a provider exists", async () => {
    mockStatus(false)
    const { unmount } = renderIt("u1")
    await waitFor(() => expect(screen.getByTestId("provider-setup-callout")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }))
    expect(screen.queryByTestId("provider-setup-callout")).not.toBeInTheDocument()
    expect(window.localStorage.getItem("nodaro:provider-callout-dismissed:u1")).toBe("1")
    unmount()

    // Same user, still keyless → stays dismissed.
    renderIt("u1")
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId("provider-setup-callout")).not.toBeInTheDocument()

    // Another user on the same browser sees it.
    const { unmount: unmount2 } = renderIt("u2")
    await waitFor(() => expect(screen.getByTestId("provider-setup-callout")).toBeInTheDocument())
    unmount2()

    // A provider appears → the dismissal is cleared, so a later keyless state
    // surfaces the callout again.
    vi.restoreAllMocks()
    mockStatus(true)
    renderIt("u1")
    await waitFor(() => expect(window.localStorage.getItem("nodaro:provider-callout-dismissed:u1")).toBeNull())
  })

  it("never renders on cloud — not even a fetch", () => {
    edition.cloud = true
    const spy = vi.spyOn(globalThis, "fetch")
    renderIt()
    expect(screen.queryByTestId("provider-setup-callout")).not.toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
  })
})
