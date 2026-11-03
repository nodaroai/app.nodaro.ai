// @test-watches supabase/migrations/580_rights_complaints.sql
/**
 * The Complaints screen's words for what the database holds: every status and
 * category the table allows (migration 580) has its label and its place in
 * the screen's own list, and nothing more; the mail link to a complainant can
 * only ever be an address; a file's address is offered to open only when it
 * is not restricted and is https; an account's history reads verified cases
 * apart from unverified ones.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { COMPLAINT_STATUSES, REFERENCE_SEARCH_MAX, searchProblem } from "@/ee/hooks/queries/use-admin-complaints-queries"
import { CATEGORY_LABELS, STATUS_LABELS, historyLabel, mailtoHref, openableAddress, unreadableLabel } from "../complaint-labels"

const MIGRATION = join(import.meta.dirname, "../../../../../../../../supabase/migrations/580_rights_complaints.sql")

/** The quoted values of the table's CHECK on one column, in order. */
function checkValues(column: string): string[] {
  const sql = readFileSync(MIGRATION, "utf8")
  const match = sql.match(new RegExp(`\\n\\s*${column} text NOT NULL(?: DEFAULT '[a-z_]+')? CHECK \\(${column} IN \\(([^)]*)\\)\\)`))
  if (!match) throw new Error(`No CHECK on ${column} in ${MIGRATION}`)
  return [...match[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!)
}

describe("the statuses and categories the table allows", () => {
  it("the screen lists every status, in the table's order, each with a label", () => {
    const statuses = checkValues("status")
    expect(statuses.length).toBeGreaterThan(5)
    expect([...COMPLAINT_STATUSES]).toEqual(statuses)
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([...statuses].sort())
  })

  it("every category has a label, and no label names a category the table does not allow", () => {
    expect(Object.keys(CATEGORY_LABELS).sort()).toEqual(checkValues("category").sort())
  })
})

describe("mailtoHref", () => {
  it("links the address with the case's reference as the subject", () => {
    expect(mailtoHref("dana@example.test", "CR-2026-000001")).toBe("mailto:dana@example.test?subject=CR-2026-000001")
  })

  it("can only ever be an address: what was typed never adds a header or a body", () => {
    const href = mailtoHref("dana@example.test?cc=boss@example.test&body=hi", "CR-1")
    expect(href).toBe("mailto:dana%40example.test%3Fcc%3Dboss@example.test%26body%3Dhi?subject=CR-1")
    expect(new URL(href).searchParams.get("cc")).toBeNull()
    expect(new URL(href).searchParams.get("body")).toBeNull()
  })
})

describe("openableAddress", () => {
  it("offers a file that is not restricted, at an https address", () => {
    expect(openableAddress("https://cdn.test/uploads/a.mp4", null)).toBe(true)
  })

  it("never a restricted file, a missing address, another scheme or no address at all", () => {
    expect(openableAddress("https://cdn.test/uploads/a.mp4", "2026-11-02T00:00:00Z")).toBe(false)
    expect(openableAddress(null, null)).toBe(false)
    expect(openableAddress("javascript:alert(1)", null)).toBe(false)
    expect(openableAddress("http://cdn.test/uploads/a.mp4", null)).toBe(false)
    expect(openableAddress("not a link", null)).toBe(false)
  })
})

describe("searchProblem", () => {
  it("sends a reference or an email; a reference longer than the server takes is said before anything is sent", () => {
    expect(searchProblem("CR-2026-000001")).toBeNull()
    expect(searchProblem("  ")).toBeNull()
    expect(searchProblem(`${"x".repeat(200)}@example.test`)).toBeNull()
    expect(searchProblem("x".repeat(REFERENCE_SEARCH_MAX))).toBeNull()
    expect(searchProblem("x".repeat(REFERENCE_SEARCH_MAX + 1))).toMatch(/at most/)
  })
})

describe("unreadableLabel", () => {
  it("names the details that cannot be read, and says nothing when all were read", () => {
    expect(unreadableLabel(["signature", "phone"])).toBe("signature, phone cannot be read")
    expect(unreadableLabel([])).toBe("")
  })
})

describe("historyLabel", () => {
  it("reads the verified cases by status and the unverified as a count", () => {
    expect(historyLabel({ verified: { under_review: 1, closed: 2 }, unverified: { received: 3 } })).toBe("other cases: 1 under review, 2 closed, 3 unverified")
    expect(historyLabel({ verified: {}, unverified: {} })).toBe("no other cases")
  })
})
