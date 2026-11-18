// @test-watches backend/src/lib/mcp/__tests__/fixtures/deployment-amounts-quotes-mainline.json
/**
 * The quotes, listings, run reports and balance refusals of the MCP lane on a
 * deployment that shows its own unit (decided 2026-11-15): every figure in that
 * unit, never the platform's raw credits beside it; and where the deployment
 * manages the balance (no self-serve, or an external wallet), a refusal for want
 * of balance says so and never tells the user to top up, upgrade or buy.
 *
 * With nothing configured every reply is byte-identical to what it was before
 * the rule reached these tools: the replies are recorded in
 * `fixtures/deployment-amounts-quotes-mainline.json` and compared byte for
 * byte. Rewrite the recording only with a change that is meant to move what
 * such a deployment sees:
 *   cd backend && UPDATE_DEPLOYMENT_AMOUNTS_QUOTES=1 npx vitest run src/lib/mcp/__tests__/deployment-amounts-quotes.test.ts
 *
 * Every figure below is a distinctive raw credit figure that no converted
 * figure, id or timestamp can contain (checked first), so a reply can be held
 * to carry none of them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { usecaseEstimatePath } from "@nodaro/render-rules"
import { EVERY_SCOPE, EXECUTION_ID, JOB_ID, USER_ID, WORKFLOW_ID, serialized } from "./_amounts-harness.js"

const ENV_KEYS = ["NODARO_SURFACE_PROFILE", "NODARO_PRICE_ANNOTATIONS", "DEPLOYMENT_WALLET_URL", "DEPLOYMENT_WALLET_TOKEN", "DEPLOYMENT_WALLET_SSO_PROVIDER"] as const

vi.hoisted(() => {
  for (const key of ["NODARO_SURFACE_PROFILE", "NODARO_PRICE_ANNOTATIONS", "DEPLOYMENT_WALLET_URL", "DEPLOYMENT_WALLET_TOKEN", "DEPLOYMENT_WALLET_SSO_PROVIDER"]) {
    process.env[key] = ""
  }
})

const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  /** What the Retry's quote answers: covered, stopped by the app credits, or refused. */
  retry: "balance" as "balance" | "app-credits" | "refused",
}))

/** The UGC quotes the pricing module answers, one per item list (marked by its first label). */
const UGC_QUOTES = vi.hoisted(() => ({
  quote: {
    spent: [{ label: "generate-image (already spent)", credits: 2557 }],
    lines: [{ label: "clip 1", credits: 4363 }, { label: "reading", credits: 2579, estimate: true as const }],
    total: 9499,
    skipped: [] as string[],
    totalIsEstimate: true as const,
  },
  estimate: { spent: [] as Array<{ label: string; credits: number }>, lines: [{ label: "clip 1", credits: 3253 }], total: 3253, skipped: [] as string[] },
  worstCase: { spent: [] as Array<{ label: string; credits: number }>, lines: [{ label: "clip 1", credits: 5119 }, { label: "reading", credits: 2563 }], total: 7682, skipped: [] as string[] },
}))

vi.mock("../../supabase.js", async () => {
  const { fakeSupabaseFrom: from } = await import("./_amounts-harness.js")
  return { supabase: { from: from(() => h.tables), rpc: async () => ({ data: null, error: null }), auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } } } }
})
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => true }
})
vi.mock("../tools/_workflow-access.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, loadMcpWorkflow: async () => ({ ok: true, row: { name: "W" }, access: "owner" }) }
})
vi.mock("../../gallery-moderation.js", async (importOriginal) => {
  const orig = (await importOriginal()) as typeof import("../../gallery-moderation.js")
  return { ...orig, loadGalleryModeration: async () => orig.buildGalleryModeration([], []) }
})
// The UGC quote as the pricing module answers it, one per item list (marked by its first label).
vi.mock("../../../ee/lib/ugc-quote.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return {
    ...orig,
    buildUgcQuote: async (input: { items: Array<{ label?: string }> }) => UGC_QUOTES[input.items[0]?.label as keyof typeof UGC_QUOTES],
  }
})
// A pipeline the payer's balance cannot cover.
vi.mock("../../../ee/pipelines/create-pipeline.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, createPipeline: async () => ({ ok: false, status: 402, code: "insufficient_credits" }) }
})

