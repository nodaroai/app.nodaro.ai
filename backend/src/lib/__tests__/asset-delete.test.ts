import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The relay-owned-object delete rule (spec 2026-09-04-sai-local-development
 * §9.3, D18; invariants 9 and 10a).
 *
 * Two instances, one bucket: under the shared-bucket passthrough the object
 * behind a relayed job's row was created by the FAR end, whose own job row
 * still points at it and which cannot see ours. Both delete paths in this
 * codebase prove "no other referrer" against their OWN database, so without
 * this rule a near-end user deleting their generation destroys an object the
 * hosted instance still owns — silently, and for a job this instance never ran.
 */

vi.mock("../supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

const configMock = vi.hoisted(() => ({
  config: { R2_PUBLIC_URL: "https://r2.test.com", R2_SHARED_WITH_RELAY_TARGET: false },
}))
vi.mock("../config.js", () => configMock)

vi.mock("../storage.js", () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn().mockResolvedValue(undefined),
}))

/**
 * THE ARMING GATE (lib/relay-possible.ts). Mocked rather than driven through
 * `R2_SHARED_WITH_RELAY_TARGET`, on purpose: that flag ALSO switches
 * `jobOutputReferrerPaths()` to the eleven-path list, which would silently
 * rewrite the very query sequences this file's mainline pins assert. Default
 * ON — this file is the relay rule's own test; the pins flip it off.
 */
const relayGate = vi.hoisted(() => ({ on: true }))
vi.mock("../relay-possible.js", () => ({ relayPossible: () => relayGate.on }))

import { permanentlyDeleteAsset, isRelayOwnedObject, relayOwnedKeys, deletableKeys } from "../asset-delete.js"
import { supabase } from "../supabase.js"
import { deleteFromR2 } from "../storage.js"
import { updateStorageUsage } from "../../utils/file-validation.js"

// ---------------------------------------------------------------------------
// Supabase chain mock (same shape as routes/__tests__/media-delete.test.ts):
// a scenario maps (table, recorded builder calls, terminal) -> resolved value.
// ---------------------------------------------------------------------------

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
const eqVal = (calls: Recorded[], col: string) =>
  calls.find((c) => c.method === "eq" && c.args[0] === col)?.args[1]

const USER = "00000000-0000-4000-8000-000000000001"
const NEAR_JOB = "11111111-1111-4000-8000-000000000001"
const FAR_KEY = "images/99999999-far-end-job.png"
const NEAR_KEY = `images/${NEAR_JOB}.png`

/**
 * One scenario covering every query permanentlyDeleteAsset can make.
 * `relayJobId` is what the jobs row answers for the asset's job.
 */
function scenarioFor(opts: {
  relayJobId: string | null
  assetJobId?: string | null
  /** What the ASSETS row's own durable marker answers (migration 384). */
  assetRelayJobId?: string | null
  jobLookupError?: { message: string }
  onRowDelete?: () => void
}): Scenario {
  return (table, calls, terminal) => {
    if (table === "jobs" && terminal === "maybeSingle") {
      // The relay-provenance read.
      expect(eqVal(calls, "id")).toBe(opts.assetJobId ?? NEAR_JOB)
      if (opts.jobLookupError) return { data: null, error: opts.jobLookupError }
      return { data: { relay_job_id: opts.relayJobId }, error: null }
    }
    if (table === "assets" && terminal === "maybeSingle") {
      // The provenance fallback for a caller that selected neither column.
      return {
        data: {
          job_id: opts.assetJobId ?? NEAR_JOB,
          relay_job_id: opts.assetRelayJobId ?? null,
        },
        error: null,
      }
    }
    if (table === "assets" && has(calls, "delete")) {
      opts.onRowDelete?.()
      return { data: [{ id: "asset-1" }], error: null }
    }
    if (table === "assets") return { count: 0, error: null }
    if (table === "jobs") return { count: 0, error: null }
    throw new Error(`unexpected query on ${table}`)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  configMock.config.R2_SHARED_WITH_RELAY_TARGET = false
  relayGate.on = true
  vi.mocked(deleteFromR2).mockResolvedValue(undefined)
})

