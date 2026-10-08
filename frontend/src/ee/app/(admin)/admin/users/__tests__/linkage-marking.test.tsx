/**
 * The Users page's linked-account marking: the flag, the decision chip and the
 * Signals pills on a clustered row; the toolbar and the cluster card; the
 * filters; pointing at a row; pinning a key; and blocking a cluster one
 * account at a time.
 *
 * The linkage hooks are stubbed — the wire shape and the server's rules are
 * the backend test's business. What is pinned here is the page's wiring of
 * them, and that the page is exactly its old self when the marks are not
 * there.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import userEvent from "@testing-library/user-event"
import type { AdminUser } from "@/ee/hooks/queries/use-admin-queries"
import type { AdminBlocks } from "@/ee/hooks/queries/use-admin-access"
import type { ClusterMembers, LinkageResponse } from "@/ee/components/admin/users-linkage/types"

const h = vi.hoisted(() => ({
  users: [] as AdminUser[],
  blocks: undefined as AdminBlocks | undefined,
  role: "admin",
  deploymentPayer: false,
  credits: true,
  linkage: undefined as LinkageResponse | undefined,
  members: undefined as ClusterMembers | undefined,
  askedIds: [] as readonly string[],
  askedKey: null as string | null,
  block: vi.fn(),
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
  // No `?user=` link in these tests: the direct-link row stays out of the way.
  useAdminUser: () => ({ data: null, isLoading: false, refetch: () => undefined }),
  useAdminChangeRoleMutation: () => ({ mutateAsync: async () => undefined }),
  useAdminUserTransactions: () => ({ data: [], isLoading: false }),
  useAdminUserSubscription: () => ({ data: undefined }),
  useAdminAdjustCreditsMutation: () => ({ mutateAsync: async () => undefined }),
  useAdminChangeTierMutation: () => ({ mutateAsync: async () => undefined }),
  useAdminChangeStorageMutation: () => ({ mutateAsync: async () => undefined }),
}))
vi.mock("@/ee/hooks/queries/use-admin-access", async (orig) => ({
  ...(await orig<typeof import("@/ee/hooks/queries/use-admin-access")>()),
  useAdminBlocks: () => ({ data: h.blocks }),
  useBlockUser: () => ({ mutateAsync: h.block, isPending: false }),
}))
vi.mock("@/ee/components/admin/users-linkage/use-users-linkage", () => ({
  // Honours `enabled` the way the real hook does: disabled means no data.
  useUsersLinkage: (ids: readonly string[], enabled: boolean) => {
    h.askedIds = ids
    return { data: enabled ? h.linkage : undefined, isLoading: false }
  },
  useClusterMembers: (key: string | null) => {
    h.askedKey = key
    return { data: key ? h.members : undefined, isLoading: false, isError: false, error: null }
  },
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
vi.mock("@/ee/components/admin/user-access/user-access-panel", () => ({
  UserAccessPanel: () => <div data-testid="access-panel" />,
}))
vi.mock("@/ee/components/admin/user-messages/user-messages-section", () => ({
  UserMessagesSection: () => null,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import AdminUsersPage from "../page"
import { AccessError } from "@/ee/hooks/queries/use-admin-access"

const VIEWER = "00000000-0000-4000-8000-0000000000f0"
const ALICE = "00000000-0000-4000-8000-0000000000f1"
const BOB = "00000000-0000-4000-8000-0000000000f2"
const CAROL = "00000000-0000-4000-8000-0000000000f3"
const DAVE = "00000000-0000-4000-8000-0000000000f4"
/** In the cluster, not on this page. */
const ERIN = "00000000-0000-4000-8000-0000000000f5"

const CLUSTER_KEY = "c1c1c1c1c1c1"
const DEV_SHARED = "d1d1d1d1d1d1"
const NET_SHARED = "e1e1e1e1e1e1"
const AT = "2026-10-08T13:45:00.000Z"

function makeUser(id: string, email: string, state: string): AdminUser {
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
    created_at: "2026-10-08T10:00:00.000Z",
    free_grant_state: state,
  }
}

function blocksFor(userIds: readonly string[]): AdminBlocks {
  return {
    ready: true,
    usersTruncated: false,
    networksTruncated: false,
    status: { ready: true, users: userIds.length, networks: 0, loadedAt: AT },
    users: userIds.map((userId) => ({ userId, email: null, reason: null, blockedBy: null, blockedAt: AT })),
    networks: [],
  }
}

