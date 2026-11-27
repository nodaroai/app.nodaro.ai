import type { FastifyInstance } from "fastify"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { newSession } from "../../session.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../private-plugins/supports-registry.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

/**
 * `video_remake` with `reference_image_urls`: roles planned from the prompt.
 *
 * The contracts under test:
 *  - the QUOTE (no `confirm`) plans the roles (`/v1/video-remake/plan-roles`),
 *    then quotes the run WITH them (`/v1/video-remake/estimate`), and answers
 *    the price with `planned` and the exact `arguments` to confirm with;
 *  - those arguments are an ordinary call: fed back with `confirm: true` they
 *    run the body that was quoted, with no second plan;
 *  - the caller's own roles stay first and the planned ones are added after;
 *  - `reference_image_urls` with `confirm: true` never plans or runs
 *    (`quote_first`);
 *  - the prompt may be silent about an image, or missing: the images alone are
 *    planned, and where the engine says how each role was decided
 *    (`decisions`) the quote names every GUESSED role and its alternatives,
 *    and every role the prompt asked for whose words were not found in it
 *    (they stay in the planned post_prompt); an engine that says nothing of it
 *    is read as before;
 *  - an image the plan could not place is asked about, never guessed: a
 *    non-error `needs_clarification` with no price and nothing started; with
 *    nothing planned at all, `roles_not_planned`;
 *  - an engine that does not declare role planning (every engine before it),
 *    and a deployment that does not offer it, is `plan_roles_unavailable`, and
 *    such an engine is never asked.
 *
 * The numbers and words are neutral on purpose: this repo is publicly mirrored.
 */
vi.mock("../../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => true }
})

const { registerCastSwapTools, REFERENCE_IMAGES_MAX } = await import("../cast-swap.js")

interface InjectCall {
  method?: string
  url?: string
  payload?: unknown
}

/** A fastify stand-in answering one reply per exact URL, recording every call. */
function stubFastify(routes: Record<string, { statusCode: number; body: unknown }>) {
  const calls: InjectCall[] = []
  const fastify = {
    inject: async (opts: InjectCall) => {
      calls.push(opts)
      const res = routes[opts.url ?? ""]
      if (!res) return { statusCode: 404, body: JSON.stringify({ message: `Route POST:${opts.url} not found`, error: "Not Found" }) }
      return { statusCode: res.statusCode, body: typeof res.body === "string" ? res.body : JSON.stringify(res.body) }
    },
  } as unknown as FastifyInstance
  return { fastify, calls }
}

function serverWith(fastify: FastifyInstance) {
  const server = buildServer()
  registerCastSwapTools({ server, session: newSession({ userId: "u1", scopes: ["workflows:execute"], clientName: "test" }), fastify })
  return server
}

const CLIP = "https://cdn.example/clip.mp4"
const ANNA = "https://cdn.example/anna.png"
const BEACH = "https://cdn.example/beach.png"
const GLASS = "https://cdn.example/glass.png"
const OTHER = "https://cdn.example/other.png"
const REQUEST = "put the first photo in place of the woman on the left, use the second as the room, and make it rain"
const QUOTE = { totalCredits: 12, breakdown: { castSwap: 5, seedance: 7, references: 0 }, settlesLower: false }
const JOB = "00000000-0000-4000-8000-000000000001"

/** The route's answer when every image was placed. */
const PLAN = {
  prompt: REQUEST,
  roles: [
    { kind: "person", name: "the woman in the red scarf on the left", images: [ANNA], outfit: "original" },
    { kind: "location", name: "the living room", images: [BEACH] },
  ],
  references: [],
  postPrompt: "make it rain",
  removed: ["put the first photo in place of the woman on the left", "use the second as the room"],
  unresolved: [],
}

const ARGS = { video_url: CLIP, roles: [], post_prompt: REQUEST, reference_image_urls: [ANNA, BEACH] }

const routes = (plan: unknown = PLAN, planStatus = 200) => ({
  "/v1/video-remake/plan-roles": { statusCode: planStatus, body: plan },
  "/v1/video-remake/estimate": { statusCode: 200, body: QUOTE },
  "/v1/video-remake": { statusCode: 202, body: { jobId: JOB } },
})

const urls = (calls: InjectCall[]) => calls.map((c) => c.url)

