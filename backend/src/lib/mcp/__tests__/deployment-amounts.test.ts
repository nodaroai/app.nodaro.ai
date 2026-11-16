// @test-watches backend/src/lib/mcp/__tests__/fixtures/deployment-amounts-mainline.json frontend/src/nodes/** backend/src/nodes/**
/**
 * What the MCP lane says about credits, used or left, on a deployment that
 * shows its own unit (decided 2026-11-15): every figure in that unit and from
 * that deployment's own balance, never the platform's raw credits beside it.
 *
 * With nothing configured (no unit, no external wallet, self-serve on) every
 * reply is byte-identical to what it was before the rule existed: the replies
 * are recorded in `fixtures/deployment-amounts-mainline.json` and compared
 * byte for byte. Rewrite the recording only with a change that is meant to
 * move what such a deployment sees:
 *   cd backend && UPDATE_DEPLOYMENT_AMOUNTS=1 npx vitest run src/lib/mcp/__tests__/deployment-amounts.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  DEFAULT_TABLES, EVERY_SCOPE, EXECUTION_ID, JOB_CHARGE, JOB_ID, PRICED_CREDITS, PRICED_ID, PUBLIC_JOB_ROW, USER_ID, WORKFLOW_ID,
  ALLOWANCE, BALANCE, JOB_ROW, PURCHASE_ROW, USAGE_ROW, WALLET_AVAILABLE, rawFiguresIn, serialized, stubRoutes, type TableRows,
} from "./_amounts-harness.js"

vi.hoisted(() => {
  for (const key of ["NODARO_SURFACE_PROFILE", "NODARO_PRICE_ANNOTATIONS", "DEPLOYMENT_WALLET_URL", "DEPLOYMENT_WALLET_TOKEN", "DEPLOYMENT_WALLET_SSO_PROVIDER"]) {
    process.env[key] = ""
  }
})

const h = vi.hoisted(() => ({
  tables: {} as Record<string, unknown[]>,
  /** The SSO identity an external wallet reads a user's balance by (app_metadata, set by the server). */
  ssoUser: null as null | { app_metadata: Record<string, unknown> },
  /** The fake wallet client's balance read: never a real wallet. */
  readWallet: (async () => 0) as (...args: unknown[]) => Promise<number>,
  allowance: null as null | { granted: number; remaining: number; spent: number },
}))

vi.mock("../../supabase.js", async () => {
  const { fakeSupabaseFrom: from } = await import("./_amounts-harness.js")
  return { supabase: { from: from(() => h.tables), rpc: async () => ({ data: null, error: null }), auth: { admin: { getUserById: async () => ({ data: { user: h.ssoUser }, error: null }) } } } }
})
vi.mock("../../../ee/billing/external-wallet-client.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, readWalletBalance: (...args: unknown[]) => h.readWallet(...args) }
})
vi.mock("../../../ee/billing/deployment-allowance-service.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, allowanceFor: async () => h.allowance }
})
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => true }
})
vi.mock("../../job-credit-status.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  const { JOB_CHARGE: charge } = await import("./_amounts-harness.js")
  return { ...orig, runCreditsFor: async () => new Map(), publicCreditFieldsOf: () => ({ ...charge }) }
})
vi.mock("../../pricing/charged-prices.js", async () => {
  const { PRICED_ID: id, PRICED_CREDITS: credits } = await import("./_amounts-harness.js")
  return { loadChargedPrices: async () => ({ credits: (x: string) => (x === id ? credits : undefined), rate: () => undefined, llmQuote: () => null }) }
})
vi.mock("../tools/_workflow-access.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, loadMcpWorkflow: async () => ({ ok: true, row: { name: "W" }, access: "owner" }) }
})
vi.mock("../../gallery-moderation.js", async (importOriginal) => {
  const orig = (await importOriginal()) as typeof import("../../gallery-moderation.js")
  return { ...orig, loadGalleryModeration: async () => orig.buildGalleryModeration([], []) }
})