function linkageFixture(): LinkageResponse {
  return {
    unavailable: false,
    partial: false,
    summary: { clusters: 1, accounts: 3, withheld: 2, granted: 1 },
    clusters: [
      {
        key: CLUSTER_KEY,
        id: 1,
        size: 3,
        unresolved: 0,
        tier: "small",
        firstSeenAt: "2026-10-08T05:30:00.000Z",
        lastSeenAt: AT,
        withheld: 2,
        granted: 1,
        keys: [
          { axis: "device", token: DEV_SHARED, count: 3 },
          { axis: "ip", token: NET_SHARED, count: 2 },
        ],
      },
    ],
    users: {
      [ALICE]: {
        clusterId: 1,
        signals: { device: { token: DEV_SHARED, count: 3 }, browser: { token: "b1b1b1b1b1b1", count: 1 }, ip: { token: NET_SHARED, count: 2 } },
        decision: "withheld",
        reasons: ["device_ip_match", "browser_match"],
        signalAt: AT,
      },
      [BOB]: {
        clusterId: 1,
        signals: { device: { token: DEV_SHARED, count: 3 }, browser: { token: "b2b2b2b2b2b2", count: 1 }, ip: { token: NET_SHARED, count: 2 } },
        decision: "withheld",
        reasons: ["device_ip_match"],
        signalAt: AT,
      },
      // Signals nobody shares: not flagged, but the opened row still shows them.
      [DAVE]: {
        clusterId: null,
        signals: { device: { token: "d4d4d4d4d4d4", count: 1 }, browser: { token: "b4b4b4b4b4b4", count: 1 }, ip: { token: "e4e4e4e4e4e4", count: 1 } },
        decision: "granted",
        reasons: [],
        signalAt: AT,
      },
    },
  }
}

function membersFixture(): ClusterMembers {
  return {
    key: CLUSTER_KEY,
    id: 1,
    size: 3,
    unresolved: 0,
    members: [
      { userId: ALICE, email: "alice@x.test", state: "withheld", role: "user" },
      { userId: BOB, email: "bob@x.test", state: "withheld", role: "user" },
      { userId: ERIN, email: "erin@x.test", state: "granted", role: "user" },
    ],
  }
}

const rowOf = (email: string) => screen.getByText(email).closest("tr")!
const ok = { blocked: true, signInBlocked: true, warning: null }

/** The page reads `?user=` from the router, so it mounts inside one. */
const mount = () =>
  render(
    <MemoryRouter>
      <AdminUsersPage />
    </MemoryRouter>,
  )

beforeEach(() => {
  h.users = [
    makeUser(ALICE, "alice@x.test", "withheld"),
    makeUser(BOB, "bob@x.test", "withheld"),
    makeUser(CAROL, "carol@x.test", "granted"),
    makeUser(DAVE, "dave@x.test", "granted"),
  ]
  h.blocks = blocksFor([])
  h.role = "admin"
  h.deploymentPayer = false
  h.credits = true
  h.linkage = linkageFixture()
  h.members = membersFixture()
  h.askedIds = []
  h.askedKey = null
  h.block.mockReset()
  h.block.mockResolvedValue(ok)
})

