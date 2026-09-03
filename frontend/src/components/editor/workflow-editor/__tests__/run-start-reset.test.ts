import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, relative, resolve } from "node:path"

/**
 * A run start must CLEAR the previous run's failure, not just announce the new
 * one — the same totality problem as `poll-job-wrapper.test.ts`, one field over.
 *
 * `updateNodeData` is a shallow merge, so a patch that writes
 * `executionStatus: "running"` and nothing else leaves the last run's
 * `errorMessage`, `errorHint` and `jobAwaitingReview` sitting on the node. That
 * was survivable while a stale hint only tinted a card. It is not survivable
 * now: <NodePolicyOverlay> paints an opaque panel on `failed && errorHint.kind
 * === "policy-block"`, and generate-image-node / video-retake-node suppress
 * their own failed block when that hint is present. So run 1 gets blocked by a
 * content policy, run 2 fails for an unrelated reason (402, a network error,
 * the poller giving up), and the user reads run 1's moderation sentence with no
 * trace of what actually just happened.
 *
 * 28 of the 39 run-start patches cleared `errorMessage` only, and 8 cleared
 * nothing at all. Fixing them one by one is what this guard exists to make
 * permanent: `RUN_START_RESET` is the single spread, and a new loop that spells
 * the status out by hand fails the build with the file and line.
 *
 * The escape hatch is per CALL SITE (`// run-start-reset-ok: <why>`), never a
 * file allowlist — a whole-file exemption is precisely how the refine poller
 * hid from the wrapper guard for a release.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = resolve(HERE, "..")
const EDITOR = resolve(HERE, "../..")

/** Same scope as the wrapper guard: a config panel starts runs too. */
const DIRS = [DIR, resolve(EDITOR, "config-panels")]

const RUN_START = /executionStatus:\s*["']running["']/
const SITE_EXEMPTION = /\/\/\s*run-start-reset-ok:\s*\S/
/** A `//` or `*` line is prose — this file's own doc comment quotes the literal. */
const COMMENT = /^\s*(\/\/|\*|\/\*)/
/** The constant's own definition, skipped by SHAPE rather than by filename. */
const DEFINITION_OPEN = /^export const RUN_START_RESET = \{/
const DEFINITION_CLOSE = /^\} as const;?/

interface SourceFile {
  readonly label: string
  readonly path: string
}

function sourceFiles(): SourceFile[] {
  return DIRS.flatMap((dir) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx")))
      .map((e) => ({ label: relative(EDITOR, resolve(dir, e.name)), path: resolve(dir, e.name) })),
  ).sort((a, b) => a.label.localeCompare(b.label))
}

/** Lines that are neither prose nor the constant's own body. */
function codeLines(src: string): Array<{ line: string; n: number }> {
  const out: Array<{ line: string; n: number }> = []
  let inDefinition = false
  src.split("\n").forEach((line, i) => {
    if (DEFINITION_OPEN.test(line)) inDefinition = true
    else if (inDefinition && DEFINITION_CLOSE.test(line)) inDefinition = false
    else if (!inDefinition && !COMMENT.test(line)) out.push({ line, n: i + 1 })
  })
  return out
}

describe("run-start patches reset the whole run state", () => {
  it("every run start goes through RUN_START_RESET", () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      for (const { line, n } of codeLines(readFileSync(file.path, "utf8"))) {
        if (!RUN_START.test(line)) continue
        if (SITE_EXEMPTION.test(line)) continue
        offenders.push(`${file.label}:${n}  ${line.trim()}`)
      }
    }
    expect(
      offenders,
      "A run-start patch writes `executionStatus: \"running\"` by hand, so the " +
        "previous run's errorMessage / errorHint / jobAwaitingReview survive into " +
        "this one and the policy overlay paints a stale block over an unrelated " +
        "failure. Spread `...RUN_START_RESET` from ./poll-job (site-specific keys " +
        "go after it), or — if the patch is a mid-run status TICK rather than a " +
        "run start — mark the line `// run-start-reset-ok: <reason>` and add it to " +
        "the marker count below.",
    ).toEqual([])
  })

  it("per-site exemptions stay countable (no quiet proliferation)", () => {
    const actual: Record<string, number> = {}
    for (const file of sourceFiles()) {
      const n = readFileSync(file.path, "utf8")
        .split("\n")
        .filter((l) => SITE_EXEMPTION.test(l)).length
      if (n > 0) actual[file.label] = n
    }
    expect(actual).toEqual({
      // restorePollingForRunningJobs' backend-driven tick: the run started
      // elsewhere, and this patch mirrors orchestrator state onto the node.
      "workflow-editor/run-handlers.ts": 1,
    })
  })

  it("the reset is actually SPREAD at every run start (not merely absent)", () => {
    // Without this, deleting a loop — or renaming the constant — would make the
    // guard above pass vacuously.
    const expected: Record<string, number> = {
      "workflow-editor/execute-node.ts": 27,
      "workflow-editor/asset-executors.ts": 5,
      "workflow-editor/component-executor.ts": 1,
      "workflow-editor/list-execution.ts": 1,
      "workflow-editor/node-executors.ts": 2,
      "workflow-editor/sub-workflow-executor.ts": 1,
      // pollJobWithNodeUpdate + pollImageRefineToNode.
      "workflow-editor/poll-job.ts": 2,
    }
    const actual: Record<string, number> = {}
    for (const label of Object.keys(expected)) {
      actual[label] = readFileSync(resolve(EDITOR, label), "utf8").split("...RUN_START_RESET").length - 1
    }
    expect(actual).toEqual(expected)
  })

  it("the reset covers every key a stale run can leak through", () => {
    // The constant is the whole contract: a key added to a failure patch but
    // not here is a new leak with no guard.
    const src = readFileSync(resolve(DIR, "poll-job.ts"), "utf8")
    const body = src.slice(src.indexOf("export const RUN_START_RESET = {"))
    const block = body.slice(0, body.indexOf("} as const;"))
    for (const key of [
      "executionStatus",
      "errorMessage",
      "errorHint",
      "currentJobId",
      "currentJobProgress",
      "jobAwaitingReview",
    ]) {
      expect(block, `RUN_START_RESET must reset ${key}`).toContain(`${key}:`)
    }
  })
})