const { buildMcpServer } = await import("../server.js")
const { callTool } = await import("../tools/__tests__/_helpers.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
const { setLlmMeteredSchemaReadyForTesting } = await import("../../llm-metered-schema-gate.js")
setLlmMeteredSchemaReadyForTesting(true)

const here = dirname(fileURLToPath(import.meta.url))
const MAINLINE_FIXTURE = resolve(here, "fixtures/deployment-amounts-quotes-mainline.json")

// ── the fixed answers (raw credits) ─────────────────────────────────────────

const RUN_ID = "f1111111-1111-4111-8111-111111111111"
const RECAST_ID = "b2222222-2222-4222-8222-222222222222"
const DRAFT_JOB_ID = "c3333333-3333-4333-8333-333333333333"
const PIPELINE_ID = "d4444444-4444-4444-8444-444444444444"
const FAILED_JOB_ID = "e5555555-5555-4555-8555-555555555555"

const RENDER_FINAL = {
  renderNodeId: "render-1",
  nodeIds: ["render-1", "cam-1"],
  inputOverrides: { "render-1": { quality: "final" } },
  estimatedCredits: 7351,
  holdCredits: 7643,
  sufficient: false,
  available: 6829,
}
const RETRY = { estimatedCredits: 5173, available: 4919, appCreditsAllowance: 3167 }
const RETRY_REFUSAL = "Insufficient credits. Required: 5381, Available: 4919"
const APP_RUN_REFUSAL = "Insufficient credits. Required: 5791, Available: 4919"
const COMPONENT_REFUSAL = "Insufficient credits. Required: 6197, Available: 4919"
const WORKFLOW_REFUSAL = "Insufficient credits. Required: 6359, Available: 4919"
const APP_LISTING = { estimated_credits: 3571, per_minute_credits: 2593, per_item_credits: 2417, max_estimated_credits: 5939, max_per_minute_credits: 2683, max_per_item_credits: 2909 }
const COMPONENT_LISTING = { estimated_credits: 3797, per_minute_credits: 2647, per_item_credits: 2551, max_estimated_credits: 6173, max_per_minute_credits: 2789, max_per_item_credits: 2953 }
const CAST_SWAP = { totalCredits: 8317, expectedCredits: 7529, breakdown: { base: 2539, motion: 4987, references: 2791 }, privacyCredits: 2861, engine: "nodaro-prism", settlesLower: false }
const FULL_QUALITY = { kind: "same-take", totalCredits: 6971, breakdown: { base: 2267, motionHd: 4703 }, availableUntil: "2026-11-22T00:00:00Z" }
const TREND = { expectedCredits: 5413, holdCredits: 6247, breakdown: { base: 2711, motion: 2699 }, privacyCredits: 2843 }
const RECAST = {
  totalCredits: 8760,
  breakdown: { generation: 6257, planning: 2503 },
  renderMethod: "keyframes",
  segmentDurations: [8, 7],
  candidateCredits: 3343,
  castVersionCredits: 2617,
  sheetCredits: 2731,
  anchorCandidateCredits: 3911,
  musicCandidateCredits: 3019,
}
const FAILED_JOB_CREDITS = 3833
const PIPELINE = { spent_credits: 4271, reserved_credits: 2851, upfront_credit_estimate: 7013 }
const USE_CASE = { totalCredits: 8963, stepsCredits: 7737, feeCredits: 1226, durationSec: 3600 }
const PODCAST_PACK = { tools: ["tighten-episode", "episode-chapters"], durationSec: 3600, units: 240, credits: 6427 }

/** Each reply and the raw figures it states (each must be there with nothing configured, converted with a unit). */
const FIGURES: Record<string, readonly number[]> = {
  render_final_quote: [RENDER_FINAL.estimatedCredits, RENDER_FINAL.holdCredits, RENDER_FINAL.available],
  render_final_confirm: [RENDER_FINAL.estimatedCredits],
  retry_quote: [RETRY.estimatedCredits, RETRY.available],
  retry_quote_app_credits: [RETRY.estimatedCredits, RETRY.appCreditsAllowance],
  retry_confirm: [RETRY.estimatedCredits],
  list_apps: Object.values(APP_LISTING),
  list_components: Object.values(COMPONENT_LISTING),
  video_remake_quote: [CAST_SWAP.totalCredits, CAST_SWAP.expectedCredits, ...Object.values(CAST_SWAP.breakdown), CAST_SWAP.privacyCredits],
  estimate_full_quality: [FULL_QUALITY.totalCredits, ...Object.values(FULL_QUALITY.breakdown)],
  full_quality_quote: [FULL_QUALITY.totalCredits, ...Object.values(FULL_QUALITY.breakdown)],
  estimate_trend: [TREND.expectedCredits, TREND.holdCredits, ...Object.values(TREND.breakdown), TREND.privacyCredits],
  run_trend_quote: [TREND.expectedCredits, TREND.holdCredits, ...Object.values(TREND.breakdown), TREND.privacyCredits],
  start_recast_quote: [RECAST.totalCredits, ...Object.values(RECAST.breakdown), RECAST.candidateCredits, RECAST.castVersionCredits, RECAST.sheetCredits, RECAST.anchorCandidateCredits, RECAST.musicCandidateCredits],
  start_recast_confirm: [RECAST.totalCredits],
  build_ugc_clips: Object.values(UGC_QUOTES).flatMap((q) => [q.total, ...q.spent.map((l) => l.credits), ...q.lines.map((l) => l.credits)]),
  diagnose_run: [FAILED_JOB_CREDITS],
  get_pipeline_status: Object.values(PIPELINE),
  estimate_use_case: [USE_CASE.totalCredits, USE_CASE.stepsCredits, USE_CASE.feeCredits],
  make_podcast_pack_quote: [PODCAST_PACK.credits],
}
/** The refusals for want of balance, and the raw figures a route wrote into them. */
const REFUSALS: Record<string, readonly number[]> = {
  retry_402: [5381, 4919],
  run_app_402: [5791],
  run_component_402: [6197],
  run_workflow_402: [6359],
  start_pipeline_402: [],
}
/** The replies that tell the model what to do when the balance cannot cover the run. */
const CANNOT_COVER = ["render_final_quote", "retry_quote", "retry_quote_app_credits"] as const

const ALL_RAW = [...new Set([...Object.values(FIGURES).flat(), ...Object.values(REFUSALS).flat()])]

const RATE = 0.25
const converted = (n: number) => String(Math.round(n * RATE * 100) / 100)
const tokenRe = (s: string) => new RegExp(`(?<![\\d.])${s.replace(".", "\\.")}(?![\\d])`)
const rawIn = (text: string) => ALL_RAW.filter((n) => tokenRe(String(n)).test(text))

const UNIT = { unitLabel: "points", unitLabels: { he: "נקודות" }, unitRate: RATE, unitDecimals: 2 }

// ── the routes the tools call ───────────────────────────────────────────────

const refusal402 = (message: string) => ({ error: { code: "insufficient_credits", message } })

async function stubRoutes(): Promise<FastifyInstance> {
  const f = Fastify()
  f.post("/v1/workflows/:id/render-final/estimate", async () => ({ data: RENDER_FINAL }))
  // Render final's run (it names renderFinal) starts; any other run of a workflow is refused for want of balance.
  f.post("/v1/workflows/:id/run", async (req, reply) =>
    (req.body as { renderFinal?: unknown }).renderFinal ? reply.code(202).send({ executionId: EXECUTION_ID }) : reply.code(402).send(refusal402(WORKFLOW_REFUSAL)),
  )
  f.post("/v1/app/:slug/run", async (_req, reply) => reply.code(402).send(refusal402(APP_RUN_REFUSAL)))
  f.post("/v1/app/:slug/runs/:runId/resume", async (req, reply) => {
    const dryRun = (req.body as { dryRun?: boolean }).dryRun === true
    if (h.retry === "refused") return reply.code(402).send(refusal402(RETRY_REFUSAL))
    if (!dryRun) return reply.code(202).send({ executionId: EXECUTION_ID, nodeIds: ["n2"] })
    return {
      data: {
        runId: RUN_ID,
        steps: [{ nodeId: "n2", type: "generate-video", label: "Clip" }],
        estimatedCredits: RETRY.estimatedCredits,
        reusedClips: 0,
        sufficient: false,
        available: RETRY.available,
        ...(h.retry === "app-credits" ? { appCreditsAllowance: RETRY.appCreditsAllowance } : {}),
        appVersion: 3,
      },
    }
  })
  f.post("/v1/component/execute", async (_req, reply) => reply.code(402).send(refusal402(COMPONENT_REFUSAL)))
  f.post("/v1/video-remake/estimate", async () => ({ data: CAST_SWAP }))
  f.post("/v1/video-remake/:jobId/full-quality/estimate", async () => ({ data: FULL_QUALITY }))
  f.post("/v1/trends/:slug/estimate", async () => ({ data: TREND }))
  f.post("/v1/recast/estimate", async () => RECAST)
  f.post("/v1/recast", async () => ({ recastId: "rc-1" }))
  f.patch("/v1/workflows/:id", async () => ({ ok: true }))
  f.post("/v1/ugc/clips", async () => ({
    clips: [{ index: 1 }],
    quoteItems: [{ label: "quote", tool: "generate_video", args: {}, count: 1 }],
    estimateQuoteItems: [{ label: "estimate", tool: "generate_video", args: {}, count: 1 }],
    worstCaseQuoteItems: [{ label: "worstCase", tool: "generate_video", args: {}, count: 1 }],
  }))
  f.post(usecaseEstimatePath("tighten-episode"), async () => ({ data: USE_CASE }))
  f.post("/v1/podcast-pack/estimate", async () => ({ data: PODCAST_PACK }))
  await f.ready()
  return f
}

const listing = (figures: Record<string, number>) => [{ id: "app-1", slug: "zebrify", name: "Zebrify", description: "d", icon_url: null, category: "fun", output_types: ["image"], tags: [], total_run_count: 3, favorite_count: 1, created_at: "2026-11-01T00:00:00Z", ...figures }]

/** Every reply under test, keyed by case, as the client receives it — and the results themselves. */
async function replies(): Promise<{ text: Record<string, string>; raw: Record<string, { structuredContent?: unknown; content?: unknown }> }> {
  const fastify = await stubRoutes()
  const s = await buildMcpServer({ userId: USER_ID, scopes: EVERY_SCOPE, clientName: "Claude", fastify, conversation: { client: "claude", key: null } })
  const raw: Record<string, { structuredContent?: unknown; content?: unknown }> = {}
  const call = async (key: string, tool: string, args: Record<string, unknown>) => {
    raw[key] = await callTool(s, tool, args)
  }
  h.tables = {}
  await call("render_final_quote", "render_final", { workflow_id: WORKFLOW_ID, render_node_id: "render-1", execution_id: EXECUTION_ID })
  await call("render_final_confirm", "render_final", { workflow_id: WORKFLOW_ID, render_node_id: "render-1", execution_id: EXECUTION_ID, confirm: true })
  h.retry = "balance"
  await call("retry_quote", "retry_app_run", { slug: "zebrify", run_id: RUN_ID })
  await call("retry_confirm", "retry_app_run", { slug: "zebrify", run_id: RUN_ID, confirm: true })
  h.retry = "app-credits"
  await call("retry_quote_app_credits", "retry_app_run", { slug: "zebrify", run_id: RUN_ID })
  h.retry = "refused"
  await call("retry_402", "retry_app_run", { slug: "zebrify", run_id: RUN_ID })
  h.retry = "balance"
  h.tables = { published_apps: listing(APP_LISTING) }
  await call("list_apps", "list_apps", { scope: "public" })
  await call("run_app_402", "run_app", { slug: "zebrify" })
  h.tables = { published_apps: listing(COMPONENT_LISTING) }
  await call("list_components", "list_components", { scope: "public" })
  await call("run_component_402", "run_component", { component_id: "face-prep" })
  h.tables = {}
  await call("run_workflow_402", "run_workflow", { workflow_id: WORKFLOW_ID })
  await call("video_remake_quote", "video_remake", { video_url: "https://cdn.example/clip.mp4", roles: [{ kind: "person", name: "the woman", images: ["https://cdn.example/a.png"] }] })
  await call("estimate_full_quality", "estimate_full_quality", { job_id: DRAFT_JOB_ID })
  await call("full_quality_quote", "full_quality", { job_id: DRAFT_JOB_ID })
  await call("estimate_trend", "estimate_trend", { slug: "zebra-walk", slots: { person: { images: ["https://cdn.example/a.png"] } } })
  await call("run_trend_quote", "run_trend", { slug: "zebra-walk", slots: { person: { images: ["https://cdn.example/a.png"] } } })
  h.tables = { workflows: [{ id: RECAST_ID, user_id: USER_ID, settings: { recast: { analysis: { jobId: JOB_ID } } } }] }
  await call("start_recast_quote", "start_recast", { recast_id: RECAST_ID, interactive: true })
  await call("start_recast_confirm", "start_recast", { recast_id: RECAST_ID, interactive: true, confirm: true })
  h.tables = {}
  await call("build_ugc_clips", "build_ugc_clips", { plan: { scenes: [] }, gender: "woman", identity_images: ["https://cdn.example/face.png"] })
  h.tables = {
    jobs: [{ id: FAILED_JOB_ID, status: "failed", error_message: "the provider failed", error_detail: null, input_data: { type: "generate-image", provider: "p" }, credits_actual: FAILED_JOB_CREDITS, output_data: null, job_type: "generate-image", user_id: USER_ID, workflow_execution_id: null }],
  }
  await call("diagnose_run", "diagnose_run", { id: FAILED_JOB_ID })
  h.tables = { pipelines: [{ id: PIPELINE_ID, status: "running", current_stage: "script", ...PIPELINE, mode: "auto", failure_reason: null, current_progress_message: null, user_id: USER_ID }] }
  await call("get_pipeline_status", "get_pipeline_status", { pipeline_id: PIPELINE_ID })
  h.tables = {}
  await call("start_pipeline_402", "start_pipeline", { story_prompt: "a cat in space" })
  await call("estimate_use_case", "estimate_use_case", { node_type: "tighten-episode", input: { media_url: "https://cdn.example/ep.mp4" } })
  await call("make_podcast_pack_quote", "make_podcast_pack", { media_url: "https://cdn.example/ep.mp4", tools: { "tighten-episode": {}, "episode-chapters": {} }, estimate_only: true })
  h.tables = {}
  const text = Object.fromEntries(Object.entries(raw).map(([k, r]) => [k, serialized(r)]))
  return { text, raw }
}

function useProfile(billing: Record<string, unknown>): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ billing })
  __resetSurfaceProfileCacheForTests()
}

