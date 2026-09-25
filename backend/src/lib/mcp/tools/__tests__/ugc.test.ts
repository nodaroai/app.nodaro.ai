import Fastify, { type FastifyInstance } from "fastify"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Scope } from "../../../scopes.js"
import { newSession } from "../../session.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * The three UGC builder proxies. Plans here are placeholders and the builder's
 * answers are stubbed: this file is about what the proxy adds — the explicit
 * key forwarding, the saved-Character lookup, the refusals, the error mapping
 * and the quote hand-off — never about what the builder decides.
 */
const h = vi.hoisted(() => ({
  character: null as Record<string, unknown> | null,
  characterError: null as unknown,
  filters: [] as Array<[string, string, unknown]>,
  quote: vi.fn(),
}))

vi.mock("../../../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (col: string, v: unknown) => { h.filters.push([table, `eq:${col}`, v]); return chain },
        is: (col: string, v: unknown) => { h.filters.push([table, `is:${col}`, v]); return chain },
        maybeSingle: async () => ({ data: h.character, error: h.characterError }),
      }
      return chain
    },
  },
}))

vi.mock("../../../../ee/lib/ugc-quote.js", () => {
  class UgcQuoteError extends Error {}
  return { buildUgcQuote: h.quote, UgcQuoteError }
})

const { registerUgcTools, characterGender, characterImages } = await import("../ugc.js")

const USER = "00000000-0000-4000-8000-000000000001"
const CHARACTER = "00000000-0000-4000-8000-0000000000c1"

type Answer = [number, unknown]
function builder(answers: Partial<Record<"creator" | "clips" | "cards", Answer>>) {
  const fastify = Fastify()
  const received: Record<string, { body: Record<string, unknown>; headers: Record<string, unknown> }> = {}
  for (const name of ["creator", "clips", "cards"] as const) {
    fastify.post(`/v1/ugc/${name}`, async (req, reply) => {
      received[name] = { body: req.body as Record<string, unknown>, headers: req.headers as Record<string, unknown> }
      const [status, body] = answers[name] ?? [200, {}]
      return reply.status(status).send(body)
    })
  }
  return { fastify, received }
}

function serverWith(fastify: FastifyInstance, scopes: Scope[] = ["assets:read", "workflows:execute"]) {
  const server = buildServer()
  registerUgcTools({ server, session: newSession({ userId: USER, scopes, clientName: "Claude" }), fastify })
  return server
}
const text = (r: { content: Array<{ text?: string }> }) => r.content[0]!.text ?? ""

beforeEach(() => {
  h.character = null
  h.characterError = null
  h.filters = []
  h.quote.mockReset()
})

describe("registration", () => {
  it("registers the three tools, none with an outputSchema, all free and read-only", async () => {
    const tools = await listTools(serverWith(Fastify(), []))
    const ugc = tools.filter((t) => t.name.startsWith("build_ugc_"))
    expect(ugc.map((t) => t.name).sort()).toEqual(["build_ugc_cards", "build_ugc_clips", "build_ugc_creator"])
    for (const t of ugc) {
      expect(t).not.toHaveProperty("outputSchema")
      expect(t.description).toContain("Used by the ugc-website recipe (get_recipe).")
      expect(t.description).not.toMatch(/\d+\s*(cr|credits?)\b/i)
    }
  })
})

