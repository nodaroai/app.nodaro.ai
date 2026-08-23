import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => {
  class FakeOrgApiError extends Error {
    code: string
    status: number
    constructor(code: string, message: string, status = 404) {
      super(message)
      this.code = code
      this.status = status
    }
  }
  return {
    FakeOrgApiError,
    getWorkspace: vi.fn(),
    getActiveWorkspaceId: vi.fn<() => string | null>(() => null),
    setActiveWorkspace: vi.fn(),
    vocabulary: { workspace: "Class", workspace_admin: "Teacher" } as Record<string, string>,
  }
})
const FakeOrgApiError = h.FakeOrgApiError

vi.mock("@/ee/lib/orgs-api", () => ({ OrgApiError: h.FakeOrgApiError, getWorkspace: h.getWorkspace }))
vi.mock("@/lib/workspace-context", () => ({
  getActiveWorkspaceId: h.getActiveWorkspaceId,
  setActiveWorkspace: h.setActiveWorkspace,
}))
vi.mock("@/ee/hooks/use-workspace", () => ({ useVocabulary: () => h.vocabulary }))

import WorkspaceHomePage from "../workspace-home-page"

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
  role: "member" as const,
  memberStatus: "active" as const,
}

async function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/w/ws-1"]}>
        <Routes>
          <Route path="/w/:id" element={<WorkspaceHomePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  h.getWorkspace.mockResolvedValue(WORKSPACE)
  h.getActiveWorkspaceId.mockReturnValue(null)
  h.vocabulary = { workspace: "Class", workspace_admin: "Teacher" }
})
afterEach(() => vi.clearAllMocks())

describe("arriving at a workspace URL", () => {
  it("selects it — a pasted link must put the recipient where the sender was", async () => {
    await renderPage()
    expect(await screen.findByText("Class 1")).toBeInTheDocument()
    expect(h.setActiveWorkspace).toHaveBeenCalledWith("ws-1")
  })

  it("does not re-select what is already selected", async () => {
    h.getActiveWorkspaceId.mockReturnValue("ws-1")
    await renderPage()
    expect(await screen.findByText("Class 1")).toBeInTheDocument()
    expect(h.setActiveWorkspace).not.toHaveBeenCalled()
  })

  it("re-selects when a DIFFERENT workspace was selected — the header never authorizes", async () => {
    // The read goes out carrying the previously selected workspace's header.
    // It succeeds anyway, because a header decides scope and never access;
    // this is the cell that invariant exists for.
    h.getActiveWorkspaceId.mockReturnValue("ws-other")
    await renderPage()
    expect(await screen.findByText("Class 1")).toBeInTheDocument()
    expect(h.setActiveWorkspace).toHaveBeenCalledWith("ws-1")
  })

  it("shows the name and description", async () => {
    await renderPage()
    expect(await screen.findByText("Class 1")).toBeInTheDocument()
    expect(screen.getByText("Period three")).toBeInTheDocument()
  })
})

describe("what an admin sees that a member does not", () => {
  it("a member gets no management links and no role badge", async () => {
    await renderPage()
    expect(await screen.findByText("Class 1")).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "People" })).not.toBeInTheDocument()
    expect(screen.queryByText("Teacher")).not.toBeInTheDocument()
  })

  it("an admin gets both, labelled in the organization's own words", async () => {
    h.getWorkspace.mockResolvedValue({ ...WORKSPACE, role: "admin" })
    await renderPage()
    expect(await screen.findByText("Teacher")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("href", "/w/ws-1/people")
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/w/ws-1/settings")
  })
})

describe("an archived workspace", () => {
  it("says so, and says what still works", async () => {
    // A read-only workspace that does not say so is how someone loses ten
    // minutes to a save button that will never work.
    h.getWorkspace.mockResolvedValue({ ...WORKSPACE, archived: true, archivedAt: "2026-01-01T00:00:00.000Z" })
    await renderPage()
    expect(await screen.findByText(/this class is archived/i)).toBeInTheDocument()
    expect(screen.getByText(/stays readable/i)).toBeInTheDocument()
  })

  it("says nothing of the sort when it is live", async () => {
    await renderPage()
    expect(await screen.findByText("Class 1")).toBeInTheDocument()
    expect(screen.queryByText(/archived/i)).not.toBeInTheDocument()
  })
})

describe("when it cannot be opened", () => {
  it("repeats the server's one answer for 'no such workspace' and 'not yours'", async () => {
    h.getWorkspace.mockRejectedValue(new FakeOrgApiError("not_found", "Not found", 404))
    await renderPage()
    expect(await screen.findByText("Class not found")).toBeInTheDocument()
    expect(screen.getByText(/does not exist, or you are not a member/i)).toBeInTheDocument()
    expect(h.setActiveWorkspace).not.toHaveBeenCalled()
  })

  it("names a suspension as a suspension, since that one has a remedy", async () => {
    h.getWorkspace.mockRejectedValue(new FakeOrgApiError("member_suspended", "no", 403))
    await renderPage()
    expect(await screen.findByRole("heading", { name: /your membership is suspended/i })).toBeInTheDocument()
    expect(screen.getByText(/an administrator can lift it/i)).toBeInTheDocument()
  })

  it("offers a way back rather than a dead end", async () => {
    h.getWorkspace.mockRejectedValue(new FakeOrgApiError("not_found", "Not found"))
    await renderPage()
    expect(await screen.findByRole("link", { name: /back to your work/i })).toHaveAttribute("href", "/")
  })
})
