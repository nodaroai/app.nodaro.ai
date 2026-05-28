/**
 * L2#1 — buildPayload registry walk.
 *
 * For every type the frontend will dispatch (`EXECUTABLE_TYPES`), assert that
 * `buildPayload` either returns a payload or throws something other than
 * "Unknown node type". The "Unknown node type" error means the type is in the
 * frontend's executable set but missing from the backend's `payload-builder.ts`
 * switch — at runtime this creates a `pending` jobs row, throws inside the
 * orchestrator, and dies. The action-fx outage class.
 *
 * Some `EXECUTABLE_TYPES` entries are deliberately routed AROUND `buildPayload`
 * by the executor: inline nodes, sync-HTTP nodes, and the special-cases
 * `component` / `sub-workflow`. This test mirrors the dispatch logic in
 * `node-executor.ts::executeNode` so it exempts those types correctly. The
 * exemption sets are expected to stay in sync with `node-executor.ts` —
 * `node-executor-categorization.test.ts` (companion) verifies that.
 *
 * Pairs with L1#1 (which only checks classification, not behavior).
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"

// REPO_ROOT: backend/src/services/workflow-engine/__tests__/ → up 5 → repo root
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..")
const FRONTEND_TYPES_PATH = join(
  REPO_ROOT,
  "frontend/src/components/editor/workflow-editor/types.ts",
)

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
  return new Set([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]))
}

const FRONTEND_EXECUTABLE_TYPES = extractFrontendExecutableTypes()

/**
 * Types that the executor routes AROUND buildPayload. Mirrors the dispatch
 * order in node-executor.ts::executeNode. Keep in sync with the constants
 * declared at the top of node-executor.ts. If a developer reclassifies a node
 * (e.g. moves something from worker-queued to inline), the corresponding
 * payload-builder switch case becomes dead — but the test on the new path
 * (sync-http-route-parity for SYNC_HTTP, inline-executor.test for INLINE)
 * picks up the slack. These exemptions are the contract between executor
 * and payload-builder.
 */
const NON_BUILDPAYLOAD_NODES: ReadonlySet<string> = new Set([
  // INLINE_NODES (executed by inline-executor.ts, no buildPayload call)
  "combine-text",
  "split-text",
  "composite",
  "webhook-output",
  "teleport-send",
  "teleport-receive",
  "router",
  "extract-field",
  "json-process",
  "filter-list",
  "deduplicate",
  "merge-lists",
  "sort-list",
  "selector",
  // Note: "preview" is in INLINE_NODES at runtime but is NOT in EXECUTABLE_TYPES
  // — the frontend treats it as a passive display node that updates reactively
  // when upstream completes. So we don't need to exempt it (the iteration
  // source filters it out already).
  // SYNC_HTTP_NODES (executed via internal fetch)
  // Note: "ai-writer" remains a SYNC_HTTP node in node-executor.ts for
  // back-compat (legacy saved nodes migrate to llm-chat on load), but it was
  // removed from the frontend EXECUTABLE_TYPES set when the editor type was
  // merged into "Generate Text" (llm-chat). Exemptions here must mirror
  // EXECUTABLE_TYPES (see the NON_BUILDPAYLOAD_NODES integrity test below), so
  // ai-writer is intentionally absent.
  "llm-chat",
  "video-composer",
  "after-effects",
  "lottie-overlay",
  "3d-title",
  "motion-graphics",
  "image-to-text",
  "suno-style-boost",
  "image-critic",
  "instagram-post",
  "tiktok-post",
  "youtube-upload",
  "linkedin-post",
  "x-post",
  "facebook-post",
  "telegram-post",
  "qa-check",
  "save-to-storage",
  "web-scrape",
  // Fan-in node — routed via sync-HTTP to POST /v1/reduce (see
  // SYNC_HTTP_NODES + SYNC_HTTP_ROUTES in node-executor.ts). The orchestrator
  // never calls buildPayload for reduce; payload-builder.ts therefore
  // has no case for it. Single-result wrap of N upstream values into 1.
  "reduce",
  // Special-case dispatch (handled by executeNode before INLINE/SYNC_HTTP)
  "component",
  "sub-workflow",
  // Generative Pipeline runs via the dedicated pipeline-orchestration queue
  // (POST /v1/pipelines), not the DAG. Treated as a no-op leaf by the DAG
  // executor in Phase 1A — see executeNode() in node-executor.ts.
  "generative-pipeline",
  // Phase 1B.2 pipeline-managed SceneNode — internal pipeline (keyframe gen
  // → animate → speech → lip_sync → combine) runs via the pipeline
  // orchestrator (Phase 1C). DAG treats it as a no-op success leaf — see
  // node-executor.ts. The legacy `case "scene"` in payload-builder.ts is
  // dead code as long as the short-circuit in node-executor.ts fires.
  "scene",
])

