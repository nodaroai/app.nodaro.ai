import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The welcome pop-up's record on `profiles`: the read behind the balance's
 * `welcomeOffer`, and the two writes behind `POST /v1/credits/welcome-offer/seen`.
 *
 * What these pin:
 *  - "shown" counts one showing as a compare-and-set on the values it read,
 *    refuses a second one within the day, and stamps `seen_at` (first shown)
 *    only when it was empty.
 *  - a close under the old rule (`seen_at` alone) is counted as the first showing.
 *  - "later" stamps `declined_at` and `seen_at`, first stamp wins each.
 *  - until the counting columns exist (PostgREST `PGRST204`, Postgres `42703`),
 *    every read and write is the one `seen_at` stamp of before, never an error.
 */

interface Call {
  table: string
  op: "select" | "update"
  columns?: string
  values?: Record<string, unknown>
  returning?: string
  filters: Array<[string, string, unknown?]>
}

const h = vi.hoisted(() => ({
  calls: [] as Call[],
  results: [] as Array<{ data?: unknown; error?: unknown }>,
}))

vi.mock("@/lib/supabase.js", () => {
  function from(table: string) {
    const call: Call = { table, op: "select", filters: [] }
    h.calls.push(call)
    const chain: Record<string, unknown> = {
      select: (columns: string) => {
        if (call.op === "update") call.returning = columns
        else call.columns = columns
        return chain
      },
      update: (values: Record<string, unknown>) => {
        call.op = "update"
        call.values = values
        return chain
      },
      eq: (column: string, value: unknown) => {
        call.filters.push(["eq", column, value])
        return chain
      },
      is: (column: string, value: unknown) => {
        call.filters.push(["is", column, value])
        return chain
      },
      single: () => chain,
      maybeSingle: () => chain,
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        Promise.resolve({ data: null, error: null, ...(h.results.shift() ?? {}) }).then(resolve, reject),
    }
    return chain
  }
  return { supabase: { from } }
})

import { readWelcomePopupRow, recordWelcomePopupLater, recordWelcomePopupShown } from "../welcome-popup.js"

const USER = "00000000-0000-4000-8000-000000000001"
const NOW = Date.parse("2026-11-16T12:00:00.000Z")
const NOW_ISO = new Date(NOW).toISOString()
const HOUR = 60 * 60 * 1000
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const MISSING_COLUMN = { code: "42703", message: 'column profiles.welcome_offer_shown_count does not exist' }
const SCHEMA_CACHE_MISS = { code: "PGRST204", message: "Could not find the 'welcome_offer_declined_at' column" }

const row = (over: Record<string, unknown> = {}) => ({
  free_grant_state: "unclaimed",
  welcome_offer_seen_at: null,
  welcome_offer_declined_at: null,
  welcome_offer_shown_count: 0,
  welcome_offer_last_shown_at: null,
  ...over,
})

beforeEach(() => {
  h.calls = []
  h.results = []
})

describe("readWelcomePopupRow", () => {
  it("reads the record, the grant state and the consent mark in one query", async () => {
    h.results.push({
      data: { ...row({ welcome_offer_seen_at: ago(30 * HOUR), welcome_offer_shown_count: 1, welcome_offer_last_shown_at: ago(30 * HOUR) }), welcome_consent_pending: false, free_grant_state: "unclaimed" },
    })
    const out = await readWelcomePopupRow(USER)
    expect(out).toEqual({
      record: {
        seenAt: ago(30 * HOUR),
        showings: { declinedAt: null, shownCount: 1, lastShownAt: ago(30 * HOUR) },
      },
      grantState: "unclaimed",
      consentPending: false,
    })
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].columns).toContain("welcome_offer_shown_count")
    expect(h.calls[0].columns).toContain("free_grant_state")
    expect(h.calls[0].filters).toEqual([["eq", "id", USER]])
  })

  it.each([
    ["Postgres 42703", MISSING_COLUMN],
    ["PostgREST PGRST204", SCHEMA_CACHE_MISS],
  ])("without the counting columns (%s): reads again without them, and the consent mark still reads", async (_label, missing) => {
    h.results.push({ error: missing }, { data: { welcome_offer_seen_at: null, welcome_consent_pending: true, free_grant_state: "granted" } })
    const out = await readWelcomePopupRow(USER)
    expect(out).toEqual({ record: { seenAt: null, showings: null }, grantState: "granted", consentPending: true })
    expect(h.calls).toHaveLength(2)
    expect(h.calls[1].columns).not.toContain("welcome_offer_shown_count")
  })

  it("any other read error: null", async () => {
    h.results.push({ error: { code: "57014", message: "statement timeout" } })
    expect(await readWelcomePopupRow(USER)).toBeNull()
    expect(h.calls).toHaveLength(1)
  })
})

