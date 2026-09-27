/**
 * After a save, the editor asks the server to project trigger nodes onto real
 * trigger rows — only when something about them changed (a removed node
 * counts) or on the first save of a workflow that carries them, vouching only
 * for the ids THIS SESSION added (never one that arrived in the stored graph
 * from elsewhere), retrying a failure on the next save, chaining a save that
 * landed mid-flight, and never as an error: the save has already landed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const apiMock = vi.hoisted(() => ({ syncWorkflowTriggers: vi.fn() }))
vi.mock("@/lib/api", () => ({ syncWorkflowTriggers: (...args: unknown[]) => apiMock.syncWorkflowTriggers(...args) }))

import {
  createTriggerSyncTracker,
  graphHasProjectedTriggers,
  syncTriggersAfterSave,
  triggerFingerprint,
} from "../trigger-sync-after-save"
import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"

const WF = "00000000-0000-4000-8000-000000000020"
const TEXT = { id: "t1", type: "text-prompt" }
const SCHEDULE = { id: "s1", type: "schedule-trigger", data: { cron: "*/5 * * * *" } }
const SCHEDULE_HOURLY = { id: "s1", type: "schedule-trigger", data: { cron: "0 * * * *" } }
const WEBHOOK = { id: "w1", type: "webhook-trigger", data: {} }
const TELEGRAM = { id: "g1", type: "telegram-trigger", data: { connectionId: "conn-1", isActive: true } }
const TELEGRAM_OFF = { id: "g1", type: "telegram-trigger", data: { connectionId: "conn-1", isActive: false } }
const PLANTED = { id: "planted", type: "schedule-trigger", data: { cron: "* * * * *" } }

const ok = { data: { synced: true, created: 1, updated: 0, removed: 0 } }
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  apiMock.syncWorkflowTriggers.mockReset()
  apiMock.syncWorkflowTriggers.mockResolvedValue(ok)
})

describe("graphHasProjectedTriggers / triggerFingerprint", () => {
  it("knows every projected type — schedule, webhook and telegram", () => {
    expect(graphHasProjectedTriggers([TEXT, SCHEDULE])).toBe(true)
    expect(graphHasProjectedTriggers([WEBHOOK])).toBe(true)
    expect(graphHasProjectedTriggers([TEXT, TELEGRAM])).toBe(true)
    expect(graphHasProjectedTriggers([TEXT])).toBe(false)
    expect(graphHasProjectedTriggers(undefined)).toBe(false)
  })

  it("a telegram trigger switched off is still a sync — off is what removes its row", () => {
    // The server projects nothing for an inactive node, and projecting
    // nothing is how the row (and the bot's registration) goes away. A save
    // that skipped the sync would leave the bot talking to us.
    expect(triggerFingerprint([TELEGRAM]).signature)
      .not.toBe(triggerFingerprint([TELEGRAM_OFF]).signature)
  })

  it("the fingerprint changes with a trigger's data and ignores everything else", () => {
    expect(triggerFingerprint([TEXT]).signature).toBe("")
    expect(triggerFingerprint([TEXT, SCHEDULE]).signature).toBe(triggerFingerprint([SCHEDULE, { ...TEXT, data: { prompt: "x" } }]).signature)
    expect(triggerFingerprint([SCHEDULE]).signature).not.toBe(triggerFingerprint([SCHEDULE_HOURLY]).signature)
    expect([...triggerFingerprint([SCHEDULE, WEBHOOK]).ids]).toEqual(["s1", "w1"])
  })
})

