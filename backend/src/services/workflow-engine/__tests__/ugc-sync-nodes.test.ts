import { describe, expect, it, vi } from "vitest"
import { UGC_NEWER_APP_MESSAGE, UGC_NODE_TYPES, UGC_VERSION_MESSAGE, ugcCallToRouteBody } from "@nodaro/shared/ugc"
import {
  PLUGIN_SERVED_SYNC_TYPES, UGC_JOB_TYPES, UGC_SYNC_ROUTES, buildUgcSyncBody, runUgcCards, runUgcCreator, ugcJobIsThisRuns, ugcPersonPicks, ugcRunSeed, ugcSyncOutput,
  type UgcDeps,
} from "../ugc-sync-nodes.js"
import { DrainAbortError } from "../../../lib/worker-drain.js"
import type { OrchestratorContext, SimpleNode } from "../types.js"

const ctx = (isAppRun = false) => ({ executionId: "exec-1", userId: "user-1", isAppRun }) as unknown as OrchestratorContext
const n = (type: string, data: Record<string, unknown> = {}): SimpleNode => ({ id: type, type, data: { label: type, ...data } })
const T = (i: number) => ({ v: 1, index: i, durationSec: 12, video: { tool: "t", args: {} } })

describe("UGC sync bodies", () => {
  it("script: site and screenshots in slot order, English, the user", () => {
    expect(buildUgcSyncBody(n("ugc-script", { targetDurationSec: 20 }), { ugc: { site: "Acme", screenshot: "https://cdn.example/1.png", screenshot3: "https://cdn.example/3.png" } } as never, ctx()))
      .toEqual({ site: "Acme", screenshots: ["https://cdn.example/1.png", "https://cdn.example/3.png"], targetDurationSec: 20, language: "en", userId: "user-1" })
  })
  it("clips: the canvas body and the user", () => {
    expect(buildUgcSyncBody(n("ugc-clips", { voiceId: "voice-1" }), { ugc: { plan: JSON.stringify({ v: 1, hook: "h" }), creator: JSON.stringify({ v: 1, gender: "man", identityImages: ["https://cdn.example/c.png"], traits: null }) } } as never, ctx()))
      .toEqual({ plan: { v: 1, hook: "h" }, gender: "man", traits: null, identityImages: ["https://cdn.example/c.png"], surface: "canvas", voiceId: "voice-1", userId: "user-1" })
  })
  it("clip: the nonce from rerender; runKey only on an app run", () => {
    const node = n("ugc-clip", { rerender: { "1": 2 } })
    const inputs = { ugc: { clip: JSON.stringify(T(0)) } } as never
    expect(buildUgcSyncBody(node, inputs, ctx())).toEqual({ ticket: T(0), nonce: 2, userId: "user-1" })
    expect(buildUgcSyncBody(node, inputs, ctx(true))).toEqual({ ticket: T(0), nonce: 2, runKey: "exec-1", userId: "user-1" })
  })
  it("clip: an app run's continuation names its chain's root, so the earlier attempt's clips are handed back", () => {
    const node = n("ugc-clip", { rerender: {} })
    const inputs = { ugc: { clip: JSON.stringify(T(0)) } } as never
    const continued = { ...ctx(true), executionId: "exec-2", runRootExecutionId: "exec-1" } as OrchestratorContext
    expect(buildUgcSyncBody(node, inputs, continued)).toEqual({ ticket: T(0), nonce: 0, runKey: "exec-1", userId: "user-1" })
    // Off an app run the root is never sent.
    expect(buildUgcSyncBody(node, inputs, { ...continued, isAppRun: false })).toEqual({ ticket: T(0), nonce: 0, userId: "user-1" })
  })
  it("the wires' errors are thrown before any call", () => {
    expect(() => buildUgcSyncBody(n("ugc-script"), { ugc: {} } as never, ctx())).toThrow("Add the product name or website.")
    expect(() => buildUgcSyncBody(n("ugc-clip", { rerender: {} }), { ugc: { clip: JSON.stringify({ ...T(0), v: 2 }) } } as never, ctx())).toThrow(UGC_VERSION_MESSAGE)
  })
  it("the clips answer becomes outputs, a ticket list and the first ticket; an invalid plan throws", () => {
    const out = ugcSyncOutput("ugc-clips", { errors: [], tickets: [T(0), T(1)], sizedPlan: {}, transcript: "a b", hasCards: false })
    expect(out.listResults).toEqual([JSON.stringify(T(0)), JSON.stringify(T(1))])
    expect(out.ugcOutputs?.clips).toBe(JSON.stringify(T(0)))
    expect(() => ugcSyncOutput("ugc-clips", { errors: [{ message: "Too long.", fix: "Trim it." }] })).toThrow("The script needs changes: Too long. Trim it.")
  })
})

describe("UGC sync bodies: the remaining rules", () => {
  it("script: the product photo when wired, the node's length else the default, empty slots dropped", () => {
    const body = buildUgcSyncBody(n("ugc-script"), { ugc: { site: " Acme ", screenshot2: "https://cdn.example/2.png", screenshot4: "", product: "https://cdn.example/p.png" } } as never, ctx())
    expect(body).toEqual({ site: "Acme", screenshots: ["https://cdn.example/2.png"], productImage: "https://cdn.example/p.png", targetDurationSec: 15, language: "en", userId: "user-1" })
  })
  it("the user is the run's, never a key the node holds", () => {
    const body = buildUgcSyncBody(n("ugc-script", { userId: "someone-else" }), { ugc: { site: "Acme" } } as never, ctx())
    expect(body.userId).toBe("user-1")
  })
  it("no wired inputs reads as nothing connected", () => {
    expect(() => buildUgcSyncBody(n("ugc-script"), {} as never, ctx())).toThrow("Add the product name or website.")
    expect(() => buildUgcSyncBody(n("ugc-clips"), {} as never, ctx())).toThrow("Connect the Script output of UGC Script.")
    expect(() => buildUgcSyncBody(n("ugc-clip"), {} as never, ctx())).toThrow("Connect the Clips output of UGC Clips.")
  })
  it("clip: no rerender count is a first render", () => {
    expect(buildUgcSyncBody(n("ugc-clip"), { ugc: { clip: JSON.stringify(T(1)) } } as never, ctx())).toEqual({ ticket: T(1), nonce: 0, userId: "user-1" })
  })
  it("only the three types whose route answers at once have a body here", () => {
    for (const type of ["ugc-creator", "ugc-cards", "llm-chat"]) {
      expect(() => buildUgcSyncBody(n(type), { ugc: {} } as never, ctx()), type).toThrow(/no UGC request body/i)
    }
  })
  it("the clips answer without the parts the next nodes need fails before any clip is paid for", () => {
    expect(() => ugcSyncOutput("ugc-clips", { errors: [], tickets: [], sizedPlan: {}, transcript: "" })).toThrow(UGC_NEWER_APP_MESSAGE)
  })
  it("the clips answer's transcript and plan-out ride on the outputs", () => {
    const out = ugcSyncOutput("ugc-clips", { errors: [], tickets: [T(0)], sizedPlan: { hook: "h" }, transcript: "a b", speechCheckCall: { args: { language: "en" } } })
    expect(out.ugcOutputs).toEqual({ clips: JSON.stringify(T(0)), "plan-out": JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: { language: "en" } }), transcript: "a b" })
  })
  it("only UGC Clips answers in the call itself", () => {
    expect(() => ugcSyncOutput("ugc-script", { plan: {} })).toThrow(/no UGC answer/i)
  })
})

