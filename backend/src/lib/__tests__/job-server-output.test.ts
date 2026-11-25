// @test-reads-none every store it names is mocked
/**
 * The server-only stored-object record (lib/job-server-output.ts, migration
 * 695, decided 2026-11-22):
 *  - an object exists only if its record lands: a call that errors is
 *    sent again (idempotent on the key) and, when every call errors, the
 *    record is read back;
 *  - every delete claims first and gives back only what its claim answered,
 *    so two deleters of one object give its bytes back once.
 * The SQL itself is proven in supabase/tests/job-stored-objects.behavior.sql.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  recorded: new Map<string, number>(),
  usage: [] as Array<[string, number]>,
  deleted: [] as string[],
  status: "processing",
  /** Errors the next record calls answer, in order (then the fake function runs). */
  rpcErrors: [] as Array<{ code: string | null; message: string }>,
  /** A record call that commits and then loses its answer. */
  commitThenLose: false,
  claimMissing: false,
  readBack: null as null | { data: unknown; error: unknown },
  lookups: { ended: [] as unknown[][], unpruned: [] as unknown[][] },
  lookupCalls: [] as Array<{ fn: string; p_after_id: string | null; p_limit: number }>,
  credits: true,
  row: { status: "cancelled", server_output: null as unknown } as Record<string, unknown>,
  discarding: new Set<string>(),
  discardCalls: [] as string[],
  held: new Set<string>(),
  skipDeletes: false,
  batchThrows: false,
  retried: [] as string[],
  patches: [] as unknown[],
  queued: [] as string[],
  discardFails: false,
  marked: [] as string[],
}))

vi.mock("../config.js", async (orig) => ({ ...(await orig<object>()), hasCredits: () => m.credits }))
vi.mock("../supabase.js", () => ({
  supabase: {
    rpc: vi.fn(async (fn: string, args: { p_key?: string | null; p_keys?: string[]; p_bytes?: number; p_charge?: boolean }) => {
      if (fn === "ended_jobs_with_stored_objects" || fn === "completed_jobs_left_unpruned") {
        const a = args as unknown as { p_after_id: string | null; p_limit: number }
        m.lookupCalls.push({ fn, p_after_id: a.p_after_id, p_limit: a.p_limit })
        const pages = fn === "ended_jobs_with_stored_objects" ? m.lookups.ended : m.lookups.unpruned
        return { data: pages.shift() ?? [], error: null }
      }
      if (fn === "mark_job_pruned") {
        m.marked.push((args as unknown as { p_job_id: string }).p_job_id)
        return { data: true, error: null }
      }
      if (fn === "discard_unrecorded_job_object") {
        if (m.discardFails) return { data: null, error: { code: null, message: "timeout" } }
        const a = args as unknown as { p_key: string; p_phase: string }
        m.discardCalls.push(a.p_phase)
        if (a.p_phase === "begin") {
          if (m.recorded.has(a.p_key)) return { data: { discard: false }, error: null }
          m.discarding.add(a.p_key)
        }
        return { data: { discard: true }, error: null }
      }
      if (fn === "claim_job_stored_objects") {
        if (m.claimMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.claim_job_stored_objects" } }
        const claimed: Record<string, number> = {}
        for (const k of args.p_keys ?? []) {
          if (m.recorded.has(k)) {
            claimed[k] = m.recorded.get(k)!
            m.recorded.delete(k)
          }
        }
        return { data: { owner: "u1", claimed }, error: null }
      }
      if (args.p_key === null) {
        m.patches.push((args as unknown as { p_patch: unknown }).p_patch)
        return { data: { live: true, charged: 0 }, error: null }
      }
      const next = m.rpcErrors.shift()
      if (next) return { data: null, error: next }
      if (m.discarding.has(args.p_key!)) return { data: { live: true, discarded: true }, error: null }
      if (m.status !== "pending" && m.status !== "processing") return { data: { live: false, ended: m.status === "cancelled" || m.status === "failed" }, error: null }
      const previous = m.recorded.get(args.p_key!) ?? 0
      const charged = args.p_charge ? Math.max(args.p_bytes! - previous, 0) : 0
      m.recorded.set(args.p_key!, previous + charged)
      if (charged > 0) m.usage.push(["u1", charged])
      if (m.commitThenLose) {
        m.commitThenLose = false
        return { data: null, error: { code: null, message: "fetch failed: socket hang up" } }
      }
      return { data: { live: true, charged }, error: null }
    }),
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => m.readBack ?? { data: { ...m.row, server_output: m.row.server_output ?? { stored: Object.fromEntries(m.recorded) } }, error: null },
        }),
      }),
    })),
  },
}))
vi.mock("../../utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn(async (uid: string, delta: number) => { m.usage.push([uid, delta]) }),
}))
vi.mock("../storage-delete.js", () => ({
  deleteKeysRecordingFailures: vi.fn(async (keys: string[]) => {
    if (m.batchThrows) throw new Error("malformed batch")
    m.deleted.push(...keys)
    return { deleted: keys.length, errors: 0, notDeleted: [], failed: [] }
  }),
  deleteKeyRecordingFailure: vi.fn(async (key: string) => {
    m.retried.push(key)
  }),
  keyFailures: (keys: string[]) => keys.map((key) => ({ key })),
  recordFailedDeletes: vi.fn(async (files: Array<{ key: string }>) => {
    m.queued.push(...files.map((f) => f.key))
    return { recorded: files.length, unavailable: false }
  }),
}))
vi.mock("../legal-hold.js", () => ({ heldAmong: vi.fn(async (keys: string[]) => new Set(keys.filter((k) => m.held.has(k)))) }))
vi.mock("../storage-deletes-setting.js", () => ({ storageDeletesSkipped: () => m.skipDeletes }))