describe("build_ugc_creator", () => {
  it("sampled: forwards every key explicitly, as the builder's own names, with the caller's identity", async () => {
    const { fastify, received } = builder({ creator: [200, { kind: "sampled" }] })
    const res = await callTool(serverWith(fastify), "build_ugc_creator", {
      source: "sampled", gender: "woman", product_category: "saas", overrides: { hair: "short" }, previous: { a: 1 }, seed: 9,
    })
    expect(res.isError).toBeUndefined()
    expect(received.creator!.body).toEqual({
      userId: USER, seed: 9,
      source: { kind: "sampled", gender: "woman", productCategory: "saas", overrides: { hair: "short" }, previous: { a: 1 } },
    })
    expect(received.creator!.headers["x-internal-user-id"]).toBe(USER)
  })
  it("sampled without a gender, or without a category, is refused before any call", async () => {
    const { fastify, received } = builder({})
    const noGender = await callTool(serverWith(fastify), "build_ugc_creator", { source: "sampled", product_category: "saas" })
    expect(text(noGender)).toBe("A sampled creator needs a gender: pass woman or man.")
    const noCategory = await callTool(serverWith(fastify), "build_ugc_creator", { source: "sampled", gender: "man" })
    expect(text(noCategory)).toBe("A sampled creator needs a product_category.")
    expect(received.creator).toBeUndefined()
  })
  it("character with no character_id answers Character not found before any read or call", async () => {
    const { fastify, received } = builder({})
    const res = await callTool(serverWith(fastify), "build_ugc_creator", { source: "character" })
    expect(res.isError).toBe(true)
    expect(text(res)).toBe("Character not found")
    expect(h.filters).toEqual([])
    expect(received.creator).toBeUndefined()
  })
  it("photo with no photo_url is left to the builder, whose issue is forwarded", async () => {
    const { fastify, received } = builder({
      creator: [400, { error: { code: "validation_error", issues: [{ path: "source.imageUrl", message: "Required" }] } }],
    })
    const res = await callTool(serverWith(fastify), "build_ugc_creator", { source: "photo" })
    expect(received.creator!.body.source).toEqual({ kind: "photo" })
    expect(res.isError).toBe(true)
    expect(text(res)).toBe("Nodaro rejected the request (400 validation_error):\n- source.imageUrl: Required")
  })
  it("photo: the URL and a given gender", async () => {
    const { fastify, received } = builder({})
    await callTool(serverWith(fastify), "build_ugc_creator", { source: "photo", photo_url: "https://cdn.example/me.jpg", gender: "man" })
    expect(received.creator!.body.source).toEqual({ kind: "photo", imageUrl: "https://cdn.example/me.jpg", gender: "man" })
  })
})

describe("build_ugc_creator — a saved Character", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: CHARACTER, description: "A calm narrator.", canonical_description: "canonical", gender: "female",
    source_image_url: "https://cdn.example/portrait.png", reference_photos: [], body_angles: [], ...over,
  })

  it("reads the caller's own, live Character and sends its portrait, description and mapped gender", async () => {
    h.character = row({ body_angles: [{ url: "https://cdn.example/body.png" }] })
    const { fastify, received } = builder({})
    await callTool(serverWith(fastify), "build_ugc_creator", { source: "character", character_id: CHARACTER })
    expect(received.creator!.body.source).toEqual({
      kind: "character", imageUrls: ["https://cdn.example/portrait.png", "https://cdn.example/body.png"],
      description: "A calm narrator.", gender: "woman",
    })
    expect(h.filters).toEqual(expect.arrayContaining([["characters", "eq:user_id", USER], ["characters", "is:deleted_at", null], ["characters", "eq:id", CHARACTER]]))
  })
  it("not found — including another user's, which the query never returns", async () => {
    h.character = null
    const { fastify, received } = builder({})
    expect(text(await callTool(serverWith(fastify), "build_ugc_creator", { source: "character", character_id: CHARACTER }))).toBe("Character not found")
    expect(received.creator).toBeUndefined()
  })
  it("no portrait at all is refused", async () => {
    h.character = row({ source_image_url: null })
    const { fastify } = builder({})
    expect(text(await callTool(serverWith(fastify), "build_ugc_creator", { source: "character", character_id: CHARACTER }))).toBe("This Character has no portrait yet")
  })
  it("a session without assets:read is refused before any read", async () => {
    const { fastify, received } = builder({})
    const res = await callTool(serverWith(fastify, []), "build_ugc_creator", { source: "character", character_id: CHARACTER })
    expect(text(res)).toBe(
      "Using a saved Character needs read access to your saved assets on this connection. Reconnect with that permission, or use a sampled creator or a photo.",
    )
    expect(h.filters).toEqual([])
    expect(received.creator).toBeUndefined()
  })
  it("a 4000-character description is cut to 2000; a missing one falls back to the canonical one, then to empty", async () => {
    const { fastify, received } = builder({})
    h.character = row({ description: "x".repeat(4000) })
    await callTool(serverWith(fastify), "build_ugc_creator", { source: "character", character_id: CHARACTER })
    expect((received.creator!.body.source as { description: string }).description).toHaveLength(2000)
    h.character = row({ description: null })
    await callTool(serverWith(fastify), "build_ugc_creator", { source: "character", character_id: CHARACTER })
    expect((received.creator!.body.source as { description: string }).description).toBe("canonical")
    h.character = row({ description: null, canonical_description: null })
    await callTool(serverWith(fastify), "build_ugc_creator", { source: "character", character_id: CHARACTER })
    expect((received.creator!.body.source as { description: string }).description).toBe("")
  })
  it("a blank description counts as none: the canonical one is sent, and two blanks send empty", async () => {
    const { fastify, received } = builder({})
    for (const blank of ["", "   "]) {
      h.character = row({ description: blank })
      await callTool(serverWith(fastify), "build_ugc_creator", { source: "character", character_id: CHARACTER })
      expect((received.creator!.body.source as { description: string }).description).toBe("canonical")
    }
    h.character = row({ description: "", canonical_description: " " })
    await callTool(serverWith(fastify), "build_ugc_creator", { source: "character", character_id: CHARACTER })
    expect((received.creator!.body.source as { description: string }).description).toBe("")
  })
  it("the Character's saved gender wins; with none, the caller's answer is sent", async () => {
    const { fastify, received } = builder({})
    h.character = row({ gender: "M" })
    await callTool(serverWith(fastify), "build_ugc_creator", { source: "character", character_id: CHARACTER, gender: "woman" })
    expect((received.creator!.body.source as { gender?: string }).gender).toBe("man")
    h.character = row({ gender: "non-binary" })
    await callTool(serverWith(fastify), "build_ugc_creator", { source: "character", character_id: CHARACTER })
    expect(received.creator!.body.source).not.toHaveProperty("gender")
    await callTool(serverWith(fastify), "build_ugc_creator", { source: "character", character_id: CHARACTER, gender: "woman" })
    expect((received.creator!.body.source as { gender?: string }).gender).toBe("woman")
  })
})

