/**
 * The lane census for a render's stamps (A3-1): every source file that carries
 * a render's `clipKey` — the route, the worker, the payload builders, the
 * result lanes on both engines, the canvas repair, the SDK — carries its
 * `planBasis` too, and every lane that lands a FINISHED take carries its
 * `renderBasis`. A lane that dropped one would land takes the review reads as
 * stale forever (no basis = unknown), with nothing failing.
 *
 * `renderBasis` is stamped by the server from what it renders, never sent by a
 * client, so the files that only SEND a render (the editor's request, the SDK)
 * are exempt from it — listed below with that reason. A file that reads
 * `clipKey` for another purpose is exempt from both, with its reason.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, it, expect } from "vitest"

const ROOT = join(__dirname, "../../../..")

/** Files that send a render's request: the server stamps `renderBasis` itself. */
const SENDS_ONLY: Readonly<Record<string, string>> = {
  "frontend/src/lib/api.ts": "the editor's POST /v1/apply-edl body: planBasis is sent, renderBasis is the route's",
  "frontend/src/components/editor/workflow-editor/node-executors.ts": "runApplyEdl's request params",
  "frontend/src/components/editor/workflow-editor/execute-node.ts": "the browser lane builds the request",
  "packages/client/src/resources/edit.ts": "the public SDK's applyEdl input",
  "backend/src/lib/mcp/tools/verbs-video.ts": "the MCP apply_edl verb's request params",
}

/**
 * Senders of a render's `clipKey` that do not send `planBasis` yet, pending a
 * product decision: an MCP agent has no way to obtain a plan basis today (no
 * MCP result surfaces `renderReadBasis`), so a `plan_basis` parameter on the
 * apply_edl verb would be one no caller could fill. Exempt from the planBasis
 * check only; each still carries `renderBasis` or is in SENDS_ONLY.
 */
const PLAN_BASIS_PENDING: Readonly<Record<string, string>> = {
  "backend/src/lib/mcp/tools/verbs-video.ts": "MCP apply_edl: whether MCP surfaces a plan basis is undecided",
}

/** Files that read `clipKey` for something else entirely. */
const NOT_A_LANE: Readonly<Record<string, string>> = {
  "frontend/src/components/editor/workflow-editor/render-final-checks.ts":
    "finalIsUnchanged matches a render's last final by clip; it keeps its effective-EDL comparison (R19)",
}

const SCANNED = ["backend/src", "frontend/src", "packages/shared/src", "packages/client/src"]

/** Every non-test .ts/.tsx source file under the scanned roots, repo-relative. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__" && entry.name !== "node_modules" && entry.name !== "dist") out.push(...sourceFiles(path))
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(relative(ROOT, path))
    }
  }
  return out
}

function sourceFilesMentioning(word: string): string[] {
  return SCANNED.flatMap((root) => sourceFiles(join(ROOT, root))).filter((f) => readFileSync(join(ROOT, f), "utf8").includes(word))
}

describe("every lane that carries a render's clipKey carries its bases", () => {
  const lanes = sourceFilesMentioning("clipKey").filter((f) => !(f in NOT_A_LANE))

  it("finds the lanes (the census is not empty)", () => {
    expect(lanes.length).toBeGreaterThan(10)
  })

  it("planBasis rides every lane clipKey rides", () => {
    const missing = lanes
      .filter((f) => !(f in PLAN_BASIS_PENDING))
      .filter((f) => !readFileSync(join(ROOT, f), "utf8").includes("planBasis"))
    expect(missing, "carry planBasis beside clipKey in these files (or list them in NOT_A_LANE with a reason)").toEqual([])
  })

  it("renderBasis rides every lane that lands or stores a finished take", () => {
    const missing = lanes
      .filter((f) => !(f in SENDS_ONLY))
      .filter((f) => !readFileSync(join(ROOT, f), "utf8").includes("renderBasis"))
    expect(missing, "carry renderBasis beside clipKey in these files (or list them in SENDS_ONLY with a reason)").toEqual([])
  })

  it("the exemption lists name only files that still carry a clipKey", () => {
    for (const f of [...Object.keys(SENDS_ONLY), ...Object.keys(NOT_A_LANE), ...Object.keys(PLAN_BASIS_PENDING)]) {
      expect(readFileSync(join(ROOT, f), "utf8"), f).toContain("clipKey")
    }
  })
})
