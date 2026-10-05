/**
 * The Free Grants page's state tabs: Withheld / Given / Taken back.
 *
 * Each tab lists one grant state from its first page, and each row offers the
 * action that state allows: a withheld row keeps its one-click "Restore grant",
 * a given row can have its credits taken back, a taken-back row restored —
 * the last two through the same FreeGrantActions the user panel uses, which
 * needs a QueryClientProvider (the bare render in page.test.tsx only ever shows
 * withheld rows).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
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
import type { FreeGrantRow, GrantListState } from "@/ee/components/admin/free-grants/types"
import AdminFreeGrantsPage from "../page"

const WITHHELD_ID = "00000000-0000-4000-8000-0000000000e1"
const GRANTED_ID = "00000000-0000-4000-8000-0000000000e2"
const REVOKED_ID = "00000000-0000-4000-8000-0000000000e3"

function grantRow(userId: string, email: string, state: FreeGrantRow["state"], credits: number): FreeGrantRow {
  return {
    userId,
    email,
    fullName: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    subscriptionCredits: credits,
    state,
    reasons: state === "withheld" ? ["device_ip_match"] : [],
    decidedAt: null,
  }
}

const WITHHELD_ROW = grantRow(WITHHELD_ID, "withheld@x.test", "withheld", 0)
const GRANTED_ROW = grantRow(GRANTED_ID, "granted@x.test", "granted", 1500)
const REVOKED_ROW = grantRow(REVOKED_ID, "revoked@x.test", "revoked", 0)

type GrantList = { data: FreeGrantRow[]; total: number }

/** What GET /v1/admin/free-grants answers per state; action routes move rows, as the server would. */
let lists: Record<GrantListState, GrantList>

interface Reply {
  readonly status?: number
  readonly body: unknown
}

function reply(r: Reply): Response {
  const status = r.status ?? 200
  return { ok: status < 400, status, json: async () => r.body } as unknown as Response
}

const fetchMock = vi.fn(async (...call: [url: string, init?: RequestInit]) => {
  const [url, init] = call
  const method = init?.method ?? "GET"
  const query = new URL(url, "http://admin.test").searchParams
  if (method === "GET" && url.startsWith("/v1/admin/free-grants/clusters?")) {
    // SharedMachinesCard drops a response whose axis is not the one selected.
    return reply({ body: { data: [], total: 0, axis: query.get("axis"), unavailable: false } })
  }
  if (method === "GET" && url.startsWith("/v1/admin/free-grants?")) {
    return reply({ body: lists[query.get("state") as GrantListState] })
  }
  if (method === "POST" && url === `/v1/admin/free-grants/${GRANTED_ID}/revoke`) {
    lists = {
      ...lists,
      granted: { data: [], total: 0 },
      revoked: { data: [{ ...GRANTED_ROW, state: "revoked", subscriptionCredits: 0 }], total: 1 },
    }
    return reply({ body: { data: { userId: GRANTED_ID, state: "revoked", credits: 1500 } } })
  }
  if (method === "POST" && url === `/v1/admin/free-grants/${REVOKED_ID}/activate`) {
    lists = {
      ...lists,
      revoked: { data: [], total: 0 },
      granted: { data: [{ ...REVOKED_ROW, state: "granted", subscriptionCredits: 1500 }], total: 1 },
    }
    return reply({ body: { data: { userId: REVOKED_ID, state: "granted", credits: 1500 } } })
  }
  throw new Error(`unexpected fetch: ${method} ${url}`)
})

const listUrls = () =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith("/v1/admin/free-grants?"))
const lastListUrl = () => listUrls()[listUrls().length - 1]
const listUrl = (state: GrantListState, offset: number) =>
  `/v1/admin/free-grants?state=${state}&limit=50&offset=${offset}`
const sentTo = (method: string, url: string) =>
  fetchMock.mock.calls.filter(([u, init]) => u === url && (init?.method ?? "GET") === method)

const rowOf = (email: string) => screen.getByText(email).closest("tr")!

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <AdminFreeGrantsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  lists = {
    withheld: { data: [WITHHELD_ROW], total: 1 },
    granted: { data: [GRANTED_ROW], total: 1 },
    revoked: { data: [REVOKED_ROW], total: 1 },
  }
})

