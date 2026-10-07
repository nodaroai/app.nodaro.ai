/**
 * A pipeline entity's asset pointer resolves only to the pipeline owner's
 * asset (decided 2026-10-07; migration 480).
 */
import { describe, expect, it } from "vitest"
import {
  ownedAssetUrlsById,
  pipelineOwnedAssetUrlsById,
  pipelineOwnerId,
  sceneNodeDataAssetIds,
  withoutForeignSceneAssetIds,
} from "../pipeline-asset-ownership.js"

type Row = Record<string, unknown>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A tiny PostgREST stand-in: `.eq` / `.in` filters, awaited or `.maybeSingle()`.
 * Like Postgres, an `.in("id", …)` on `assets` (a uuid column) rejects the
 * whole query with 22P02 when any value is not uuid-shaped.
 */
function fakeSupabase(
  tables: Record<string, Row[]>,
  failing: string[] = [],
  opts: {
    /** Like the gateway's URL limit: an `.in()` list longer than this is refused. */
    maxInList?: number
    /** Every `.in()` list sent, in order. */
    inCalls?: unknown[][]
    /** Refuse the `.in()` call whose 0-based index is listed (a transient chunk failure). */
    failInCall?: number[]
  } = {},
) {
  let inCallCount = 0
  return {
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      let invalidUuid = false
      let refused = false
      const result = () =>
        failing.includes(table) || refused
          ? { data: null, error: { message: "boom" } }
          : invalidUuid
            ? { data: null, error: { code: "22P02", message: "invalid input syntax for type uuid" } }
            : { data: (tables[table] ?? []).filter((row) => filters.every((f) => f(row))), error: null }
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters.push((row) => row[col] === val)
          return chain
        },
        in: (col: string, vals: unknown[]) => {
          if (table === "assets" && col === "id" && vals.some((v) => !UUID_RE.test(String(v)))) invalidUuid = true
          const callIndex = inCallCount++
          opts.inCalls?.push(vals)
          if (opts.maxInList !== undefined && vals.length > opts.maxInList) refused = true
          if (opts.failInCall?.includes(callIndex)) refused = true
          filters.push((row) => vals.includes(row[col]))
          return chain
        },
        maybeSingle: async () => {
          const r = result()
          return { data: r.data?.[0] ?? null, error: r.error }
        },
        then: (resolve: (v: unknown) => unknown) => resolve(result()),
      }
      return chain
    },
  } as never
}

const ASSET_A = "aaaaaaaa-0000-4000-8000-00000000000a"
const ASSET_B = "bbbbbbbb-0000-4000-8000-00000000000b"

const TABLES = {
  pipelines: [{ id: "pipe-a", user_id: "user-a" }],
  assets: [
    { id: ASSET_A, user_id: "user-a", r2_url: "https://r2/a.png" },
    { id: ASSET_B, user_id: "user-b", r2_url: "https://r2/b.png" },
  ],
}

describe("pipeline-asset-ownership", () => {
  it("resolves the pipeline's owner", async () => {
    expect(await pipelineOwnerId(fakeSupabase(TABLES), "pipe-a")).toBe("user-a")
    expect(await pipelineOwnerId(fakeSupabase(TABLES), "missing")).toBeNull()
    expect(await pipelineOwnerId(fakeSupabase(TABLES, ["pipelines"]), "pipe-a")).toBeNull()
  })

  it("attacker: a pointer at another user's asset resolves to nothing", async () => {
    const owned = await ownedAssetUrlsById(fakeSupabase(TABLES), [ASSET_A, ASSET_B], "user-a")
    expect([...owned]).toEqual([[ASSET_A, "https://r2/a.png"]])
  })

  it("resolves through the pipeline's owner", async () => {
    const owned = await pipelineOwnedAssetUrlsById(fakeSupabase(TABLES), "pipe-a", [ASSET_B, ASSET_A, null])
    expect([...owned.keys()]).toEqual([ASSET_A])
  })

  it("fails closed: no owner, or a failed read, yields no asset", async () => {
    expect((await ownedAssetUrlsById(fakeSupabase(TABLES), [ASSET_A], null)).size).toBe(0)
    expect((await ownedAssetUrlsById(fakeSupabase(TABLES, ["assets"]), [ASSET_A], "user-a")).size).toBe(0)
    expect((await pipelineOwnedAssetUrlsById(fakeSupabase(TABLES), "missing", [ASSET_A])).size).toBe(0)
  })

  it("a non-uuid pointer names no asset: it is left out instead of failing the whole lookup", async () => {
    // A free-form metadata.last_attempted_asset_id written before migration 480
    // must not 22P02 the IN query (which, under throwOnError, would make the
    // pipeline impossible to branch).
    const ids = ["not-a-uuid", ASSET_A, "", ASSET_B]
    const owned = await ownedAssetUrlsById(fakeSupabase(TABLES), ids, "user-a", { throwOnError: true })
    expect([...owned]).toEqual([[ASSET_A, "https://r2/a.png"]])
    expect((await ownedAssetUrlsById(fakeSupabase(TABLES), ["not-a-uuid"], "user-a", { throwOnError: true })).size).toBe(0)
  })

  describe("a long id list is asked in chunks (round 3 review, decided 2026-10-07)", () => {
    // A maximal finished pipeline names hundreds of asset ids (20 scenes x 8
    // shots x 5 ids, plus each scene's composite). One `.in()` with all of
    // them is a 20+ KB query string the gateway refuses, which under
    // throwOnError fails the whole branch.
    const many = Array.from({ length: 250 }, (_, i) => `c0000000-0000-4000-8000-${String(i).padStart(12, "0")}`)
    const manyTables = {
      assets: many.map((id, i) => ({ id, user_id: i % 5 === 0 ? "user-b" : "user-a", r2_url: `https://r2/${i}.png` })),
    }
    const ownedOf = (ids: string[]) => ids.filter((_, i) => i % 5 !== 0)

    it("asks several bounded queries and merges their answers", async () => {
      const inCalls: unknown[][] = []
      const owned = await ownedAssetUrlsById(
        fakeSupabase(manyTables, [], { maxInList: 100, inCalls }),
        [...many, ...many.slice(0, 10).map((id) => id.toUpperCase())],
        "user-a",
        { throwOnError: true },
      )
      expect(inCalls.length).toBeGreaterThan(1)
      for (const call of inCalls) expect(call.length).toBeLessThanOrEqual(100)
      // Each id is asked once, case variants included.
      expect(inCalls.flat().length).toBe(250)
      expect([...owned.keys()].sort()).toEqual(ownedOf(many).sort())
    })

    it("throwOnError: any failed chunk fails the lookup", async () => {
      await expect(
        ownedAssetUrlsById(fakeSupabase(manyTables, [], { failInCall: [1] }), many, "user-a", { throwOnError: true }),
      ).rejects.toThrow(/owned-asset lookup failed/)
    })

    it("without throwOnError a failed chunk contributes nothing; the others still answer", async () => {
      const inCalls: unknown[][] = []
      const owned = await ownedAssetUrlsById(fakeSupabase(manyTables, [], { failInCall: [1], inCalls }), many, "user-a")
      const failedChunk = new Set(inCalls[1] as string[])
      expect(failedChunk.size).toBeGreaterThan(0)
      expect([...owned.keys()].sort()).toEqual(ownedOf(many).filter((id) => !failedChunk.has(id)).sort())
    })
  })

  it("throwOnError: a writer sees a failed read instead of an empty answer", async () => {
    await expect(
      ownedAssetUrlsById(fakeSupabase(TABLES, ["assets"]), [ASSET_A], "user-a", { throwOnError: true }),
    ).rejects.toThrow(/owned-asset lookup failed/)
  })
})

