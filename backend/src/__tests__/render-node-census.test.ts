/**
 * The render-node census (SV18, decided 2026-10-06).
 *
 * "The render node" used to mean `"apply-edl"` written out at every site that
 * gives a render its meaning — review, privacy, the latest-batch reader, the
 * owner-only listing, the json-as-transcript walk. A second render (Speaker
 * View) would have had to find all of them. They now read `RENDER_NODE_TYPES`
 * (`@nodaro/shared` render-nodes.ts), and this census keeps it that way: every
 * `apply-edl` string literal in the code (any quote style, composites such as
 * `apply-edl:proxy` included) must be on the allowlist below, and every
 * allowlist entry must still exist.
 *
 * Keyed by CONTENT and COUNT, never by file alone: a new literal added inside
 * an allowlisted file still fails, because its key (or the count of an
 * existing key) is new. The key of a line is its trimmed text up to the end of
 * its last literal, so an edit to the rest of the line (a node description, a
 * generated summary) does not churn the list.
 *
 * Failing here?
 *   - A new render-meaning site: read the registry instead (`isRenderNodeType`,
 *     `renderNodeOf(type)?.latestBatch`, `rendersTranscriptJson`, …).
 *   - A pure registration site of the Apply EDL node itself (its route, its
 *     handler, its node component, a registration table): add the key here,
 *     with the reason.
 *   - A site you removed: delete its entry.
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { describe, it, expect } from "vitest"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const SCAN_ROOTS = ["backend/src", "frontend/src", "packages"]
const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json)$/
const TEST_FILE = /\.(test|spec)\.[^.]+$/
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "__tests__", "__e2e__", "__fixtures__"])
/**
 * One `apply-edl` literal in any quote style: bare, composite (`apply-edl:proxy`),
 * a composite prefix with no suffix (`startsWith("apply-edl:")`), or an
 * interpolated composite (`` `apply-edl:${q}` ``, keyed up to the `${`).
 */