beforeEach(() => {
  setPluginSupports({ castSwap: { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true, planRoles: true } as never })
})
afterEach(() => _resetPluginSupportsForTests())

describe("video_remake with reference_image_urls: the quote plans the roles", () => {
  it("lists reference_image_urls: 1 to 30 public https images", async () => {
    const { fastify } = stubFastify({})
    const tool = (await listTools(serverWith(fastify))).find((t) => t.name === "video_remake")!
    const prop = (tool.inputSchema as { properties: Record<string, { type?: string; minItems?: number; maxItems?: number }> }).properties.reference_image_urls!
    expect(prop.type).toBe("array")
    expect(prop.minItems).toBe(1)
    expect(prop.maxItems).toBe(REFERENCE_IMAGES_MAX)
    expect(REFERENCE_IMAGES_MAX).toBe(30)
    expect(tool.description).toContain("reference_image_urls")
  })

  it("plans, then quotes the run with the planned roles, and answers the price, the plan and the arguments to confirm with", async () => {
    const { fastify, calls } = stubFastify(routes())
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)

    expect(res.isError).toBeFalsy()
    expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles", "/v1/video-remake/estimate"])
    // The plan is asked with the clip, the request and the loose images alone.
    expect(calls[0]!.payload).toEqual({ videoUrl: CLIP, prompt: REQUEST, images: [ANNA, BEACH] })
    // The quote is the planned run's: the planned roles, what is left of the request.
    expect(calls[1]!.payload).toEqual({ videoUrl: CLIP, roles: PLAN.roles, postPrompt: "make it rain" })
    expect(res.structuredContent).toMatchObject({
      totalCredits: 12,
      confirmed: false,
      planned: { roles: PLAN.roles, references: [], post_prompt: "make it rain", removed: PLAN.removed },
      arguments: { video_url: CLIP, roles: PLAN.roles, post_prompt: "make it rain", confirm: true },
    })
    expect((res.structuredContent as { arguments: Record<string, unknown> }).arguments).not.toHaveProperty("reference_image_urls")
    const text = res.content[0]!.text
    expect(text).toContain("12 credits")
    // One sentence says which image replaces whom.
    expect(text).toContain("Planned from the prompt: image 1 replaces the woman in the red scarf on the left (person); image 2 replaces the living room (location).")
    expect(text).toContain("returned `arguments`")
  })

  it("the returned arguments, called as they are, run the body that was quoted, without planning again", async () => {
    const { fastify, calls } = stubFastify(routes())
    const server = serverWith(fastify)
    const quote = await callTool(server, "video_remake", { ...ARGS, engine: "nodaro-prism", resolution: "720p", preview: true, preview_start: 1 })
    const quotedBody = calls[1]!.payload
    const run = await callTool(server, "video_remake", (quote.structuredContent as { arguments: Record<string, unknown> }).arguments)

    expect(run.isError).toBeFalsy()
    expect(run.structuredContent).toMatchObject({ jobId: JOB, confirmed: true })
    expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles", "/v1/video-remake/estimate", "/v1/video-remake"])
    expect(calls[2]!.payload).toEqual(quotedBody)
    // The plan was asked for that preview and engine.
    expect(calls[0]!.payload).toMatchObject({ preview: true, previewStart: 1, engine: expect.any(String) })
  })

  it("a role as the engine answers it (every chip defaulted, a default name) runs as it was quoted: the tool lists every key it carries", async () => {
    // The route's own shape: each kind's chips filled in, a location's default name.
    const plan = {
      ...PLAN,
      roles: [
        { kind: "person", name: "the woman in the red scarf on the left", images: [ANNA], body: "new", outfit: "original", hair: "new" },
        { kind: "pet", name: "the dog", images: [OTHER], body: "new", coat: "original" },
        { kind: "product", name: "the cup", images: [GLASS], shape: "new", finish: "new" },
        { kind: "location", name: "the setting", images: [BEACH] },
      ],
    }
    const { fastify, calls } = stubFastify(routes(plan))
    const server = serverWith(fastify)
    const quote = await callTool(server, "video_remake", { ...ARGS, reference_image_urls: [ANNA, OTHER, GLASS, BEACH] })
    expect(quote.isError).toBeFalsy()
    const run = await callTool(server, "video_remake", (quote.structuredContent as { arguments: Record<string, unknown> }).arguments)
    expect(run.isError).toBeFalsy()
    expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles", "/v1/video-remake/estimate", "/v1/video-remake"])
    expect((calls[1]!.payload as { roles: unknown }).roles).toEqual(plan.roles)
    expect(calls[2]!.payload).toEqual(calls[1]!.payload)
  })

  it("keeps the caller's own roles and references first and adds the planned ones after them", async () => {
    const mine = { kind: "pet", name: "the dog", images: ["https://cdn.example/rex.png"], preview_name: "the small dog" }
    const mineOnWire = { kind: "pet", name: "the dog", images: ["https://cdn.example/rex.png"], previewName: "the small dog" }
    const myRef = { images: [GLASS], line: "the glass she drinks from" }
    const plan = { ...PLAN, references: [{ images: [OTHER], line: "the red umbrella" }], postPrompt: "{role:1} barks, make it rain" }
    const { fastify, calls } = stubFastify(routes(plan))
    const res = await callTool(serverWith(fastify), "video_remake", {
      ...ARGS,
      roles: [mine],
      references: [myRef],
      post_prompt: `{role:1} barks, ${REQUEST}`,
      reference_image_urls: [ANNA, BEACH, OTHER],
    })

    expect(res.isError).toBeFalsy()
    // The plan is told what the caller already has, as a run takes it.
    expect(calls[0]!.payload).toMatchObject({ roles: [mineOnWire], references: [myRef], images: [ANNA, BEACH, OTHER] })
    expect(calls[1]!.payload).toEqual({
      videoUrl: CLIP,
      roles: [mineOnWire, ...PLAN.roles],
      references: [myRef, { images: [OTHER], line: "the red umbrella" }],
      postPrompt: "{role:1} barks, make it rain",
    })
    const out = res.structuredContent as { planned: { roles: unknown[]; references: unknown[] }; arguments: { roles: unknown[]; references: unknown[] } }
    // `planned` is the new part alone; `arguments` is the whole call, in the tool's own argument names.
    expect(out.planned.roles).toEqual(PLAN.roles)
    expect(out.arguments.roles).toEqual([mine, ...PLAN.roles])
    expect(out.arguments.references).toEqual([myRef, { images: [OTHER], line: "the red umbrella" }])
    expect(res.content[0]!.text).toContain("image 3 is brought in as the red umbrella")
  })

  it("a request the roles say whole leaves no post_prompt, in the quote and in the arguments", async () => {
    const { fastify, calls } = stubFastify(routes({ ...PLAN, postPrompt: "" }))
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect(calls[1]!.payload).toEqual({ videoUrl: CLIP, roles: PLAN.roles })
    expect((res.structuredContent as { arguments: Record<string, unknown> }).arguments).not.toHaveProperty("post_prompt")
  })

  it("a planned role's preview settings come back in the tool's own argument names", async () => {
    const plan = { ...PLAN, roles: [{ kind: "person", name: "the man", images: [ANNA], previewName: "the tall man", inPreview: true }] }
    const { fastify } = stubFastify(routes(plan))
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect((res.structuredContent as { planned: { roles: unknown[] } }).planned.roles).toEqual([{ kind: "person", name: "the man", images: [ANNA], preview_name: "the tall man", in_preview: true }])
  })
})

