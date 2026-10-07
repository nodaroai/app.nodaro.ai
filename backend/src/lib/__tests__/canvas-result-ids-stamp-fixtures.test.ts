import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { jobFactsFromRow, jobOutputUrl, jobRowStamp } from "../canvas-result-ids.js"

/**
 * ONE stamp rule, two implementations: migration 459 (`mig459_job_url` /
 * `mig459_stamp`, SQL) stamps a server run's rows, and the server's load / save
 * injection (`jobOutputUrl` / `jobRowStamp`) stamps a saved canvas's results.
 * Both read the SAME cases — `supabase/tests/fixtures/job-row-stamps.sql`,
 * whose "X" section in `fan-out-row-stamps-backfill.behavior.sql` runs the real
 * migration over them on real Postgres. This test runs the TypeScript over the
 * same rows, so a change to either rule that the other does not make fails.
 */
const FIXTURE = join(__dirname, "..", "..", "..", "..", "supabase", "tests", "fixtures", "job-row-stamps.sql")

interface StampCase {
  name: string
  id: string
  job_type: string
  input_data: Record<string, unknown>
  output_data: Record<string, unknown>
  listUrl: string
  stamp: Record<string, string> | null
}

function readCases(): StampCase[] {
  return readFileSync(FIXTURE, "utf8")
    .split(/\r?\n/)
    .map((line) => /^\s*\('(.*)'\)[,;]\s*$/.exec(line)?.[1])
    .filter((json): json is string => json !== undefined)
    .map((json) => JSON.parse(json.replace(/''/g, "'")) as StampCase)
}

const cases = readCases()

describe("the shared job-row stamp fixtures", () => {
  it("are read (an emptied or reformatted file must not pass vacuously)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(10)
    expect(new Set(cases.map((c) => c.name)).size).toBe(cases.length)
  })

  it.each(cases.map((c) => [c.name, c] as const))("%s: the same URL and stamp as migration 459", (_name, c) => {
    const job = jobFactsFromRow({ id: c.id, job_type: c.job_type, input_data: c.input_data, output_data: c.output_data })
    // The migration names a row only when the job's output URL IS the row.
    expect(jobOutputUrl(job) === c.listUrl).toBe(c.stamp !== null)
    if (c.stamp !== null) expect(jobRowStamp(job)).toEqual({ jobId: c.id, ...c.stamp })
  })
})