describe("marking the rows", () => {
  it("asks for the marks of exactly the rows on the page", () => {
    mount()
    expect(h.askedIds).toEqual([ALICE, BOB, CAROL, DAVE])
  })

  it("flags the clustered rows with their cluster number and the grant's state, and no other row", () => {
    mount()

    expect(within(rowOf("alice@x.test")).getByText("#1")).toBeInTheDocument()
    expect(within(rowOf("alice@x.test")).getByText("withheld")).toBeInTheDocument()
    expect(within(rowOf("bob@x.test")).getByText("#1")).toBeInTheDocument()
    expect(within(rowOf("carol@x.test")).queryByTestId("cluster-flag")).toBeNull()
    expect(within(rowOf("dave@x.test")).queryByTestId("cluster-flag")).toBeNull()
    expect(screen.getAllByTestId("cluster-flag")).toHaveLength(2)
  })

  it("adds the Signals column with the key pills on the flagged rows only, and the join time", () => {
    mount()

    expect(screen.getByRole("columnheader", { name: "Signals" })).toBeInTheDocument()
    expect(within(rowOf("alice@x.test")).getByTitle(`Device ${DEV_SHARED} · 3 accounts`)).toHaveTextContent("d1d1")
    expect(within(rowOf("dave@x.test")).queryByTitle(/^Device /)).toBeNull()
    expect(within(rowOf("carol@x.test")).getByText(/\d{1,2}:\d{2}/)).toBeInTheDocument()
  })

  it("shows the toolbar's summary and the legend", () => {
    mount()

    expect(screen.getByText("Linked-account clusters")).toBeInTheDocument()
    expect(screen.getByText("1 cluster · 3 accounts · 2 withheld · 1 granted")).toBeInTheDocument()
    expect(screen.getByText("≥10 accounts")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Cluster #1, 3 accounts" })).toBeInTheDocument()
  })
})

describe("the page unmarked", () => {
  const expectUnmarked = () => {
    expect(screen.queryByRole("columnheader", { name: "Signals" })).toBeNull()
    expect(screen.queryByText("Linked-account clusters")).toBeNull()
    expect(screen.queryAllByTestId("cluster-flag")).toHaveLength(0)
    expect(screen.getByText("alice@x.test")).toBeInTheDocument()
    // The Joined column is the date alone, as it always was.
    expect(within(rowOf("alice@x.test")).queryByText(/\d{1,2}:\d{2}/)).toBeNull()
  }

  it("is exactly its old self while the clusters function is not in the database", () => {
    h.linkage = { ...linkageFixture(), unavailable: true, clusters: [], users: {}, summary: { clusters: 0, accounts: 0, withheld: 0, granted: 0 } }
    mount()
    expectUnmarked()
  })

  it("and on an edition without credits", () => {
    h.credits = false
    mount()
    expectUnmarked()
  })

  it("and where one account pays for everyone", () => {
    h.deploymentPayer = true
    mount()
    expectUnmarked()
  })

})

describe("the filters", () => {
  it("Flagged only keeps the clustered rows, and lets go again", async () => {
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByRole("button", { name: "Flagged only" }))
    expect(screen.getByText("alice@x.test")).toBeInTheDocument()
    expect(screen.getByText("bob@x.test")).toBeInTheDocument()
    expect(screen.queryByText("carol@x.test")).toBeNull()
    expect(screen.queryByText("dave@x.test")).toBeNull()

    await user.click(screen.getByRole("button", { name: "Flagged only" }))
    expect(screen.getByText("carol@x.test")).toBeInTheDocument()
  })

  it("selecting a cluster filters to its members, opens its card and asks for its members by key; Show all users closes both", async () => {
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByRole("button", { name: "Cluster #1, 3 accounts" }))
    const card = screen.getByTestId("cluster-detail")
    expect(h.askedKey).toBe(CLUSTER_KEY)
    expect(within(card).getByText("3 linked accounts")).toBeInTheDocument()
    expect(within(card).getByText(/2 withheld · 1 granted · 2 on this page/)).toBeInTheDocument()
    expect(within(card).getByTitle(`Device ${DEV_SHARED} · 3 accounts`)).toBeInTheDocument()
    expect(screen.queryByText("carol@x.test")).toBeNull()

    await user.click(within(card).getByRole("button", { name: "Show all users" }))
    expect(screen.queryByTestId("cluster-detail")).toBeNull()
    expect(screen.getByText("carol@x.test")).toBeInTheDocument()
  })

  it("names the filter when flagged-only leaves nothing on the page", async () => {
    const user = userEvent.setup()
    h.linkage = { ...linkageFixture(), users: {} }
    mount()
    await user.click(screen.getByRole("button", { name: "Flagged only" }))
    expect(screen.getByText("No users match your filter.")).toBeInTheDocument()
  })
})

