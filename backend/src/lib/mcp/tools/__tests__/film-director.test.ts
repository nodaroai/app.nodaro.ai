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

  it("prefers Gemini Omni Flash 1.2 to Veo 3.1 for camera-heavy shots", () => {
    expect(FALLBACK_SKILL_CONTENT).toContain(
      "**Gemini Omni Flash 1.2** (`gemini-omni-flash-1-2`): when motion is camera-heavy. Prefer it over Veo 3.1",
    )
    expect(FALLBACK_SKILL_CONTENT).toContain("Use Veo 3.1 (`veo3.1`) only when the user asks for it.")
    // The rule it replaces: Veo as the camera-heavy pick.
    expect(FALLBACK_SKILL_CONTENT).not.toContain("**Veo / Veo 3.1**")
  })

  it("carries the narration and audio mix doctrine, every rule of it", () => {
    const start = FALLBACK_SKILL_CONTENT.indexOf("## Narration and audio mix")
    const end = FALLBACK_SKILL_CONTENT.indexOf("## Failure handling")
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const doctrine = FALLBACK_SKILL_CONTENT.slice(start, end)
    for (const heading of [
      "### 1. The voice leads the timing",
      "### 2. Script budget",
      "### 3. Never time-stretch narration",
      "### 4. One sentence per speech call, then measure and trim",
      "### 5. Placement",
      "### 6. Do not place a full voiceover with one `merge_video_audio` call",
      "### 7. Level-match the lines",
      "### 8. Music level and ducking",
      "### 9. Strip the native audio from the video clips",
      "### 10. Final merge and check",
      "### 11. Check the result with platform tools before showing it",
      "### 12. You cannot hear",
    ]) {
      expect(doctrine, `missing rule: ${heading}`).toContain(heading)
    }
    // The values an agent copies into its calls.
    expect(doctrine).toContain("`threshold_db: -35`, `min_silence_ms: 150`")
    expect(doctrine).toContain("`duck: { under: 0, ratio: 1 }`")
    expect(doctrine).toContain("the voice at `volume: 85`, the music at `volume: 40`")
    expect(doctrine).toContain("`duck: { under: 0, ratio: 4, threshold_db: -36, attack_ms: 20, release_ms: 700 }`")
    expect(doctrine).toContain("`keep_original_audio: false`")
    // The check before showing: the words, the mix, the picture, and what not to trust or use.
    expect(doctrine).toContain("Run `transcribe` on the final video")
    expect(doctrine).toContain("a Generate Text node (`llm-chat`) on `gemini-3.8-flash`")
    expect(doctrine).toContain("an Upload Video node (`upload-video`) into its `references` handle")
    expect(doctrine).toContain("Do not rely on that picture check for sound.")
    expect(doctrine).toContain("Do not use `video_analysis` for this check.")
  })

  it("lets the voice lead the timing in a narrated film, from the principles on", () => {
    expect(FALLBACK_SKILL_CONTENT).toContain("5. **Audio comes last, except narration.**")
    // Stage 1 sends a narrated film to the doctrine before the shot list is locked.
    const stage1 = FALLBACK_SKILL_CONTENT.slice(
      FALLBACK_SKILL_CONTENT.indexOf("## Stage 1 — Story & Script"),
      FALLBACK_SKILL_CONTENT.indexOf("## Stage 2 — Shot List"),
    )
    expect(stage1).toContain("**Narration and audio mix** before Stage 2")
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