const { buildMcpServer } = await import("../server.js")
const { callTool } = await import("../tools/__tests__/_helpers.js")
const { errorResult } = await import("../tools/_verb-helpers.js")
const { failureGuidance } = await import("../tools/_job-error.js")
const { CreditsService } = await import("../../../ee/billing/credits.js")
const { statedPrices } = await import("../../../ee/billing/stated-prices.js")
const { __resetSurfaceProfileCacheForTests } = await import("../../surface-profile.js")
const { __setDeploymentPayerForTests, __resetDeploymentPayerForTests } = await import("../../deployment-payer.js")
const { listTools } = await import("../tools/__tests__/_helpers.js")
const { setLlmMeteredSchemaReadyForTesting } = await import("../../llm-metered-schema-gate.js")
setLlmMeteredSchemaReadyForTesting(true)

const getBalance = vi.spyOn(CreditsService, "getBalance")

const here = dirname(fileURLToPath(import.meta.url))
const MAINLINE_FIXTURE = resolve(here, "fixtures/deployment-amounts-mainline.json")

async function server(fastify: FastifyInstance = Fastify()) {
  return buildMcpServer({ userId: USER_ID, scopes: EVERY_SCOPE, clientName: "Claude", fastify, conversation: { client: "claude", key: null } })
}

const digest = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")} (${s.length} bytes)`

/** Every reply the rule governs, keyed by case, as the client receives it. */
async function replies(tables: TableRows = DEFAULT_TABLES): Promise<Record<string, string>> {
  h.tables = tables
  const fastify = await stubRoutes({ useCaseRefusal: { status: 402, message: "This episode is estimated at about 8467 credits; your balance is 7919.", required: 8467, balance: 7919 } })
  const s = await server(fastify)
  const out: Record<string, string> = {}
  out.check_balance = serialized(await callTool(s, "check_balance", {}))
  out.credit_transactions = serialized(await callTool(s, "credit_transactions", { limit: 5 }))
  out.get_job = serialized(await callTool(s, "get_job", { job_id: JOB_ID }))
  out.get_asset = serialized(await callTool(s, "get_asset", { job_id: JOB_ID }))
  out.list_jobs = serialized(await callTool(s, "list_jobs", { types: ["tighten-episode"] }))
  h.tables = { ...tables, jobs: [PUBLIC_JOB_ROW] }
  out.list_jobs_public = serialized(await callTool(s, "list_jobs", { scope: "public" }))
  h.tables = tables
  out.list_models_price_ids = serialized(await callTool(s, "list_models", { priceIds: [PRICED_ID, "not-a-price-id"] }))
  out.list_models_video = digest(serialized(await callTool(s, "list_models", { kind: "video" })))
  out.estimate_use_case = serialized(await callTool(s, "estimate_use_case", { node_type: "tighten-episode", input: { media_url: "https://cdn.example/ep.mp4" } }))
  out.tighten_episode_402 = serialized(await callTool(s, "tighten_episode", { media_url: "https://cdn.example/ep.mp4" }))
  out.render_final_quote = serialized(await callTool(s, "render_final", { workflow_id: WORKFLOW_ID, render_node_id: "render-1", execution_id: EXECUTION_ID }))
  out.error_402 = serialized(errorResult(402, JSON.stringify({ error: { code: "insufficient_credits", message: "Insufficient credits. Required: 8467, Available: 7919" } })))
  out.credits_guidance = JSON.stringify(failureGuidance({ error_message: "x", error_hint: { kind: "credits", code: "user_allowance_exceeded" } }))
  return out
}

beforeEach(() => {
  getBalance.mockReset()
  getBalance.mockResolvedValue({ ...BALANCE } as never)
})

afterEach(() => {
  h.tables = {}
  h.ssoUser = null
  h.allowance = null
  setProfile(null)
  setWallet(false)
  __resetDeploymentPayerForTests()
})

const PAYER_ID = "70000000-0000-4000-8000-000000000007"
/** The deployment's unit in these cases: 0.25 points per credit, two decimals. */
const UNIT = { unitLabel: "points", unitLabels: { he: "נקודות" }, unitRate: 0.25, unitDecimals: 2 }
const points = (credits: number) => Math.round(credits * 0.25 * 100) / 100

