import { describe, it, expect } from "vitest"
import type { DbLocation, DbCharacter, DbObject } from "@/lib/api"
import {
  buildSaveLocationPayloadFromExport,
  buildSaveCharacterPayloadFromExport,
  buildSaveObjectPayloadFromExport,
} from "../editor-toolbar-inject-helpers"

// ---------------------------------------------------------------------------
// Regression net for Phase 2 #6 — workflow JSON state drift.
//
// When a user exports a workflow with `?assets=true` and re-imports via the
// "Add to Current" (handleInject) path, the location re-save used to silently
// drop six Location Studio Phase 1 fields: lighting, seasons,
// atmosphereMotions, referencePhotos, canonicalDescription, styleLock.
//
// These tests lock the contract on the payload builders in
// `editor-toolbar-inject-helpers.ts` so any future field added to
// `WorkflowExportLocation` / `DbLocation` is consciously forwarded (or
// consciously dropped).
// ---------------------------------------------------------------------------

function makeFullLocation(overrides: Partial<DbLocation> = {}): DbLocation {
  return {
    id: "loc-uuid-1",
    userId: "user-1",
    nodeId: "node-loc-1",
    projectId: "proj-1",
    name: "Cafe Roma",
    description: "Cozy interior",
    category: "indoor",
    style: "realistic",
    sourceImageUrl: "https://r2.example.com/loc.png",
    timeOfDay: [{ name: "morning", url: "https://r2.example.com/morning.png" }],
    weather: [{ name: "rain", url: "https://r2.example.com/rain.png" }],
    angles: [{ name: "wide", url: "https://r2.example.com/wide.png" }],
    lighting: [{ name: "golden-hour", url: "https://r2.example.com/golden.png" }],
    seasons: [{ name: "autumn", url: "https://r2.example.com/autumn.png" }],
    atmosphereMotions: [
      { name: "dust-motes", url: "https://r2.example.com/dust.mp4" },
    ],
    referencePhotos: [
      { kind: "scrap", url: "https://r2.example.com/ref-1.jpg" },
      { kind: "moodboard", url: "https://r2.example.com/ref-2.jpg" },
    ],
    canonicalDescription:
      "A warm, intimate Italian cafe with brass fixtures and amber light.",
    styleLock: false,
    createdAt: "2026-05-18T10:00:00Z",
    updatedAt: "2026-05-18T10:00:00Z",
    ...overrides,
  }
}

describe("buildSaveLocationPayloadFromExport — Phase 2 #6 drift fix", () => {
  it("forwards ALL Location Studio Phase 1 fields (the 6 previously dropped)", () => {
    const loc = makeFullLocation()
    const payload = buildSaveLocationPayloadFromExport(loc, "new-project-1")

    // The six fields the inline `handleInject` saveLocation call used to drop.
    expect(payload.lighting).toEqual(loc.lighting)
    expect(payload.seasons).toEqual(loc.seasons)
    expect(payload.atmosphereMotions).toEqual(loc.atmosphereMotions)
    expect(payload.referencePhotos).toEqual(loc.referencePhotos)
    expect(payload.canonicalDescription).toBe(loc.canonicalDescription)
    expect(payload.styleLock).toBe(loc.styleLock)
  })

  it("forwards the pre-existing fields (round-trip parity for the rest)", () => {
    const loc = makeFullLocation()
    const payload = buildSaveLocationPayloadFromExport(loc, "new-project-1")

    expect(payload.nodeId).toBe(loc.nodeId)
    expect(payload.projectId).toBe("new-project-1")
    expect(payload.name).toBe(loc.name)
    expect(payload.description).toBe(loc.description)
    expect(payload.category).toBe(loc.category)
    expect(payload.style).toBe(loc.style)
    expect(payload.sourceImageUrl).toBe(loc.sourceImageUrl)
    expect(payload.timeOfDay).toEqual(loc.timeOfDay)
    expect(payload.weather).toEqual(loc.weather)
    expect(payload.angles).toEqual(loc.angles)
  })

  it("normalizes nullish optional fields without dropping them", () => {
    // Real-world: an older export bundle predating migration 124 may have nulls
    // for the Phase 1 columns. The payload should normalize to empty arrays /
    // undefined so the backend INSERT uses its column defaults rather than the
    // route's Zod schema rejecting `null`.
    const loc = makeFullLocation({
      lighting: null as unknown as DbLocation["lighting"],
      seasons: null as unknown as DbLocation["seasons"],
      atmosphereMotions: null as unknown as DbLocation["atmosphereMotions"],
      referencePhotos: null as unknown as DbLocation["referencePhotos"],
      canonicalDescription: null as unknown as DbLocation["canonicalDescription"],
      styleLock: null as unknown as DbLocation["styleLock"],
    })
    const payload = buildSaveLocationPayloadFromExport(loc, "proj-1")

    expect(payload.lighting).toEqual([])
    expect(payload.seasons).toEqual([])
    expect(payload.atmosphereMotions).toEqual([])
    expect(payload.referencePhotos).toEqual([])
    expect(payload.canonicalDescription).toBeUndefined()
    expect(payload.styleLock).toBeUndefined()
  })

  it("includes every key the backend Zod upsertLocationBody schema accepts (besides id/expectedUpdatedAt)", () => {
    // Belt-and-braces: lock the key surface so a future PR that adds a field
    // to DbLocation MUST consciously decide whether handleInject forwards it.
    const payload = buildSaveLocationPayloadFromExport(makeFullLocation(), "p1")
    const keys = Object.keys(payload).sort()
    expect(keys).toEqual(
      [
        "angles",
        "atmosphereMotions",
        "canonicalDescription",
        "category",
        "description",
        "lighting",
        "name",
        "nodeId",
        "projectId",
        "referencePhotos",
        "seasons",
        "sourceImageUrl",
        "style",
        "styleLock",
        "timeOfDay",
        "weather",
      ].sort(),
    )
  })
})