describe("the UGC routes", () => {
  it("one route per UGC node, served by the Nodaro Cloud plugin", () => {
    expect(UGC_SYNC_ROUTES).toEqual({
      "ugc-creator": "/v1/ugc/creator",
      "ugc-script": "/v1/ugc/script",
      "ugc-clips": "/v1/ugc/clips",
      "ugc-clip": "/v1/ugc/clip",
      "ugc-cards": "/v1/ugc/cards",
      "ugc-finish-clips": "/v1/ugc/finish",
    })
    expect([...PLUGIN_SERVED_SYNC_TYPES].sort()).toEqual([...UGC_NODE_TYPES].sort())
  })
})

describe("the UGC jobs a run owns", () => {
  it("UGC Script and UGC Clip answer with a job of their route's own", () => {
    expect([...UGC_JOB_TYPES].sort()).toEqual(["ugc-clip", "ugc-script"])
    for (const type of UGC_JOB_TYPES) expect(PLUGIN_SERVED_SYNC_TYPES.has(type), type).toBe(true)
  })
  it("a job is this run's when the run stamped it, or when no run did and it had not finished when this run got it", () => {
    expect(ugcJobIsThisRuns({ workflow_execution_id: "exec-1", status: "completed" }, "exec-1")).toBe(true)
    expect(ugcJobIsThisRuns({ workflow_execution_id: null, status: "pending" }, "exec-1")).toBe(true)
    expect(ugcJobIsThisRuns({ workflow_execution_id: null, status: "processing" }, "exec-1")).toBe(true)
  })
  it("a job another run stamped, or one that had already finished, is not: its charge was another run's", () => {
    expect(ugcJobIsThisRuns({ workflow_execution_id: "exec-0", status: "processing" }, "exec-1")).toBe(false)
    expect(ugcJobIsThisRuns({ workflow_execution_id: "exec-0", status: "completed" }, "exec-1")).toBe(false)
    expect(ugcJobIsThisRuns({ workflow_execution_id: null, status: "completed" }, "exec-1")).toBe(false)
  })
  it("a row the lane could not read is this run's (the job it just started)", () => {
    expect(ugcJobIsThisRuns(null, "exec-1")).toBe(true)
    expect(ugcJobIsThisRuns(undefined, "exec-1")).toBe(true)
  })
})

// ── UGC Creator and UGC Cards: the runners, with their calls stubbed ─────────

type Reply = { status: number; body: unknown }
function stubDeps(replies: Record<string, Reply[]>, opts: { polled?: Record<string, { output: Record<string, unknown>; creditsUsed?: number } | Error>; charges?: Record<string, number> } = {}) {
  const posted: Array<{ path: string; body: Record<string, unknown>; step?: string }> = []
  const created: string[] = []
  const queue = Object.fromEntries(Object.entries(replies).map(([k, v]) => [k, [...v]]))
  const next = (key: string): { status: number; text: string } => {
    const r = queue[key]?.shift()
    if (!r) throw new Error(`unexpected ${key}`)
    return { status: r.status, text: JSON.stringify(r.body) }
  }
  const deps: UgcDeps = {
    post: vi.fn(async (path, body, step) => { posted.push({ path, body, ...(step ? { step } : {}) }); return next(path) }),
    get: vi.fn(async (path) => next(`GET ${path}`)),
    poll: vi.fn(async (jobId) => {
      const r = opts.polled?.[jobId]
      if (r instanceof Error) throw r
      return { jobId, output: r?.output ?? {}, creditsUsed: r?.creditsUsed }
    }),
    onJobCreated: vi.fn((id: string) => { created.push(id) }),
    jobCharge: vi.fn(async (id: string) => opts.charges?.[id] ?? 0),
  }
  return { deps, posted, created }
}
const RUN = { executionId: "exec-1", userId: "user-1", isAppRun: false } as unknown as OrchestratorContext
const creatorNode = (data: Record<string, unknown>): SimpleNode => ({ id: "creator", type: "ugc-creator", data: { label: "UGC Creator", keepResult: false, ...data } })
const bodyOf = (call: { tool: string; args: Record<string, unknown> }, image?: string) => {
  const m = ugcCallToRouteBody(call as never, image ? { image } : {})
  if (!m || "error" in m) throw new Error("unmappable")
  return { ...m.body, userId: "user-1" }
}
const GENDER = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "The AI creator did not come out as the person you chose. Run UGC Creator again." }
const IMAGE = { tool: "generate_image", args: { prompt: "p", model: "image-model-a", aspect_ratio: "3:4" }, fallback: { tool: "generate_image", args: { prompt: "p", model: "image-model-b", aspect_ratio: "3:4" } } }
const sampled = (seed: number, traits: Record<string, unknown>) => ({
  kind: "sampled", seed, gender: "woman", traits, identityImages: [], promptsVersion: "1.0.0", productCategory: "saas",
  image: IMAGE, realismPass: null, secondFrame: null, photoCheck: null, genderCheck: GENDER,
})
const SAMPLED_DATA = { source: "sampled", gender: "woman", seed: 7 }
const INPUTS = { ugc: { category: "saas" } } as never

