/**
 * The Access card in a user's expanded admin row.
 *
 * What an admin relies on here: the badge tells the truth about the account,
 * a block sends exactly what was typed, taking the free credits back is a
 * SEPARATE request that only follows a block that went through (and only when
 * free credits exist on this deployment), every refusal is shown in the
 * server's own words, and a network can only be blocked when the server said
 * this admin may.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => ({ getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })) }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: h.getAuthHeaders }))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { toast } from "sonner"
import type { AdminUser } from "@/ee/hooks/queries/use-admin-queries"
import type { AdminUserAccess, AdminUserNetwork } from "@/ee/hooks/queries/use-admin-access"
import { UserAccessPanel } from "../user-access-panel"

const USER_ID = "00000000-0000-4000-8000-0000000000a1"
const ACCESS = `GET /v1/admin/users/${USER_ID}/access`
const BLOCK = `POST /v1/admin/users/${USER_ID}/block`
const UNBLOCK = `POST /v1/admin/users/${USER_ID}/unblock`
const REVOKE = `POST /v1/admin/free-grants/${USER_ID}/revoke`
const BLOCK_NETWORK = "POST /v1/admin/access/networks"

const BLOCKED_AT = "2026-10-01T12:00:00.000Z"
const SIGNUP_AT = "2026-09-01T10:00:00.000Z"
const EXPIRES_AT = "2026-11-04T10:00:00.000Z"

function makeUser(over: Partial<AdminUser> = {}): AdminUser {
  return {
    id: USER_ID,
    email: "person@x.test",
    full_name: null,
    subscription_tier: "free",
    subscription_credits: 1500,
    topup_credits: 0,
    daily_spent_credits: 0,
    storage_used_bytes: 0,
    storage_limit_bytes: 1024 * 1024 * 1024,
    role: "user",
    created_at: SIGNUP_AT,
    free_grant_state: "granted",
    ...over,
  }
}

function makeNetwork(over: Partial<AdminUserNetwork> = {}): AdminUserNetwork {
  return {
    token: "nt_7f3a9c",
    blockable: true,
    signupAt: SIGNUP_AT,
    otherAccounts: 2,
    payingAccounts: 0,
    needsSuperAdmin: false,
    blocked: false,
    ...over,
  }
}

function makeAccess(over: Partial<AdminUserAccess> = {}): AdminUserAccess {
  return {
    ready: true,
    blocked: false,
    reason: null,
    blockedAt: null,
    signInBlocked: false,
    signInBanIsOurs: null,
    network: null,
    ...over,
  }
}

const BLOCKED: Partial<AdminUserAccess> = {
  blocked: true,
  reason: "Card testing",
  blockedAt: BLOCKED_AT,
  signInBlocked: true,
  signInBanIsOurs: true,
}

interface Reply {
  readonly status?: number
  readonly body: unknown
}
type Route = () => Reply | Promise<Reply>

/** `${METHOD} ${url}` → what the server answers. Reset in `beforeEach`. */
let routes: Record<string, Route> = {}
/** What GET …/access answers; a route may change it to model the server's state moving. */
let accessBody: AdminUserAccess = makeAccess()

const fetchMock = vi.fn(async (...call: [url: string, init?: RequestInit]) => {
  const [url, init] = call
  const key = `${init?.method ?? "GET"} ${url}`
  const route = routes[key]
  if (!route) throw new Error(`unexpected fetch: ${key}`)
  const reply = await route()
  const status = reply.status ?? 200
  return { ok: status < 400, status, json: async () => reply.body } as unknown as Response
})

interface SentCall {
  readonly key: string
  readonly body: unknown
  readonly headers: unknown
}

function sent(): SentCall[] {
  return fetchMock.mock.calls.map(([url, init]) => ({
    key: `${init?.method ?? "GET"} ${url}`,
    body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    headers: init?.headers,
  }))
}

const sentTo = (key: string) => sent().filter((c) => c.key === key)

function refusal(message: string, status = 409): Reply {
  return { status, body: { error: { code: "refused", message } } }
}