describe("Character helpers", () => {
  it.each([["female", "woman"], ["Woman", "woman"], [" F ", "woman"], ["male", "man"], ["M", "man"], ["man", "man"], ["non-binary", undefined], ["", undefined], [null, undefined]] as const)(
    "gender %j → %j", (value, expected) => expect(characterGender(value)).toBe(expected))
  it("portrait, then the front full-body photo, then the first body angle; a second distinct one when there is one", () => {
    const front = { kind: "frontBody", url: "https://cdn.example/front.png" }
    expect(characterImages({ source_image_url: null, reference_photos: [{ kind: "face", url: "https://cdn.example/face.png" }, front], body_angles: [{ url: "https://cdn.example/b.png" }] }))
      .toEqual(["https://cdn.example/front.png", "https://cdn.example/b.png"])
    expect(characterImages({ source_image_url: null, reference_photos: null, body_angles: [{ url: "https://cdn.example/b.png" }] })).toEqual(["https://cdn.example/b.png"])
    expect(characterImages({ source_image_url: "https://cdn.example/p.png", reference_photos: [{ kind: "frontBody", url: "https://cdn.example/p.png" }], body_angles: [] }))
      .toEqual(["https://cdn.example/p.png"])
    expect(characterImages({ source_image_url: null, reference_photos: [], body_angles: [] })).toEqual([])
  })
})