describe("runUgcCreator — sampled", () => {
  it("renders, reads, and charges the image AND the reading", async () => {
    const { deps, posted, created } = stubDeps(
      {
        "/v1/ugc/creator": [{ status: 200, body: sampled(7, { t: 1 }) }],
        "/v1/generate-image": [{ status: 200, body: { jobId: "img-1" } }],
        "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-1", generatedText: "PASS woman" } }],
      },
      { polled: { "img-1": { output: { imageUrl: "https://cdn.example/i1.png" }, creditsUsed: 45 } }, charges: { "read-1": 3 } },
    )
    const r = await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps)
    expect(posted.map((p) => p.path)).toEqual(["/v1/ugc/creator", "/v1/generate-image", "/v1/image-to-text/describe"])
    expect(posted[1]!.body).toEqual(bodyOf(IMAGE))
    expect(posted[2]!.body).toEqual(bodyOf(GENDER, "https://cdn.example/i1.png"))
    expect(created).toEqual(["img-1", "read-1"])
    expect(r.creditsUsed).toBe(45 + 3)
    expect(r.output.ugcOutputs?.image).toBe("https://cdn.example/i1.png")
  })
  it("a moderation block of the image job runs the fallback once", async () => {
    const blocked = Object.assign(new Error("blocked"), { errorHint: { kind: "safety-block", class: "content", retried: false } })
    const { deps, posted } = stubDeps(
      {
        "/v1/ugc/creator": [{ status: 200, body: sampled(7, { t: 1 }) }],
        "/v1/generate-image": [{ status: 200, body: { jobId: "img-1" } }, { status: 200, body: { jobId: "img-2" } }],
        "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-1", generatedText: "PASS" } }],
      },
      { polled: { "img-1": blocked, "img-2": { output: { imageUrl: "https://cdn.example/i2.png" }, creditsUsed: 40 } }, charges: { "read-1": 3 } },
    )
    const r = await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps)
    expect(posted[2]!.body).toEqual(bodyOf(IMAGE.fallback))
    expect(r.creditsUsed).toBe(40 + 3)
  })
  it("a first miss re-renders once with the next seed and the first traits as previous; both readings are charged", async () => {
    const { deps, posted } = stubDeps(
      {
        "/v1/ugc/creator": [{ status: 200, body: sampled(7, { t: 1 }) }, { status: 200, body: sampled(8, { t: 2 }) }],
        "/v1/generate-image": [{ status: 200, body: { jobId: "img-1" } }, { status: 200, body: { jobId: "img-2" } }],
        "/v1/image-to-text/describe": [
          { status: 200, body: { jobId: "read-1", generatedText: "FAIL: reads as a man" } },
          { status: 200, body: { jobId: "read-2", generatedText: "PASS" } },
        ],
      },
      {
        polled: { "img-1": { output: { imageUrl: "https://cdn.example/i1.png" }, creditsUsed: 45 }, "img-2": { output: { imageUrl: "https://cdn.example/i2.png" }, creditsUsed: 45 } },
        charges: { "read-1": 3, "read-2": 3 },
      },
    )
    const r = await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps)
    const second = posted.filter((p) => p.path === "/v1/ugc/creator")[1]!.body
    expect(second).toMatchObject({ seed: 8, source: { kind: "sampled", previous: { t: 1 } } })
    expect(r.output.ugcOutputs?.image).toBe("https://cdn.example/i2.png")
    expect(r.creditsUsed).toBe(45 + 3 + 45 + 3)
  })
  it("a second miss fails with the builder's refusal and runs nothing after it", async () => {
    const { deps, posted } = stubDeps(
      {
        "/v1/ugc/creator": [{ status: 200, body: sampled(7, { t: 1 }) }, { status: 200, body: sampled(8, { t: 2 }) }],
        "/v1/generate-image": [{ status: 200, body: { jobId: "img-1" } }, { status: 200, body: { jobId: "img-2" } }],
        "/v1/image-to-text/describe": [
          { status: 200, body: { jobId: "read-1", generatedText: "unclear" } },
          { status: 200, body: { jobId: "read-2", generatedText: "FAIL" } },
        ],
      },
      { polled: { "img-1": { output: { imageUrl: "https://cdn.example/i1.png" }, creditsUsed: 45 }, "img-2": { output: { imageUrl: "https://cdn.example/i2.png" }, creditsUsed: 45 } } },
    )
    await expect(runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps)).rejects.toThrow(GENDER.refusal)
    expect(posted.length).toBe(6)
  })
  it("an unknown tool fails with the newer-app message before any child job", async () => {
    const { deps, created } = stubDeps({ "/v1/ugc/creator": [{ status: 200, body: { ...sampled(7, { t: 1 }), image: { ...IMAGE, tool: "teleport" } } }] })
    await expect(runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps)).rejects.toThrow("This step needs a newer app version.")
    expect(created).toEqual([])
  })
  it("a builder 400 fails the node with the forwarded issue and starts no child job", async () => {
    const { deps, created } = stubDeps({ "/v1/ugc/creator": [{ status: 400, body: { error: { code: "validation_error", message: "source.imageUrl: Invalid url" } } }] })
    await expect(runUgcCreator(creatorNode({ source: "photo", gender: "man", photoUrl: "file:///etc/x.png" }), { ugc: {} } as never, RUN, deps)).rejects.toThrow("source.imageUrl: Invalid url")
    expect(created).toEqual([])
  })
})

describe("runUgcCreator — photo", () => {
  const PHOTO = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "This photo can't be used: it must show exactly one adult with the face clearly visible." }
  const answer = { kind: "photo", gender: "man", traits: null, identityImages: ["https://cdn.example/wired.png"], promptsVersion: "1.0.0", image: null, realismPass: null, secondFrame: null, photoCheck: PHOTO, genderCheck: null }
  it("reads the wired photo (it wins over data.photoUrl) and charges the reading", async () => {
    const { deps, posted } = stubDeps(
      { "/v1/ugc/creator": [{ status: 200, body: answer }], "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-1", generatedText: "PASS" } }] },
      { charges: { "read-1": 3 } },
    )
    const r = await runUgcCreator(creatorNode({ source: "photo", gender: "man", photoUrl: "https://cdn.example/typed.png" }), { ugc: { photo: "https://cdn.example/wired.png" } } as never, RUN, deps)
    expect(posted[1]!.body).toEqual(bodyOf(PHOTO, "https://cdn.example/wired.png"))
    expect(r.creditsUsed).toBe(3)
    expect(r.output.ugcOutputs?.image).toBe("https://cdn.example/wired.png")
  })
  it("a reading that does not start with the pass token fails with the refusal", async () => {
    const { deps } = stubDeps({ "/v1/ugc/creator": [{ status: 200, body: answer }], "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-1", generatedText: "FAIL: two people" } }] })
    await expect(runUgcCreator(creatorNode({ source: "photo", gender: "man" }), { ugc: { photo: "https://cdn.example/wired.png" } } as never, RUN, deps)).rejects.toThrow(PHOTO.refusal)
  })
  it("an answer whose photo check the app cannot run is refused before any job", async () => {
    for (const photoCheck of [null, { ...PHOTO, tool: "teleport" }, { ...PHOTO, passToken: "" }]) {
      const { deps, created } = stubDeps({ "/v1/ugc/creator": [{ status: 200, body: { ...answer, photoCheck } }] })
      await expect(runUgcCreator(creatorNode({ source: "photo", gender: "man" }), { ugc: { photo: "https://cdn.example/wired.png" } } as never, RUN, deps)).rejects.toThrow(UGC_NEWER_APP_MESSAGE)
      expect(created).toEqual([])
    }
  })
})

