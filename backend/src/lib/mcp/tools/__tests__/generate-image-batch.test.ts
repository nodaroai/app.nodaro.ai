import { describe, it, expect, vi, beforeEach } from "vitest"
import { _resetRegistry } from "../../tasks.js"
import { buildServer, callTool, executeSession, stubRoute } from "./_helpers.js"

/**
 * generate_image `count` / `models` — several images in one call. The verb
 * forwards them to /v1/generate-image (which checks, creates and charges the
 * batch as a whole) and answers every job id, grouped by model. Model ids are
 * matched case-insensitively; an id that is not an image model is refused by
 * name (never dropped: a list of models asks for those models).
 */

vi.mock("../../../supabase.js", () => ({
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

const { registerVerbs } = await import("../verbs.js")

const BATCH = {
  jobId: "job-1",
  jobIds: ["job-1", "job-2", "job-3", "job-4"],
  batchId: "6b1f7e2a-0c4d-5e8f-9a1b-2c3d4e5f6a7b",
  groups: [
    { model: "gpt-image-2", jobIds: ["job-1", "job-2"], credits: 120 },
    { model: "flux-2-max", jobIds: ["job-3", "job-4"], credits: 180 },
  ],
  totalCredits: 300,
}

beforeEach(() => {
  _resetRegistry()
})

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? []).map((c) => c.text ?? "").join("\n")
}

describe("generate_image — count / models", () => {
  it("forwards count, and answers every job id grouped by model", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { ...BATCH, groups: [{ model: "gpt-image-2", jobIds: BATCH.jobIds }] })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { prompt: "a red car", model: "gpt-image-2", count: 4 })

    expect(result.isError).toBeUndefined()
    expect(received.body).toMatchObject({ provider: "gpt-image-2", count: 4 })
    const structured = result.structuredContent as Record<string, unknown>
    expect(structured.jobId).toBe("job-1")
    // Every id is in the text, grouped by model; the structured answer stays the
    // card's (the outputSchema carries no group map, to spare wire bytes).
    expect(structured).not.toHaveProperty("groups")
    expect(textOf(result)).toContain("gpt-image-2: job-1, job-2, job-3, job-4")
    expect(textOf(result)).toContain(BATCH.batchId)
  })

  it("forwards models (matched case-insensitively) and no provider", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", BATCH)
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", {
      prompt: "a red car",
      models: ["gpt-image-2", "FLUX-2-MAX"],
      count: 2,
    })

    expect(result.isError).toBeUndefined()
    expect(received.body?.models).toEqual(["gpt-image-2", "flux-2-max"])
    expect(received.body?.count).toBe(2)
    expect(received.body).not.toHaveProperty("provider")
    expect(textOf(result)).toContain("gpt-image-2: job-1, job-2")
    expect(textOf(result)).toContain("flux-2-max: job-3, job-4")
    expect((result.structuredContent as { jobId: unknown }).jobId).toBe("job-1")
  })

  it("models naming one image model (twice) run as that model", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { jobId: "job-1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_image", { prompt: "a red car", models: ["flux-2-max", "FLUX-2-MAX"] })

    expect(received.body?.provider).toBe("flux-2-max")
    expect(received.body).not.toHaveProperty("models")
  })

  it("an id that is not an image model is refused by name, and nothing is sent", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", BATCH)
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { prompt: "a red car", models: ["gpt-image-2", "not-a-model", "veo3"] })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('"not-a-model", "veo3"')
    expect(received.body).toBeUndefined()
  })

  it("more than 4 models: refused before anything is sent", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", BATCH)
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { prompt: "a red car", models: ["gpt-image-2", "flux-2-max", "imagen4", "seedream", "nano-banana-2"] })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain("2-4 image models")
    expect(received.body).toBeUndefined()
  })

  it("a count outside 1-4 is refused by name before anything is sent", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", BATCH)
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    for (const count of [0, 5]) {
      const result = await callTool(server, "generate_image", { prompt: "a red car", count })
      expect(result.isError).toBe(true)
      expect(textOf(result)).toContain("count takes 1-4 images")
    }
    expect(received.body).toBeUndefined()
  })

  it("a moodboard past one model's reference limit is said per model in the batch answer", async () => {
    const { fastify } = stubRoute("POST", "/v1/generate-image", {
      ...BATCH,
      groups: [
        { model: "gpt-image-2", jobIds: ["job-1", "job-2"] },
        { model: "flux-2-max", jobIds: ["job-3", "job-4"], warnings: [{ code: "moodboard_images_not_sent", message: "2 of the 6 images were not sent." }] },
      ],
    })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { prompt: "a red car", models: ["gpt-image-2", "flux-2-max"], count: 2 })
    expect(textOf(result)).toContain("Note (flux-2-max): 2 of the 6 images were not sent.")
  })

  it("every id unknown: refused, never one default-model job", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { jobId: "job-1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { prompt: "a red car", models: ["nope", "nada"] })

    expect(result.isError).toBe(true)
    expect(received.body).toBeUndefined()
  })

  it("leaves the aspect ratio for the route to fit to each model, after fixing its spelling", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", BATCH)
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    await callTool(server, "generate_image", { prompt: "a red car", models: ["gpt-image-2", "flux-2-max"], aspect_ratio: "16x9" })

    expect(received.body?.aspectRatio).toBe("16:9")
  })

  it("refuses model and models together, before anything is sent", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", BATCH)
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { prompt: "a red car", model: "gpt-image-2", models: ["gpt-image-2", "flux-2-max"] })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/model.*models/)
    expect(received.body).toBeUndefined()
  })

  // With a preset: `count` rides #2267's own preset call (the preset is built
  // here, by the one application path, then N images of it); `models` hands the
  // preset to the route, whose hook applies it once per model through the same
  // path — never a second copy of that logic here.
  it("presetId + count: the preset's request, N images of it", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { ...BATCH, groups: [{ model: "gpt-image-2", jobIds: ["job-1", "job-2"] }], jobIds: ["job-1", "job-2"] })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { presetId: "generate-image/cinematic-still", prompt: "a lighthouse", count: 2 })

    expect(result.isError).toBeUndefined()
    expect(received.body?.count).toBe(2)
    expect(received.body).not.toHaveProperty("presetId")
    expect(received.body?.provider).toBe("gpt-image-2")
    expect(String(received.body?.prompt)).toContain("a lighthouse")
    expect(textOf(result)).toContain("gpt-image-2: job-1, job-2")
  })

  it("presetId + models: the preset goes to the route, which applies it once per model", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", BATCH)
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", {
      presetId: "generate-image/cinematic-still",
      variables: { BRAND: "Acme" },
      prompt: "a lighthouse",
      models: ["gpt-image-2", "flux-2-max"],
      aspect_ratio: "16x9",
      count: 2,
    })

    expect(result.isError).toBeUndefined()
    expect(received.body).toMatchObject({
      presetId: "generate-image/cinematic-still",
      presetVariables: { BRAND: "Acme" },
      models: ["gpt-image-2", "flux-2-max"],
      count: 2,
      prompt: "a lighthouse",
      aspectRatio: "16:9",
    })
    // No provider: each model is the preset's provider edit, made by the route.
    expect(received.body).not.toHaveProperty("provider")
    // Only what the caller set overrides the preset (no saved defaults, no filled-in levers).
    expect(received.body).not.toHaveProperty("resolution")
    expect(textOf(result)).toContain("flux-2-max: job-3, job-4")
  })

  it("one image is answered exactly as before: no count, no models, no jobIds", async () => {
    const { fastify, received } = stubRoute("POST", "/v1/generate-image", { jobId: "job-1" })
    const server = buildServer()
    registerVerbs({ server, session: executeSession(), fastify })

    const result = await callTool(server, "generate_image", { prompt: "a red car" })

    expect(received.body).not.toHaveProperty("count")
    expect(received.body).not.toHaveProperty("models")
    const structured = result.structuredContent as Record<string, unknown>
    expect(structured.jobId).toBe("job-1")
    expect(structured).not.toHaveProperty("groups")
  })
})