describe("video_remake with reference_image_urls never plans and runs in one call", () => {
  it("refuses reference_image_urls with confirm: true before any call (quote_first), with or without roles", async () => {
    for (const roles of [[], PLAN.roles]) {
      const { fastify, calls } = stubFastify(routes())
      const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, roles, confirm: true })
      expect(res.isError).toBe(true)
      expect(res.content[0]!.text).toContain("quote_first")
      expect(res.content[0]!.text).toContain("Call without confirm first")
      expect(calls).toEqual([])
    }
  })

  it("loose images with no prompt are planned from the images alone: the plan is asked with an empty request, and the run takes no post_prompt", async () => {
    const plan = { ...PLAN, prompt: "", postPrompt: "", removed: [] }
    for (const post_prompt of [undefined, ""]) {
      const { fastify, calls } = stubFastify(routes(plan))
      const { post_prompt: _request, ...noPrompt } = ARGS
      const res = await callTool(serverWith(fastify), "video_remake", { ...noPrompt, ...(post_prompt !== undefined ? { post_prompt } : {}) })
      expect(res.isError).toBeFalsy()
      expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles", "/v1/video-remake/estimate"])
      expect(calls[0]!.payload).toEqual({ videoUrl: CLIP, ...(post_prompt !== undefined ? { prompt: "" } : {}), images: [ANNA, BEACH] })
      expect(calls[1]!.payload).toEqual({ videoUrl: CLIP, roles: PLAN.roles })
      expect((res.structuredContent as { arguments: Record<string, unknown> }).arguments).not.toHaveProperty("post_prompt")
    }
  })

  it("refuses an address that is not https, an empty list and more than 30, at the schema", async () => {
    const { fastify, calls } = stubFastify(routes())
    const server = serverWith(fastify)
    const many = Array.from({ length: REFERENCE_IMAGES_MAX + 1 }, (_, i) => `https://cdn.example/${i}.png`)
    for (const reference_image_urls of [["http://cdn.example/a.png"], ["not a url"], [], many]) {
      const res = await callTool(server, "video_remake", { ...ARGS, reference_image_urls })
      expect(res.isError, JSON.stringify(reference_image_urls).slice(0, 60)).toBe(true)
    }
    expect(calls).toEqual([])
  })
})

