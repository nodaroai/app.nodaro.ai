/**
 * L1#1 — NODE_REGISTRY × EXECUTABLE_TYPES × PARAMETER_NODE_TYPES × SOURCE_NODE_TYPES sync.
 *
 * Every node type in the curated `NODE_REGISTRY` (the source of truth for
 * `GET /v1/nodes` discovery) must be classified somewhere — otherwise the
 * orchestrator and the frontend disagree on what to do with it at runtime.
 *
 * The four classifications:
 *   - EXECUTABLE_TYPES (frontend Run button + backend `buildPayload` switch)
 *   - PARAMETER_NODE_TYPES (orchestrator reads prompt hint via getParameterPromptHint, no execution)
 *   - SOURCE_NODE_TYPES (orchestrator reads raw output from `node.data`, no execution)
 *   - SKIP_NODE_TYPES (orchestrator intentionally skips, e.g. manual-edit)
 *
 * If a node ends up in NODE_REGISTRY but in NONE of these sets, the orchestrator
 * creates a `pending` jobs row, `buildPayload` throws "Unknown node type", and
 * the entire workflow fails. This was the action-fx (#1649 era) and loop-subject
 * (#2132) outage class — the type was added to one registry but missed from
 * the others.
 *
 * Conflicts are equally bad: a node in both EXECUTABLE_TYPES and
 * PARAMETER_NODE_TYPES means the frontend creates a job that the backend
 * silently short-circuits — the user's Run click does nothing visible.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { NODE_REGISTRY } from "../node-registry.js"
import { PARAMETER_NODE_TYPES } from "@nodaro/shared"
import { isSourceNode, isSkipNode } from "@/services/workflow-engine/execution-graph.js"

// REPO_ROOT: backend/src/lib/__tests__/ → up 4 → repo root
const REPO_ROOT = join(__dirname, "..", "..", "..", "..")
const FRONTEND_TYPES_PATH = join(
  REPO_ROOT,
  "frontend/src/components/editor/workflow-editor/types.ts",
)

/**
 * Extract the EXECUTABLE_TYPES set from frontend types.ts via regex. The set
 * lives in a separate package the backend can't import at compile time, so we
 * read the source as text. The expected declaration shape:
 *
 *   export const EXECUTABLE_TYPES = new Set([
 *     "generate-image",
 *     "image-to-video",
 *     ...
 *   ]);
 */
function extractFrontendExecutableTypes(): Set<string> {
  const source = readFileSync(FRONTEND_TYPES_PATH, "utf8")
  const match = source.match(
    /export const EXECUTABLE_TYPES\s*=\s*new Set\(\s*\[([\s\S]*?)\]\s*\)/,
  )
  if (!match) {
    throw new Error(
      `Couldn't extract EXECUTABLE_TYPES from ${FRONTEND_TYPES_PATH}. Has the declaration syntax changed? Update extractFrontendExecutableTypes() in this test file to match.`,
    )
  }
  const body = match[1] ?? ""
  const types = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1])
  return new Set(types)
}

const FRONTEND_EXECUTABLE_TYPES = extractFrontendExecutableTypes()

// ---------------------------------------------------------------------------
// Sanity check on the regex extraction itself — if this breaks, every other
// test in this file is meaningless.
// ---------------------------------------------------------------------------

