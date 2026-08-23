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
    getWorkspace: vi.fn(),
    listWorkspaceMembers: vi.fn(),
    updateWorkspaceMember: vi.fn(),
    removeWorkspaceMember: vi.fn(),
    updateWorkspace: vi.fn(),
    getJoinCode: vi.fn(),
    actOnJoinCode: vi.fn(),
    writeText: vi.fn(),
  }
})
const FakeOrgApiError = h.FakeOrgApiError

vi.mock("@/ee/lib/orgs-api", () => ({
  OrgApiError: h.FakeOrgApiError,
  getWorkspace: h.getWorkspace,
  listWorkspaceMembers: h.listWorkspaceMembers,
  updateWorkspaceMember: h.updateWorkspaceMember,
  removeWorkspaceMember: h.removeWorkspaceMember,
  updateWorkspace: h.updateWorkspace,
  getJoinCode: h.getJoinCode,
  actOnJoinCode: h.actOnJoinCode,
}))
vi.mock("@/ee/hooks/use-workspace", () => ({
  useVocabulary: () => ({ workspace: "Class", workspace_admin: "Teacher", workspace_member: "Student" }),
}))

import WorkspacePeoplePage from "../workspace-people-page"
import WorkspaceSettingsPage from "../workspace-settings-page"

const WORKSPACE = {
  id: "ws-1",
  orgId: "org-1",
  name: "Class 1",
  slug: "class-1",
  description: "Period three",
  settings: {},
  defaultProjectId: null,
  archived: false,
  archivedAt: null,
  createdAt: "",
  updatedAt: "",
  role: "admin" as const,
  memberStatus: "active" as const,
}

/** A member's copy of a row carries no standing and no cap — the server decides that. */
const MEMBER_VIEW = { userId: "u-2", role: "member" as const, displayName: "Mia Member", avatarUrl: null, addedAt: "" }
const ADMIN_VIEW = { ...MEMBER_VIEW, status: "active" as const, creditCap: null }
const SUSPENDED_VIEW = { ...ADMIN_VIEW, userId: "u-3", displayName: "Sam Suspended", status: "suspended" as const }

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

const renderPeople = () => renderAt("/w/ws-1/people", <WorkspacePeoplePage />, "/w/:id/people")
const renderSettings = () => renderAt("/w/ws-1/settings", <WorkspaceSettingsPage />, "/w/:id/settings")

beforeEach(() => {
  h.getWorkspace.mockResolvedValue(WORKSPACE)
  h.listWorkspaceMembers.mockResolvedValue({ data: [ADMIN_VIEW, SUSPENDED_VIEW], nextCursor: null })
  h.updateWorkspaceMember.mockResolvedValue(ADMIN_VIEW)
  h.removeWorkspaceMember.mockResolvedValue({ removed: true })
  h.updateWorkspace.mockResolvedValue(WORKSPACE)
  h.getJoinCode.mockResolvedValue({ code: "BCDFGHJK", enabled: true, rotatedAt: "", rotatedBy: "u-1" })
  h.actOnJoinCode.mockResolvedValue({ code: "MNPQRSTV", enabled: true, rotatedAt: "", rotatedBy: "u-1" })
  Object.assign(navigator, { clipboard: { writeText: h.writeText } })
})
afterEach(() => vi.clearAllMocks())

describe("the people page", () => {
  it("shows an admin the standing and the controls", async () => {
    renderPeople()
    expect(await screen.findByText("Mia Member")).toBeInTheDocument()
    expect(screen.getByText("Suspended")).toBeInTheDocument()
    expect(screen.getByLabelText(/Role for Mia Member/)).toBeInTheDocument()
  })

  it("shows a member the plain list the SERVER gave them", async () => {
    // A member's rows arrive without `status`; the absence is what says which
    // view this is, so nothing here has to guess from the role.
    h.getWorkspace.mockResolvedValue({ ...WORKSPACE, role: "member" })
    h.listWorkspaceMembers.mockResolvedValue({ data: [MEMBER_VIEW], nextCursor: null })
    renderPeople()
    expect(await screen.findByText("Mia Member")).toBeInTheDocument()
    expect(screen.getByText("Student")).toBeInTheDocument()
    expect(screen.queryByLabelText(/Role for/)).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument()
  })

  it("says that removing here is not expelling from the organization", async () => {
    renderPeople()
    expect(await screen.findByText(/they stay in the organization/i)).toBeInTheDocument()
  })

  it("suspends, reinstates and removes", async () => {
    renderPeople()
    await screen.findByText("Mia Member")
    const mia = screen.getAllByRole("listitem").find((r) => r.textContent?.includes("Mia Member"))!
    await userEvent.click(within(mia).getByRole("button", { name: "Suspend" }))
    await waitFor(() =>
      expect(h.updateWorkspaceMember).toHaveBeenCalledWith("ws-1", "u-2", { role: undefined, status: "suspended" }),
    )
    await userEvent.click(within(mia).getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(h.removeWorkspaceMember).toHaveBeenCalledWith("ws-1", "u-2"))

    const sam = screen.getAllByRole("listitem").find((r) => r.textContent?.includes("Sam Suspended"))!
    await userEvent.click(within(sam).getByRole("button", { name: "Reinstate" }))
    await waitFor(() =>
      expect(h.updateWorkspaceMember).toHaveBeenCalledWith("ws-1", "u-3", { role: undefined, status: "active" }),
    )
  })

  it("an archived workspace says so and offers no controls", async () => {
    h.getWorkspace.mockResolvedValue({ ...WORKSPACE, archived: true })
    renderPeople()
    expect(await screen.findByText(/this class is archived/i)).toBeInTheDocument()
    // Await the rows: asserting that a control is absent before the list has
    // rendered proves only that the list had not rendered.
    await screen.findByText("Mia Member")
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Role for/)).not.toBeInTheDocument()
  })

  it("explains a refusal", async () => {
    h.updateWorkspaceMember.mockRejectedValue(new FakeOrgApiError("insufficient_role", "no"))
    renderPeople()
    await screen.findByText("Mia Member")
    const mia = screen.getAllByRole("listitem").find((r) => r.textContent?.includes("Mia Member"))!
    await userEvent.click(within(mia).getByRole("button", { name: "Suspend" }))
    expect(await screen.findByText(/cannot make that change/i)).toBeInTheDocument()
  })

  it("a workspace it cannot open says so once, with a way back", async () => {
    h.getWorkspace.mockRejectedValue(new FakeOrgApiError("not_found", "Not found", 404))
    renderPeople()
    expect(await screen.findByText("Not available")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /back to your work/i })).toHaveAttribute("href", "/")
    expect(h.listWorkspaceMembers).not.toHaveBeenCalled()
  })
})

