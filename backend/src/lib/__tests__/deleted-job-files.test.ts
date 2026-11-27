// @test-watches supabase/migrations/736_job_delete_answers_recorded_files.sql
/**
 * A job deleted for good: the files its server-only record held are removed
 * unless something still uses them (decided 2026-11-23, lib/deleted-job-files.ts).
 * The delete function's answer is taken as migration 736 gives it; the storage
 * funnel (lib/storage-delete.ts) is the real one, over a fake bucket, so a
 * delete storage does not confirm is seen going to the retry pass.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  /** Library rows: any user's, keyed by what they name. */
  assets: [] as Array<{ id: string; r2_key: string; job_id: string | null }>,
  /** Urls another job's output names. */
  linked: new Set<string>(),
  /** Strings an in-flight job's input carries (a job id, a key). */
  inFlight: new Set<string>(),
  /** Keys held as evidence. */
  held: new Set<string>(),
  /** Keys our relay target made. */
  relay: new Set<string>(),
  /** Keys the bucket fails to delete. */
  bucketFails: new Set<string>(),
  /** Which lookup fails. */
  failing: null as null | "library" | "linked" | "in-flight" | "hold" | "relay",
  skip: false,
  bucket: [] as string[][],
  retries: [] as Array<Record<string, unknown>>,
  usage: [] as Array<[string, number]>,
  rpcCalls: [] as Array<[string, Record<string, unknown>]>,
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      h.rpcCalls.push([fn, args])
      if (fn === "urls_linked_by_jobs_since") {
        if (h.failing === "linked") return { data: null, error: { message: "down" } }
        return { data: (args.p_urls as string[]).filter((u) => h.linked.has(u)), error: null }
      }
      if (fn === "in_flight_job_inputs_naming") {
        if (h.failing === "in-flight") return { data: null, error: { message: "down" } }
        return { data: (args.p_needles as string[]).filter((n) => h.inFlight.has(n)), error: null }
      }
      if (fn === "increment_storage") {
        h.usage.push([String(args.p_user_id), Number(args.p_bytes)])
        return { data: null, error: null }
      }
      return { data: null, error: { message: `unexpected ${fn}` } }
    }),
    from: vi.fn((table: string) => {
      if (table === "assets") {
        return {
          select: () => ({
            in: async (_col: string, keys: string[]) =>
              h.failing === "library"
                ? { data: null, error: { message: "down" } }
                : { data: h.assets.filter((a) => keys.includes(a.r2_key)), error: null },
          }),
        }
      }
      if (table === "storage_delete_retries") {
        return {
          upsert: async (rows: Array<Record<string, unknown>>) => {
            h.retries.push(...rows)
            return { error: null }
          },
        }
      }
      throw new Error(`unexpected table ${table}`)
    }),
  },
}))
vi.mock("../storage.js", () => ({
  batchDeleteFromR2: vi.fn(async (keys: string[]) => {
    h.bucket.push(keys)
    const notDeleted = keys.filter((k) => h.bucketFails.has(k))
    return { deleted: keys.length - notDeleted.length, errors: notDeleted.length, notDeleted, kept: [] }
  }),
  deleteFromR2: vi.fn(),
}))
vi.mock("../legal-hold.js", () => ({
  heldAmong: vi.fn(async (keys: string[]) => {
    if (h.failing === "hold") throw new Error("the hold could not be read")
    return new Set(keys.filter((k) => h.held.has(k)))
  }),
}))
vi.mock("../asset-delete.js", () => ({
  relayOwnedKeysStrict: vi.fn(async (keys: string[]) => {
    if (h.failing === "relay") throw new Error("relay provenance could not be read")
    return new Set(keys.filter((k) => h.relay.has(k)))
  }),
}))
vi.mock("../relay-possible.js", () => ({ relayPossible: () => false }))
vi.mock("../storage-deletes-setting.js", () => ({ storageDeletesSkipped: () => h.skip }))
vi.mock("../../utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn(async (uid: string, delta: number) => { h.usage.push([uid, delta]) }),
}))
vi.mock("../config.js", async (orig) => {
  const real = await orig<{ config: Record<string, unknown> }>()
  return { ...real, config: { ...real.config, R2_PUBLIC_URL: "https://cdn.test", R2_PUBLIC_FALLBACK_DOMAIN: "media.test" } }
})

import {
  _resetRecordedFilesReportForTests,
  recordedFilesOf,
  removableRecordedKeys,
  removeDeletedJobsRecordedFiles,
} from "../deleted-job-files.js"

const JOB = "11111111-2222-4333-8444-555555555555"
const OTHER = "99999999-2222-4333-8444-555555555555"
const ORIGINAL = `videos/${JOB}-master.mov`
const RAW = `videos/${JOB}-raw-abc.mov`
const PREVIEW = `videos/${JOB}.mp4`
const CDN = "https://cdn.test"

/** A delete's answer for one job: its record held `recorded`, its output names `named`. */
function answerFor(recorded: string[], named: string[] = [`${CDN}/${PREVIEW}`], jobId = JOB) {
  return { deleted: true, baseUrls: [], storedBytesByOwner: {}, recordedFilesByJob: { [jobId]: { recorded, named } } }
}

