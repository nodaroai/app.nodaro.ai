// @test-watches backend/src/lib/mcp/__tests__/fixtures/tool-list-wire.json
import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { ALL_SCOPES, type Scope } from "../../scopes.js"

// THE WHOLE `tools/list` REPLY, recorded. `tool-surface-snapshot.test.ts` pins
// which tools each grant sees and how many bytes the list may take; neither
// pins a description, a schema, `_meta` or the order. This pins all of it, per
// (edition × grant), as a digest of the exact JSON the server answers — so a
// change that was meant to move nothing on a deployment that restricts nothing
// (the offer narrowing of `lib/mcp/tool-offer.ts` is one) is proven to move
// nothing, byte for byte.
//
// A change to a tool's definition moves its digest on purpose. Rewrite the
// fixture with the change it belongs to:
//   cd backend && UPDATE_TOOL_LIST_WIRE=1 npx vitest run src/lib/mcp/__tests__/tool-list-wire.test.ts
// (TOOL_LIST_WIRE_DUMP=<dir> also writes each reply as JSON there, to diff.)
//
// The reply carries this install's addresses (an archive link in a description)
// and follows its switches, so they are pinned to their defaults here, before
// config is read: a developer's backend/.env cannot move the digest (dotenv
// never overwrites a variable that is set, empty included).
vi.hoisted(() => {
  for (const key of [
    "PUBLIC_URL", "FLOW_PUBLIC_URL", "FLOW_UI_ORIGIN", "LEGACY_UI_HOSTS", "MCP_PUBLIC_URL",
    "ORGS_ENABLED", "SCENE3D_ADVANCED_ENABLED", "SITE_CAPTURE_ENABLED", "NODARO_PRICE_ANNOTATIONS", "NODARO_SURFACE_PROFILE",
  ]) {
    process.env[key] = ""
  }
})
vi.mock("../../supabase.js", () => ({ supabase: { from: vi.fn() } }))
let credits = true
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => credits }
})
const { buildMcpServer } = await import("../server.js")
import { setLlmMeteredSchemaReadyForTesting } from "../../llm-metered-schema-gate.js"
setLlmMeteredSchemaReadyForTesting(true)

/** The grant `tool-surface-snapshot.test.ts` measures as "all". */
const ALL_GRANTED: Scope[] = [
  "workflows:read", "workflows:write", "workflows:execute", "jobs:read",
  "assets:read", "assets:write", "credits:read", "apps:read",
]
const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(here, "fixtures/tool-list-wire.json")

type Recorded = { tools: number; bytes: number; sha256: string }

async function listReply(scopes: readonly Scope[]): Promise<string> {
  // As a public client receives it: /mcp sessions carry a conversation, so the
  // mapped verbs take `user_request` (flows/user-request.ts).
  const server = await buildMcpServer({ userId: "u1", scopes: [...scopes], clientName: "Claude", fastify: Fastify(), conversation: { client: "claude", key: null } })
  const inner = (server as unknown as {
    server: { _requestHandlers: Map<string, (r: unknown, e: unknown) => Promise<{ tools: unknown[] }>> }
  }).server
  const res = await inner._requestHandlers.get("tools/list")!({ method: "tools/list", params: {} }, {})
  return JSON.stringify(res)
}

const CASES: ReadonlyArray<[key: string, cloud: boolean, scopes: readonly Scope[]]> = [
  ["cloud/every-scope", true, ALL_SCOPES],
  ["cloud/all", true, ALL_GRANTED],
  ["cloud/jobs", true, ["jobs:read"]],
  ["cloud/none", true, []],
  ["community/every-scope", false, ALL_SCOPES],
  ["community/all", false, ALL_GRANTED],
  ["community/none", false, []],
]

describe("tools/list — the whole reply, recorded per edition × grant", () => {
  it("answers exactly the recorded bytes", async () => {
    const actual: Record<string, Recorded> = {}
    const dump = process.env.TOOL_LIST_WIRE_DUMP
    if (dump) mkdirSync(dump, { recursive: true })
    for (const [key, cloud, scopes] of CASES) {
      credits = cloud
      const reply = await listReply(scopes)
      const tools = (JSON.parse(reply) as { tools: unknown[] }).tools.length
      actual[key] = { tools, bytes: Buffer.byteLength(reply), sha256: createHash("sha256").update(reply).digest("hex") }
      if (dump) writeFileSync(resolve(dump, `${key.replace("/", "--")}.json`), reply)
    }
    if (process.env.UPDATE_TOOL_LIST_WIRE === "1") {
      writeFileSync(FIXTURE_PATH, `${JSON.stringify(actual, null, 2)}\n`)
      return
    }
    const recorded = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, Recorded>
    expect(
      actual,
      "the tools/list reply changed — if that is intended, rewrite fixtures/tool-list-wire.json " +
        "(UPDATE_TOOL_LIST_WIRE=1, see the top of this file) in the same change",
    ).toEqual(recorded)
  }, 120_000)
})