describe("video_remake with reference_image_urls: how each role was decided", () => {
  const DECISIONS = [
    { role: 0, basis: "inferred", confidence: "guess", alternatives: ["the woman by the window", "the woman at the door"] },
    { role: 1, basis: "request", evidence: "use the second as the room" },
  ]

  it("names every guessed role and what else it could have been in the quote's text, and carries the decisions beside the roles", async () => {
    const { fastify, calls } = stubFastify(routes({ ...PLAN, decisions: DECISIONS }))
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)

    expect(res.isError).toBeFalsy()
    // A guess is still a plan: it is quoted, and said.
    expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles", "/v1/video-remake/estimate"])
    const text = res.content[0]!.text
    expect(text).toContain("GUESSED, not said in the prompt: image 1 for the woman in the red scarf on the left (it could also be: the woman by the window; the woman at the door).")
    expect(text).toContain("Tell the user")
    // The role the request named is not called a guess.
    expect(text).not.toMatch(/GUESSED[^.]*image 2/)
    const out = res.structuredContent as { planned: { roles: unknown[]; decisions: unknown[] }; arguments: Record<string, unknown> }
    expect(out.planned.decisions).toEqual(DECISIONS)
    expect(out.planned.decisions).toHaveLength(out.planned.roles.length)
    // The decisions describe the plan; they are no argument of the run.
    expect(out.arguments).not.toHaveProperty("decisions")
    expect(calls[1]!.payload).not.toHaveProperty("decisions")
  })

  it("a guess with no alternatives is still named; inferred and clear is not a guess", async () => {
    const { fastify } = stubFastify(routes({ ...PLAN, decisions: [{ role: 0, basis: "inferred", confidence: "clear" }, { role: 1, basis: "inferred", confidence: "guess" }] }))
    const text = (await callTool(serverWith(fastify), "video_remake", ARGS)).content[0]!.text
    expect(text).toContain("GUESSED, not said in the prompt: image 2 for the living room.")
    expect(text).not.toMatch(/GUESSED[^.]*image 1/)
  })

  it("a role the prompt asked for whose words were found in it gets no note", async () => {
    const { fastify } = stubFastify(routes({ ...PLAN, decisions: [{ role: 0, basis: "request", evidence: "put the first photo in place of the woman on the left" }, { role: 1, basis: "request", evidence: "use the second as the room" }] }))
    const text = (await callTool(serverWith(fastify), "video_remake", ARGS)).content[0]!.text
    expect(text).not.toContain("ASKED FOR")
    expect(text).not.toContain("GUESSED")
  })

  it("a role the prompt asked for with no words found (none, or empty) is named: its words stay in post_prompt", async () => {
    for (const evidence of [undefined, ""]) {
      const decisions = [{ role: 0, basis: "request", evidence: "put the first photo in place of the woman on the left" }, { role: 1, basis: "request", ...(evidence !== undefined ? { evidence } : {}) }]
      // Its words were not found, so nothing of it was taken out of the prompt.
      const plan = { ...PLAN, postPrompt: "use the second as the room, make it rain", removed: [PLAN.removed[0]], decisions }
      const { fastify } = stubFastify(routes(plan))
      const res = await callTool(serverWith(fastify), "video_remake", ARGS)
      const text = res.content[0]!.text
      expect(text).toContain("ASKED FOR in the prompt, but its words could not be matched there, so they stay in post_prompt: image 2 for the living room. Tell the user.")
      expect(text).not.toMatch(/ASKED FOR[^.]*image 1/)
      expect(text).not.toContain("GUESSED")
      // The decisions say the same, in the shape they already had.
      expect((res.structuredContent as { planned: { decisions: unknown[] } }).planned.decisions[1]).toEqual({ role: 1, basis: "request" })
    }
  })

  it("with no planned post_prompt the note does not say the words stay in it", async () => {
    for (const postPrompt of ["", "  "]) {
      const decisions = [{ role: 0, basis: "request", evidence: "put the first photo in place of the woman on the left" }, { role: 1, basis: "request" }]
      const { fastify } = stubFastify(routes({ ...PLAN, postPrompt, decisions }))
      const res = await callTool(serverWith(fastify), "video_remake", ARGS)
      const text = res.content[0]!.text
      expect(text).toContain("ASKED FOR in the prompt, but its words could not be matched there: image 2 for the living room. Tell the user.")
      expect(text).not.toContain("stay in post_prompt")
      expect((res.structuredContent as { arguments: Record<string, unknown> }).arguments).not.toHaveProperty("post_prompt")
    }
  })

  it("a role asked for with no words found that is also a guess is said as a guess only", async () => {
    const decisions = [{ role: 0, basis: "request", evidence: "put the first photo in place of the woman on the left" }, { role: 1, basis: "request", confidence: "guess", alternatives: ["the kitchen"] }]
    const { fastify } = stubFastify(routes({ ...PLAN, decisions }))
    const text = (await callTool(serverWith(fastify), "video_remake", ARGS)).content[0]!.text
    expect(text).toContain("GUESSED, not said in the prompt: image 2 for the living room (it could also be: the kitchen). Tell the user and let them correct it before confirming.")
    expect(text).not.toContain("ASKED FOR")
  })

  it("an inferred guess keeps its own note and gets no other", async () => {
    const { fastify } = stubFastify(routes({ ...PLAN, decisions: DECISIONS }))
    const text = (await callTool(serverWith(fastify), "video_remake", ARGS)).content[0]!.text
    expect(text).toContain("GUESSED, not said in the prompt: image 1 for the woman in the red scarf on the left (it could also be: the woman by the window; the woman at the door). Tell the user and let them correct it before confirming.")
    expect(text).not.toContain("ASKED FOR")
  })

  it("an engine that says nothing of it, or whose list does not line up with the roles, is read as before: no guess is claimed", async () => {
    for (const decisions of [undefined, [], [{ confidence: "guess" }], "none", [null, null, null]]) {
      const { fastify } = stubFastify(routes({ ...PLAN, ...(decisions !== undefined ? { decisions } : {}) }))
      const res = await callTool(serverWith(fastify), "video_remake", ARGS)
      expect(res.isError, JSON.stringify(decisions)).toBeFalsy()
      expect(res.content[0]!.text).not.toContain("GUESSED")
      expect(res.content[0]!.text).not.toContain("ASKED FOR")
      expect((res.structuredContent as { planned: Record<string, unknown> }).planned).not.toHaveProperty("decisions")
    }
  })

  it("passes on only the values it knows: an unknown basis or confidence is dropped, never called a guess", async () => {
    const { fastify } = stubFastify(routes({ ...PLAN, decisions: [{ role: 7, basis: "magic", evidence: 3, confidence: "maybe", alternatives: [1, "the woman by the window"], extra: true }, {}] }))
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)
    expect((res.structuredContent as { planned: { decisions: unknown[] } }).planned.decisions).toEqual([{ role: 0, alternatives: ["the woman by the window"] }, { role: 1 }])
    expect(res.content[0]!.text).not.toContain("GUESSED")
  })
})

