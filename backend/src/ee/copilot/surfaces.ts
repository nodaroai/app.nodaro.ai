/**
 * The copilot's SURFACES.
 *
 * There is one copilot — one agent loop, one budget, one set of memories, one
 * cancel, one heartbeat — and two places it runs: the canvas, where it works
 * on a workflow graph, and the studio editor, where it works on a production.
 * Everything that differs between the two is this bundle, resolved once per
 * turn: the scopes the per-turn tool server is built with, the name that
 * request carries, which id is pinned on every call, the tools the model may
 * see and call, and the arguments the surface computes rather than lets the
 * model choose.
 *
 * Deliberately NOT named `surfaceProfile`: the deployment already has a
 * `runtimeSurfaceProfile()` that answers a completely different question
 * (which deployment this is). Two things called the surface profile in one
 * backend is a bug waiting for a hurried reader.
 *
 * The studio sets are DERIVED. The allowlist is the studio production family's
 * own name list minus the two production-level tools plus four reads, so a
 * nineteenth tool joins the surface the day it is registered — and arrives
 * with no class, which the partition test refuses. A hand-typed list here
 * would have drifted instead, quietly.
 */
import type { McpToolDef } from "../../lib/mcp/invoke.js"
import type { Scope } from "../../lib/scopes.js"
import {
  STUDIO_PRODUCTION_TOOL_NAMES,
  type StudioConfirmClass,
} from "../../lib/mcp/tools/_studio-helpers.js"
import { COPILOT_SCOPES, FORCED_MCP_ARGS, MCP_TOOL_ALLOWLIST, NATIVE_TOOLS, type CopilotSurface } from "./constants.js"

/** One tool as the model receives it: name, description, JSON Schema. */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

export interface CopilotSurfaceProfile {
  readonly surface: CopilotSurface
  /** Scopes the per-turn MCP server is built with. */
  readonly scopes: readonly Scope[]
  /** Request provenance: which surface made the sub-request. Never a job stamp. */
  readonly clientName: string
  /** MCP tools the model may see AND call — enforced at dispatch, not only at list time. */
  readonly mcpAllowlist: ReadonlySet<string>
  /**
   * The subset of the allowlist the plain dispatch path may actually call.
   *
   * On the canvas that is the whole allowlist. On the studio surface it is the
   * free reads only: everything that changes the document, publishes, imports,
   * copies or costs credits is proposed and applied by a person, so a name
   * that reaches the plain path is refused before the invoker is touched.
   */
  readonly freeTools: ReadonlySet<string>
  /** Native copilot tools this surface declares. */
  readonly nativeTools: ReadonlySet<string>
  /** Everything the model can see: the allowlist union the natives. */
  readonly toolSurface: ReadonlySet<string>
  /** Values pinned on a named tool, merged after the model's own arguments. */
  readonly forcedArgs: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  /** The id this surface pins on every MCP call, under its own key. */
  forcedIdArg(id: string): Record<string, unknown>
  /** Arguments the surface computes: dropped from the model's schema and from its args. */
  readonly computedArgs: Readonly<Record<string, readonly string[]>>
  /** Native definitions this surface adds beyond the shared ones. */
  readonly nativeDefinitions: readonly ToolDefinition[]
  /** Definitions this surface rewrites at list time. */
  readonly descriptionRewrites: Readonly<Record<string, (served: string) => string>>
}

// ── the studio surface ──────────────────────────────────────────────────────

/** The request name every studio-copilot sub-request carries. */
export const STUDIO_CLIENT_NAME = "studio-copilot"

/**
 * A thread is ONE production, so the two tools that make or list productions
 * are not on this surface: there is nothing for them to address.
 */
const PRODUCTION_LEVEL_TOOLS: ReadonlySet<string> = new Set([
  "create_studio_production",
  "list_studio_productions",
])

/**
 * The four canvas reads the studio surface keeps: what a model costs, which
 * voices exist, how a job the person started is doing, and what they can
 * afford. They register under scopes this surface already has.
 */
const KEPT_CANVAS_READS = ["list_models", "list_voices", "get_job", "check_balance"] as const

export const STUDIO_MCP_TOOL_ALLOWLIST: ReadonlySet<string> = new Set<string>([
  ...STUDIO_PRODUCTION_TOOL_NAMES.filter((name) => !PRODUCTION_LEVEL_TOOLS.has(name)),
  ...KEPT_CANVAS_READS,
])

/**
 * The natives of this surface. `remember` is the shared one (a memory, never
 * the document); the export wrapper turns the platform's export plan into one
 * confirmable card instead of letting the model run the chain itself.
 */
export const STUDIO_NATIVE_TOOLS = {
  remember: NATIVE_TOOLS.remember,
  exportProduction: "export_studio_production",
} as const

export const STUDIO_TOOL_SURFACE: ReadonlySet<string> = new Set<string>([
  ...STUDIO_MCP_TOOL_ALLOWLIST,
  ...Object.values(STUDIO_NATIVE_TOOLS),
])

