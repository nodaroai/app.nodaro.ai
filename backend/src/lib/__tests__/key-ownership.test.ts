import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Whose file a delete may remove (decided 2026-10-06; migration 480).
 *
 * A row names a file; it does not prove whose the file is. Before 480 a browser
 * could insert an `assets` row with any key, and a job planted before 474 could
 * carry any url in its output. The delete paths a user drives — the library's
 * permanent delete and `POST /v1/media/delete` — would then remove another
 * user's file because the caller's own row named it. They now ask
 * `lib/key-ownership.ts` first.
 */

vi.mock("../supabase.js", () => ({ supabase: { from: vi.fn() } }))

vi.mock("../config.js", () => ({
  config: { R2_PUBLIC_URL: "https://r2.test.com", R2_SHARED_WITH_RELAY_TARGET: false },
}))

vi.mock("../storage.js", () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  r2KeyFromOurUrl: (url: string) =>
    url.startsWith("https://r2.test.com/") ? url.slice("https://r2.test.com/".length) : null,
}))

vi.mock("../../utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn().mockResolvedValue(undefined),
}))

// No relay target: the mainline shape.
vi.mock("../relay-possible.js", () => ({ relayPossible: () => false }))

import { supabase } from "../supabase.js"
import { deleteFromR2 } from "../storage.js"
import { updateStorageUsage } from "../../utils/file-validation.js"
import { keysClaimedByOthers, keyNamespaceOwner, keysHeldByOtherLibraryRows } from "../key-ownership.js"
import { permanentlyDeleteAsset } from "../asset-delete.js"
import { deleteOwnedMediaByUrls } from "../media-delete.js"

type Recorded = { method: string; args: unknown[] }
type Scenario = (table: string, calls: Recorded[], terminal: string) => unknown

function makeChain(table: string, scenario: Scenario) {
  const calls: Recorded[] = []
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      const method = String(prop)
      if (method === "then") {
        return (resolve: (v: unknown) => void) => resolve(scenario(table, calls, "await"))
      }
      if (method === "maybeSingle" || method === "single") {
        return (...args: unknown[]) => {
          calls.push({ method, args })
          return Promise.resolve(scenario(table, calls, method))
        }
      }
      return (...args: unknown[]) => {
        calls.push({ method, args })
        return proxy
      }
    },
  }
  const proxy: Record<string, unknown> = new Proxy({}, handler)
  return proxy
}

function useScenario(scenario: Scenario) {
  vi.mocked(supabase.from).mockImplementation((table: string) => makeChain(table, scenario) as never)
}

const has = (calls: Recorded[], method: string) => calls.some((c) => c.method === method)
/** The ownership read: `jobs.select("id, user_id").in("id", …)`. */
const isMakerLookup = (table: string, calls: Recorded[]) =>
  table === "jobs" && calls.some((c) => c.method === "select" && c.args[0] === "id, user_id")

const ATTACKER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const VICTIM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const VICTIM_JOB = "22222222-2222-4222-8222-222222222222"
const VICTIM_KEY = `audios/${VICTIM_JOB}-vocals.mp3`
const VICTIM_URL = `https://r2.test.com/${VICTIM_KEY}`
const OWN_JOB = "11111111-1111-4111-8111-111111111111"
const OWN_KEY = `images/${OWN_JOB}.png`

const makers = [
  { id: VICTIM_JOB, user_id: VICTIM },
  { id: OWN_JOB, user_id: ATTACKER },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(deleteFromR2).mockResolvedValue(undefined)
})

