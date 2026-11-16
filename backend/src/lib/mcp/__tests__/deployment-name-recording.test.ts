// @test-watches backend/src/lib/mcp/__tests__/fixtures/deployment-name-recording.json
/**
 * WHAT THE LANE SAYS BESIDE ITS TOOL LIST, recorded with nothing configured:
 * the `initialize` reply (the server's name), the resources and every page
 * `resources/read` answers (the widgets), and a call to every tool against
 * routes that answer each status in turn (`_name-sweep.ts`: refusals, and the
 * sentences a tool states once its route accepted). `tool-list-wire.test.ts`
 * records `tools/list` itself; `deployment-documents.test.ts` holds every
 * served document against its source.
 *
 * These are the replies a deployment that keeps the platform's name must keep
 * byte for byte while the deployment-name rule is built and after
 * (`deployment-name.test.ts`). A change that is meant to move them rewrites the
 * recording in the same change:
 *   cd backend && UPDATE_DEPLOYMENT_NAME_RECORDING=1 npx vitest run src/lib/mcp/__tests__/deployment-name-recording.test.ts
 * (DEPLOYMENT_NAME_RECORDING_DUMP=<dir> also writes each reply as JSON there, to diff.)
 *
 * The replies carry this install's addresses and follow its switches, so they
 * are pinned to their defaults before config is read (a developer's
 * backend/.env cannot move a digest: dotenv never overwrites a set variable).
 * An upload link carries a fresh token and id on every call: those are read
 * as `<token>` / `<uuid>` (and a timestamp as `<time>`) before digesting.
 */
import { describe, it, expect, vi } from "vitest"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

vi.hoisted(() => {
  for (const key of [
    "PUBLIC_URL", "FLOW_PUBLIC_URL", "FLOW_UI_ORIGIN", "LEGACY_UI_HOSTS", "MCP_PUBLIC_URL", "CORS_ORIGIN",
    "R2_PUBLIC_URL", "R2_PUBLIC_FALLBACK_DOMAIN",
    "ORGS_ENABLED", "SCENE3D_ADVANCED_ENABLED", "SITE_CAPTURE_ENABLED", "NODARO_PRICE_ANNOTATIONS", "NODARO_SURFACE_PROFILE",
    "DEPLOYMENT_WALLET_URL", "DEPLOYMENT_WALLET_TOKEN", "DEPLOYMENT_WALLET_SSO_PROVIDER",
  ]) {
    process.env[key] = ""
  }
})
vi.mock("../../supabase.js", async () => {
  const { fakeSupabaseFrom: from } = await import("./_amounts-harness.js")
  return { supabase: { from: from(() => ({})), rpc: async () => ({ data: null, error: null }) } }
})
let credits = true
vi.mock("../../config.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, hasCredits: () => credits }
})
// Nothing in the sweep reaches the network.
vi.stubGlobal("fetch", async () => {
  throw new Error("no network in the sweep")
})

const { buildMcpServer } = await import("../server.js")
const { sweepLane, SWEEP_STATUSES, normalizedReply } = await import("./_name-sweep.js")
import { setLlmMeteredSchemaReadyForTesting } from "../../llm-metered-schema-gate.js"
import { ALL_SCOPES } from "../../scopes.js"
setLlmMeteredSchemaReadyForTesting(true)

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE_PATH = resolve(here, "fixtures/deployment-name-recording.json")

type Digest = { count: number; sha256: string }
const digest = (parts: readonly string[]): Digest => ({ count: parts.length, sha256: createHash("sha256").update(parts.join("\n\u0000\n")).digest("hex") })

describe("the lane beside its tool list, recorded with nothing configured", () => {
  it("answers exactly the recorded replies, per edition", async () => {
    const actual: Record<string, Record<string, Digest>> = {}
    const dump = process.env.DEPLOYMENT_NAME_RECORDING_DUMP
    if (dump) mkdirSync(dump, { recursive: true })
    for (const cloud of [true, false]) {
      credits = cloud
      const edition = cloud ? "cloud" : "community"
      const surface = await sweepLane({ buildMcpServer: buildMcpServer as never, scopes: ALL_SCOPES })
      const entry: Record<string, Digest> = {
        initialize: digest([surface.initialize]),
        resources: digest([surface.resourcesList, surface.resourceTemplates, ...Object.entries(surface.resources).map(([uri, page]) => `${uri}\n${page}`)]),
      }
      for (const status of SWEEP_STATUSES) {
        const replies = Object.entries(surface.calls)
          .filter(([key]) => key.startsWith(`${status} `))
          .map(([key, reply]) => `${key}\n${normalizedReply(reply)}`)
        entry[`calls ${status}`] = digest(replies)
      }
      actual[edition] = entry
      if (dump) writeFileSync(resolve(dump, `${edition}.json`), JSON.stringify(surface, null, 1))
    }
    if (process.env.UPDATE_DEPLOYMENT_NAME_RECORDING === "1") {
      writeFileSync(FIXTURE_PATH, `${JSON.stringify(actual, null, 2)}\n`)
      return
    }
    const recorded = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as typeof actual
    expect(
      actual,
      "a reply moved with nothing configured — if that is intended, rewrite fixtures/deployment-name-recording.json " +
        "(UPDATE_DEPLOYMENT_NAME_RECORDING=1, see the top of this file) in the same change",
    ).toEqual(recorded)
  }, 300_000)
})