describe("runUgcCards", () => {
  const PLAN_OUT = JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: {} })
  const inputs = (plan: string) => ({ ugc: { plan, video: "https://cdn.example/v.mp4", transcript: "a b" }, clipNotes: [{ clip: 1, warnings: [], durationSec: 12 }] }) as never
  const cardsNode: SimpleNode = { id: "cards", type: "ugc-cards", data: { label: "UGC Cards" } }
  const CARDS_ANSWER = { layerPlan: [], captionTiming: null, report: { lines: ["No issues."] } }
  it("no plugin → the Cloud sentence and no child job", async () => {
    const { deps, created } = stubDeps({ "GET /v1/ugc/categories": [{ status: 404, body: {} }] })
    await expect(runUgcCards(cardsNode, inputs(PLAN_OUT), RUN, deps)).rejects.toThrow("UGC videos are a Nodaro Cloud feature and are not served on this deployment.")
    expect(created).toEqual([])
  })
  it("a bare plan → the invalid-plan failure and no child job", async () => {
    const { deps, created } = stubDeps({ "GET /v1/ugc/categories": [{ status: 200, body: { categories: [] } }] })
    await expect(runUgcCards(cardsNode, inputs(JSON.stringify({ v: 1, hook: "h" })), RUN, deps)).rejects.toThrow("Connect the Script (sized) output of UGC Clips.")
    expect(created).toEqual([])
  })
  it.each([
    ["both succeed", { "al-1": { output: { alignment: [{ word: "a", start: 0, end: 0.3 }] }, creditsUsed: 30 }, "tr-1": { output: { json: { words: [{ text: "a", startMs: 0, endMs: 300 }] } }, creditsUsed: 22 } }, [], 52],
    ["alignment fails", { "al-1": new Error("alignment failed"), "tr-1": { output: { json: { words: [] } }, creditsUsed: 22 } }, ["alignment"], 22],
    ["transcription fails", { "al-1": { output: { alignment: [] }, creditsUsed: 30 }, "tr-1": new Error("stt failed") }, ["words"], 30],
    ["both fail", { "al-1": new Error("x"), "tr-1": new Error("y") }, ["alignment", "words"], 0],
  ] as const)("%s → failed %j, creditsUsed %d", async (_name, polled, failed, credits) => {
    const { deps, posted, created } = stubDeps(
      {
        "GET /v1/ugc/categories": [{ status: 200, body: { categories: [] } }],
        "/v1/forced-alignment": [{ status: 200, body: { jobId: "al-1" } }],
        "/v1/transcribe": [{ status: 200, body: { jobId: "tr-1" } }],
        "/v1/ugc/cards": [{ status: 200, body: CARDS_ANSWER }],
      },
      { polled: polled as never },
    )
    const r = await runUgcCards(cardsNode, inputs(PLAN_OUT), RUN, deps)
    expect(created.sort()).toEqual(["al-1", "tr-1"])
    const cards = posted.find((p) => p.path === "/v1/ugc/cards")!.body
    expect(cards.failed).toEqual(failed)
    expect(cards.clipNotes).toEqual([{ clip: 1, warnings: [], durationSec: 12 }])
    expect(r.creditsUsed).toBe(credits)
    expect(Object.keys(r.output.ugcOutputs ?? {}).sort()).toEqual(["captionPlan", "layerPlan", "report"])
  })
  it("hands on its Notes as the node's text, what an app's Notes card and the API's run result read", async () => {
    const { deps } = stubDeps(
      {
        "GET /v1/ugc/categories": [{ status: 200, body: { categories: [] } }],
        "/v1/forced-alignment": [{ status: 200, body: { jobId: "al-1" } }],
        "/v1/transcribe": [{ status: 200, body: { jobId: "tr-1" } }],
        "/v1/ugc/cards": [{ status: 200, body: { ...CARDS_ANSWER, report: { lines: ["Clip 2 ran long.", "Clip 3 skipped a word."] } } }],
      },
      { polled: { "al-1": { output: { alignment: [] }, creditsUsed: 30 }, "tr-1": { output: { json: { words: [] } }, creditsUsed: 22 } } },
    )
    const r = await runUgcCards(cardsNode, inputs(PLAN_OUT), RUN, deps)
    expect(r.output.text).toBe("Clip 2 ran long.\nClip 3 skipped a word.")
    expect(r.output.text).toBe(r.output.ugcOutputs?.report)
  })
  it("a run that stops while it times the video is never a timing failure: no cards are asked for", async () => {
    const { deps, posted } = stubDeps(
      {
        "GET /v1/ugc/categories": [{ status: 200, body: { categories: [] } }],
        "/v1/forced-alignment": [{ status: 200, body: { jobId: "al-1" } }],
        "/v1/transcribe": [{ status: 200, body: { jobId: "tr-1" } }],
      },
      { polled: { "al-1": new DrainAbortError(), "tr-1": { output: { json: { words: [] } }, creditsUsed: 22 } } },
    )
    await expect(runUgcCards(cardsNode, inputs(PLAN_OUT), RUN, deps)).rejects.toBeInstanceOf(DrainAbortError)
    expect(posted.some((p) => p.path === "/v1/ugc/cards")).toBe(false)
  })
  it("two timing jobs whose rows mirror no charge are both counted, though they settle side by side", async () => {
    const { deps } = stubDeps(
      {
        "GET /v1/ugc/categories": [{ status: 200, body: { categories: [] } }],
        "/v1/forced-alignment": [{ status: 200, body: { jobId: "al-1" } }],
        "/v1/transcribe": [{ status: 200, body: { jobId: "tr-1" } }],
        "/v1/ugc/cards": [{ status: 200, body: CARDS_ANSWER }],
      },
      { polled: { "al-1": { output: { alignment: [] } }, "tr-1": { output: { json: { words: [] } } } }, charges: { "al-1": 30, "tr-1": 22 } },
    )
    const r = await runUgcCards(cardsNode, inputs(PLAN_OUT), RUN, deps)
    expect(r.creditsUsed).toBe(30 + 22)
  })
  it.each([
    ["the alignment", "/v1/forced-alignment", "/v1/transcribe"],
    ["the transcription", "/v1/transcribe", "/v1/forced-alignment"],
  ] as const)("a credits refusal on %s fails the node with the standard error; no cards are made without captions", async (_name, refusedPath, otherPath) => {
    const { deps, posted } = stubDeps(
      {
        "GET /v1/ugc/categories": [{ status: 200, body: { categories: [] } }],
        [refusedPath]: [{ status: 402, body: { error: { code: "insufficient_credits", message: "Insufficient credits. Required: 30, Available: 4" }, required: 30, balance: 4 } }],
        [otherPath]: [{ status: 200, body: { jobId: "other-1" } }],
      },
      { polled: { "other-1": { output: { alignment: [], json: { words: [] } }, creditsUsed: 22 } } },
    )
    const err = (await runUgcCards(cardsNode, inputs(PLAN_OUT), RUN, deps).catch((e: unknown) => e)) as Error & { errorCode?: string; output?: Record<string, unknown> }
    expect(err.message).toBe("Insufficient credits. Required: 30, Available: 4")
    expect(err.errorCode).toBe("insufficient_credits")
    expect(err.output?.ugcShortfall).toEqual({ required: 30, balance: 4 })
    expect(posted.some((p) => p.path === "/v1/ugc/cards")).toBe(false)
  })
  it("a workspace-budget refusal on a timing job fails the node the same way", async () => {
    const { deps, posted } = stubDeps(
      {
        "GET /v1/ugc/categories": [{ status: 200, body: { categories: [] } }],
        "/v1/forced-alignment": [{ status: 402, body: { error: { code: "budget_exceeded", message: "The workspace budget cannot cover this run" } } }],
        "/v1/transcribe": [{ status: 402, body: { error: { code: "budget_exceeded", message: "The workspace budget cannot cover this run" } } }],
      },
    )
    const err = (await runUgcCards(cardsNode, inputs(PLAN_OUT), RUN, deps).catch((e: unknown) => e)) as Error & { errorCode?: string; output?: unknown }
    expect(err.errorCode).toBe("budget_exceeded")
    expect(err.output).toBeUndefined()
    expect(posted.some((p) => p.path === "/v1/ugc/cards")).toBe(false)
  })
  it("a timing job that fails for another reason still leaves the other timing to make the cards", async () => {
    const { deps, posted } = stubDeps(
      {
        "GET /v1/ugc/categories": [{ status: 200, body: { categories: [] } }],
        "/v1/forced-alignment": [{ status: 503, body: { error: { code: "external_wallet_unavailable", message: "The shared wallet is unavailable. Please try again." } } }],
        "/v1/transcribe": [{ status: 200, body: { jobId: "tr-1" } }],
        "/v1/ugc/cards": [{ status: 200, body: CARDS_ANSWER }],
      },
      { polled: { "tr-1": { output: { json: { words: [] } }, creditsUsed: 22 } } },
    )
    await runUgcCards(cardsNode, inputs(PLAN_OUT), RUN, deps)
    expect(posted.find((p) => p.path === "/v1/ugc/cards")!.body.failed).toEqual(["alignment"])
  })
  it("each timing job is its own call of the node's run; the cards call is the node's own", async () => {
    const { deps, posted } = stubDeps(
      {
        "GET /v1/ugc/categories": [{ status: 200, body: { categories: [] } }],
        "/v1/forced-alignment": [{ status: 200, body: { jobId: "al-1" } }],
        "/v1/transcribe": [{ status: 200, body: { jobId: "tr-1" } }],
        "/v1/ugc/cards": [{ status: 200, body: CARDS_ANSWER }],
      },
      { polled: { "al-1": { output: { alignment: [] }, creditsUsed: 30 }, "tr-1": { output: { json: { words: [] } }, creditsUsed: 22 } } },
    )
    await runUgcCards(cardsNode, inputs(PLAN_OUT), RUN, deps)
    expect(Object.fromEntries(posted.map((p) => [p.path, p.step]))).toEqual({ "/v1/forced-alignment": "alignment", "/v1/transcribe": "transcribe", "/v1/ugc/cards": undefined })
  })
})

