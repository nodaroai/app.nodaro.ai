import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

const h = vi.hoisted(() => ({ getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })) }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: h.getAuthHeaders }))

import AdminOrganizationsPage from "../page"

function org(over: Record<string, unknown> = {}) {
  return {
    id: "org-1",
    slug: "kent-high",
    name: "Kent High",
    kind: "school",
    status: "pending",
    createdAt: "2026-08-20T09:00:00.000Z",
    owner: { userId: "u-1", email: "ada@kent.edu", displayName: "Ada Lovelace" },
    memberCount: 12,
    workspaceCount: 3,
    ...over,
  }
}

const fetchMock = vi.fn()

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}
function fail(status: number, message: string) {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => ({ error: { code: "forbidden", message } }),
  } as unknown as Response)
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AdminOrganizationsPage />
    </QueryClientProvider>,
  )
}

/** The path+method of the Nth fetch. */
function callOf(n: number): { url: string; method: string; body?: unknown } {
  const [url, init] = fetchMock.mock.calls[n] as [string, RequestInit | undefined]
  return {
    url,
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReturnValue(ok({ data: [org()], nextCursor: null }))
})

describe("the platform-admin organizations queue", () => {
  /**
   * Someone is blocked behind every pending row and nobody is blocked behind
   * any other, so the queue with a person waiting at the end of it opens
   * first rather than being buried under "all".
   */
  it("opens on what is waiting for review", async () => {
    renderPage()
    await screen.findByText("Kent High")
    expect(callOf(0).url).toBe("/v1/admin/orgs?status=pending")
  })

  it("shows what the decision needs: owner, size, and when it arrived", async () => {
    renderPage()
    await screen.findByText("Kent High")
    expect(screen.getByText("ada@kent.edu")).toBeInTheDocument()
    expect(screen.getByText(/12 members/)).toBeInTheDocument()
    expect(screen.getByText(/3 workspaces/)).toBeInTheDocument()
  })

  it("asks for every live organization when the All tab is chosen", async () => {
    renderPage()
    await screen.findByText("Kent High")
    await userEvent.click(screen.getByRole("button", { name: "All" }))
    expect(callOf(fetchMock.mock.calls.length - 1).url).toBe("/v1/admin/orgs")
  })

  it("approves a pending organization", async () => {
    renderPage()
    await screen.findByText("Kent High")
    await userEvent.click(screen.getByRole("button", { name: "Approve" }))
    const patch = callOf(1)
    expect(patch.url).toBe("/v1/admin/orgs/org-1")
    expect(patch.method).toBe("PATCH")
    expect(patch.body).toEqual({ status: "active" })
  })

  /**
   * Each status offers only what it permits. A row of greyed-out buttons
   * would say "you may do all of this, just not now", which is false.
   */
  it("offers Suspend on an active one and Restore on a suspended one", async () => {
    fetchMock.mockReturnValue(ok({ data: [org({ status: "active" })], nextCursor: null }))
    const { unmount } = renderPage()
    await screen.findByText("Kent High")
    expect(screen.getByRole("button", { name: "Suspend" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument()
    unmount()

    fetchMock.mockReturnValue(ok({ data: [org({ status: "suspended" })], nextCursor: null }))
    renderPage()
    await screen.findByText("Kent High")
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Suspend" })).not.toBeInTheDocument()
  })

  it("offers nothing on a deleted one — restoring it is not a routine click", async () => {
    fetchMock.mockReturnValue(ok({ data: [org({ status: "deleted" })], nextCursor: null }))
    renderPage()
    const row = (await screen.findByText("Kent High")).closest("tr")!
    // Scoped to the ROW: the tab strip has a button called "Suspended".
    expect(within(row).queryByRole("button")).not.toBeInTheDocument()
    // And says WHY, rather than leaving a cell that reads as a render bug.
    expect(within(row).getByText("restore via support")).toBeInTheDocument()
  })

  it("surfaces a refusal instead of looking like it worked", async () => {
    fetchMock
      .mockReturnValueOnce(ok({ data: [org()], nextCursor: null }))
      .mockReturnValueOnce(fail(403, "Platform administrators only"))
    renderPage()
    await screen.findByText("Kent High")
    await userEvent.click(screen.getByRole("button", { name: "Approve" }))
    expect(await screen.findByText("Platform administrators only")).toBeInTheDocument()
  })

  it("reports a failed load rather than an empty queue", async () => {
    // "Nothing is waiting" and "we could not ask" must never look the same:
    // one means go home, the other means someone is still waiting.
    fetchMock.mockReturnValue(fail(500, "Failed to list organizations"))
    renderPage()
    expect(await screen.findByText("Failed to list organizations")).toBeInTheDocument()
    expect(screen.queryByText("Nothing is waiting for review.")).not.toBeInTheDocument()
  })

  it("says plainly when the review queue is empty", async () => {
    fetchMock.mockReturnValue(ok({ data: [], nextCursor: null }))
    renderPage()
    expect(await screen.findByText("Nothing is waiting for review.")).toBeInTheDocument()
  })

  it("does not offer anything that would read another organization's insides", async () => {
    // A platform admin decides whether an organization may operate here.
    // Members, settings and workflows belong to the people who run it.
    renderPage()
    const table = await screen.findByRole("table")
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim().toLowerCase())
    expect(headers).not.toContain("members")
    expect(headers).not.toContain("settings")
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })
})