describe("isRelayOwnedObject", () => {
  it("is false without a key, and reaches no DB at all with the gate closed", async () => {
    useScenario(() => {
      throw new Error("must not query")
    })
    await expect(isRelayOwnedObject(NEAR_JOB, null)).resolves.toBe(false)
    relayGate.on = false
    await expect(isRelayOwnedObject(null, FAR_KEY)).resolves.toBe(false)
    await expect(isRelayOwnedObject(NEAR_JOB, FAR_KEY)).resolves.toBe(false)
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
  })

  it("is false for a key in the job's OWN family without reading the row at all", async () => {
    useScenario(() => {
      throw new Error("must not query")
    })
    await expect(isRelayOwnedObject(NEAR_JOB, NEAR_KEY)).resolves.toBe(false)
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
  })

  it("is true for a foreign key on a job carrying relay_job_id", async () => {
    useScenario(scenarioFor({ relayJobId: "cloud-9" }))
    await expect(isRelayOwnedObject(NEAR_JOB, FAR_KEY)).resolves.toBe(true)
  })

  it("is false for a foreign key on a job with no relay_job_id (mainline)", async () => {
    useScenario(scenarioFor({ relayJobId: null }))
    await expect(isRelayOwnedObject(NEAR_JOB, FAR_KEY)).resolves.toBe(false)
  })

  it("is false on a lookup error — the existing referrer checks fail safe on the same outage", async () => {
    useScenario(scenarioFor({ relayJobId: null, jobLookupError: { message: "db down" } }))
    await expect(isRelayOwnedObject(NEAR_JOB, FAR_KEY)).resolves.toBe(false)
  })
})

describe("permanentlyDeleteAsset — relay-owned objects", () => {
  it("skips the R2 delete AND the quota decrement, but still deletes the row", async () => {
    let rowDeletes = 0
    useScenario(scenarioFor({ relayJobId: "cloud-9", onRowDelete: () => { rowDeletes++ } }))

    const result = await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: FAR_KEY, size_bytes: 4096, job_id: NEAR_JOB },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: false })
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
    // Invariant 10a: the passthrough never incremented, so nothing may be
    // decremented — a decrement here walks storage_used_bytes negative.
    expect(vi.mocked(updateStorageUsage)).not.toHaveBeenCalled()
    expect(rowDeletes).toBe(1)
  })

  it("finds the job through the assets row when the caller did not select job_id", async () => {
    // routes/library.ts selects "id, user_id, r2_key, size_bytes" — no job_id.
    useScenario(scenarioFor({ relayJobId: "cloud-9" }))

    const result = await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: FAR_KEY, size_bytes: 4096 },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: false })
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
  })

  // The laptop. A relaying instance that does NOT share a bucket copied the
  // bytes itself under its own key family, owns them, and must delete them —
  // otherwise every relayed generation leaks an object and ratchets the quota.
  it("still deletes a relayed job's object when the key is this job's own (no shared bucket)", async () => {
    useScenario(scenarioFor({ relayJobId: "cloud-9" }))

    const result = await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: NEAR_KEY, size_bytes: 4096, job_id: NEAR_JOB },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: true })
    expect(vi.mocked(deleteFromR2)).toHaveBeenCalledWith(NEAR_KEY)
    expect(vi.mocked(updateStorageUsage)).toHaveBeenCalledWith(USER, -4096)
  })

  it("is byte-identical to today for a non-relayed job", async () => {
    useScenario(scenarioFor({ relayJobId: null }))

    const result = await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: FAR_KEY, size_bytes: 2048, job_id: NEAR_JOB },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: true })
    expect(vi.mocked(deleteFromR2)).toHaveBeenCalledWith(FAR_KEY)
    expect(vi.mocked(updateStorageUsage)).toHaveBeenCalledWith(USER, -2048)
  })

  it("makes no relay query at all for an asset with no job id", async () => {
    let jobsQueries = 0
    useScenario((table, calls, terminal) => {
      if (table === "jobs" && terminal === "maybeSingle") {
        jobsQueries++
        return { data: null, error: null }
      }
      if (table === "assets" && terminal === "maybeSingle") return { data: { job_id: null }, error: null }
      if (table === "assets" && has(calls, "delete")) return { data: [{ id: "asset-1" }], error: null }
      if (table === "assets") return { count: 0, error: null }
      if (table === "jobs") return { count: 0, error: null }
      throw new Error(`unexpected query on ${table}`)
    })

    const result = await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: FAR_KEY, size_bytes: 1024, job_id: null },
      blockOnOwnJobReferrers: false,
    })

    expect(result).toEqual({ ok: true, r2Deleted: true })
    expect(jobsQueries).toBe(0)
  })
})