const img = (m: string) => ({ tool: "generate_image", args: { prompt: "p", model: m, aspect_ratio: "3:4" } })
const [A, B, C] = [img("image-model-a"), img("image-model-b"), img("image-model-c")]

describe("runUgcCreator — two options", () => {
  const two = (seed: number, traits: Record<string, unknown>) => ({
    ...sampled(seed, traits), image: { ...A, fallback: C }, candidates: [{ model: "image-model-a", ...A }, { model: "image-model-b", ...B }], fallback: C, pick: { how: "user" },
  })
  const draws = (b: string, imageB: Reply = { status: 200, body: { jobId: "img-b" } }) => ({
    "/v1/ugc/creator": [{ status: 200, body: two(7, { t: 1 }) }],
    "/v1/generate-image": [{ status: 200, body: { jobId: "img-a" } }, imageB],
    "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-a", generatedText: "PASS" } }, { status: 200, body: { jobId: "read-b", generatedText: b } }],
  })
  const polled = { polled: { "img-a": { output: { imageUrl: "https://cdn.example/a.png" }, creditsUsed: 45 }, "img-b": { output: { imageUrl: "https://cdn.example/b.png" }, creditsUsed: 40 } }, charges: { "read-a": 3, "read-b": 3 } }
  it("a run nobody picks in renders the primary alone, as before", async () => {
    const { deps, posted } = stubDeps(draws("PASS"), polled)
    const r = await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps)
    expect(posted.map((p) => p.path)).toEqual(["/v1/ugc/creator", "/v1/generate-image", "/v1/image-to-text/describe"])
    expect(posted[1]!.body).toEqual(bodyOf(A))
    expect(r.output.ugcCandidates).toBeUndefined()
    expect(r.output.ugcOutputs?.image).toBe("https://cdn.example/a.png")
    expect(r.creditsUsed).toBe(45 + 3)
  })
  it("a person picks: both render and are checked; two that pass wait, with no creator wire, every charge counted", async () => {
    const { deps, posted, created } = stubDeps(draws("PASS"), polled)
    const r = await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps, { personPicks: true })
    expect(posted.filter((p) => p.path === "/v1/generate-image").map((p) => p.body)).toEqual([bodyOf(A), bodyOf(B)])
    expect([...created].sort()).toEqual(["img-a", "img-b", "read-a", "read-b"])
    expect(r.output.ugcOutputs).toBeUndefined()
    expect(r.output.imageUrl).toBeUndefined()
    expect(r.output.ugcCandidates?.map((c) => c.imageUrl)).toEqual(["https://cdn.example/a.png", "https://cdn.example/b.png"])
    expect(r.creditsUsed).toBe(45 + 40 + 3 + 3)
  })
  it("a person picks, one option is left: it is handed on exactly as today", async () => {
    const { deps } = stubDeps(draws("FAIL"), polled)
    const r = await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps, { personPicks: true })
    expect(r.output.ugcCandidates).toBeUndefined()
    expect(r.output.ugcOutputs?.image).toBe("https://cdn.example/a.png")
    expect(r.output.ugcOptionFailed).toBeUndefined()
  })
  it("a 402 on the second option: the node fails with the route's code and message, keeping the checked option and the shortfall", async () => {
    const refusal = { status: 402, body: { error: { code: "insufficient_credits", message: "Insufficient credits" }, required: 18, balance: 5 } }
    const { deps } = stubDeps(draws("PASS", refusal), polled)
    const err = (await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps, { personPicks: true }).catch((e: unknown) => e)) as Error & { errorCode?: string; output?: Record<string, unknown> }
    expect(err.message).toBe("Insufficient credits")
    expect(err.errorCode).toBe("insufficient_credits")
    expect((err.output?.ugcCandidates as Array<{ imageUrl: string }>).map((c) => c.imageUrl)).toEqual(["https://cdn.example/a.png"])
    expect(err.output?.ugcShortfall).toEqual({ required: 18, balance: 5 })
  })
})

