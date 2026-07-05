import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { registerVerbs } from "../verbs.js"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "./_helpers.js"

beforeEach(() => {
  _resetRegistry()
})

/**
 * Task 4: `generate_image` accepts a `presetId` and APPLIES the preset's real
 * config server-side via `resolvePreset` (factory + custom). The behavior-bearing
 * piece of the preset-usability work — output is FAITHFUL, not the LLM guessing
 * what the preset must contain.
 *
 * The supabase mock here returns no custom preset rows AND empty mcp_preferences,
 * so these tests exercise the FACTORY path (no DB) + the catalog-default fallback.
 * The factory preset `generate-image/location-board` ships
 * `{ provider: "nano-banana-pro", aspectRatio: "16:9", resolution: "2K", prompt: "...LOCATION BOARD..." }`.
 */
import { vi } from "vitest"

// A mutable holder for the row `resolvePreset`'s CUSTOM path reads via
// `.maybeSingle()`. Default `null` → no custom row → factory-only path (what
// all the factory-preset tests below rely on). The migrated-field precedence
// test (Task 5) sets this to a custom `node_presets` row carrying
// `provider`/`model`, then `afterEach` resets it — so a stale row can never
// leak into another test. `vi.hoisted` lets the (hoisted) `vi.mock` factory
// close over it.
const customPresetRow = vi.hoisted(() => ({
  value: null as Record<string, unknown> | null,
}))

afterEach(() => {
  customPresetRow.value = null
})

// Both resolve-preset.ts (src/lib/presets/) and user-preferences.ts
// (src/lib/mcp/) import the SAME module: src/lib/supabase.ts. From this test
// file that's three levels up (__tests__ → tools → mcp → lib).
vi.mock("../../../supabase.js", () => {
  // resolvePreset's custom path chains .eq().eq().eq().maybeSingle(); the
  // pref read chains .eq().single(). A self-returning `eq` supports both
  // arities. maybeSingle → the custom row holder (null = factory-only);
  // single → empty prefs.
  const chain: Record<string, unknown> = {
    eq: () => chain,
    maybeSingle: async () => ({ data: customPresetRow.value, error: null }),
    single: async () => ({ data: { mcp_preferences: {} }, error: null }),
  }
  return {
    supabase: {
      from: () => ({ select: () => chain }),
    },
  }
})

/**
 * Register generate_image against a stub /v1/generate-image and return the body
 * the handler would submit to the route (after preset application + override).
 */
