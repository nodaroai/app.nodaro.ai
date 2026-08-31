/**
 * Chip-aware asset bundling (#1088).
 *
 * The export/import asset pipeline used to be entity-NODE-keyed on both ends:
 * `collectAssetIds` read four `*DbId` fields and `remapNodeAssetIds` rewrote the
 * same four. A graph that binds its entities through `@`-chips instead — every
 * studio production, by the minimal-graph rule — exported ZERO entities and
 * imported with every chip pointing at a stranger's row.
 *
 * These cover the chip half: what the walk finds, what it refuses to find, and
 * what the remap does with it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface InsertCall {
  table: string
  row: Record<string, unknown>
}
const insertCalls: InsertCall[] = []
/** Active names per table, as `deriveAvailableName` reads them. */
const existingNames = new Map<string, string[]>()

vi.mock("../supabase.js", () => {
  function makeReadBuilder(table: string) {
    const builder = {
      eq: () => builder,
      is: () => builder,
      in: () => builder,
      ilike: () =>
        Promise.resolve({
          data: (existingNames.get(table) ?? []).map((name) => ({ name })),
          error: null,
        }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    }
    return builder
  }
  return {
    supabase: {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => makeReadBuilder(table)),
        insert: vi.fn((row: Record<string, unknown>) => {
          insertCalls.push({ table, row })
          return {
            select: vi.fn(() => ({
              single: vi.fn(() => Promise.resolve({ data: { id: `new-${insertCalls.length}` }, error: null })),
            })),
          }
        }),
      })),
    },
  }
})

import {
  collectAssetIds,
  reCreateAssets,
  remapNodeAssetIds,
  remapSettingsReferences,
} from "../workflow-assets.js"
import type { CreatedAsset } from "../workflow-assets.js"

const KIRA = "11111111-1111-4111-8111-111111111111"
const SWORD = "22222222-2222-4222-8222-222222222222"
const WOLF = "33333333-3333-4333-8333-333333333333"
const LIBRARY = "44444444-4444-4444-8444-444444444444"
const FACE = "55555555-5555-4555-8555-555555555555"

/** A bound chip, as `toConnectedReference` writes one into node data. */
function chip(id: string, source: string, extra: Record<string, unknown> = {}) {
  return { id, source, defaultName: "Kira", url: "https://cdn.example/kira.png", ...extra }
}

beforeEach(() => {
  insertCalls.length = 0
  existingNames.clear()
  vi.clearAllMocks()
})

describe("collectAssetIds — chips (#1088)", () => {
  it("harvests the entity behind every bound chip in a node's results", () => {
    const nodes = [
      {
        id: "shot-1",
        type: "generate-image",
        data: {
          generatedResults: [
            { url: "https://cdn.example/a.png", references: [chip(KIRA, "wired-character")] },
            { url: "https://cdn.example/b.png", references: [chip(LIBRARY, "wired-location")] },
          ],
        },
      },
      {
        id: "shot-2",
        type: "generate-video",
        data: {
          generatedResults: [
            { url: "https://cdn.example/c.mp4", references: [chip(SWORD, "wired-object"), chip(WOLF, "wired-creature")] },
          ],
        },
      },
    ]

    const ids = collectAssetIds(nodes)
    expect(ids.characterIds).toEqual([KIRA])
    expect(ids.locationIds).toEqual([LIBRARY])
    expect(ids.objectIds).toEqual([SWORD])
    expect(ids.creatureIds).toEqual([WOLF])
  })

  it("finds chips wherever a `references` array sits — beats and plans, not just results", () => {
    const nodes = [
      {
        id: "scene-1",
        type: "generate-video",
        data: {
          beats: [{ id: "b1", seconds: 2, text: "…", references: [chip(KIRA, "wired-character")] }],
          plan: { frame: { references: [chip(LIBRARY, "wired-location")] } },
        },
      },
    ]

    const ids = collectAssetIds(nodes)
    expect(ids.characterIds).toEqual([KIRA])
    expect(ids.locationIds).toEqual([LIBRARY])
  })

  it("skips the sources with no entity row to bundle", () => {
    const nodes = [
      {
        id: "shot-1",
        type: "generate-image",
        data: {
          generatedResults: [
            {
              references: [
                chip(KIRA, "manual"),
                chip(SWORD, "wired-image"),
                // A face HAS a row, but `WorkflowExport.assets` has no face arm
                // — nothing could be re-created from it, so nothing is collected.
                chip(FACE, "wired-face"),
                // Not a uuid: never let it reach a uuid-typed `.in()` filter.
                chip("", "wired-character"),
                chip("kira", "wired-character"),
                // Malformed entries must not throw the walk.
                null,
                "nope",
              ],
            },
          ],
        },
      },
    ]

    expect(collectAssetIds(nodes)).toEqual({
      characterIds: [],
      objectIds: [],
      creatureIds: [],
      locationIds: [],
    })
  })

  it("still collects the entity NODES' ids, chips or no chips", () => {
    const nodes = [
      { id: "n-char", type: "character", data: { characterDbId: KIRA } },
      {
        id: "shot-1",
        type: "generate-image",
        data: { generatedResults: [{ references: [chip(LIBRARY, "wired-location")] }] },
      },
    ]

    const ids = collectAssetIds(nodes)
    expect(ids.characterIds).toEqual([KIRA])
    expect(ids.locationIds).toEqual([LIBRARY])
  })
})