describe("runUgcCreator — the remaining rules", () => {
  const two = (seed: number, traits: Record<string, unknown>) => ({
    ...sampled(seed, traits), image: { ...A, fallback: C }, candidates: [{ model: "image-model-a", ...A }, { model: "image-model-b", ...B }], fallback: C, pick: { how: "user" },
  })
  const passBoth = {
    "/v1/ugc/creator": [{ status: 200, body: two(7, { t: 1 }) }],
    "/v1/generate-image": [{ status: 200, body: { jobId: "img-a" } }, { status: 200, body: { jobId: "img-b" } }],
    "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-a", generatedText: "PASS" } }, { status: 200, body: { jobId: "read-b", generatedText: "PASS" } }],
  }
  const images = { polled: { "img-a": { output: { imageUrl: "https://cdn.example/a.png" }, creditsUsed: 45 }, "img-b": { output: { imageUrl: "https://cdn.example/b.png" }, creditsUsed: 40 } }, charges: { "read-a": 3, "read-b": 3 } }
  it("every child call names its round, its option and its step; the builder call is the node's own", async () => {
    const { deps, posted } = stubDeps(passBoth, images)
    await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps, { personPicks: true })
    expect(posted.map((p) => p.step)).toEqual([undefined, "r0-c0-image", "r0-c1-image", "r0-c0-check", "r0-c1-check"])
  })
  it("the builder's re-call is a call of its own; the photo check is named too", async () => {
    const miss = stubDeps(
      {
        "/v1/ugc/creator": [{ status: 200, body: sampled(7, { t: 1 }) }, { status: 200, body: sampled(8, { t: 2 }) }],
        "/v1/generate-image": [{ status: 200, body: { jobId: "img-1" } }, { status: 200, body: { jobId: "img-2" } }],
        "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-1", generatedText: "FAIL" } }, { status: 200, body: { jobId: "read-2", generatedText: "PASS" } }],
      },
      { polled: { "img-1": { output: { imageUrl: "https://cdn.example/i1.png" } }, "img-2": { output: { imageUrl: "https://cdn.example/i2.png" } } } },
    )
    await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, miss.deps)
    expect(miss.posted.filter((p) => p.path === "/v1/ugc/creator").map((p) => p.step)).toEqual([undefined, "builder-1"])
    const PHOTO = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" }
    const photo = stubDeps({
      "/v1/ugc/creator": [{ status: 200, body: { kind: "photo", gender: "man", traits: null, identityImages: [], promptsVersion: "1.0.0", image: null, photoCheck: PHOTO, genderCheck: null } }],
      "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-1", generatedText: "PASS" } }],
    })
    await runUgcCreator(creatorNode({ source: "photo", gender: "man" }), { ugc: { photo: "https://cdn.example/p.png" } } as never, RUN, photo.deps)
    expect(photo.posted[1]!.step).toBe("photo-check")
  })
  it("a reading the route hands back by its key (a resumed run) is read from its job, and charged", async () => {
    const { deps } = stubDeps(
      {
        "/v1/ugc/creator": [{ status: 200, body: sampled(7, { t: 1 }) }],
        "/v1/generate-image": [{ status: 200, body: { jobId: "img-1", deduped: true } }],
        "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-1", deduped: true } }],
      },
      { polled: { "img-1": { output: { imageUrl: "https://cdn.example/i1.png" }, creditsUsed: 45 }, "read-1": { output: { text: "PASS" } } }, charges: { "read-1": 3 } },
    )
    const r = await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps)
    expect(deps.poll).toHaveBeenCalledWith("read-1", "image-to-text")
    expect(r.output.ugcOutputs?.image).toBe("https://cdn.example/i1.png")
    expect(r.creditsUsed).toBe(45 + 3)
  })
  it("another failure beside the option that passed: the survivor is handed on with the note", async () => {
    const { deps } = stubDeps(
      { ...passBoth, "/v1/generate-image": [{ status: 200, body: { jobId: "img-a" } }, { status: 500, body: { error: { message: "boom" } } }] },
      images,
    )
    const r = await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps, { personPicks: true })
    expect(r.output.ugcOutputs?.image).toBe("https://cdn.example/a.png")
    expect(r.output.imageUrl).toBe("https://cdn.example/a.png")
    expect(r.output.ugcOptionFailed).toBe(true)
  })
  it("a 402 that names no balance stops the round with no shortfall", async () => {
    const { deps } = stubDeps(
      { ...passBoth, "/v1/generate-image": [{ status: 200, body: { jobId: "img-a" } }, { status: 402, body: { error: { code: "insufficient_credits", message: "This deployment is out of credits. Contact your administrator." }, required: 18 } }] },
      images,
    )
    const err = (await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps, { personPicks: true }).catch((e: unknown) => e)) as Error & { errorCode?: string; output?: Record<string, unknown> }
    expect(err.message).toBe("This deployment is out of credits. Contact your administrator.")
    expect(err.errorCode).toBe("insufficient_credits")
    expect(err.output?.ugcShortfall).toBeUndefined()
    expect(err.output?.ugcCandidates).toHaveLength(1)
  })
  it("a 402 before any option passed fails with the route's code and retains nothing", async () => {
    const { deps } = stubDeps({ ...passBoth, "/v1/generate-image": [
      { status: 402, body: { error: { code: "user_allowance_exceeded", message: "Your allowance cannot cover this run" }, required: 18, remaining: 2 } },
      { status: 402, body: { error: { code: "user_allowance_exceeded", message: "Your allowance cannot cover this run" }, required: 18, remaining: 2 } },
    ] })
    const err = (await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps, { personPicks: true }).catch((e: unknown) => e)) as Error & { errorCode?: string; output?: unknown }
    expect(err.errorCode).toBe("user_allowance_exceeded")
    expect(err.output).toBeUndefined()
  })
  // Every refusal that means the run cannot pay stops the round like an empty wallet: one of each kind.
  it.each([
    ["an empty wallet", 402, "insufficient_credits", "Insufficient credits. Required: 18, Available: 5", { required: 18, balance: 5 }],
    ["the free tier's daily limit", 402, "insufficient_credits", "Daily credit limit reached for free tier. Limit: 100, Spent today: 100. Upgrade for higher limits.", { required: 18, balance: 40 }],
    ["a paid tier's daily limit", 402, "insufficient_credits", "Daily credit limit reached. Limit: 2000, Spent: 1990", { required: 18, balance: 900 }],
    ["an empty deployment pool", 402, "insufficient_credits", "This deployment is out of credits. Contact your administrator.", { required: 18 }],
    ["an app run's free allowance", 402, "insufficient_app_credits", "Insufficient app credits. You have 2 app credits but need 18.", {}],
    ["a deployment's per-user allowance", 402, "user_allowance_exceeded", "Your allowance cannot cover this run", { required: 18, remaining: 2 }],
    ["the workspace budget", 402, "budget_exceeded", "The workspace budget cannot cover this run", {}],
    ["a member's cap in the workspace", 402, "member_cap_exceeded", "Your credit cap in this workspace cannot cover this run", {}],
    ["a shared wallet's refusal", 402, "external_wallet_denied", "The shared wallet could not authorize this generation.", {}],
    ["a connected instance's monthly cap", 402, "instance_cap_reached", "This instance reached its monthly spend cap (500 credits).", {}],
    ["credits that cannot spend in the studio", 403, "subscription_required", "Working in the studio requires a subscription.", {}],
  ] as const)("%s stops the round: the route's code and message, the checked option kept, no re-call", async (_kind, status, code, message, extra) => {
    const { deps, posted } = stubDeps(
      { ...passBoth, "/v1/generate-image": [{ status: 200, body: { jobId: "img-a" } }, { status, body: { error: { code, message }, ...extra } }] },
      images,
    )
    const err = (await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps, { personPicks: true }).catch((e: unknown) => e)) as Error & { errorCode?: string; output?: Record<string, unknown> }
    expect(err.message).toBe(message)
    expect(err.errorCode).toBe(code)
    expect((err.output?.ugcCandidates as Array<{ imageUrl: string }>).map((c) => c.imageUrl)).toEqual(["https://cdn.example/a.png"])
    const named = "required" in extra && "balance" in extra
    expect(err.output?.ugcShortfall).toEqual(named ? { required: extra.required, balance: extra.balance } : undefined)
    expect(posted.filter((p) => p.path === "/v1/ugc/creator")).toHaveLength(1)
  })
  // A refusal that is not about paying (a fault, a block, storage, a rate limit) is an option that failed.
  it.each([
    ["a shared wallet that is down", 503, "external_wallet_unavailable", "The shared wallet is unavailable. Please try again."],
    ["a blocked account", 403, "access_blocked", "Access has been blocked."],
    ["full storage", 413, "storage_limit_exceeded", "Storage limit exceeded"],
    ["a rate limit", 429, "rate_limit_exceeded", "Too many requests"],
  ] as const)("%s beside a survivor is an option that failed", async (_kind, status, code, message) => {
    const { deps } = stubDeps(
      { ...passBoth, "/v1/generate-image": [{ status: 200, body: { jobId: "img-a" } }, { status, body: { error: { code, message } } }] },
      images,
    )
    const r = await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps, { personPicks: true })
    expect(r.output.ugcOutputs?.image).toBe("https://cdn.example/a.png")
    expect(r.output.ugcOptionFailed).toBe(true)
  })
  it("a spend refusal on the photo check fails the node with the route's code", async () => {
    const PHOTO = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" }
    const { deps } = stubDeps({
      "/v1/ugc/creator": [{ status: 200, body: { kind: "photo", gender: "man", traits: null, identityImages: [], promptsVersion: "1.0.0", image: null, photoCheck: PHOTO, genderCheck: null } }],
      "/v1/image-to-text/describe": [{ status: 402, body: { error: { code: "budget_exceeded", message: "The workspace budget cannot cover this run" } } }],
    })
    const err = (await runUgcCreator(creatorNode({ source: "photo", gender: "man" }), { ugc: { photo: "https://cdn.example/p.png" } } as never, RUN, deps).catch((e: unknown) => e)) as Error & { errorCode?: string }
    expect(err.message).toBe("The workspace budget cannot cover this run")
    expect(err.errorCode).toBe("budget_exceeded")
  })
  it("a run that drains mid-round fails the node with the drain itself, never as an option that failed", async () => {
    const { deps } = stubDeps(passBoth, { ...images, polled: { ...images.polled, "img-b": new DrainAbortError() } })
    await expect(runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps, { personPicks: true })).rejects.toBeInstanceOf(DrainAbortError)
  })
  it("a cancelled run ends the round: an option's failure then is the cancel, not a survivor's note", async () => {
    const cancelled = { ...RUN, cancelled: true } as OrchestratorContext
    const { deps } = stubDeps(passBoth, { ...images, polled: { ...images.polled, "img-b": new Error("Execution cancelled") } })
    await expect(runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, cancelled, deps, { personPicks: true })).rejects.toThrow("Execution cancelled")
  })
  it("the run's user rides every body, never a key the node holds", async () => {
    const { deps, posted } = stubDeps(passBoth, images)
    await runUgcCreator(creatorNode({ ...SAMPLED_DATA, userId: "someone-else" }), INPUTS, RUN, deps, { personPicks: true })
    for (const p of posted) expect(p.body.userId, p.path).toBe("user-1")
  })
})