function setProfile(billing: Record<string, unknown> | null) {
  if (billing) process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ billing })
  else process.env.NODARO_SURFACE_PROFILE = ""
  __resetSurfaceProfileCacheForTests()
}
function setWallet(on: boolean) {
  process.env.DEPLOYMENT_WALLET_URL = on ? "https://wallet.example.test/v1" : ""
  process.env.DEPLOYMENT_WALLET_TOKEN = on ? "test-only" : ""
  process.env.DEPLOYMENT_WALLET_SSO_PROVIDER = on ? "partner" : ""
}
/** A deployment with an external wallet: it needs a single payer, and allowances off. */
function walletDeployment() {
  __setDeploymentPayerForTests(PAYER_ID)
  setWallet(true)
  h.ssoUser = { app_metadata: { sso: "partner", sso_subject: "subject-1" } }
}

const dataOf = (res: { content?: Array<{ text?: string }> }) => (JSON.parse(res.content?.[0]?.text ?? "{}") as { data: Record<string, unknown> }).data
const NO_RATE = /0\.25/

const MANAGED = "This balance is managed by the deployment: it cannot be topped up, bought or upgraded here. For more, the user asks the deployment's operator."
const UNAVAILABLE = "The balance could not be read just now: it is unknown, not 0. Do not tell the user they have nothing left; try again shortly."