const LITERAL = /(["'`])apply-edl(?::[\w-]*)?(?:\1|\$\{)/g

const isCommentLine = (t: string): boolean => t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")

type Entry = readonly [file: string, key: string, why: string]

// Pure registration of the Apply EDL node, its pricing (moves to the registry's
// `creditId` with Speaker View's price, C4), and the few places where the
// literal names the node to itself. Nothing here decides what a render MEANS.
const ALLOWLIST: readonly Entry[] = [
  // ── Pricing (C4 reads the registry's creditId) ────────────────────────────
  ["backend/src/ee/billing/credits.ts", `"apply-edl"`, "pricing row (STATIC_CREDIT_COSTS)"],
  ["backend/src/ee/billing/credits.ts", `"apply-edl:proxy"`, "pricing row (STATIC_CREDIT_COSTS)"],
  ["backend/src/ee/billing/credits.ts", `if (nodeType === "apply-edl"`, "pricing: getModelIdentifier (C4)"],
  ["backend/src/ee/billing/credits.ts", `if (node.type !== "apply-edl"`, "pricing: the listing's per-minute units, read from @nodaro/render-rules (C4)"],
  ["backend/src/ee/billing/credits.ts", `if (node.type === "apply-edl"`, "pricing: the listing's per-episode-minute part, read from @nodaro/render-rules (C4)"],
  ["backend/src/lib/apply-edl-plan.ts", `"apply-edl"`, "pricing row (per-minute rate)"],
  ["backend/src/lib/apply-edl-plan.ts", `"apply-edl:proxy"`, "pricing row (per-minute rate)"],
  ["backend/src/lib/apply-edl-plan.ts", `if (jobName !== "apply-edl"`, "pricing: the reserve override (C4)"],
  ["frontend/src/components/editor/config-panels/helpers.ts", `if (nodeType === "apply-edl"`, "pricing: the editor's credit id (C4)"],
  ["frontend/src/components/editor/workflow-editor/types.ts", `"apply-edl"`, "pricing row (NODE_CREDIT_COSTS)"],
  ["frontend/src/components/editor/workflow-editor/types.ts", `"apply-edl:proxy"`, "pricing row (NODE_CREDIT_COSTS)"],
  ["frontend/src/components/editor/workflow-editor/types.ts", `if (nodeType === "apply-edl"`, "pricing: the per-minute rate (C4)"],
  ["frontend/src/components/editor/workflow-editor/types.ts", `"apply-edl"`, "pricing: OUTPUT_MINUTE_ESTIMATORS row (C4)"],
  ["frontend/src/components/editor/workflow-editor/types.ts", `unitKind: node.type === "apply-edl"`, "pricing: the confirm's per-minute unit (C4)"],
  ["packages/shared/src/credit-identifiers.ts", `export function applyEdlCreditId(quality: unknown): "apply-edl" | "apply-edl:proxy"`, "the credit-id function itself"],
  ["packages/shared/src/credit-identifiers.ts", `return quality === "proxy" ? "apply-edl:proxy" : "apply-edl"`, "the credit-id function itself"],

  // ── Backend registration ──────────────────────────────────────────────────
  ["backend/src/lib/job-budget.ts", `"apply-edl"`, "DECLARED_JOB_BUDGETS row"],
  ["backend/src/lib/mcp/generated/node-handles.ts", `"apply-edl"`, "generated handle map"],
  ["backend/src/lib/node-registry.ts", `{ type: "apply-edl"`, "GET /v1/nodes descriptor"],
  ["backend/src/lib/tutorial-seed/templates/podcast-clip-pack.json", `"apply-edl"`, "template"],
  ["backend/src/lib/tutorial-seed/templates/podcast-clip-pack.json", `"type": "apply-edl"`, "template"],
  ["backend/src/lib/tutorial-seed/templates/podcast-tighten-episode.json", `"apply-edl"`, "template"],
  ["backend/src/lib/tutorial-seed/templates/podcast-tighten-episode.json", `"type": "apply-edl"`, "template"],
  ["backend/src/lib/tutorial-seed/templates/podcast-multicam-cut.json", `"apply-edl"`, "template"],
  ["backend/src/lib/tutorial-seed/templates/podcast-multicam-cut.json", `"type": "apply-edl"`, "template"],
  ["backend/src/lib/tutorial-seed/templates/podcast-trailer-formats.json", `"apply-edl"`, "template"],
  ["backend/src/lib/tutorial-seed/templates/podcast-trailer-formats.json", `"type": "apply-edl"`, "template"],
  ["backend/src/providers/video/edl-timeline.ts", `export const APPLY_EDL_LABEL = "apply-edl"`, "the timeline's default label: Apply EDL's work dir, log and checkpoint prefix"],
  ["backend/src/routes/apply-edl.ts", `force_private: extractForcePrivate(req.body) || isPreviewRender("apply-edl"`, "the node's own route"],
  ["backend/src/routes/apply-edl.ts", `"apply-edl"`, "the node's own route (credit guard job)"],
  ["backend/src/routes/apply-edl.ts", `await videoQueue.add("apply-edl"`, "the node's own route (queue job)"],
  ["backend/src/services/workflow-engine/input-resolver.ts", `if (targetType === "apply-edl"`, "input-handle mapping"],
  ["backend/src/services/workflow-engine/payload-builder.ts", `case "apply-edl"`, "the node's payload case"],
  ["backend/src/services/workflow-engine/payload-builder.ts", `"apply-edl"`, "the node's payload case (job name)"],
  ["backend/src/workers/handlers/ffmpeg.ts", `handleApplyEdl.livenessBudgetMs = (job) => declaredJobBudgetMs("apply-edl"`, "the handler's own budget"],
  ["backend/src/workers/handlers/ffmpeg.ts", `"apply-edl"`, "handler map"],

  // ── Frontend registration ─────────────────────────────────────────────────
  ["frontend/src/components/editor/config-panel-label.ts", `"apply-edl"`, "display name"],
  ["frontend/src/components/editor/config-panel-node-sets.ts", `"merge-video-audio", "still-to-video", "slideshow", "combine-videos", "apply-edl"`, "config-panel node set"],
  ["frontend/src/components/editor/config-panel.tsx", `case "apply-edl"`, "config panel case"],
  ["frontend/src/components/editor/workflow-editor/execute-node.ts", `if (node.type === "apply-edl"`, "DAG execution block"],
  ["frontend/src/components/editor/workflow-editor/node-executors.ts", `{ resultFields: (od) => runResultIdentity("apply-edl"`, "inside the Apply EDL executor, naming itself"],
  ["frontend/src/components/editor/workflow-editor/node-input-resolver.ts", `if (node.type === "apply-edl"`, "input-handle mapping"],
  ["frontend/src/components/editor/workflow-editor/types.ts", `"apply-edl"`, "EXECUTABLE_TYPES"],
  ["frontend/src/components/nodes/apply-edl-node.tsx", `<HandleWithPopover nodeId={id} nodeType="apply-edl"`, "the node component's handles (edl)"],
  ["frontend/src/components/nodes/apply-edl-node.tsx", `<HandleWithPopover nodeId={id} nodeType="apply-edl"`, "the node component's handles (transcript)"],
  ["frontend/src/components/nodes/apply-edl-node.tsx", `<HandleWithPopover nodeId={id} nodeType="apply-edl"`, "the node component's handles (sources)"],
  ["frontend/src/components/nodes/apply-edl-node.tsx", `<HandleWithPopover nodeId={id} nodeType="apply-edl"`, "the node component's handles (media)"],
  ["frontend/src/components/nodes/apply-edl-node.tsx", `<HandleWithPopover nodeId={id} nodeType="apply-edl"`, "the node component's handles (json)"],
  ["frontend/src/components/nodes/index.ts", `"apply-edl"`, "nodeTypes map"],
  ["frontend/src/lib/connection-validation.ts", `if (targetType === "apply-edl"`, "input-handle validation"],
  ["frontend/src/lib/data-handles.ts", `"apply-edl"`, "data-handle registry"],
  ["frontend/src/lib/handle-output-types.ts", `"apply-edl"`, "handle output types"],
  ["frontend/src/lib/node-docs/node-docs-links.json", `"type": "apply-edl"`, "generated node-docs"],
  ["frontend/src/lib/node-docs/node-docs-map.generated.ts", `"apply-edl"`, "generated node-docs"],
  ["frontend/src/lib/node-docs/summaries/en.generated.ts", `"apply-edl"`, "generated node-docs"],
  ["frontend/src/lib/node-docs/summaries/ja.generated.ts", `"apply-edl"`, "generated node-docs"],
  ["frontend/src/lib/node-docs/summaries/pt-BR.generated.ts", `"apply-edl"`, "generated node-docs"],
  ["frontend/src/lib/node-families.ts", `types: ["trim-video", "combine-videos", "apply-edl"`, "node family"],
  ["frontend/src/lib/node-options.tsx", `type: "apply-edl"`, "NODE_OPTIONS"],
  ["frontend/src/lib/render-review-adapter.ts", `"apply-edl"`, "review adapter table, keyed by RENDER_NODE_TYPES (its totality test fails a missing id)"],
  ["frontend/src/lib/target-handle-registry.ts", `"apply-edl"`, "target-handle registry"],
  ["frontend/src/types/nodes.ts", `| "apply-edl"`, "SceneNodeType union"],
  ["frontend/src/types/nodes.ts", `type: "apply-edl"`, "NODE_DEFINITIONS"],

  // ── Packages registration ─────────────────────────────────────────────────
  ["packages/cli/src/commands/edit.ts", `.command("apply-edl"`, "CLI verb"],
  // Input lanes: Apply EDL ACCEPTS a transcript and an EDL. These are target
  // handles, not what its own json output is (that is `jsonKind`).
  ["packages/shared/src/fan-out-rows.ts", `transcript: ["add-captions", "apply-edl"`, "input lane (transcript handle)"],
  ["packages/shared/src/fan-out-rows.ts", `edl: ["apply-edl"`, "input lane (edl handle)"],
  ["packages/shared/src/producer-types.ts", `"apply-edl"`, "DYNAMIC_PRODUCER_TYPES"],
  ["packages/shared/src/render-nodes.ts", `"apply-edl"`, "THE registry entry"],
]

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(path, out)
    } else if (CODE_FILE.test(name) && !TEST_FILE.test(name)) {
      out.push(path)
    }
  }
}

