// @test-watches supabase/tests/fixtures/admin-job-own-credits-cases.json
/**
 * A job's own credit figure — what the admin Jobs list shows and filters by:
 * its settled charge plus its settled side holds once its own usage log has
 * settled, else its hold (`jobs.credits`), else 0.
 *
 * The case table is shared with the SQL mirror (`public.admin_job_own_credits`,
 * migration 575, proved against the same fixture), so the list's server-side
 * credit filter and the figure each row shows cannot drift apart. Each case is
 * held twice here: by the pure `ownCreditFigure`, and by the loader every
 * surface reads (`runCreditsFor`, with its database reads answered from the
 * case's rows) — `ownCharged ?? ownHeld ?? 0`.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeEach, describe, expect, it, vi } from "vitest"

interface OwnCreditsCase {
  label: string
  logStatus: string | null
  creditsUsed: number | null
  creditsCharged: number | null
  /** Committed side holds' charges. */
  sideCharges: number[]
  /** Side holds still reserved: never part of the figure. */
  openSideCharges: number[]
  held: number | null
  expected: number
}
const CASES = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../../supabase/tests/fixtures/admin-job-own-credits-cases.json", import.meta.url)),
    "utf8",
  ),
) as OwnCreditsCase[]

type Log = { id: string; status: string; credits_used: number | null; credits_charged: number | null }
type Side = { job_id: string; usage_logs: { status: string; credits_used: number | null; credits_charged: number | null } }

const h = vi.hoisted(() => ({ logs: [] as Log[], side: [] as Side[] }))
vi.mock("../config.js", async (importOriginal) => ({ ...(await importOriginal<typeof import("../config.js")>()), hasCredits: () => true }))
vi.mock("../llm-metered-schema-gate.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../llm-metered-schema-gate.js")>()),
  llmMeteredSchemaReady: () => true,
}))
vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      let ids: unknown[] = []
      // The side-hold read's `.eq("usage_logs.status", …)`, applied as the database would.
      let sideStatus: unknown = undefined
      const rows = (): unknown[] => {
        // A job with no steps: the steps read finds no child jobs.
        if (table === "jobs") return []
        if (table === "usage_logs") return h.logs.filter((l) => ids.includes(l.id))
        return h.side.filter((s) => ids.includes(s.job_id) && (sideStatus === undefined || s.usage_logs.status === sideStatus))
      }
      const q = {
        select: () => q,
        in: (column: string, list: unknown[]) => (column === "user_id" ? q : ((ids = list), q)),
        eq: (column: string, value: unknown) => (column === "usage_logs.status" ? ((sideStatus = value), q) : q),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res),
      }
      return q
    },
  },
}))

const { ownCreditFigure, runCreditsFor, runCreditsOf } = await import("../job-credit-status.js")

const OWNER = "00000000-0000-4000-8000-0000000000a1"
const JOB = "job-1"
const LOG = "ul-job-1"

const logOf = (c: OwnCreditsCase) =>
  c.logStatus === null ? null : { status: c.logStatus, credits_used: c.creditsUsed, credits_charged: c.creditsCharged }
const sideOf = (c: OwnCreditsCase) => c.sideCharges.reduce((sum, v) => sum + v, 0)

beforeEach(() => {
  h.logs = []
  h.side = []
})

describe("a job's own credit figure — one rule for SQL and TypeScript", () => {
  it("has cases to check", () => expect(CASES.length).toBeGreaterThan(4))
  it("covers a reserved side hold beside a settled job", () => {
    expect(CASES.some((c) => c.logStatus === "committed" && c.openSideCharges.length > 0)).toBe(true)
  })

  for (const c of CASES) {
    it(`ownCreditFigure: ${c.label}`, () => {
      expect(ownCreditFigure(logOf(c), sideOf(c), c.held)).toBe(c.expected)
    })

    it(`runCreditsFor agrees: ${c.label}`, async () => {
      const log = logOf(c)
      if (log) h.logs = [{ id: LOG, ...log }]
      h.side = [
        ...c.sideCharges.map((charged) => ({
          job_id: JOB,
          usage_logs: { status: "committed", credits_used: charged, credits_charged: charged },
        })),
        ...c.openSideCharges.map((held) => ({
          job_id: JOB,
          usage_logs: { status: "reserved", credits_used: held, credits_charged: null },
        })),
      ]
      const credits = await runCreditsFor([{ id: JOB, usage_log_id: log ? LOG : null, credits: c.held }], OWNER)
      const figures = runCreditsOf(JOB, credits)
      expect(figures).not.toBeNull()
      expect(figures!.ownCharged ?? figures!.ownHeld ?? 0).toBe(c.expected)
    })
  }
})
