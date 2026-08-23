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
    getOrganization: vi.fn(),
    updateOrganization: vi.fn(),
    listOrgWorkspaces: vi.fn(),
    createWorkspace: vi.fn(),
    setWorkspaceArchived: vi.fn(),
    hydrateWorkspaces: vi.fn(async () => {}),
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
  updateOrganization: h.updateOrganization,
  listOrgWorkspaces: h.listOrgWorkspaces,
  createWorkspace: h.createWorkspace,
  setWorkspaceArchived: h.setWorkspaceArchived,
}))
vi.mock("@/lib/workspace-context", () => ({ hydrateWorkspaces: h.hydrateWorkspaces }))
vi.mock("@/ee/hooks/use-workspace", () => ({ useWorkspace: () => h.workspaceState }))

import OrgSettingsPage from "../org-settings-page"
import OrgWorkspacesPage from "../org-workspaces-page"

const SCHOOL = {
  id: "org-1",
  slug: "school-a",
  name: "School A",
  kind: "school" as const,
  status: "active" as const,
  role: "admin" as const,
  memberStatus: "active" as const,
  settings: { personal_space_enabled: true, allowed_email_domains: [], vocabulary_overrides: {} },
  vocabulary: { workspace: "Class", org_admin: "Administrator", workspace_member: "Student" },
}

const ORG_DETAIL = {
  ...SCHOOL,
  ownerUserId: "u-1",
  settings: { admin_access: "edit" as const, personal_space_enabled: true, allowed_email_domains: ["school.example"] },
  termsAcceptedAt: null,
  createdAt: "",
  updatedAt: "",
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
}
const ARCHIVED = { ...WORKSPACE, id: "ws-2", name: "Old Class", archived: true }

