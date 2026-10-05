import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth }),
}))

import { AccessBlockedScreen } from "../access-blocked-screen"
import { dispatchAccessBlocked } from "@/lib/access-blocked-event"

describe("AccessBlockedScreen", () => {
  const originalLocation = window.location
  const assign = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    auth.signOut.mockResolvedValue({ error: null })
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, assign },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation })
  })

  it("renders nothing until a request is refused", () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } })
    render(<AccessBlockedScreen />)
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("covers the app when a signed-in session is refused", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } })
    render(<AccessBlockedScreen />)
    act(() => dispatchAccessBlocked())
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument()
    expect(screen.getByText("Access blocked")).toBeInTheDocument()
    expect(
      screen.getByText("Access to Nodaro has been blocked. If you think this is a mistake, contact support."),
    ).toBeInTheDocument()
  })

  it("stays hidden without a session (the login page never shows it)", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } })
    render(<AccessBlockedScreen />)
    act(() => dispatchAccessBlocked())
    await waitFor(() => expect(auth.getSession).toHaveBeenCalled())
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("signs out and goes to the login page", async () => {
    const user = userEvent.setup()
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } })
    render(<AccessBlockedScreen />)
    act(() => dispatchAccessBlocked())
    await screen.findByRole("alertdialog")
    await user.click(screen.getByRole("button"))
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1))
    expect(assign).toHaveBeenCalledWith("/login")
  })

  it("still leaves for the login page when signing out fails", async () => {
    const user = userEvent.setup()
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "t" } } })
    auth.signOut.mockRejectedValue(new Error("network down"))
    render(<AccessBlockedScreen />)
    act(() => dispatchAccessBlocked())
    await screen.findByRole("alertdialog")
    await user.click(screen.getByRole("button"))
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login"))
  })
})
