// @test-watches supabase/migrations/*.sql backend/src/ee/lib/repeat-infringers.ts backend/src/ee/lib/complaint-notices.ts
/**
 * The Complaints screen's words for what the database holds: every status and
 * category the table allows (migration 580) has its label and its place in
 * the screen's own list, and nothing more; every measure the record allows
 * (the latest migration that names them: 589 added the suspension) has its
 * label, and every entry the record's moves write to a case's log has its
 * words; the mail link to a complainant can only ever be an address; a file's
 * address is offered to open only when it is not restricted and is https; an
 * account's history reads verified cases apart from unverified ones, and its
 * standing reads its count and what is in force.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { COMPLAINT_STATUSES, REFERENCE_SEARCH_MAX, searchProblem } from "@/ee/hooks/queries/use-admin-complaints-queries"
import { MEASURE_KINDS } from "@/ee/hooks/queries/use-admin-repeat-infringers"
import {
  CATEGORY_LABELS,
  EVENT_LABELS,
  MEASURE_LABELS,
  STATUS_LABELS,
  actorLabel,
  emailOutcome,
  historyLabel,
  mailtoHref,
  measureLabel,
  openableAddress,
  standingLabel,
  unreadableLabel,
} from "../complaint-labels"

const ROOT = join(import.meta.dirname, "../../../../../../../..")

/** The measures the record takes, as the latest migration that names them says (a later one redefines the list whole). */
function measureKindsOfTheRecord(): string[] {
  const dir = join(ROOT, "supabase/migrations")
  const check = /CONSTRAINT account_sanctions_kind CHECK \(kind IN \(([^)]*)\)\)/
  const latest = readdirSync(dir)
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    .map((f) => check.exec(readFileSync(join(dir, f), "utf8")))
    .filter((m): m is RegExpExecArray => m !== null)
    .at(-1)
  return [...latest![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!).sort()
}

describe("measures", () => {
  it("every measure the record allows (the latest migration that names them) has its label, and nothing more", () => {
    const kinds = measureKindsOfTheRecord()
    expect(kinds).toContain("suspended")
    expect(Object.keys(MEASURE_LABELS).sort()).toEqual(kinds)
    expect([...MEASURE_KINDS].sort()).toEqual(kinds)
  })

  it("every entry the record's moves write to a case's log has its words", () => {
    const source = readFileSync(join(ROOT, "backend/src/ee/lib/repeat-infringers.ts"), "utf8")
    const kinds = [...source.matchAll(/recordComplaintEventQuietly\([^,]+,\s*"([a-z_]+)"/g)].map((m) => m[1]!)
    expect(kinds.sort()).toEqual(["infringement_recorded", "infringement_withdrawn", "measure_applied", "measure_lifted"])
    for (const kind of kinds) expect(EVENT_LABELS[kind], kind).toBeTruthy()
  })

  it("names a measure, an import block with its length or until lifted, a suspension with its length", () => {
    expect(measureLabel("warning")).toBe("Warning")
    expect(measureLabel("closed", 30)).toBe("Account closed")
    expect(measureLabel("imports_blocked", 30)).toBe("Importing links blocked for 30 days")
    expect(measureLabel("imports_blocked", 1)).toBe("Importing links blocked for 1 day")
    expect(measureLabel("imports_blocked")).toBe("Importing links blocked until lifted")
    expect(measureLabel("suspended", 14)).toBe("Account suspended for 14 days")
    expect(measureLabel("suspended", 1)).toBe("Account suspended for 1 day")
    expect(measureLabel("suspended")).toBe("Account suspended")
  })

  it("reads an account's standing: its count in the window, then what is in force", () => {
    expect(standingLabel({ inWindow: 0, inForce: [] }, 24)).toBe("0 infringements in 24 months")
    expect(standingLabel({ inWindow: 1, inForce: [] })).toBe("1 infringement in the policy's window")
    expect(standingLabel({ inWindow: 2, inForce: ["imports_blocked", "closed"] }, 12)).toBe("2 infringements in 12 months · importing links blocked, account closed")
    expect(standingLabel({ inWindow: 3, inForce: ["suspended"] }, 12)).toBe("3 infringements in 12 months · account suspended")
  })
})

describe("actorLabel", () => {
  it("names who wrote a log entry: the content's owner (a counter-notice) is never taken for an administrator", () => {
    expect(actorLabel("owner")).toBe("the content's owner")
    expect(actorLabel("system")).toBe("system")
    expect(actorLabel("complainant")).toBe("complainant")
    expect(actorLabel("00000000-aaaa-4000-8000-000000000001")).toBe("admin 00000000")
  })
})

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

describe("the case's emails in its log", () => {
  it("every entry a case's email writes to its log has its words", () => {
    const source = readFileSync(join(ROOT, "backend/src/ee/lib/complaint-notices.ts"), "utf8")
    const kinds = [...source.matchAll(/recordComplaintEventQuietly\([^,]+,\s*"([a-z_]+)"/g)].map((m) => m[1]!)
    expect(kinds.sort()).toEqual(["complainant_notified", "user_notified"])
    for (const kind of kinds) expect(EVENT_LABELS[kind], kind).toBeTruthy()
  })

  it("says whether the email went: sent, not sent and why, or perhaps sent when the mail service did not answer in time", () => {
    expect(emailOutcome({ sent: true, messageId: "m-1" })).toBe("sent")
    expect(emailOutcome({ sent: false, reason: "no_template" })).toBe("not sent: no_template")
    expect(emailOutcome({ sent: false, reason: "failed", error: "Invalid recipient [address]" })).toBe("not sent: failed (Invalid recipient [address])")
    expect(emailOutcome({ sent: "unknown" })).toMatch(/^may have been sent/)
  })
})