describe("build_ugc_clips", () => {
  const plan = { anything: "the builder checks it" }
  it("forwards the plan untouched and every key explicitly", async () => {
    const { fastify, received } = builder({ clips: [200, { errors: [{ code: "X", path: "p", message: "m", fix: "f" }], warnings: [] }] })
    await callTool(serverWith(fastify), "build_ugc_clips", { plan, gender: "man", traits: { t: 1 }, identity_images: ["job-1"], seed: 3 })
    expect(received.clips!.body).toEqual({ userId: USER, plan, gender: "man", traits: { t: 1 }, identityImages: ["job-1"], seed: 3 })
  })
  it("an invalid plan comes back as the builder answered it, with no quote", async () => {
    const answer = { errors: [{ code: "X", path: "p", message: "m", fix: "f" }], warnings: [] }
    const { fastify } = builder({ clips: [200, answer] })
    const res = await callTool(serverWith(fastify), "build_ugc_clips", { plan, gender: "man", identity_images: ["job-1"] })
    expect(res.structuredContent).toEqual(answer)
    expect(h.quote).not.toHaveBeenCalled()
  })
  it("a valid plan: the items are priced and the list is replaced by the quote", async () => {
    const quoteItems = [{ label: "a", tool: "extract_frame", args: {}, count: 1 }]
    const { fastify } = builder({ clips: [200, { errors: [], warnings: [], clips: [{}, {}], join: null, quoteItems }] })
    h.quote.mockResolvedValue({ spent: [], lines: [{ label: "a", credits: 10 }], total: 10, skipped: [] })
    const res = await callTool(serverWith(fastify), "build_ugc_clips", { plan, gender: "man", identity_images: ["job-1"], spent_job_ids: ["j1"] })
    expect(h.quote).toHaveBeenCalledWith({ items: quoteItems, clipCount: 2, spentJobIds: ["j1"], userId: USER })
    expect(res.structuredContent).toEqual({ errors: [], warnings: [], clips: [{}, {}], join: null, quote: { spent: [], lines: [{ label: "a", credits: 10 }], total: 10, skipped: [] } })
  })
  it("on a deployment-payer instance the quote prices under the payer the session's calls are billed to", async () => {
    const { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } = await import("../../../deployment-payer.js")
    __setDeploymentPayerForTests("payer-acct", { tierForGates: "pro" })
    try {
      const quoteItems = [{ label: "a", tool: "extract_frame", args: {}, count: 1 }]
      const { fastify } = builder({ clips: [200, { errors: [], warnings: [], clips: [{}], join: null, quoteItems }] })
      h.quote.mockResolvedValue({ spent: [], lines: [], total: 0, skipped: [] })
      await callTool(serverWith(fastify), "build_ugc_clips", { plan, gender: "man", identity_images: ["job-1"] })
      expect(h.quote).toHaveBeenCalledWith({
        items: quoteItems,
        clipCount: 1,
        spentJobIds: [],
        userId: USER,
        billingContext: {
          payer: "deployment",
          userId: USER,
          payerId: "payer-acct",
          entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "pro" },
        },
      })
    } finally {
      __resetDeploymentPayerForTests()
    }
  })
  it.each([
    ["no quote items", { errors: [], warnings: [], clips: [{}] }],
    ["no errors list and no quote items", { warnings: [], clips: [{}] }],
    ["quote items that are not a list", { errors: [], warnings: [], clips: [{}], quoteItems: { a: 1 } }],
  ])("a valid-looking answer with %s is refused, never passed on unpriced", async (_n, answer) => {
    const { fastify } = builder({ clips: [200, answer] })
    const res = await callTool(serverWith(fastify), "build_ugc_clips", { plan, gender: "man", identity_images: ["job-1"] })
    expect(res.isError).toBe(true)
    expect(text(res)).toBe("could not price the rest of the video")
    expect(h.quote).not.toHaveBeenCalled()
  })
  it("an item that cannot be priced fails the call with its label", async () => {
    const { fastify } = builder({ clips: [200, { errors: [], warnings: [], clips: [{}], quoteItems: [] }] })
    const { UgcQuoteError } = await import("../../../../ee/lib/ugc-quote.js")
    h.quote.mockRejectedValue(new UgcQuoteError("could not price Step 1"))
    const res = await callTool(serverWith(fastify), "build_ugc_clips", { plan, gender: "man", identity_images: ["job-1"] })
    expect(res.isError).toBe(true)
    expect(text(res)).toBe("could not price Step 1")
  })
  it("more than 30 spent job ids is refused by the schema", async () => {
    const { fastify, received } = builder({})
    const res = await callTool(serverWith(fastify), "build_ugc_clips", { plan, gender: "man", identity_images: ["job-1"], spent_job_ids: Array.from({ length: 31 }, (_, i) => `j${i}`) })
    expect(res.isError).toBe(true)
    expect(received.clips).toBeUndefined()
  })
})