/**
 * THE MARKER THAT SURVIVES THE JOB ROW (F2).
 *
 * `assets.job_id` is `REFERENCES jobs(id) ON DELETE SET NULL`
 * (001_initial_schema.sql), so deleting a job from history NULLs it on the
 * surviving library row — and with it the only path to `jobs.relay_job_id`.
 * The library item is still deletable afterwards, and without a marker of its
 * own the near end then destroys the far end's object and refunds bytes it was
 * never charged for. `assets.relay_job_id` (migration 384) is that marker.
 */
describe("permanentlyDeleteAsset — the marker outlives the job row", () => {
  it("keeps the far end's object after the job row is gone (job_id NULLed by the FK)", async () => {
    let rowDeletes = 0
    useScenario(scenarioFor({ relayJobId: null, onRowDelete: () => { rowDeletes++ } }))

    const result = await permanentlyDeleteAsset({
      userId: USER,
      asset: {
        id: "asset-1",
        r2_key: FAR_KEY,
        size_bytes: 4096,
        job_id: null,
        relay_job_id: "cloud-9",
      },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: false })
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
    expect(vi.mocked(updateStorageUsage)).not.toHaveBeenCalled()
    expect(rowDeletes).toBe(1)
  })

  it("reads the marker off the assets row when the caller selected neither column", async () => {
    useScenario(scenarioFor({ relayJobId: null, assetJobId: null, assetRelayJobId: "cloud-9" }))

    const result = await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: FAR_KEY, size_bytes: 4096 },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: false })
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
  })

  // The other direction, and why a "stem names no job of ours ⇒ foreign"
  // fallback was rejected: the ORDINARY mainline sequence (delete the job from
  // history, then delete the library item) leaves exactly the same NULL job_id
  // and must still delete the object, or every such orphan leaks forever.
  it("still deletes a mainline orphan whose job row is gone and carries no marker", async () => {
    useScenario(scenarioFor({ relayJobId: null, assetJobId: null }))

    const result = await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: FAR_KEY, size_bytes: 2048, job_id: null, relay_job_id: null },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: true })
    expect(vi.mocked(deleteFromR2)).toHaveBeenCalledWith(FAR_KEY)
    expect(vi.mocked(updateStorageUsage)).toHaveBeenCalledWith(USER, -2048)
  })

  it("the near-family fence still wins over the marker (a laptop that copied the bytes)", async () => {
    useScenario(scenarioFor({ relayJobId: "cloud-9" }))

    const result = await permanentlyDeleteAsset({
      userId: USER,
      asset: {
        id: "asset-1",
        r2_key: NEAR_KEY,
        size_bytes: 4096,
        job_id: NEAR_JOB,
        relay_job_id: "cloud-9",
      },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: true })
    expect(vi.mocked(deleteFromR2)).toHaveBeenCalledWith(NEAR_KEY)
  })
})

/**
 * The batch half of the same predicate (F4): the delete paths that hold R2
 * KEYS and no job — locations / objects / creatures permanent delete, and
 * workflow-delete's workflow and project scopes.
 */
describe("relayOwnedKeys", () => {
  it("answers the empty set without querying when there are no keys", async () => {
    useScenario(() => {
      throw new Error("must not query")
    })
    await expect(relayOwnedKeys([])).resolves.toEqual(new Set())
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
  })

  it("returns the keys whose assets row carries a relay marker", async () => {
    useScenario((table) => {
      if (table === "assets") {
        return { data: [{ r2_key: FAR_KEY, relay_job_id: "cloud-9" }], error: null }
      }
      throw new Error(`unexpected query on ${table}`)
    })

    await expect(relayOwnedKeys([FAR_KEY, NEAR_KEY])).resolves.toEqual(new Set([FAR_KEY]))
  })

  it("is empty on mainline — no row carries a marker, so every key stays deletable", async () => {
    useScenario((table) => {
      if (table === "assets") return { data: [], error: null }
      throw new Error(`unexpected query on ${table}`)
    })

    await expect(relayOwnedKeys([FAR_KEY, NEAR_KEY])).resolves.toEqual(new Set())
  })

  it("answers the empty set on a lookup error — the same error policy as isRelayOwnedObject", async () => {
    useScenario((table) => {
      if (table === "assets") return { data: null, error: { message: "db down" } }
      throw new Error(`unexpected query on ${table}`)
    })

    await expect(relayOwnedKeys([FAR_KEY])).resolves.toEqual(new Set())
  })
})