describe("syncTriggersAfterSave", () => {
  it("an ordinary save — no trigger node before or after — never calls the server", async () => {
    const tracker = createTriggerSyncTracker()
    expect(await syncTriggersAfterSave(tracker, WF, [TEXT], [TEXT])).toBe("skipped")
    expect(apiMock.syncWorkflowTriggers).not.toHaveBeenCalled()
  })

  it("a save that ADDED a schedule node projects it and vouches for exactly that id", async () => {
    const tracker = createTriggerSyncTracker()
    expect(await syncTriggersAfterSave(tracker, WF, [TEXT], [TEXT, SCHEDULE])).toBe("synced")
    expect(apiMock.syncWorkflowTriggers).toHaveBeenCalledTimes(1)
    expect(apiMock.syncWorkflowTriggers).toHaveBeenCalledWith(WF, ["s1"])
  })

  it("the first save of a workflow that already carries a schedule syncs once — without vouching — so nodes that never had rows get them", async () => {
    const tracker = createTriggerSyncTracker()
    expect(await syncTriggersAfterSave(tracker, WF, [TEXT, SCHEDULE], [TEXT, SCHEDULE])).toBe("synced")
    expect(apiMock.syncWorkflowTriggers).toHaveBeenCalledWith(WF, [])
    // …and only once: the next unchanged save is free.
    expect(await syncTriggersAfterSave(tracker, WF, [TEXT, SCHEDULE], [TEXT, SCHEDULE])).toBe("skipped")
    expect(apiMock.syncWorkflowTriggers).toHaveBeenCalledTimes(1)
  })

  it("a node that was already in the stored graph before this save is never vouched for — only what this session added", async () => {
    const tracker = createTriggerSyncTracker()
    // A schedule someone wrote into the stored graph earlier (before = loaded graph) plus a webhook added now.
    await syncTriggersAfterSave(tracker, WF, [SCHEDULE], [SCHEDULE, WEBHOOK])
    expect(apiMock.syncWorkflowTriggers).toHaveBeenCalledWith(WF, ["w1"])
  })

  it("a node that arrived in the stored graph from someone else (adopted by realtime / a reload) is projected plain, never vouched", async () => {
    const tracker = createTriggerSyncTracker()
    await syncTriggersAfterSave(tracker, WF, [TEXT], [TEXT]) // the server last agreed: no triggers
    // A token planted a schedule; the editor adopted the stored graph; the owner saves a nudge.
    expect(await syncTriggersAfterSave(tracker, WF, [TEXT, PLANTED], [TEXT, PLANTED])).toBe("synced")
    expect(apiMock.syncWorkflowTriggers).toHaveBeenLastCalledWith(WF, [])
  })

  it("a second save that changed nothing about the triggers makes no request", async () => {
    const tracker = createTriggerSyncTracker()
    await syncTriggersAfterSave(tracker, WF, [TEXT], [TEXT, SCHEDULE])
    expect(await syncTriggersAfterSave(tracker, WF, undefined, [{ ...TEXT, data: { prompt: "edited" } }, SCHEDULE])).toBe("skipped")
    expect(apiMock.syncWorkflowTriggers).toHaveBeenCalledTimes(1)
  })

  it("a REMOVED schedule node still syncs — from the tracker's memory, even when the caller has no before-graph", async () => {
    const tracker = createTriggerSyncTracker()
    await syncTriggersAfterSave(tracker, WF, [TEXT], [TEXT, SCHEDULE])
    expect(await syncTriggersAfterSave(tracker, WF, undefined, [TEXT])).toBe("synced")
    expect(apiMock.syncWorkflowTriggers).toHaveBeenLastCalledWith(WF, [])
  })

  it("a changed schedule (new cron) syncs without vouching again", async () => {
    const tracker = createTriggerSyncTracker()
    await syncTriggersAfterSave(tracker, WF, [], [SCHEDULE])
    expect(await syncTriggersAfterSave(tracker, WF, undefined, [SCHEDULE_HOURLY])).toBe("synced")
    expect(apiMock.syncWorkflowTriggers).toHaveBeenLastCalledWith(WF, [])
  })

  it("a failed sync is swallowed, reported, and retried on the next save — still vouching for what this session added", async () => {
    const tracker = createTriggerSyncTracker()
    const onFailure = vi.fn()
    apiMock.syncWorkflowTriggers.mockRejectedValueOnce(new Error("boom"))
    expect(await syncTriggersAfterSave(tracker, WF, [], [SCHEDULE], onFailure)).toBe("failed")
    expect(onFailure).toHaveBeenCalledTimes(1)

    // The delta path advanced the store's snapshot in the meantime (it now
    // holds s1); the retry still vouches for s1 — this session added it.
    expect(await syncTriggersAfterSave(tracker, WF, [SCHEDULE], [SCHEDULE], onFailure)).toBe("synced")
    expect(apiMock.syncWorkflowTriggers).toHaveBeenLastCalledWith(WF, ["s1"])
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it("a server that answers synced:false counts as a failure", async () => {
    const tracker = createTriggerSyncTracker()
    apiMock.syncWorkflowTriggers.mockResolvedValueOnce({ data: { synced: false, created: 0, updated: 0, removed: 0 } })
    expect(await syncTriggersAfterSave(tracker, WF, [], [SCHEDULE])).toBe("failed")
    expect(tracker.pendingRetry).toBe(true)
  })

  it("a save that added a node while a sync was in flight keeps its vouch, even when a later ordinary save is the one replayed", async () => {
    const tracker = createTriggerSyncTracker()
    await syncTriggersAfterSave(tracker, WF, [], [SCHEDULE]) // s1 agreed
    let release: (v: unknown) => void = () => {}
    apiMock.syncWorkflowTriggers.mockReturnValueOnce(new Promise((r) => { release = r }))
    const editSync = syncTriggersAfterSave(tracker, WF, [SCHEDULE], [SCHEDULE_HOURLY]) // in flight: a cron edit
    // Save B adds the webhook; save C is an ordinary autosave whose stored graph already holds it.
    expect(await syncTriggersAfterSave(tracker, WF, [SCHEDULE_HOURLY], [SCHEDULE_HOURLY, WEBHOOK])).toBe("deferred")
    expect(await syncTriggersAfterSave(tracker, WF, [SCHEDULE_HOURLY, WEBHOOK], [SCHEDULE_HOURLY, WEBHOOK])).toBe("deferred")
    release(ok)
    await editSync
    await flush()
    expect(apiMock.syncWorkflowTriggers).toHaveBeenLastCalledWith(WF, ["w1"])
  })

  it("a save that lands while a sync is in flight is run right after it, not raced and not forgotten", async () => {
    const tracker = createTriggerSyncTracker()
    let release: (v: unknown) => void = () => {}
    apiMock.syncWorkflowTriggers.mockReturnValueOnce(new Promise((r) => { release = r }))
    const first = syncTriggersAfterSave(tracker, WF, [], [SCHEDULE])
    expect(await syncTriggersAfterSave(tracker, WF, undefined, [SCHEDULE, WEBHOOK])).toBe("deferred")
    expect(apiMock.syncWorkflowTriggers).toHaveBeenCalledTimes(1)
    release(ok)
    expect(await first).toBe("synced")
    await flush()
    // The deferred change ran on its own, vouching for the webhook this session added.
    expect(apiMock.syncWorkflowTriggers).toHaveBeenCalledTimes(2)
    expect(apiMock.syncWorkflowTriggers).toHaveBeenLastCalledWith(WF, ["w1"])
  })
})

describe("the server's reason", () => {
  it("reaches onFailure when the server refuses with one — the toast can say what to fix", async () => {
    apiMock.syncWorkflowTriggers.mockResolvedValueOnce({
      data: { synced: false, created: 0, updated: 0, removed: 0, reason: "Telegram refused the webhook: Unauthorized" },
    })
    const tracker = createTriggerSyncTracker()
    const onFailure = vi.fn()
    expect(await syncTriggersAfterSave(tracker, WF, [], [TELEGRAM], onFailure)).toBe("failed")
    expect(onFailure).toHaveBeenCalledWith("Telegram refused the webhook: Unauthorized")
  })

  it("is simply absent on a plain refusal", async () => {
    apiMock.syncWorkflowTriggers.mockResolvedValueOnce({ data: { synced: false, created: 0, updated: 0, removed: 0 } })
    const onFailure = vi.fn()
    await syncTriggersAfterSave(createTriggerSyncTracker(), WF, [], [TELEGRAM], onFailure)
    expect(onFailure).toHaveBeenCalledWith(undefined)
  })
})

describe("the Webhook Trigger URL follows the sync", () => {
  it("a successful sync marks the workflow's trigger rows stale, so the editor reads the new URL", async () => {
    const key = queryKeys.workflows.triggers(WF)
    queryClient.setQueryData(key, [])
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)

    const outcome = await syncTriggersAfterSave(createTriggerSyncTracker(), WF, [TEXT], [TEXT, WEBHOOK])

    expect(outcome).toBe("synced")
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  })

  it("a refused sync leaves them as they were", async () => {
    const key = queryKeys.workflows.triggers(WF)
    queryClient.setQueryData(key, [])
    apiMock.syncWorkflowTriggers.mockResolvedValue({ data: { synced: false, created: 0, updated: 0, removed: 0 } })

    await syncTriggersAfterSave(createTriggerSyncTracker(), WF, [TEXT], [TEXT, WEBHOOK])

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
  })
})