describe("state tabs", () => {
  it("opens on Withheld, where a row keeps its one-click Restore grant", async () => {
    renderPage()

    expect(await screen.findByText("withheld@x.test")).toBeInTheDocument()
    expect(listUrls()).toEqual([listUrl("withheld", 0)])
    expect(screen.getByRole("tab", { name: "Withheld" })).toHaveAttribute("aria-selected", "true")

    const row = rowOf("withheld@x.test")
    expect(within(row).getByRole("button", { name: "Restore grant" })).toBeInTheDocument()
    expect(within(row).queryByRole("button", { name: "Take back free credits" })).toBeNull()
  })

  it("Given lists the granted accounts, each offering Take back", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("withheld@x.test")

    await user.click(screen.getByRole("tab", { name: "Given" }))

    expect(await screen.findByText("granted@x.test")).toBeInTheDocument()
    expect(lastListUrl()).toBe(listUrl("granted", 0))
    expect(screen.getByText("Given (1)")).toBeInTheDocument()
    expect(screen.queryByText("withheld@x.test")).toBeNull()

    const row = rowOf("granted@x.test")
    expect(within(row).getByRole("button", { name: "Take back free credits" })).toBeInTheDocument()
    expect(within(row).queryByRole("button", { name: "Restore grant" })).toBeNull()
    expect(within(row).queryByRole("button", { name: "Restore free credits" })).toBeNull()
  })

  it("Taken back lists the revoked accounts, each offering Restore free credits", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("withheld@x.test")

    await user.click(screen.getByRole("tab", { name: "Taken back" }))

    expect(await screen.findByText("revoked@x.test")).toBeInTheDocument()
    expect(lastListUrl()).toBe(listUrl("revoked", 0))
    expect(screen.getByText("Taken back (1)")).toBeInTheDocument()

    const row = rowOf("revoked@x.test")
    expect(within(row).getByRole("button", { name: "Restore free credits" })).toBeInTheDocument()
    expect(within(row).queryByRole("button", { name: "Restore grant" })).toBeNull()
    expect(within(row).queryByRole("button", { name: "Take back free credits" })).toBeNull()
  })

  it("starts every tab on its first page, even after paging", async () => {
    const user = userEvent.setup()
    lists = { ...lists, withheld: { data: [WITHHELD_ROW], total: 120 } }
    renderPage()
    await screen.findByText("withheld@x.test")

    await user.click(screen.getByRole("button", { name: "Next" }))
    await waitFor(() => expect(lastListUrl()).toBe(listUrl("withheld", 50)))

    await user.click(screen.getByRole("tab", { name: "Given" }))
    await waitFor(() => expect(lastListUrl()).toBe(listUrl("granted", 0)))
    await screen.findByText("granted@x.test")

    // And back: the withheld list does not resume on the page it was left on.
    await user.click(screen.getByRole("tab", { name: "Withheld" }))
    await waitFor(() => expect(lastListUrl()).toBe(listUrl("withheld", 0)))
    expect(listUrls().filter((u) => u.includes("offset=50"))).toHaveLength(1)
  })
})

describe("acting from a tab", () => {
  it("taking credits back on Given re-reads the list, and the account moves to Taken back", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("withheld@x.test")
    await user.click(screen.getByRole("tab", { name: "Given" }))
    await screen.findByText("granted@x.test")

    await user.click(within(rowOf("granted@x.test")).getByRole("button", { name: "Take back free credits" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Take back" }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(`Took back ${(1500).toLocaleString()} free credits`),
    )
    expect(sentTo("POST", `/v1/admin/free-grants/${GRANTED_ID}/revoke`)).toHaveLength(1)
    expect(await screen.findByText("No account has free credits yet.")).toBeInTheDocument()
    expect(listUrls().filter((u) => u === listUrl("granted", 0))).toHaveLength(2)

    await user.click(screen.getByRole("tab", { name: "Taken back" }))
    const moved = await screen.findByText("granted@x.test")
    expect(within(moved.closest("tr")!).getByRole("button", { name: "Restore free credits" })).toBeInTheDocument()
  })

  it("restoring on Taken back re-reads the list", async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText("withheld@x.test")
    await user.click(screen.getByRole("tab", { name: "Taken back" }))
    await screen.findByText("revoked@x.test")

    await user.click(within(rowOf("revoked@x.test")).getByRole("button", { name: "Restore free credits" }))
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Restore" }))

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(`Restored ${(1500).toLocaleString()} free credits`),
    )
    expect(sentTo("POST", `/v1/admin/free-grants/${REVOKED_ID}/activate`)).toHaveLength(1)
    expect(await screen.findByText("No free credits were taken back.")).toBeInTheDocument()
    expect(listUrls().filter((u) => u === listUrl("revoked", 0))).toHaveLength(2)
  })
})