/**
 * A scene's asset ids inside `metadata.scene_node_data` (round 3, decided
 * 2026-10-07). The rule mirrors migration 480's trigger: any key named
 * `asset_id` or ending in `_asset_id`, at any depth, with a uuid-shaped value.
 */
describe("a scene's asset ids in scene_node_data", () => {
  const OWN = "a5000000-0000-4000-8000-000000000001"
  const FOREIGN = "a5000000-0000-4000-8000-000000000002"
  const scene = {
    scene_index: 1,
    shots: [
      { shot_id: "s1", keyframe_asset_id: OWN, keyframe_url: "https://r2/k.png", video_asset_id: FOREIGN.toUpperCase() },
      { shot_id: "s2", last_frame_asset_id: "pending", audio_asset_id: null, lipsynced_asset_id: OWN },
    ],
    scene_anchor_keyframe: { asset_id: FOREIGN, url: "https://r2/a.png" },
    generated_clips: [[{ asset_id: OWN, url: "u" }]],
    composite_video_asset_id: FOREIGN,
    asset_idx: FOREIGN,
    notes: { reference_asset_ids: [FOREIGN] },
  }

  it("collects every uuid-shaped value under an asset_id key, at any depth", () => {
    expect(sceneNodeDataAssetIds(scene).sort()).toEqual(
      [OWN, FOREIGN.toUpperCase(), OWN, FOREIGN, OWN, FOREIGN].sort(),
    )
  })

  it("names nothing for data that holds no scene", () => {
    expect(sceneNodeDataAssetIds(undefined)).toEqual([])
    expect(sceneNodeDataAssetIds("text")).toEqual([])
  })

  it("drops the foreign id keys (any case) with their matching urls, keeps other urls, non-uuid values and the input", () => {
    const owned = new Map<string, string | null>([[OWN, null]])
    const stripped = withoutForeignSceneAssetIds(scene, owned)
    expect(stripped.shots[0]).toEqual({ shot_id: "s1", keyframe_asset_id: OWN, keyframe_url: "https://r2/k.png" })
    expect(stripped.shots[1]).toEqual(scene.shots[1])
    // A foreign id takes its matching url with it (decided 2026-10-07): an
    // asset ref goes whole, null where it stood alone.
    expect(stripped.scene_anchor_keyframe).toBeNull()
    expect(stripped.generated_clips).toEqual([[{ asset_id: OWN, url: "u" }]])
    expect("composite_video_asset_id" in stripped).toBe(false)
    // Keys outside the rule are not judged.
    expect(stripped.asset_idx).toBe(FOREIGN)
    expect(stripped.notes).toEqual({ reference_asset_ids: [FOREIGN] })
    expect(scene.shots[0]?.video_asset_id).toBe(FOREIGN.toUpperCase())
  })

  it("keeps an owned id written in upper case", () => {
    const owned = new Map<string, string | null>([[FOREIGN, null]])
    expect(withoutForeignSceneAssetIds({ v_asset_id: FOREIGN.toUpperCase() }, owned)).toEqual({
      v_asset_id: FOREIGN.toUpperCase(),
    })
  })
})
