/**
 * MAINLINE BYTE-IDENTITY, measured rather than argued (spec
 * 2026-09-04-sai-local-development §9.3, D18).
 *
 * The relay delete rule was allowed into the SHARED delete core on one promise:
 * a deployment with no relay target must issue EXACTLY the query sequence it
 * issued before the rule existed. That promise was refuted once already — an
 * adversarial verifier measured four delete paths issuing strictly more queries
 * than `origin/dev`, including a `jobs` round trip ahead of every single job
 * delete on every deployment — so it is now a pin rather than a claim.
 *
 * THE BASELINES BELOW ARE READ OFF `origin/dev`, not off this branch:
 *
 *   permanentlyDeleteAsset (r2_key set, blockOnOwnJobReferrers, no referrers)
 *     assets(referrer) >> jobs(imageUrl) >> jobs(videoUrl) >> jobs(audioUrl)
 *     >> assets(row delete)                                     — 5 queries
 *     (origin/dev asset-delete.ts: the `["imageUrl","videoUrl","audioUrl"]`
 *      loop, then the RETURNING row delete)
 *
 *   deleteJobWithPrivateMedia / deleteWorkflowWithPrivateMedia
 *     the RPC and nothing else                                  — 0 queries
 *     (origin/dev workflow-delete.ts holds exactly one `supabase.rpc`)
 *
 *   deleteOwnedMediaByUrls, proof (b) via output_data->>imageUrl
 *     assets(owned) >> jobs(imageUrl) >> assets(referrer)       — 3 queries
 *
 *   deletableKeys, on any entity permanent delete                — 0 queries
 *
 * The gate is driven directly (`relayPossible` mocked false), NOT by leaving
 * `R2_SHARED_WITH_RELAY_TARGET` unset: that flag also selects
 * `jobOutputReferrerPaths()`, so a future change that armed the rule from
 * somewhere else would slip past a flag-shaped pin.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { relayGate, tables } = vi.hoisted(() => ({
  relayGate: { on: false },
  tables: [] as string[],
}))

vi.mock("../relay-possible.js", () => ({ relayPossible: () => relayGate.on }))

vi.mock("../supabase.js", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))

vi.mock("../config.js", () => ({
  config: { R2_PUBLIC_URL: "https://cdn.test", R2_SHARED_WITH_RELAY_TARGET: false },
}))

vi.mock("../storage.js", () => ({
  deleteFromR2: vi.fn().mockResolvedValue(undefined),
  r2KeyFromOurUrl: (url: string) =>
    url.startsWith("https://cdn.test/") ? url.slice("https://cdn.test/".length) : null,
}))

vi.mock("../../utils/file-validation.js", () => ({
  updateStorageUsage: vi.fn().mockResolvedValue(undefined),
}))

import { permanentlyDeleteAsset, deletableKeys } from "../asset-delete.js"
import { deleteOwnedMediaByUrls } from "../media-delete.js"
import { deleteJobWithPrivateMedia, deleteWorkflowWithPrivateMedia } from "../workflow-delete.js"
import { supabase } from "../supabase.js"

// ---------------------------------------------------------------------------
// A chain stub that records ONE label per query, in issue order: the table plus
// whichever `output_data->>…` filter it carried, so "which three referrer
// probes, in what order" is part of the pin rather than a count.
// ---------------------------------------------------------------------------

type Result = { data?: unknown; error: unknown; count?: number }

function chain(table: string, resultFor: (filters: string[]) => Result) {
  const filters: string[] = []
  let recorded = false
  const record = () => {
    if (recorded) return
    recorded = true
    tables.push(filters.length > 0 ? `${table}[${filters.join(",")}]` : table)
  }
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        const method = String(prop)
        if (method === "then") {
          record()
          return (resolve: (v: unknown) => void) => resolve(resultFor(filters))
        }
        if (method === "maybeSingle" || method === "single") {
          return () => {
            record()
            return Promise.resolve(resultFor(filters))
          }
        }
        return (...args: unknown[]) => {
          if (method === "eq" && String(args[0]).startsWith("output_data")) {
            filters.push(String(args[0]))
          }
          if (method === "in" && String(args[0]) === "relay_job_id") filters.push("STEM-PROBE")
          if (method === "not" && String(args[0]) === "relay_job_id") filters.push("RELAY-ROWS")
          return proxy
        }
      },
    },
  )
  return proxy
}

const NEAR_JOB = "11111111-1111-4000-8000-000000000001"
const USER = "00000000-0000-4000-8000-000000000001"

beforeEach(() => {
  tables.length = 0
  relayGate.on = false
  vi.clearAllMocks()
})

describe("mainline query profile — permanentlyDeleteAsset", () => {
  function useDefault() {
    vi.mocked(supabase.from).mockImplementation(
      (table: string) =>
        chain(table, () => ({ data: [{ id: "asset-1" }], error: null, count: 0 })) as never,
    )
  }

  it("issues the origin/dev sequence for a key IN the job's own family", async () => {
    useDefault()
    await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: `images/${NEAR_JOB}.png`, size_bytes: 10, job_id: NEAR_JOB, relay_job_id: null },
      blockOnOwnJobReferrers: true,
    })
    expect(tables).toEqual([
      "assets",
      "jobs[output_data->>imageUrl]",
      "jobs[output_data->>videoUrl]",
      "jobs[output_data->>audioUrl]",
      "assets",
    ])
  })

  it("issues the origin/dev sequence for a key OUTSIDE the job's family", async () => {
    // The verifier's failure 5: `isRelayedJob` used to fire here, adding a
    // sixth query ahead of the referrer probes.
    useDefault()
    await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: "videos/other.mp4", size_bytes: 10, job_id: NEAR_JOB, relay_job_id: null },
      blockOnOwnJobReferrers: true,
    })
    expect(tables).toEqual([
      "assets",
      "jobs[output_data->>imageUrl]",
      "jobs[output_data->>videoUrl]",
      "jobs[output_data->>audioUrl]",
      "assets",
    ])
  })

  it("issues the origin/dev sequence for a caller that supplied no provenance columns", async () => {
    // `resolveAssetProvenance` used to pay an `assets:maybeSingle` for any
    // caller that did not select job_id AND relay_job_id.
    useDefault()
    await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: `images/${NEAR_JOB}.png`, size_bytes: 10 },
      blockOnOwnJobReferrers: true,
    })
    expect(tables).toEqual([
      "assets",
      "jobs[output_data->>imageUrl]",
      "jobs[output_data->>videoUrl]",
      "jobs[output_data->>audioUrl]",
      "assets",
    ])
  })
})

describe("mainline query profile — workflow-delete", () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockImplementation(
      (table: string) => chain(table, () => ({ data: [], error: null })) as never,
    )
  })

  it("issues NOTHING but the RPC for a job delete with no private media", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { deleted: true, baseUrls: [] }, error: null } as never)
    await deleteJobWithPrivateMedia({ jobId: NEAR_JOB, actorUserId: USER, isAdmin: false })
    expect(tables).toEqual([])
  })

  it("issues NOTHING but the RPC for a job delete WITH a private base", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { deleted: true, baseUrls: [`https://cdn.test/videos/${NEAR_JOB}-stitched.mp4`] },
      error: null,
    } as never)
    await deleteJobWithPrivateMedia({ jobId: NEAR_JOB, actorUserId: USER, isAdmin: false })
    expect(tables).toEqual([])
  })

  it("issues NOTHING but the RPC for a workflow delete WITH a private base", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: { deleted: true, baseUrls: ["https://cdn.test/videos/x-stitched.mp4"] },
      error: null,
    } as never)
    await deleteWorkflowWithPrivateMedia({ workflowId: "wf-1", userId: USER })
    expect(tables).toEqual([])
  })
})

describe("mainline query profile — POST /v1/media/delete, proof (b)", () => {
  it("issues assets(owned) >> jobs(imageUrl) >> assets(referrer) and nothing else", async () => {
    vi.mocked(supabase.from).mockImplementation(
      (table: string) =>
        chain(table, (filters) => {
          if (table === "assets") return { data: null, error: null, count: 0 }
          return { data: [], error: null, count: filters.includes("output_data->>imageUrl") ? 1 : 0 }
        }) as never,
    )

    const res = await deleteOwnedMediaByUrls(USER, [`https://cdn.test/images/${NEAR_JOB}.png`])

    expect(res.deleted).toHaveLength(1)
    expect(tables).toEqual(["assets", "jobs[output_data->>imageUrl]", "assets"])
  })
})

describe("mainline query profile — deletableKeys (locations / objects / creatures / admin-locations)", () => {
  it("issues no query at all and returns the keys unchanged, in order", async () => {
    vi.mocked(supabase.from).mockImplementation(() => {
      throw new Error("must not query")
    })

    const keys = ["images/a.png", "videos/b.mp4"]
    await expect(deletableKeys(keys)).resolves.toEqual(keys)
    expect(tables).toEqual([])
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
  })
})

/**
 * The other half of the pin: with the gate ARMED the extra reads DO appear.
 * Without this a "pin" that passed because the code was deleted would look
 * identical to one that passed because the gate works.
 */
