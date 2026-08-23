import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"

const h = vi.hoisted(() => {
  // Declared inside the hoisted block: `vi.mock` factories run before the
  // module body, so a class declared at top level is not initialised yet.
  class FakeOrgApiError extends Error {
    code: string
    status: number
    constructor(code: string, message: string, status = 400) {
      super(message)
      this.code = code
      this.status = status
    }
  }
  return {
    FakeOrgApiError,
    previewInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
    hydrateWorkspaces: vi.fn(async () => {}),
    setActiveWorkspace: vi.fn(),
    navigate: vi.fn(),
    auth: { user: null as { id: string } | null, loading: false },
  }
})
const FakeOrgApiError = h.FakeOrgApiError

vi.mock("@/ee/lib/orgs-api", () => ({
  OrgApiError: h.FakeOrgApiError,
  previewInvitation: h.previewInvitation,
  acceptInvitation: h.acceptInvitation,
}))
vi.mock("@/lib/workspace-context", () => ({
  hydrateWorkspaces: h.hydrateWorkspaces,
  setActiveWorkspace: h.setActiveWorkspace,
}))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => h.auth }))
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>()
  return { ...actual, useNavigate: () => h.navigate }
})

import InvitationPage from "../invitation-page"

const PREVIEW = {
  orgName: "School A",
  kind: "school" as const,
  vocabulary: { workspace: "Class", workspace_member: "Student" },
  inviterName: "Ada Admin",
  workspaceName: "Class 1",
  email: "s***e@s***.test",
  expiresAt: "2026-09-01T00:00:00.000Z",
  state: "open" as const,
}

function renderPage(token = "tok-123") {
  return render(
    <MemoryRouter initialEntries={[`/join/${token}`]}>
      <Routes>
        <Route path="/join/:token" element={<InvitationPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  h.auth = { user: null, loading: false }
  h.previewInvitation.mockResolvedValue(PREVIEW)
  h.acceptInvitation.mockResolvedValue({ orgId: "o-1", workspaceId: "w-1" })
})
afterEach(() => vi.clearAllMocks())

/**
 * The page an invitee lands on. Everything here is about the signed-OUT
 * case: a person who followed a link from an email, on a device that may
 * never have seen this app. What they must learn before being asked for
 * anything is what they were invited to and which address it was sent to.
 */
describe("before signing in", () => {
  it("says who invited them, to what, and to which (masked) address", async () => {
    renderPage()
    expect(await screen.findByText(/Ada Admin invited you/)).toBeInTheDocument()
    expect(screen.getByText(/Class 1 at School A/)).toBeInTheDocument()
    expect(screen.getByText(/s\*\*\*e@s\*\*\*\.test/)).toBeInTheDocument()
    // The organization's own word for a workspace, not a hard-coded one.
    expect(screen.getByText(/a class/)).toBeInTheDocument()
  })

  it("offers sign-in and sign-up that RETURN here, token intact", async () => {
    renderPage("tok-abc")
    const signIn = await screen.findByRole("link", { name: /sign in to accept/i })
    expect(signIn).toHaveAttribute("href", "/login?redirect=%2Fjoin%2Ftok-abc")
    expect(screen.getByRole("link", { name: /create an account/i })).toHaveAttribute(
      "href",
      "/signup?redirect=%2Fjoin%2Ftok-abc",
    )
  })

  it("never offers to join before the session is known", async () => {
    h.auth = { user: null, loading: true }
    renderPage()
    expect(await screen.findByRole("button", { name: /checking your session/i })).toBeDisabled()
  })

  it("works without an inviter name", async () => {
    h.previewInvitation.mockResolvedValue({ ...PREVIEW, inviterName: null })
    renderPage()
    expect(await screen.findByText("You have been invited")).toBeInTheDocument()
  })
})

describe("an invitation that cannot be used", () => {
  it.each([
    ["expired", /has expired/i],
    ["revoked", /was withdrawn/i],
    ["accepted", /already been accepted/i],
  ])("%s says so, and says what to do about it", async (state, matcher) => {
    h.previewInvitation.mockResolvedValue({ ...PREVIEW, state })
    renderPage()
    expect(await screen.findByText(/cannot be used/i)).toBeInTheDocument()
    expect(screen.getByText(matcher)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /join/i })).not.toBeInTheDocument()
  })

  it("an unknown token does not imply the invitation ever existed", async () => {
    h.previewInvitation.mockRejectedValue(new FakeOrgApiError("invitation_not_found", "Invitation not found", 404))
    renderPage()
    expect(await screen.findByText(/not valid/i)).toBeInTheDocument()
  })

  it("a server that is merely down says to try again, not that the link is dead", async () => {
    h.previewInvitation.mockRejectedValue(new Error("network"))
    renderPage()
    expect(await screen.findByText(/could not load this invitation/i)).toBeInTheDocument()
  })
})

describe("accepting", () => {
  beforeEach(() => {
    h.auth = { user: { id: "u-1" }, loading: false }
  })

  it("joins, reloads the memberships, selects the workspace, and lands in it", async () => {
    renderPage("tok-1")
    await userEvent.click(await screen.findByRole("button", { name: /join class 1/i }))
    await waitFor(() => expect(h.acceptInvitation).toHaveBeenCalledWith("tok-1"))
    // The order matters: the switcher and every following request read the
    // memberships this just created.
    expect(h.hydrateWorkspaces).toHaveBeenCalled()
    expect(h.setActiveWorkspace).toHaveBeenCalledWith("w-1")
    expect(h.navigate).toHaveBeenCalledWith("/w/w-1", { replace: true })
  })

  it("an organization-level invitation lands at the dashboard, selecting nothing", async () => {
    h.acceptInvitation.mockResolvedValue({ orgId: "o-1", workspaceId: null })
    renderPage()
    await userEvent.click(await screen.findByRole("button", { name: /join/i }))
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith("/", { replace: true }))
    expect(h.setActiveWorkspace).not.toHaveBeenCalled()
  })

  it("an address mismatch names the address that WAS invited", async () => {
    h.acceptInvitation.mockRejectedValue(new FakeOrgApiError("email_mismatch", "no", 400))
    renderPage()
    await userEvent.click(await screen.findByRole("button", { name: /join/i }))
    expect(await screen.findByText(/sent to s\*\*\*e@s\*\*\*\.test/i)).toBeInTheDocument()
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it.each([
    ["invitation_expired", /has expired/i],
    ["invitation_revoked", /was withdrawn/i],
    ["org_not_active", /not active yet/i],
  ])("%s is explained rather than retried", async (code, matcher) => {
    h.acceptInvitation.mockRejectedValue(new FakeOrgApiError(code, "no", 400))
    renderPage()
    await userEvent.click(await screen.findByRole("button", { name: /join/i }))
    expect(await screen.findByText(matcher)).toBeInTheDocument()
  })

  it("a transient failure leaves the button usable", async () => {
    h.acceptInvitation.mockRejectedValue(new Error("boom"))
    renderPage()
    await userEvent.click(await screen.findByRole("button", { name: /join/i }))
    expect(await screen.findByText(/something went wrong joining/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /join/i })).toBeEnabled()
  })
})