describe("check_balance on a deployment in its own terms", () => {
  it("a unit and an external wallet: the wallet's amount in the unit, no plan fields, no raw figure", async () => {
    setProfile({ ...UNIT, selfServe: false })
    walletDeployment()
    h.readWallet = async () => WALLET_AVAILABLE
    const res = await callTool(await server(), "check_balance", {})
    expect(res.isError).toBeUndefined()
    expect(dataOf(res)).toEqual({
      unit: "points", unitLabels: { he: "נקודות" }, decimals: 2,
      source: "external_wallet", available: points(WALLET_AVAILABLE),
      managedBy: "deployment", note: MANAGED,
    })
    expect(rawFiguresIn(serialized(res))).toEqual([])
    expect(serialized(res)).not.toMatch(NO_RATE)
    // The platform's own balance read is not what answers.
    expect(serialized(res)).not.toContain('"tier"')
  })

  it("an external wallet with self-serve left on still leaves the plan fields out", async () => {
    setProfile({ ...UNIT })
    walletDeployment()
    h.readWallet = async () => WALLET_AVAILABLE
    const data = dataOf(await callTool(await server(), "check_balance", {}))
    expect(data).toMatchObject({ source: "external_wallet", available: points(WALLET_AVAILABLE), managedBy: "deployment" })
    for (const key of ["tier", "effectiveTier", "subscription", "topup", "monthlyAllocation", "dailyLimit", "features", "periodEnd"]) expect(data).not.toHaveProperty(key)
  })

  it("a wallet that can not be read: unavailable, never 0, never the platform's balance in its place", async () => {
    setProfile({ ...UNIT, selfServe: false })
    walletDeployment()
    h.readWallet = async () => {
      throw new Error("wallet down")
    }
    const res = await callTool(await server(), "check_balance", {})
    const data = dataOf(res)
    expect(data.available).toBeNull()
    expect(data.note).toBe(`${UNAVAILABLE} ${MANAGED}`)
    expect(rawFiguresIn(serialized(res))).toEqual([])
    expect(serialized(res)).not.toContain(`"available": 0`)
  })

  it("a wallet with no unit: the wallet's amount in credits, plan fields out", async () => {
    walletDeployment()
    h.readWallet = async () => WALLET_AVAILABLE
    const data = dataOf(await callTool(await server(), "check_balance", {}))
    expect(data).toEqual({ unit: "credits", source: "external_wallet", available: WALLET_AVAILABLE, managedBy: "deployment", note: MANAGED })
  })

  it("a unit and an allowance: granted and remaining in the unit", async () => {
    setProfile({ ...UNIT, selfServe: false })
    __setDeploymentPayerForTests(PAYER_ID)
    h.allowance = { ...ALLOWANCE }
    const res = await callTool(await server(), "check_balance", {})
    expect(dataOf(res)).toEqual({
      unit: "points", unitLabels: { he: "נקודות" }, decimals: 2,
      source: "allowance", available: points(ALLOWANCE.remaining),
      allowance: { granted: points(ALLOWANCE.granted), remaining: points(ALLOWANCE.remaining), enforced: false },
      managedBy: "deployment", note: MANAGED,
    })
    expect(rawFiguresIn(serialized(res))).toEqual([])
    expect(serialized(res)).not.toMatch(NO_RATE)
  })

  it("an allowance with self-serve left on: the plan's own fields stay beside it, none of the frozen pools", async () => {
    setProfile({ ...UNIT })
    __setDeploymentPayerForTests(PAYER_ID)
    h.allowance = { ...ALLOWANCE }
    const res = await callTool(await server(), "check_balance", {})
    expect(dataOf(res)).toEqual({
      unit: "points", unitLabels: { he: "נקודות" }, decimals: 2,
      source: "allowance", available: points(ALLOWANCE.remaining),
      allowance: { granted: points(ALLOWANCE.granted), remaining: points(ALLOWANCE.remaining), enforced: false },
      tier: "pro", effectiveTier: "pro", features: BALANCE.features, periodEnd: BALANCE.periodEnd,
    })
    expect(rawFiguresIn(serialized(res))).toEqual([])
  })

  it("an allowance that can not be read: unavailable, never the frozen signup balance in its place", async () => {
    setProfile({ ...UNIT, selfServe: false })
    __setDeploymentPayerForTests(PAYER_ID)
    h.allowance = null
    const res = await callTool(await server(), "check_balance", {})
    const data = dataOf(res)
    expect(data).toMatchObject({ source: "allowance", available: null, allowance: null })
    expect(rawFiguresIn(serialized(res))).toEqual([])
  })

  it("a unit only (self-serve on): the balance and the plan's figures in the unit, the plan kept", async () => {
    setProfile({ ...UNIT })
    const res = await callTool(await server(), "check_balance", {})
    expect(dataOf(res)).toEqual({
      unit: "points", unitLabels: { he: "נקודות" }, decimals: 2,
      source: "balance", available: points(BALANCE.total),
      dailySpent: points(BALANCE.dailySpent),
      subscription: points(BALANCE.subscription), topup: points(BALANCE.topup),
      dailyLimit: points(BALANCE.dailyLimit), monthlyAllocation: points(BALANCE.monthlyAllocation),
      appCreditsAllowance: points(BALANCE.appCreditsAllowance),
      tier: "pro", effectiveTier: "pro", features: BALANCE.features, periodEnd: BALANCE.periodEnd,
    })
    expect(rawFiguresIn(serialized(res))).toEqual([])
    expect(serialized(res)).not.toMatch(NO_RATE)
  })

  it("no self-serve and no unit: the balance in credits, the platform's plans left out", async () => {
    setProfile({ selfServe: false })
    const data = dataOf(await callTool(await server(), "check_balance", {}))
    expect(data).toEqual({ unit: "credits", source: "balance", available: BALANCE.total, dailySpent: BALANCE.dailySpent, managedBy: "deployment", note: MANAGED })
  })

  it("the billing account's programmatic session is still refused, before any read", async () => {
    setProfile({ ...UNIT, selfServe: false })
    walletDeployment()
    const s = await buildMcpServer({ userId: PAYER_ID, scopes: EVERY_SCOPE, clientName: "Claude", fastify: Fastify() })
    const res = await callTool(s, "check_balance", {})
    expect(res.isError).toBe(true)
    expect(res.content[0]?.text).toBe("Error: payer_balance_jwt_only — the deployment balance is available to the billing account's own session only.")
    expect(getBalance).not.toHaveBeenCalled()
  })

  it("the billing account's own first-party session reads its pool as REST answers it: raw credits, unchanged", async () => {
    setProfile({ ...UNIT, selfServe: false })
    __setDeploymentPayerForTests(PAYER_ID)
    const s = await buildMcpServer({ userId: PAYER_ID, scopes: EVERY_SCOPE, clientName: "Copilot", fastify: Fastify(), firstParty: true })
    const data = dataOf(await callTool(s, "check_balance", {}))
    expect(data).toEqual(BALANCE)
  })
})