describe("build_ugc_cards", () => {
  it("forwards alignment or words, and the duration under the builder's name", async () => {
    const { fastify, received } = builder({ cards: [200, { layers: [] }] })
    await callTool(serverWith(fastify), "build_ugc_cards", { plan: { p: 1 }, words: [{ text: "hi", startMs: 0, endMs: 300 }], video_duration_ms: 5000 })
    expect(received.cards!.body).toEqual({ userId: USER, plan: { p: 1 }, words: [{ text: "hi", startMs: 0, endMs: 300 }], videoDurationMs: 5000 })
    await callTool(serverWith(fastify), "build_ugc_cards", { plan: { p: 1 }, alignment: [{ word: "hi", start: 0, end: 0.3 }] })
    expect(received.cards!.body).toEqual({ userId: USER, plan: { p: 1 }, alignment: [{ word: "hi", start: 0, end: 0.3 }] })
  })
})

describe("errors", () => {
  it("a router 404 (no plugin on this deployment) is not_available", async () => {
    const res = await callTool(serverWith(Fastify()), "build_ugc_cards", { plan: {}, alignment: [] })
    expect(res.isError).toBe(true)
    expect(text(res)).toContain("not_available")
    expect(text(res)).toContain("UGC videos are a Nodaro Cloud feature and are not served on this deployment.")
  })
  it("a plan-shape 400 keeps every issue", async () => {
    const body = { error: { code: "validation_error", message: "a.b: bad (+1 more)", issues: [{ path: "a.b", message: "bad" }, { path: "c", message: "worse" }] } }
    const { fastify } = builder({ clips: [400, body] })
    const res = await callTool(serverWith(fastify), "build_ugc_clips", { plan: {}, gender: "man", identity_images: ["x"] })
    expect(text(res)).toBe("Nodaro rejected the request (400 validation_error):\n- a.b: bad\n- c: worse")
  })
  it("a malformed issue is dropped, never printed as undefined", async () => {
    const body = { error: { code: "validation_error", issues: [{ path: "a", message: "bad" }, { path: ["x"], message: 3 }, null, "loose"] } }
    const { fastify } = builder({ clips: [400, body] })
    const res = await callTool(serverWith(fastify), "build_ugc_clips", { plan: {}, gender: "man", identity_images: ["x"] })
    expect(text(res)).toBe("Nodaro rejected the request (400 validation_error):\n- a: bad")
  })
  it("a 400 whose issues are all malformed goes to the shared renderer", async () => {
    const body = { error: { code: "validation_error", message: "bad plan", issues: [{ path: 1 }, null] } }
    const { fastify } = builder({ clips: [400, body] })
    const res = await callTool(serverWith(fastify), "build_ugc_clips", { plan: {}, gender: "man", identity_images: ["x"] })
    expect(res.isError).toBe(true)
    expect(text(res)).toBe("Nodaro rejected the request (400 validation_error): bad plan")
    expect(text(res)).not.toContain("undefined")
  })
  it("more than 20 issues lists the first 20, then how many more", async () => {
    const issues = Array.from({ length: 23 }, (_, i) => ({ path: `p${i}`, message: `m${i}` }))
    const { fastify } = builder({ clips: [400, { error: { code: "validation_error", issues } }] })
    const res = await callTool(serverWith(fastify), "build_ugc_clips", { plan: {}, gender: "man", identity_images: ["x"] })
    const lines = text(res).split("\n")
    expect(lines).toHaveLength(22)
    expect(lines[1]).toBe("- p0: m0")
    expect(lines[20]).toBe("- p19: m19")
    expect(lines[21]).toBe("(+3 more)")
  })
  it("minor_age_refused passes through verbatim", async () => {
    const body = { error: { code: "minor_age_refused", message: "The creator must be an adult." } }
    const { fastify } = builder({ creator: [422, body] })
    const res = await callTool(serverWith(fastify), "build_ugc_creator", { source: "sampled", gender: "woman", product_category: "saas" })
    expect(res.isError).toBe(true)
    expect(text(res)).toBe(JSON.stringify(body))
  })
  it("anything else goes through the shared renderer", async () => {
    const { fastify } = builder({ cards: [500, { error: { code: "boom", message: "internal detail" } }] })
    const res = await callTool(serverWith(fastify), "build_ugc_cards", { plan: {}, alignment: [] })
    expect(res.isError).toBe(true)
    expect(text(res)).toBe("Nodaro had a server error (500) — usually transient, please try again. [boom]")
    expect(text(res)).not.toContain("internal detail")
  })
})
