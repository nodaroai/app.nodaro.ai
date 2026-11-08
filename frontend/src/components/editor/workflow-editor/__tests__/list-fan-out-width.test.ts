import { describe, it, expect, vi, beforeEach } from "vitest"

const mockGetMyLanes = vi.fn()
const edition = vi.hoisted(() => ({ credits: true, tier: "pro", userId: "u-1" as string | undefined }))

vi.mock("@/lib/api", () => ({ getMyLanes: (...a: unknown[]) => mockGetMyLanes(...a) }))
vi.mock("@/lib/edition", () => ({ hasCredits: () => edition.credits }))
vi.mock("@/hooks/use-auth", () => ({ getCachedTier: () => edition.tier, getCachedUserId: () => edition.userId }))

import { LANE_SIZES_REFRESH_MS, listFanOutWidth, refreshLaneSizes, resetLaneSizesForTests } from "../list-fan-out-width"
import { TIER_PARALLELISM } from "@/lib/pricing-data"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import { BILLING_SURFACE_DEFAULT, BILLING_SURFACE_QUERY_KEY } from "@/lib/billing-surface"

const sizes = (provider: number) => ({ provider, llm: 24, local: 24, run: 12 })
const enforcedAt = (provider: number) => ({ enforced: true, lines: [{ payer: "user:me", current: true, sizes: sizes(provider) }] })

/** Let a resolved read land in the cache. */
const settle = () => new Promise((r) => setTimeout(r, 0))

describe("list fan-out width", () => {
  beforeEach(() => {
    resetLaneSizesForTests()
    mockGetMyLanes.mockReset()
    edition.credits = true
    edition.tier = "pro"
    edition.userId = "u-1"
    queryClient.clear()
  })

  it("list fan-out reads the lane size from /v1/me/lanes when enforced", async () => {
    mockGetMyLanes.mockResolvedValue({
      enforced: true,
      lines: [
        { payer: "user:me", current: false, sizes: sizes(3) },
        { payer: "workspace:w1", current: true, sizes: sizes(7) },
      ],
    })
    refreshLaneSizes("wf-1") // the editor's prefetch when the workflow opens
    await settle()
    // The billed (current) line's provider size — not the personal line's.
    expect(listFanOutWidth("wf-1")).toBe(7)
    // Asked for this workflow, so the workflow's own workspace wins.
    expect(mockGetMyLanes).toHaveBeenCalledWith(expect.objectContaining({ workflowId: "wf-1" }))
  })

  it("a fan-out with a slow/hanging lanes fetch starts at once at today's width", () => {
    mockGetMyLanes.mockReturnValue(new Promise(() => {}))
    refreshLaneSizes("wf-1")
    // Synchronous: nothing to wait for, today's table.
    expect(listFanOutWidth("wf-1")).toBe(TIER_PARALLELISM.pro)
    edition.credits = false
    expect(listFanOutWidth("wf-1")).toBe(12)
  })

  it("keeps today's table exactly when lanes are not enforced", async () => {
    mockGetMyLanes.mockResolvedValue({ enforced: false, lines: [{ payer: "user:me", current: true, sizes: sizes(1) }] })
    refreshLaneSizes("wf-1")
    await settle()
    expect(listFanOutWidth("wf-1")).toBe(TIER_PARALLELISM.pro)
  })

  it("keeps today's table when nothing is cached or the read failed", async () => {
    mockGetMyLanes.mockRejectedValue(new Error("offline"))
    expect(listFanOutWidth("wf-1")).toBe(TIER_PARALLELISM.pro)
    await settle()
    edition.tier = "unknown-tier"
    expect(listFanOutWidth("wf-1")).toBe(TIER_PARALLELISM.free)
  })

  it("keeps today's table for an answer without a usable current line", async () => {
    for (const [i, answer] of [
      { enforced: true, lines: [] },
      { enforced: true, lines: [{ payer: "user:me", current: false, sizes: sizes(5) }] },
      { enforced: true, lines: [{ payer: "user:me", current: true, sizes: sizes(0) }] },
      { enforced: true, lines: [{ payer: "user:me", current: true, sizes: { llm: 2 } }] },
    ].entries()) {
      mockGetMyLanes.mockResolvedValueOnce(answer)
      refreshLaneSizes(`wf-${i}`)
      await settle()
      expect(listFanOutWidth(`wf-${i}`)).toBe(TIER_PARALLELISM.pro)
    }
  })

  it("a malformed answer is today's width, never a failed run", async () => {
    const malformed: unknown[] = [
      null,
      "nope",
      { enforced: true },
      { enforced: true, lines: "not a list" },
      { enforced: true, lines: { current: true } },
      { enforced: "yes", lines: [{ payer: "user:me", current: true, sizes: sizes(3) }] },
      { enforced: true, lines: [null, 7, { current: true, sizes: null }] },
      { enforced: true, lines: [{ current: true, sizes: { provider: "8" } }] },
    ]
    for (const [i, answer] of malformed.entries()) {
      mockGetMyLanes.mockResolvedValueOnce(answer)
      refreshLaneSizes(`bad-${i}`)
      await settle()
      expect(() => listFanOutWidth(`bad-${i}`)).not.toThrow()
      expect(listFanOutWidth(`bad-${i}`)).toBe(TIER_PARALLELISM.pro)
    }
  })

  it("a malformed answer does not replace a good one", async () => {
    mockGetMyLanes.mockResolvedValueOnce(enforcedAt(5)).mockResolvedValueOnce({ enforced: true, lines: "broken" })
    const t0 = Date.now()
    refreshLaneSizes("wf-1", t0)
    await settle()
    refreshLaneSizes("wf-1", t0 + LANE_SIZES_REFRESH_MS + 1)
    await settle()
    expect(listFanOutWidth("wf-1", t0 + 1)).toBe(5)
  })

  it("answers per workflow, and asks without an id when the editor has none", async () => {
    mockGetMyLanes.mockResolvedValueOnce(enforcedAt(4)).mockResolvedValueOnce(enforcedAt(9))
    refreshLaneSizes(null)
    refreshLaneSizes("wf-2")
    await settle()
    expect(mockGetMyLanes.mock.calls[0][0].workflowId).toBeUndefined()
    expect(listFanOutWidth(null)).toBe(4)
    expect(listFanOutWidth("wf-2")).toBe(9)
  })

  it("refreshes in the background at most once per LANE_SIZES_REFRESH_MS", async () => {
    mockGetMyLanes.mockResolvedValue(enforcedAt(4))
    const t0 = Date.now()
    refreshLaneSizes("wf-1", t0)
    refreshLaneSizes("wf-1", t0 + 1_000)
    await settle()
    // A fresh answer: a fan-out reads it and starts no read.
    expect(listFanOutWidth("wf-1", Date.now())).toBe(4)
    expect(mockGetMyLanes).toHaveBeenCalledTimes(1)
    // An old one: the fan-out still answers from it at once, and starts the next read.
    mockGetMyLanes.mockResolvedValue({ enforced: false, lines: [] })
    expect(listFanOutWidth("wf-1", Date.now() + LANE_SIZES_REFRESH_MS + 1)).toBe(4)
    expect(mockGetMyLanes).toHaveBeenCalledTimes(2)
    await settle()
    expect(listFanOutWidth("wf-1")).toBe(TIER_PARALLELISM.pro)
  })
})