describe("FRONTEND_EXECUTABLE_TYPES extraction sanity", () => {
  it("found a non-trivial number of executable types (>= 50)", () => {
    expect(FRONTEND_EXECUTABLE_TYPES.size).toBeGreaterThanOrEqual(50)
  })

  it("contains a baseline of types known to exist", () => {
    expect(FRONTEND_EXECUTABLE_TYPES.has("generate-image")).toBe(true)
    expect(FRONTEND_EXECUTABLE_TYPES.has("image-to-video")).toBe(true)
    expect(FRONTEND_EXECUTABLE_TYPES.has("ai-writer")).toBe(true)
    expect(FRONTEND_EXECUTABLE_TYPES.has("render-video")).toBe(true)
  })

  it("does NOT contain known parameter types (proves we extracted the right block)", () => {
    expect(FRONTEND_EXECUTABLE_TYPES.has("text-prompt")).toBe(false)
    expect(FRONTEND_EXECUTABLE_TYPES.has("framing")).toBe(false)
    expect(FRONTEND_EXECUTABLE_TYPES.has("action-fx")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Test 1 — every NODE_REGISTRY entry is classified.
// ---------------------------------------------------------------------------

describe("NODE_REGISTRY entries are classified", () => {
  it.each(NODE_REGISTRY.map((n) => [n.type, n.label] as const))(
    'node type "%s" (label: %s) is in EXECUTABLE_TYPES, PARAMETER_NODE_TYPES, SOURCE_NODE_TYPES, or SKIP_NODE_TYPES',
    (type) => {
      const classifications: string[] = []
      if (FRONTEND_EXECUTABLE_TYPES.has(type)) classifications.push("EXECUTABLE_TYPES")
      if (PARAMETER_NODE_TYPES.has(type)) classifications.push("PARAMETER_NODE_TYPES")
      if (isSourceNode(type)) classifications.push("SOURCE_NODE_TYPES")
      if (isSkipNode(type)) classifications.push("SKIP_NODE_TYPES")

      expect(
        classifications.length,
        `Node type "${type}" appears in NODE_REGISTRY (backend/src/lib/node-registry.ts) but is in NONE of the four classification sets — at runtime, the orchestrator will create a stale "pending" jobs row and buildPayload will throw "Unknown node type", failing the workflow. Classify it as one of:
  • Executable (frontend Run button + backend buildPayload switch case): add to EXECUTABLE_TYPES in frontend/src/components/editor/workflow-editor/types.ts AND a case in backend/src/services/workflow-engine/payload-builder.ts
  • Parameter (orchestrator reads prompt hint from node.data, no execution): add to PARAMETER_NODE_TYPES in packages/shared/src/parameter-node-value.ts AND a case in getParameterValue + getParameterPromptHint
  • Source (orchestrator reads raw output from node.data, no execution): add to SOURCE_NODE_TYPES in backend/src/services/workflow-engine/execution-graph.ts
  • Skip (orchestrator intentionally skips): add to SKIP_NODE_TYPES in same file
`,
      ).toBeGreaterThan(0)
    },
  )
})

// ---------------------------------------------------------------------------
// Test 2 — no conflicting overlaps between classification sets.
// PARAMETER ∩ SOURCE is allowed (e.g. text-prompt is intentionally in both —
// the orchestrator-worker checks isSourceNode first, so the parameter path is
// dead but harmless). EXECUTABLE conflicts are NOT allowed.
// ---------------------------------------------------------------------------

describe("Classification sets have no conflicting overlaps", () => {
  it("EXECUTABLE_TYPES ∩ PARAMETER_NODE_TYPES = ∅", () => {
    const overlap = [...FRONTEND_EXECUTABLE_TYPES].filter((t) =>
      PARAMETER_NODE_TYPES.has(t),
    )
    expect(
      overlap,
      `Conflict: these types are in BOTH EXECUTABLE_TYPES (frontend) AND PARAMETER_NODE_TYPES (shared). The frontend Run button would dispatch a job, but the backend orchestrator would short-circuit them as parameter nodes (read prompt hint from data, never execute). The frontend dispatch silently dies. Pick one classification: ${overlap.join(", ")}`,
    ).toEqual([])
  })

  it("EXECUTABLE_TYPES ∩ SOURCE_NODE_TYPES = ∅", () => {
    const overlap = [...FRONTEND_EXECUTABLE_TYPES].filter((t) => isSourceNode(t))
    expect(
      overlap,
      `Conflict: these types are in BOTH EXECUTABLE_TYPES (frontend) AND SOURCE_NODE_TYPES (backend execution-graph). The frontend Run button would dispatch a job, but the backend would treat them as source nodes (read output from node.data, never execute). Pick one classification: ${overlap.join(", ")}`,
    ).toEqual([])
  })

  it("EXECUTABLE_TYPES ∩ SKIP_NODE_TYPES = ∅", () => {
    const overlap = [...FRONTEND_EXECUTABLE_TYPES].filter((t) => isSkipNode(t))
    expect(
      overlap,
      `Conflict: these types are in BOTH EXECUTABLE_TYPES (frontend) AND SKIP_NODE_TYPES (backend execution-graph). The frontend Run button would dispatch but the backend would skip them entirely. Pick one classification: ${overlap.join(", ")}`,
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Test 3 — every PARAMETER_NODE_TYPES entry NOT also in SOURCE_NODE_TYPES is
// absent from EXECUTABLE_TYPES. (Source-and-parameter overlaps are deliberate;
// pure-parameter must never be executable.)
// ---------------------------------------------------------------------------

describe("PARAMETER_NODE_TYPES entries are not falsely executable", () => {
  it("every pure-parameter type is excluded from EXECUTABLE_TYPES", () => {
    const offenders: string[] = []
    for (const type of PARAMETER_NODE_TYPES) {
      if (isSourceNode(type)) continue // text-prompt etc. — handled by Source path
      if (FRONTEND_EXECUTABLE_TYPES.has(type)) offenders.push(type)
    }
    expect(
      offenders,
      `These parameter types are listed in EXECUTABLE_TYPES — the frontend will create a job that the backend orchestrator immediately short-circuits. Either remove from EXECUTABLE_TYPES (correct fix), or remove from PARAMETER_NODE_TYPES (only if the type really should execute): ${offenders.join(", ")}`,
    ).toEqual([])
  })
})
