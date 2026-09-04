import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, relative, resolve } from "node:path"

// __dirname shim for ESM — mirrors abandon-guard.test.ts. This file sits in
// workflow-editor/__tests__/, so the loop modules are one level up.
const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = resolve(HERE, "..")
const EDITOR = resolve(HERE, "../..")

/**
 * Every directory that can hold a node-owning poll loop.
 *
 * `config-panels/` is here because scoping this guard to `workflow-editor/` is
 * what let `refine-regions-section.tsx`'s detect loop read raw status for a
 * whole release: a config panel owns a nodeId just as much as an executor
 * does. A guard whose blast radius is one directory only proves things about
 * that directory.
 */
const DIRS = [DIR, resolve(EDITOR, "config-panels")]

/**
 * `jobAwaitingReview` is READ centrally (BaseNode mounts <NodePolicyOverlay>
 * once, so all 98 node cards get it) but must be WRITTEN by every node-owning
 * poll loop — and there are 22 of them, in seven files (the count the second
 * assertion below pins, file by file).
 *
 * `jobRecovering` is the cautionary tale: it was added as a PROP on the node
 * cards and is passed by 1 of 98 call sites, so "Recovering…" has never
 * reached a user. This guard is why loop #23 cannot repeat that: a new poll
 * loop that calls `getJobStatusLean` directly fails the build with the file
 * and line, and the fix is one identifier.
 *
 * The allowlist is by SHAPE, not by line number — line numbers move the
 * moment anyone edits one of these 8k-line files.
 */
const RAW = "getJobStatusLean("
const CALL = "await getJobStatusLeanForNode("

/** Files whose every raw call is legitimate, each for a stated reason.
 *
 *  Whole-FILE exemptions are a blunt instrument and the reason they exist here
 *  is that the file cannot carry a marker comment cheaply. `poll-job.ts` used
 *  to be on this list under the reason "its own refine poller
 *  (pollJobToCompletion) … owns no node to paint" — which was factually wrong:
 *  the refine poller is `pollImageRefineToNode`, it DOES own a canvas node, and
 *  the file-wide exemption is what hid that from this guard. Exemptions are now
 *  per CALL SITE (see SITE_EXEMPTION) for every file that can carry one. */
const ALLOWED_FILES: Record<string, string> = {
  // Bounded 30-min loop that breaks out of a hold with its own error instead
  // of painting an overlay (spec §6.5, 17.10 — the budget freeze is deferred).
  "component-executor.ts": "bounded loop; breaks out on pending_review",
}

/**
 * Final-verification re-reads inside a `catch` after MAX_CONSECUTIVE_POLL_FAILURES.
 * The node is about to go terminal either way, so the flag write is noise.
 * Matched by SHAPE (`const finalJob = …`), so the exemption is legible at the
 * call site rather than hidden in a list here.
 */
const FINAL_VERIFICATION = /const finalJob = await getJobStatusLean\(/

/**
 * A raw read that legitimately owns no node to paint, exempted AT THE CALL SITE
 * with its reason — `// raw-status-ok: <why>`. Counted below, so markers cannot
 * quietly multiply.
 */
const SITE_EXEMPTION = /\/\/\s*raw-status-ok:\s*\S/

interface SourceFile {
  /** Basename — what ALLOWED_FILES keys on. */
  readonly name: string
  /** Path relative to `components/editor`, for legible failure messages. */
  readonly label: string
  readonly path: string
}

function sourceFiles(): SourceFile[] {
  return DIRS.flatMap((dir) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx")))
      .map((e) => ({ name: e.name, label: relative(EDITOR, resolve(dir, e.name)), path: resolve(dir, e.name) })),
  ).sort((a, b) => a.label.localeCompare(b.label))
}

describe("poll-loop wrapper coverage", () => {
  it("every node-owning poll loop reads job status through getJobStatusLeanForNode", () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      if (file.name in ALLOWED_FILES) continue
      const lines = readFileSync(file.path, "utf8").split("\n")
      lines.forEach((line, i) => {
        if (!line.includes(RAW)) return
        if (FINAL_VERIFICATION.test(line)) return
        if (SITE_EXEMPTION.test(line)) return
        offenders.push(`${file.label}:${i + 1}  ${line.trim()}`)
      })
    }
    expect(
      offenders,
      "A node-owning poll loop calls getJobStatusLean directly, so a held job " +
        "paints a bare spinner with no explanation. Use getJobStatusLeanForNode" +
        "(jobId, nodeId) from ./poll-job, or — if the loop genuinely owns no " +
        "node — mark the call site `// raw-status-ok: <reason>` and add it to " +
        "the marker count below.",
    ).toEqual([])
  })

  it("the 22 node-owning sites are actually wrapped (not merely absent)", () => {
    // A rename or a deleted loop would make the guard above pass vacuously.
    // Counted as CALLS (`await getJobStatusLeanForNode(`) so poll-job.ts's own
    // function DECLARATION doesn't inflate its number. Keyed by path relative
    // to components/editor, since the scan is no longer one directory.
    const expected: Record<string, number> = {
      "workflow-editor/asset-executors.ts": 5,
      "workflow-editor/execute-node.ts": 10,
      "workflow-editor/node-executors.ts": 2,
      // pollJobWithNodeUpdate + pollImageRefineToNode (the reference-board
      // refine / region-edit lane, wrapped after it was found outside).
      "workflow-editor/poll-job.ts": 2,
      "workflow-editor/run-handlers.ts": 1,
      "workflow-editor/scene-story-handlers.ts": 1,
      // The config panel's own detect loop — outside workflow-editor/, which is
      // exactly why the guard never saw it until the scan widened.
      "config-panels/refine-regions-section.tsx": 1,
    }
    const actual: Record<string, number> = {}
    for (const label of Object.keys(expected)) {
      const src = readFileSync(resolve(EDITOR, label), "utf8")
      actual[label] = src.split(CALL).length - 1
    }
    expect(actual).toEqual(expected)
  })

  it("per-site raw-read exemptions stay countable (no quiet proliferation)", () => {
    // The marker is the escape hatch from the guard above. Pinning the count
    // means adding one is a deliberate, reviewed act — the same reason the
    // wrapped-site count is pinned.
    const actual: Record<string, number> = {}
    for (const file of sourceFiles()) {
      const src = readFileSync(file.path, "utf8")
      // Only a marker ON a raw call line counts — prose that merely quotes the
      // marker (this guard's own doc comments do) is not an exemption.
      const n = src.split("\n").filter((l) => l.includes(RAW) && SITE_EXEMPTION.test(l)).length
      if (n > 0) actual[file.label] = n
    }
    expect(actual).toEqual({
      // getJobStatusLeanForNode's own read + pollJobToCompletion's loop, which
      // resolves a URL to a caller that paints and holds no nodeId.
      "workflow-editor/poll-job.ts": 2,
    })
  })
})