describe("video_remake with reference_image_urls: an image that could not be placed", () => {
  const UNRESOLVED = [
    { images: [OTHER], imageIndexes: [2], reason: "ambiguous_subject", candidates: ["the woman on the left", "the woman by the window"] },
    { images: [GLASS], imageIndexes: [3], reason: "not_placed" },
  ]

  it("answers needs_clarification, not an error: no price, nothing started, what was planned kept for reuse", async () => {
    const { fastify, calls } = stubFastify(routes({ ...PLAN, unresolved: UNRESOLVED }))
    const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, reference_image_urls: [ANNA, BEACH, OTHER, GLASS] })

    expect(res.isError).toBeFalsy()
    // No estimate, no run.
    expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles"])
    expect(res.structuredContent).toEqual({
      code: "needs_clarification",
      needs_clarification: [
        { image_urls: [OTHER], reason: "ambiguous_subject", candidates: ["the woman on the left", "the woman by the window"] },
        { image_urls: [GLASS], reason: "not_placed", candidates: [] },
      ],
      planned: { roles: PLAN.roles, references: [], post_prompt: "make it rain", removed: PLAN.removed },
      confirmed: false,
    })
    const text = res.content[0]!.text
    expect(text).toContain("[needs_clarification]")
    expect(text).toContain("Ask the user")
    expect(text).toContain("explicit roles")
    expect(text).not.toMatch(/credits/)
  })

  it("answers roles_not_planned when nothing at all could be planned", async () => {
    const nothing = { prompt: REQUEST, roles: [], references: [], postPrompt: REQUEST, removed: [], unresolved: [{ images: [ANNA, BEACH], imageIndexes: [0, 1], reason: "subject_not_in_clip" }] }
    const { fastify, calls } = stubFastify(routes(nothing))
    const res = await callTool(serverWith(fastify), "video_remake", ARGS)

    expect(res.isError).toBeFalsy()
    expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles"])
    expect(res.structuredContent).toEqual({
      code: "roles_not_planned",
      needs_clarification: [{ image_urls: [ANNA, BEACH], reason: "subject_not_in_clip", candidates: [] }],
      confirmed: false,
    })
    expect(res.content[0]!.text).toContain("[roles_not_planned]")
  })
})