describe("buildSaveCharacterPayloadFromExport", () => {
  it("forwards all expected fields without mutation", () => {
    const char: DbCharacter = {
      id: "c1",
      userId: "u1",
      nodeId: "node-c1",
      projectId: "p1",
      name: "Maya",
      description: "Protagonist",
      gender: "female",
      style: "realistic",
      baseOutfit: "denim jacket",
      sourceImageUrl: "https://r2.example.com/maya.png",
      expressions: [{ name: "smile", url: "https://r2.example.com/smile.png" }],
      poses: [{ name: "standing", url: "https://r2.example.com/stand.png" }],
      lightingVariations: [
        { name: "studio", url: "https://r2.example.com/studio.png" },
      ],
      createdAt: "2026-05-18T10:00:00Z",
      updatedAt: "2026-05-18T10:00:00Z",
    }
    const payload = buildSaveCharacterPayloadFromExport(char, "p1")
    expect(payload.name).toBe("Maya")
    expect(payload.expressions).toEqual(char.expressions)
    expect(payload.poses).toEqual(char.poses)
    expect(payload.lightingVariations).toEqual(char.lightingVariations)
    expect(payload.baseOutfit).toBe("denim jacket")
  })
})

describe("buildSaveObjectPayloadFromExport", () => {
  it("forwards all expected fields without mutation", () => {
    const obj: DbObject = {
      id: "o1",
      userId: "u1",
      nodeId: "node-o1",
      projectId: "p1",
      name: "Vintage radio",
      description: "1950s Bakelite",
      category: "prop",
      style: "realistic",
      sourceImageUrl: "https://r2.example.com/radio.png",
      angles: [{ name: "front", url: "https://r2.example.com/front.png" }],
      materials: [{ name: "bakelite", url: "https://r2.example.com/bake.png" }],
      variations: [{ name: "red", url: "https://r2.example.com/red.png" }],
      motionClips: [],
      referencePhotos: [],
      canonicalDescription: "",
      styleLock: true,
      createdAt: "2026-05-18T10:00:00Z",
      updatedAt: "2026-05-18T10:00:00Z",
    }
    const payload = buildSaveObjectPayloadFromExport(obj, "p1")
    expect(payload.name).toBe("Vintage radio")
    expect(payload.angles).toEqual(obj.angles)
    expect(payload.materials).toEqual(obj.materials)
    expect(payload.variations).toEqual(obj.variations)
    expect(payload.category).toBe("prop")
  })
})
