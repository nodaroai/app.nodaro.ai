// @test-watches backend/src/**/*.ts
/**
 * EVERY RESERVATION THAT NAMES A JOB LINKS IT (`jobs.usage_log_id`).
 *
 * `CreditsService.reserveCredits` writes the link for every lane that reserves
 * through it (`reserve-links-job.test.ts` pins that behaviour). This file pins
 * the other half from the source: nothing reserves AROUND the funnel with a
 * job id, because such a reservation would leave its job unlinked — the job
 * reads `credit_status` / `credits_charged` null although its hold was taken,
 * and the video worker, which reads its usage log off the row, never commits
 * or refunds it.
 *
 * So every `rpc("reserve_credits" | "reserve_job_credits", …)` outside the
 * funnel must pass `p_job_id: null` — a hold that belongs to no job row (a
 * pipeline's orchestration hold, a scene helper). One that needs a job either
 * goes through `reserveCredits` or writes the link itself and is listed below
 * with the reason. Every `usage_logs` insert outside the funnel is refused the
 * same way: it is a reservation that skipped the link.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const SRC = join(__dirname, "..", "..", "..")
const FUNNEL = "ee/billing/credits.ts"

/** Direct reserve RPCs that name a job and link it themselves. None today. */
const LINKS_ITSELF: ReadonlyMap<string, string> = new Map()

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...tsFiles(abs))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(abs)
    }
  }
  return out
}

/** The balanced `( … )` argument text starting at `open`. */
function callArgs(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++
    else if (src[i] === ")" && --depth === 0) return src.slice(open, i + 1)
  }
  return src.slice(open)
}

const files = tsFiles(SRC).map((abs) => ({
  file: abs.slice(SRC.length + 1).split("\\").join("/"),
  src: readFileSync(abs, "utf8"),
}))

const RESERVE_RPC = /\.rpc\(\s*(?:[^,()]*\?\s*)?"reserve_(?:job_)?credits"/g

describe("reserve paths that know their job write jobs.usage_log_id", () => {
  const sites: Array<{ file: string; line: number; args: string }> = []
  for (const { file, src } of files) {
    for (const m of src.matchAll(RESERVE_RPC)) {
      const open = src.indexOf("(", m.index)
      sites.push({ file, line: src.slice(0, m.index).split("\n").length, args: callArgs(src, open) })
    }
  }

  it("finds the real reserve population (anti-vacuity)", () => {
    expect(sites.filter((s) => s.file === FUNNEL).length).toBeGreaterThanOrEqual(1)
    expect(sites.filter((s) => s.file !== FUNNEL).length).toBeGreaterThanOrEqual(2)
  })

  it("every reserve RPC outside the funnel names no job, or links it itself", () => {
    const offenders = sites
      .filter((s) => s.file !== FUNNEL && !LINKS_ITSELF.has(s.file))
      .filter((s) => !/p_job_id:\s*null\b/.test(s.args))
      .map((s) => `  • ${s.file}:${s.line}`)
    expect(
      offenders,
      `These reserve credits against a job without going through CreditsService.reserveCredits, ` +
        `so the job is never linked to its hold (jobs.usage_log_id).\n\nReserve through ` +
        `CreditsService.reserveCredits, or pass p_job_id: null for a hold that belongs to no job ` +
        `row, or write the link and add the file to LINKS_ITSELF with the reason.\n\n${offenders.join("\n")}`,
    ).toEqual([])
  })

  it("no usage_logs row is inserted outside the funnel", () => {
    const offenders = files
      .filter(({ file }) => file !== FUNNEL)
      .filter(({ src }) => /from\(\s*"usage_logs"\s*\)\s*\.insert\(/.test(src))
      .map(({ file }) => `  • ${file}`)
    expect(offenders, `A usage_logs insert outside ${FUNNEL} is a reservation that skips the job link:\n${offenders.join("\n")}`).toEqual([])
  })

  it("the funnel links on both of its legacy reservation paths", () => {
    const src = files.find((f) => f.file === FUNNEL)!.src
    const body = src.slice(src.indexOf("static async reserveCredits("), src.indexOf("static async trySettleManagedCredits("))
    // The zero-cost row and the reserve_credits RPC; the job-once RPC links in SQL (migration 391).
    expect(body.match(/await linkJobToReservation\(jobId, userId, /g)?.length).toBe(2)
  })

  it("the listed self-linking lanes still reserve directly and still write the link", () => {
    for (const [file] of LINKS_ITSELF) {
      const src = files.find((f) => f.file === file)?.src ?? ""
      expect(src, file).toMatch(RESERVE_RPC)
      expect(src, file).toContain("usage_log_id")
    }
  })
})