describe("recordWelcomePopupShown", () => {
  it("the first showing: count 1, now, and first shown — written only over the values it read", async () => {
    h.results.push({ data: row() }, { data: [{ id: USER }] })
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: null, counted: true })
    const write = h.calls[1]
    expect(write.op).toBe("update")
    expect(write.values).toEqual({
      welcome_offer_shown_count: 1,
      welcome_offer_last_shown_at: NOW_ISO,
      welcome_offer_seen_at: NOW_ISO,
    })
    expect(write.filters).toEqual([
      ["eq", "id", USER],
      ["eq", "welcome_offer_shown_count", 0],
      ["is", "welcome_offer_last_shown_at", null],
      ["is", "welcome_offer_seen_at", null],
    ])
    expect(write.returning).toBe("id")
  })

  it("a later showing more than a day after the last: count + 1, first shown kept", async () => {
    h.results.push(
      { data: row({ welcome_offer_seen_at: ago(50 * HOUR), welcome_offer_shown_count: 1, welcome_offer_last_shown_at: ago(25 * HOUR) }) },
      { data: [{ id: USER }] },
    )
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: null, counted: true })
    const write = h.calls[1]
    expect(write.values).toEqual({ welcome_offer_shown_count: 2, welcome_offer_last_shown_at: NOW_ISO })
    expect(write.filters).toEqual([
      ["eq", "id", USER],
      ["eq", "welcome_offer_shown_count", 1],
      ["eq", "welcome_offer_last_shown_at", ago(25 * HOUR)],
    ])
  })

  it("a second showing within the day is not counted, and nothing is written", async () => {
    h.results.push({ data: row({ welcome_offer_seen_at: ago(HOUR), welcome_offer_shown_count: 1, welcome_offer_last_shown_at: ago(HOUR) }) })
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: null, counted: false })
    expect(h.calls).toHaveLength(1)
  })

  it("an account that closed it under the old rule: that close is the first showing, this is the second", async () => {
    h.results.push({ data: row({ welcome_offer_seen_at: ago(40 * HOUR) }) }, { data: [{ id: USER }] })
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: null, counted: true })
    expect(h.calls[1].values).toEqual({ welcome_offer_shown_count: 2, welcome_offer_last_shown_at: NOW_ISO })
  })

  it("…and within a day of that close, it is not counted", async () => {
    h.results.push({ data: row({ welcome_offer_seen_at: ago(HOUR) }) })
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: null, counted: false })
    expect(h.calls).toHaveLength(1)
  })

  it.each([
    ['after "Maybe later"', { welcome_offer_seen_at: ago(50 * HOUR), welcome_offer_declined_at: ago(50 * HOUR), welcome_offer_shown_count: 1, welcome_offer_last_shown_at: ago(50 * HOUR) }],
    ["after the third showing, however long ago", { welcome_offer_seen_at: ago(200 * HOUR), welcome_offer_shown_count: 3, welcome_offer_last_shown_at: ago(100 * HOUR) }],
    ["with the grant no longer unclaimed", { free_grant_state: "granted" }],
    ["with the grant withheld", { free_grant_state: "withheld" }],
  ])("a post when the popup is not due counts nothing and writes nothing (%s)", async (_label, over) => {
    h.results.push({ data: row(over) })
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: null, counted: false })
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].columns).toContain("free_grant_state")
  })

  it("the count never passes three, however many posts arrive a day apart", async () => {
    h.results.push({ data: row({ welcome_offer_seen_at: ago(80 * HOUR), welcome_offer_shown_count: 2, welcome_offer_last_shown_at: ago(30 * HOUR) }) }, { data: [{ id: USER }] })
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: null, counted: true })
    expect(h.calls[1].values).toMatchObject({ welcome_offer_shown_count: 3 })
    h.results.push({ data: row({ welcome_offer_seen_at: ago(80 * HOUR), welcome_offer_shown_count: 3, welcome_offer_last_shown_at: ago(30 * HOUR) }) })
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: null, counted: false })
    expect(h.calls).toHaveLength(3)
  })

  it("a lost race (the row changed since the read) matches nothing: not counted, not an error", async () => {
    h.results.push({ data: row() }, { data: [] })
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: null, counted: false })
  })

  it.each([
    ["Postgres 42703", MISSING_COLUMN],
    ["PostgREST PGRST204", SCHEMA_CACHE_MISS],
  ])("without the counting columns (%s): the old stamp, first one wins", async (_label, missing) => {
    h.results.push({ error: missing }, {})
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: null, counted: false })
    const stamp = h.calls[1]
    expect(stamp.values).toEqual({ welcome_offer_seen_at: NOW_ISO })
    expect(stamp.filters).toEqual([
      ["eq", "id", USER],
      ["is", "welcome_offer_seen_at", null],
    ])
  })

  it("no profile row: nothing to count", async () => {
    h.results.push({ data: null })
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: null, counted: false })
    expect(h.calls).toHaveLength(1)
  })

  it("a read or write failure is reported", async () => {
    h.results.push({ error: { code: "57014", message: "statement timeout" } })
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: "statement timeout", counted: false })
    h.results.push({ data: row() }, { error: { code: "40001", message: "serialization failure" } })
    expect(await recordWelcomePopupShown(USER, NOW)).toEqual({ error: "serialization failure", counted: false })
  })
})