async function runGenerateImage(
  args: Record<string, unknown>,
): Promise<{ result: Awaited<ReturnType<typeof callTool>>; body: Record<string, unknown> | undefined }> {
  const { fastify, received } = stubRoute("POST", "/v1/generate-image", { jobId: "j-preset" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const result = await callTool(server, "generate_image", args)
  return { result, body: received.body }
}

describe("generate_image preset application", () => {
  it("applies a factory preset's config (provider + prompt) when given presetId with no explicit prompt/provider", async () => {
    const { result, body } = await runGenerateImage({
      presetId: "generate-image/location-board",
    })

    expect(result.isError).toBeUndefined()
    // Preset supplies the provider and prompt — they reach the route verbatim.
    expect(body?.provider).toBe("nano-banana-pro")
    expect(body?.prompt).toContain("LOCATION BOARD")
    // Preset's other config fields are applied too.
    expect(body?.aspectRatio).toBe("16:9")
    expect(body?.resolution).toBe("2K")
    // presetId itself must NOT leak into the route payload.
    expect(body?.presetId).toBeUndefined()
  })

  it("lets an explicit prompt OVERRIDE the preset's prompt", async () => {
    const { result, body } = await runGenerateImage({
      presetId: "generate-image/location-board",
      prompt: "my own prompt",
    })

    expect(result.isError).toBeUndefined()
    expect(body?.prompt).toBe("my own prompt")
    // Non-overridden preset fields still apply.
    expect(body?.provider).toBe("nano-banana-pro")
  })

  it("lets an explicit provider/model OVERRIDE the preset's provider", async () => {
    const { result, body } = await runGenerateImage({
      presetId: "generate-image/location-board",
      model: "nano-banana-2",
    })

    expect(result.isError).toBeUndefined()
    expect(body?.provider).toBe("nano-banana-2")
    // The preset's prompt is still applied (only model was overridden).
    expect(body?.prompt).toContain("LOCATION BOARD")
  })

  // THE critical-rule guard: a field the caller did NOT pass must keep the
  // preset's value, even though the schema lists it. (`aspect_ratio` is plain
  // .optional() with no .default(), so an absent caller value is `undefined`
  // and must lose to the preset — never silently clobber it.)
  it("does NOT let a non-caller-provided field clobber the preset value", async () => {
    const { result, body } = await runGenerateImage({
      presetId: "generate-image/cinematic-portrait", // ships aspectRatio "9:16"
    })

    expect(result.isError).toBeUndefined()
    // Caller never sent aspect_ratio → the preset's 9:16 must win (not the
    // generate_image default of 16:9).
    expect(body?.aspectRatio).toBe("9:16")
    expect(body?.provider).toBe("nano-banana-pro")
  })

  it("returns isError for an unknown presetId (does not silently generate)", async () => {
    const { result, body } = await runGenerateImage({
      presetId: "generate-image/does-not-exist",
      prompt: "x",
    })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/Preset not found/i)
    // The route must NOT have been hit.
    expect(body).toBeUndefined()
  })

  // Task 4 relaxed `prompt` from required → .optional() so a preset can supply
  // it. The promptless guard therefore moved OUT of Zod (framework-enforced) and
  // INTO the handler (a hand-rolled check). These tests pin that guard so a
  // future refactor can't silently let a bare, promptless call dispatch an
  // empty generation. Guard: verbs-image.ts — `effective.prompt === undefined
  // || effective.prompt === ""` → isError, route never hit.
  it("returns isError when given neither prompt nor presetId (does not silently generate)", async () => {
    const { result, body } = await runGenerateImage({})

    expect(result.isError).toBe(true)
    // The handler's own message (not Zod's) — prompt is .optional() in the schema.
    expect((result.content[0] as { text: string }).text).toMatch(/prompt/i)
    // No preset to supply one and no caller prompt → must NOT dispatch.
    expect(body).toBeUndefined()
  })

  // The guard treats an empty-string prompt as missing too
  // (`effective.prompt === ""`), so `prompt: ""` with no presetId is guarded
  // identically — an empty prompt must never reach the provider.
  it("returns isError for an empty-string prompt with no presetId (does not silently generate)", async () => {
    const { result, body } = await runGenerateImage({ prompt: "" })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/prompt/i)
    expect(body).toBeUndefined()
  })
})

/**
 * Task 5: extend the SAME `presetId` apply mechanism to the other primary
 * generation verbs — generate_video / generate_music / generate_speech /
 * text_to_audio. Each mirrors generate_image: the preset is the BASE; only
 * caller-PROVIDED fields override it; an unknown presetId is an error (route
 * never hit); `presetId` itself never reaches the route.
 *
 * Factory presets used (real, from packages/shared/src/factory-presets/):
 *  - generate-video/slow-push-in  → provider veo3.1, aspectRatio 16:9, duration 8, prompt "slow cinematic push-in…"
 *  - generate-music/lofi-study    → genre lofi, mood "chill, relaxed, nostalgic", instrumental true, duration 30, prompt "lo-fi hip-hop study beat…"
 *  - text-to-speech/hype          → speed 1.15, stability 0.25, similarityBoost 0.7, style 0.8 (tuning overlay; text still required)
 *  - text-to-audio/rain-ambience  → provider elevenlabs-sfx, duration 22, loop true, promptInfluence 0.4, prompt "steady gentle rain ambience…"
 */

