import { describe, it, expect, vi, beforeEach } from "vitest"

const metered = vi.hoisted(() => ({ on: true }))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  llmMeteredPricing: () => metered.on,
}))

import {
  LISTING_ESTIMATE_FLAG_COLUMN,
  estimateFlagColumn,
  listingEstimateFlag,
  resetEstimateFlagColumnForTest,
  selectWithEstimateFlag,
  writeWithEstimateFlag,
} from "../listing-estimate-flag-column.js"

/**
 * The listing's estimate flag (migration 553, Task 12 / R47): written from the
 * listing's own flag, served only while metered pricing is on, and dropped
 * (never failing the statement) while the column has not reached the database.
 */
const MISSING = { code: "42703", message: `column published_apps.${LISTING_ESTIMATE_FLAG_COLUMN} does not exist` }

beforeEach(() => {
  metered.on = true
  resetEstimateFlagColumnForTest()
})

describe("listing-estimate-flag-column", () => {
  it("writes the listing's own flag: true for an estimate, false otherwise", () => {
    expect(estimateFlagColumn({ estimate: true })).toEqual({ estimated_credits_is_estimate: true })
    expect(estimateFlagColumn({})).toEqual({ estimated_credits_is_estimate: false })
  })

  it("serves estimatedCreditsIsEstimate only for a flagged row while metered pricing is on", () => {
    expect(listingEstimateFlag({ [LISTING_ESTIMATE_FLAG_COLUMN]: true })).toEqual({ estimatedCreditsIsEstimate: true })
    expect(listingEstimateFlag({ [LISTING_ESTIMATE_FLAG_COLUMN]: false })).toEqual({})
    expect(listingEstimateFlag({ [LISTING_ESTIMATE_FLAG_COLUMN]: null })).toEqual({})
    metered.on = false
    expect(listingEstimateFlag({ [LISTING_ESTIMATE_FLAG_COLUMN]: true })).toEqual({})
  })

  it("a write whose column is missing is retried without it, and later writes skip it", async () => {
    const seen: Array<Record<string, unknown>> = []
    const write = async (row: Record<string, unknown>) => {
      seen.push(row)
      return { error: LISTING_ESTIMATE_FLAG_COLUMN in row ? MISSING : null }
    }
    const dropped = vi.fn((r: Record<string, unknown>) => ({ ...r, stale: true }))
    expect((await writeWithEstimateFlag("published_apps", { a: 1, [LISTING_ESTIMATE_FLAG_COLUMN]: true }, write, dropped)).error).toBeNull()
    expect(seen).toEqual([{ a: 1, [LISTING_ESTIMATE_FLAG_COLUMN]: true }, { a: 1, stale: true }])
    seen.length = 0
    await writeWithEstimateFlag("published_apps", { a: 2, [LISTING_ESTIMATE_FLAG_COLUMN]: false }, write)
    expect(seen).toEqual([{ a: 2 }])
  })

  it("a read whose column is missing is retried without it", async () => {
    const asked: string[] = []
    const build = async (columns: string) => {
      asked.push(columns)
      return { data: [], error: columns.includes(LISTING_ESTIMATE_FLAG_COLUMN) ? MISSING : null }
    }
    expect((await selectWithEstimateFlag("workflow_templates", "id", build)).error).toBeNull()
    expect(asked).toEqual([`id, ${LISTING_ESTIMATE_FLAG_COLUMN}`, "id"])
  })

  it("any other error is not mistaken for a missing column", async () => {
    const write = async () => ({ error: { code: "23505", message: "duplicate" } })
    expect((await writeWithEstimateFlag("published_apps", { [LISTING_ESTIMATE_FLAG_COLUMN]: true }, write)).error).toMatchObject({ code: "23505" })
  })
})
