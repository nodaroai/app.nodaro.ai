/**
 * Workflow Copilot — the numbers and lists every other module keys off.
 * One place, so a cap change cannot leave a sibling module on the old value.
 */
import type { Scope } from "../../lib/scopes.js"

export const COPILOT_FEATURE = "workflow-copilot" as const

/**
 * The model ladder — the v1 plan's dormant design, activated. THREE tiers,
 * Claude-family only (the loop runs on the direct Anthropic SDK; KIE's proxy
 * mangles tool_use, and a cross-vendor loop would be a different loop), chosen
 * PER THREAD (the cached prompt prefix is per model — a per-message flip would
 * pay a full prefix rewrite every time).
 *
 * `registryId` prices the call (LLM_MODELS / calculateLlmCost); `anthropicModelId`
 * is what the SDK is asked for; `creditId` scales the reservation ceiling.
 * Economy carries NO reasoning effort — the registry declares none for Haiku.
 */
export type CopilotModelTier = "economy" | "standard" | "premium"

export interface CopilotTierSpec {
  readonly registryId: string
  readonly anthropicModelId: string
  readonly reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max"
  readonly creditId: string
}

export const COPILOT_TIERS: Record<CopilotModelTier, CopilotTierSpec> = {
  economy: {
    registryId: "claude-haiku-4.5",
    anthropicModelId: "claude-haiku-4-5-20251001",
    creditId: "workflow-copilot:economy",
  },
  standard: {
    registryId: "claude-sonnet-5",
    anthropicModelId: "claude-sonnet-5",
    reasoningEffort: "high",
    creditId: "workflow-copilot",
  },
  premium: {
    registryId: "claude-opus-5",
    anthropicModelId: "claude-opus-5",
    reasoningEffort: "xhigh",
    creditId: "workflow-copilot:premium",
  },
}

export const DEFAULT_COPILOT_TIER: CopilotModelTier = "standard"

/** Anything not exactly a known tier is standard — fail closed to the default. */
export function resolveCopilotTier(value: unknown): CopilotModelTier {
  return value === "economy" || value === "premium" ? value : DEFAULT_COPILOT_TIER
}

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
  /** Attached images fed to the model as vision blocks, per message. */
  maxVisionImages: 4,
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
  "check_balance",
  // The user's own saved things. All four kinds, so the copilot stops being
  // the only surface that cannot see half of someone's library.
  "list_characters",
  "get_character",
  "list_locations",
  "get_location",
  "list_objects",
  "get_object",
  "list_creatures",
  "get_creature",
  // Media the user already has. `browse_gallery` is pinned to their OWN rows
  // by FORCED_MCP_ARGS below — see the note there, it is not optional.
  "browse_gallery",
  "browse_uploads",
  "list_voices",
  // NOT list_favorites: its model-visible text is bare job ids. The hydrated
  // rows it builds go into structuredContent, which dispatch drops, so the
  // model would need one get_job per id to learn what any of them is —
  // prefix bytes on every turn for a capability it cannot actually use.
  // Worth revisiting if its TEXT ever carries names.
  // Their other work, for learning from a flow that already succeeds.
  "list_workflows",
  "list_components",
  "get_component_inputs",
])

/**
 * Arguments the copilot pins on an allowlisted MCP tool, whatever the model asks.
 *
 * `browse_gallery` takes `scope: "mine" | "public"`, and the public branch
 * returns OTHER users' rows — including 80 characters of each one's prompt.
 * Free and Basic outputs are public by definition, so anyone with a free
 * account can seed unlimited attacker-authored text into that corpus, and the
 * tool's own `query` argument is a steering wheel pointed straight at it. Every
 * other untrusted string the copilot reads was written by the user it is
 * working for; this one would not be.
 *
 * Pinned at DISPATCH rather than by narrowing the model-visible schema, for the
 * same reason the allowlist is enforced here: a schema describes, it does not
 * enforce. Merged after `...args` so a model-supplied value loses.
 */
export const FORCED_MCP_ARGS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  browse_gallery: { scope: "mine" },
  // Same shape, same reason. `list_components` DEFAULTS to the public
  // marketplace, whose rows carry another user's name, description and tags —
  // and `is_listed` is set straight from the publish request body, so listing
  // there is self-serve with no review. One API call puts arbitrary text in
  // front of every copilot.
  //
  // Pinning to "mine" keeps what this tool was allowlisted FOR — reusing the
  // user's own building blocks — and drops the part nobody asked for. Opening
  // the marketplace to the model is a separate decision that needs a
  // moderation story first, not a default.
  list_components: { scope: "mine" },
}

/** Native copilot tool names. */
export const NATIVE_TOOLS = {
  getGraph: "get_graph",
  editWorkflow: "edit_workflow",
  runWorkflow: "run_workflow",
  getExecution: "get_execution",
  remember: "remember",
} as const

/**
 * Per-user copilot memory (M1). User-scoped ONLY — cross-user learning is a
 * human-gated pipeline, never this table. A memory is cross-thread persistent,
 * which is why a URL inside one is rejected outright: it would be a
 * persistence/exfiltration channel that outlives the turn that wrote it.
 */
export const MEMORY_CAPS = {
  maxChars: 400,
  maxPerUser: 50,
  /** The injected preamble section's budget — newest memories survive. */
  blockMaxChars: 2_000,
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

/**
 * How much of a workflow name anything is allowed to carry.
 *
 * The name reaches the model in every turn's context preamble, so it is both a
 * standing token cost and a channel for pushing text at the model. The snapshot
 * truncates what it renders and `edit_workflow` truncates what it writes —
 * same number, one place, or the two drift and the write wins.
 */
export const MAX_WORKFLOW_NAME_CHARS = 120