describe("who can pick a creator", () => {
  const editor = { reviewerPresent: true, isAppRun: false }
  it.each([
    ["the editor's own run, a top-level node", editor, undefined, undefined, true],
    ["no reviewer: a trigger, an API, SDK or MCP run", { ...editor, reviewerPresent: false }, undefined, undefined, false],
    ["a job queued before the field existed", { isAppRun: false }, undefined, undefined, false],
    ["an app run, its runner present or not", { ...editor, isAppRun: true }, undefined, undefined, false],
    ["a fan-out iteration", editor, 0, undefined, false],
    ["a node inside a sub-workflow", editor, undefined, ["sub-1"], false],
  ] as const)("%s", (_name, c, i, scope, want) => {
    expect(ugcPersonPicks(c as never, i, scope)).toBe(want)
  })
})

describe("one seed per run for a creator nobody pinned", () => {
  const UNPINNED = { source: "sampled", gender: "woman" }
  const replies = () => ({
    "/v1/ugc/creator": [{ status: 200, body: sampled(7, { t: 1 }) }],
    "/v1/generate-image": [{ status: 200, body: { jobId: "img-1" } }],
    "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-1", generatedText: "PASS" } }],
  })
  const polled = { polled: { "img-1": { output: { imageUrl: "https://cdn.example/i1.png" } } } }
  it("an unpinned sampled creator asks the builder for the run's seed", async () => {
    const { deps, posted } = stubDeps(replies(), polled)
    await runUgcCreator(creatorNode(UNPINNED), INPUTS, RUN, deps, { personPicks: false, runSeed: 1234 })
    expect(posted[0]!.body).toMatchObject({ seed: 1234, source: { kind: "sampled" } })
  })
  it("a pinned creator keeps its own seed; a photo sends none", async () => {
    const pinned = stubDeps(replies(), polled)
    await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, pinned.deps, { personPicks: false, runSeed: 1234 })
    expect(pinned.posted[0]!.body.seed).toBe(7)
    const PHOTO = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" }
    const photo = stubDeps({
      "/v1/ugc/creator": [{ status: 200, body: { kind: "photo", gender: "man", traits: null, identityImages: [], promptsVersion: "1.0.0", image: null, photoCheck: PHOTO, genderCheck: null } }],
      "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-1", generatedText: "PASS" } }],
    })
    await runUgcCreator(creatorNode({ source: "photo", gender: "man" }), { ugc: { photo: "https://cdn.example/p.png" } } as never, RUN, photo.deps, { personPicks: false, runSeed: 1234 })
    expect(photo.posted[0]!.body.seed).toBeUndefined()
  })
  it("with no run seed the builder picks one, as before", async () => {
    const { deps, posted } = stubDeps(replies(), polled)
    await runUgcCreator(creatorNode(UNPINNED), INPUTS, RUN, deps)
    expect(posted[0]!.body.seed).toBeUndefined()
  })
  it("the run's seed is fixed by the node's key, a seed the builder takes, and another key's differs", () => {
    const key = "wf-exec-1-creator"
    expect(ugcRunSeed(key)).toBe(ugcRunSeed(key))
    for (const k of [key, "wf-exec-2-creator", "wf-exec-1-sub-0-creator-3"]) {
      const seed = ugcRunSeed(k)
      expect(Number.isInteger(seed) && seed >= 0 && seed <= 2 ** 31 - 1, k).toBe(true)
    }
    expect(ugcRunSeed("wf-exec-2-creator")).not.toBe(ugcRunSeed(key))
  })
})

