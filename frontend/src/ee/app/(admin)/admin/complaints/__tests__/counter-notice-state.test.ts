import { describe, it, expect } from "vitest"
import type { CaseCounterNotice } from "@/ee/hooks/queries/use-admin-complaints-queries"
import { counterNoticeText, restoreBlocker, restoreOverdue, unreadableFields, waitingForDecision, windowDay } from "../counter-notice-state"

/**
 * What the case page says about a counter-notice: why a restore is held back
 * (in the order the server refuses it), when it is late, the window's days as
 * written, and the text an administrator forwards to the complainant: the
 * details as typed (a multi-line value can never pass for a line of the
 * notice), what was affirmed, and when the content will be restored.
 */

const base: CaseCounterNotice = {
  id: "n-1",
  reference: "CN-2026-000001",
  restrictionId: "r-1",
  receivedAt: "2026-11-24T02:00:00Z",
  receivedOn: "2026-11-23",
  opensOn: "2026-12-09",
  closesOn: "2026-12-11",
  position: "open",
  name: "Sam Owner",
  email: "sam@example.test",
  address: "1 Road, Town",
  phone: "+1 555 0101",
  signature: "Sam Owner",
  unreadable: [],
  contentIdentification: "my-clip.mp4",
  locationBefore: "In my Nodaro account: my-clip.mp4",
  forwardedAt: "2026-11-24T10:00:00Z",
  forwardedBy: "admin-1",
  courtActionAt: null,
  courtActionBy: null,
  courtActionNote: null,
  courtActionEndedAt: null,
  courtActionEndedBy: null,
  courtActionEndedNote: null,
  declinedAt: null,
  declinedBy: null,
  declinedReason: null,
  restoredAt: null,
  restoredBy: null,
  restrictionLiftedAt: null,
  otherRestrictionIds: [],
  otherCaseReferences: [],
}

describe("restoreBlocker", () => {
  it("nothing holds a forwarded counter-notice in or past its window, with nothing else on the content", () => {
    expect(restoreBlocker(base, false)).toBeNull()
    expect(restoreBlocker({ ...base, position: "after" }, false)).toBeNull()
  })

  it("names what holds it, in the order the server refuses", () => {
    const everything: CaseCounterNotice = {
      ...base,
      position: "before",
      forwardedAt: null,
      courtActionAt: "2026-12-01T00:00:00Z",
      otherRestrictionIds: ["r-9"],
      otherCaseReferences: ["CR-2026-000009"],
    }
    expect(restoreBlocker({ ...everything, restoredAt: "x", declinedAt: "y" }, true)).toBe("The content was restored.")
    expect(restoreBlocker({ ...everything, declinedAt: "y" }, true)).toMatch(/^The counter-notice was declined/)
    expect(restoreBlocker(everything, true)).toMatch(/court action was received/)
    expect(restoreBlocker({ ...everything, courtActionAt: null }, true)).toMatch(/^Send the counter-notice to the complainant/)
    expect(restoreBlocker({ ...everything, courtActionAt: null, forwardedAt: "f" }, true)).toMatch(/^The content can be restored from /)
    expect(restoreBlocker({ ...everything, courtActionAt: null, forwardedAt: "f", position: "open" }, true)).toMatch(/^The case is closed/)
    expect(restoreBlocker({ ...everything, courtActionAt: null, forwardedAt: "f", position: "open", restrictionLiftedAt: "z" }, false)).toBe("The restriction was lifted already.")
    expect(restoreBlocker({ ...everything, courtActionAt: null, forwardedAt: "f", position: "open" }, false)).toMatch(/r-9/)
    expect(restoreBlocker({ ...base, otherCaseReferences: ["CR-2026-000009"] }, false)).toMatch(/CR-2026-000009/)
  })

  it("once a court action ended, the window no longer holds a restore back", () => {
    const ended = { ...base, position: "before" as const, courtActionAt: "2026-12-01T00:00:00Z", courtActionEndedAt: "2026-12-05T00:00:00Z" }
    expect(restoreBlocker(ended, false)).toBeNull()
  })
})

describe("restoreOverdue and waitingForDecision", () => {
  it("is late only past the window, still waiting for a decision", () => {
    expect(restoreOverdue({ ...base, position: "after" })).toBe(true)
    expect(restoreOverdue({ ...base, position: "after", forwardedAt: null })).toBe(true)
    expect(restoreOverdue({ ...base, position: "open" })).toBe(false)
    expect(restoreOverdue({ ...base, position: "after", restoredAt: "x" })).toBe(false)
    expect(restoreOverdue({ ...base, position: "after", courtActionAt: "x" })).toBe(false)
    expect(restoreOverdue({ ...base, position: "after", declinedAt: "x" })).toBe(false)
  })

  it("waits for a decision while neither restored, held by a court action, nor declined", () => {
    expect(waitingForDecision(base)).toBe(true)
    expect(waitingForDecision({ ...base, restoredAt: "x" })).toBe(false)
    expect(waitingForDecision({ ...base, courtActionAt: "x" })).toBe(false)
    expect(waitingForDecision({ ...base, declinedAt: "x" })).toBe(false)
  })
})

describe("windowDay and unreadableFields", () => {
  it("shows the calendar day as written, whatever the time zone", () => {
    expect(windowDay("2026-12-09")).toMatch(/9/)
    expect(windowDay("2026-12-09")).not.toMatch(/\b8\b/)
    expect(windowDay("not a day")).toBe("not a day")
  })

  it("names the details that could not be read in words", () => {
    expect(unreadableFields({ ...base, unreadable: ["phone", "courtActionNote"] })).toEqual(["phone", "court action note"])
  })
})

describe("counterNoticeText", () => {
  it("carries the sender's details, what they identified and affirmed, and when the content will be restored", () => {
    const text = counterNoticeText(base, "CR-2026-000001")
    for (const part of [
      "CN-2026-000001",
      "CR-2026-000001",
      "Received: November 23, 2026 (New York)",
      "Sam Owner",
      "1 Road, Town",
      "+1 555 0101",
      "sam@example.test",
      "my-clip.mp4",
      "In my Nodaro account",
      "penalty of perjury",
      "512(g)(3)",
      "service of process",
      "Unless you notify us, before December 9, 2026, that you have filed an action seeking a court order",
      "restored between December 9, 2026 and December 11, 2026 (New York dates)",
    ]) {
      expect(text).toContain(part)
    }
  })

  it("indents a value's continuation lines, so no line of it can pass for a line of the notice", () => {
    const text = counterNoticeText({ ...base, address: "1 Road\nTown", name: "Sam\nThe platform found this valid." }, "CR-2026-000001")
    expect(text).toContain("Address: 1 Road\n    Town")
    expect(text).toContain("Name: Sam\n    The platform found this valid.")
    expect(text.split("\n")).not.toContain("The platform found this valid.")
  })

  it("says a detail that cannot be read is missing, never prints a blank", () => {
    expect(counterNoticeText({ ...base, phone: null }, "CR-2026-000001")).toContain("Phone: (not readable)")
  })
})