const remove = (answer: unknown) => removeDeletedJobsRecordedFiles(answer)

beforeEach(() => {
  h.assets = []
  h.linked = new Set()
  h.inFlight = new Set()
  h.held = new Set()
  h.relay = new Set()
  h.bucketFails = new Set()
  h.failing = null
  h.skip = false
  h.bucket = []
  h.retries = []
  h.usage = []
  h.rpcCalls = []
  _resetRecordedFilesReportForTests()
})

describe("what a delete answered", () => {
  it("an answer without the field (migration 736 not applied) is undefined: nothing is removed, and it is said once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      expect(recordedFilesOf({ deleted: true, baseUrls: [] })).toBeUndefined()
      await remove({ deleted: true, baseUrls: [] })
      await remove({ deleted: true, baseUrls: [] })
      expect(h.bucket).toEqual([])
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("migration 736 not applied"))).toHaveLength(1)
    } finally {
      warn.mockRestore()
    }
  })

  it("keeps only the job's own files: a key outside its key family, or a malformed job id, is never a candidate", () => {
    const jobs = recordedFilesOf({
      recordedFilesByJob: {
        [JOB]: { recorded: [ORIGINAL, `videos/${OTHER}-master.mov`, "uploads/videos/x.mov"], named: [`${CDN}/${PREVIEW}`, `${CDN}/images/${OTHER}.png`] },
        "not-a-job": { recorded: ["videos/not-a-job-master.mov"], named: [] },
      },
    })!
    expect(jobs).toHaveLength(1)
    expect(jobs[0]!.recorded).toEqual([ORIGINAL])
    expect(jobs[0]!.namedKeys).toEqual([PREVIEW])
  })

  it("an original the job delivered as its result (its output names it) is not removable", () => {
    const [job] = recordedFilesOf(answerFor([ORIGINAL, RAW], [`${CDN}/${ORIGINAL}`]))!
    expect(removableRecordedKeys(job!)).toEqual([RAW])
  })
})

describe("removed when nothing uses it", () => {
  it("removes a deleted job's kept original and raw clip, and gives nothing back", async () => {
    const outcome = await remove(answerFor([ORIGINAL, RAW]))
    expect(h.bucket).toEqual([[ORIGINAL, RAW]])
    expect([...outcome.removed].sort()).toEqual([ORIGINAL, RAW].sort())
    expect(h.usage).toEqual([])
    expect(h.rpcCalls.some(([fn]) => fn === "increment_storage")).toBe(false)
  })

  it("asks in-flight inputs before other jobs' outputs (a completion writes both at once)", async () => {
    await remove(answerFor([ORIGINAL]))
    const order = h.rpcCalls.map(([fn]) => fn).filter((fn) => fn === "in_flight_job_inputs_naming" || fn === "urls_linked_by_jobs_since")
    expect(order).toEqual(["in_flight_job_inputs_naming", "urls_linked_by_jobs_since"])
  })

  it("asks other jobs' outputs at every address the file is served at, and in-flight inputs by the job's id", async () => {
    await remove(answerFor([ORIGINAL]))
    const linkedCall = h.rpcCalls.find(([fn]) => fn === "urls_linked_by_jobs_since")!
    expect(linkedCall[1].p_urls).toEqual([`${CDN}/${ORIGINAL}`, `https://media.test/${ORIGINAL}`])
    const inFlightCall = h.rpcCalls.find(([fn]) => fn === "in_flight_job_inputs_naming")!
    expect(inFlightCall[1].p_needles).toEqual([JOB])
  })
})

