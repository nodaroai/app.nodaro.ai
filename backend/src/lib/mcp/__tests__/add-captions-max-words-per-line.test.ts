import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  CAPTION_MAX_WORDS_PER_LINE_MIN,
  CAPTION_MAX_WORDS_PER_LINE_MAX,
} from "@nodaro/shared/captions"
import { _resetRegistry } from "../tasks.js"
import { buildServer, callTool, executeSession, listTools, stubRoute } from "../tools/__tests__/_helpers.js"

/**
 * `max_words_per_line` on `add_captions`, and the doctrine move that paid for it.
 *
 * The lever caps the words a caption LINE (or tiktok-words page) may hold, on
 * top of the width budget — the one-or-two-words-at-a-time CapCut read. It
 * exists top-level AND per segment, and the MCP spelling is snake_case while
 * the payload the route takes is camelCase, so the mapping is worth pinning on
 * both.
 *
 * The second half is the reason the argument fits at all: `add_captions` had
 * been sitting ~45 B under the per-tool wire budget because its description
 * carried the DOCTRINE. That now lives in `backend/skills/nodes/add-captions.md`,
 * served by `get_node_skill`. Nothing true may be lost in a move, so the facts
 * that left the wire are asserted to be IN the skill — otherwise a trim reads
 * as a saving right up until the caller needs the sentence that was deleted.
 */

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          single: async () => ({ data: { mcp_preferences: {} }, error: null }),
        }),
      }),
    }),
  },
}))

const { registerVerbs } = await import("../tools/verbs.js")

beforeEach(() => {
  _resetRegistry()
})

const CLIP = "https://cdn.nodaro.ai/videos/clip.mp4"

function serve() {
  const { fastify, received } = stubRoute("POST", "/v1/add-captions", { jobId: "j-1" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  return { server, received }
}

describe("add_captions — max_words_per_line", () => {
  it("reaches the route as camelCase `maxWordsPerLine`", async () => {
    const { server, received } = serve()
    await callTool(server, "add_captions", {
      video_url: CLIP,
      style: "word-highlight",
      max_words_per_line: 2,
    })
    expect(received.body?.maxWordsPerLine).toBe(2)
  })

  it("is carried per segment too, and a segment without one inherits nothing here", async () => {
    const { server, received } = serve()
    await callTool(server, "add_captions", {
      video_url: CLIP,
      style: "word-highlight",
      max_words_per_line: 4,
      segments: [
        { start_ms: 0, end_ms: 2000, max_words_per_line: 1 },
        { start_ms: 2000, end_ms: 6000 },
      ],
    })
    expect(received.body?.maxWordsPerLine).toBe(4)
    const segments = received.body?.segments as Array<Record<string, unknown>>
    // The MCP layer passes what the caller wrote; the top-level value is applied
    // to an omitting segment downstream (caption-segments.ts), not here.
    expect(segments[0]!.maxWordsPerLine).toBe(1)
    expect(segments[1]!.maxWordsPerLine).toBeUndefined()
  })

  it("rejects a value outside the shared bounds", async () => {
    const { server, received } = serve()
    for (const bad of [CAPTION_MAX_WORDS_PER_LINE_MIN - 1, CAPTION_MAX_WORDS_PER_LINE_MAX + 1, 2.5]) {
      const res = await callTool(server, "add_captions", { video_url: CLIP, max_words_per_line: bad })
      expect(res.isError, `${bad} should not be accepted`).toBe(true)
    }
    expect(received.body).toBeUndefined()
  })
})

describe("add_captions — the wire carries the call, the skill carries the doctrine", () => {
  async function addCaptions() {
    const { server } = serve()
    const tool = (await listTools(server)).find((t) => t.name === "add_captions")
    expect(tool, "add_captions is not registered").toBeDefined()
    return tool!
  }

  it("keeps the whole definition well inside the per-tool wire budget", async () => {
    const bytes = JSON.stringify(await addCaptions()).length
    // The per-tool cap is 8_192 B (tool-surface-snapshot.test.ts owns it). This
    // asserts the HEADROOM the doctrine move bought, not just the cap: the next
    // lever must not have to delete a sentence to fit.
    expect(bytes).toBeLessThanOrEqual(6_700)
  })

  it("points the caller at the skill instead of inlining the doctrine", async () => {
    const description = (await addCaptions()).description ?? ""
    expect(description).toContain('get_node_skill("add-captions")')
    // The two input routes and the static/kinetic split are what an agent needs
    // to make a correct FIRST call — those stay on the wire.
    expect(description).toContain("video_url")
    expect(description).toContain("video_asset_id")
    expect(description).toContain("auto_transcribe")
  })

  it("does not leave the moved doctrine behind on the wire", async () => {
    const wire = JSON.stringify(await addCaptions())
    // Each of these is a sentence that used to be in the tool description or an
    // arg describe and now lives in the skill. Re-inlining one here is how the
    // description crept to 45 B under the cap in the first place.
    for (const moved of [
      "Inter, no outline",
      "nearest loaded",
      "token-by-token",
      "starts fresh from that preset",
      "is metadata, ignored by rendering",
      "auto-spaced",
    ]) {
      expect(wire, `"${moved}" belongs in the skill, not the tool schema`).not.toContain(moved)
    }
  })

  it("the skill really carries every fact the wire gave up", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const skill = readFileSync(
      resolve(here, "../../../../skills/nodes/add-captions.md"),
      "utf8",
    )
    const facts: Array<[string, RegExp]> = [
      ["the default look is outline", /UNSET = `outline`/],
      ["what `clean` opts into", /`look: "clean"` opts out \(Inter/],
      ["levers override one field of the look", /override ONE field of the chosen look/],
      ["which levers reach `subtitle`", /ALSO styles `subtitle`/],
      ["what `animate: false` keeps", /`animate: false` makes a kinetic style STAND STILL/],
      ["where `highlight_color` lands", /token by token for `tiktok-words`/],
      ["`font_weight` falls back to a loaded weight", /nearest weight that is loaded/],
      ["`timestampMs` / `confidence` semantics", /`timestampMs` is the word timestamp/],
      ["the `segments[]` look cascade", /starts fresh from that preset/],
      ["`max_words_per_line` is a ceiling", /never a floor/],
      ["`max_words_per_line` is inert on word-pop", /inert on `word-pop`/],
    ]
    for (const [what, re] of facts) {
      expect(skill, `the skill no longer explains ${what}`).toMatch(re)
    }
  })

  it("the skill states the ONE refusal the levers have on subtitle", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const skill = readFileSync(
      resolve(here, "../../../../skills/nodes/add-captions.md"),
      "utf8",
    )
    // The route rejects `highlight_color` and `animate` on a styleless subtitle
    // and NOTHING else (KINETIC_ONLY_CAPTION_LEVER_KEYS). The skill used to say
    // every styling lever was a 400 there, which was false and cost a caller a
    // round trip to find out.
    expect(skill).toMatch(/Only `highlight_color` and `animate` are refused on `subtitle`/)
    expect(skill).not.toMatch(/Look levers are refused on `subtitle`/)
  })
})