beforeEach(() => {
  h.tables = {}
  h.retry = "balance"
})

afterEach(() => {
  for (const key of ENV_KEYS) process.env[key] = ""
  __resetSurfaceProfileCacheForTests()
  h.tables = {}
})

describe("the figures are distinguishable", () => {
  it("no raw figure can be read inside a converted one, an id or a timestamp", () => {
    const convertedText = ALL_RAW.map(converted).join(" ")
    expect(rawIn(convertedText)).toEqual([])
    expect(rawIn([RUN_ID, RECAST_ID, DRAFT_JOB_ID, PIPELINE_ID, FAILED_JOB_ID, JOB_ID, EXECUTION_ID, WORKFLOW_ID, USER_ID, FULL_QUALITY.availableUntil, "2026-11-01T00:00:00Z"].join(" "))).toEqual([])
    expect(new Set(ALL_RAW).size).toBe(ALL_RAW.length)
  })
})

describe("nothing configured: every reply exactly as before", () => {
  it("answers the recorded bytes, and each reply states its own raw figures", async () => {
    const { text } = await replies()
    if (process.env.UPDATE_DEPLOYMENT_AMOUNTS_QUOTES === "1") {
      mkdirSync(dirname(MAINLINE_FIXTURE), { recursive: true })
      writeFileSync(MAINLINE_FIXTURE, `${JSON.stringify(text, null, 2)}\n`)
    }
    const recorded = JSON.parse(readFileSync(MAINLINE_FIXTURE, "utf8")) as Record<string, string>
    expect(text).toEqual(recorded)
    // The recording is of real answers: each tool did read its fixed quote (not a refusal of the call itself).
    for (const [key, figures] of Object.entries({ ...FIGURES, ...REFUSALS })) {
      for (const n of figures) expect(text[key], `${key} states ${n}`).toMatch(tokenRe(String(n)))
    }
    for (const key of Object.keys(FIGURES)) expect(text[key], key).not.toContain('"isError":true')
    for (const key of Object.keys(REFUSALS)) expect(text[key], key).toContain('"isError":true')
  })
})

