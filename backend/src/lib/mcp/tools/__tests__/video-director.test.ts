import { describe, it, expect } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"
import {
  loadVideoDirectorSkill,
  FALLBACK_VIDEO_DIRECTOR_SKILL,
  registerVideoDirectorTool,
} from "../video-director.js"

/**
 * Build a session with no scopes — `start_video_director` is intentionally
 * ungated (pure content delivery), so it must register and respond even
 * when the caller has no Nodaro scopes at all.
 */
function emptySession() {
  return newSession({
    userId: "u-video",
    scopes: [] as Scope[],
    clientName: "Claude",
  })
}

describe("start_video_director skill", () => {
  it("composes header + doctrine body", () => {
    const s = loadVideoDirectorSkill()
    expect(s).toContain("motion director")            // header framing
    expect(s).toContain("## Machine contract")        // doctrine body present
    expect(s).toContain("render_shot_sequence")       // drives the P0 tools
    expect(s.length).toBeGreaterThan(2000)
  })
  it("embedded fallback matches the composed skill (drift guard)", () => {
    expect(FALLBACK_VIDEO_DIRECTOR_SKILL).toBe(loadVideoDirectorSkill())
  })

  it("registers start_video_director with empty input schema and readOnlyHint regardless of scope", async () => {
    const server = buildServer()
    registerVideoDirectorTool(server, emptySession())
    const tools = await listTools(server)
    const names = tools.map((t) => t.name)
    expect(names).toContain("start_video_director")

    const tool = tools.find((t) => t.name === "start_video_director")
    expect(tool).toBeDefined()

    // Empty input schema — no required arguments
    const schema = (tool as unknown as { inputSchema?: { required?: string[] } }).inputSchema
    if (schema?.required) {
      expect(schema.required).toEqual([])
    }

    // readOnlyHint: true — content delivery only, no side effects
    const annotations = (tool as unknown as { annotations?: { readOnlyHint?: boolean } }).annotations
    if (annotations) {
      expect(annotations.readOnlyHint).toBe(true)
    }
  })

  it("returns the composed SKILL content on invocation", async () => {
    const server = buildServer()
    registerVideoDirectorTool(server, emptySession())
    const result = await callTool(server, "start_video_director", {})
    expect(result.isError).toBeUndefined()
    expect(result.content).toHaveLength(1)
    const first = result.content[0]!
    expect(first.type).toBe("text")
    const text = first.text ?? ""
    // Must be the same string loadVideoDirectorSkill() / FALLBACK_VIDEO_DIRECTOR_SKILL returns
    expect(text).toBe(loadVideoDirectorSkill())
    expect(text).toContain("motion director")
    expect(text).toContain("## Machine contract")
    expect(text).toContain("render_shot_sequence")
  })

  it("invocation is idempotent across repeated calls", async () => {
    const server = buildServer()
    registerVideoDirectorTool(server, emptySession())
    const r1 = await callTool(server, "start_video_director", {})
    const r2 = await callTool(server, "start_video_director", {})
    expect(r1.content[0]?.text).toBe(r2.content[0]?.text)
  })
})