describe("pointing and pinning", () => {
  it("pointing at a flagged row names what the other clustered rows share with it and steps the rest back a little", async () => {
    const user = userEvent.setup()
    mount()

    await user.hover(rowOf("alice@x.test"))
    expect(within(rowOf("bob@x.test")).getByText("shares device + network")).toBeInTheDocument()
    expect(within(rowOf("alice@x.test")).queryByText(/^shares /)).toBeNull()
    expect(rowOf("carol@x.test")).toHaveStyle({ opacity: "0.75" })
    expect(rowOf("bob@x.test")).not.toHaveStyle({ opacity: "0.75" })

    await user.unhover(rowOf("alice@x.test"))
    expect(within(rowOf("bob@x.test")).queryByText("shares device + network")).toBeNull()
    expect(rowOf("carol@x.test")).not.toHaveStyle({ opacity: "0.75" })
  })

  it("clicking a key pill pins the key without opening the row, shows it in the toolbar, and lets go from there", async () => {
    const user = userEvent.setup()
    mount()

    await user.click(within(rowOf("alice@x.test")).getByTitle(`Device ${DEV_SHARED} · 3 accounts`))
    expect(screen.queryByTestId("signals-detail")).toBeNull()
    const pin = screen.getByRole("button", { name: `Unpin Device ${DEV_SHARED.slice(0, 8)}` })
    expect(pin).toBeInTheDocument()
    expect(within(rowOf("bob@x.test")).getByText("shares device")).toBeInTheDocument()

    await user.click(pin)
    expect(screen.queryByRole("button", { name: /^Unpin / })).toBeNull()
    expect(within(rowOf("bob@x.test")).queryByText("shares device")).toBeNull()
  })

  it("forgets the pin when the page turns", async () => {
    const user = userEvent.setup()
    h.users = Array.from({ length: 50 }, (_, i) => makeUser(`00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, `user${i + 1}@x.test`, "granted"))
    h.users = [makeUser(ALICE, "alice@x.test", "withheld"), ...h.users.slice(1)]
    mount()

    await user.click(within(rowOf("alice@x.test")).getByTitle(`Device ${DEV_SHARED} · 3 accounts`))
    expect(screen.getByRole("button", { name: /^Unpin / })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.queryByRole("button", { name: /^Unpin / })).toBeNull()
  })
})

describe("blocking a cluster", () => {
  const openCard = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Cluster #1, 3 accounts" }))
    return screen.getByTestId("cluster-detail")
  }
  const openPanel = async (user: ReturnType<typeof userEvent.setup>, label = "Block 3") => {
    const card = await openCard(user)
    await user.click(within(card).getByRole("button", { name: label }))
    return screen.getByTestId("block-cluster-panel")
  }
  const calledIds = () => h.block.mock.calls.map((c) => (c[0] as { userId: string }).userId)

  it("is a super admin's button, not an admin's", async () => {
    const user = userEvent.setup()
    const { unmount } = mount()
    const card = await openCard(user)
    expect(within(card).queryByRole("button", { name: /^Block/ })).toBeNull()
    unmount()

    h.role = "super_admin"
    mount()
    const card2 = await openCard(user)
    expect(within(card2).getByRole("button", { name: "Block 3" })).toBeInTheDocument()
  })

  it("lists every account by email, carries the cluster in the reason, and blocks them one after another in order", async () => {
    const user = userEvent.setup()
    h.role = "super_admin"
    // The second block must wait for the first: a deferred first call proves the sequence.
    let releaseFirst: () => void = () => undefined
    h.block.mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve(ok) }))
    mount()
    const panel = await openPanel(user)

    for (const email of ["alice@x.test", "bob@x.test", "erin@x.test"]) {
      expect(within(panel).getByText(email)).toBeInTheDocument()
    }
    expect(screen.getByLabelText("Block reason")).toHaveValue(
      "Linked-account cluster #1: 3 accounts sharing device d1d1d1d1 (3), network e1e1e1e1 (2)",
    )

    await user.click(within(panel).getByRole("button", { name: "Block 3 accounts" }))
    await waitFor(() => expect(h.block).toHaveBeenCalledTimes(1))
    expect(within(panel).getByText("Blocking 0 / 3…")).toBeInTheDocument()
    expect(within(panel).getByRole("button", { name: "Stop" })).toBeInTheDocument()
    releaseFirst()

    await waitFor(() => expect(h.block).toHaveBeenCalledTimes(3))
    expect(calledIds()).toEqual([ALICE, BOB, ERIN])
    expect((h.block.mock.calls[0]![0] as { reason: string }).reason).toContain("Linked-account cluster #1")
    expect(await within(panel).findByText("Blocked 3 accounts.")).toBeInTheDocument()
  })

  it("leaves out the already blocked and the admins, and says so", async () => {
    const user = userEvent.setup()
    h.role = "super_admin"
    h.blocks = blocksFor([BOB])
    h.members = { ...membersFixture(), members: [...membersFixture().members, { userId: VIEWER, email: "me@x.test", state: null, role: "super_admin" }] }
    mount()
    const panel = await openPanel(user, "Block 2")

    expect(within(panel).getByText("1 already blocked — skipped.")).toBeInTheDocument()
    expect(within(panel).getByText(/1 admin account skipped/)).toBeInTheDocument()
    expect(within(panel).queryByText("bob@x.test")).toBeNull()
    expect(within(panel).queryByText("me@x.test")).toBeNull()

    await user.click(within(panel).getByRole("button", { name: "Block 2 accounts" }))
    await waitFor(() => expect(h.block).toHaveBeenCalledTimes(2))
    expect(calledIds()).toEqual([ALICE, ERIN])
  })

  it("skips an account the server refuses and goes on; stops at any other failure and says who was blocked", async () => {
    const user = userEvent.setup()
    h.role = "super_admin"
    h.block.mockImplementation(async ({ userId }: { userId: string }) => {
      if (userId === ALICE) throw new AccessError("This account is a platform operator", 403, null)
      if (userId === ERIN) throw new Error("Service unavailable")
      return ok
    })
    mount()
    const panel = await openPanel(user)
    await user.click(within(panel).getByRole("button", { name: "Block 3 accounts" }))

    expect(await within(panel).findByText("Stopped at erin@x.test: Service unavailable. 1 account blocked before it.")).toBeInTheDocument()
    expect(within(panel).getByText("Skipped alice@x.test (This account is a platform operator)")).toBeInTheDocument()
    expect(calledIds()).toEqual([ALICE, BOB, ERIN])
    expect(within(panel).queryByRole("button", { name: "Block 3 accounts" })).toBeNull()
  })

  it("Stop ends the run after the request in flight", async () => {
    const user = userEvent.setup()
    h.role = "super_admin"
    let releaseFirst: () => void = () => undefined
    h.block.mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve(ok) }))
    mount()
    const panel = await openPanel(user)

    await user.click(within(panel).getByRole("button", { name: "Block 3 accounts" }))
    await waitFor(() => expect(h.block).toHaveBeenCalledTimes(1))
    await user.click(within(panel).getByRole("button", { name: "Stop" }))
    releaseFirst()

    expect(await within(panel).findByText("Stopped. 1 account blocked.")).toBeInTheDocument()
    expect(h.block).toHaveBeenCalledTimes(1)
  })
})

describe("opening a row", () => {
  it("shows a flagged account's three keys, who shares them, and the gate's decision", async () => {
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByText("alice@x.test"))
    const detail = screen.getByTestId("signals-detail")
    expect(within(detail).getByText(DEV_SHARED)).toBeInTheDocument()
    expect(within(detail).getByText("shared with 2 other accounts")).toBeInTheDocument()
    expect(within(detail).getByText("unique in system")).toBeInTheDocument()
    expect(within(detail).getByText("device_ip_match")).toBeInTheDocument()
    expect(within(detail).getByText(/^Free credits withheld at signup/)).toHaveTextContent("cluster #1")
  })

  it("shows an unflagged account's unique keys too, and nothing for an account without signals", async () => {
    const user = userEvent.setup()
    mount()

    await user.click(screen.getByText("dave@x.test"))
    expect(within(screen.getByTestId("signals-detail")).getAllByText("unique in system")).toHaveLength(3)

    await user.click(screen.getByText("carol@x.test"))
    expect(screen.queryByTestId("signals-detail")).toBeNull()
  })

  it("will not call a lone key unique after a partial walk", async () => {
    const user = userEvent.setup()
    h.linkage = { ...linkageFixture(), partial: true }
    mount()

    await user.click(screen.getByText("dave@x.test"))
    expect(within(screen.getByTestId("signals-detail")).getAllByText("not checked (too many clusters)")).toHaveLength(3)
    expect(screen.getByText("(newest clusters only)")).toBeInTheDocument()
  })
})