/** The document write. It carries no mark: its operations are opaque here, and the preview classes them. */
export const STUDIO_EDIT_TOOL = "edit_studio_production"

/**
 * Free: a read, and nothing else. These are the only names the plain dispatch
 * path may call — everything else on this surface ends the turn as a card.
 */
export const STUDIO_READ_TOOLS: ReadonlySet<string> = new Set<string>([
  "get_studio_production",
  "get_studio_production_skill",
  "validate_studio_plan",
  "plan_studio_export",
  ...KEPT_CANVAS_READS,
])

/**
 * Proposed although they carry no confirmation mark: each one changes what the
 * person has, or where it can be reached, without spending or publishing.
 */
export const STUDIO_PROPOSE_WITHOUT_MARK: ReadonlySet<string> = new Set<string>([
  "import_studio_production",
  "clone_studio_production",
  STUDIO_NATIVE_TOOLS.exportProduction,
])

/**
 * Pinned on a studio tool whatever the model asks.
 *
 * The read must not land finished work: the person's editor is open and lands
 * everything it started itself, and a second lander would double a take that
 * was asked for once.
 */
export const STUDIO_FORCED_MCP_ARGS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  get_studio_production: { reconcile: false },
}

/**
 * Arguments this surface computes. They are dropped from the schema the model
 * reads and from the arguments it sends, because each one is a decision that
 * belongs to the turn rather than to the model:
 *
 *  - the preview flag, the expected version and the strict flag on a document
 *    write — the preview is taken by the dispatcher and the version by the
 *    editor's own transaction at Apply;
 *  - the landing flag on the read, pinned above;
 *  - the append/replace mode of a story run — the editor's Apply appends, so
 *    a replace would be a promise with nothing to carry it;
 *  - the model of a soundtrack run — the editor's own control has no model
 *    input, so the card must not promise one the Apply drops.
 *
 * The preview flag of a spending tool is added per tool from its confirmation
 * mark, not listed here — see `renderSurfaceTools`.
 */
export const STUDIO_COMPUTED_ARGS: Readonly<Record<string, readonly string[]>> = {
  [STUDIO_EDIT_TOOL]: ["dry_run", "expected_version", "strict"],
  get_studio_production: ["reconcile"],
  describe_studio_production: ["mode"],
  score_studio_production: ["model"],
}

/**
 * The sentence the studio surface takes out of one tool description.
 *
 * The served description tells an outside client to ask the user to reload the
 * editor around an import, because that client cannot know what the editor is
 * doing. Here the editor IS the caller: it applies the import through its own
 * transaction, so the reload advice is wrong on this surface and the doctrine
 * countermands it. Cutting at the sentence rather than restating the whole
 * description keeps every other word the tool's own.
 */
const RELOAD_SENTENCE_MARKER = "If the user has this production OPEN"

function withoutReloadSentence(served: string): string {
  const at = served.indexOf(RELOAD_SENTENCE_MARKER)
  return at === -1 ? served : served.slice(0, at).trimEnd()
}

const EXPORT_NATIVE_DEFINITION: ToolDefinition = {
  name: STUDIO_NATIVE_TOOLS.exportProduction,
  description:
    "PROPOSE the export of this production as one card: the steps, what each " +
    "costs and the total. This does not run anything — the person presses " +
    "Export in the editor and the finished cut is recorded for them. Never " +
    "assemble, mux or upscale the film yourself, and never invent a url. " +
    "After calling it, say what will be exported and stop; the outcome " +
    "arrives in the person's next message.",
  input_schema: {
    type: "object",
    properties: {
      upscale: {
        type: "boolean",
        description: "Deliver the cut at 4K. Ask for it only when the person did; it costs more.",
      },
    },
    additionalProperties: false,
  },
}

// ── the two profiles ────────────────────────────────────────────────────────

const WORKFLOW_PROFILE: CopilotSurfaceProfile = Object.freeze({
  surface: "workflow" as const,
  scopes: COPILOT_SCOPES,
  clientName: "copilot",
  mcpAllowlist: MCP_TOOL_ALLOWLIST,
  freeTools: MCP_TOOL_ALLOWLIST,
  nativeTools: new Set<string>(Object.values(NATIVE_TOOLS)),
  toolSurface: new Set<string>([...MCP_TOOL_ALLOWLIST, ...Object.values(NATIVE_TOOLS)]),
  forcedArgs: FORCED_MCP_ARGS,
  forcedIdArg: (id: string) => ({ workflow_id: id }),
  computedArgs: {},
  nativeDefinitions: [],
  descriptionRewrites: {},
})