describe("armed, the same paths take the relay reads", () => {
  beforeEach(() => {
    relayGate.on = true
    vi.mocked(supabase.from).mockImplementation(
      (table: string) =>
        chain(table, () => ({ data: [{ id: "asset-1" }], error: null, count: 0 })) as never,
    )
  })

  it("permanentlyDeleteAsset takes the job row read and the stem probe", async () => {
    await permanentlyDeleteAsset({
      userId: USER,
      asset: { id: "asset-1", r2_key: "videos/other.mp4", size_bytes: 10, job_id: NEAR_JOB, relay_job_id: null },
      blockOnOwnJobReferrers: true,
    })
    expect(tables.slice(0, 2)).toEqual(["jobs", "jobs[STEM-PROBE]"])
  })

  it("deletableKeys takes the marker probe and then the stem probe", async () => {
    await deletableKeys(["images/a.png"])
    expect(tables).toEqual(["assets[RELAY-ROWS]", "jobs[STEM-PROBE]"])
  })

  it("the job scope of workflow-delete takes its pre-RPC job row read", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { deleted: true, baseUrls: [] }, error: null } as never)
    await deleteJobWithPrivateMedia({ jobId: NEAR_JOB, actorUserId: USER, isAdmin: false })
    expect(tables).toEqual(["jobs"])
  })
})
