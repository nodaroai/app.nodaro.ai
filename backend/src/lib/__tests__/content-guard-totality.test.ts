/**
 * Content-guard totality. A guard that one lane walks around protects nothing,
 * so each place a request's content becomes final has to keep asking.
 *
 * The lanes break down as:
 *   - the prompt funnel, which the prompt-policy totality guard already proves
 *     every media prompt passes (and half (d) of it, the plugin door);
 *   - the insert funnel, which `no-direct-job-insert` and
 *     `job-policy-request-totality` prove every job row passes;
 *   - the workflow engine's payload step;
 *   - character training, whose request has no prompt to police.
 *
 * What this file adds is that each of those really asks the guard, and in the
 * right order: before the row, and before the reservation.
 *
 * `// @test-watches` is for the test selector; the reads are direct.
 */
// @test-watches backend/src/lib/prompt-policy.ts backend/src/lib/insert-job.ts backend/src/lib/http-errors.ts backend/src/services/workflow-engine/node-executor.ts backend/src/routes/character-training.ts backend/src/*.ts Dockerfile
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, "..", "..")
const read = (p: string): string => readFileSync(resolve(SRC, p), "utf8")

describe("content-guard totality", () => {
  it("the prompt funnel asks the guard before any policy runs", () => {
    const src = read("lib/prompt-policy.ts")
    const fn = src.slice(src.indexOf("export function applyPromptPolicies("))
    expect(fn.indexOf("guardAssembledPrompt(a)"), "applyPromptPolicies no longer asks the guard").toBeGreaterThan(-1)
    expect(fn.indexOf("guardAssembledPrompt(a)")).toBeLessThan(fn.indexOf("for (const p of policies)"))
  })

  it("the insert funnel asks the guard, before the row exists", () => {
    const src = read("lib/insert-job.ts")
    const gate = src.slice(src.indexOf("async function gateJobInsert("), src.indexOf("/** The error arm every non-throwing helper"))
    expect(gate, "gateJobInsert no longer asks the guard").toContain("refuseProhibitedContent(subjectOfInputData(")
    expect(gate.indexOf("refuseProhibitedContent(")).toBeLessThan(gate.indexOf("applyJobRequestPolicies("))
  })

  it("the workflow engine asks the guard on the built payload, before the reservation", () => {
    const src = read("services/workflow-engine/node-executor.ts")
    const fn = src.slice(src.indexOf("async function executeWorkerNode("))
    const built = fn.indexOf("buildPayloadWithSourceSize(")
    const asked = fn.indexOf("refuseProhibitedPayload(jobId")
    const reserved = fn.indexOf("CreditsService.reserveCredits(")
    expect(built).toBeGreaterThan(-1)
    expect(asked, "executeWorkerNode no longer asks the guard about its payload").toBeGreaterThan(built)
    expect(asked, "the guard must be asked before the reservation").toBeLessThan(reserved)
  })

  it("a block that escapes a route answers the platform's shape", () => {
    const src = read("lib/http-errors.ts")
    const handler = src.slice(src.indexOf("export function registerRefusalErrorHandler("))
    expect(handler).toContain("jobBlockOf(error)")
    expect(handler).toContain("jobBlockedBody(")
  })

  it("character training, a lane with no prompt, asks about what the character says", () => {
    const src = read("routes/character-training.ts")
    expect(src).toContain("refuseProhibitedContent(subjectOfInputData(")
    expect(src.indexOf("refuseProhibitedContent(")).toBeLessThan(src.indexOf("insertJob(req"))
  })

  it("the image build proves the plugin's guard is ready, so a bad build never deploys", () => {
    const dockerfile = readFileSync(resolve(SRC, "..", "..", "Dockerfile"), "utf8")
    expect(dockerfile).toContain("import('@nodaroai/cloud-plugins/content-guard')")
    expect(dockerfile).toContain("m.contentGuard.proveReady()")
  })

  it("every process that registers the prompt policies also loads the guard", () => {
    // Read from the entry files themselves, so a new process cannot be left off a list.
    // server.ts and video-director.ts boot through buildApp(), so app.ts covers them.
    const entries = readdirSync(SRC).filter((f) => f.endsWith(".ts") && read(f).includes("registerMainlinePromptPolicies("))
    expect(entries).toEqual(expect.arrayContaining(["app.ts", "worker.ts", "orchestrator.ts", "pipeline-worker.ts", "render-worker.ts", "plugin-daemons.ts"]))
    for (const entry of entries) {
      expect(read(entry), `${entry} never loads the content guard`).toContain("await loadContentGuard()")
    }
  })
})