import {
  claimStoredObjects,
  discardJustStored,
  discardStoredObjectsIfJobEnded,
  discardStoredObjectsOfFailedJob,
  jobIdOfStoreId,
  pruneUnnamedStoredObjects,
  reapRecordedObjects,
  sweepEndedJobsStoredObjects,
  _resetSweepCursorForTests,
  clearRawExtensionUrl,
  completionMayHoldRecordedObjects,
  deliveredKeepsKey,
  recordStoredObjectAndCharge,
  refundClaimedRecordedObjects,
} from "../job-server-output.js"
import { supabase } from "../supabase.js"

const JOB = "11111111-2222-4333-8444-555555555555"
const KEY = `videos/${JOB}-master.mov`
const T0 = "2026-11-23T10:00:00.000Z"

beforeEach(() => {
  m.recorded.clear()
  m.usage.length = 0
  m.deleted.length = 0
  m.status = "processing"
  m.rpcErrors.length = 0
  m.commitThenLose = false
  m.claimMissing = false
  m.readBack = null
  m.lookups = { ended: [], unpruned: [] }
  m.lookupCalls = []
  _resetSweepCursorForTests()
  m.credits = true
  m.row = { status: "cancelled", server_output: null }
  m.discarding.clear()
  m.discardCalls.length = 0
  m.held.clear()
  m.skipDeletes = false
  m.batchThrows = false
  m.retried.length = 0
  m.patches.length = 0
  m.queued.length = 0
  m.discardFails = false
  m.marked.length = 0
})