function renderPanel(props: { user?: AdminUser; isSuperAdmin?: boolean; showFreeCredits?: boolean } = {}) {
  const onChanged = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <UserAccessPanel
        user={props.user ?? makeUser()}
        isSuperAdmin={props.isSuperAdmin ?? false}
        showFreeCredits={props.showFreeCredits ?? true}
        onChanged={onChanged}
      />
    </QueryClientProvider>,
  )
  return { onChanged }
}

/** Opens the block composer once the account has loaded. */
async function openComposer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Block account…" }))
}

const submitBlock = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Block account" }))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  accessBody = makeAccess()
  routes = {
    [ACCESS]: () => ({ body: { data: accessBody } }),
    [BLOCK]: () => {
      accessBody = makeAccess({ ...BLOCKED, reason: null })
      return { body: { data: { userId: USER_ID, blocked: true, signInBlocked: true, warning: null } } }
    },
    [UNBLOCK]: () => {
      accessBody = makeAccess()
      return { body: { data: { userId: USER_ID, blocked: false, signInBlocked: false, warning: null } } }
    },
    [REVOKE]: () => ({ body: { data: { userId: USER_ID, state: "revoked", credits: 1200 } } }),
    [BLOCK_NETWORK]: () => ({ body: { data: { id: "net-1", range: null, token: "nt_7f3a9c", expiresAt: EXPIRES_AT } } }),
  }
})