describe("what a run, a quote and a history row cost, in the unit", () => {
  beforeEach(() => setProfile({ ...UNIT }))

  it("get_job: the hold and the charge, in the text and the envelope, and the job data's own figures", async () => {
    h.tables = DEFAULT_TABLES
    const res = await callTool(await server(), "get_job", { job_id: JOB_ID })
    const text = JSON.parse(res.content[0]!.text!) as { data: Record<string, unknown>; unit?: string }
    expect(text.unit).toBe("points")
    expect(text.data).toMatchObject({
      credits: points(JOB_ROW.credits), credits_charged: points(JOB_CHARGE.credits_charged),
      credits_held: points(JOB_CHARGE.credits_held), credits_released: points(JOB_CHARGE.credits_released),
      input_data: { _feeCredits: points(JOB_ROW.input_data._feeCredits) },
      output_data: { analysisCredits: points(JOB_ROW.output_data.analysisCredits) },
    })
    expect(res.structuredContent).toMatchObject({
      credits: points(JOB_ROW.credits), creditsCharged: points(JOB_CHARGE.credits_charged),
      creditsHeld: points(JOB_CHARGE.credits_held), creditsReleased: points(JOB_CHARGE.credits_released),
    })
    // The envelope's schema is the tools/list one: no key is added to it.
    expect(res.structuredContent).not.toHaveProperty("unit")
    expect(rawFiguresIn(serialized(res))).toEqual([])
  })

  it("get_asset: the job's figures in the unit, and the unit named", async () => {
    h.tables = DEFAULT_TABLES
    const res = await callTool(await server(), "get_asset", { job_id: JOB_ID })
    const text = JSON.parse(res.content[0]!.text!) as { data: Record<string, unknown>; unit?: string }
    expect(text.unit).toBe("points")
    expect(text.data).toMatchObject({ credits: points(JOB_ROW.credits), output_data: { analysisCredits: points(JOB_ROW.output_data.analysisCredits) } })
    expect(rawFiguresIn(serialized(res))).toEqual([])
  })

  it("list_jobs, both scopes", async () => {
    h.tables = DEFAULT_TABLES
    const s = await server()
    const mine = await callTool(s, "list_jobs", { types: ["tighten-episode"] })
    expect(rawFiguresIn(serialized(mine))).toEqual([])
    expect(serialized(mine)).toContain(String(points(JOB_CHARGE.credits_charged)))
    h.tables = { ...DEFAULT_TABLES, jobs: [PUBLIC_JOB_ROW] }
    const theirs = await callTool(s, "list_jobs", { scope: "public" })
    expect(rawFiguresIn(serialized(theirs))).toEqual([])
    expect(serialized(theirs)).toContain(String(points(PUBLIC_JOB_ROW.credits)))
  })

  it("credit_transactions: the usage row's charge, hold and pools, and a purchase's credits", async () => {
    h.tables = DEFAULT_TABLES
    const res = await callTool(await server(), "credit_transactions", { limit: 5 })
    const body = JSON.parse(res.content[0]!.text!) as { data: Array<Record<string, unknown>>; usage: { data: Array<Record<string, unknown>> }; unit: string }
    expect(body.unit).toBe("points")
    expect(body.data[0]).toMatchObject({ credits_granted: points(PURCHASE_ROW.credits_granted), amount_usd: PURCHASE_ROW.amount_usd })
    expect(body.usage.data[0]).toMatchObject({
      credits_used: points(USAGE_ROW.credits_used), credits_charged: points(USAGE_ROW.credits_charged), credits_reserved: points(USAGE_ROW.credits_used),
      metadata: { model: "tighten-episode", from_sub: points(USAGE_ROW.metadata.from_sub), from_topup: points(USAGE_ROW.metadata.from_topup), allowance_delta: points(USAGE_ROW.metadata.allowance_delta) },
    })
    expect(rawFiguresIn(serialized(res))).toEqual([])
  })

  it("list_models: a quoted price and the listing's pricing rows", async () => {
    const s = await server()
    const quoted = await callTool(s, "list_models", { priceIds: [PRICED_ID] })
    expect(JSON.parse(quoted.content[0]!.text!)).toEqual({ prices: { [PRICED_ID]: { credits: points(PRICED_CREDITS) } }, unit: "points", unitLabels: { he: "נקודות" }, decimals: 2 })
    const listing = JSON.parse((await callTool(s, "list_models", { kind: "video" })).content[0]!.text!) as { sections: Array<{ families: Array<{ models: Array<{ id: string; pricing?: Array<{ identifier: string; credits: number }> }> }> }>; unit: string }
    expect(listing.unit).toBe("points")
    const row = listing.sections.flatMap((x) => x.families.flatMap((f) => f.models.flatMap((m) => m.pricing ?? []))).find((r) => r.identifier === PRICED_ID)
    expect(row?.credits).toBe(points(PRICED_CREDITS))
  })

  it("a description's price hint is in the unit, built at registration", async () => {
    const tools = await listTools(await server())
    const speakerMap = tools.find((t) => t.name === "speaker_map")
    expect(speakerMap?.description).toContain(`${points(statedPrices().credits("speaker-map")!)} points per run.`)
    // No description states a figure in credits once the deployment has a unit.
    for (const t of tools) {
      expect(`${t.name}: ${t.description ?? ""}`).not.toMatch(/\d(?:<!--[^>]*-->)? cr\b|\d(?:<!--[^>]*-->)? credits\b/)
    }
  })
})

