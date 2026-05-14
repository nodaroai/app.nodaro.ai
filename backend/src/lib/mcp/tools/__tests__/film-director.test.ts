import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"
import {
  registerFilmDirectorTool,
  FILM_DIRECTOR_TOOL_DESCRIPTION,
  FILM_DIRECTOR_SKILL_PATH,
  FALLBACK_SKILL_CONTENT,
} from "../film-director.js"

/**
 * Build a session with no scopes — `start_film_director` is intentionally
 * ungated (pure content delivery), so it must register and respond even
 * when the caller has no Nodaro scopes at all.
 */
function emptySession() {
  return newSession({
    userId: "u-film",
    scopes: [] as Scope[],
    clientName: "Claude",
  })
}

describe("start_film_director MCP tool", () => {
  it("registers with the expected name regardless of scope", async () => {
    const server = buildServer()
    registerFilmDirectorTool(server, emptySession())
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).toContain("start_film_director")
  })

  it("registers even when the session has all scopes", async () => {
    const server = buildServer()
    registerFilmDirectorTool(
      server,
      newSession({
        userId: "u-film",
        scopes: [
          "workflows:read",
          "workflows:write",
          "workflows:execute",
          "assets:read",
          "assets:write",
          "jobs:read",
          "apps:read",
          "credits:read",
        ] as Scope[],
        clientName: "Claude",
      }),
    )
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).toContain("start_film_director")
  })

  it("description includes the critical activation trigger phrases", () => {
    const triggers = [
      "cinematic video",
      "short film",
      "trailer",
      "music video",
      "reel",
      "commercial",
      "ad",
      "story",
      "scene",
      "characters",
      "locations",
    ]
    for (const phrase of triggers) {
      expect(
        FILM_DIRECTOR_TOOL_DESCRIPTION.toLowerCase(),
        `description must mention "${phrase}" so Claude's tool-selection picks this up`,
      ).toContain(phrase.toLowerCase())
    }
  })

  it("description tells the LLM to call this FIRST and follow the workflow precisely", () => {
    // The whole point of the tool is reliable activation + strong instruction-
    // following. Soft "you might want to" wording defeats both.
    expect(FILM_DIRECTOR_TOOL_DESCRIPTION).toMatch(/FIRST/)
    expect(FILM_DIRECTOR_TOOL_DESCRIPTION).toMatch(/MUST/)
    expect(FILM_DIRECTOR_TOOL_DESCRIPTION).toMatch(/10-stage/)
  })

  it("description fits MCP-client UI budgets (≤1024 chars)", () => {
    // Most MCP clients don't truncate hard at this boundary, but the closer
    // we stay to ~1KB the safer we are. The current description is ~700.
    expect(FILM_DIRECTOR_TOOL_DESCRIPTION.length).toBeLessThanOrEqual(1024)
    expect(FILM_DIRECTOR_TOOL_DESCRIPTION.length).toBeGreaterThanOrEqual(200)
  })

  it("returns the full SKILL.md content (≥10 KB) on invocation", async () => {
    const server = buildServer()
    registerFilmDirectorTool(server, emptySession())
    const result = await callTool(server, "start_film_director", {})
    expect(result.isError).toBeUndefined()
    expect(result.content).toHaveLength(1)
    const first = result.content[0]!
    expect(first.type).toBe("text")
    const text = first.text ?? ""
    // SKILL.md v1.0.1 is ~16 KB; assert at least 10 KB to catch a fallback
    // that mistakenly returns a stub.
    expect(text.length).toBeGreaterThanOrEqual(10000)
    expect(text.length).toBeLessThanOrEqual(60000)
  })

  it("response content contains the canonical stage headers", async () => {
    const server = buildServer()
    registerFilmDirectorTool(server, emptySession())
    const result = await callTool(server, "start_film_director", {})
    const text = result.content[0]?.text ?? ""
    // The 10 stages are the spine of the skill. If any of these are missing
    // the LLM doesn't know the choreography.
    expect(text).toContain("Stage 0 — Initialize the live workspace")
    expect(text).toContain("Stage 1 — Story & Script")
    expect(text).toContain("Stage 2 — Shot List")
    expect(text).toContain("Stage 3 — Characters")
    expect(text).toContain("Stage 4 — Locations")
    expect(text).toContain("Stage 5 — Storyboard")
    expect(text).toContain("Stage 6 — Shot Animation")
    expect(text).toContain("Stage 7 — Audio")
    expect(text).toContain("Stage 8 — Final Assembly")
    expect(text).toContain("Stage 9 — Deliver")
  })

  it("response is idempotent across repeated invocations", async () => {
    const server = buildServer()
    registerFilmDirectorTool(server, emptySession())
    const r1 = await callTool(server, "start_film_director", {})
    const r2 = await callTool(server, "start_film_director", {})
    expect(r1.content[0]?.text).toBe(r2.content[0]?.text)
  })

  it("input schema is empty (no arguments)", async () => {
    const server = buildServer()
    registerFilmDirectorTool(server, emptySession())
    const tools = await listTools(server)
    const tool = tools.find((t) => t.name === "start_film_director")
    expect(tool).toBeDefined()
    // The MCP SDK serializes `inputSchema: {}` as { type: "object",
    // properties: {} } in the tools/list response. We don't depend on the
    // exact shape here — just that no required arguments are advertised.
    const schema = (tool as unknown as { inputSchema?: { required?: string[] } }).inputSchema
    if (schema?.required) {
      expect(schema.required).toEqual([])
    }
  })

  it("FALLBACK_SKILL_CONTENT is a self-contained, complete skill", () => {
    // Catches an accidental empty/stub fallback at refactor time.
    expect(FALLBACK_SKILL_CONTENT.length).toBeGreaterThanOrEqual(10000)
    expect(FALLBACK_SKILL_CONTENT).toContain("name: nodaro-film-director")
    expect(FALLBACK_SKILL_CONTENT).toContain("# Nodaro Film Director")
    expect(FALLBACK_SKILL_CONTENT).toContain("Stage 0 — Initialize")
    expect(FALLBACK_SKILL_CONTENT).toContain("Stage 9 — Deliver")
  })

  it("embedded constant matches on-disk SKILL.md (drift gate)", () => {
    // This is the sync gate: if someone edits the canonical SKILL.md
    // without updating FALLBACK_SKILL_CONTENT, this test fails locally
    // and in CI. In production runtime the file is .dockerignored and the
    // test would silently no-op via the conditional — but CI runs on a
    // checkout that DOES have .claude/, so drift is caught there.
    if (!existsSync(FILM_DIRECTOR_SKILL_PATH)) {
      // Self-hosted CI without .claude/ — skip gracefully.
      return
    }
    const onDisk = readFileSync(FILM_DIRECTOR_SKILL_PATH, "utf-8")
    expect(
      FALLBACK_SKILL_CONTENT,
      "FALLBACK_SKILL_CONTENT in film-director.ts has drifted from the canonical " +
        ".claude/skills/nodaro-film-director/SKILL.md. Re-sync the embedded copy.",
    ).toBe(onDisk)
  })
})
