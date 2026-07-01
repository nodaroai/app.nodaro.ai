import { describe, it, expect } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"
import { registerShotShapeTools } from "../shot-shapes.js"
import { BLUEPRINT_IDS } from "../../../../services/shot-sequence/blueprint-params.js"

const session = newSession({ userId: "u1", scopes: [] as Scope[], clientName: "Test" })

function makeServer() {
  const server = buildServer()
  registerShotShapeTools(server, session)
  return server
}

describe("list_shot_shapes", () => {
  it("returns an entry per blueprint, each with the required fields", async () => {
    const server = makeServer()
    const result = await callTool(server, "list_shot_shapes", {})
    expect(result.isError).toBeUndefined()
    const shapes = JSON.parse(result.content[0]!.text!) as unknown[]
    expect(shapes).toHaveLength(BLUEPRINT_IDS.length)
    for (const shape of shapes) {
      const s = shape as Record<string, unknown>
      expect(typeof s.id).toBe("string")
      expect(Array.isArray(s.roles)).toBe(true)
      expect(typeof s.description).toBe("string")
      expect(typeof s.defaultDurationFrames).toBe("number")
    }
  })

  it("contains exactly the known blueprint ids", async () => {
    const server = makeServer()
    const result = await callTool(server, "list_shot_shapes", {})
    const shapes = JSON.parse(result.content[0]!.text!) as Array<{ id: string }>
    const ids = shapes.map((s) => s.id).sort()
    // Assert against BLUEPRINT_IDS so adding a blueprint never silently drifts this.
    expect(ids).toEqual([...BLUEPRINT_IDS].sort())
  })

  it("titlecard-reveal has the correct roles and defaultDurationFrames", async () => {
    const server = makeServer()
    const result = await callTool(server, "list_shot_shapes", {})
    const shapes = JSON.parse(result.content[0]!.text!) as Array<{
      id: string
      roles: string[]
      defaultDurationFrames: number
    }>
    const tc = shapes.find((s) => s.id === "titlecard-reveal")
    expect(tc).toBeDefined()
    expect(tc!.roles).toContain("benefit_highlight")
    expect(tc!.defaultDurationFrames).toBe(120)
  })
})

describe("get_shot_shape", () => {
  it('returns meta + paramSchema + example for "titlecard-reveal"', async () => {
    const server = makeServer()
    const result = await callTool(server, "get_shot_shape", { id: "titlecard-reveal" })
    expect(result.isError).toBeUndefined()
    const data = JSON.parse(result.content[0]!.text!) as Record<string, unknown>
    expect(data.id).toBe("titlecard-reveal")
    expect(Array.isArray(data.roles)).toBe(true)
    expect((data.roles as string[])).toContain("benefit_highlight")
    expect(typeof data.description).toBe("string")
    expect(data.defaultDurationFrames).toBe(120)
    // paramSchema: zod-to-json-schema renders a JSON schema object
    expect(data.paramSchema).toBeDefined()
    const ps = data.paramSchema as Record<string, unknown>
    expect(ps.type ?? ps.properties).toBeDefined()
    // example: filled params for titlecard-reveal
    expect(data.example).toBeDefined()
    const ex = data.example as Record<string, unknown>
    expect(typeof ex.title).toBe("string")
  })

  it('returns paramSchema with required "lines" for "kinetic-type-beats"', async () => {
    const server = makeServer()
    const result = await callTool(server, "get_shot_shape", { id: "kinetic-type-beats" })
    expect(result.isError).toBeUndefined()
    const data = JSON.parse(result.content[0]!.text!) as Record<string, unknown>
    expect(data.id).toBe("kinetic-type-beats")
    // The Zod schema for kinetic-type-beats requires 'lines' and 'accentColor'
    const ps = data.paramSchema as Record<string, unknown>
    const props = ps.properties as Record<string, unknown> | undefined
    expect(props?.lines ?? (ps as Record<string, Record<string, unknown>>).items).toBeDefined()
    // example should have lines array
    const ex = data.example as Record<string, unknown>
    expect(Array.isArray(ex.lines)).toBe(true)
  })

  it('errors on unknown id "nope"', async () => {
    const server = makeServer()
    const result = await callTool(server, "get_shot_shape", { id: "nope" })
    expect(result.isError).toBe(true)
    expect(result.content[0]!.text).toContain("Unknown blueprint id")
    expect(result.content[0]!.text).toContain("nope")
  })
})

describe("scope gating", () => {
  it("registers with no scopes — both tools are ungated", async () => {
    const server = makeServer()
    const tools = await listTools(server)
    const names = tools.map((t) => t.name)
    expect(names).toContain("list_shot_shapes")
    expect(names).toContain("get_shot_shape")
  })
})
