// @test-watches backend/src/routes/__tests__/fixtures/mcp-lane-off-tools.json
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import type { FastifyInstance } from "fastify"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

/**
 * The other half of `mcp-lane-off-fixture.test.ts`: what the MCP TOOLS and
 * WIDGETS hand a signed-in client, with path mode off, byte for byte as before
 * path mode existed (decided 2026-11-11). RECORDED from the code before the
 * change, through the real `/mcp` endpoint with a token: every absolute
 * address in the whole `tools/list` (not its full text, which also depends on
 * the machine — the same list hashed differently on CI), the upload tools' links (the
 * signed token and the random key masked), a picker catalog's pictures, and
 * each widget resource the host fetches (its CSP and every address in its
 * HTML) — on the dedicated `mcp.` host, the primary host, a declared host and
 * an undeclared one. Re-record only on purpose: `MCP_LANE_FIXTURE_RECORD=1`.
 */

vi.hoisted(() => {
  process.env.MCP_ENABLED = "true"
  process.env.PUBLIC_URL = "https://app.nodaro.ai"
  process.env.MCP_PUBLIC_URL = ""
  process.env.CORS_ORIGIN = "https://studio.example.com,https://alt.example.org"
  process.env.FLOW_PUBLIC_URL = ""
  process.env.FLOW_UI_ORIGIN = ""
  process.env.LEGACY_UI_HOSTS = ""
  process.env.R2_PUBLIC_URL = "https://cdn.example.com"
  delete process.env.NODARO_SURFACE_PROFILE
})

const TOKEN = "ndr_app_tools_fixture_token"

vi.mock("../../lib/supabase.js", async () => {
  const { createHash: hash } = await import("node:crypto")
  const tokenHash = hash("sha256").update("ndr_app_tools_fixture_token").digest("hex")
  const appId = "00000000-0000-4000-8000-0000000000bb"
  const chainFor = (table: string) => {
    const eqs: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "is", "gte", "in", "order", "limit", "neq", "update", "overlaps", "upsert", "or", "not", "range", "contains", "filter", "match", "ilike", "lte", "lt", "gt"]) {
      chain[m] = vi.fn(() => chain)
    }
    chain.eq = vi.fn((col: string, val: unknown) => {
      eqs[col] = val
      return chain
    })
    const row = (): unknown => {
      if (table === "developer_app_tokens" && eqs.token_hash === tokenHash) {
        return {
          id: "tok-1",
          authorization_id: "auth-1",
          expires_at: null,
          revoked_at: null,
          developer_app_authorizations: {
            id: "auth-1",
            app_id: appId,
            user_id: "00000000-0000-4000-8000-0000000000aa",
            scopes_granted: ["workflows:read", "workflows:write", "workflows:execute", "jobs:read", "assets:read", "assets:write", "credits:read", "apps:read"],
            revoked_at: null,
            monthly_spend_cap_credits: null,
            developer_apps: { kind: "dynamic_mcp", owner_user_id: null },
          },
        }
      }
      if (table === "developer_apps" && eqs.id === appId) return { name: "Claude" }
      return null
    }
    chain.single = vi.fn(() => Promise.resolve({ data: null, error: null }))
    chain.maybeSingle = vi.fn(() => Promise.resolve({ data: row(), error: null }))
    chain.then = (res: (v: unknown) => unknown) => res({ data: [], error: null, count: 0 })
    chain.insert = vi.fn(() => chain)
    return chain
  }
  return {
    supabase: {
      from: vi.fn((table: string) => chainFor(table)),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    },
  }
})

import { buildApp } from "../../app.js"

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(HERE, "fixtures/mcp-lane-off-tools.json")
const RECORD = process.env.MCP_LANE_FIXTURE_RECORD === "1"

const HOSTS = ["mcp.nodaro.ai", "app.nodaro.ai", "studio.example.com", "unlisted.example.net"] as const

const WIDGETS = [
  "ui://nodaro/widget/v4/job-image",
  "ui://nodaro/widget/v4/job-auto",
  "ui://nodaro/widget/v4/workflow",
  "ui://nodaro/widget/v4/upload-image",
]

/** The random parts of an upload link: the signed token, and the key's uuid. */
function maskUploads(text: string): string {
  return text
    .replace(/\/v1\/(upload-proxy|upload-page)\/[A-Za-z0-9._-]+/g, "/v1/$1/<signed token>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<uuid>")
}

/** Every distinct absolute address in a text, sorted. */
function addressesIn(text: string): string[] {
  return [...new Set(text.match(/https?:\/\/[^\s"'`<>\\)]+/g) ?? [])].sort()
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex")

describe("MCP tools and widgets with path mode off — byte-identical to before path mode", () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    // The MCP transport's node adapter drains an unread request body and calls
    // `destroySoon()` on the request's socket 500 ms later; the injected
    // request's stand-in socket lacks it (a real socket has it).
    const probe = await app.inject({ method: "GET", url: "/health" })
    const socketProto = Object.getPrototypeOf((probe.raw.req as unknown as { socket: object }).socket) as { destroySoon?: () => void }
    if (typeof socketProto.destroySoon !== "function") socketProto.destroySoon = () => {}
  })

  afterAll(async () => {
    await app.close()
  })

  async function rpc(host: string, method: string, params: Record<string, unknown>): Promise<{ status: number; body: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { host, authorization: `Bearer ${TOKEN}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
      payload: { jsonrpc: "2.0", id: 1, method, params } as never,
    })
    return { status: res.statusCode, body: res.body }
  }

  async function captureAll(): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {}
    for (const host of HOSTS) {
      const list = await rpc(host, "tools/list", {})
      out[`${host} tools/list`] = { status: list.status, addresses: addressesIn(list.body) }
      for (const [name, args] of [
        ["prepare_image_upload", { mime_type: "image/png" }],
        ["upload_image_widget", { max_files: 2 }],
        ["request_image_upload", {}],
      ] as const) {
        const call = await rpc(host, "tools/call", { name, arguments: args })
        out[`${host} tools/call ${name}`] = { status: call.status, body: maskUploads(call.body) }
      }
      const picker = await rpc(host, "tools/call", { name: "get_picker_catalog", arguments: { node_type: "setting" } })
      out[`${host} tools/call get_picker_catalog setting`] = { status: picker.status, sha256: sha(picker.body), addresses: addressesIn(picker.body).slice(0, 5) }
      for (const uri of WIDGETS) {
        const read = await rpc(host, "resources/read", { uri })
        const parsed = JSON.parse(read.body) as { result?: { contents?: Array<{ text?: string; _meta?: unknown }> } }
        const content = parsed.result?.contents?.[0]
        out[`${host} resources/read ${uri}`] = {
          status: read.status,
          meta: content?._meta ?? null,
          sha256: sha(content?.text ?? ""),
          addresses: addressesIn(content?.text ?? ""),
        }
      }
    }
    return out
  }

  it("matches the recorded answers", async () => {
    const answers = await captureAll()
    if (RECORD || !existsSync(FIXTURE)) {
      if (!RECORD) throw new Error(`missing fixture ${FIXTURE}: record it with MCP_LANE_FIXTURE_RECORD=1 on the code before the change`)
      writeFileSync(FIXTURE, `${JSON.stringify(answers, null, 2)}\n`)
      return
    }
    const recorded = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>
    expect(Object.keys(answers)).toEqual(Object.keys(recorded))
    for (const key of Object.keys(recorded)) expect(answers[key], key).toEqual(recorded[key])
  }, 180_000)
})