describe("video_remake with reference_image_urls on a 3D previz clip", () => {
  const SUPPORTS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true, planRoles: true, previz: true }
  /** The route's answer for such a clip: each role's name its model's locator, its subject what it becomes. */
  const PREVIZ_PLAN = {
    ...PLAN,
    roles: [
      { kind: "person", name: "the tall model on the left", subject: "the pilot", images: [ANNA] },
      // A role the plan found no subject for is answered without one.
      { kind: "location", name: "the setting", images: [BEACH] },
    ],
  }
  const PREVIZ_ARGS = { ...ARGS, clip_kind: "previz" as const, previz_lighting: true, previz_sound: "generated" as const }

  it("an engine that plans such a clip's roles is told the clip is one, with the run's own options, and the quote says the locator and what it becomes", async () => {
    setPluginSupports({ castSwap: { ...SUPPORTS, planRolesPreviz: true } as never })
    const { fastify, calls } = stubFastify(routes(PREVIZ_PLAN))
    const res = await callTool(serverWith(fastify), "video_remake", PREVIZ_ARGS)

    expect(res.isError).toBeFalsy()
    expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles", "/v1/video-remake/estimate"])
    expect(calls[0]!.payload).toEqual({ videoUrl: CLIP, prompt: REQUEST, images: [ANNA, BEACH], clipKind: "previz", previz: { lighting: true, sound: "generated" } })
    // The quote is the planned run's, the clip stated as before, each role's subject as the plan answered it.
    expect(calls[1]!.payload).toEqual({ videoUrl: CLIP, roles: PREVIZ_PLAN.roles, postPrompt: "make it rain", clipKind: "previz", previz: { lighting: true, sound: "generated" } })
    expect(res.content[0]!.text).toContain("Planned from the prompt: image 1 replaces the tall model on the left (person), which becomes the pilot; image 2 replaces the setting (location).")
    // The arguments to confirm with carry the subject and the clip's statement, and run the body that was quoted.
    const again = (res.structuredContent as { arguments: Record<string, unknown> }).arguments
    expect(again).toMatchObject({ roles: PREVIZ_PLAN.roles, clip_kind: "previz", previz_lighting: true, previz_sound: "generated", confirm: true })
    const run = stubFastify(routes(PREVIZ_PLAN))
    await callTool(serverWith(run.fastify), "video_remake", again)
    expect(urls(run.calls)).toEqual(["/v1/video-remake"])
    expect(run.calls[0]!.payload).toEqual(calls[1]!.payload)
  })

  it("with no option given, the plan is sent the statement alone", async () => {
    setPluginSupports({ castSwap: { ...SUPPORTS, planRolesPreviz: true } as never })
    const { fastify, calls } = stubFastify(routes(PREVIZ_PLAN))
    await callTool(serverWith(fastify), "video_remake", { ...ARGS, clip_kind: "previz" })
    expect(calls[0]!.payload).toEqual({ videoUrl: CLIP, prompt: REQUEST, images: [ANNA, BEACH], clipKind: "previz" })
  })

  it("an engine that does not declare it is never sent the statement on its plan route: planned as an ordinary clip's, the run still states the clip", async () => {
    for (const castSwap of [SUPPORTS, { ...SUPPORTS, planRolesPreviz: false }]) {
      setPluginSupports({ castSwap: castSwap as never })
      const { fastify, calls } = stubFastify(routes())
      const res = await callTool(serverWith(fastify), "video_remake", PREVIZ_ARGS)
      expect(res.isError, JSON.stringify(castSwap)).toBeFalsy()
      expect(calls[0]!.payload).toEqual({ videoUrl: CLIP, prompt: REQUEST, images: [ANNA, BEACH] })
      expect(calls[1]!.payload).toEqual({ videoUrl: CLIP, roles: PLAN.roles, postPrompt: "make it rain", clipKind: "previz", previz: { lighting: true, sound: "generated" } })
      // No role has a subject: the sentence is the one of before.
      expect(res.content[0]!.text).toContain("Planned from the prompt: image 1 replaces the woman in the red scarf on the left (person); image 2 replaces the living room (location).")
    }
  })

  it("an ordinary clip's plan is never sent the statement, on an engine that declares it too", async () => {
    setPluginSupports({ castSwap: { ...SUPPORTS, planRolesPreviz: true } as never })
    for (const over of [{}, { clip_kind: "footage" }]) {
      const { fastify, calls } = stubFastify(routes())
      await callTool(serverWith(fastify), "video_remake", { ...ARGS, ...over })
      expect(calls[0]!.payload).toEqual({ videoUrl: CLIP, prompt: REQUEST, images: [ANNA, BEACH] })
    }
  })

  it("a deployment that does not accept such a clip (the plan's 403) answers previz_unavailable, and nothing is quoted", async () => {
    setPluginSupports({ castSwap: { ...SUPPORTS, planRolesPreviz: true } as never })
    const { fastify, calls } = stubFastify(routes({ error: { code: "previz_not_available", message: "A 3D previz clip is not available here." } }, 403))
    const res = await callTool(serverWith(fastify), "video_remake", PREVIZ_ARGS)
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("[previz_unavailable]")
    expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles"])
  })

  it("any other refusal of such a plan is the route's own, relayed", async () => {
    setPluginSupports({ castSwap: { ...SUPPORTS, planRolesPreviz: true } as never })
    const { fastify, calls } = stubFastify(routes({ error: { code: "previz_needs_prism", message: "A 3D previz clip runs on Nodaro Prism only." } }, 400))
    const res = await callTool(serverWith(fastify), "video_remake", PREVIZ_ARGS)
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("Nodaro Prism only")
    expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles"])
  })
})

