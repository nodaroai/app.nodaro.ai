import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => {
  class FakeOrgApiError extends Error {
    code: string
    status: number
    constructor(code: string, message: string, status = 403) {
      super(message)
      this.code = code
      this.status = status
    }
  }
  return {
    FakeOrgApiError,
    listOrgMembers: vi.fn(),
    listInvitations: vi.fn(),
    listOrgWorkspaces: vi.fn(),
    updateOrgMember: vi.fn(),
    removeOrgMember: vi.fn(),
    revokeInvitation: vi.fn(),
    resendInvitation: vi.fn(),
    workspaceState: {
      status: "ready" as string,
      organizations: [] as unknown[],
      workspaces: [] as unknown[],
      activeWorkspaceId: null as string | null,
    },
  }
})
const FakeOrgApiError = h.FakeOrgApiError

vi.mock("@/ee/lib/orgs-api", () => ({
  OrgApiError: h.FakeOrgApiError,
  listOrgMembers: h.listOrgMembers,
  listInvitations: h.listInvitations,
  listOrgWorkspaces: h.listOrgWorkspaces,
  updateOrgMember: h.updateOrgMember,
  removeOrgMember: h.removeOrgMember,
  revokeInvitation: h.revokeInvitation,
  resendInvitation: h.resendInvitation,
}))
vi.mock("@/ee/hooks/use-workspace", () => ({ useWorkspace: () => h.workspaceState }))
vi.mock("@/ee/components/org/invite-members-dialog", () => ({
  InviteMembersDialog: ({ open }: { open: boolean }) => (open ? <div>invite dialog</div> : null),
}))

import OrgMembersPage from "../org-members-page"

const SCHOOL = {
  id: "org-1",
  slug: "school-a",
  name: "School A",
  kind: "school" as const,
  status: "active" as const,
  role: "admin" as const,
  memberStatus: "active" as const,
  settings: { personal_space_enabled: true, allowed_email_domains: [], vocabulary_overrides: {} },
  vocabulary: { org_owner: "Owner", org_admin: "Administrator", workspace_member: "Student" },
}

const OWNER = { userId: "u-1", role: "owner" as const, status: "active" as const, joinedAt: "", email: "owner@t.test", displayName: "Olive Owner", avatarUrl: null }
const MEMBER = { userId: "u-2", role: "member" as const, status: "active" as const, joinedAt: "", email: "mia@t.test", displayName: "Mia Member", avatarUrl: null }
const SUSPENDED = { ...MEMBER, userId: "u-3", displayName: "Sam Suspended", email: "sam@t.test", status: "suspended" as const }
const INVITATION = {
  id: "inv-1",
  orgId: "org-1",
  workspaceId: null,
  email: "new@t.test",
  orgRole: "member" as const,
  workspaceRole: null,
  invitedBy: "u-1",
  state: "open" as const,
  expiresAt: "2026-09-01T00:00:00.000Z",
  acceptedAt: null,
  revokedAt: null,
  createdAt: "",
}

