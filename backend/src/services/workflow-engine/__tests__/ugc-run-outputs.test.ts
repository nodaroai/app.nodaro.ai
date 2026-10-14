/**
 * What a server run hands the editor for each UGC node type: the node output a
 * finished (or, for a credits stop, failed) state carries.
 *
 * Each output is COMPUTED here by the code a run actually goes through — the
 * runners (`runUgcCreator`, `runUgcCards`) over stubbed calls, the job-row
 * reader (`buildNodeOutputFromJobData`) for UGC Script and UGC Clip, UGC
 * Clips' answer reader, the fan-out assembly, and the kept branch — and pinned
 * in `fixtures/ugc-run-outputs.json`. The editor's tests paint these same
 * outputs through every lane that lands a server run on the canvas, so a
 * change to what the server writes fails here first, and the editor's mapping
 * is re-checked against the new shape.
 */
import { describe, expect, it, vi } from "vitest"
import { ugcKeptOutputs } from "@nodaro/shared/ugc"
import { assembleFanOutResult, type FanOutIterationValue } from "../../../workers/fan-out-result.js"
import { buildNodeOutputFromJobData, fanOutIterationValue } from "../output-extractor.js"
import { runUgcCards, runUgcCreator, ugcSyncOutput, type UgcDeps } from "../ugc-sync-nodes.js"
import type { OrchestratorContext, SimpleNode } from "../types.js"
import pinned from "./fixtures/ugc-run-outputs.json"

type Reply = { status: number; body: unknown }
/** The runners' calls, answered by path in call order; a polled job by its id; a reading's charge by its id. */
function stubDeps(replies: Record<string, Reply[]>, polled: Record<string, { output: Record<string, unknown>; creditsUsed?: number } | Error> = {}, charges: Record<string, number> = {}): UgcDeps {
  const queue = Object.fromEntries(Object.entries(replies).map(([k, v]) => [k, [...v]]))
  const next = (key: string) => {
    const r = queue[key]?.shift()
    if (!r) throw new Error(`unexpected ${key}`)
    return { status: r.status, text: JSON.stringify(r.body) }
  }
  return {
    post: vi.fn(async (path: string) => next(path)),
    get: vi.fn(async (path: string) => next(`GET ${path}`)),
    poll: vi.fn(async (jobId: string) => {
      const r = polled[jobId]
      if (r instanceof Error) throw r
      return { jobId, output: r?.output ?? {}, creditsUsed: r?.creditsUsed }
    }),
    onJobCreated: vi.fn(),
    jobCharge: vi.fn(async (jobId: string) => charges[jobId] ?? 0),
  }
}
const RUN = { executionId: "exec-1", userId: "user-1", isAppRun: false } as unknown as OrchestratorContext
const CREATOR: SimpleNode = { id: "creator", type: "ugc-creator", data: { label: "UGC Creator", source: "sampled", gender: "woman", seed: 7, keepResult: false } }
const CARDS: SimpleNode = { id: "cards", type: "ugc-cards", data: { label: "UGC Cards" } }