describe("recording a kept original", () => {
  it("charges its bytes once; a retry that stores it again is charged nothing more", async () => {
    expect(await recordStoredObjectAndCharge({ jobId: JOB, key: KEY, bytes: 9000, begunAt: T0 })).toEqual({ outcome: "recorded", charged: 9000 })
    expect(await recordStoredObjectAndCharge({ jobId: JOB, key: KEY, bytes: 9000, begunAt: T0 })).toEqual({ outcome: "recorded", charged: 0 })
    expect(m.usage).toEqual([["u1", 9000]])
  })

  it("a job that ended while the object was stored: ended, nothing recorded or charged", async () => {
    m.status = "cancelled"
    expect(await recordStoredObjectAndCharge({ jobId: JOB, key: KEY, bytes: 9000, begunAt: T0 })).toEqual({ outcome: "ended" })
    expect(m.recorded.size).toBe(0)
  })

  it("a job already completed (a second finalizer): delivered, never deleted", async () => {
    m.status = "completed"
    expect(await recordStoredObjectAndCharge({ jobId: JOB, key: KEY, bytes: 9000, begunAt: T0 })).toEqual({ outcome: "delivered" })
  })

  it("a call that committed and lost its answer is sent again and charges nothing more", async () => {
    m.commitThenLose = true
    expect(await recordStoredObjectAndCharge({ jobId: JOB, key: KEY, bytes: 9000, begunAt: T0 })).toEqual({ outcome: "recorded", charged: 0 })
    expect(m.usage).toEqual([["u1", 9000]])
    expect(m.recorded.get(KEY)).toBe(9000)
  })

  it("every call failing: the record is read back — recorded stays recorded (never deleted), absent is unrecorded", async () => {
    const err = { code: null, message: "network" }
    m.recorded.set(KEY, 9000)
    m.rpcErrors.push(err, err, err)
    expect((await recordStoredObjectAndCharge({ jobId: JOB, key: KEY, bytes: 9000, begunAt: T0 })).outcome).toBe("recorded")
    m.recorded.clear()
    m.rpcErrors.push(err, err, err)
    expect((await recordStoredObjectAndCharge({ jobId: JOB, key: KEY, bytes: 9000, begunAt: T0 })).outcome).toBe("unrecorded")
    m.rpcErrors.push(err, err, err)
    m.readBack = { data: null, error: { code: null, message: "network" } }
    expect((await recordStoredObjectAndCharge({ jobId: JOB, key: KEY, bytes: 9000, begunAt: T0 })).outcome).toBe("unknown")
  })

  it("names the job a store id belongs to", () => {
    expect(jobIdOfStoreId(`${JOB}-merged`)).toBe(JOB)
    expect(jobIdOfStoreId("upscaled-abc")).toBeUndefined()
  })
})

describe("every delete claims first, and gives back only what it claimed", () => {
  it("two discards of one failed job (the failure write's and the worker's) give its bytes back once", async () => {
    m.recorded.set(KEY, 9000)
    const row = { server_output: { stored: { [KEY]: 9000 } } }
    await discardStoredObjectsOfFailedJob(JOB, row)
    await discardStoredObjectsOfFailedJob(JOB, row)
    expect(m.usage).toEqual([["u1", -9000]])
    expect(m.deleted).toEqual([KEY])
  })

  it("a cancelled row's recorded objects go; a live or completed row is left alone", async () => {
    for (const status of ["processing", "completed"]) {
      m.recorded.set(KEY, 9000)
      m.row = { status, server_output: { stored: { [KEY]: 9000 } } }
      await discardStoredObjectsIfJobEnded(JOB)
    }
    expect(m.deleted).toEqual([])
    m.row = { status: "cancelled", server_output: { stored: { [KEY]: 9000 } } }
    await discardStoredObjectsIfJobEnded(JOB)
    expect(m.deleted).toEqual([KEY])
    expect(m.usage).toEqual([["u1", -9000]])
  })

  it("a sweep or an expunge after a library delete claimed the object gives nothing back again", async () => {
    m.recorded.set(KEY, 9000)
    expect((await claimStoredObjects(JOB, [KEY])).claimed).toEqual({ [KEY]: 9000 })
    expect((await refundClaimedRecordedObjects([{ key: KEY, jobId: JOB }], new Set([KEY]))).refunded).toBe(0)
    expect(m.usage).toEqual([])
  })

  it("a store whose job ended: its object is claimed (if recorded), deleted, and the claim given back", async () => {
    await discardJustStored(JOB, KEY, "ended")
    expect(m.deleted).toEqual([KEY])
    expect(m.usage).toEqual([])
    m.recorded.set(KEY, 9000)
    await discardJustStored(JOB, KEY, "ended")
    expect(m.usage).toEqual([["u1", -9000]])
  })

  it("an unrecorded object is deleted only while no record names its key, and the discard is marked done", async () => {
    await discardJustStored(JOB, KEY, "unrecorded")
    expect(m.deleted).toEqual([KEY])
    expect(m.discardCalls).toEqual(["begin", "done"])
  })

  it("two stores of one job: A (its record failed) never deletes the object B recorded under the same key", async () => {
    m.recorded.set(KEY, 9000)
    await discardJustStored(JOB, KEY, "unrecorded")
    expect(m.deleted).toEqual([])
    expect(m.recorded.get(KEY)).toBe(9000)
  })

  it("while A discards a key, a store that began before records nothing (its upload may be what A deleted)", async () => {
    m.discarding.add(KEY)
    expect(await recordStoredObjectAndCharge({ jobId: JOB, key: KEY, bytes: 9000, begunAt: T0 })).toEqual({ outcome: "unrecorded" })
    expect(m.usage).toEqual([])
  })

  it("never touches a key outside the job's own family", async () => {
    await discardJustStored(JOB, "videos/99999999-8888-4777-8666-555555555555-master.mov", "ended")
    await discardJustStored(JOB, "videos/99999999-8888-4777-8666-555555555555-master.mov", "unrecorded")
    expect(m.deleted).toEqual([])
    expect(m.discardCalls).toEqual([])
  })

  it("a claim that did not run deletes nothing", async () => {
    m.claimMissing = true
    m.recorded.set(KEY, 9000)
    const reap = await reapRecordedObjects([{ jobId: JOB, key: KEY }])
    expect(reap.failedJobIds).toEqual(new Set([JOB]))
    expect(m.deleted).toEqual([])
  })

  it("a claim that fails: nothing is claimed or given back", async () => {
    m.claimMissing = true
    m.recorded.set(KEY, 9000)
    expect((await refundClaimedRecordedObjects([{ key: KEY, jobId: JOB }], new Set([KEY]))).refunded).toBe(0)
    expect(m.deleted).toEqual([])
  })
})

