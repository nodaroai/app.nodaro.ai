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
  fetchExportAssets,
  reCreateAssets,
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
      { characterIds: [], objectIds: [], locationIds: ["loc-1"] },
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
      { characterIds: [], objectIds: [], locationIds: ["loc-1"] },
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