describe("the settings page", () => {
  it("seeds the fields and saves what changed", async () => {
    renderSettings()
    const nameField = await screen.findByLabelText("Name")
    expect(nameField).toHaveValue("Class 1")
    expect(screen.getByLabelText("Description")).toHaveValue("Period three")
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled()

    await userEvent.clear(nameField)
    await userEvent.type(nameField, "Class One")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() =>
      expect(h.updateWorkspace).toHaveBeenCalledWith("ws-1", { name: "Class One", description: "Period three" }),
    )
  })

  it("sends a cleared description as null, not as an empty string", async () => {
    renderSettings()
    await screen.findByLabelText("Name")
    await userEvent.clear(screen.getByLabelText("Description"))
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(h.updateWorkspace).toHaveBeenCalledWith("ws-1", { name: "Class 1", description: null }))
  })

  it("a member sees the values and cannot change them", async () => {
    h.getWorkspace.mockResolvedValue({ ...WORKSPACE, role: "member" })
    renderSettings()
    expect(await screen.findByText(/only an administrator of this class/i)).toBeInTheDocument()
    expect(screen.getByLabelText("Name")).toBeDisabled()
    // The join code is an administrator's business.
    expect(screen.queryByText("Join code")).not.toBeInTheDocument()
  })

  it("an archived workspace is read-only and says why", async () => {
    h.getWorkspace.mockResolvedValue({ ...WORKSPACE, archived: true })
    renderSettings()
    expect(await screen.findByText(/archived. nothing can be changed/i)).toBeInTheDocument()
    expect(screen.getByLabelText("Name")).toBeDisabled()
  })

  it("explains a refused save", async () => {
    h.updateWorkspace.mockRejectedValue(new FakeOrgApiError("workspace_archived", "no"))
    renderSettings()
    const nameField = await screen.findByLabelText("Name")
    await userEvent.type(nameField, "!")
    await userEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(await screen.findByText(/archived, so nothing can be changed/i)).toBeInTheDocument()
  })
})

/**
 * A code is read aloud in a room, so how it looks and what the card SAYS
 * about it are the product: an administrator who does not understand that a
 * code circulates is the whole risk of having codes.
 */
describe("the join code card", () => {
  it("shows the code grouped the way it gets read out", async () => {
    renderSettings()
    expect(await screen.findByLabelText("Join code BCDFGHJK")).toHaveTextContent("BCDF-GHJK")
  })

  it("says plainly what having one means, and what a new one does", async () => {
    renderSettings()
    expect(await screen.findByText(/anyone who has the code can join this class as a member/i)).toBeInTheDocument()
    // The second sentence lives with the code itself, which arrives with the
    // query — asserting before it resolves would only prove the header.
    await screen.findByLabelText("Join code BCDFGHJK")
    expect(screen.getByText(/a new code stops the old one working immediately/i)).toBeInTheDocument()
  })

  it("turns joining on and off", async () => {
    renderSettings()
    const toggle = await screen.findByLabelText(/allow joining with a code/i)
    await userEvent.click(toggle)
    await waitFor(() => expect(h.actOnJoinCode).toHaveBeenCalledWith("ws-1", "disable"))
  })

  it("rotates, and copies", async () => {
    renderSettings()
    await userEvent.click(await screen.findByRole("button", { name: "New code" }))
    await waitFor(() => expect(h.actOnJoinCode).toHaveBeenCalledWith("ws-1", "rotate"))
    await userEvent.click(screen.getByRole("button", { name: "Copy" }))
    expect(h.writeText).toHaveBeenCalledWith("BCDFGHJK")
  })

  it("says a disabled code will not work, even though it is shown", async () => {
    h.getJoinCode.mockResolvedValue({ code: "BCDFGHJK", enabled: false, rotatedAt: "", rotatedBy: null })
    renderSettings()
    expect(await screen.findByText(/joining is off/i)).toBeInTheDocument()
  })

  it("a workspace with no code yet says how to get one", async () => {
    h.getJoinCode.mockResolvedValue(null)
    renderSettings()
    expect(await screen.findByText(/no code yet. turning this on will make one/i)).toBeInTheDocument()
  })

  it("explains a refusal instead of appearing to do nothing", async () => {
    h.actOnJoinCode.mockRejectedValue(new FakeOrgApiError("workspace_archived", "no"))
    renderSettings()
    await userEvent.click(await screen.findByRole("button", { name: "New code" }))
    expect(await screen.findByText(/archived, so its join code cannot change/i)).toBeInTheDocument()
  })
})
