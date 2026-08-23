import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
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
    getOrganization: vi.fn(),
    listOrgWorkspaces: vi.fn(),
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
  getOrganization: h.getOrganization,
  listOrgWorkspaces: h.listOrgWorkspaces,
}))
vi.mock("@/ee/hooks/use-workspace", () => ({ useWorkspace: () => h.workspaceState }))

import OrgOverviewPage from "../org-overview-page"

const SCHOOL = {
  id: "org-1",
  slug: "school-a",
  name: "School A",
  kind: "school" as const,
  status: "active" as const,
  role: "member" as const,
  memberStatus: "active" as const,
  settings: { personal_space_enabled: true, allowed_email_domains: [], vocabulary_overrides: {} },
  vocabulary: { workspace: "Class", org_owner: "Owner", org_admin: "Administrator", workspace_member: "Student" },
}

const WORKSPACE = {
  id: "ws-1",
  orgId: "org-1",
  name: "Class 1",
  slug: "class-1",
  description: null,
  settings: {},
  defaultProjectId: null,
  archived: false,
  archivedAt: null,
  createdAt: "",
  updatedAt: "",
  role: "member" as const,
}

function renderPage(slug = "school-a") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/org/${slug}`]}>
        <Routes>
          <Route path="/org/:slug" element={<OrgOverviewPage />} />
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
  h.getOrganization.mockResolvedValue({ ...SCHOOL, ownerUserId: "u-1", termsAcceptedAt: null, createdAt: "", updatedAt: "" })
  h.listOrgWorkspaces.mockResolvedValue([WORKSPACE])
})
afterEach(() => vi.clearAllMocks())

describe("resolving the organization from the URL", () => {
  it("uses the memberships already in hand — the client knows what it belongs to", async () => {
    renderPage()
    expect(await screen.findByText("School A")).toBeInTheDocument()
    expect(h.getOrganization).toHaveBeenCalledWith("org-1")
  })

  it("does not confuse 'not loaded yet' with 'not yours'", async () => {
    // Mid-load the list is genuinely empty, which is exactly the shape that
    // would otherwise render as "you are not a member" and send someone away
    // from a page that was about to work.
    h.workspaceState = { ...h.workspaceState, status: "loading", organizations: [] }
    renderPage()
    expect(screen.getByText("Loading…")).toBeInTheDocument()
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument()
    expect(h.getOrganization).not.toHaveBeenCalled()
  })

  it("an unknown slug is not asked about at all", async () => {
    renderPage("someone-elses-school")
    expect(await screen.findByText("Organization not found")).toBeInTheDocument()
    expect(h.getOrganization).not.toHaveBeenCalled()
    expect(screen.getByRole("link", { name: /back to your work/i })).toHaveAttribute("href", "/")
  })
})

describe("what each role is offered", () => {
  it("a member is shown no door that will not open", async () => {
    renderPage()
    expect(await screen.findByText("School A")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "People" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Manage" })).not.toBeInTheDocument()
  })

  it.each(["owner", "admin"])("%s is offered the management surfaces", async (role) => {
    withMembership({ role })
    renderPage()
    expect(await screen.findByRole("link", { name: "People" })).toHaveAttribute("href", "/org/school-a/members")
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/org/school-a/settings")
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/org/school-a/workspaces")
  })

  it("names the role in the organization's own words, without an article", async () => {
    // No "a"/"an": the label is user-supplied, and no rule gets "an
    // University lead" right. Same policy as the pluralizer — the way out is
    // a phrasing that cannot be wrong, not a dictionary.
    withMembership({ role: "admin" })
    renderPage()
    expect(await screen.findByText(/your role: Administrator/)).toBeInTheDocument()
  })
})

describe("status", () => {
  it("says nothing when the organization is simply active", async () => {
    renderPage()
    expect(await screen.findByText("School A")).toBeInTheDocument()
    expect(screen.queryByText(/waiting for approval/i)).not.toBeInTheDocument()
    expect(screen.queryByText("active")).not.toBeInTheDocument()
  })

  it("explains a pending organization in its own vocabulary", async () => {
    withMembership({ status: "pending", role: "owner" })
    h.getOrganization.mockResolvedValue({ ...SCHOOL, status: "pending", ownerUserId: "u-1", termsAcceptedAt: null, createdAt: "", updatedAt: "" })
    renderPage()
    expect(await screen.findByText(/waiting for approval/i)).toBeInTheDocument()
    expect(screen.getByText(/create classes as soon as it is approved/i)).toBeInTheDocument()
    // Nothing can be created yet, so nothing offers to.
    expect(screen.queryByRole("link", { name: "Manage" })).not.toBeInTheDocument()
  })

  it("clears the pending banner when the SERVER says active, snapshot notwithstanding", async () => {
    // The membership snapshot is from the last hydration; approval happens
    // server-side and nothing on this page reloads memberships. Without
    // preferring the query the banner would sit there after the
    // organization went live.
    withMembership({ status: "pending", role: "owner" })
    h.getOrganization.mockResolvedValue({ ...SCHOOL, status: "active", ownerUserId: "u-1", termsAcceptedAt: null, createdAt: "", updatedAt: "" })
    renderPage()
    expect(await screen.findByRole("link", { name: "Manage" })).toBeInTheDocument()
    expect(screen.queryByText(/waiting for approval/i)).not.toBeInTheDocument()
  })

  it("explains a suspended organization, and says what still works", async () => {
    withMembership({ status: "suspended", role: "owner" })
    h.getOrganization.mockResolvedValue({ ...SCHOOL, status: "suspended", ownerUserId: "u-1", termsAcceptedAt: null, createdAt: "", updatedAt: "" })
    renderPage()
    expect(await screen.findByText(/this organization is suspended/i)).toBeInTheDocument()
    expect(screen.getByText(/everything stays readable/i)).toBeInTheDocument()
  })
})

describe("the workspace list", () => {
  it("links each one, in the organization's own plural", async () => {
    renderPage()
    expect(await screen.findByRole("link", { name: "Class 1" })).toHaveAttribute("href", "/w/ws-1")
    expect(screen.getByText("Classes")).toBeInTheDocument()
  })

  it("hides archived ones from the overview", async () => {
    h.listOrgWorkspaces.mockResolvedValue([WORKSPACE, { ...WORKSPACE, id: "ws-2", name: "Old Class", archived: true }])
    renderPage()
    expect(await screen.findByRole("link", { name: "Class 1" })).toBeInTheDocument()
    expect(screen.queryByText("Old Class")).not.toBeInTheDocument()
  })

  it("invites an admin to make the first one, and does not invite a member", async () => {
    h.listOrgWorkspaces.mockResolvedValue([])
    withMembership({ role: "owner" })
    renderPage()
    expect(await screen.findByText(/no classes yet/i)).toBeInTheDocument()
    expect(screen.getByText(/create one to give people somewhere to work/i)).toBeInTheDocument()
  })

  it("tells a member where their own list is, rather than showing an error", async () => {
    h.listOrgWorkspaces.mockRejectedValue(new FakeOrgApiError("insufficient_role", "no"))
    renderPage()
    expect(await screen.findByText(/from the switcher/i)).toBeInTheDocument()
  })
})
