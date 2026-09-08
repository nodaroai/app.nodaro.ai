import { describe, it, expect } from "vitest"
import {
  SCENE3D_DEFAULT_ADVANCED_ENGINE,
  SCENE3D_SUPPORTED_SCHEMA_VERSIONS,
  resolveScene3DAuthoringEngine,
} from "../index.js"

/** Only the fields the resolver reads — it must not need a whole valid plan. */
const v1Plan = { planType: "3d-scene", schemaVersion: 1 }
const v2Plan = (engine = "blender-cloud") => ({
  planType: "3d-scene",
  schemaVersion: 2,
  provenance: { engine },
})

describe("resolveScene3DAuthoringEngine", () => {
  it("keeps a plain generate on Basic, with NO extra wire fields", () => {
    const choice = resolveScene3DAuthoringEngine({})
    expect(choice).toEqual({ ok: true, lane: "basic", engine: undefined, fields: {} })
  })

  it("keeps a v1 edit on Basic", () => {
    const choice = resolveScene3DAuthoringEngine({ plan: v1Plan })
    expect(choice.ok && choice.lane).toBe("basic")
    expect(choice.ok && choice.fields).toEqual({})
  })

  it("sends an explicitly requested advanced engine plus the accepted versions", () => {
    const choice = resolveScene3DAuthoringEngine({
      requested: "blender-cloud",
      availableEngines: ["blender-cloud"],
    })
    expect(choice.ok && choice.lane).toBe("advanced")
    expect(choice.ok && choice.fields).toEqual({
      engine: "blender-cloud",
      acceptedSceneSchemaVersions: [...SCENE3D_SUPPORTED_SCHEMA_VERSIONS],
    })
  })

  it("routes a v2 edit to the advanced lane with no engine chosen", () => {
    const choice = resolveScene3DAuthoringEngine({ plan: v2Plan() })
    expect(choice.ok && choice.lane).toBe("advanced")
    expect(choice.ok && choice.engine).toBe(SCENE3D_DEFAULT_ADVANCED_ENGINE)
  })

  it("keeps a v2 edit on the engine that authored it", () => {
    const choice = resolveScene3DAuthoringEngine({
      plan: v2Plan("blender-local"),
      availableEngines: ["blender-cloud", "blender-local"],
    })
    expect(choice.ok && choice.engine).toBe("blender-local")
  })

  it("does not send a v2 edit to an authoring engine this install dropped", () => {
    const choice = resolveScene3DAuthoringEngine({
      plan: v2Plan("blender-local"),
      availableEngines: ["blender-cloud"],
    })
    expect(choice.ok && choice.engine).toBe("blender-cloud")
  })

  it("REFUSES a v2 scene pointed at Basic instead of downgrading it", () => {
    const choice = resolveScene3DAuthoringEngine({ requested: "basic", plan: v2Plan() })
    expect(choice.ok).toBe(false)
    expect(!choice.ok && choice.code).toBe("schema_requires_advanced")
  })

  it("REFUSES a v2 edit when the install has no advanced engine at all", () => {
    const choice = resolveScene3DAuthoringEngine({ plan: v2Plan(), availableEngines: [] })
    expect(!choice.ok && choice.code).toBe("advanced_unavailable")
  })

  it("REFUSES an explicit engine this install does not serve — never falls back to Basic", () => {
    const choice = resolveScene3DAuthoringEngine({
      requested: "blender-local",
      availableEngines: ["blender-cloud"],
    })
    expect(!choice.ok && choice.code).toBe("engine_unavailable")
  })

  it("REFUSES an explicit engine on a v2 scene the same way", () => {
    const choice = resolveScene3DAuthoringEngine({
      requested: "blender-local",
      plan: v2Plan(),
      availableEngines: ["blender-cloud"],
    })
    expect(!choice.ok && choice.code).toBe("engine_unavailable")
  })

  it("REFUSES an engine name the contract does not know", () => {
    const choice = resolveScene3DAuthoringEngine({ requested: "unknown-renderer" })
    expect(!choice.ok && choice.code).toBe("unknown_engine")
  })

  it("REFUSES a scene claiming a schema version nothing here can author against", () => {
    const choice = resolveScene3DAuthoringEngine({ plan: { planType: "3d-scene", schemaVersion: 3 } })
    expect(!choice.ok && choice.code).toBe("unsupported_schema_version")
  })

  it("stays permissive when availability is UNKNOWN — the route refuses honestly", () => {
    const choice = resolveScene3DAuthoringEngine({ requested: "blender-local" })
    expect(choice.ok && choice.engine).toBe("blender-local")
  })
})