describe("list fan-out width on a deployment with a payer (decided 2026-11-08)", () => {
  beforeEach(() => {
    resetLaneSizesForTests()
    mockGetMyLanes.mockReset()
    mockGetMyLanes.mockReturnValue(new Promise(() => {}))
    edition.credits = true
    edition.tier = "free" // every user there is stored free; the payer holds the plan
    edition.userId = "u-1"
    queryClient.clear()
  })

  it("runs at the plan the balance reports (the payer account's grade), not the session's own free row", () => {
    queryClient.setQueryData(BILLING_SURFACE_QUERY_KEY, { ...BILLING_SURFACE_DEFAULT, deploymentPayer: true })
    queryClient.setQueryData(queryKeys.credits.balance("u-1"), { effectiveTier: "pro" })
    expect(listFanOutWidth("wf-1")).toBe(TIER_PARALLELISM.pro)
  })

  it("with no balance cached yet, the session's own tier, never a failed run", () => {
    queryClient.setQueryData(BILLING_SURFACE_QUERY_KEY, { ...BILLING_SURFACE_DEFAULT, deploymentPayer: true })
    expect(listFanOutWidth("wf-1")).toBe(TIER_PARALLELISM.free)
  })

  it("without a payer the session's own tier, whatever a cached balance says (inert on mainline)", () => {
    queryClient.setQueryData(BILLING_SURFACE_QUERY_KEY, { ...BILLING_SURFACE_DEFAULT, deploymentPayer: false })
    queryClient.setQueryData(queryKeys.credits.balance("u-1"), { effectiveTier: "pro" })
    expect(listFanOutWidth("wf-1")).toBe(TIER_PARALLELISM.free)
  })
})