describe("after the completion lands", () => {
  it("prunes what the record holds that the completed output does not name; keeps what it names and the chain's raw clip", async () => {
    const RAW = `videos/${JOB}-raw-abc.mov`
    const OLD = `videos/${JOB}-master.mkv`
    m.recorded.set(KEY, 9000)
    m.recorded.set(RAW, 500)
    m.recorded.set(OLD, 700)
    m.row = {
      status: "completed",
      output_data: { videoUrl: `https://cdn.test/videos/${JOB}.mp4`, originalVideoUrl: `https://cdn.test/${KEY}` },
      server_output: { stored: { [KEY]: 9000, [RAW]: 500, [OLD]: 700 }, rawExtensionUrl: `https://cdn.test/${RAW}` },
    }
    await pruneUnnamedStoredObjects(JOB)
    expect(m.deleted).toEqual([OLD])
    expect(m.usage).toEqual([["u1", -700]])
  })

  it("a row that is not completed is left alone", async () => {
    m.row = { status: "processing", output_data: {}, server_output: { stored: { [KEY]: 9000 } } }
    await pruneUnnamedStoredObjects(JOB)
    expect(m.deleted).toEqual([])
  })
})

describe("the ended-jobs sweep (the cleanup cron)", () => {
  it("reaps the recorded objects of cancelled or failed jobs, through the lookup, a page at a time", async () => {
    const OTHER = "22222222-3333-4444-8555-666666666666"
    const OTHER_KEY = `videos/${OTHER}-master.mp4`
    m.recorded.set(KEY, 9000)
    m.recorded.set(OTHER_KEY, 100)
    m.lookups.ended = [[{ id: JOB, user_id: "u1", stored: { [KEY]: 9000 } }, { id: OTHER, user_id: "u1", stored: { [OTHER_KEY]: 100 } }]]
    const result = await sweepEndedJobsStoredObjects(50)
    expect(m.lookupCalls).toEqual([
      { fn: "ended_jobs_with_stored_objects", p_after_id: null, p_limit: 50 },
      { fn: "completed_jobs_left_unpruned", p_after_id: null, p_limit: 50 },
    ])
    expect(result).toEqual({ jobs: 2, refunded: 9100, failed: 0 })
    expect(m.deleted.sort()).toEqual([KEY, OTHER_KEY].sort())
  })

  it("a page it cannot clear (a held key) never stops it: the next page starts after it, and a run goes on from where the last stopped", async () => {
    const page = (n: number) => Array.from({ length: 2 }, (_, i) => ({ id: `00000000-0000-4000-8000-00000000000${n * 2 + i}`, user_id: "u1", stored: { [`videos/held-${n}-${i}.mp4`]: 1 } }))
    m.lookups.ended = [page(0), page(1), [], page(2)]
    await sweepEndedJobsStoredObjects(2)
    const ended = m.lookupCalls.filter((c) => c.fn === "ended_jobs_with_stored_objects")
    // Page 2 starts after page 1's last row; a short page ends the run and sends the next back to the start.
    expect(ended.map((c) => c.p_after_id)).toEqual([null, page(0)[1]!.id, page(1)[1]!.id])
    m.lookupCalls.length = 0
    await sweepEndedJobsStoredObjects(2)
    expect(m.lookupCalls.filter((c) => c.fn === "ended_jobs_with_stored_objects")[0]!.p_after_id).toBeNull()
  })

  it("stops after a bounded number of pages, and the next run goes on from there", async () => {
    const full = (n: number) => [{ id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`, user_id: "u1", stored: {} }]
    m.lookups.ended = Array.from({ length: 7 }, (_, n) => full(n))
    await sweepEndedJobsStoredObjects(1)
    const first = m.lookupCalls.filter((c) => c.fn === "ended_jobs_with_stored_objects")
    expect(first).toHaveLength(5)
    m.lookupCalls.length = 0
    await sweepEndedJobsStoredObjects(1)
    expect(m.lookupCalls.filter((c) => c.fn === "ended_jobs_with_stored_objects")[0]!.p_after_id).toBe(full(4)[0]!.id)
  })
})

describe("what a reap never touches, and where a spent claim's keys go (decided 2026-11-23)", () => {
  it("a key held as evidence is not claimed, refunded or dropped from its record", async () => {
    m.recorded.set(KEY, 9000)
    m.held.add(KEY)
    const reap = await reapRecordedObjects([{ jobId: JOB, key: KEY }])
    expect(reap.keptKeys).toEqual(new Set([KEY]))
    expect(m.recorded.get(KEY)).toBe(9000)
    expect(m.deleted).toEqual([])
    expect(m.usage).toEqual([])
  })

  it("a deployment that deletes nothing claims nothing", async () => {
    m.recorded.set(KEY, 9000)
    m.skipDeletes = true
    await reapRecordedObjects([{ jobId: JOB, key: KEY }])
    expect(m.recorded.get(KEY)).toBe(9000)
    expect(m.usage).toEqual([])
  })

  it("a delete that throws after the claim sends each key to the retry pass, never back to unclaimed", async () => {
    m.recorded.set(KEY, 9000)
    m.batchThrows = true
    const reap = await reapRecordedObjects([{ jobId: JOB, key: KEY }])
    expect(reap.failedJobIds.size).toBe(0)
    expect(m.retried).toEqual([KEY])
    expect(m.usage).toEqual([["u1", -9000]])
  })
})

describe("a store answered 'delivered'", () => {
  it("keeps its object only when the completed output or record names that very key", async () => {
    m.row = { status: "completed", output_data: { originalVideoUrl: `https://cdn.test/${KEY}` }, server_output: { stored: {} } }
    expect(await deliveredKeepsKey(JOB, KEY)).toBe("named")
    m.row = { status: "completed", output_data: { videoUrl: `https://cdn.test/videos/${JOB}.mp4` }, server_output: { stored: {} } }
    expect(await deliveredKeepsKey(JOB, KEY)).toBe("unnamed")
  })

  it("a job whose row is gone (deleted while its result was stored) names nothing, so the upload is deleted", async () => {
    m.readBack = { data: null, error: null }
    expect(await deliveredKeepsKey(JOB, KEY)).toBe("unnamed")
  })
})

describe("a watermarked Extend's raw clip reference", () => {
  it("is cleared by a patch alone (no key recorded, nothing charged)", async () => {
    expect(await clearRawExtensionUrl(JOB)).toBe(true)
    expect(m.patches).toEqual([{ rawExtensionUrl: null }])
    expect(m.usage).toEqual([])
  })
})

describe("which completions pay the prune's read", () => {
  it("a video result, or a job this process recorded for; never an image, audio or text result", async () => {
    expect(completionMayHoldRecordedObjects("img-job", { imageUrl: "https://cdn.test/images/x.png" })).toBe(false)
    expect(completionMayHoldRecordedObjects("aud-job", { audioUrl: "https://cdn.test/audio/x.mp3" })).toBe(false)
    expect(completionMayHoldRecordedObjects("vid-job", { videoUrl: "https://cdn.test/videos/x.mp4" })).toBe(true)
    await recordStoredObjectAndCharge({ jobId: JOB, key: KEY, bytes: 1, begunAt: T0 })
    expect(completionMayHoldRecordedObjects(JOB, { text: "x" })).toBe(true)
  })
})

describe("no recorded object is left for good (decided 2026-11-23)", () => {
  it("a discard whose database cannot be asked hands the upload to the delete retry pass", async () => {
    m.discardFails = true
    await discardJustStored(JOB, KEY, "unrecorded")
    expect(m.deleted).toEqual([])
    expect(m.queued).toEqual([KEY])
  })

  it("a prune that keeps an unnamed key only because it is held keeps the mark, so a later sweep weighs it again (decided 2026-11-24)", async () => {
    const MASTER = `videos/${JOB}-master.mkv`
    m.recorded.set(MASTER, 700)
    m.row = { status: "completed", output_data: { videoUrl: `https://cdn.test/videos/${JOB}.mp4` }, server_output: { stored: { [MASTER]: 700 }, unpruned: true } }
    m.held.add(MASTER)
    expect(await pruneUnnamedStoredObjects(JOB)).toBe(true)
    expect(m.marked).toEqual([])
    expect(m.deleted).toEqual([])
    // The hold lifts: the next weigh deletes it and marks the job.
    m.held.clear()
    expect(await pruneUnnamedStoredObjects(JOB)).toBe(true)
    expect(m.marked).toEqual([JOB])
    expect(m.deleted).toEqual([MASTER])
  })

  it("a deployment that deletes nothing marks the job as before (its keys are kept for good)", async () => {
    const MASTER = `videos/${JOB}-master.mkv`
    m.recorded.set(MASTER, 700)
    m.row = { status: "completed", output_data: { videoUrl: `https://cdn.test/videos/${JOB}.mp4` }, server_output: { stored: { [MASTER]: 700 }, unpruned: true } }
    m.skipDeletes = true
    expect(await pruneUnnamedStoredObjects(JOB)).toBe(true)
    expect(m.marked).toEqual([JOB])
  })

  it("a completion's prune marks the job done; one whose claim did not run keeps the mark for the sweep", async () => {
    m.recorded.set(`videos/${JOB}-master.mkv`, 700)
    m.row = { status: "completed", output_data: { videoUrl: `https://cdn.test/videos/${JOB}.mp4` }, server_output: { stored: { [`videos/${JOB}-master.mkv`]: 700 }, unpruned: true } }
    m.claimMissing = true
    expect(await pruneUnnamedStoredObjects(JOB)).toBe(false)
    expect(m.marked).toEqual([])
    m.claimMissing = false
    expect(await pruneUnnamedStoredObjects(JOB)).toBe(true)
    expect(m.marked).toEqual([JOB])
    expect(m.deleted).toEqual([`videos/${JOB}-master.mkv`])
  })

  it("the sweep weighs completed jobs whose prune did not finish", async () => {
    m.row = { status: "completed", output_data: { videoUrl: `https://cdn.test/videos/${JOB}.mp4` }, server_output: { stored: {}, unpruned: true } }
    m.lookups.unpruned = [[{ id: JOB, user_id: "u1" }]]
    const result = await sweepEndedJobsStoredObjects()
    expect(result.failed).toBe(0)
    expect(m.marked).toEqual([JOB])
  })
})
