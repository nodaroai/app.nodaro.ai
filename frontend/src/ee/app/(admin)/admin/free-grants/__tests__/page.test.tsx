import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

const h = vi.hoisted(() => ({ getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })) }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: h.getAuthHeaders }))
vi.mock("@/lib/edition", async (orig) => ({
  ...(await orig<typeof import("@/lib/edition")>()),
  hasAdmin: () => true,
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from "sonner"
import AdminFreeGrantsPage from "../page"

const U1 = "00000000-0000-4000-8000-000000000001"
const U2 = "00000000-0000-4000-8000-000000000002"

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as unknown as Response)
}

/** The shape `errorFrom` reads, so a refusal surfaces as `toast.error("boom")`. */
function fail() {
  return Promise.resolve({
    ok: false,
    status: 500,
    json: async () => ({ error: { message: "boom" } }),
  } as unknown as Response)
}

let clustersBody: unknown
let withheldBody: unknown
let relatedBody: unknown

type Kind = "clusters" | "related" | "activate" | "withheld"
/** Surfaces told to answer 500 for one test; cleared in `beforeEach`. */
const failures = new Set<Kind>()
/** Holds the restore POST open so "disabled while in flight" is observable. */
let holdActivate = false
let releaseActivate: (() => void) | null = null

function kindOf(url: string): Kind {
  if (url.startsWith("/v1/admin/free-grants/clusters")) return "clusters"
  if (url.endsWith("/related")) return "related"
  if (url.endsWith("/activate")) return "activate"
  if (url.startsWith("/v1/admin/free-grants?")) return "withheld"
  throw new Error(`unexpected fetch: ${url}`)
}

// The page fires two fetches on mount (withheld + clusters) and two on demand
// (related, activate), so the mock has to dispatch on URL rather than return
// one canned body.
const fetchMock = vi.fn((...call: [url: string, init?: RequestInit]) => {
  const kind = kindOf(call[0])
  if (failures.has(kind)) return fail()
  if (kind === "clusters") return ok(clustersBody)
  if (kind === "related") return ok(relatedBody)
  if (kind === "withheld") return ok(withheldBody)
  if (!holdActivate) return ok({})
  return new Promise<Response>((resolve) => {
    releaseActivate = () =>
      resolve({ ok: true, status: 200, json: async () => ({}) } as unknown as Response)
  })
})

const urls = () => fetchMock.mock.calls.map((c) => c[0] as string)

/** A device-axis page whose one cluster is CAPPED: 30 accounts, 2 ids back. */
function deviceClusters() {
  return {
    data: [
      {
        keyPrefix: "d".repeat(12),
        memberCount: 30,
        firstSeenAt: "2026-09-01T10:00:00.000Z",
        lastSeenAt: "2026-09-02T08:00:00.000Z",
        members: [
          {
            userId: U2,
            email: "cluster-device@x.test",
            fullName: null,
            state: "withheld",
            subscriptionCredits: 0,
            signalAt: "2026-09-01T10:00:00.000Z",
            reasons: ["browser_match"],
          },
          {
            userId: "00000000-0000-4000-8000-000000000003",
            email: "cluster-device-2@x.test",
            fullName: null,
            state: null,
            subscriptionCredits: 0,
            signalAt: null,
            reasons: [],
          },
        ],
      },
    ],
    total: 1,
    axis: "device",
    unavailable: false,
  }
}

function ipClusters() {
  return {
    data: [
      {
        keyPrefix: "i".repeat(12),
        memberCount: 2,
        firstSeenAt: "2026-09-01T10:00:00.000Z",
        lastSeenAt: "2026-09-02T08:00:00.000Z",
        members: [
          {
            userId: U2,
            email: "cluster-ip@x.test",
            fullName: null,
            state: "granted",
            subscriptionCredits: 1500,
            signalAt: "2026-09-01T10:00:00.000Z",
            reasons: ["browser_match"],
          },
        ],
      },
    ],
    total: 1,
    axis: "ip",
    unavailable: false,
  }
}

describe("AdminFreeGrantsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("fetch", fetchMock)
    failures.clear()
    holdActivate = false
    releaseActivate = null
    withheldBody = {
      data: [
        {
          userId: U1,
          email: "withheld@x.test",
          fullName: null,
          createdAt: "2026-09-01T10:00:00.000Z",
          subscriptionCredits: 0,
          state: "withheld",
          reasons: ["device_ip_match"],
          decidedAt: null,
        },
      ],
      total: 1,
    }
    clustersBody = deviceClusters()
    relatedBody = {
      data: {
        userId: U1,
        signal: {
          browserKeyPrefix: null,
          deviceKeyPrefix: "d".repeat(12),
          ipHashPrefix: "i".repeat(12),
          signalAt: "2026-09-01T10:00:00.000Z",
        },
        related: [
          {
            userId: U2,
            email: "related@x.test",
            fullName: null,
            state: "granted",
            subscriptionCredits: 1500,
            signalAt: "2026-09-01T09:00:00.000Z",
            reasons: [],
            matches: ["device", "ip"],
          },
        ],
      },
    }
  })

  it("still renders the withheld table with humanised reasons", async () => {
    render(<AdminFreeGrantsPage />)
    expect(await screen.findByText("withheld@x.test")).toBeInTheDocument()
    expect(screen.getByText("Same device + network as another account")).toBeInTheDocument()
  })

  it("loads related accounts lazily, inline, and only once", async () => {
    const user = userEvent.setup()
    render(<AdminFreeGrantsPage />)
    await screen.findByText("withheld@x.test")

    await user.click(screen.getByRole("button", { name: "Related" }))
    await waitFor(() => {
      expect(urls()).toContain(`/v1/admin/free-grants/${U1}/related`)
    })

    const row = (await screen.findByText("related@x.test")).closest("tr")!
    expect(within(row).getByText("Device")).toBeInTheDocument()
    expect(within(row).getByText("Network")).toBeInTheDocument()

    // Collapse, then expand again — the toggle is local, not a refetch.
    await user.click(screen.getByRole("button", { name: "Related" }))
    await user.click(screen.getByRole("button", { name: "Related" }))
    await screen.findByText("related@x.test")
    expect(urls().filter((u) => u.endsWith("/related")).length).toBe(1)
  })

  it("loads the device axis on mount", async () => {
    render(<AdminFreeGrantsPage />)
    await waitFor(() => {
      expect(urls()).toContain("/v1/admin/free-grants/clusters?axis=device&limit=50&offset=0")
    })
    expect(await screen.findByText("cluster-device@x.test")).toBeInTheDocument()
  })

  it("refetches when the axis changes", async () => {
    const user = userEvent.setup()
    render(<AdminFreeGrantsPage />)
    await screen.findByText("cluster-device@x.test")

    clustersBody = ipClusters()
    await user.click(screen.getByRole("tab", { name: "Network" }))

    await waitFor(() => {
      const clusterUrls = urls().filter((u) => u.startsWith("/v1/admin/free-grants/clusters"))
      expect(clusterUrls[clusterUrls.length - 1]).toContain("axis=ip")
    })
    expect(await screen.findByText("cluster-ip@x.test")).toBeInTheDocument()
  })

  it("says so when the RPC is not in the database yet", async () => {
    clustersBody = { data: [], total: 0, axis: "device", unavailable: true }
    render(<AdminFreeGrantsPage />)
    expect(
      await screen.findByText("Not available until the next production release."),
    ).toBeInTheDocument()
  })

  it("always shows the coverage caveat", async () => {
    render(<AdminFreeGrantsPage />)
    expect(screen.getByText(/only captured on app\.nodaro\.ai/)).toBeInTheDocument()
  })

  it("admits when a cluster is capped", async () => {
    render(<AdminFreeGrantsPage />)
    expect(await screen.findByText("+28 more")).toBeInTheDocument()
  })

  it("paints the empty state, not a forever spinner, when the clusters fetch fails", async () => {
    failures.add("clusters")
    render(<AdminFreeGrantsPage />)
    expect(await screen.findByText("No shared signals on this axis.")).toBeInTheDocument()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"))
    await screen.findByText("withheld@x.test")
    expect(screen.queryByText("Loading…")).toBeNull()
  })

  it("paints the empty state, not a forever spinner, when the withheld fetch fails", async () => {
    failures.add("withheld")
    render(<AdminFreeGrantsPage />)
    expect(await screen.findByText("Nothing withheld.")).toBeInTheDocument()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"))
    await screen.findByText("cluster-device@x.test")
    expect(screen.queryByText("Loading…")).toBeNull()
  })

  it("collapses a stranded row when the related fetch fails, and retries on the next toggle", async () => {
    const user = userEvent.setup()
    failures.add("related")
    render(<AdminFreeGrantsPage />)
    await screen.findByText("withheld@x.test")
    await screen.findByText("cluster-device@x.test")

    await user.click(screen.getByRole("button", { name: "Related" }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"))
    // Collapsed — nothing is left sitting on "Loading…" with no cached data.
    expect(screen.queryByText("Loading…")).toBeNull()

    failures.clear()
    await user.click(screen.getByRole("button", { name: "Related" }))
    expect(await screen.findByText("related@x.test")).toBeInTheDocument()
    expect(urls().filter((u) => u.endsWith("/related")).length).toBe(2)
  })

  it("restores a grant, blocks a double submit, and reloads the list", async () => {
    const user = userEvent.setup()
    holdActivate = true
    render(<AdminFreeGrantsPage />)
    await screen.findByText("withheld@x.test")

    const button = screen.getByRole("button", { name: "Restore grant" })
    await user.click(button)
    await waitFor(() => expect(urls().some((u) => u.endsWith("/activate"))).toBe(true))
    expect(button).toBeDisabled()

    const call = fetchMock.mock.calls.find((c) => (c[0] as string).endsWith("/activate"))!
    expect(call[0]).toBe(`/v1/admin/free-grants/${U1}/activate`)
    expect((call[1] as RequestInit).method).toBe("POST")

    releaseActivate!()
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Grant restored for withheld@x.test"),
    )
    // Restore mints credits, so the balance on screen has to be re-read.
    await waitFor(() =>
      expect(urls().filter((u) => u.startsWith("/v1/admin/free-grants?")).length).toBe(2),
    )
  })

  it("pages the withheld list", async () => {
    const user = userEvent.setup()
    withheldBody = { ...(withheldBody as object), total: 120 }
    render(<AdminFreeGrantsPage />)
    await screen.findByText("withheld@x.test")

    await user.click(screen.getByRole("button", { name: "Next" }))
    await waitFor(() => {
      const withheldUrls = urls().filter((u) => u.startsWith("/v1/admin/free-grants?"))
      expect(withheldUrls[withheldUrls.length - 1]).toContain("offset=50")
    })
  })
})
