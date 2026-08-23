/**
 * Workflow Copilot — the numbers and lists every other module keys off.
 * One place, so a cap change cannot leave a sibling module on the old value.
 */
import type { Scope } from "../../lib/scopes.js"

export const COPILOT_FEATURE = "workflow-copilot" as const
export const COPILOT_MODEL_ID = "claude-sonnet-5" as const
export const COPILOT_REASONING_EFFORT = "high" as const

/** Per-turn caps. The USD budget is derived from the credit reservation at run time. */
export const TURN_CAPS = {
  maxIterations: 12,
  maxToolCalls: 24,
  wallClockMs: 8 * 60_000,
  /** The hard timer that ends the HTTP stream even if the loop misbehaves. */
  hardTimeoutMs: 9 * 60_000,
  maxTokensPerCall: 16_384,
  maxToolResultChars: 24_000,
  /** Identical (name + canonical args) calls tolerated before short-circuiting. */
  identicalCallLimit: 3,
  /** Replayed history budget in estimated tokens (chars / 4). */
  historyTokenBudget: 120_000,
  /** Rows fetched for replay. Each may be 256 KB, so the tail is loaded, not the thread. */
  historyMessageLimit: 60,
  contextPreambleMaxChars: 8_000,
  /** Stop before the NEXT call could push spend past this share of the reservation. */
  budgetSafetyShare: 0.85,
} as const

/** Thread-level caps. */
export const THREAD_CAPS = {
  userTurnsPerThread: 200,
  activeThreadsPerUser: 50,
  turnsPerUserPerDay: 150,
  messageMaxChars: 16_000,
  /** Messages older than this archive are deleted by the cleanup cron. */
  archivedRetentionDays: 90,
} as const

/**
 * Liveness. The runner ticks `heartbeat_at` on its own interval (NOT once per
 * model call — one call with adaptive thinking can run for minutes), and a
 * turn is only considered dead when several ticks in a row are missing.
 */
export const HEARTBEAT_INTERVAL_MS = 20_000
export const TURN_HEARTBEAT_STALE_MS = 3 * 60_000

/** Credits: a user below this balance cannot start a turn (402 with required = floor). */
export const RESERVATION_FLOOR_CREDITS = 20

/** Scopes the copilot's MCP server is built with — deliberately no `workflows:write`. */
export const COPILOT_SCOPES: readonly Scope[] = [
  "workflows:read",
  "workflows:execute",
  "jobs:read",
  "assets:read",
  "credits:read",
  "presets:read",
]

/**
 * MCP tools the model may see AND call. Everything else registered under the
 * scopes above (≈100 generation verbs) is unreachable — enforced at callTool,
 * not only at list time.
 */
export const MCP_TOOL_ALLOWLIST: ReadonlySet<string> = new Set([
  "diagnose_run",
  "get_job",
  "get_node_skill",
  "get_picker_catalog",
  "list_models",
  "list_node_presets",
  "get_node_preset",
  "get_recipe",
  "list_brand_presets",
  "list_characters",
  "get_character",
  "list_locations",
  "get_location",
  "check_balance",
])

/** Native copilot tool names. */
export const NATIVE_TOOLS = {
  getGraph: "get_graph",
  editWorkflow: "edit_workflow",
  runWorkflow: "run_workflow",
  getExecution: "get_execution",
} as const

/** Graph size caps for edit_workflow. */
export const GRAPH_CAPS = {
  maxNodes: 250,
  maxEdges: 500,
  maxJsonBytes: 1_500_000,
} as const

/** Canonical node-id shape the editor and the delta RPC expect. */
export const NODE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

/** Auto-layout spacing (matches the skill doc's "~340 per stage, ~280 per row"). */
export const LAYOUT = { columnGap: 340, rowGap: 280 } as const