describe("reCreateAssets — the created rows", () => {
  it("maps each bundled id to the row that landed, name and canonical image included", async () => {
    // The importer already has a "Kira", so the insert steps the name.
    existingNames.set("characters", ["Kira"])
    const result = await reCreateAssets(
      {
        characters: [
          {
            id: KIRA,
            nodeId: "node-1",
            name: "Kira",
            sourceImageUrl: "https://cdn.example/kira.png",
          },
        ],
        objects: [],
        locations: [],
      },
      "user-1",
      "project-1",
    )

    expect(result).toBeInstanceOf(Map)
    if (!(result instanceof Map)) return
    const created = result.get(KIRA) as CreatedAsset
    expect(created.id).toBe("new-1")
    // The DERIVED name, not the bundle's — a chip re-pointed here must show
    // the name the library actually holds.
    expect(created.name).toBe("Kira 2")
    expect(created.sourceImageUrl).toBe("https://cdn.example/kira.png")
  })
})

describe("remapNodeAssetIds — chips (#1088)", () => {
  const idMap = new Map<string, CreatedAsset>([
    [KIRA, { id: "new-kira", name: "Kira 2", sourceImageUrl: "https://mine.example/kira.png" }],
    [LIBRARY, { id: "new-library", name: "Old Library", sourceImageUrl: "https://mine.example/lib.png" }],
  ])

  it("re-points a bound chip at the created row and refreshes its name and image", () => {
    const nodes = [
      {
        id: "shot-1",
        data: {
          generatedResults: [
            { url: "https://cdn.example/a.png", references: [chip(KIRA, "wired-character")] },
          ],
        },
      },
    ]

    const [node] = remapNodeAssetIds(nodes, idMap)
    const ref = (node!.data as any).generatedResults[0].references[0]
    expect(ref.id).toBe("new-kira")
    expect(ref.defaultName).toBe("Kira 2")
    expect(ref.url).toBe("https://mine.example/kira.png")
    // Every other field survives untouched.
    expect(ref.source).toBe("wired-character")
  })

  it("leaves a VARIANT chip's url alone — it points at the variant, not the portrait", () => {
    const nodes = [
      {
        id: "shot-1",
        data: {
          generatedResults: [
            {
              references: [
                chip(KIRA, "wired-character", {
                  variantSlug: "smile",
                  url: "https://cdn.example/kira-smile.png",
                }),
              ],
            },
          ],
        },
      },
    ]

    const [node] = remapNodeAssetIds(nodes, idMap)
    const ref = (node!.data as any).generatedResults[0].references[0]
    expect(ref.id).toBe("new-kira")
    expect(ref.defaultName).toBe("Kira 2")
    expect(ref.url).toBe("https://cdn.example/kira-smile.png")
  })

  it("leaves an unbundled chip exactly as it is", () => {
    const nodes = [
      { id: "shot-1", data: { generatedResults: [{ references: [chip(WOLF, "wired-creature")] }] } },
    ]

    const [node] = remapNodeAssetIds(nodes, idMap)
    expect((node!.data as any).generatedResults[0].references[0]).toEqual(chip(WOLF, "wired-creature"))
  })

  it("re-points chips on beats and plans too, and never mutates the input", () => {
    const beatChip = chip(KIRA, "wired-character")
    const nodes = [
      {
        id: "scene-1",
        data: {
          beats: [{ id: "b1", references: [beatChip] }],
          plan: { motion: { references: [chip(LIBRARY, "wired-location")] } },
        },
      },
    ]

    const [node] = remapNodeAssetIds(nodes, idMap)
    expect((node!.data as any).beats[0].references[0].id).toBe("new-kira")
    expect((node!.data as any).plan.motion.references[0].id).toBe("new-library")
    // The caller's objects are untouched.
    expect(beatChip.id).toBe(KIRA)
    expect((nodes[0]!.data as any).beats[0].references[0]).toBe(beatChip)
  })

  it("rewrites the entity-node fields and the chips in one pass", () => {
    const nodes = [
      { id: "n-char", data: { characterDbId: KIRA } },
      { id: "shot-1", data: { generatedResults: [{ references: [chip(LIBRARY, "wired-location")] }] } },
    ]

    const remapped = remapNodeAssetIds(nodes, idMap)
    expect((remapped[0]!.data as any).characterDbId).toBe("new-kira")
    expect((remapped[1]!.data as any).generatedResults[0].references[0].id).toBe("new-library")
  })

  it("returns node data unchanged when the bundle created nothing", () => {
    const data = { generatedResults: [{ references: [chip(KIRA, "wired-character")] }] }
    const [node] = remapNodeAssetIds([{ id: "shot-1", data }], new Map())
    expect(node!.data).toEqual(data)
  })

  // A prop / creature / location VIEW chip binds by url alone — none of the
  // character mention/variant machinery — so `isExtraRef` ("the user attached
  // exactly this image") is its ONLY marker. Read as canonical, its url would
  // be swapped for the entity's main image: a silent wrong generation input.
  it.each([
    ["object", SWORD, "https://cdn.example/sword-brass.png", "Brass"],
    ["creature", WOLF, "https://cdn.example/wolf-side.png", "Side"],
    ["location", LIBRARY, "https://cdn.example/library-rain.png", "Rain"],
  ])("keeps a %s VIEW chip's url — it carries no variant field, only isExtraRef", (
    kind,
    id,
    url,
    label,
  ) => {
    const viewIdMap = new Map<string, CreatedAsset>([
      [id, { id: `new-${kind}`, name: "Renamed", sourceImageUrl: "https://mine.example/main.png" }],
    ])
    const nodes = [
      {
        id: "shot-1",
        data: {
          generatedResults: [
            {
              references: [
                chip(id, `wired-${kind}`, { url, isExtraRef: true, description: label }),
              ],
            },
          ],
        },
      },
    ]

    const [node] = remapNodeAssetIds(nodes, viewIdMap)
    const ref = (node!.data as any).generatedResults[0].references[0]
    expect(ref.id).toBe(`new-${kind}`)
    expect(ref.defaultName).toBe("Renamed")
    expect(ref.url).toBe(url)
  })

  it("clears an entity node's id when the import DROPPED that entity", () => {
    const nodes = [
      { id: "n-char", type: "character", data: { characterDbId: WOLF } },
      { id: "n-loc", type: "location", data: { locationDbId: LIBRARY } },
    ]

    const remapped = remapNodeAssetIds(nodes, idMap, new Set([WOLF]))
    // Dropped: cleared, so the node lands unlinked rather than dangling.
    expect((remapped[0]!.data as any).characterDbId).toBe("")
    // Created: re-pointed as always.
    expect((remapped[1]!.data as any).locationDbId).toBe("new-library")
  })

  it("leaves an unmapped id alone when the import dropped nothing", () => {
    // An asset-LESS bundle's id may be a valid row of the importer's own.
    const nodes = [{ id: "n-char", type: "character", data: { characterDbId: WOLF } }]
    expect((remapNodeAssetIds(nodes, idMap)[0]!.data as any).characterDbId).toBe(WOLF)
  })
})

