/**
 * The Blocks page: every blocked account and network in one place, the undo
 * beside each, and the form to block an address or range by hand.
 *
 * What an admin relies on: a signup network is shown by its token (the server
 * never sends the address), the undo hits exactly the row it sits on, the form
 * sends what was typed and nothing else, and a refusal is shown as written.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => ({
  getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })),
  admin: true,
}))
vi.mock("@/lib/api", () => ({ getAuthHeaders: h.getAuthHeaders }))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => h.admin,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { toast } from "sonner"
import type {
  AdminBlockedNetwork,
  AdminBlockedUser,
  AdminBlocks,
  AdminWhoami,
} from "@/ee/hooks/queries/use-admin-access"
import AdminBlocksPage from "../page"

const SPAMMER: AdminBlockedUser = {
  userId: "00000000-0000-4000-8000-0000000000c1",
  email: "spammer@x.test",
  reason: "Card testing",
  blockedBy: "admin@nodaro.test",
  blockedAt: "2026-10-01T12:00:00.000Z",
}

/** A range an admin typed. */
const TYPED_RANGE: AdminBlockedNetwork = {
  id: "00000000-0000-4000-8000-0000000000d1",
  range: "198.51.100.0/24",
  token: null,
  label: "Botnet",
  fromUser: null,
  blockedBy: "admin@nodaro.test",
  blockedAt: "2026-10-02T08:00:00.000Z",
  expiresAt: "2026-11-01T08:00:00.000Z",
  // A range is a super admin's to place, and to lift.
  superAdminOnly: true,
}

/** A network blocked from an account's row: token only, no address. */
const SIGNUP_NETWORK: AdminBlockedNetwork = {
  id: "00000000-0000-4000-8000-0000000000d2",
  range: null,
  token: "nt_7f3a9c",
  label: null,
  fromUser: "spammer@x.test",
  blockedBy: "owner@nodaro.test",
  blockedAt: "2026-10-03T08:00:00.000Z",
  expiresAt: "2026-10-10T08:00:00.000Z",
  superAdminOnly: false,
}

const LOADED_AT = "2026-10-05T09:00:00.000Z"
const NEW_EXPIRES_AT = "2026-11-04T10:00:00.000Z"

const BLOCKS = "GET /v1/admin/access/blocks"
const WHOAMI = "GET /v1/admin/access/whoami"
const UNBLOCK = `POST /v1/admin/users/${SPAMMER.userId}/unblock`
const LIFT_RANGE = `DELETE /v1/admin/access/networks/${TYPED_RANGE.id}`
const LIFT_SIGNUP = `DELETE /v1/admin/access/networks/${SIGNUP_NETWORK.id}`
const BLOCK_NETWORK = "POST /v1/admin/access/networks"

function makeBlocks(over: Partial<AdminBlocks> = {}): AdminBlocks {
  return {
    ready: true,
    status: { ready: true, users: 1, networks: 2, loadedAt: LOADED_AT },
    users: [SPAMMER],
    networks: [TYPED_RANGE, SIGNUP_NETWORK],
    usersTruncated: false,
    networksTruncated: false,
    ...over,
  }
}

interface Reply {
  readonly status?: number
  readonly body: unknown
}
type Route = () => Reply | Promise<Reply>

let routes: Record<string, Route> = {}
/** What GET …/blocks answers; mutation routes change it, as the server would. */
let blocksBody: AdminBlocks = makeBlocks()
let whoamiBody: AdminWhoami = {
  address: "192.0.2.10",
  source: "edge-header",
  network: "192.0.2.0/24",
  networkToken: "nt_me",
}

const fetchMock = vi.fn(async (...call: [url: string, init?: RequestInit]) => {
  const [url, init] = call
  const key = `${init?.method ?? "GET"} ${url}`
  const route = routes[key]
  if (!route) throw new Error(`unexpected fetch: ${key}`)
  const reply = await route()
  const status = reply.status ?? 200
  return { ok: status < 400, status, json: async () => reply.body } as unknown as Response
})