/**
 * Sanity check on the regex extraction. If this breaks, every other test in
 * this file would silently iterate an empty set.
 */
describe("FRONTEND_EXECUTABLE_TYPES extraction sanity", () => {
  it("found a non-trivial number of executable types (>= 50)", () => {
    expect(FRONTEND_EXECUTABLE_TYPES.size).toBeGreaterThanOrEqual(50)
  })
})

/**
 * The walk. For each EXECUTABLE_TYPES entry that's a worker-queued node (i.e.
 * NOT in NON_BUILDPAYLOAD_NODES), call buildPayload with a minimal fixture
 * and assert the error message is not "Unknown node type". Other errors
 * (missing required fields, invalid values) are acceptable signals that the
 * case exists and is performing input validation — those are caught by L2
 * unit tests for the specific node type.
 */
describe("buildPayload covers every worker-queued EXECUTABLE_TYPES entry", () => {
  const workerQueuedTypes = [...FRONTEND_EXECUTABLE_TYPES].filter(
    (t) => !NON_BUILDPAYLOAD_NODES.has(t),
  )

  it("the walk has at least 30 worker-queued types to check", () => {
    // Sanity: if the exemption set ever becomes too aggressive, we'd silently
    // not cover anything. Floor protects against that drift.
    expect(workerQueuedTypes.length).toBeGreaterThanOrEqual(30)
  })

  it.each(workerQueuedTypes)(
    'buildPayload has a switch case for worker-queued type "%s"',
    (type) => {
      const node: SimpleNode = { id: "test-n1", type, data: {} }
      let errorMessage: string | undefined
      try {
        buildPayload(node, "test-job-1", {}, undefined, {
          settings: undefined,
          nodes: [],
          edges: [],
          nodeStates: {},
        })
      } catch (e) {
        errorMessage = (e as Error).message ?? String(e)
      }

      // The specific error we're trying to prevent — buildPayload's default
      // case throws this when no switch case matches. Other errors (missing
      // required field, invalid value) mean the case exists and is doing
      // input validation; those are caught by per-type unit tests, not here.
      // ?? "" handles the success case (no throw → undefined errorMessage).
      expect(
        errorMessage ?? "",
        `buildPayload threw "Unknown node type: ${type}". The frontend will dispatch this node (it's in EXECUTABLE_TYPES), the executor will route it to the worker-queued path (not inline, not sync-HTTP), but the backend buildPayload switch is missing the case. Add a "case ${JSON.stringify(type)}: { ... }" block in backend/src/services/workflow-engine/payload-builder.ts. If this type is actually meant to be inline or sync-HTTP, add it to INLINE_NODES or SYNC_HTTP_NODES in node-executor.ts AND update NON_BUILDPAYLOAD_NODES in this test file.`,
      ).not.toMatch(/Unknown node type/)
    },
  )
})

/**
 * Reverse direction: every entry in NON_BUILDPAYLOAD_NODES is actually in
 * FRONTEND_EXECUTABLE_TYPES. If a type was removed from EXECUTABLE_TYPES but
 * left in our exemption set here, the exemption is dead and obscures whether
 * something is genuinely worker-queued.
 */
describe("NON_BUILDPAYLOAD_NODES integrity", () => {
  it("every exempted type is still in EXECUTABLE_TYPES", () => {
    const dead = [...NON_BUILDPAYLOAD_NODES].filter(
      (t) => !FRONTEND_EXECUTABLE_TYPES.has(t),
    )
    expect(
      dead,
      `These NON_BUILDPAYLOAD_NODES entries are no longer in EXECUTABLE_TYPES — remove them from this exemption list (they're dead): ${dead.join(", ")}`,
    ).toEqual([])
  })
})
