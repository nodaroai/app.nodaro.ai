/**
 * MCP `suno_add_vocals` / `suno_add_instrumental` (decided 2026-11-23): the
 * caller's direction is in the schema with the route's bounds, and reaches
 * the route body under the route's names. A Suno track goes by its ids, any
 * other audio by its file; old calls (an asset id and a model) still work.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { z } from "zod"

const h = vi.hoisted(() => ({ dispatch: vi.fn(), resolveAsset: vi.fn() }))
vi.mock("../_verb-helpers.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_verb-helpers.js")>()),
  dispatchJob: h.dispatch,
}))
vi.mock("../../asset-resolver.js", () => ({ resolveAssetId: h.resolveAsset }))

import { registerSunoAddTrackVerbs } from "../verbs-suno-add-track.js"

type Tool = { config: { inputSchema: Record<string, z.ZodTypeAny> }; handler: (args: Record<string, unknown>) => Promise<unknown> }
const tools = new Map<string, Tool>()
const server = { registerTool: (name: string, config: Tool["config"], handler: Tool["handler"]) => tools.set(name, { config, handler }) }
const session = { userId: "user-1", clientName: "claude" }
const resolveSunoIds = vi.fn()

registerSunoAddTrackVerbs({ server, session, fastify: {}, resolveSunoIds } as never)

const parse = (tool: string, args: Record<string, unknown>) => z.object(tools.get(tool)!.config.inputSchema).safeParse(args)
const run = (tool: string, args: Record<string, unknown>) => tools.get(tool)!.handler(args)
const payloadOf = () => (h.dispatch.mock.calls.at(-1)![2] as { url: string; payload: Record<string, unknown> })

beforeEach(() => {
  h.dispatch.mockReset().mockResolvedValue({ content: [] })
  h.resolveAsset.mockReset()
  resolveSunoIds.mockReset()
})

describe("the schemas", () => {
  it("both tools take the direction; only Add Vocals takes a prompt", () => {
    for (const tool of ["suno_add_vocals", "suno_add_instrumental"]) {
      const keys = Object.keys(tools.get(tool)!.config.inputSchema)
      for (const k of ["audio_asset_id", "audio_url", "model", "style", "title", "negative_tags", "vocal_gender", "style_weight", "weirdness_constraint", "audio_weight"]) {
        expect(keys, `${tool}: ${k}`).toContain(k)
      }
    }
    expect(Object.keys(tools.get("suno_add_vocals")!.config.inputSchema)).toContain("prompt")
    expect(Object.keys(tools.get("suno_add_instrumental")!.config.inputSchema)).not.toContain("prompt")
  })

  it("the old call is still valid, and the bounds are the route's", () => {
    expect(parse("suno_add_vocals", { audio_asset_id: "job-1", model: "V6" }).success).toBe(true)
    expect(parse("suno_add_vocals", { audio_asset_id: "job-1", style: "s".repeat(1001) }).success).toBe(false)
    expect(parse("suno_add_vocals", { audio_asset_id: "job-1", negative_tags: "n".repeat(201) }).success).toBe(false)
    expect(parse("suno_add_vocals", { audio_asset_id: "job-1", prompt: "p".repeat(5001) }).success).toBe(false)
    expect(parse("suno_add_vocals", { audio_asset_id: "job-1", vocal_gender: "f" }).success).toBe(false)
    expect(parse("suno_add_vocals", { audio_asset_id: "job-1", style_weight: 1.1 }).success).toBe(false)
    expect(parse("suno_add_instrumental", { audio_asset_id: "job-1", title: "t".repeat(81) }).success).toBe(false)
  })
})

describe("what reaches the route", () => {
  it("a Suno track goes by its ids, with the direction under the route's names", async () => {
    resolveSunoIds.mockResolvedValue({ sunoTaskId: "t-1", sunoTrackId: "a-1" })
    await run("suno_add_vocals", {
      audio_asset_id: "job-1", prompt: "[Chorus] la", style: "soul", title: "T", negative_tags: "rap",
      vocal_gender: "female", style_weight: 0.5, weirdness_constraint: 0.1, audio_weight: 0.9,
    })
    expect(payloadOf().url).toBe("/v1/suno/add-vocals")
    expect(payloadOf().payload).toMatchObject({
      taskId: "t-1", audioId: "a-1", model: "V6", prompt: "[Chorus] la", style: "soul", title: "T", negativeTags: "rap",
      vocalGender: "female", styleWeight: 0.5, weirdnessConstraint: 0.1, audioWeight: 0.9, userId: "user-1",
    })
    expect(payloadOf().payload).not.toHaveProperty("uploadUrl")
  })

  it("any other audio goes by its file; a direct link needs no lookup", async () => {
    resolveSunoIds.mockResolvedValue(null)
    h.resolveAsset.mockResolvedValue("https://cdn/upload.mp3")
    await run("suno_add_instrumental", { audio_asset_id: "upload-1", style: "piano" })
    expect(payloadOf().payload).toMatchObject({ uploadUrl: "https://cdn/upload.mp3", style: "piano" })
    expect(payloadOf().payload).not.toHaveProperty("taskId")
    await run("suno_add_instrumental", { audio_url: "https://x/vocal.mp3", style: "piano" })
    expect(payloadOf().payload).toMatchObject({ uploadUrl: "https://x/vocal.mp3" })
    expect(resolveSunoIds).toHaveBeenCalledTimes(1)
  })

  it("no song, or an asset with no audio: an error, nothing dispatched", async () => {
    expect(await run("suno_add_vocals", { style: "pop" })).toMatchObject({ isError: true })
    resolveSunoIds.mockResolvedValue(null)
    h.resolveAsset.mockResolvedValue(null)
    expect(await run("suno_add_vocals", { audio_asset_id: "nothing" })).toMatchObject({ isError: true })
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})