// ── generate_video → /v1/text-to-video ──────────────────────────────────────
async function runGenerateVideo(
  args: Record<string, unknown>,
): Promise<{ result: Awaited<ReturnType<typeof callTool>>; body: Record<string, unknown> | undefined }> {
  const { fastify, received } = stubRoute("POST", "/v1/text-to-video", { jobId: "j-vid" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const result = await callTool(server, "generate_video", args)
  return { result, body: received.body }
}

describe("generate_video preset application", () => {
  it("applies a factory preset's provider + prompt (+ aspectRatio/duration) with no explicit fields", async () => {
    const { result, body } = await runGenerateVideo({ presetId: "generate-video/slow-push-in" })

    expect(result.isError).toBeUndefined()
    expect(body?.provider).toBe("veo3.1")
    expect(body?.prompt).toContain("push-in")
    expect(body?.aspectRatio).toBe("16:9")
    expect(body?.duration).toBe(8)
    expect(body?.presetId).toBeUndefined()
  })

  it("lets an explicit prompt OVERRIDE the preset's prompt", async () => {
    const { result, body } = await runGenerateVideo({
      presetId: "generate-video/slow-push-in",
      prompt: "my own video prompt",
    })

    expect(result.isError).toBeUndefined()
    expect(body?.prompt).toBe("my own video prompt")
    // Non-overridden preset fields still apply.
    expect(body?.provider).toBe("veo3.1")
  })

  it("lets an explicit model OVERRIDE the preset's provider", async () => {
    const { result, body } = await runGenerateVideo({
      presetId: "generate-video/slow-push-in",
      model: "kling-3.0",
    })

    expect(result.isError).toBeUndefined()
    expect(body?.provider).toBe("kling-3.0")
    expect(body?.prompt).toContain("push-in")
  })

  it("returns isError for an unknown presetId (route not hit)", async () => {
    const { result, body } = await runGenerateVideo({
      presetId: "generate-video/does-not-exist",
      prompt: "x",
    })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/Preset not found/i)
    expect(body).toBeUndefined()
  })

  it("returns isError when given neither prompt nor presetId (route not hit)", async () => {
    const { result, body } = await runGenerateVideo({})

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/prompt/i)
    expect(body).toBeUndefined()
  })
})

// ── generate_music → /v1/suno/generate (default) or /v1/generate-music ───────
async function runGenerateMusic(
  args: Record<string, unknown>,
): Promise<{
  result: Awaited<ReturnType<typeof callTool>>
  sunoBody: Record<string, unknown> | undefined
  minimaxBody: Record<string, unknown> | undefined
}> {
  const suno = stubRoute("POST", "/v1/suno/generate", { jobId: "j-suno" })
  // Register the minimax route on the SAME fastify instance so either path resolves.
  suno.fastify.post("/v1/generate-music", async (req) => {
    ;(suno.received as { minimax?: Record<string, unknown> }).minimax = req.body as Record<string, unknown>
    return { jobId: "j-mm" }
  })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify: suno.fastify })
  const result = await callTool(server, "generate_music", args)
  return {
    result,
    sunoBody: suno.received.body,
    minimaxBody: (suno.received as { minimax?: Record<string, unknown> }).minimax,
  }
}

