import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

const h = vi.hoisted(() => ({
  hasOrganizations: vi.fn(() => true),
  setActiveWorkspace: vi.fn(),
  state: {
    status: "ready" as string,
    organizations: [] as unknown[],
    workspaces: [] as unknown[],
    activeWorkspaceId: null as string | null,
  },
}))

vi.mock("@/lib/edition", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/edition")>()
  return { ...actual, hasOrganizations: h.hasOrganizations }
})
vi.mock("@/ee/hooks/use-workspace", () => ({
  useWorkspace: () => ({ ...h.state, setActiveWorkspace: h.setActiveWorkspace }),
}))

import { OrgSwitcherSection } from "../org-switcher-section"

const SCHOOL = {
  id: "org-1",
  slug: "school-a",
  name: "School A",
  kind: "school",
  status: "active",
  role: "member",
  memberStatus: "active",
  settings: { personal_space_enabled: true, allowed_email_domains: [], vocabulary_overrides: {} },
  vocabulary: { workspace: "Class" },
}
const TEAM = { ...SCHOOL, id: "org-2", slug: "team-b", name: "Team B", kind: "team", vocabulary: { workspace: "Team" } }
const CLASS_1 = { id: "ws-1", orgId: "org-1", name: "Class 1", slug: "class-1", role: "member", memberStatus: "active", archived: false }
const OLD_CLASS = { ...CLASS_1, id: "ws-2", name: "Old Class", slug: "old-class", archived: true }

/** The switcher lives inside the sidebar's menu; render it in an open one. */
async function renderOpen() {
  render(
    <MemoryRouter>
      <DropdownMenu>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <OrgSwitcherSection />
        </DropdownMenuContent>
      </DropdownMenu>
    </MemoryRouter>,
  )
  await userEvent.click(screen.getByText("menu"))
}

beforeEach(() => {
  h.hasOrganizations.mockReturnValue(true)
  h.state = {
    status: "ready",
    organizations: [SCHOOL, TEAM],
    workspaces: [CLASS_1, { ...CLASS_1, id: "ws-9", orgId: "org-2", name: "Design" }],
    activeWorkspaceId: "ws-1",
  }
})
afterEach(() => vi.clearAllMocks())

/**
 * An empty switcher is a permanent invitation to wonder what is missing, so
 * the cases with nothing to switch between render nothing rather than an
 * empty section — EXCEPT the one where there is nowhere to switch to but
 * somewhere to go.
 */
describe("when there is nothing to switch between", () => {
  it.each([
    ["the build has no organizations", () => h.hasOrganizations.mockReturnValue(false)],
    ["the memberships have not loaded", () => (h.state = { ...h.state, status: "loading" })],
  ])("renders nothing at all: %s", async (_name, arrange) => {
    arrange()
    await renderOpen()
    expect(screen.queryByText("Workspaces")).not.toBeInTheDocument()
    expect(screen.queryByText("Personal")).not.toBeInTheDocument()
    expect(screen.queryByText("Create organization")).not.toBeInTheDocument()
  })

  it("an account that belongs to NO organization still gets the ways in", async () => {
    // Hiding the section here would orphan "Create organization" for exactly
    // the person it exists for: someone with no organization yet.
    h.state = { ...h.state, organizations: [], workspaces: [] }
    await renderOpen()
    expect(screen.getByText("Create organization").closest("a")).toHaveAttribute("href", "/org/new")
    expect(screen.getByText("Join with a code").closest("a")).toHaveAttribute("href", "/join")
    // ...but no list, and no Personal row: there is nothing to switch between.
    expect(screen.queryByText("Workspaces")).not.toBeInTheDocument()
    expect(screen.queryByText("Personal")).not.toBeInTheDocument()
  })
})

describe("the list", () => {
  it("offers the personal space and every workspace, grouped by organization", async () => {
    await renderOpen()
    expect(screen.getByText("Personal")).toBeInTheDocument()
    expect(screen.getByText("School A")).toBeInTheDocument()
    expect(screen.getByText("Team B")).toBeInTheDocument()
    expect(screen.getByText("Class 1")).toBeInTheDocument()
    expect(screen.getByText("Design")).toBeInTheDocument()
  })

  it("marks exactly what is selected", async () => {
    await renderOpen()
    expect(screen.getAllByLabelText("Selected")).toHaveLength(1)
    expect(screen.getByText("Class 1").closest("[role='menuitem']")).toContainElement(
      screen.getByLabelText("Selected"),
    )
  })

  it("marks Personal when nothing is selected", async () => {
    h.state = { ...h.state, activeWorkspaceId: null }
    await renderOpen()
    expect(screen.getAllByLabelText("Selected")).toHaveLength(1)
    expect(screen.getByText("Personal").closest("[role='menuitem']")).toContainElement(
      screen.getByLabelText("Selected"),
    )
  })

  it("switches on click, and to the personal space too", async () => {
    await renderOpen()
    await userEvent.click(screen.getByText("Design"))
    expect(h.setActiveWorkspace).toHaveBeenCalledWith("ws-9")

    cleanup()
    await renderOpen()
    await userEvent.click(screen.getByText("Personal"))
    expect(h.setActiveWorkspace).toHaveBeenCalledWith(null)
  })

  it("keeps archived workspaces listed and selectable — read-only is not gone", async () => {
    h.state = { ...h.state, workspaces: [CLASS_1, OLD_CLASS] }
    await renderOpen()
    expect(screen.getByText(/Old Class · archived/)).toBeInTheDocument()
    await userEvent.click(screen.getByText(/Old Class/))
    expect(h.setActiveWorkspace).toHaveBeenCalledWith("ws-2")
  })

  it("uses each organization's own word for an empty one", async () => {
    h.state = { ...h.state, workspaces: [] }
    await renderOpen()
    expect(screen.getByText("No classes yet")).toBeInTheDocument()
    expect(screen.getByText("No teams yet")).toBeInTheDocument()
  })

  it("says an organization is still awaiting approval", async () => {
    h.state = { ...h.state, organizations: [{ ...SCHOOL, status: "pending" }] }
    await renderOpen()
    expect(screen.getByText(/School A · awaiting approval/)).toBeInTheDocument()
  })

  it("shows the last known list when the lookup FAILED — a blip is not a departure", async () => {
    h.state = { ...h.state, status: "unavailable" }
    await renderOpen()
    expect(screen.getByText("Class 1")).toBeInTheDocument()
  })

  it("offers the ways to get another organization", async () => {
    await renderOpen()
    expect(screen.getByText("Create organization").closest("a")).toHaveAttribute("href", "/org/new")
    expect(screen.getByText("Join with a code").closest("a")).toHaveAttribute("href", "/join")
  })
})
