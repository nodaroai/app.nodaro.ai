/**
 * The node types the workflow run engine skips: it never executes them, so a
 * run never makes a fresh output for one. The engine reads this set
 * (backend `workflow-engine/execution-graph.ts`, `isSkipNode`), and so does
 * the measured walk of the run estimates (`measuredWireLengthSec`), which
 * never counts one as running — one set, so the two cannot drift.
 *
 * - Group and Collect: non-executable aggregators resolved at field-resolution
 *   time. The orchestrator skips them entirely; downstream extractor cases
 *   (output-extractor.ts) materialize their structured-list output from
 *   upstream member nodes (Group via parentId membership, Collect via order[]
 *   array).
 * - Visual / config-only nodes that are NOT executable, NOT parameter pickers,
 *   and produce no DAG output. Without an explicit classification they fall
 *   through the orchestrator's executable filter → buildPayload throws
 *   "Unknown node type" → the ENTIRE workflow fails on any full server-side run
 *   (webhook / schedule / MCP / published-app) or the default Run button. The
 *   frontend masks this because it gates on EXECUTABLE_TYPES. The platform's
 *   own film template ships a sticky-note (lib/film-template.ts), so film
 *   workflows hit this. Guarded by node-registry-sync.test.ts (full nodeTypes
 *   map, not just NODE_REGISTRY).
 */
export const ENGINE_SKIPPED_NODE_TYPES: ReadonlySet<string> = new Set([
  "manual-edit",
  "sub-workflow-output",
  "group",
  "collect",
  "sticky-note", // free-form canvas annotation
  "provider", // emits a provider value consumed at field-mapping time, not via DAG execution
  "rss-feed", // legacy/commented-out source; no executable handler — skip rather than crash
])
