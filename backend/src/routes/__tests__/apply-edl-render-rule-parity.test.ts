/**
 * Apply EDL's render rule at POST /v1/apply-edl — one third of the parity check
 * for the editor's render badge (A2b).
 *
 * A single-node Run of Apply EDL in the editor resolves the node's inputs in the
 * browser and posts them here. So every render a canvas of
 * `services/workflow-engine/__tests__/fixtures/apply-edl-render-rule.json`
 * makes is sent the way the editor sends it (frontend executeNode: the EDL
 * parsed, the Sources wires' media, the node's output and crossfade), and the
 * route must refuse exactly the issues the fixture lists, all of them, or
 * accept. The workflow-run half is
 * services/workflow-engine/__tests__/apply-edl-render-rule-parity.test.ts; the
 * badge half is frontend/src/lib/__tests__/apply-edl-render-rule-parity.test.ts.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const m = vi.hoisted(() => ({
  insertJob: vi.fn(),
  reserve: vi.fn(),
  queueAdd: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/insert-job.js", () => ({ insertJob: m.insertJob }))
vi.mock("@/lib/queue.js", () => ({ videoQueue: { add: m.queueAdd }, redis: {} }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => {},
  reserveCreditsForJob: m.reserve,
}))

import { applyEdlRoutes } from "../apply-edl.js"

interface Case {
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly data: Record<string, unknown> }>
  readonly sources: readonly string[]
  readonly renders: ReadonlyArray<{ readonly edl: unknown; readonly sources?: readonly string[]; readonly issues: readonly string[] }>
}

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = JSON.parse(
  readFileSync(join(HERE, "..", "..", "services", "workflow-engine", "__tests__", "fixtures", "apply-edl-render-rule.json"), "utf8"),
) as { readonly cases: Record<string, Case> }

const USER_ID = "00000000-0000-4000-8000-000000000001"

async function makeApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER_ID
  })
  await app.register(applyEdlRoutes)
  await app.ready()
  return app
}

beforeEach(() => {
  m.insertJob.mockReset().mockResolvedValue({ data: { id: "job-1" }, error: null })
  m.reserve.mockReset().mockResolvedValue({ usageLogId: "ul-1", creditsReserved: 10, watermark: false })
  m.queueAdd.mockReset().mockResolvedValue({ id: "q-1" })
})

describe("POST /v1/apply-edl reaches the render rule's verdicts (A2b parity)", () => {
  for (const [name, c] of Object.entries(FIXTURE.cases)) {
    it(name, async () => {
      const app = await makeApp()
      const node = c.nodes.find((n) => n.id === "render")!
      for (const [i, r] of c.renders.entries()) {
        const where = `${name}, render ${i}`
        // This render's own Sources media when a list wired into Sources fans
        // the render out, else the case's.
        const sources = r.sources ?? c.sources
        const res = await app.inject({
          method: "POST",
          url: "/v1/apply-edl",
          payload: {
            edl: r.edl,
            output: node.data.output ?? "video",
            ...(typeof node.data.crossfadeMs === "number" ? { crossfadeMs: node.data.crossfadeMs } : {}),
            ...(sources.length > 0 ? { sources } : {}),
          },
        })
        if (r.issues.length === 0) {
          expect(res.statusCode, `${where}: ${res.body}`).toBe(200)
        } else {
          expect(res.statusCode, where).toBe(400)
          const body = res.json() as { error: { code: string; issues: string[] } }
          expect(body.error.code, where).toBe("invalid_edl")
          expect(body.error.issues, where).toEqual(r.issues)
        }
      }
    })
  }
})