/**
 * THE SAVE-TO-STORAGE REFERRER (F3). Under the shared-bucket passthrough
 * `uploadToR2` returns an already-ours URL unchanged, so `POST /v1/save-to-
 * storage` aliases the source object instead of copying it — no second assets
 * row, and its output lands under `output_data.url`, a key the referrer probe
 * never read. Deleting the source then destroys the save node's object and
 * every downstream node that consumed it. No relay is involved in the failing
 * sequence: two NEAR-END jobs share one object.
 */
describe("permanentlyDeleteAsset — the save-to-storage referrer", () => {
  const probedPaths = (): string[] => paths
  let paths: string[] = []

  function probeScenario(hitPath: string | null): Scenario {
    paths = []
    return (table, calls, terminal) => {
      if (table === "jobs" && terminal === "maybeSingle") return { data: { relay_job_id: null }, error: null }
      if (table === "assets" && terminal === "maybeSingle") {
        return { data: { job_id: NEAR_JOB, relay_job_id: null }, error: null }
      }
      if (table === "assets" && has(calls, "delete")) return { data: [{ id: "asset-1" }], error: null }
      if (table === "assets") return { count: 0, error: null }
      if (table === "jobs") {
        const probed = calls.find((c) => c.method === "eq" && String(c.args[0]).startsWith("output_data"))
        const path = String(probed?.args[0] ?? "")
        paths.push(path)
        return { count: hitPath && path === hitPath ? 1 : 0, error: null }
      }
      throw new Error(`unexpected query on ${table}`)
    }
  }

  it("keeps the object when a save-to-storage job references it under output_data.url", async () => {
    configMock.config.R2_SHARED_WITH_RELAY_TARGET = true
    useScenario(probeScenario("output_data->>url"))

    const result = await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: NEAR_KEY, size_bytes: 4096, job_id: NEAR_JOB, relay_job_id: null },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: false })
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
    expect(probedPaths()).toContain("output_data->>url")
    // The row still goes, and its quota with it — only the bytes stay.
    expect(vi.mocked(updateStorageUsage)).toHaveBeenCalledWith(USER, -4096)
  })

  // Mainline byte-identity: flag off, exactly the three queries this route has
  // always issued, in the same order.
  it("probes exactly the original three paths when the flag is off", async () => {
    useScenario(probeScenario(null))

    const result = await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: NEAR_KEY, size_bytes: 4096, job_id: NEAR_JOB, relay_job_id: null },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: true })
    expect(probedPaths()).toEqual([
      "output_data->>imageUrl",
      "output_data->>videoUrl",
      "output_data->>audioUrl",
    ])
  })
})

// ===========================================================================
// THE STEM FENCE — the third line, and the only one that survives BOTH row
// markers being deleted.
//
// The far end's key stem IS the far end's job id (migration 384's comment), and
// `jobs.relay_job_id` stores exactly that id under migration 383's partial
// index. So the fence asks the OBJECT, not a row that may be gone:
//   - `assets.relay_job_id` dies with the asset row (the gallery-save case: a
//     SECOND user's row never carried the marker at all — only
//     `createAssetFromJob` writes it, `save-generated` does not).
//   - `jobs.relay_job_id` on the referring job dies with a job-history delete.
// Each scenario below is a delete that reached the FAR end's bytes before this
// fence existed, reproduced from the adversarial verifier's runs.
// ===========================================================================

const FAR_JOB = "ffffffff-ffff-4000-8000-000000000001"
const FAR_STEM_KEY = `images/${FAR_JOB}.png`