describe("kept whenever anything may still use it", () => {
  it("a Library item of the job's preview keeps the original beside it (it goes with that item), never its raw clip", async () => {
    h.assets = [{ id: "a1", r2_key: PREVIEW, job_id: null }]
    const outcome = await remove(answerFor([ORIGINAL, RAW]))
    expect(h.bucket).toEqual([[RAW]])
    expect(outcome.kept.get(ORIGINAL)).toBe("library")
    expect(outcome.removed).toEqual([RAW])
  })

  it("a Library row naming a raw clip itself keeps that clip", async () => {
    h.assets = [{ id: "a3", r2_key: RAW, job_id: null }]
    const outcome = await remove(answerFor([ORIGINAL, RAW]))
    expect(h.bucket).toEqual([[ORIGINAL]])
    expect(outcome.kept.get(RAW)).toBe("library")
  })

  it("a Library item naming the preview keeps the original even when the output no longer names the preview", async () => {
    h.assets = [{ id: "a1", r2_key: PREVIEW, job_id: null }]
    await remove(answerFor([ORIGINAL], []))
    expect(h.bucket).toEqual([])
  })

  it("another user's Library item naming the original itself keeps it", async () => {
    h.assets = [{ id: "a2", r2_key: ORIGINAL, job_id: OTHER }]
    const outcome = await remove(answerFor([ORIGINAL]))
    expect(h.bucket).toEqual([])
    expect(outcome.kept.get(ORIGINAL)).toBe("library")
  })

  it("another job's output naming the file keeps it, under the fallback host too", async () => {
    h.linked = new Set([`https://media.test/${ORIGINAL}`])
    const outcome = await remove(answerFor([ORIGINAL, RAW]))
    expect(h.bucket).toEqual([[RAW]])
    expect(outcome.kept.get(ORIGINAL)).toBe("job-output")
  })

  it("an in-flight job whose input names the deleted job (its file, its result, or the job as a source) keeps all its recorded files", async () => {
    h.inFlight = new Set([JOB])
    const outcome = await remove(answerFor([ORIGINAL, RAW]))
    expect(h.bucket).toEqual([])
    expect(outcome.kept.get(ORIGINAL)).toBe("in-flight-input")
    expect(outcome.kept.get(RAW)).toBe("in-flight-input")
  })

  it("another job's in-flight input keeps only its own job's files", async () => {
    const otherOriginal = `videos/${OTHER}-master.mov`
    h.inFlight = new Set([OTHER])
    const answer = { recordedFilesByJob: { [JOB]: { recorded: [ORIGINAL], named: [] }, [OTHER]: { recorded: [otherOriginal], named: [] } } }
    const outcome = await remove(answer)
    expect(h.bucket).toEqual([[ORIGINAL]])
    expect(outcome.kept.get(otherOriginal)).toBe("in-flight-input")
  })

  it("a file held as evidence is kept", async () => {
    h.held = new Set([ORIGINAL])
    const outcome = await remove(answerFor([ORIGINAL, RAW]))
    expect(h.bucket).toEqual([[RAW]])
    expect(outcome.kept.get(ORIGINAL)).toBe("held")
  })

  it("a file our relay target made is kept", async () => {
    h.relay = new Set([RAW])
    const outcome = await remove(answerFor([ORIGINAL, RAW]))
    expect(h.bucket).toEqual([[ORIGINAL]])
    expect(outcome.kept.get(RAW)).toBe("relay")
  })

  it("a deployment that deletes nothing keeps everything and asks nothing", async () => {
    h.skip = true
    const outcome = await remove(answerFor([ORIGINAL, RAW]))
    expect(h.bucket).toEqual([])
    expect(h.rpcCalls).toEqual([])
    expect(outcome.kept.get(ORIGINAL)).toBe("storage-deletes-off")
  })

  it.each(["library", "linked", "in-flight", "hold", "relay"] as const)("a %s lookup that fails keeps every file and never throws", async (which) => {
    h.failing = which
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const outcome = await remove(answerFor([ORIGINAL, RAW]))
      expect(h.bucket).toEqual([])
      expect(outcome.removed).toEqual([])
      expect(outcome.kept.get(ORIGINAL)).toBe("unchecked")
    } finally {
      warn.mockRestore()
    }
  })
})

describe("a delete storage does not confirm", () => {
  it("is recorded for the retry pass as a job-delete, with its job, and the call still answers", async () => {
    h.bucketFails = new Set([ORIGINAL])
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const outcome = await remove(answerFor([ORIGINAL, RAW]))
      expect(outcome.failed).toEqual([ORIGINAL])
      expect(outcome.removed).toEqual([RAW])
      expect(h.retries).toEqual([expect.objectContaining({ r2_key: ORIGINAL, source: "job-delete", job_id: JOB, url: `${CDN}/${ORIGINAL}` })])
    } finally {
      warn.mockRestore()
    }
  })

  it("a delete that throws records every file for the retry pass and never throws", async () => {
    const { batchDeleteFromR2 } = await import("../storage.js")
    vi.mocked(batchDeleteFromR2).mockRejectedValueOnce(new Error("storage down"))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const outcome = await remove(answerFor([ORIGINAL, RAW]))
      expect([...outcome.failed].sort()).toEqual([ORIGINAL, RAW].sort())
      expect(h.retries.map((r) => [r.r2_key, r.source]).sort()).toEqual([[ORIGINAL, "job-delete"], [RAW, "job-delete"]].sort())
    } finally {
      warn.mockRestore()
    }
  })
})

describe("the in-flight lookup reads the statuses this backend calls in flight", () => {
  it("migration 736 writes out exactly IN_FLIGHT_JOB_STATUSES (literal, so the status index serves a generic plan)", async () => {
    const { readFileSync } = await import("node:fs")
    const { IN_FLIGHT_JOB_STATUSES } = await import("../job-status.js")
    const { IN_FLIGHT_INPUTS_FN } = await import("../deleted-job-files.js")
    const sql = readFileSync(new URL("../../../../supabase/migrations/736_job_delete_answers_recorded_files.sql", import.meta.url), "utf8")
    const body = sql.slice(sql.indexOf(`FUNCTION public.${IN_FLIGHT_INPUTS_FN}(`))
    const literal = /j\.status IN \(([^)]*)\)/.exec(body)?.[1]
    expect(literal).toBeDefined()
    const statuses = [...literal!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect([...statuses].sort()).toEqual([...IN_FLIGHT_JOB_STATUSES].sort())
  })
})