/** A code line's census key: its trimmed text up to the end of its last literal, or null when it has none. */
function keyOfLine(line: string): string | null {
  const t = line.trim()
  if (isCommentLine(t)) return null
  let end = -1
  for (const m of t.matchAll(LITERAL)) end = m.index! + m[0].length
  return end < 0 ? null : t.slice(0, end)
}

/** Every literal-bearing code line, as `file|key` keys (repeats kept). */
function census(): { keys: string[]; scanned: number; where: Map<string, string[]> } {
  const files: string[] = []
  for (const root of SCAN_ROOTS) walk(join(REPO_ROOT, root), files)
  const keys: string[] = []
  const where = new Map<string, string[]>()
  for (const path of files) {
    const rel = relative(REPO_ROOT, path).split(sep).join("/")
    const lines = readFileSync(path, "utf8").split("\n")
    lines.forEach((line, i) => {
      const lineKey = keyOfLine(line)
      if (lineKey === null) return
      const key = `${rel}|${lineKey}`
      keys.push(key)
      where.set(key, [...(where.get(key) ?? []), `${rel}:${i + 1}`])
    })
  }
  return { keys, scanned: files.length, where }
}

const countOf = (keys: readonly string[]): Map<string, number> => {
  const m = new Map<string, number>()
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1)
  return m
}

