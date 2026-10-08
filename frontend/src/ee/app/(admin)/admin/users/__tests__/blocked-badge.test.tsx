/**
 * The Users page's part in access control: the "Blocked" badge on a blocked
 * account's row, and what the page hands the Access panel when a row opens.
 *
 * The data hooks are stubbed — the panel itself, its requests and the block
 * list's wire shape are covered by the user-access tests. What is pinned here
 * is the page's own wiring: the badge lands on the right row only, and the
 * panel's free-credit section follows the deployment (credits on, nobody
 * paying for everyone) while its super-admin power follows the viewer's role.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import userEvent from "@testing-library/user-event"
import type { AdminUser } from "@/ee/hooks/queries/use-admin-queries"
import type { AdminBlocks } from "@/ee/hooks/queries/use-admin-access"

const h = vi.hoisted(() => ({
  users: [] as AdminUser[],
  /** Accounts the direct link can open that are not on the listed page. */
  elsewhere: [] as AdminUser[],
  blocks: undefined as AdminBlocks | undefined,
  role: "admin",
  deploymentPayer: false,
  credits: true,
}))

vi.mock("@/ee/hooks/queries/use-admin-queries", () => ({
  USER_SORT_DEFAULT_DIR: {
    email: "asc",
    tier: "asc",
    role: "asc",
    subscription_credits: "desc",
    topup_credits: "desc",
    total_credits: "desc",
    daily_spent_credits: "desc",
    created_at: "desc",
  },
  useAdminUsers: () => ({ data: h.users, isLoading: false, refetch: () => undefined }),
  useAdminUser: (id: string | null) => ({
    data: id ? ([...h.users, ...h.elsewhere].find((u) => u.id === id) ?? null) : null,
    isLoading: false,
    refetch: () => undefined,
  }),
  useAdminChangeRoleMutation: () => ({ mutateAsync: async () => undefined }),
  // The expanded row's own hooks, inert.
  useAdminUserTransactions: () => ({ data: [], isLoading: false }),
  useAdminUserSubscription: () => ({ data: undefined }),
  useAdminAdjustCreditsMutation: () => ({ mutateAsync: async () => undefined }),
  useAdminChangeTierMutation: () => ({ mutateAsync: async () => undefined }),
  useAdminChangeStorageMutation: () => ({ mutateAsync: async () => undefined }),
}))
vi.mock("@/ee/hooks/queries/use-admin-access", () => ({
  useAdminBlocks: () => ({ data: h.blocks }),
}))
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "00000000-0000-4000-8000-0000000000f0" }, role: h.role }),
}))
vi.mock("@/hooks/use-billing-surface", () => ({
  useBillingSurface: () => ({ surface: { deploymentPayer: h.deploymentPayer }, isLoading: false }),
}))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
  hasCredits: () => h.credits,
}))
// Stand-ins that report what the page passed them.
vi.mock("@/ee/components/admin/user-access/user-access-panel", () => ({
  UserAccessPanel: (props: { user: AdminUser; isSuperAdmin: boolean; showFreeCredits: boolean }) => (
    <div
      data-testid="access-panel"
      data-user={props.user.email}
      data-super-admin={String(props.isSuperAdmin)}
      data-free-credits={String(props.showFreeCredits)}
    />
  ),
}))
vi.mock("@/ee/components/admin/user-messages/user-messages-section", () => ({
  UserMessagesSection: () => null,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import AdminUsersPage from "../page"

const ALICE_ID = "00000000-0000-4000-8000-0000000000f1"
const BOB_ID = "00000000-0000-4000-8000-0000000000f2"

function makeUser(id: string, email: string): AdminUser {
  return {
    id,
    email,
    full_name: null,
    subscription_tier: "free",
    subscription_credits: 1500,
    topup_credits: 0,
    daily_spent_credits: 0,
    storage_used_bytes: 0,
    storage_limit_bytes: 1024 * 1024 * 1024,
    role: "user",
    created_at: "2026-09-01T10:00:00.000Z",
    free_grant_state: "granted",
  }
}

function blocksFor(userIds: readonly string[]): AdminBlocks {
  return {
    ready: true,
    usersTruncated: false,
    networksTruncated: false,
    status: { ready: true, users: userIds.length, networks: 0, loadedAt: "2026-10-05T09:00:00.000Z" },
    users: userIds.map((userId) => ({
      userId,
      email: null,
      reason: null,
      blockedBy: null,
      blockedAt: "2026-10-01T12:00:00.000Z",
    })),
    networks: [],
  }
}

const rowOf = (email: string) => screen.getByText(email).closest("tr")!

const renderPage = (path = "/admin/users") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AdminUsersPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  h.users = [makeUser(ALICE_ID, "alice@x.test"), makeUser(BOB_ID, "bob@x.test")]
  h.elsewhere = []
  h.blocks = blocksFor([BOB_ID])
  h.role = "admin"
  h.deploymentPayer = false
  h.credits = true
})

describe("the Blocked badge", () => {
  it("marks the blocked account's row and no other", () => {
    renderPage()

    expect(within(rowOf("bob@x.test")).getByText("Blocked")).toBeInTheDocument()
    expect(within(rowOf("alice@x.test")).queryByText("Blocked")).toBeNull()
    expect(screen.getAllByText("Blocked")).toHaveLength(1)
  })

  it("lists every account without badges while the block list has not loaded", () => {
    h.blocks = undefined
    renderPage()

    expect(screen.getByText("alice@x.test")).toBeInTheDocument()
    expect(screen.getByText("bob@x.test")).toBeInTheDocument()
    expect(screen.queryByText("Blocked")).toBeNull()
  })
})

describe("opening a row", () => {
  it("mounts the Access panel for that account, with free credits where they exist", async () => {
    const user = userEvent.setup()
    renderPage()

    expect(screen.queryByTestId("access-panel")).toBeNull()
    await user.click(screen.getByText("bob@x.test"))

    const panel = screen.getByTestId("access-panel")
    expect(panel).toHaveAttribute("data-user", "bob@x.test")
    expect(panel).toHaveAttribute("data-free-credits", "true")
    expect(panel).toHaveAttribute("data-super-admin", "false")
  })

  it("gives the panel no free-credit section where one account pays for everyone", async () => {
    const user = userEvent.setup()
    h.deploymentPayer = true
    renderPage()

    await user.click(screen.getByText("bob@x.test"))
    expect(screen.getByTestId("access-panel")).toHaveAttribute("data-free-credits", "false")
  })

  it("gives the panel no free-credit section on an edition without credits", async () => {
    const user = userEvent.setup()
    h.credits = false
    renderPage()

    await user.click(screen.getByText("bob@x.test"))
    expect(screen.getByTestId("access-panel")).toHaveAttribute("data-free-credits", "false")
  })

  it("tells the panel when the viewer is a super admin", async () => {
    const user = userEvent.setup()
    h.role = "super_admin"
    renderPage()

    await user.click(screen.getByText("bob@x.test"))
    expect(screen.getByTestId("access-panel")).toHaveAttribute("data-super-admin", "true")
  })
})

describe("a direct link (?user=<id>)", () => {
  const CAROL_ID = "00000000-0000-4000-8000-0000000000f3"

  it("opens that person above the list — even one not on this page — and lists them once", () => {
    h.elsewhere = [makeUser(CAROL_ID, "carol@x.test")]
    renderPage(`/admin/users?user=${CAROL_ID}`)
    expect(screen.getByText("Opened from a link.")).toBeInTheDocument()
    expect(screen.getByTestId("access-panel")).toHaveAttribute("data-user", "carol@x.test")
    // Bob's cell also carries his Blocked badge.
    const emails = screen.getAllByText(/@x\.test/).map((cell) => cell.textContent?.replace("Blocked", ""))
    expect(emails).toEqual(["carol@x.test", "alice@x.test", "bob@x.test"])
  })

  it("with nobody else on the page, the linked person is not followed by 'No users found.'", () => {
    h.users = []
    h.elsewhere = [makeUser(CAROL_ID, "carol@x.test")]
    renderPage(`/admin/users?user=${CAROL_ID}`)
    expect(screen.getByText("carol@x.test")).toBeInTheDocument()
    expect(screen.queryByText("No users found.")).toBeNull()
  })

  it("a person on this page is pinned, not shown twice", () => {
    renderPage(`/admin/users?user=${BOB_ID}`)
    expect(screen.getAllByText("bob@x.test")).toHaveLength(1)
    expect(screen.getByTestId("access-panel")).toHaveAttribute("data-user", "bob@x.test")
  })

  it("an id that matches nobody says so; Show all users drops the link", async () => {
    const user = userEvent.setup()
    renderPage("/admin/users?user=00000000-0000-4000-8000-0000000000ee")
    expect(screen.getByText(/No user with that id/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Show all users" }))
    expect(screen.queryByText(/No user with that id/)).toBeNull()
    expect(screen.getByText("alice@x.test")).toBeInTheDocument()
  })
})