/** The stem probe: `jobs.relay_job_id in (<candidates>)`. */
const isStemProbe = (calls: Recorded[]) =>
  calls.some((c) => c.method === "in" && c.args[0] === "relay_job_id")

describe("the stem fence", () => {
  it("keeps the far end's object for a gallery-save row that carries NO marker", async () => {
    // User2 saved User1's relayed output from the public gallery:
    // routes/library.ts's save-generated insert writes r2_key and nothing else
    // — no job_id, no relay_job_id — and User1's marked row is already gone.
    let stemProbes = 0
    useScenario((table, calls, terminal) => {
      if (table === "assets" && terminal === "maybeSingle") return { data: null, error: null }
      if (table === "assets" && has(calls, "delete")) return { data: [{ id: "B" }], error: null }
      if (table === "assets") return { count: 0, error: null }
      if (table === "jobs" && isStemProbe(calls)) {
        stemProbes++
        expect(calls.find((c) => c.method === "in")?.args[1]).toContain(FAR_JOB)
        return { data: [{ relay_job_id: FAR_JOB }], error: null }
      }
      if (table === "jobs") return { count: 0, error: null }
      throw new Error(`unexpected query on ${table}`)
    })

    const result = await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "B", r2_key: FAR_STEM_KEY, size_bytes: 0, job_id: null, relay_job_id: null },
      blockOnOwnJobReferrers: true,
    })

    expect(result).toEqual({ ok: true, r2Deleted: false })
    expect(vi.mocked(deleteFromR2)).not.toHaveBeenCalled()
    expect(stemProbes).toBe(1)
  })

  it("keeps the far end's key in deletableKeys after the marked asset row is gone", async () => {
    // locations / objects / creatures / admin-locations permanent delete, run
    // AFTER the library row that carried assets.relay_job_id was deleted.
    useScenario((table, calls) => {
      if (table === "assets") return { data: [], error: null }
      if (table === "jobs" && isStemProbe(calls)) {
        return { data: [{ relay_job_id: FAR_JOB }], error: null }
      }
      throw new Error(`unexpected query on ${table}`)
    })

    await expect(deletableKeys([FAR_STEM_KEY, NEAR_KEY])).resolves.toEqual([NEAR_KEY])
  })

  it("finds the far job id inside a suffixed key (<farJobId>-seg1)", async () => {
    useScenario((table, calls) => {
      if (table === "assets") return { data: [], error: null }
      if (table === "jobs" && isStemProbe(calls)) {
        expect(calls.find((c) => c.method === "in")?.args[1]).toContain(FAR_JOB)
        return { data: [{ relay_job_id: FAR_JOB }], error: null }
      }
      throw new Error(`unexpected query on ${table}`)
    })

    await expect(relayOwnedKeys([`videos/${FAR_JOB}-seg1.mp4`])).resolves.toEqual(
      new Set([`videos/${FAR_JOB}-seg1.mp4`]),
    )
  })

  it("does not fence a key whose stem no relayed row claims", async () => {
    useScenario((table, calls) => {
      if (table === "assets") return { data: [], error: null }
      if (table === "jobs" && isStemProbe(calls)) return { data: [], error: null }
      throw new Error(`unexpected query on ${table}`)
    })

    await expect(deletableKeys([NEAR_KEY])).resolves.toEqual([NEAR_KEY])
  })

  it("keeps the marker probe's answer when the stem probe errors, and vice versa", async () => {
    useScenario((table, calls) => {
      if (table === "assets") return { data: [{ r2_key: NEAR_KEY, relay_job_id: "cloud-9" }], error: null }
      if (table === "jobs" && isStemProbe(calls)) return { data: null, error: { message: "db down" } }
      throw new Error(`unexpected query on ${table}`)
    })

    await expect(relayOwnedKeys([NEAR_KEY, FAR_STEM_KEY])).resolves.toEqual(new Set([NEAR_KEY]))
  })

  it("issues NO probe at all with the gate closed — the mainline shape", async () => {
    relayGate.on = false
    useScenario(() => {
      throw new Error("must not query")
    })

    await expect(relayOwnedKeys([FAR_STEM_KEY])).resolves.toEqual(new Set())
    await expect(deletableKeys([FAR_STEM_KEY])).resolves.toEqual([FAR_STEM_KEY])
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
  })
})