describe("generate_music preset application", () => {
  it("applies a factory preset's prompt + genre/mood/instrumental (default suno path) with no explicit fields", async () => {
    const { result, sunoBody } = await runGenerateMusic({ presetId: "generate-music/lofi-study" })

    expect(result.isError).toBeUndefined()
    // Default model (suno-v5-5) → suno path; genre+mood fold into `style`.
    expect(sunoBody?.prompt).toContain("lo-fi hip-hop study beat")
    expect(sunoBody?.instrumental).toBe(true)
    expect(sunoBody?.style).toContain("lofi")
    expect(sunoBody?.presetId).toBeUndefined()
  })

  it("maps preset genre/mood/duration onto the minimax route when model=minimax overrides", async () => {
    const { result, minimaxBody } = await runGenerateMusic({
      presetId: "generate-music/lofi-study",
      model: "minimax",
    })

    expect(result.isError).toBeUndefined()
    expect(minimaxBody?.provider).toBe("minimax")
    expect(minimaxBody?.genre).toBe("lofi")
    expect(minimaxBody?.mood).toBe("chill, relaxed, nostalgic")
    expect(minimaxBody?.duration).toBe(30)
    expect(minimaxBody?.prompt).toContain("lo-fi hip-hop study beat")
  })

  it("lets an explicit prompt OVERRIDE the preset's prompt", async () => {
    const { result, sunoBody } = await runGenerateMusic({
      presetId: "generate-music/lofi-study",
      prompt: "my own music prompt",
    })

    expect(result.isError).toBeUndefined()
    expect(sunoBody?.prompt).toBe("my own music prompt")
    expect(sunoBody?.instrumental).toBe(true)
  })

  it("returns isError for an unknown presetId (route not hit)", async () => {
    const { result, sunoBody, minimaxBody } = await runGenerateMusic({
      presetId: "generate-music/does-not-exist",
      prompt: "x",
    })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/Preset not found/i)
    expect(sunoBody).toBeUndefined()
    expect(minimaxBody).toBeUndefined()
  })

  it("returns isError when given neither prompt nor presetId (route not hit)", async () => {
    const { result, sunoBody, minimaxBody } = await runGenerateMusic({})

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/prompt/i)
    expect(sunoBody).toBeUndefined()
    expect(minimaxBody).toBeUndefined()
  })

  // ── Task 5 `.default()`→in-handler-default migration guards ────────────────
  // `model` was Zod `.default("suno-v5-5")`; Task 5 made it `.optional()` and
  // moved the default into the handler (`(effective.model ?? "suno-v5-5")`) so a
  // defaulted model can't clobber a preset's provider. These pin the exact
  // lines the migration changed (the silent-regression class).

  // 1. No presetId, no model → the IN-HANDLER default fires: model id
  // `suno-v5-5` → suno dispatch path, serialized as `model: "V5_5"` in the body.
  // Drop the `?? "suno-v5-5"` fallback and `effective.model` is undefined →
  // `modelId` undefined → isSuno false → this would route to minimax instead.
  it("dispatches the in-handler default model (suno-v5-5 → suno path, body model V5_5) with no preset and no model", async () => {
    const { result, sunoBody, minimaxBody } = await runGenerateMusic({ prompt: "x" })

    expect(result.isError).toBeUndefined()
    // The default routes to the SUNO path with the serialized version id.
    expect(sunoBody?.model).toBe("V5_5")
    expect(sunoBody?.prompt).toBe("x")
    // The non-default (minimax) route must NOT have been used.
    expect(minimaxBody).toBeUndefined()
  })

  // 3. Migrated-field precedence: a CUSTOM preset carrying provider=minimax must
  // survive when the caller omits `model` — the in-handler default (suno-v5-5)
  // must NOT clobber it. Exercises the real custom-preset path (supabase row →
  // resolvePreset → handler), then asserts the minimax route got the preset's
  // provider and the suno default-path route was never hit.
  it("keeps a custom preset's provider (minimax) over the in-handler default when the caller omits model", async () => {
    customPresetRow.value = {
      id: "11111111-1111-1111-1111-111111111111",
      node_type: "generate-music",
      name: "My Minimax Loop",
      description: null,
      data: { provider: "minimax", genre: "lofi", mood: "chill", duration: 20 },
    }
    const { result, sunoBody, minimaxBody } = await runGenerateMusic({
      presetId: "11111111-1111-1111-1111-111111111111",
      prompt: "x",
    })

    expect(result.isError).toBeUndefined()
    // Preset's provider wins — dispatched to the minimax route, NOT defaulted to suno.
    expect(minimaxBody?.provider).toBe("minimax")
    expect(minimaxBody?.genre).toBe("lofi")
    expect(sunoBody).toBeUndefined()
  })
})