function renderAt(path: string, element: React.ReactElement, route: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const renderWorkspaces = (slug = "school-a") =>
  renderAt(`/org/${slug}/workspaces`, <OrgWorkspacesPage />, "/org/:slug/workspaces")
const renderSettings = (slug = "school-a") => renderAt(`/org/${slug}/settings`, <OrgSettingsPage />, "/org/:slug/settings")

function withMembership(overrides: Record<string, unknown> = {}) {
  h.workspaceState = { ...h.workspaceState, status: "ready", organizations: [{ ...SCHOOL, ...overrides }] }
}

beforeEach(() => {
  h.workspaceState = { status: "ready", organizations: [SCHOOL], workspaces: [], activeWorkspaceId: null }
  h.getOrganization.mockResolvedValue(ORG_DETAIL)
  h.updateOrganization.mockResolvedValue(ORG_DETAIL)
  h.listOrgWorkspaces.mockResolvedValue([WORKSPACE, ARCHIVED])
  h.createWorkspace.mockResolvedValue(WORKSPACE)
  h.setWorkspaceArchived.mockResolvedValue(ARCHIVED)
})
afterEach(() => vi.clearAllMocks())

describe("the workspaces page", () => {
  it("asks for the archived ones too, and lists them separately with a way back", async () => {
    // Archiving is not deleting. A list that hides what was archived turns
    // "where did the class go" into a support question.
    renderWorkspaces()
    expect(await screen.findByRole("link", { name: "Class 1" })).toBeInTheDocument()
    expect(h.listOrgWorkspaces).toHaveBeenCalledWith("org-1", true)
    expect(screen.getByText("Archived")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Old Class" })).toBeInTheDocument()
    expect(screen.getByText(/stays readable/i)).toBeInTheDocument()
  })

  it("creates, archives and reopens", async () => {
    renderWorkspaces()
    await screen.findByRole("link", { name: "Class 1" })

    await userEvent.type(screen.getByLabelText(/new class/i), "Class 2")
    await userEvent.click(screen.getByRole("button", { name: "Create" }))
    await waitFor(() => expect(h.createWorkspace).toHaveBeenCalledWith("org-1", { name: "Class 2" }))

    await userEvent.click(screen.getByRole("button", { name: "Archive" }))
    await waitFor(() => expect(h.setWorkspaceArchived).toHaveBeenCalledWith("ws-1", true))

    await userEvent.click(screen.getByRole("button", { name: "Reopen" }))
    await waitFor(() => expect(h.setWorkspaceArchived).toHaveBeenCalledWith("ws-2", false))
  })

  it("uses the organization's own plural throughout", async () => {
    renderWorkspaces()
    expect(await screen.findByRole("heading", { name: "Classes" })).toBeInTheDocument()
    expect(screen.getByLabelText("New class")).toBeInTheDocument()
  })

  it("a member cannot manage them", async () => {
    withMembership({ role: "member" })
    renderWorkspaces()
    expect(await screen.findByText("Not available to you")).toBeInTheDocument()
    expect(screen.getByText(/only an owner or an administrator can manage classes/i)).toBeInTheDocument()
    expect(h.listOrgWorkspaces).not.toHaveBeenCalled()
  })

  it("a non-active organization can change nothing, and says so", async () => {
    withMembership({ status: "suspended" })
    renderWorkspaces()
    expect(await screen.findByText(/nothing can be created or changed while this organization is suspended/i)).toBeInTheDocument()
    await screen.findByRole("link", { name: "Class 1" })
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Archive" })).toBeDisabled()
  })

  it("explains a name collision in terms of what to do", async () => {
    h.createWorkspace.mockRejectedValue(new FakeOrgApiError("name_taken", "no", 409))
    renderWorkspaces()
    await screen.findByRole("link", { name: "Class 1" })
    await userEvent.type(screen.getByLabelText(/new class/i), "Class 1")
    await userEvent.click(screen.getByRole("button", { name: "Create" }))
    expect(await screen.findByText(/try a different name/i)).toBeInTheDocument()
  })
})

describe("the settings page", () => {
  it("labels each setting by its consequence, not by its key", async () => {
    renderSettings()
    expect(await screen.findByLabelText(/what administrators may do with a member's work/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/what members may do with work shared to a class/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/where new work starts/i)).toBeInTheDocument()
    expect(screen.queryByText("admin_access")).not.toBeInTheDocument()
  })

  it("sends only what was edited — a full object would overwrite someone else's change", async () => {
    renderSettings()
    const nameField = await screen.findByLabelText("Name")
    await userEvent.clear(nameField)
    await userEvent.type(nameField, "School Alpha")
    await userEvent.click(screen.getByLabelText("Members keep a personal space"))
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(h.updateOrganization).toHaveBeenCalledWith("org-1", {
        name: "School Alpha",
        settings: { personal_space_enabled: false },
      }),
    )
  })

  it("sends nothing for an untouched page, and the button says so", async () => {
    renderSettings()
    await screen.findByLabelText("Name")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()
    expect(h.updateOrganization).not.toHaveBeenCalled()
  })

  it("reloads the memberships after saving — the vocabulary and name live there", async () => {
    renderSettings()
    const nameField = await screen.findByLabelText("Name")
    await userEvent.type(nameField, "!")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(h.hydrateWorkspaces).toHaveBeenCalled())
  })

  it("parses the domain list the way people type it", async () => {
    renderSettings()
    const domains = await screen.findByLabelText("Allowed email domains")
    expect(domains).toHaveValue("school.example")
    await userEvent.clear(domains)
    await userEvent.type(domains, "One.example, TWO.example")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(h.updateOrganization).toHaveBeenCalledWith("org-1", {
        settings: { allowed_email_domains: ["one.example", "two.example"] },
      }),
    )
  })

  it("after saving, the fields show what the SERVER kept", async () => {
    // The server normalizes — it may drop a domain it will not accept. The
    // seeding effect re-runs once the refetch lands, so the field ends up
    // showing what was actually stored rather than what was typed. Deciding
    // this deliberately: server truth wins after a save, the same doctrine
    // the console uses for status.
    h.updateOrganization.mockResolvedValue({
      ...ORG_DETAIL,
      settings: { ...ORG_DETAIL.settings, allowed_email_domains: ["kept.example"] },
    })
    h.getOrganization.mockResolvedValueOnce(ORG_DETAIL).mockResolvedValue({
      ...ORG_DETAIL,
      settings: { ...ORG_DETAIL.settings, allowed_email_domains: ["kept.example"] },
    })
    renderSettings()
    const domains = await screen.findByLabelText("Allowed email domains")
    await userEvent.clear(domains)
    await userEvent.type(domains, "kept.example, dropped")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(screen.getByLabelText("Allowed email domains")).toHaveValue("kept.example"))
  })

  it("a member cannot open it", async () => {
    withMembership({ role: "member" })
    renderSettings()
    expect(await screen.findByText("Not available to you")).toBeInTheDocument()
    expect(h.getOrganization).not.toHaveBeenCalled()
  })

  it("a non-active organization is read-only", async () => {
    withMembership({ status: "suspended" })
    renderSettings()
    expect(await screen.findByText(/nothing can be changed while this organization is suspended/i)).toBeInTheDocument()
    expect(screen.getByLabelText("Name")).toBeDisabled()
  })

  it("explains a refused save", async () => {
    h.updateOrganization.mockRejectedValue(new FakeOrgApiError("validation_error", "Domains must be lower-case", 400))
    renderSettings()
    const nameField = await screen.findByLabelText("Name")
    await userEvent.type(nameField, "!")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(await screen.findByText("Domains must be lower-case")).toBeInTheDocument()
  })
})