describe("the settings blob (#1088)", () => {
  /** A studio-shaped settings index: two wrapper levels above node data. */
  const studioSettings = () => ({
    studio: {
      version: 3,
      shots: [
        {
          id: "s1",
          imageNodeId: "shot-1",
          plan: { frame: { references: [chip(KIRA, "wired-character")] } },
          beats: [{ id: "b1", references: [chip(LIBRARY, "wired-location")] }],
        },
      ],
    },
  })

  it("collects the entities bound ONLY in settings", () => {
    // The graph is empty: a planned shot binds its cast before it is framed.
    const ids = collectAssetIds([], studioSettings())
    expect(ids.characterIds).toEqual([KIRA])
    expect(ids.locationIds).toEqual([LIBRARY])
  })

  it("re-points those chips at the created rows without mutating the input", () => {
    const idMap = new Map<string, CreatedAsset>([
      [KIRA, { id: "new-kira", name: "Kira 2", sourceImageUrl: "https://mine.example/kira.png" }],
      [LIBRARY, { id: "new-library", name: "Old Library", sourceImageUrl: null }],
    ])
    const settings = studioSettings()

    const out = remapSettingsReferences(settings, idMap) as any
    expect(out.studio.shots[0].plan.frame.references[0].id).toBe("new-kira")
    expect(out.studio.shots[0].beats[0].references[0].id).toBe("new-library")
    // Collect and remap must agree: whatever one finds, the other re-points.
    expect(settings.studio.shots[0]!.plan.frame.references[0]!.id).toBe(KIRA)
  })

  it("returns the same object when nothing was created, and undefined for a non-object", () => {
    const settings = studioSettings()
    expect(remapSettingsReferences(settings, new Map())).toBe(settings)
    expect(remapSettingsReferences(undefined, new Map())).toBeUndefined()
    expect(remapSettingsReferences([], new Map())).toBeUndefined()
  })
})