describe("account state", () => {
  it("shows a loading line until the account is read, then Active", async () => {
    let release: (() => void) | null = null
    routes[ACCESS] = () =>
      new Promise<Reply>((resolve) => {
        release = () => resolve({ body: { data: makeAccess() } })
      })
    renderPanel()

    expect(screen.getByText("Loading access…")).toBeInTheDocument()
    // Nothing to act on before the server has said what the account is.
    expect(screen.queryByRole("button", { name: "Block account…" })).toBeNull()

    await waitFor(() => expect(release).not.toBeNull())
    release!()
    expect(await screen.findByText("Active")).toBeInTheDocument()
    expect(screen.queryByText("Loading access…")).toBeNull()
    expect(screen.queryByText("Blocked")).toBeNull()
    expect(screen.getByRole("button", { name: "Block account…" })).toBeEnabled()
  })

  it("shows Blocked with the date and reason, and offers Unblock instead of Block", async () => {
    accessBody = makeAccess(BLOCKED)
    renderPanel()

    expect(await screen.findByText("Blocked")).toBeInTheDocument()
    expect(screen.queryByText("Active")).toBeNull()
    expect(
      screen.getByText(`Blocked since ${new Date(BLOCKED_AT).toLocaleDateString()} — Card testing`),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Unblock" })).toBeEnabled()
    expect(screen.queryByRole("button", { name: "Block account…" })).toBeNull()
    // Sign-in IS blocked, so there is nothing to retry.
    expect(screen.queryByText(/Sign-in is not blocked yet/)).toBeNull()
    expect(screen.queryByRole("button", { name: "Block again" })).toBeNull()
  })

  it("unblocks with one press and tells the page to refresh", async () => {
    const user = userEvent.setup()
    accessBody = makeAccess(BLOCKED)
    const { onChanged } = renderPanel()

    await user.click(await screen.findByRole("button", { name: "Unblock" }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(sentTo(UNBLOCK)).toHaveLength(1)
    expect(toast.success).toHaveBeenCalledWith("Account unblocked")
    // The panel re-reads the account rather than assuming.
    expect(await screen.findByText("Active")).toBeInTheDocument()
  })

  it("flags a block whose sign-in step did not land, and Block again retries it", async () => {
    const user = userEvent.setup()
    accessBody = makeAccess({ ...BLOCKED, signInBlocked: false })
    // Already taken back, so the retry is about sign-in only.
    const { onChanged } = renderPanel({ user: makeUser({ free_grant_state: "revoked" }) })

    expect(await screen.findByText("Sign-in is not blocked yet. Press Block again to retry.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Block again" }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(sentTo(BLOCK)).toHaveLength(1)
    expect(sentTo(REVOKE)).toHaveLength(0)
  })

  // "Block again" finishes a sign-in step that failed. It is not a second
  // decision: it must not take credits back (the box defaults to checked and is
  // never shown here) and must not erase the first admin's reason.
  it("Block again repeats the block with its reason and never takes credits back", async () => {
    const user = userEvent.setup()
    accessBody = makeAccess({ ...BLOCKED, signInBlocked: false })
    const { onChanged } = renderPanel({ user: makeUser({ free_grant_state: "granted" }) })

    await user.click(await screen.findByRole("button", { name: "Block again" }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(sentTo(BLOCK).map((c) => c.body)).toEqual([{ reason: "Card testing" }])
    expect(sentTo(REVOKE)).toHaveLength(0)
    expect(toast.success).toHaveBeenCalledWith("Sign-in blocked")
  })

  it("Block again waits for the block tables like every other block button", async () => {
    accessBody = makeAccess({ ...BLOCKED, signInBlocked: false, ready: false })
    renderPanel()
    expect(await screen.findByRole("button", { name: "Block again" })).toBeDisabled()
  })

  it("an access read that fails shows neither Active nor Blocked, offers nothing to press, and can be retried", async () => {
    const user = userEvent.setup()
    routes[ACCESS] = () => ({ status: 500, body: { error: { code: "internal_error", message: "boom" } } })
    renderPanel({ isSuperAdmin: true })

    expect(await screen.findByText("Could not read whether this account is blocked.")).toBeInTheDocument()
    expect(screen.queryByText("Active")).toBeNull()
    expect(screen.queryByText("Blocked")).toBeNull()
    expect(screen.queryByRole("button", { name: "Block account…" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Block network" })).toBeNull()
    expect(screen.queryByText("No signup network recorded.")).toBeNull()

    accessBody = makeAccess(BLOCKED)
    routes[ACCESS] = () => ({ body: { data: accessBody } })
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("Blocked")).toBeInTheDocument()
  })

  it("cannot block before the database has the block tables", async () => {
    accessBody = makeAccess({ ready: false, network: makeNetwork() })
    renderPanel({ isSuperAdmin: true })

    expect(await screen.findByText("Blocking becomes available after the next production release.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Block account…" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Block network" })).toBeDisabled()
  })
})

describe("blocking an account", () => {
  it("sends the trimmed reason, then takes the free credits back in a second request", async () => {
    const user = userEvent.setup()
    const { onChanged } = renderPanel({ user: makeUser({ free_grant_state: "granted" }) })

    await openComposer(user)
    const box = screen.getByRole("checkbox", { name: "Also take back the free credits" })
    expect(box).toBeChecked()
    await user.type(screen.getByPlaceholderText("Reason (optional, for other admins)"), "  Card testing  ")
    await submitBlock(user)

    await waitFor(() => expect(sentTo(REVOKE)).toHaveLength(1))
    const blocks = sentTo(BLOCK)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].body).toEqual({ reason: "Card testing" })
    expect(blocks[0].headers).toMatchObject({ Authorization: "Bearer t", "Content-Type": "application/json" })
    // Blocking never moves money itself: the take-back is its own request, after the block.
    const order = sent()
      .map((c) => c.key)
      .filter((k) => k === BLOCK || k === REVOKE)
    expect(order).toEqual([BLOCK, REVOKE])

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith("Account blocked")
    expect(toast.success).toHaveBeenCalledWith(`Took back ${(1200).toLocaleString()} free credits`)
    // The account is re-read, so the badge follows the server.
    expect(await screen.findByText("Blocked")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Block account" })).toBeNull()
  })

  it("leaves the free credits alone when the box is unchecked, and sends no reason when none was typed", async () => {
    const user = userEvent.setup()
    const { onChanged } = renderPanel({ user: makeUser({ free_grant_state: "granted" }) })

    await openComposer(user)
    const box = screen.getByRole("checkbox", { name: "Also take back the free credits" })
    await user.click(box)
    expect(box).not.toBeChecked()
    await submitBlock(user)

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(sentTo(BLOCK)).toHaveLength(1)
    expect(sentTo(BLOCK)[0].body).toEqual({})
    expect(sentTo(REVOKE)).toHaveLength(0)
    expect(toast.success).toHaveBeenCalledWith("Account blocked")
  })

  it("shows the server's refusal word for word and takes nothing back", async () => {
    const user = userEvent.setup()
    routes[BLOCK] = () => refusal("Admins cannot be blocked. Change the role first.", 403)
    const { onChanged } = renderPanel({ user: makeUser({ free_grant_state: "granted" }) })

    await openComposer(user)
    await user.type(screen.getByPlaceholderText("Reason (optional, for other admins)"), "spam")
    await submitBlock(user)

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Admins cannot be blocked. Change the role first."))
    expect(sentTo(REVOKE)).toHaveLength(0)
    expect(onChanged).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    // The composer stays open with what was typed, and the account still reads Active.
    expect(screen.getByPlaceholderText("Reason (optional, for other admins)")).toHaveValue("spam")
    expect(screen.getByText("Active")).toBeInTheDocument()
  })

  it("still counts the block when only the take-back is refused, and says why", async () => {
    const user = userEvent.setup()
    routes[REVOKE] = () => refusal("This is (or was) a paying account — use Adjust credits instead.")
    const { onChanged } = renderPanel({ user: makeUser({ free_grant_state: "granted" }) })

    await openComposer(user)
    await submitBlock(user)

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This is (or was) a paying account — use Adjust credits instead."),
    )
    expect(toast.success).toHaveBeenCalledWith("Account blocked")
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
  })

  it("warns instead of confirming when the block landed but sign-in could not be blocked", async () => {
    const user = userEvent.setup()
    const warning = "The account is blocked, but blocking its sign-in failed. Press Block again to retry."
    routes[BLOCK] = () => ({ body: { data: { userId: USER_ID, blocked: true, signInBlocked: false, warning } } })
    renderPanel({ user: makeUser({ free_grant_state: "revoked" }) })

    await openComposer(user)
    await submitBlock(user)

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(warning))
    expect(toast.success).not.toHaveBeenCalledWith("Account blocked")
  })

  it("warns about a paid plan before blocking it", async () => {
    const user = userEvent.setup()
    renderPanel({ user: makeUser({ subscription_tier: "pro" }) })
    await openComposer(user)
    expect(
      screen.getByText("This account has a paid plan. Blocking does not cancel its subscription."),
    ).toBeInTheDocument()
  })

  it("does not warn about a subscription on a free account", async () => {
    const user = userEvent.setup()
    renderPanel({ user: makeUser({ subscription_tier: "free" }) })
    await openComposer(user)
    expect(screen.queryByText(/This account has a paid plan/)).toBeNull()
  })

  it("Cancel closes the composer without sending anything", async () => {
    const user = userEvent.setup()
    renderPanel()
    await openComposer(user)
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(screen.getByRole("button", { name: "Block account…" })).toBeInTheDocument()
    expect(sentTo(BLOCK)).toHaveLength(0)
  })
})

describe("free credits", () => {
  it("shows the grant state and its action where free credits exist", async () => {
    renderPanel({ user: makeUser({ free_grant_state: "granted" }) })
    expect(await screen.findByText("Free credits")).toBeInTheDocument()
    expect(screen.getByText("Given")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Take back free credits" })).toBeInTheDocument()
  })

  it("offers a restore once they were taken back, and no take-back checkbox in the composer", async () => {
    const user = userEvent.setup()
    renderPanel({ user: makeUser({ free_grant_state: "revoked" }) })
    expect(await screen.findByText("Taken back by an admin")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Restore free credits" })).toBeInTheDocument()

    await openComposer(user)
    expect(screen.queryByRole("checkbox", { name: "Also take back the free credits" })).toBeNull()
  })

  it("hides the section, the checkbox, and sends no take-back where free credits do not exist", async () => {
    const user = userEvent.setup()
    const { onChanged } = renderPanel({ user: makeUser({ free_grant_state: "granted" }), showFreeCredits: false })

    await screen.findByText("Active")
    expect(screen.queryByText("Free credits")).toBeNull()
    expect(screen.queryByRole("button", { name: "Take back free credits" })).toBeNull()

    await openComposer(user)
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByText("Also take back the free credits")).toBeNull()

    await submitBlock(user)
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(sentTo(BLOCK)).toHaveLength(1)
    expect(sentTo(REVOKE)).toHaveLength(0)
  })
})

describe("signup network", () => {
  it("says so when no signup network was recorded", async () => {
    renderPanel({ isSuperAdmin: true })
    expect(await screen.findByText("No signup network recorded.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Block network" })).toBeNull()
  })

  it("shows the token and how many other accounts a block would reach", async () => {
    accessBody = makeAccess({ network: makeNetwork({ otherAccounts: 3, payingAccounts: 1 }) })
    renderPanel()
    expect(await screen.findByText("nt_7f3a9c")).toBeInTheDocument()
    expect(screen.getByText(/3 other accounts signed up from it \(1 paying\)/)).toBeInTheDocument()
  })

  it("cannot block a network whose address was never really read", async () => {
    accessBody = makeAccess({ network: makeNetwork({ blockable: false }) })
    renderPanel({ isSuperAdmin: true })
    expect(
      await screen.findByText(
        "Recorded before real addresses were read, or the address was unknown — it cannot be blocked.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Block network" })).toBeNull()
  })

  it("leaves a busy network to a super admin", async () => {
    accessBody = makeAccess({ network: makeNetwork({ needsSuperAdmin: true, otherAccounts: 40 }) })
    renderPanel({ isSuperAdmin: false })
    expect(
      await screen.findByText(
        "Many accounts or a paying account signed up here — only a super admin can block this network.",
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Block network" })).toBeNull()
  })

  it("lets a super admin block a busy network for the default 30 days", async () => {
    const user = userEvent.setup()
    accessBody = makeAccess({ network: makeNetwork({ needsSuperAdmin: true, otherAccounts: 40 }) })
    renderPanel({ isSuperAdmin: true })

    const button = await screen.findByRole("button", { name: "Block network" })
    expect(screen.queryByText(/only a super admin can block this network/)).toBeNull()
    await user.click(button)

    await waitFor(() => expect(sentTo(BLOCK_NETWORK)).toHaveLength(1))
    expect(sentTo(BLOCK_NETWORK)[0].body).toEqual({ userId: USER_ID, days: 30 })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        `Network blocked until ${new Date(EXPIRES_AT).toLocaleDateString()}`,
      ),
    )
  })

  it("sends the duration the admin picked", async () => {
    const user = userEvent.setup()
    accessBody = makeAccess({ network: makeNetwork() })
    renderPanel()

    await user.click(await screen.findByRole("combobox", { name: "Block duration" }))
    await user.click(await screen.findByRole("option", { name: "7 days" }))
    await user.click(screen.getByRole("button", { name: "Block network" }))

    await waitFor(() => expect(sentTo(BLOCK_NETWORK)).toHaveLength(1))
    expect(sentTo(BLOCK_NETWORK)[0].body).toEqual({ userId: USER_ID, days: 7 })
  })

  it("shows a network refusal word for word", async () => {
    const user = userEvent.setup()
    const message = "Many accounts, or a paying account, signed up from this network — only a super admin can block it."
    routes[BLOCK_NETWORK] = () => refusal(message, 403)
    accessBody = makeAccess({ network: makeNetwork() })
    renderPanel()

    await user.click(await screen.findByRole("button", { name: "Block network" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("shows an already-blocked network as Blocked, with nothing to press", async () => {
    accessBody = makeAccess({ network: makeNetwork({ blocked: true }) })
    renderPanel({ isSuperAdmin: true })
    // The account itself is active; only its network is blocked.
    expect(await screen.findByText("Active")).toBeInTheDocument()
    expect(screen.getByText("Blocked")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Block network" })).toBeNull()
  })
})