const img = (m: string) => ({ tool: "generate_image", args: { prompt: "p", model: m, aspect_ratio: "3:4" } })
const [A, B, C] = [img("image-model-a"), img("image-model-b"), img("image-model-c")]
const CHECK = { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" }
const TWO = {
  kind: "sampled", seed: 7, gender: "woman", traits: { t: 1 }, identityImages: [], promptsVersion: "1.0.0", productCategory: "saas",
  image: { ...A, fallback: C }, candidates: [{ model: "image-model-a", ...A }, { model: "image-model-b", ...B }], fallback: C, pick: { how: "user" },
  realismPass: null, secondFrame: null, photoCheck: null, genderCheck: CHECK,
}
/** Both options drawn: the second image job's answer and the second reading vary per case. */
const draws = (readingB: string, imageB: Reply = { status: 200, body: { jobId: "img-b" } }) => ({
  "/v1/ugc/creator": [{ status: 200, body: TWO }],
  "/v1/generate-image": [{ status: 200, body: { jobId: "img-a" } }, imageB],
  "/v1/image-to-text/describe": [{ status: 200, body: { jobId: "read-a", generatedText: "PASS" } }, { status: 200, body: { jobId: "read-b", generatedText: readingB } }],
})
const IMAGES = { "img-a": { output: { imageUrl: "https://cdn.example/a.png" }, creditsUsed: 45 }, "img-b": { output: { imageUrl: "https://cdn.example/b.png" }, creditsUsed: 40 } }
const READINGS = { "read-a": 3, "read-b": 3 }
const creatorRun = (replies: Record<string, Reply[]>) => runUgcCreator(CREATOR, { ugc: { category: "saas" } } as never, RUN, stubDeps(replies, IMAGES, READINGS), { personPicks: true })

/** A kept creator's record, as a pick writes it. */
const KEPT = { v: 1, kind: "sampled", gender: "woman", identityImages: ["https://cdn.example/kept.png"], traits: { t: 1 }, seed: 7, promptsVersion: "1.0.0", productCategory: "saas" }
/** A finished UGC Script job's row. */
const SCRIPT_ROW = { plan: { hook: "h", beats: [{ line: "l" }], closer: { line: "c" } }, productCategory: "saas", warnings: [{ code: "w" }], notes: ["n"], rounds: 1 }
const KEPT_SCRIPT = { keepResult: true, result: { plan: { hook: "kept" }, productCategory: "saas", warnings: [], notes: [], rounds: 1 } }
const ticket = (i: number) => ({ v: 1, index: i, durationSec: 12, video: { tool: "t", args: {} } })
const CLIPS_ANSWER = { errors: [], tickets: [ticket(0), ticket(1)], sizedPlan: { hook: "h" }, transcript: "a b", speechCheckCall: { args: { language: "en" } }, hasCards: true }
/** A finished UGC Clip job's row, as the clip's worker completes it. */
const CLIP_ROW = (n: number) => ({ videoUrl: `https://cdn.example/c${n}.mp4`, durationSec: 12 + n, clipWarnings: n === 1 ? ["clip_lengthened:13"] : [], frameCheck: { passed: true } })
const CARDS_ANSWER = { layerPlan: [{ kind: "card" }], captionTiming: { hookText: "h", hookEndMs: 900, bodyEndMs: 12000, captions: [] }, report: { lines: ["No issues."] } }

async function computeOutputs(): Promise<Record<string, unknown>> {
  const pair = await creatorRun(draws("PASS"))
  const one = await creatorRun(draws("FAIL"))
  const noted = await creatorRun(draws("PASS", { status: 500, body: { error: { message: "boom" } } }))
  const stopped = (await creatorRun(draws("PASS", { status: 402, body: { error: { code: "insufficient_credits", message: "Insufficient credits" }, required: 18, balance: 5 } })).catch((e: unknown) => e)) as {
    errorCode?: string
    output?: unknown
  }
  const keptCreator = ugcKeptOutputs("ugc-creator", { keepResult: true, result: KEPT })
  const clipRun = (n: number): FanOutIterationValue => {
    const output = buildNodeOutputFromJobData(CLIP_ROW(n), "ugc-clip")
    return { index: n, result: { output, jobId: `clip-${n}`, creditsUsed: 412 }, resultValue: fanOutIterationValue(output, "ugc-clip") }
  }
  const fanOut = assembleFanOutResult([0, 1].map((n) => ({ status: "fulfilled" as const, value: clipRun(n) })), 2, "ugc-clip")
  const cards = await runUgcCards(
    CARDS,
    { ugc: { plan: JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: {} }), video: "https://cdn.example/v.mp4", transcript: "a b" }, clipNotes: [{ clip: 1, warnings: [], durationSec: 12 }] } as never,
    RUN,
    stubDeps(
      {
        "GET /v1/ugc/categories": [{ status: 200, body: { categories: [] } }],
        "/v1/forced-alignment": [{ status: 200, body: { jobId: "al-1" } }],
        "/v1/transcribe": [{ status: 200, body: { jobId: "tr-1" } }],
        "/v1/ugc/cards": [{ status: 200, body: CARDS_ANSWER }],
      },
      {
        "al-1": { output: { alignment: [{ word: "a", start: 0, end: 0.3 }] }, creditsUsed: 30 },
        "tr-1": { output: { json: { words: [{ text: "a", startMs: 0, endMs: 300 }] } }, creditsUsed: 22 },
      },
    ),
  )
  // A JSON round trip: what reaches the editor is the serialised state (an
  // `undefined` field is gone, exactly as over the stream and in node_states).
  return JSON.parse(
    JSON.stringify({
      "ugc-creator:pair": pair.output,
      "ugc-creator:one": one.output,
      "ugc-creator:one-noted": noted.output,
      "ugc-creator:kept": { ugcOutputs: keptCreator, imageUrl: keptCreator?.image },
      // A FAILED state's retained output: what the orchestrator copies off the rejection.
      "ugc-creator:stopped": { errorCode: stopped.errorCode, output: stopped.output },
      "ugc-script": buildNodeOutputFromJobData(SCRIPT_ROW, "ugc-script"),
      "ugc-script:kept": { ugcOutputs: ugcKeptOutputs("ugc-script", KEPT_SCRIPT) },
      "ugc-clips": ugcSyncOutput("ugc-clips", CLIPS_ANSWER),
      "ugc-clip": buildNodeOutputFromJobData(CLIP_ROW(0), "ugc-clip"),
      "ugc-clip:fan-out": fanOut.output,
      "ugc-cards": cards.output,
    }),
  )
}

describe("the node outputs a server run hands the editor for the UGC nodes", () => {
  it("are exactly the pinned fixture — a change here needs the editor's mapping re-checked", async () => {
    expect(await computeOutputs(), "update fixtures/ugc-run-outputs.json, then check the editor lands the new shape").toEqual(pinned)
  })
  it("the cases cover each UGC type and every creator outcome the editor paints", () => {
    expect(Object.keys(pinned).sort()).toEqual([
      "ugc-cards", "ugc-clip", "ugc-clip:fan-out", "ugc-clips", "ugc-creator:kept", "ugc-creator:one", "ugc-creator:one-noted",
      "ugc-creator:pair", "ugc-creator:stopped", "ugc-script", "ugc-script:kept",
    ])
  })
})
