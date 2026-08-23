import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => ({
  listOrgAudit: vi.fn(),
  workspaceState: {
    status: "ready" as string,
    organizations: [] as unknown[],
    workspaces: [] as unknown[],
    activeWorkspaceId: null as string | null,
  },
}))

vi.mock("@/ee/lib/orgs-api", () => ({ listOrgAudit: h.listOrgAudit }))
vi.mock("@/ee/hooks/use-workspace", () => ({ useWorkspace: () => h.workspaceState }))

import OrgAuditPage from "../org-audit-page"

const SCHOOL = {
  id: "org-1",
  slug: "school-a",
  name: "Kent High",
  kind: "school",
  status: "active",
  role: "owner",
  memberStatus: "active",
  settings: { personal_space_enabled: true, allowed_email_domains: [], vocabulary_overrides: {} },
  vocabulary: {},
}

function entry(over: Record<string, unknown> = {}) {
  return {
    id: "10",
    workspaceId: null,
    action: "org.member.removed",
    targetType: "user",
    targetId: "u-2",
    details: {},
    createdAt: "2026-08-20T09:00:00.000Z",
    actor: { userId: "u-1", displayName: "Ada Lovelace", email: "ada@kent.edu" },
    ...over,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/org/school-a/audit"]}>
        <Routes>
          <Route path="/org/:slug/audit" element={<OrgAuditPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.workspaceState = {
    status: "ready",
    organizations: [SCHOOL],
    workspaces: [],
    activeWorkspaceId: null,
  }
  h.listOrgAudit.mockResolvedValue({ data: [entry()], nextCursor: null })
})

describe("the history of an organization", () => {
  it("says what happened, in plain words, and who did it", async () => {
    renderPage()
    expect(await screen.findByText("A member was removed")).toBeInTheDocument()
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument()
  })

  /**
   * The server owns this vocabulary and adds to it. A page that only
   * rendered actions it recognised would go blank on the first new one.
   */
  it("still renders an action it has never heard of", async () => {
    h.listOrgAudit.mockResolvedValue({
      data: [entry({ action: "budget.threshold_crossed" })],
      nextCursor: null,
    })
    renderPage()
    expect(await screen.findByText("budget.threshold_crossed")).toBeInTheDocument()
  })

  it("names the system when nobody did it", async () => {
    // A blank where the actor goes reads as missing data rather than as
    // "this was automatic".
    h.listOrgAudit.mockResolvedValue({ data: [entry({ actor: null })], nextCursor: null })
    renderPage()
    expect(await screen.findByText("The system")).toBeInTheDocument()
  })

  it("falls back to an id when an actor has no name or address", async () => {
    h.listOrgAudit.mockResolvedValue({
      data: [entry({ actor: { userId: "u-9", displayName: null, email: null } })],
      nextCursor: null,
    })
    renderPage()
    expect(await screen.findByText("u-9")).toBeInTheDocument()
  })

  it("is readable while the organization is SUSPENDED", async () => {
    // The one management screen that stays open then: a suspension is
    // exactly when someone needs to know what led to it.
    h.workspaceState = {
      ...h.workspaceState,
      organizations: [{ ...SCHOOL, status: "suspended" }],
    }
    renderPage()
    expect(await screen.findByText("A member was removed")).toBeInTheDocument()
  })

  it("refuses a plain member, and asks for nothing on their behalf", async () => {
    h.workspaceState = { ...h.workspaceState, organizations: [{ ...SCHOOL, role: "member" }] }
    renderPage()
    expect(await screen.findByText("Not available to you")).toBeInTheDocument()
    expect(h.listOrgAudit).not.toHaveBeenCalled()
  })

  it("says the organization is not found when the caller is in no such one", async () => {
    h.workspaceState = { ...h.workspaceState, organizations: [] }
    renderPage()
    expect(await screen.findByText("Organization not found")).toBeInTheDocument()
    expect(h.listOrgAudit).not.toHaveBeenCalled()
  })

  it("says the lookup failed rather than that the organization is gone", async () => {
    // "We could not find out" is not "it does not exist". Telling an owner
    // their school vanished because a cache blipped is the one thing the
    // three-state `me` payload exists to prevent.
    h.workspaceState = { ...h.workspaceState, status: "unavailable", organizations: [] }
    renderPage()
    expect(await screen.findByText("Could not load your organizations")).toBeInTheDocument()
    expect(screen.queryByText("Organization not found")).not.toBeInTheDocument()
    expect(h.listOrgAudit).not.toHaveBeenCalled()
  })

  it("waits for memberships rather than deciding on a half-loaded answer", () => {
    // Deciding "not found" before the memberships arrive would flash a wrong
    // refusal at every owner on every load.
    h.workspaceState = { ...h.workspaceState, status: "loading", organizations: [] }
    renderPage()
    expect(screen.queryByText("Organization not found")).not.toBeInTheDocument()
    expect(h.listOrgAudit).not.toHaveBeenCalled()
  })

  it("offers older entries only when there are older entries", async () => {
    h.listOrgAudit.mockResolvedValue({ data: [entry()], nextCursor: "cursor-2" })
    renderPage()
    const older = await screen.findByRole("button", { name: /show older/i })
    await userEvent.click(older)
    expect(h.listOrgAudit).toHaveBeenLastCalledWith("org-1", { cursor: "cursor-2" })
  })

  it("does not offer older entries on the last page", async () => {
    renderPage()
    await screen.findByText("A member was removed")
    expect(screen.queryByRole("button", { name: /show older/i })).not.toBeInTheDocument()
  })

  it("says plainly when nothing has been recorded", async () => {
    h.listOrgAudit.mockResolvedValue({ data: [], nextCursor: null })
    renderPage()
    expect(await screen.findByText("Nothing has been recorded yet.")).toBeInTheDocument()
  })
})
