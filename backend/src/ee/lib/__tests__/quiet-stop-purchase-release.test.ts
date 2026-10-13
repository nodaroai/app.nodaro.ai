import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A quiet stop holds free credits, never money: the purchase path ends it
 * (`releaseQuietStopOnPurchase`). Best-effort by contract — the purchase it
 * rides on is already granted, so nothing here may throw into it.
 */

const h = vi.hoisted(() => ({
  row: null as null | { reason: string | null; stopped_by: string | null; created_at: string },
  deleteError: null as unknown,
  readError: null as unknown,
  deleted: [] as string[],
  inserted: [] as Array<Record<string, unknown>>,
  invalidate: vi.fn(),
}))

vi.mock("@/lib/access-blocks.js", () => ({ invalidateAccessBlocks: h.invalidate }))
vi.mock("@/lib/config.js", () => ({ config: { EDITION: "cloud" } }))
vi.mock("@/lib/deployment-payer.js", () => ({ deploymentPayerId: () => null }))
vi.mock("@/ee/middleware/require-platform-operator.js", () => ({ platformOperatorEmails: () => [] }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    auth: { admin: {} },
    from: (table: string) => {
      if (table === "quiet_stops") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => (h.readError ? { data: null, error: h.readError } : { data: h.row, error: null }) }),
          }),
          delete: () => ({
            eq: (_c: string, id: string) => ({
              select: async () => {
                if (h.deleteError) return { data: null, error: h.deleteError }
                if (!h.row) return { data: [], error: null }
                h.deleted.push(id)
                return { data: [{ user_id: id }], error: null }
              },
            }),
          }),
        }
      }
      if (table === "admin_actions") {
        return { insert: async (values: Record<string, unknown>) => (h.inserted.push(values), { data: null, error: null }) }
      }
      throw new Error(`unexpected table ${table}`)
    },
  },
}))

import { releaseQuietStopOnPurchase } from "../account-blocking.js"

const USER = "11111111-1111-4111-8111-111111111111"
const ADMIN = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  h.row = null
  h.deleteError = null
  h.readError = null
  h.deleted = []
  h.inserted = []
  h.invalidate.mockClear()
})

describe("releaseQuietStopOnPurchase", () => {
  it("an account that was not stopped: nothing to do, nothing written", async () => {
    await expect(releaseQuietStopOnPurchase(USER)).resolves.toEqual({ released: false })
    expect(h.deleted).toEqual([])
    expect(h.inserted).toEqual([])
    expect(h.invalidate).not.toHaveBeenCalled()
  })

  it("a stopped account is released: row gone, workers told, audit entry under the admin who stopped it", async () => {
    h.row = { reason: "farm", stopped_by: ADMIN, created_at: "2026-10-13T04:00:00Z" }
    await expect(releaseQuietStopOnPurchase(USER)).resolves.toEqual({ released: true })
    expect(h.deleted).toEqual([USER])
    expect(h.invalidate).toHaveBeenCalledTimes(1)
    expect(h.inserted).toEqual([
      {
        admin_user_id: ADMIN,
        action: "account_quiet_release",
        target_type: "user",
        target_id: USER,
        reason: "Released by purchase",
        payload: { by: "purchase", stoppedAt: "2026-10-13T04:00:00Z", stopReason: "farm" },
      },
    ])
  })

  it("never throws into the purchase — a failed read or delete is 'not released'", async () => {
    h.readError = { code: "XX000", message: "boom" }
    await expect(releaseQuietStopOnPurchase(USER)).resolves.toEqual({ released: false })

    h.readError = null
    h.row = { reason: null, stopped_by: null, created_at: "2026-10-13T04:00:00Z" }
    h.deleteError = { code: "XX000", message: "boom" }
    await expect(releaseQuietStopOnPurchase(USER)).resolves.toEqual({ released: false })
    expect(h.inserted).toEqual([])
  })

  it("a database without the table yet (505 not applied) is simply 'not released'", async () => {
    h.readError = { code: "42P01", message: 'relation "public.quiet_stops" does not exist' }
    await expect(releaseQuietStopOnPurchase(USER)).resolves.toEqual({ released: false })
  })
})
