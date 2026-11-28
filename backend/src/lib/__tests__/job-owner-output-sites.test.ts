// @test-watches backend/src/**/*.ts
/**
 * THE OWNER-ONLY OUTPUT FIELDS REACH OWNERS ONLY (lib/job-owner-output.ts).
 *
 * The job redaction every read runs knows no reader, so it never adds a field that belongs to a job's owner alone
 * (Video Remake's version before upscale: `engineVideoUrl`, `engineWidth`, `engineHeight`, `engineResolution`). Those
 * are added by `lib/job-owner-output.ts`, which compares the reader with the row's owner itself, and ONLY from the
 * reads listed below: each one a read of the signed-in user's own jobs (or an admin's read, where the helper keeps the
 * fields to the owner's rows). A new file that imports it, or passes a reader to `sanitizeJobForPublic`, fails here
 * until it is reviewed as an owner read and listed; the reads of other people's jobs (the gallery, share links, a
 * session's feed, an embed, MCP `get_asset` / the public `list_jobs`) are held never to.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const BACKEND_SRC = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..")

/** The owner reads, by path under backend/src, and why each is one. */
const OWNER_READS: Readonly<Record<string, string>> = {
  "routes/jobs.ts": "GET /v1/jobs/:id, GET /v1/jobs, the status polls: a non-admin reads only their own jobs (`.eq(\"user_id\")`); an admin's read keeps the fields to the owner by the helper's own check",
  "lib/webhooks/event.ts": "the job event to the endpoint of the job's owner (the read is `.eq(\"user_id\", d.userId)`)",
  "lib/mcp/tools/_job-view.ts": "the MCP job envelope, given a reader only by the owner reads below",
  "lib/mcp/tools/jobs.ts": "MCP get_job and wait_for_job (`.eq(\"user_id\", session.userId)`), and list_jobs scope mine only",
  "lib/mcp/tasks.ts": "MCP tasks/result, after the task's owner is checked",
}

/** Reads of other people's jobs: never an importer of the helper, nor a caller passing a reader. */
const NON_OWNER_READS = [
  "routes/gallery.ts",
  "routes/embed.ts",
  "routes/shares.ts",
  "lib/generation-sessions.ts",
  "lib/mcp/tools/gallery.ts",
  "lib/share-links/shared-job.ts",
  "lib/share-links/card-reads.ts",
]

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name === "generated") continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sourceFiles(path, out)
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts") && !name.endsWith(".test.ts")) out.push(path)
  }
  return out
}

const files = sourceFiles(BACKEND_SRC).map((path) => ({ rel: relative(BACKEND_SRC, path), text: readFileSync(path, "utf8") }))
const importsHelper = (text: string) => /from\s+["'][./]*(?:lib\/)?job-owner-output\.js["']/.test(text)
// A `sanitizeJobForPublic(…, isAdmin, { userId … })` call: the reader argument.
const passesReader = (text: string) => /sanitizeJobForPublic\([^;]*?,\s*[^,;]+,\s*\{\s*userId/s.test(text)

describe("the owner-only output fields are added only by owner reads", () => {
  it("only the listed owner reads import lib/job-owner-output.ts or give sanitizeJobForPublic a reader, and each listed one does", () => {
    const importers = files.filter((f) => f.rel !== "lib/job-owner-output.ts" && importsHelper(f.text)).map((f) => f.rel)
    const readerCallers = files.filter((f) => passesReader(f.text)).map((f) => f.rel)
    for (const rel of [...importers, ...readerCallers]) expect(Object.keys(OWNER_READS), `${rel}: not a listed owner read`).toContain(rel)
    expect([...new Set([...importers, ...readerCallers])].sort()).toEqual(Object.keys(OWNER_READS).sort())
    expect(readerCallers.sort()).toEqual(["lib/webhooks/event.ts", "routes/jobs.ts"])
  })

  it("no read of other people's jobs imports the helper or names a reader", () => {
    for (const rel of NON_OWNER_READS) {
      const file = files.find((f) => f.rel === rel)
      expect(file, `${rel} exists`).toBeDefined()
      expect(importsHelper(file!.text), rel).toBe(false)
      expect(passesReader(file!.text), rel).toBe(false)
    }
  })

  it("the job redaction itself never adds them (it knows no reader)", () => {
    for (const rel of ["lib/public-job-data.ts", "lib/job-output-visibility.ts"]) {
      const text = files.find((f) => f.rel === rel)!.text
      expect(importsHelper(text), rel).toBe(false)
      for (const name of ["engineVideoUrl", "engineWidth", "engineHeight", "engineResolution"]) expect(text, `${rel}: ${name}`).not.toContain(`"${name}"`)
    }
  })
})