function renderPage(slug = "school-a") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/org/${slug}/members`]}>
        <Routes>
          <Route path="/org/:slug/members" element={<OrgMembersPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function withMembership(overrides: Record<string, unknown> = {}) {
  h.workspaceState = { ...h.workspaceState, status: "ready", organizations: [{ ...SCHOOL, ...overrides }] }
}

beforeEach(() => {
  h.workspaceState = { status: "ready", organizations: [SCHOOL], workspaces: [], activeWorkspaceId: null }
  h.listOrgMembers.mockResolvedValue({ data: [OWNER, MEMBER, SUSPENDED], nextCursor: null })
  h.listInvitations.mockResolvedValue({ data: [INVITATION], nextCursor: null })
  h.listOrgWorkspaces.mockResolvedValue([])
  h.updateOrgMember.mockResolvedValue(MEMBER)
  h.removeOrgMember.mockResolvedValue({ removed: true })
  h.revokeInvitation.mockResolvedValue({ id: "inv-1", revoked: true })
  h.resendInvitation.mockResolvedValue({ id: "inv-1", email: "new@t.test", status: "sent" })
})
afterEach(() => vi.clearAllMocks())

describe("who may open it", () => {
  it("an owner or admin can", async () => {
    renderPage()
    expect(await screen.findByText("Mia Member")).toBeInTheDocument()
  })

  it("a plain member is told why, not shown an error", async () => {
    withMembership({ role: "member" })
    renderPage()
    expect(await screen.findByText("Not available to you")).toBeInTheDocument()
    expect(screen.getByText(/only an owner or an administrator/i)).toBeInTheDocument()
    expect(h.listOrgMembers).not.toHaveBeenCalled()
  })

  it("an unknown organization is not asked about", async () => {
    renderPage("someone-else")
    expect(await screen.findByText("Organization not found")).toBeInTheDocument()
    expect(h.listOrgMembers).not.toHaveBeenCalled()
  })

  it("does not confuse 'not loaded yet' with 'not yours'", () => {
    h.workspaceState = { ...h.workspaceState, status: "loading", organizations: [] }
    renderPage()
    expect(screen.getByText("Loading…")).toBeInTheDocument()
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument()
  })
})

/**
 * A pending invitation is not a member. A roster that mixes them makes both
 * questions harder: "did I invite her?" and "is she in?"
 */
describe("the two tabs", () => {
  it("separates members from people who were only asked", async () => {
    renderPage()
    expect(await screen.findByText("Mia Member")).toBeInTheDocument()
    expect(screen.queryByText("new@t.test")).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("tab", { name: /invited/i }))
    expect(await screen.findByText("new@t.test")).toBeInTheDocument()
  })

  it("asks only for OPEN invitations — an accepted one is a member, not a pending ask", async () => {
    renderPage()
    await screen.findByText("Mia Member")
    expect(h.listInvitations).toHaveBeenCalledWith("org-1", { status: "open" })
  })

  it("counts what is waiting, and says so when nothing is", async () => {
    renderPage()
    expect(await screen.findByRole("tab", { name: "Invited (1)" })).toBeInTheDocument()

    h.listInvitations.mockResolvedValue({ data: [], nextCursor: null })
    renderPage()
    await userEvent.click(screen.getAllByRole("tab", { name: /invited/i })[1])
    expect(await screen.findByText(/nobody is waiting/i)).toBeInTheDocument()
  })
})

describe("the owner's row", () => {
  it("says why it is different instead of hiding the controls", async () => {
    renderPage()
    expect(await screen.findByText(/Owner · by transfer only/)).toBeInTheDocument()
    // No role dropdown for the owner — the database refuses it anyway.
    expect(screen.queryByLabelText(/Role for Olive Owner/)).not.toBeInTheDocument()
  })
})

describe("changing a member", () => {
  it("suspends and reinstates, naming the action for the current state", async () => {
    renderPage()
    await screen.findByText("Mia Member")
    const rows = screen.getAllByRole("listitem")
    const miaRow = rows.find((r) => r.textContent?.includes("Mia Member"))!
    await userEvent.click(within(miaRow).getByRole("button", { name: "Suspend" }))
    await waitFor(() => expect(h.updateOrgMember).toHaveBeenCalledWith("org-1", "u-2", { role: undefined, status: "suspended" }))

    const samRow = screen.getAllByRole("listitem").find((r) => r.textContent?.includes("Sam Suspended"))!
    expect(within(samRow).getByText("Suspended")).toBeInTheDocument()
    await userEvent.click(within(samRow).getByRole("button", { name: "Reinstate" }))
    await waitFor(() => expect(h.updateOrgMember).toHaveBeenCalledWith("org-1", "u-3", { role: undefined, status: "active" }))
  })

  it("removes on request", async () => {
    renderPage()
    await screen.findByText("Mia Member")
    const miaRow = screen.getAllByRole("listitem").find((r) => r.textContent?.includes("Mia Member"))!
    await userEvent.click(within(miaRow).getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(h.removeOrgMember).toHaveBeenCalledWith("org-1", "u-2"))
  })

  it("explains a refusal rather than failing silently", async () => {
    h.updateOrgMember.mockRejectedValue(new FakeOrgApiError("insufficient_role", "no"))
    renderPage()
    await screen.findByText("Mia Member")
    const miaRow = screen.getAllByRole("listitem").find((r) => r.textContent?.includes("Mia Member"))!
    await userEvent.click(within(miaRow).getByRole("button", { name: "Suspend" }))
    expect(await screen.findByText(/cannot make that change/i)).toBeInTheDocument()
  })
})

describe("pending invitations", () => {
  it("can be resent and revoked", async () => {
    renderPage()
    await userEvent.click(await screen.findByRole("tab", { name: /invited/i }))
    await userEvent.click(await screen.findByRole("button", { name: "Resend" }))
    await waitFor(() => expect(h.resendInvitation).toHaveBeenCalledWith("inv-1"))
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }))
    await waitFor(() => expect(h.revokeInvitation).toHaveBeenCalledWith("inv-1"))
  })

  it("says when one was already accepted", async () => {
    h.revokeInvitation.mockRejectedValue(new FakeOrgApiError("invitation_accepted", "no", 400))
    renderPage()
    await userEvent.click(await screen.findByRole("tab", { name: /invited/i }))
    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }))
    expect(await screen.findByText(/already been accepted/i)).toBeInTheDocument()
  })
})

describe("a non-active organization", () => {
  it("cannot be invited into or changed, and says so once", async () => {
    withMembership({ status: "suspended" })
    renderPage()
    expect(await screen.findByText(/nobody can be invited or changed while this organization is suspended/i)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /invite people/i })).toBeDisabled()
    await screen.findByText("Mia Member")
    const miaRow = screen.getAllByRole("listitem").find((r) => r.textContent?.includes("Mia Member"))!
    expect(within(miaRow).getByLabelText(/Role for Mia Member/)).toBeDisabled()
  })
})

describe("the invite dialog", () => {
  it("opens on request", async () => {
    renderPage()
    await screen.findByText("Mia Member")
    expect(screen.queryByText("invite dialog")).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /invite people/i }))
    expect(screen.getByText("invite dialog")).toBeInTheDocument()
  })
})