describe("a refusal for want of balance", () => {
  const body402 = JSON.stringify({ error: { code: "insufficient_credits", message: "Insufficient credits. Required: 8467, Available: 7919" } })

  it("with self-serve on and a unit: no figure, the unit's word", () => {
    setProfile({ ...UNIT })
    expect(errorResult(402, body402).content[0]!.text).toBe("Nodaro: insufficient points for this generation (insufficient_credits).")
    // Self-serve on: the top-up guidance stays.
    expect(failureGuidance({ error_message: "x", error_hint: { kind: "credits" } }).guidance).toContain("Ask the user to top up")
  })

  it("where the deployment manages the balance: ask its operator, never top up, upgrade or buy", async () => {
    setProfile({ ...UNIT, selfServe: false })
    const generic = errorResult(402, body402).content[0]!.text
    expect(generic).toBe(
      "Nodaro: the balance cannot cover this generation (insufficient_credits). The balance is managed by this deployment: tell the user, who can ask the deployment's operator for more (check_balance shows the balance).",
    )
    const guidance = failureGuidance({ error_message: "x", error_hint: { kind: "credits", code: "user_allowance_exceeded" } }).guidance
    expect(guidance).toBe(
      "The balance ran out partway through this job (user_allowance_exceeded), so it stopped and what it held was refunded. The balance is managed by this deployment: tell the user, who can ask the deployment's operator for more (check_balance shows the balance), then run the same request again.",
    )
    const fastify = await stubRoutes({ useCaseRefusal: { status: 402, message: "This episode is estimated at about 8467 credits; your balance is 7919.", required: 8467, balance: 7919 } })
    const refused = await callTool(await server(fastify), "tighten_episode", { media_url: "https://cdn.example/ep.mp4" })
    expect(refused.content[0]!.text).toBe(
      "Nodaro: the balance cannot cover this run (insufficient_credits). The balance is managed by this deployment: tell the user, who can ask the deployment's operator for more (check_balance shows the balance).",
    )
    for (const text of [generic, guidance, refused.content[0]!.text!]) {
      expect(text).not.toMatch(/top up|top-up|upgrade|\bbuy\b|purchase/i)
      expect(rawFiguresIn(text)).toEqual([])
    }
  })
})

describe("nothing configured: every reply exactly as before", () => {
  it("answers the recorded bytes", async () => {
    const actual = await replies()
    if (process.env.UPDATE_DEPLOYMENT_AMOUNTS === "1") {
      mkdirSync(dirname(MAINLINE_FIXTURE), { recursive: true })
      writeFileSync(MAINLINE_FIXTURE, `${JSON.stringify(actual, null, 2)}\n`)
    }
    const recorded = JSON.parse(readFileSync(MAINLINE_FIXTURE, "utf8")) as Record<string, string>
    expect(actual).toEqual(recorded)
    // The recording is of real figures: the tools did read the fixed rows.
    expect(actual.check_balance).toContain(String(BALANCE.total))
    expect(actual.get_job).toContain(String(JOB_CHARGE.credits_charged))
    expect(actual.list_models_price_ids).toContain(String(PRICED_CREDITS))
  })
})