// ── generate_speech → /v1/text-to-speech ─────────────────────────────────────
async function runGenerateSpeech(
  args: Record<string, unknown>,
): Promise<{ result: Awaited<ReturnType<typeof callTool>>; body: Record<string, unknown> | undefined }> {
  const { fastify, received } = stubRoute("POST", "/v1/text-to-speech", { jobId: "j-tts" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const result = await callTool(server, "generate_speech", args)
  return { result, body: received.body }
}

describe("generate_speech preset application", () => {
  it("applies a factory preset's tuning (speed/stability/style) as an overlay; caller supplies text", async () => {
    const { result, body } = await runGenerateSpeech({
      presetId: "text-to-speech/hype",
      text: "Hello there",
    })

    expect(result.isError).toBeUndefined()
    expect(body?.text).toBe("Hello there")
    expect(body?.speed).toBe(1.15)
    expect(body?.stability).toBe(0.25)
    expect(body?.style).toBe(0.8)
    expect(body?.similarityBoost).toBe(0.7)
    // The verb's elevenlabs-v3 default is preserved (the factory preset sets no provider).
    expect(body?.provider).toBe("elevenlabs-v3")
    expect(body?.presetId).toBeUndefined()
  })

  it("lets an explicit tuning field OVERRIDE the preset (stability)", async () => {
    const { result, body } = await runGenerateSpeech({
      presetId: "text-to-speech/hype",
      text: "Hello",
      stability: 0.9,
    })

    expect(result.isError).toBeUndefined()
    expect(body?.stability).toBe(0.9)
    // Non-overridden preset fields still apply.
    expect(body?.speed).toBe(1.15)
  })

  it("returns isError for an unknown presetId (route not hit)", async () => {
    const { result, body } = await runGenerateSpeech({
      presetId: "text-to-speech/does-not-exist",
      text: "x",
    })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/Preset not found/i)
    expect(body).toBeUndefined()
  })

  // ── Task 5 `.default()`→in-handler-default migration guards ────────────────
  // `model` was Zod `.default("elevenlabs-v3")`; Task 5 made it `.optional()`
  // and moved the default into the handler (`(effective.model ?? "elevenlabs-v3")`)
  // so a defaulted model can't clobber a custom preset's provider.

  // 2. No presetId, no model → the IN-HANDLER default fires: the dispatched
  // payload's provider is `elevenlabs-v3`. Drop the `?? "elevenlabs-v3"`
  // fallback and `provider` would go out as `undefined`.
  it("dispatches the in-handler default provider (elevenlabs-v3) with no preset and no model", async () => {
    const { result, body } = await runGenerateSpeech({ text: "x" })

    expect(result.isError).toBeUndefined()
    expect(body?.provider).toBe("elevenlabs-v3")
    expect(body?.text).toBe("x")
  })

  // 4. `text` stays Zod-required (the tuning-overlay presets supply no text), so
  // a preset can never satisfy it — a presetId with no text must reject at the
  // SDK input-validation boundary (isError) and never hit the route.
  it("returns isError for a presetId with no text (text is Zod-required; route not hit)", async () => {
    const { result, body } = await runGenerateSpeech({ presetId: "text-to-speech/hype" })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/text/i)
    expect(body).toBeUndefined()
  })
})

// ── text_to_audio → /v1/text-to-audio ────────────────────────────────────────
async function runTextToAudio(
  args: Record<string, unknown>,
): Promise<{ result: Awaited<ReturnType<typeof callTool>>; body: Record<string, unknown> | undefined }> {
  const { fastify, received } = stubRoute("POST", "/v1/text-to-audio", { jobId: "j-sfx" })
  const server = buildServer()
  registerVerbs({ server, session: executeSession(), fastify })
  const result = await callTool(server, "text_to_audio", args)
  return { result, body: received.body }
}

describe("text_to_audio preset application", () => {
  it("applies a factory preset's prompt + duration/loop/promptInfluence with no explicit fields", async () => {
    const { result, body } = await runTextToAudio({ presetId: "text-to-audio/rain-ambience" })

    expect(result.isError).toBeUndefined()
    expect(body?.prompt).toContain("rain")
    expect(body?.duration).toBe(22)
    expect(body?.loop).toBe(true)
    expect(body?.promptInfluence).toBe(0.4)
    expect(body?.presetId).toBeUndefined()
  })

  it("lets an explicit prompt OVERRIDE the preset's prompt", async () => {
    const { result, body } = await runTextToAudio({
      presetId: "text-to-audio/rain-ambience",
      prompt: "glass shattering",
    })

    expect(result.isError).toBeUndefined()
    expect(body?.prompt).toBe("glass shattering")
    // Non-overridden preset fields still apply.
    expect(body?.duration).toBe(22)
  })

  it("returns isError for an unknown presetId (route not hit)", async () => {
    const { result, body } = await runTextToAudio({
      presetId: "text-to-audio/does-not-exist",
      prompt: "x",
    })

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/Preset not found/i)
    expect(body).toBeUndefined()
  })

  it("returns isError when given neither prompt nor presetId (route not hit)", async () => {
    const { result, body } = await runTextToAudio({})

    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/prompt/i)
    expect(body).toBeUndefined()
  })
})

/**
 * Guard: each annotated verb's nodeType actually has factory presets, so the
 * mechanism has something to resolve. Mirrors the per-verb→nodeType map in the
 * handlers (a typo'd nodeType would make every preset a "not found").
 */
describe("Task 5 verb→nodeType factory-preset coverage", () => {
  it.each([
    ["generate-video"],
    ["generate-music"],
    ["text-to-speech"],
    ["text-to-audio"],
  ])("%s has at least one factory preset", async (nodeType) => {
    const { getFactoryPresets } = await import("@nodaro/prompts")
    expect(getFactoryPresets(nodeType).length).toBeGreaterThan(0)
  })
})
