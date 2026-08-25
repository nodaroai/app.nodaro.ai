/**
 * Which account a publish node uses when it names none.
 *
 * "Names none" is the normal case for anything the Copilot builds — it is
 * forbidden to write a destination, so it says which platform and leaves the
 * account alone. Before this, the fallback was `limit(1)` with no ordering: a
 * user holding two accounts on one platform published to an arbitrary one, and
 * which one could change between two runs of the same workflow.
 */
import { describe, expect, it } from "vitest"
import { pickDefaultConnection } from "../execute-publish.js"

type Row = Parameters<typeof pickDefaultConnection>[0][number]

function row(overrides: Record<string, unknown>): Row {
  return { id: "x", user_id: "u1", platform: "telegram", ...overrides } as unknown as Row
}

describe("pickDefaultConnection", () => {
  it("takes the account the user marked", () => {
    const chosen = pickDefaultConnection([
      row({ id: "a", created_at: "2026-01-01T00:00:00Z" }),
      row({ id: "b", created_at: "2026-02-01T00:00:00Z", is_default: true }),
    ])

    expect(chosen?.id).toBe("b")
  })

  it("falls back to the oldest when none is marked", () => {
    // Deterministic is the point. Arbitrary was the bug.
    const chosen = pickDefaultConnection([
      row({ id: "newer", created_at: "2026-05-01T00:00:00Z" }),
      row({ id: "older", created_at: "2026-01-01T00:00:00Z" }),
    ])

    expect(chosen?.id).toBe("older")
  })

  it("works on rows that have no such column yet", () => {
    // Migrations apply on push to `main` and staging shares the production
    // database, so this code runs against a table without `is_default` for as
    // long as a promotion takes. A missing field must read as "not the
    // default", never as an error.
    const chosen = pickDefaultConnection([
      row({ id: "a", created_at: "2026-03-01T00:00:00Z" }),
      row({ id: "b", created_at: "2026-01-01T00:00:00Z" }),
    ])

    expect(chosen?.id).toBe("b")
  })

  it("gives the same answer whatever order the database returned", () => {
    const rows = [
      row({ id: "a", created_at: "2026-01-01T00:00:00Z" }),
      row({ id: "b", created_at: "2026-02-01T00:00:00Z", is_default: true }),
      row({ id: "c", created_at: "2025-01-01T00:00:00Z" }),
    ]

    expect(pickDefaultConnection(rows)?.id).toBe("b")
    expect(pickDefaultConnection([...rows].reverse())?.id).toBe("b")
  })

  it("does not mutate what it was given", () => {
    const rows = [
      row({ id: "newer", created_at: "2026-05-01T00:00:00Z" }),
      row({ id: "older", created_at: "2026-01-01T00:00:00Z" }),
    ]

    pickDefaultConnection(rows)

    expect(rows.map((r) => r.id)).toEqual(["newer", "older"])
  })

  it("has nothing to give when the user has no account", () => {
    expect(pickDefaultConnection([])).toBeUndefined()
  })
})
