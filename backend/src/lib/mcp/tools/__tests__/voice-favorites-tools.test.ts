/**
 * The voice favorites over MCP: `list_voice_favorites` under assets:read and
 * `favorite_voice` under assets:write (the scopes the REST routes ask an OAuth
 * app for), each a call to its route — the star a PUT with the kind, name and
 * preview, the unstar a DELETE (needing neither), and a star without a name or a
 * kind refused before any call.
 */
import { describe, it, expect } from "vitest"
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { registerVoiceFavorites } from "../voice-favorites.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

const USER = "u1"
const VOICE = "21m00Tcm4TlvDq8ikWAM"
const PREVIEW = "https://cdn.example.test/voices/rachel.mp3"

/** The text of a tool result (its first content block). */
const textOf = (res: { content: Array<{ text?: string }> }): string => res.content[0]?.text ?? ""

function server(scopes: Scope[], fastify: FastifyInstance = Fastify()) {
  const s = buildServer()
  registerVoiceFavorites({ server: s, session: newSession({ userId: USER, scopes, clientName: "Claude" }), fastify })
  return s
}

type Received = { method: string; url: string; body: unknown }
/** A stand-in for the favorites routes: records what each tool sent, answers like the route. */
function favoriteRoutes(): { fastify: FastifyInstance; received: Received[] } {
  const fastify = Fastify()
  const received: Received[] = []
  const favorite = { voiceId: VOICE, voiceType: "library", name: "Rachel", previewUrl: PREVIEW, createdAt: "2026-11-08T12:00:00.000Z" }
  const handler = (body: unknown) => async (req: FastifyRequest, reply: FastifyReply) => {
    received.push({ method: req.method, url: req.url, body: req.body })
    return reply.status(200).send(body)
  }
  fastify.get("/v1/voices/favorites", handler({ favorites: [favorite] }))
  fastify.put("/v1/voices/favorites/:voiceId", handler({ favorite }))
  fastify.delete("/v1/voices/favorites/:voiceId", handler({ success: true }))
  return { fastify, received }
}

describe("voice favorites tools — registration", () => {
  it("the list registers under assets:read, the star under assets:write, and neither without", async () => {
    expect((await listTools(server(["assets:read"]))).map((t) => t.name)).toEqual(["list_voice_favorites"])
    expect((await listTools(server(["assets:write"]))).map((t) => t.name)).toEqual(["favorite_voice"])
    expect((await listTools(server(["assets:read", "assets:write"]))).map((t) => t.name).sort()).toEqual(["favorite_voice", "list_voice_favorites"])
    for (const scopes of [[], ["jobs:read"], ["workflows:execute"]] as Scope[][]) {
      expect((await listTools(server(scopes))).map((t) => t.name), scopes.join(",")).toEqual([])
    }
  })
})

describe("list_voice_favorites", () => {
  it("reads GET /v1/voices/favorites and answers the favorites as JSON", async () => {
    const routes = favoriteRoutes()
    const res = await callTool(server(["assets:read"], routes.fastify), "list_voice_favorites", {})
    expect(res.isError).toBeFalsy()
    expect(routes.received).toEqual([{ method: "GET", url: "/v1/voices/favorites", body: undefined }])
    expect(JSON.parse(textOf(res))).toEqual([expect.objectContaining({ voiceId: VOICE, voiceType: "library", name: "Rachel" })])
  })
})

describe("favorite_voice", () => {
  it("stars through PUT /v1/voices/favorites/:voiceId with the kind, the name and the preview", async () => {
    const routes = favoriteRoutes()
    const res = await callTool(server(["assets:write"], routes.fastify), "favorite_voice", {
      voice_id: VOICE,
      voice_type: "library",
      name: "Rachel",
      preview_url: PREVIEW,
    })
    expect(res.isError).toBeFalsy()
    expect(routes.received).toEqual([
      { method: "PUT", url: `/v1/voices/favorites/${VOICE}`, body: { voiceType: "library", name: "Rachel", previewUrl: PREVIEW } },
    ])
    expect(textOf(res)).toContain("Starred Rachel")
  })

  it("unstars through DELETE with favorite: false, needing neither a name nor a kind", async () => {
    const routes = favoriteRoutes()
    const res = await callTool(server(["assets:write"], routes.fastify), "favorite_voice", { voice_id: VOICE, favorite: false })
    expect(res.isError).toBeFalsy()
    expect(routes.received).toEqual([{ method: "DELETE", url: `/v1/voices/favorites/${VOICE}`, body: undefined }])
    expect(textOf(res)).toContain("Unstarred")
  })

  it('an empty preview_url rides through as previewUrl "" — the route stores it as "no preview"', async () => {
    const routes = favoriteRoutes()
    const res = await callTool(server(["assets:write"], routes.fastify), "favorite_voice", { voice_id: VOICE, voice_type: "premade", name: "Rachel", preview_url: "" })
    expect(res.isError).toBeFalsy()
    expect(routes.received).toEqual([{ method: "PUT", url: `/v1/voices/favorites/${VOICE}`, body: { voiceType: "premade", name: "Rachel", previewUrl: "" } }])
  })

  it("refuses a star without a name or a kind before any call, and a preview that is not https", async () => {
    const routes = favoriteRoutes()
    const noName = await callTool(server(["assets:write"], routes.fastify), "favorite_voice", { voice_id: VOICE, voice_type: "premade" })
    expect(noName.isError).toBe(true)
    expect(textOf(noName)).toContain("name and voice_type are required")
    const noType = await callTool(server(["assets:write"], routes.fastify), "favorite_voice", { voice_id: VOICE, name: "Rachel" })
    expect(noType.isError).toBe(true)
    expect(textOf(noType)).toContain("name and voice_type are required")
    const badPreview = await callTool(server(["assets:write"], routes.fastify), "favorite_voice", {
      voice_id: VOICE,
      voice_type: "premade",
      name: "Rachel",
      preview_url: "http://cdn.example.test/rachel.mp3",
    })
    expect(badPreview.isError).toBe(true)
    expect(routes.received).toEqual([])
  })
})