describe("a node that fails still reports what it was charged", () => {
  type Charged = Error & { creditsUsed?: number; errorCode?: string }
  it("the gender refusal after two rounds carries both rounds' images and readings", async () => {
    const { deps } = stubDeps(
      {
        "/v1/ugc/creator": [{ status: 200, body: sampled(7, { t: 1 }) }, { status: 200, body: sampled(8, { t: 2 }) }],
        "/v1/generate-image": [{ status: 200, body: { jobId: "img-1" } }, { status: 200, body: { jobId: "img-2" } }],
        "/v1/image-to-text/describe": [
          { status: 200, body: { jobId: "read-1", generatedText: "FAIL" } },
          { status: 200, body: { jobId: "read-2", generatedText: "FAIL" } },
        ],
      },
      {
        polled: { "img-1": { output: { imageUrl: "https://cdn.example/i1.png" }, creditsUsed: 45 }, "img-2": { output: { imageUrl: "https://cdn.example/i2.png" }, creditsUsed: 45 } },
        charges: { "read-1": 3, "read-2": 3 },
      },
    )
    const err = (await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps).catch((e: unknown) => e)) as Charged
    expect(err.message).toBe(GENDER.refusal)
    expect(err.creditsUsed).toBe(45 + 3 + 45 + 3)
  })
  it("a credits stop carries the checked option's image and reading", async () => {
    const two = { ...sampled(7, { t: 1 }), image: { ...A, fallback: C }, candidates: [{ model: "image-model-a", ...A }, { model: "image-model-b", ...B }], fallback: C, pick: { how: "user" } }
    const { deps } = stubDeps(
      {
        "/v1/ugc/creator": [{ status: 200, body: two }],
        "/v1/generate-image": [{ status: 200, body: { jobId: "img-a" } }, { status: 402, body: { error: { code: "budget_exceeded", message: "The workspace budget cannot cover this run" } } }],
        "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-a", generatedText: "PASS" } }],
      },
      { polled: { "img-a": { output: { imageUrl: "https://cdn.example/a.png" }, creditsUsed: 45 } }, charges: { "read-a": 3 } },
    )
    const err = (await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, deps, { personPicks: true }).catch((e: unknown) => e)) as Charged
    expect(err.errorCode).toBe("budget_exceeded")
    expect(err.creditsUsed).toBe(45 + 3)
  })
  it("a photo the check refused carries the reading", async () => {
    const PHOTO = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" }
    const { deps } = stubDeps(
      {
        "/v1/ugc/creator": [{ status: 200, body: { kind: "photo", gender: "man", traits: null, identityImages: [], promptsVersion: "1.0.0", image: null, photoCheck: PHOTO, genderCheck: null } }],
        "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-1", generatedText: "FAIL" } }],
      },
      { charges: { "read-1": 3 } },
    )
    const err = (await runUgcCreator(creatorNode({ source: "photo", gender: "man" }), { ugc: { photo: "https://cdn.example/p.png" } } as never, RUN, deps).catch((e: unknown) => e)) as Charged
    expect(err.message).toBe("R")
    expect(err.creditsUsed).toBe(3)
  })
  it("a failure before anything was charged carries nothing; a drain keeps its own identity", async () => {
    const early = stubDeps({ "/v1/ugc/creator": [{ status: 400, body: { error: { code: "validation_error", message: "bad" } } }] })
    const err = (await runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, early.deps).catch((e: unknown) => e)) as Charged
    expect(err.creditsUsed).toBeUndefined()
    const drained = new DrainAbortError()
    const drain = stubDeps(
      {
        "/v1/ugc/creator": [{ status: 200, body: sampled(7, { t: 1 }) }],
        "/v1/generate-image": [{ status: 200, body: { jobId: "img-1" } }],
      },
      { polled: { "img-1": drained } },
    )
    await expect(runUgcCreator(creatorNode(SAMPLED_DATA), INPUTS, RUN, drain.deps)).rejects.toBe(drained)
  })
  it("UGC Cards: a credits stop on one timing job carries the other's charge; a cards failure carries both", async () => {
    const PLAN_OUT = JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: {} })
    const cardsInputs = { ugc: { plan: PLAN_OUT, video: "https://cdn.example/v.mp4", transcript: "a b" }, clipNotes: [] } as never
    const cardsNode: SimpleNode = { id: "cards", type: "ugc-cards", data: { label: "UGC Cards" } }
    const stopped = stubDeps(
      {
        "GET /v1/ugc/categories": [{ status: 200, body: { categories: [] } }],
        "/v1/forced-alignment": [{ status: 402, body: { error: { code: "insufficient_credits", message: "Insufficient credits" }, required: 30, balance: 4 } }],
        "/v1/transcribe": [{ status: 200, body: { jobId: "tr-1" } }],
      },
      { polled: { "tr-1": { output: { json: { words: [] } }, creditsUsed: 22 } } },
    )
    const stop = (await runUgcCards(cardsNode, cardsInputs, RUN, stopped.deps).catch((e: unknown) => e)) as Charged
    expect(stop.errorCode).toBe("insufficient_credits")
    expect(stop.creditsUsed).toBe(22)
    const broken = stubDeps(
      {
        "GET /v1/ugc/categories": [{ status: 200, body: { categories: [] } }],
        "/v1/forced-alignment": [{ status: 200, body: { jobId: "al-1" } }],
        "/v1/transcribe": [{ status: 200, body: { jobId: "tr-1" } }],
        "/v1/ugc/cards": [{ status: 500, body: { error: { message: "boom" } } }],
      },
      { polled: { "al-1": { output: { alignment: [] }, creditsUsed: 30 }, "tr-1": { output: { json: { words: [] } }, creditsUsed: 22 } } },
    )
    const fail = (await runUgcCards(cardsNode, cardsInputs, RUN, broken.deps).catch((e: unknown) => e)) as Charged
    expect(fail.message).toBe("UGC step failed (500)")
    expect(fail.creditsUsed).toBe(52)
  })
})