describe("video_remake with reference_image_urls where roles are not planned", () => {
  const UNAVAILABLE = "Nodaro: roles cannot be planned from reference images on this deployment. Set the roles yourself (roles), each with its images. [plan_roles_unavailable]"

  it("an engine that does not declare role planning is never asked: plan_roles_unavailable, quote and confirm alike", async () => {
    const engines = [
      undefined,
      { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true },
      { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true, customStyle: true, planRoles: false },
    ]
    for (const castSwap of engines) {
      _resetPluginSupportsForTests()
      if (castSwap) setPluginSupports({ castSwap } as never)
      for (const confirm of [undefined, true]) {
        const { fastify, calls } = stubFastify(routes())
        const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, ...(confirm ? { confirm } : {}) })
        expect(res.isError, JSON.stringify(castSwap)).toBe(true)
        expect(res.content).toEqual([{ type: "text", text: UNAVAILABLE }])
        expect(calls).toEqual([])
      }
    }
  })

  it("such an engine still quotes and runs a call without loose images, as before", async () => {
    _resetPluginSupportsForTests()
    const { fastify, calls } = stubFastify(routes())
    const server = serverWith(fastify)
    const { reference_image_urls: _loose, ...plain } = ARGS
    expect((await callTool(server, "video_remake", plain)).isError).toBeFalsy()
    expect((await callTool(server, "video_remake", { ...plain, confirm: true })).isError).toBeFalsy()
    expect(urls(calls)).toEqual(["/v1/video-remake/estimate", "/v1/video-remake"])
  })

  it("a deployment that does not offer it (the route's 403), or has no such route, is plan_roles_unavailable, with no quote", async () => {
    const refusals = [
      { statusCode: 403, body: { error: { code: "plan_roles_not_available", message: "Planning roles from the prompt is not available here." } } },
      { statusCode: 404, body: { message: "Route POST:/v1/video-remake/plan-roles not found", error: "Not Found" } },
    ]
    for (const refused of refusals) {
      const { fastify, calls } = stubFastify({ ...routes(), "/v1/video-remake/plan-roles": refused })
      const res = await callTool(serverWith(fastify), "video_remake", ARGS)
      expect(res.isError).toBe(true)
      expect(res.content).toEqual([{ type: "text", text: UNAVAILABLE }])
      expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles"])
    }
  })

  it("any other refusal of the plan is the tool's answer, and nothing is quoted", async () => {
    const refusals: Array<[number, string]> = [
      [400, "image_unreadable"],
      [400, "clip_out_of_range"],
      [502, "plan_roles_failed"],
      [429, "rate_limit_exceeded"],
    ]
    for (const [statusCode, code] of refusals) {
      const { fastify, calls } = stubFastify({ ...routes(), "/v1/video-remake/plan-roles": { statusCode, body: { error: { code, message: "refused", details: { index: 1 } } } } })
      const res = await callTool(serverWith(fastify), "video_remake", ARGS)
      expect(res.isError, code).toBe(true)
      expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles"])
    }
  })

  it("an answer that is no plan is an error, and nothing is quoted", async () => {
    for (const body of ["nonsense", { roles: "none" }, { data: { roles: [] } }]) {
      const { fastify, calls } = stubFastify({ ...routes(), "/v1/video-remake/plan-roles": { statusCode: 200, body } })
      const res = await callTool(serverWith(fastify), "video_remake", ARGS)
      expect(res.isError).toBe(true)
      expect(res.content[0]!.text).toContain("could not be read")
      expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles"])
    }
  })
})