const STUDIO_PROFILE: CopilotSurfaceProfile = Object.freeze({
  surface: "studio" as const,
  // `workflows:execute` is already in the shared set, so the family's
  // spending tools register; `workflows:write` is what the document routes
  // ask for. The reads ride the scopes that were there.
  scopes: [...COPILOT_SCOPES, "workflows:write" as Scope],
  clientName: STUDIO_CLIENT_NAME,
  mcpAllowlist: STUDIO_MCP_TOOL_ALLOWLIST,
  freeTools: STUDIO_READ_TOOLS,
  nativeTools: new Set<string>(Object.values(STUDIO_NATIVE_TOOLS)),
  toolSurface: STUDIO_TOOL_SURFACE,
  forcedArgs: STUDIO_FORCED_MCP_ARGS,
  forcedIdArg: (id: string) => ({ production_id: id }),
  computedArgs: STUDIO_COMPUTED_ARGS,
  nativeDefinitions: [EXPORT_NATIVE_DEFINITION],
  descriptionRewrites: { import_studio_production: withoutReloadSentence },
})

/** The bundle for one surface. A lookup, not a rebuild — it is resolved once per turn. */
export function copilotSurface(surface: CopilotSurface): CopilotSurfaceProfile {
  return surface === "studio" ? STUDIO_PROFILE : WORKFLOW_PROFILE
}

// ── list time ───────────────────────────────────────────────────────────────

/** The definition as the model gets it: no `$schema`, always an object schema, no `_meta`. */
export function toDefinition(tool: McpToolDef): ToolDefinition {
  const schema = { ...(tool.inputSchema ?? {}) } as Record<string, unknown>
  delete schema.$schema
  if (schema.type !== "object") schema.type = "object"
  return {
    name: tool.name,
    description: tool.description ?? tool.name,
    input_schema: schema,
  }
}

/** The confirmation class the family stamps on a tool, read before `_meta` is dropped. */
export function confirmClassOf(tool: McpToolDef): StudioConfirmClass | null {
  const confirm = (tool._meta as { nodaro?: { confirm?: unknown } } | undefined)?.nodaro?.confirm
  return confirm === "$" || confirm === "P" ? confirm : null
}

/**
 * Whether a spending tool can be asked for a price without spending.
 *
 * DERIVED from the schema the server actually renders: a plain boolean
 * `dry_run` can be set to true, a pinned one cannot, and a tool without the
 * key was never quotable. Nothing is listed by hand, so a tool that gains or
 * loses the argument is right the day it changes.
 */
export function isQuotable(definition: ToolDefinition): boolean {
  const properties = definition.input_schema.properties as Record<string, unknown> | undefined
  const dryRun = properties?.dry_run as Record<string, unknown> | undefined
  if (!dryRun || dryRun.type !== "boolean") return false
  return dryRun.const === undefined && !Array.isArray(dryRun.enum)
}

function withoutKeys(schema: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  if (keys.length === 0) return schema
  const properties = schema.properties as Record<string, unknown> | undefined
  if (!properties) return schema
  const kept = Object.fromEntries(Object.entries(properties).filter(([key]) => !keys.includes(key)))
  const required = Array.isArray(schema.required)
    ? (schema.required as unknown[]).filter((key) => typeof key !== "string" || !keys.includes(key))
    : undefined
  return { ...schema, properties: kept, ...(required ? { required } : {}) }
}

/** Arguments the surface computes for one tool: its listed keys, plus the preview flag of a spending tool. */
export function computedArgsFor(
  profile: CopilotSurfaceProfile,
  name: string,
  confirm: StudioConfirmClass | null,
): readonly string[] {
  const listed = profile.computedArgs[name] ?? []
  if (confirm !== "$" || listed.includes("dry_run")) return listed
  return [...listed, "dry_run"]
}

export interface SurfaceTools {
  definitions: ToolDefinition[]
  /** The confirmation mark each tool carries, captured before `_meta` is dropped. */
  confirmClasses: Map<string, StudioConfirmClass>
  /** Spending tools that can be priced without spending. */
  quotable: Set<string>
}

/**
 * The allowlisted MCP tools of one surface, rendered for the model.
 *
 * Order matters and is the reason this is one function: quotability is read
 * off the SERVED schema, and the computed arguments are removed after — a
 * reader who swapped the two would silently make every spending tool
 * unquotable.
 */
export function renderSurfaceTools(profile: CopilotSurfaceProfile, tools: McpToolDef[]): SurfaceTools {
  const confirmClasses = new Map<string, StudioConfirmClass>()
  const quotable = new Set<string>()
  const definitions: ToolDefinition[] = []

  for (const tool of tools) {
    if (!profile.mcpAllowlist.has(tool.name)) continue
    const served = toDefinition(tool)
    const confirm = confirmClassOf(tool)
    if (confirm) confirmClasses.set(tool.name, confirm)
    if (confirm === "$" && isQuotable(served)) quotable.add(tool.name)

    const rewrite = profile.descriptionRewrites[tool.name]
    definitions.push({
      name: served.name,
      description: rewrite ? rewrite(served.description) : served.description,
      input_schema: withoutKeys(served.input_schema, computedArgsFor(profile, tool.name, confirm)),
    })
  }

  return { definitions, confirmClasses, quotable }
}
