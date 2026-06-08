/**
 * Round-trip tests for the workflow export/import asset bundle, focused on
 * the new Location Studio fields added in migration 124:
 *   - lighting, seasons, atmosphereMotions (variant buckets)
 *   - referencePhotos (mood-board, `{ kind, url }`)
 *   - canonicalDescription (LLM caption)
 *   - styleLock (boolean reference-consistency flag)
 *
 * The pre-existing fields (timeOfDay/weather/angles, name/style/etc.) are
 * not retested here — only the new fields' round-trip parity.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// Captured calls to supabase.insert — populated by the mock below.
interface InsertCall {
  table: string
  row: Record<string, unknown>
}
const insertCalls: InsertCall[] = []

// Per-table response queue used by `fetchByIds` (supabase select().in().eq()).
interface SelectResponse {
  data: Record<string, unknown>[] | null
  error: { message: string } | null
}
const selectResponses = new Map<string, SelectResponse>()

vi.mock("../supabase.js", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      return {
        // Path used by `fetchByIds`: .select(columns).in("id", ids).eq("user_id", uid)
        select: vi.fn(() => ({
          in: vi.fn(() => ({
            eq: vi.fn(() => {
              const resp = selectResponses.get(table) ?? { data: [], error: null }
              return Promise.resolve(resp)
            }),
          })),
        })),
        // Path used by `insertOne`: .insert(row).select("id").single()
        insert: vi.fn((row: Record<string, unknown>) => {
          insertCalls.push({ table, row })
          return {
            select: vi.fn(() => ({
              single: vi.fn(() =>
                Promise.resolve({
                  data: { id: `new-${insertCalls.length}` },
                  error: null,
                }),
              ),
            })),
          }
        }),
      }
    }),
  },
}))

import {
  collectAssetIds,
  fetchExportAssets,
  reCreateAssets,
  remapNodeAssetIds,
  workflowExportSchema,
} from "../workflow-assets.js"

beforeEach(() => {
  insertCalls.length = 0
  selectResponses.clear()
})

describe("workflowExportSchema — new location fields", () => {
  it("parses a bundle that carries the 6 new location fields", () => {
    const parsed = workflowExportSchema.safeParse({
      version: 1,
      name: "Beach scene",
      nodes: [],
      edges: [],
      assets: {
        characters: [],
        objects: [],
        locations: [
          {
            id: "loc-1",
            nodeId: "node-loc-1",
            name: "Beach",
            description: "Tropical beach",
            style: "cinematic",
            sourceImageUrl: "https://r2/loc/main.png",
            timeOfDay: [{ name: "sunset", url: "https://r2/loc/sunset.png" }],
            weather: [{ name: "stormy", url: "https://r2/loc/stormy.png" }],
            angles: [{ name: "wide", url: "https://r2/loc/wide.png" }],
            // The 6 new fields:
            lighting: [{ name: "neon", url: "https://r2/loc/neon.png" }],
            seasons: [{ name: "winter", url: "https://r2/loc/winter.png" }],
            atmosphereMotions: [{ name: "smoke", url: "https://r2/loc/smoke.mp4" }],
            referencePhotos: [
              { kind: "moodBoard", url: "https://r2/loc/mb-1.png" },
              { kind: "moodBoard", url: "https://r2/loc/mb-2.png" },
            ],
            canonicalDescription: "A windswept beach at golden hour with foamy waves.",
            styleLock: true,
          },
        ],
      },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const loc = parsed.data.assets!.locations[0]
    expect(loc.lighting).toEqual([{ name: "neon", url: "https://r2/loc/neon.png" }])
    expect(loc.seasons).toEqual([{ name: "winter", url: "https://r2/loc/winter.png" }])
    expect(loc.atmosphereMotions).toEqual([
      { name: "smoke", url: "https://r2/loc/smoke.mp4" },
    ])
    expect(loc.referencePhotos).toEqual([
      { kind: "moodBoard", url: "https://r2/loc/mb-1.png" },
      { kind: "moodBoard", url: "https://r2/loc/mb-2.png" },
    ])
    expect(loc.canonicalDescription).toBe(
      "A windswept beach at golden hour with foamy waves.",
    )
    expect(loc.styleLock).toBe(true)
  })

  it("treats the 6 new location fields as optional (legacy bundles still parse)", () => {
    const parsed = workflowExportSchema.safeParse({
      version: 1,
      name: "Legacy",
      nodes: [],
      edges: [],
      assets: {
        characters: [],
        objects: [],
        locations: [
          {
            id: "loc-1",
            nodeId: "node-loc-1",
            name: "Mountain",
            timeOfDay: [],
            weather: [],
            angles: [],
          },
        ],
      },
    })
    expect(parsed.success).toBe(true)
  })
})

describe("reCreateAssets — writes the 6 new location columns", () => {
  it("inserts lighting/seasons/atmosphere_motions/reference_photos/canonical_description/style_lock", async () => {
    const result = await reCreateAssets(
      {
        characters: [],
        objects: [],
        locations: [
          {
            id: "loc-1",
            nodeId: "node-loc-1",
            name: "Beach",
            description: null,
            style: null,
            sourceImageUrl: null,
            timeOfDay: [],
            weather: [],
            angles: [],
            lighting: [{ name: "neon", url: "https://r2/neon.png" }],
            seasons: [{ name: "winter", url: "https://r2/winter.png" }],
            atmosphereMotions: [{ name: "smoke", url: "https://r2/smoke.mp4" }],
            referencePhotos: [{ kind: "moodBoard", url: "https://r2/mb.png" }],
            canonicalDescription: "Windswept beach.",
            styleLock: false,
          },
        ],
      },
      "user-1",
      "project-1",
    )

    expect(result).toBeInstanceOf(Map)
    const locInsert = insertCalls.find((c) => c.table === "locations")
    expect(locInsert).toBeDefined()
    const row = locInsert!.row
    expect(row.lighting).toEqual([{ name: "neon", url: "https://r2/neon.png" }])
    expect(row.seasons).toEqual([{ name: "winter", url: "https://r2/winter.png" }])
    expect(row.atmosphere_motions).toEqual([
      { name: "smoke", url: "https://r2/smoke.mp4" },
    ])
    expect(row.reference_photos).toEqual([
      { kind: "moodBoard", url: "https://r2/mb.png" },
    ])
    expect(row.canonical_description).toBe("Windswept beach.")
    expect(row.style_lock).toBe(false)
  })

  it("defaults the 6 new fields when the bundle omits them (legacy import)", async () => {
    await reCreateAssets(
      {
        characters: [],
        objects: [],
        locations: [
          {
            id: "loc-1",
            nodeId: "node-loc-1",
            name: "Legacy",
            description: null,
            style: null,
            sourceImageUrl: null,
            timeOfDay: [],
            weather: [],
            angles: [],
            // 6 new fields intentionally omitted
          },
        ],
      },
      "user-1",
      "project-1",
    )

    const row = insertCalls.find((c) => c.table === "locations")!.row
    expect(row.lighting).toEqual([])
    expect(row.seasons).toEqual([])
    expect(row.atmosphere_motions).toEqual([])
    expect(row.reference_photos).toEqual([])
    expect(row.canonical_description).toBeNull()
    expect(row.style_lock).toBe(true)
  })
})

describe("fetchExportAssets — reads the 6 new location columns", () => {
  it("maps snake_case DB columns to camelCase bundle fields", async () => {
    selectResponses.set("locations", {
      data: [
        {
          id: "loc-1",
          node_id: "node-loc-1",
          name: "Beach",
          description: null,
          style: null,
          source_image_url: null,
          time_of_day: [],
          weather: [],
          angles: [],
          lighting: [{ name: "neon", url: "https://r2/neon.png" }],
          seasons: [{ name: "winter", url: "https://r2/winter.png" }],
          atmosphere_motions: [{ name: "smoke", url: "https://r2/smoke.mp4" }],
          reference_photos: [{ kind: "moodBoard", url: "https://r2/mb.png" }],
          canonical_description: "Windswept beach.",
          style_lock: false,
        },
      ],
      error: null,
    })

    const result = await fetchExportAssets(
      { characterIds: [], objectIds: [], creatureIds: [], locationIds: ["loc-1"] },
      "user-1",
    )

    expect("error" in result).toBe(false)
    if ("error" in result) return
    const loc = result.locations[0]
    expect(loc.lighting).toEqual([{ name: "neon", url: "https://r2/neon.png" }])
    expect(loc.seasons).toEqual([{ name: "winter", url: "https://r2/winter.png" }])
    expect(loc.atmosphereMotions).toEqual([
      { name: "smoke", url: "https://r2/smoke.mp4" },
    ])
    expect(loc.referencePhotos).toEqual([
      { kind: "moodBoard", url: "https://r2/mb.png" },
    ])
    expect(loc.canonicalDescription).toBe("Windswept beach.")
    expect(loc.styleLock).toBe(false)
  })
})

describe("workflow-assets — creature node round-trip (Phase H)", () => {
  it("collectAssetIds picks up creatureDbId from a creature node", () => {
    const ids = collectAssetIds([
      { type: "creature", data: { creatureDbId: "crt-1" } },
      { type: "object", data: { objectDbId: "obj-1" } },
      { type: "creature", data: {} }, // no id → skipped
    ])
    expect(ids.creatureIds).toEqual(["crt-1"])
    expect(ids.objectIds).toEqual(["obj-1"])
  })

  it("workflowExportSchema parses a bundle carrying creatures", () => {
    const parsed = workflowExportSchema.safeParse({
      version: 1,
      name: "Beast scene",
      nodes: [],
      edges: [],
      assets: {
        characters: [],
        objects: [],
        creatures: [
          {
            id: "crt-1",
            nodeId: "node-crt-1",
            name: "Wolf",
            description: "A grey wolf",
            species: "wolf",
            style: "cinematic",
            sourceImageUrl: "https://r2/crt/main.png",
            angles: [{ name: "side", url: "https://r2/crt/side.png" }],
            poses: [{ name: "howling", url: "https://r2/crt/howl.png" }],
            variations: [{ name: "snowy", url: "https://r2/crt/snowy.png" }],
          },
        ],
        locations: [],
      },
    })
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    const crt = parsed.data.assets!.creatures![0]
    expect(crt.species).toBe("wolf")
    expect(crt.poses).toEqual([{ name: "howling", url: "https://r2/crt/howl.png" }])
  })

  it("DB row → bundle → re-create → remap rewrites creatureDbId on the node", async () => {
    selectResponses.set("creatures", {
      data: [
        {
          id: "crt-1",
          node_id: "node-crt-1",
          name: "Wolf",
          description: "A grey wolf",
          species: "wolf",
          style: "cinematic",
          source_image_url: "https://r2/crt/main.png",
          angles: [{ name: "side", url: "https://r2/crt/side.png" }],
          poses: [{ name: "howling", url: "https://r2/crt/howl.png" }],
          variations: [{ name: "snowy", url: "https://r2/crt/snowy.png" }],
        },
      ],
      error: null,
    })

    // 1. Collect from nodes
    const nodes = [{ id: "n1", type: "creature", data: { creatureDbId: "crt-1" } }]
    const ids = collectAssetIds(nodes)
    expect(ids.creatureIds).toEqual(["crt-1"])

    // 2. Export from DB → bundle
    const exported = await fetchExportAssets(ids, "user-1")
    expect("error" in exported).toBe(false)
    if ("error" in exported) return
    const crt = exported.creatures![0]
    expect(crt.id).toBe("crt-1")
    expect(crt.species).toBe("wolf")
    expect(crt.poses).toEqual([{ name: "howling", url: "https://r2/crt/howl.png" }])
    expect(crt.angles).toEqual([{ name: "side", url: "https://r2/crt/side.png" }])
    expect(crt.variations).toEqual([{ name: "snowy", url: "https://r2/crt/snowy.png" }])

    // 3. Bundle round-trips through the Zod schema
    const reparsed = workflowExportSchema.safeParse({
      version: 1,
      name: "Round-trip",
      nodes: [],
      edges: [],
      assets: {
        characters: exported.characters,
        objects: exported.objects,
        creatures: exported.creatures,
        locations: exported.locations,
      },
    })
    expect(reparsed.success).toBe(true)
    if (!reparsed.success) return

    // 4. Re-create writes back to creatures + returns the id map
    insertCalls.length = 0
    const idMap = await reCreateAssets(reparsed.data.assets!, "user-2", "project-2")
    expect(idMap).toBeInstanceOf(Map)
    if (!(idMap instanceof Map)) return
    const crtInsert = insertCalls.find((c) => c.table === "creatures")
    expect(crtInsert).toBeDefined()
    const row = crtInsert!.row
    expect(row.user_id).toBe("user-2")
    expect(row.project_id).toBe("project-2")
    expect(row.node_id).toBe("node-crt-1")
    expect(row.species).toBe("wolf")
    expect(row.poses).toEqual([{ name: "howling", url: "https://r2/crt/howl.png" }])
    expect(row.angles).toEqual([{ name: "side", url: "https://r2/crt/side.png" }])
    expect(row.variations).toEqual([{ name: "snowy", url: "https://r2/crt/snowy.png" }])
    // The created id (mock returns `new-<n>`) is mapped from the original.
    const newId = idMap.get("crt-1")
    expect(newId).toBeDefined()

    // 5. remapNodeAssetIds rewrites the new id onto the node's creatureDbId
    const remapped = remapNodeAssetIds(nodes, idMap)
    expect((remapped[0].data as Record<string, unknown>).creatureDbId).toBe(newId)
  })

  it("defaults poses/angles/variations when the bundle omits them (legacy import)", async () => {
    insertCalls.length = 0
    await reCreateAssets(
      {
        characters: [],
        objects: [],
        creatures: [
          {
            id: "crt-1",
            nodeId: "node-crt-1",
            name: "Legacy beast",
            description: null,
            species: null,
            style: null,
            sourceImageUrl: null,
            // angles/poses/variations intentionally omitted
          },
        ],
        locations: [],
      },
      "user-1",
      "project-1",
    )
    const row = insertCalls.find((c) => c.table === "creatures")!.row
    expect(row.species).toBeNull()
    expect(row.angles).toEqual([])
    expect(row.poses).toEqual([])
    expect(row.variations).toEqual([])
  })
})

describe("workflow-assets — full round-trip parity", () => {
  it("DB row → bundle → re-create writes back every new field", async () => {
    selectResponses.set("locations", {
      data: [
        {
          id: "loc-1",
          node_id: "node-loc-1",
          name: "Beach",
          description: "Tropical",
          style: "cinematic",
          source_image_url: "https://r2/main.png",
          time_of_day: [{ name: "sunset", url: "https://r2/sunset.png" }],
          weather: [{ name: "stormy", url: "https://r2/stormy.png" }],
          angles: [{ name: "wide", url: "https://r2/wide.png" }],
          lighting: [{ name: "neon", url: "https://r2/neon.png" }],
          seasons: [{ name: "winter", url: "https://r2/winter.png" }],
          atmosphere_motions: [{ name: "smoke", url: "https://r2/smoke.mp4" }],
          reference_photos: [{ kind: "moodBoard", url: "https://r2/mb.png" }],
          canonical_description: "Windswept beach.",
          style_lock: true,
        },
      ],
      error: null,
    })

    // 1. Export from DB → bundle
    const exported = await fetchExportAssets(
      { characterIds: [], objectIds: [], creatureIds: [], locationIds: ["loc-1"] },
      "user-1",
    )
    expect("error" in exported).toBe(false)
    if ("error" in exported) return

    // 2. Bundle round-trips through the Zod schema
    const reparsed = workflowExportSchema.safeParse({
      version: 1,
      name: "Round-trip",
      nodes: [],
      edges: [],
      assets: {
        characters: exported.characters,
        objects: exported.objects,
        locations: exported.locations,
      },
    })
    expect(reparsed.success).toBe(true)
    if (!reparsed.success) return

    // 3. Re-create writes back to DB
    insertCalls.length = 0
    await reCreateAssets(reparsed.data.assets!, "user-2", "project-2")
    const row = insertCalls.find((c) => c.table === "locations")!.row
    expect(row.lighting).toEqual([{ name: "neon", url: "https://r2/neon.png" }])
    expect(row.seasons).toEqual([{ name: "winter", url: "https://r2/winter.png" }])
    expect(row.atmosphere_motions).toEqual([
      { name: "smoke", url: "https://r2/smoke.mp4" },
    ])
    expect(row.reference_photos).toEqual([
      { kind: "moodBoard", url: "https://r2/mb.png" },
    ])
    expect(row.canonical_description).toBe("Windswept beach.")
    expect(row.style_lock).toBe(true)
  })
})