function sentTo(key: string): Array<{ readonly body: unknown }> {
  return fetchMock.mock.calls
    .filter(([url, init]) => `${init?.method ?? "GET"} ${url}` === key)
    .map(([, init]) => ({ body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) }))
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AdminBlocksPage />
    </QueryClientProvider>,
  )
}

const addressInput = () => screen.getByRole("textbox", { name: "Address or range to block" })
const noteInput = () => screen.getByRole("textbox", { name: "Note for other admins" })
const blockNetworkButton = () => screen.getByRole("button", { name: "Block network" })
const rowOf = (text: string) => screen.getByText(text).closest("tr")!

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  h.admin = true
  blocksBody = makeBlocks()
  whoamiBody = { address: "192.0.2.10", source: "edge-header", network: "192.0.2.0/24", networkToken: "nt_me" }
  routes = {
    [BLOCKS]: () => ({ body: { data: blocksBody } }),
    [WHOAMI]: () => ({ body: { data: whoamiBody } }),
    [UNBLOCK]: () => {
      blocksBody = { ...blocksBody, users: blocksBody.users.filter((u) => u.userId !== SPAMMER.userId) }
      return { body: { data: { userId: SPAMMER.userId, blocked: false, signInBlocked: false, warning: null } } }
    },
    [LIFT_RANGE]: () => {
      blocksBody = { ...blocksBody, networks: blocksBody.networks.filter((n) => n.id !== TYPED_RANGE.id) }
      return { body: { data: { id: TYPED_RANGE.id } } }
    },
    [LIFT_SIGNUP]: () => ({ body: { data: { id: SIGNUP_NETWORK.id } } }),
    [BLOCK_NETWORK]: () => ({
      body: { data: { id: "00000000-0000-4000-8000-0000000000d9", range: "203.0.113.0/24", token: null, expiresAt: NEW_EXPIRES_AT } },
    }),
  }
})