describe("render-node census: what counts as an apply-edl literal", () => {
  it.each([
    [`if (type === "apply-edl") {`, `if (type === "apply-edl"`],
    ["const t = `apply-edl`", "const t = `apply-edl`"],
    [`const id = 'apply-edl:proxy'`, `const id = 'apply-edl:proxy'`],
    // A composite prefix with no suffix: how a site tells a Preview from a final.
    [`if (creditId.startsWith("apply-edl:")) {`, `if (creditId.startsWith("apply-edl:"`],
    // An interpolated composite id.
    ["const id = `apply-edl:${q}`", "const id = `apply-edl:${"],
  ])("keys %s", (line, key) => {
    expect(keyOfLine(line)).toBe(key)
  })

  it.each([
    [`const t = "apply-edl-multicam-master-audio"`],
    ["throw new Error(`apply-edl: segment[${i}] is out of range`)"],
    [`// if (type === "apply-edl")`],
  ])("does not key %s", (line) => {
    expect(keyOfLine(line)).toBeNull()
  })
})

describe("render-node census: no render-meaning site names apply-edl (SV18)", () => {
  const { keys, scanned, where } = census()

  it("scans the code it means to (sanity)", () => {
    expect(scanned).toBeGreaterThan(1000)
    expect(keys.length).toBeGreaterThan(0)
  })

  it("finds no apply-edl literal outside the registration allowlist", () => {
    const allowed = countOf(ALLOWLIST.map(([file, key]) => `${file}|${key}`))
    const actual = countOf(keys)
    const extra: string[] = []
    for (const [key, n] of actual) {
      const over = n - (allowed.get(key) ?? 0)
      if (over > 0) extra.push(`${(where.get(key) ?? []).join(", ")}  ×${over}  ${key.split("|")[1]}`)
    }
    expect(extra, "read RENDER_NODE_TYPES (@nodaro/shared) here instead of naming apply-edl").toEqual([])
  })

  it("keeps no stale allowlist entry", () => {
    const allowed = countOf(ALLOWLIST.map(([file, key]) => `${file}|${key}`))
    const actual = countOf(keys)
    const stale: string[] = []
    for (const [key, n] of allowed) {
      const under = n - (actual.get(key) ?? 0)
      if (under > 0) stale.push(`×${under}  ${key}`)
    }
    expect(stale, "delete these allowlist entries: the line is gone").toEqual([])
  })
})
