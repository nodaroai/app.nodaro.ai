/**
 * The owner's view of what complaints led to on their content
 * (lib/my-restrictions.ts): only their own restrictions that a case led to,
 * newest first, each with the case's reference and kind, the file by its own
 * name (a restricted row reads as gone elsewhere), the counter-notice sent and
 * where it stands, and whether one can be sent now. Never the complainant,
 * and never the administrator's own note on the restriction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { MemoryDb } from "../../test/memory-tables.js"

const db = vi.hoisted(() => ({ tables: {} }) as MemoryDb)

vi.mock("../supabase.js", async () => {
  const { memorySupabase } = await import("../../test/memory-tables.js")
  return { supabase: memorySupabase(db) }
})

import { listMyRestrictions } from "../my-restrictions.js"

const OWNER = "owner-1"

const notice = (over: Record<string, unknown>) => ({
  reference: "CN-2026-000001",
  received_at: "2026-11-23T20:00:00Z",
  window_opens_on: "2026-12-09",
  window_closes_on: "2026-12-11",
  forwarded_at: null,
  court_action_at: null,
  court_action_ended_at: null,
  declined_at: null,
  declined_reason: null,
  restored_at: null,
  ...over,
})

beforeEach(() => {
  db.tables = {
    content_restrictions: [
      { id: "r-1", asset_id: "a-1", job_id: null, reason: "per the complainant, Jane Doe", complaint_id: "c-1", restricted_at: "2026-11-02T00:00:00Z", lifted_at: null, owner_user_id: OWNER },
      { id: "r-2", asset_id: null, job_id: "j-1", reason: "a likeness", complaint_id: "c-2", restricted_at: "2026-11-03T00:00:00Z", lifted_at: null, owner_user_id: OWNER },
      { id: "r-3", asset_id: "a-3", job_id: null, reason: "lifted", complaint_id: "c-1", restricted_at: "2026-11-01T00:00:00Z", lifted_at: "2026-11-05T00:00:00Z", owner_user_id: OWNER },
      { id: "r-4", asset_id: "a-4", job_id: null, reason: "answered", complaint_id: "c-1", restricted_at: "2026-10-30T00:00:00Z", lifted_at: null, owner_user_id: OWNER },
      { id: "r-5", asset_id: "a-5", job_id: null, reason: "closed case", complaint_id: "c-3", restricted_at: "2026-10-29T00:00:00Z", lifted_at: null, owner_user_id: OWNER },
      { id: "r-6", asset_id: null, job_id: null, reason: "a file since deleted", complaint_id: "c-1", restricted_at: "2026-10-28T00:00:00Z", lifted_at: "2026-11-06T00:00:00Z", owner_user_id: OWNER },
      { id: "r-7", asset_id: "a-7", job_id: null, reason: "declined", complaint_id: "c-1", restricted_at: "2026-10-27T00:00:00Z", lifted_at: null, owner_user_id: OWNER },
      { id: "r-x", asset_id: "a-1", job_id: null, reason: "no case", complaint_id: null, restricted_at: "2026-11-04T00:00:00Z", lifted_at: null, owner_user_id: OWNER },
      { id: "r-y", asset_id: "a-9", job_id: null, reason: "someone else's", complaint_id: "c-1", restricted_at: "2026-11-04T00:00:00Z", lifted_at: null, owner_user_id: "other" },
    ],
    rights_complaints: [
      { id: "c-1", reference: "CR-2026-000001", kind: "copyright", status: "content_restricted", complainant_name_enc: "secret" },
      { id: "c-2", reference: "CR-2026-000002", kind: "other", status: "content_restricted" },
      { id: "c-3", reference: "CR-2026-000003", kind: "copyright", status: "closed" },
    ],
    assets: [
      { id: "a-1", user_id: OWNER, filename: "clip.mp4", type: "video" },
      { id: "a-3", user_id: OWNER, filename: "old.mp4", type: "video" },
      { id: "a-4", user_id: OWNER, filename: "answered.mp4", type: "video" },
      { id: "a-5", user_id: OWNER, filename: "closed.mp4", type: "video" },
      { id: "a-7", user_id: OWNER, filename: "declined.mp4", type: "video" },
      { id: "a-9", user_id: "other", filename: "theirs.mp4", type: "video" },
    ],
    rights_counter_notices: [
      { restriction_id: "r-4", ...notice({ forwarded_at: "2026-11-24T00:00:00Z" }) },
      { restriction_id: "r-7", ...notice({ reference: "CN-2026-000002", declined_at: "2026-11-25T00:00:00Z", declined_reason: "No physical address was given." }) },
    ],
  }
})

describe("listMyRestrictions", () => {
  it("lists my restrictions a case led to, newest first, and nobody else's", async () => {
    const mine = await listMyRestrictions(OWNER)
    expect(mine.map((r) => r.id)).toEqual(["r-2", "r-1", "r-3", "r-4", "r-5", "r-6", "r-7"])
  })

  it("names the file as I named it, says a job's result is one, and shows neither the complainant nor the administrator's note", async () => {
    const mine = await listMyRestrictions(OWNER)
    expect(mine.find((r) => r.id === "r-1")).toEqual({
      id: "r-1",
      caseReference: "CR-2026-000001",
      caseKind: "copyright",
      restrictedAt: "2026-11-02T00:00:00Z",
      liftedAt: null,
      item: { kind: "file", name: "clip.mp4", type: "video" },
      counterNotice: null,
      canSendCounterNotice: true,
    })
    expect(mine.find((r) => r.id === "r-2")!.item).toEqual({ kind: "result", name: null, type: null })
    const shown = JSON.stringify(mine)
    expect(shown).not.toContain("secret")
    expect(shown).not.toContain("Jane Doe")
  })

  it("a file whose row is gone is still a file, not a result", async () => {
    const mine = await listMyRestrictions(OWNER)
    expect(mine.find((r) => r.id === "r-6")!.item).toEqual({ kind: "file", name: null, type: null })
  })

  it("a counter-notice can be sent for a standing restriction of an open copyright case that has none", async () => {
    const mine = await listMyRestrictions(OWNER)
    const can = Object.fromEntries(mine.map((r) => [r.id, r.canSendCounterNotice]))
    expect(can).toEqual({ "r-1": true, "r-2": false, "r-3": false, "r-4": false, "r-5": false, "r-6": false, "r-7": false })
  })

  it("says where a counter-notice stands, a decline with its reason", async () => {
    const mine = await listMyRestrictions(OWNER)
    expect(mine.find((r) => r.id === "r-4")!.counterNotice).toEqual({
      reference: "CN-2026-000001",
      receivedAt: "2026-11-23T20:00:00Z",
      opensOn: "2026-12-09",
      closesOn: "2026-12-11",
      forwarded: true,
      courtAction: false,
      courtActionEnded: false,
      declined: false,
      declinedReason: null,
      restored: false,
    })
    expect(mine.find((r) => r.id === "r-7")!.counterNotice).toMatchObject({ declined: true, declinedReason: "No physical address was given." })
  })

  it("an account with no restriction gets an empty list", async () => {
    expect(await listMyRestrictions("nobody")).toEqual([])
  })
})