describe("video_remake with reference_image_urls and a part of the clip", () => {
  it("plans the roles from that part and quotes it, where the engine takes a part", async () => {
    setPluginSupports({ castSwap: { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p"], trendRun: true, planRoles: true, portion: true } as never })
    const { fastify, calls } = stubFastify(routes())
    const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, portion_start: 20, portion_sec: 10 })
    expect(res.isError).toBeFalsy()
    expect(urls(calls)).toEqual(["/v1/video-remake/plan-roles", "/v1/video-remake/estimate"])
    expect(calls[0]!.payload).toEqual({ videoUrl: CLIP, prompt: REQUEST, images: [ANNA, BEACH], portionStart: 20, portionSec: 10 })
    expect(calls[1]!.payload).toMatchObject({ portionStart: 20, portionSec: 10 })
    // The arguments to confirm with keep the part.
    expect((res.structuredContent as { arguments: Record<string, unknown> }).arguments).toMatchObject({ portion_start: 20, portion_sec: 10, confirm: true })
  })

  it("asks nothing, not even the plan, where the engine does not take a part", async () => {
    const { fastify, calls } = stubFastify(routes())
    const res = await callTool(serverWith(fastify), "video_remake", { ...ARGS, portion_start: 20, portion_sec: 10 })
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain("[portion_unavailable]")
    expect(calls).toEqual([])
  })
})