describe("what is blocked", () => {
  it("lists blocked accounts, and networks by range or by signup token", async () => {
    renderPage()

    expect(await screen.findByText("Blocked accounts (1)")).toBeInTheDocument()
    expect(screen.getByText("Blocked networks (2)")).toBeInTheDocument()

    const account = rowOf("spammer@x.test")
    expect(within(account).getByText(SPAMMER.userId)).toBeInTheDocument()
    expect(within(account).getByText("Card testing")).toBeInTheDocument()
    expect(within(account).getByText("admin@nodaro.test")).toBeInTheDocument()

    const typed = rowOf("198.51.100.0/24")
    expect(within(typed).getByText("Botnet")).toBeInTheDocument()
    expect(within(typed).getByText(new Date(TYPED_RANGE.expiresAt).toLocaleDateString())).toBeInTheDocument()
    expect(within(typed).queryByText(/Signup network of/)).toBeNull()

    // A signup network has no address on the wire — its token stands in, with whose it was.
    const signup = rowOf("nt_7f3a9c")
    expect(within(signup).getByText("Signup network of spammer@x.test")).toBeInTheDocument()
    expect(within(signup).getByText("owner@nodaro.test")).toBeInTheDocument()

    // Which blocks only a super admin may lift, before anyone presses Lift.
    expect(within(typed).getByText("Super admin")).toBeInTheDocument()
    expect(within(signup).queryByText("Super admin")).toBeNull()
    expect(screen.queryByText("Showing the newest 500.")).toBeNull()
  })

  it("says when a list holds only the newest 500", async () => {
    blocksBody = makeBlocks({ usersTruncated: true, networksTruncated: true })
    renderPage()
    expect(await screen.findAllByText("Showing the newest 500.")).toHaveLength(2)
  })

  it("says what this server is enforcing right now, from its own snapshot rather than the list", async () => {
    // The snapshot can lag or lead the list by up to 30 seconds; the line reports the snapshot.
    blocksBody = makeBlocks({ status: { ready: true, users: 3, networks: 4, loadedAt: LOADED_AT } })
    renderPage()
    expect(
      await screen.findByText(
        `In force on this server: 3 accounts and 4 networks, read ${new Date(LOADED_AT).toLocaleString()}.`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByText("Blocked accounts (1)")).toBeInTheDocument()
  })

  it("counts one of each in the singular", async () => {
    blocksBody = makeBlocks({ status: { ready: true, users: 1, networks: 1, loadedAt: LOADED_AT } })
    renderPage()
    expect(
      await screen.findByText(
        `In force on this server: 1 account and 1 network, read ${new Date(LOADED_AT).toLocaleString()}.`,
      ),
    ).toBeInTheDocument()
  })

  it("says so when nothing is blocked", async () => {
    blocksBody = makeBlocks({ users: [], networks: [], status: { ready: true, users: 0, networks: 0, loadedAt: LOADED_AT } })
    renderPage()
    expect(await screen.findByText("No blocked accounts.")).toBeInTheDocument()
    expect(screen.getByText("No blocked networks.")).toBeInTheDocument()
  })

  it("shows why the list could not be read", async () => {
    routes[BLOCKS] = () => ({ status: 403, body: { error: { code: "forbidden", message: "Admin access required." } } })
    renderPage()
    expect(await screen.findByText("Admin access required.")).toBeInTheDocument()
    expect(screen.queryByText(/Blocked accounts/)).toBeNull()
  })

  it("renders nothing and asks for nothing on a build without the admin panel", async () => {
    h.admin = false
    const { container } = renderPage()
    expect(container).toBeEmptyDOMElement()
    // Give a disabled query every chance to fire anyway.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("undoing a block", () => {
  it("Unblock posts to that account's route, confirms, and the list is re-read", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("spammer@x.test")
    await user.click(within(rowOf("spammer@x.test")).getByRole("button", { name: "Unblock" }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Unblocked spammer@x.test"))
    expect(sentTo(UNBLOCK)).toHaveLength(1)
    expect(await screen.findByText("Blocked accounts (0)")).toBeInTheDocument()
    expect(screen.queryByText("spammer@x.test")).toBeNull()
  })

  it("passes on the server's warning when sign-in could not be restored", async () => {
    const user = userEvent.setup()
    const warning = "The account is unblocked, but lifting its sign-in block failed. Press Unblock again to retry."
    routes[UNBLOCK] = () => ({ body: { data: { userId: SPAMMER.userId, blocked: false, signInBlocked: true, warning } } })
    renderPage()

    await screen.findByText("spammer@x.test")
    await user.click(within(rowOf("spammer@x.test")).getByRole("button", { name: "Unblock" }))

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(warning))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("Lift deletes that network block and no other", async () => {
    const user = userEvent.setup()
    renderPage()

    await screen.findByText("198.51.100.0/24")
    await user.click(within(rowOf("198.51.100.0/24")).getByRole("button", { name: "Lift" }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Network block lifted"))
    expect(sentTo(LIFT_RANGE)).toHaveLength(1)
    expect(sentTo(LIFT_RANGE)[0].body).toBeUndefined()
    expect(sentTo(LIFT_SIGNUP)).toHaveLength(0)
    await waitFor(() => expect(screen.queryByText("198.51.100.0/24")).toBeNull())
    expect(screen.getByText("nt_7f3a9c")).toBeInTheDocument()
  })
})

describe("blocking an address or range by hand", () => {
  it("keeps Block network disabled until an address is typed", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Blocked networks (2)")

    expect(blockNetworkButton()).toBeDisabled()
    await user.type(addressInput(), "   ")
    expect(blockNetworkButton()).toBeDisabled()
    await user.type(addressInput(), "203.0.113.7")
    expect(blockNetworkButton()).toBeEnabled()
  })

  it("sends the address, the note and the default 30 days, clears the form, and lists the new block", async () => {
    const user = userEvent.setup()
    routes[BLOCK_NETWORK] = () => {
      blocksBody = {
        ...blocksBody,
        networks: [
          {
            id: "00000000-0000-4000-8000-0000000000d9",
            range: "203.0.113.0/24",
            token: null,
            label: "Signup burst",
            fromUser: null,
            blockedBy: "admin@nodaro.test",
            blockedAt: "2026-10-05T10:00:00.000Z",
            expiresAt: NEW_EXPIRES_AT,
            superAdminOnly: true,
          },
          ...blocksBody.networks,
        ],
      }
      return {
        body: { data: { id: "00000000-0000-4000-8000-0000000000d9", range: "203.0.113.0/24", token: null, expiresAt: NEW_EXPIRES_AT } },
      }
    }
    renderPage()
    await screen.findByText("Blocked networks (2)")

    await user.type(addressInput(), "203.0.113.0/24")
    await user.type(noteInput(), "Signup burst")
    await user.click(blockNetworkButton())

    await waitFor(() => expect(sentTo(BLOCK_NETWORK)).toHaveLength(1))
    expect(sentTo(BLOCK_NETWORK)[0].body).toEqual({ address: "203.0.113.0/24", label: "Signup burst", days: 30 })
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        `Blocked 203.0.113.0/24 until ${new Date(NEW_EXPIRES_AT).toLocaleDateString()}`,
      ),
    )
    expect(addressInput()).toHaveValue("")
    expect(noteInput()).toHaveValue("")
    expect(await screen.findByText("Blocked networks (3)")).toBeInTheDocument()
    expect(within(rowOf("203.0.113.0/24")).getByText("Signup burst")).toBeInTheDocument()
  })

  it("trims the address and sends no note when none was written", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Blocked networks (2)")

    await user.type(addressInput(), "  203.0.113.7  ")
    await user.type(noteInput(), "   ")
    await user.click(blockNetworkButton())

    await waitFor(() => expect(sentTo(BLOCK_NETWORK)).toHaveLength(1))
    expect(sentTo(BLOCK_NETWORK)[0].body).toEqual({ address: "203.0.113.7", days: 30 })
  })

  it("sends the duration the admin picked", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("Blocked networks (2)")

    await user.type(addressInput(), "203.0.113.7")
    await user.click(screen.getByRole("combobox", { name: "Block duration" }))
    await user.click(await screen.findByRole("option", { name: "90 days" }))
    await user.click(blockNetworkButton())

    await waitFor(() => expect(sentTo(BLOCK_NETWORK)).toHaveLength(1))
    expect(sentTo(BLOCK_NETWORK)[0].body).toEqual({ address: "203.0.113.7", days: 90 })
  })

  it("shows the server's refusal word for word and keeps what was typed", async () => {
    const user = userEvent.setup()
    const message = "Only a super admin can block a range this wide."
    routes[BLOCK_NETWORK] = () => ({ status: 403, body: { error: { code: "too_wide_for_admin", message } } })
    renderPage()
    await screen.findByText("Blocked networks (2)")

    await user.type(addressInput(), "203.0.0.0/16")
    await user.click(blockNetworkButton())

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message))
    expect(toast.success).not.toHaveBeenCalled()
    expect(addressInput()).toHaveValue("203.0.0.0/16")
  })

  it("cannot block anything before the database has the block tables", async () => {
    const user = userEvent.setup()
    blocksBody = makeBlocks({
      ready: false,
      status: { ready: false, users: 0, networks: 0, loadedAt: null },
      users: [],
      networks: [],
    })
    renderPage()

    expect(await screen.findByText("Blocking becomes available after the next production release.")).toBeInTheDocument()
    expect(screen.queryByText(/In force on this server/)).toBeNull()
    await user.type(addressInput(), "203.0.113.7")
    expect(blockNetworkButton()).toBeDisabled()
  })

  it("shows the admin's own network, so they know what not to type", async () => {
    renderPage()
    expect(await screen.findByText("192.0.2.0/24")).toBeInTheDocument()
    expect(screen.getByText(/Your network:/)).toHaveTextContent("Your network: 192.0.2.0/24 (cannot be blocked).")
  })

  it("says unknown when the server could not tell the admin's network", async () => {
    whoamiBody = { address: null, source: "unknown", network: null, networkToken: null }
    renderPage()
    await screen.findByText("Blocked networks (2)")
    await waitFor(() => expect(sentTo(WHOAMI)).toHaveLength(1))
    await waitFor(() => expect(screen.getByText(/Your network:/)).toHaveTextContent("Your network: unknown"))
  })
})