describe("a deployment with its own unit: every figure in that unit, none raw", () => {
  it("states each figure converted, names the unit, and never the raw figure or the rate", async () => {
    useProfile(UNIT)
    const { text, raw } = await replies()
    for (const [key, figures] of Object.entries(FIGURES)) {
      const reply = text[key]!
      expect(reply, key).not.toContain('"isError":true')
      expect(rawIn(reply), `${key} carries raw figures`).toEqual([])
      for (const n of figures) expect(reply, `${key} states ${n} as ${converted(n)}`).toMatch(tokenRe(converted(n)))
      expect(reply, `${key} names the unit`).toContain("points")
      expect(reply, `${key} never states the rate`).not.toMatch(/(?<![\d.])0\.25(?![\d])/)
    }
    for (const key of Object.keys(REFUSALS)) {
      const reply = text[key]!
      expect(reply, key).toContain('"isError":true')
      expect(rawIn(reply), `${key} carries raw figures`).toEqual([])
      // Self-serve: the refusal is in the unit's word and states no figure.
      expect(reply, key).toMatch(/insufficient points/)
    }
    // A figure that is not an amount stays as it is: the recast's part lengths are seconds.
    const recast = raw.start_recast_quote!.structuredContent as { quote: { segmentDurations: number[] } }
    expect(recast.quote.segmentDurations).toEqual(RECAST.segmentDurations)
    // Self-serve: what to do when the balance cannot cover it keeps its advice,
    // in the unit's word, since the sentence states figures.
    expect(text.render_final_quote).toContain("The user's points cannot cover it")
    expect(text.render_final_quote).toContain("added points")
    expect(text.render_final_quote).not.toMatch(/\bcredits\b/)
  })
})

describe("a deployment that manages the balance: ask its operator, never top up", () => {
  it("says the balance is managed by the deployment in every refusal and every cannot-cover answer", async () => {
    useProfile({ ...UNIT, selfServe: false })
    const { text } = await replies()
    for (const key of [...CANNOT_COVER, ...Object.keys(REFUSALS)]) {
      const reply = text[key]!
      expect(reply, key).toContain("managed by this deployment")
      expect(reply, key).not.toMatch(/added credits|earned app credits|insufficient credits/i)
    }
    for (const [key, reply] of Object.entries(text)) {
      expect(reply, key).not.toMatch(/\btop(?:-| )?up\b|\bupgrad|\bbuy\b/i)
      expect(rawIn(reply), `${key} carries raw figures`).toEqual([])
    }
  })
})