describe("recordWelcomePopupLater", () => {
  it('"Maybe later": declined and first shown, each only when empty', async () => {
    h.results.push({}, {})
    expect(await recordWelcomePopupLater(USER, NOW)).toEqual({ error: null })
    expect(h.calls.map((c) => [c.values, c.filters])).toEqual([
      [{ welcome_offer_declined_at: NOW_ISO }, [["eq", "id", USER], ["is", "welcome_offer_declined_at", null]]],
      [{ welcome_offer_seen_at: NOW_ISO }, [["eq", "id", USER], ["is", "welcome_offer_seen_at", null]]],
    ])
  })

  it.each([
    ["Postgres 42703", MISSING_COLUMN],
    ["PostgREST PGRST204", SCHEMA_CACHE_MISS],
  ])("without the counting columns (%s): the old stamp alone, not an error", async (_label, missing) => {
    h.results.push({ error: missing }, {})
    expect(await recordWelcomePopupLater(USER, NOW)).toEqual({ error: null })
    expect(h.calls[1].values).toEqual({ welcome_offer_seen_at: NOW_ISO })
  })

  it("any other failure is reported, and stamps nothing more", async () => {
    h.results.push({ error: { code: "57014", message: "statement timeout" } })
    expect(await recordWelcomePopupLater(USER, NOW)).toEqual({ error: "statement timeout" })
    expect(h.calls).toHaveLength(1)
    h.results.push({}, { error: { code: "57014", message: "timeout again" } })
    expect(await recordWelcomePopupLater(USER, NOW)).toEqual({ error: "timeout again" })
  })
})