describe("keysClaimedByOthers", () => {
  it("claims a key for the user whose job made it, and only for them", async () => {
    useScenario((table, calls) => {
      if (isMakerLookup(table, calls)) return { data: makers, error: null }
      if (table === "assets") return { data: [], error: null }
      throw new Error(`unexpected query on ${table}`)
    })

    expect(await keysClaimedByOthers(ATTACKER, [VICTIM_KEY, OWN_KEY])).toEqual(new Set([VICTIM_KEY]))
    expect(await keysClaimedByOthers(VICTIM, [VICTIM_KEY, OWN_KEY])).toEqual(new Set([OWN_KEY]))
  })

  it("claims a key in another user's upload namespace without asking jobs", async () => {
    useScenario((table) => {
      if (table === "assets") return { data: [], error: null }
      throw new Error(`unexpected query on ${table}`)
    })
    const theirs = `uploads/image/${VICTIM}/upload.png`
    const handoff = `uploads/handoff/video/${VICTIM}/x`
    const mine = `uploads/image/${ATTACKER}/upload.png`

    expect(keyNamespaceOwner(theirs)).toBe(VICTIM)
    expect(await keysClaimedByOthers(ATTACKER, [theirs, handoff, mine])).toEqual(new Set([theirs, handoff]))
  })

  it("never sends a non-uuid to the jobs uuid column; a key no job wrote and no library holds stays deletable", async () => {
    useScenario((table) => {
      if (table === "assets") return { data: [], error: null }
      throw new Error(`unexpected query on ${table}`)
    })
    const keys = ["uploads/images/thumb.png", "videos/yt-abc.mp4", "locations/forest/main.png"]
    expect(await keysClaimedByOthers(ATTACKER, keys)).toEqual(new Set())
  })

  /**
   * Content-addressed claim (review round, decided 2026-10-07). Most keys carry
   * no maker: `POST /v1/upload` writes `uploads/<kind>s/<uuid>.<ext>`, and
   * scraped media, split images and copied keys sit outside any job family or
   * namespace. The one thing that says whose such an object is: the `assets`
   * row the upload wrote for its user. Another user's row naming the key claims
   * it, whoever the deleter acts for.
   */
  it("claims a key another user's library row holds, even with no job family or namespace", async () => {
    const victimUpload = "uploads/images/44444444-4444-4444-8444-444444444444.png"
    useScenario((table, calls) => {
      if (isMakerLookup(table, calls)) return { data: [], error: null }
      if (table === "assets" && calls.some((c) => c.method === "select" && c.args[0] === "r2_key, user_id")) {
        return { data: [{ r2_key: victimUpload, user_id: VICTIM }], error: null }
      }
      throw new Error(`unexpected query on ${table}`)
    })

    expect(await keysClaimedByOthers(ATTACKER, [victimUpload, "videos/yt-abc.mp4"])).toEqual(new Set([victimUpload]))
    expect(await keysClaimedByOthers(VICTIM, [victimUpload])).toEqual(new Set())
  })

  it("throws when it cannot ask the library either", async () => {
    useScenario((table) => {
      if (table === "assets") return { data: null, error: { message: "assets timeout" } }
      return { data: [], error: null }
    })
    await expect(keysClaimedByOthers(ATTACKER, ["uploads/images/x.png"])).rejects.toThrow(/assets timeout/)
  })

  it("throws when it cannot ask — a caller that cannot tell must not delete", async () => {
    useScenario(() => ({ data: null, error: { message: "timeout" } }))
    await expect(keysClaimedByOthers(ATTACKER, [VICTIM_KEY])).rejects.toThrow(/timeout/)
  })
})

describe("keysHeldByOtherLibraryRows — a library row another job, or no job, ties to the key", () => {
  const OTHER_JOB = "33333333-3333-4333-8333-333333333333"
  const sameJob = (key: string, jobId: string) => key.includes(jobId)

  it("keeps a key a library row ties to another job or to no job; frees one only its own job's row names", async () => {
    const assetRows = [
      { r2_key: OWN_KEY, job_id: OWN_JOB }, // the job's own library row
      { r2_key: VICTIM_KEY, job_id: OTHER_JOB }, // another job's row
      { r2_key: "images/saved.png", job_id: null }, // a gallery save: no job
    ]
    useScenario((table, calls) => {
      if (table === "assets" && calls.some((c) => c.method === "select" && c.args[0] === "r2_key, job_id")) {
        return { data: assetRows, error: null }
      }
      throw new Error(`unexpected query on ${table}`)
    })
    const held = await keysHeldByOtherLibraryRows([OWN_KEY, VICTIM_KEY, "images/saved.png", "images/orphan.png"], sameJob)
    expect(held).toEqual(new Set([VICTIM_KEY, "images/saved.png"]))
  })

  it("asks nothing for no keys", async () => {
    useScenario((table) => {
      throw new Error(`unexpected query on ${table}`)
    })
    expect(await keysHeldByOtherLibraryRows([], sameJob)).toEqual(new Set())
  })

  it("throws when the lookup fails: a caller that cannot ask must not delete", async () => {
    useScenario(() => ({ data: null, error: { message: "boom" } }))
    await expect(keysHeldByOtherLibraryRows([OWN_KEY], sameJob)).rejects.toThrow(/boom/)
  })
})

