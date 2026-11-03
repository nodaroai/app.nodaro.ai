/**
 * The restore window noted on the case (lib/reconcile/counter-notice-windows.ts):
 * once when it opens and once on the weekday before its last day, by the New
 * York date, only for a counter-notice still waiting for a decision; a note
 * claimed by another server first is not written twice, a note that fails
 * releases its claim for the next pass, the administrators' Slack is told
 * where the edition has one, and nothing is restored or forwarded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { MemoryDb } from "../../../test/memory-tables.js"

const db = vi.hoisted(() => ({ tables: {}, beforeWrite: {} }) as MemoryDb)
const log = vi.hoisted(() => ({
  events: [] as Array<[string, string, string, Record<string, unknown>]>,
  failNext: false,
  admin: false,
  alerts: [] as Array<[string, string]>,
  alertFails: false,
}))

vi.mock("../../supabase.js", async () => {
  const { memorySupabase } = await import("../../../test/memory-tables.js")
  return { supabase: memorySupabase(db) }
})
vi.mock("../../config.js", () => ({ hasAdmin: () => log.admin }))
vi.mock("../../rights-complaints.js", () => ({
  recordComplaintEvent: vi.fn(async (id: string, kind: string, actor: string, data: Record<string, unknown>) => {
    if (log.failNext) {
      log.failNext = false
      throw new Error("events are down")
    }
    log.events.push([id, kind, actor, data])
  }),
}))
vi.mock("../../../ee/lib/counter-notice-alerts.js", () => ({
  alertCounterNoticeWindow: vi.fn(async (moment: string, alert: { reference: string }) => {
    if (log.alertFails) throw new Error("slack is down")
    log.alerts.push([moment, alert.reference])
    return true
  }),
}))

import { noteCounterNoticeWindows } from "../counter-notice-windows.js"

const waiting = (over: Record<string, unknown>) => ({
  reference: "CN-2026-000001",
  complaint_id: "c-1",
  window_opens_on: "2026-12-09",
  window_closes_on: "2026-12-11",
  restored_at: null,
  court_action_at: null,
  declined_at: null,
  window_opened_noted_at: null,
  window_closing_noted_at: null,
  ...over,
})

const noticeRow = (id: string) => db.tables.rights_counter_notices!.find((r) => r.id === id)!

beforeEach(() => {
  db.tables = {
    rights_counter_notices: [
      waiting({ id: "n-1" }),
      waiting({ id: "n-restored", reference: "CN-2026-000002", restored_at: "2026-12-09T00:00:00Z" }),
      waiting({ id: "n-court", reference: "CN-2026-000003", court_action_at: "2026-12-01T00:00:00Z" }),
      waiting({ id: "n-declined", reference: "CN-2026-000005", declined_at: "2026-12-01T00:00:00Z" }),
      waiting({ id: "n-later", reference: "CN-2026-000004", window_opens_on: "2026-12-21", window_closes_on: "2026-12-24" }),
    ],
  }
  db.beforeWrite = {}
  log.events = []
  log.failNext = false
  log.admin = false
  log.alerts = []
  log.alertFails = false
})

const kinds = () => log.events.map(([, kind, , data]) => `${kind}:${String(data.reference)}`)

describe("noteCounterNoticeWindows", () => {
  it("notes nothing before a window opens (the New York date, not UTC's)", async () => {
    // 2026-12-09 01:00 UTC is still 8 December in New York.
    expect(await noteCounterNoticeWindows(new Date("2026-12-09T01:00:00Z"))).toEqual({ noted: 0, errors: 0 })
    expect(log.events).toEqual([])
  })

  it("notes the opening once, then the closing once on the weekday before the last day, for waiting counter-notices only", async () => {
    expect(await noteCounterNoticeWindows(new Date("2026-12-09T17:00:00Z"))).toEqual({ noted: 1, errors: 0 })
    expect(await noteCounterNoticeWindows(new Date("2026-12-10T17:00:00Z"))).toEqual({ noted: 1, errors: 0 })
    expect(await noteCounterNoticeWindows(new Date("2026-12-11T17:00:00Z"))).toEqual({ noted: 0, errors: 0 })
    expect(kinds()).toEqual(["restore_window_opened:CN-2026-000001", "restore_window_closing:CN-2026-000001"])
    expect(log.events[0]).toEqual(["c-1", "restore_window_opened", "system", { reference: "CN-2026-000001", opensOn: "2026-12-09", closesOn: "2026-12-11" }])
  })

  it("a last day on a Monday is warned of on the Friday before", async () => {
    db.tables.rights_counter_notices = [waiting({ id: "n-1", window_opens_on: "2026-12-10", window_closes_on: "2026-12-14", window_opened_noted_at: "noted" })]
    expect(await noteCounterNoticeWindows(new Date("2026-12-10T17:00:00Z"))).toEqual({ noted: 0, errors: 0 })
    expect(await noteCounterNoticeWindows(new Date("2026-12-11T17:00:00Z"))).toEqual({ noted: 1, errors: 0 })
    expect(kinds()).toEqual(["restore_window_closing:CN-2026-000001"])
  })

  it("a pass that missed both days writes both notes", async () => {
    expect(await noteCounterNoticeWindows(new Date("2026-12-15T17:00:00Z"))).toEqual({ noted: 2, errors: 0 })
    expect(kinds()).toEqual(["restore_window_opened:CN-2026-000001", "restore_window_closing:CN-2026-000001"])
  })

  it("a note another server claimed first is not written again", async () => {
    db.beforeWrite = {
      rights_counter_notices: () => {
        db.tables.rights_counter_notices = db.tables.rights_counter_notices!.map((r) => (r.id === "n-1" ? { ...r, window_opened_noted_at: "elsewhere" } : r))
      },
    }
    expect(await noteCounterNoticeWindows(new Date("2026-12-09T17:00:00Z"))).toEqual({ noted: 0, errors: 0 })
    expect(log.events).toEqual([])
  })

  it("a counter-notice restored between the read and the claim is not noted", async () => {
    db.beforeWrite = {
      rights_counter_notices: () => {
        db.tables.rights_counter_notices = db.tables.rights_counter_notices!.map((r) => (r.id === "n-1" ? { ...r, restored_at: "2026-12-09T16:59:00Z" } : r))
      },
    }
    expect(await noteCounterNoticeWindows(new Date("2026-12-09T17:00:00Z"))).toEqual({ noted: 0, errors: 0 })
    expect(noticeRow("n-1").window_opened_noted_at).toBeNull()
  })

  it("a note that fails releases its claim, and the next pass writes it", async () => {
    log.failNext = true
    expect(await noteCounterNoticeWindows(new Date("2026-12-09T17:00:00Z"))).toEqual({ noted: 0, errors: 1 })
    expect(noticeRow("n-1").window_opened_noted_at).toBeNull()
    expect(await noteCounterNoticeWindows(new Date("2026-12-09T17:05:00Z"))).toEqual({ noted: 1, errors: 0 })
    expect(kinds()).toEqual(["restore_window_opened:CN-2026-000001"])
  })

  it("tells the administrators' Slack where the edition has one; a failed alert never fails the note", async () => {
    await noteCounterNoticeWindows(new Date("2026-12-09T17:00:00Z"))
    expect(log.alerts).toEqual([])
    log.admin = true
    await noteCounterNoticeWindows(new Date("2026-12-10T17:00:00Z"))
    expect(log.alerts).toEqual([["closing", "CN-2026-000001"]])
    db.tables.rights_counter_notices = [waiting({ id: "n-2", reference: "CN-2026-000009" })]
    log.alertFails = true
    expect(await noteCounterNoticeWindows(new Date("2026-12-09T17:00:00Z"))).toEqual({ noted: 1, errors: 0 })
  })

  it("a backlog of decided counter-notices never crowds a waiting one out of a pass", async () => {
    const decided = Array.from({ length: 200 }, (_, i) =>
      waiting({ id: `n-decided-${i}`, reference: `CN-2026-1${String(i).padStart(5, "0")}`, declined_at: "2026-12-01T00:00:00Z" }),
    )
    db.tables.rights_counter_notices = [...decided, waiting({ id: "n-1" })]
    expect(await noteCounterNoticeWindows(new Date("2026-12-09T17:00:00Z"))).toEqual({ noted: 1, errors: 0 })
    expect(kinds()).toEqual(["restore_window_opened:CN-2026-000001"])
  })

  it("never restores or forwards", async () => {
    await noteCounterNoticeWindows(new Date("2026-12-15T17:00:00Z"))
    const n1 = noticeRow("n-1")
    expect(n1).toMatchObject({ restored_at: null, court_action_at: null, declined_at: null })
    expect(n1.window_opened_noted_at).toBeTruthy()
    expect(n1.window_closing_noted_at).toBeTruthy()
  })
})