describe("permanentlyDeleteAsset — whose file", () => {
  it("attacker: a library row naming another user's file deletes the row, not the file, and refunds nothing", async () => {
    let rowDeletes = 0
    useScenario((table, calls) => {
      if (isMakerLookup(table, calls)) return { data: makers, error: null }
      if (table === "assets" && has(calls, "delete")) {
        rowDeletes++
        return { data: [{ id: "planted" }], error: null }
      }
      // No other library row and no other job names the key: the referrer
      // checks alone would let the delete through.
      if (table === "assets" || table === "jobs") return { count: 0, error: null }
      throw new Error(`unexpected query on ${table}`)
    })

    const result = await permanentlyDeleteAsset({
      userId: ATTACKER,
      asset: { id: "planted", r2_key: VICTIM_KEY, size_bytes: 5_000_000_000, job_id: null, relay_job_id: null },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: false })
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
    expect(vi.mocked(updateStorageUsage)).not.toHaveBeenCalled()
    expect(rowDeletes).toBe(1)
  })

  it("still deletes the user's own file and refunds it", async () => {
    useScenario((table, calls) => {
      if (isMakerLookup(table, calls)) return { data: makers, error: null }
      if (table === "assets" && has(calls, "delete")) return { data: [{ id: "own" }], error: null }
      if (table === "assets" || table === "jobs") return { count: 0, error: null }
      throw new Error(`unexpected query on ${table}`)
    })

    const result = await permanentlyDeleteAsset({
      userId: ATTACKER,
      asset: { id: "own", r2_key: OWN_KEY, size_bytes: 1024, job_id: OWN_JOB, relay_job_id: null },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: true })
    expect(vi.mocked(deleteFromR2)).toHaveBeenCalledWith(OWN_KEY)
    expect(vi.mocked(updateStorageUsage)).toHaveBeenCalledWith(ATTACKER, -1024)
  })

  it("keeps the file when it cannot tell whose it is", async () => {
    useScenario((table, calls) => {
      if (isMakerLookup(table, calls)) return { data: null, error: { message: "timeout" } }
      if (table === "assets" && has(calls, "delete")) return { data: [{ id: "own" }], error: null }
      if (table === "assets" || table === "jobs") return { count: 0, error: null }
      throw new Error(`unexpected query on ${table}`)
    })

    const result = await permanentlyDeleteAsset({
      userId: ATTACKER,
      asset: { id: "own", r2_key: OWN_KEY, size_bytes: 1024, job_id: OWN_JOB, relay_job_id: null },
      blockOnOwnJobReferrers: true,
    })

    expect(result.ok).toBe(true)
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
  })
})

describe("POST /v1/media/delete's job-output proof — whose file", () => {
  it("attacker: a job output naming another user's file (planted before 474) does not delete it", async () => {
    useScenario((table, calls, terminal) => {
      if (isMakerLookup(table, calls)) return { data: makers, error: null }
      // (a) no library row of the caller's names the key.
      if (table === "assets" && terminal === "maybeSingle") return { data: null, error: null }
      // (b) the caller's own (planted) job output names the url.
      if (table === "jobs") return { count: 1, error: null }
      // No library row at all references the key.
      if (table === "assets") return { count: 0, error: null }
      throw new Error(`unexpected query on ${table}`)
    })

    const result = await deleteOwnedMediaByUrls(ATTACKER, [VICTIM_URL])

    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
    expect(result.deleted).toEqual([])
    expect(result.skipped).toEqual([{ url: VICTIM_URL, reason: "not-owned" }])
  })
})
