/**
 * The tool surface the model sees, and the ONLY dispatcher that may execute a
 * tool for it.
 *
 * Two halves:
 *   - Native copilot tools (get_graph / edit_workflow / run_workflow /
 *     get_execution / remember), declared here with hand-written JSON Schema.
 *   - A strict allowlist of in-process MCP tools, whose schemas come from the
 *     server itself so they can never drift from the real handlers.
 *
 * The allowlist is enforced at CALL time, not only when listing: the copilot's
 * MCP server registers every tool its scopes allow (≈100 generation verbs
 * ride on `workflows:execute`), and a hallucinated `generate_image` call must
 * not spend the user's credits.
 */
import type { McpInvoker } from "../../../lib/mcp/invoke.js"
import { CREATES_PER_TURN, NATIVE_TOOLS } from "../constants.js"
import {
  copilotSurface,
  renderSurfaceTools,
  type CopilotSurfaceProfile,
  type SurfaceTools,
  type ToolDefinition,
} from "../surfaces.js"
import { runCreateWorkflow, runGetWorkflowGraph, type CreateWorkflowArgs, type GetWorkflowGraphArgs } from "./workflow-crud.js"
import { EditRejected, runEditWorkflow, type EditWorkflowArgs, type WiredAsset } from "./edit-workflow.js"
import { runGetGraph, type GetGraphArgs } from "./get-graph.js"
import { runRemember, type RememberArgs } from "./remember.js"
import { proposeRun, runGetExecution, type GetExecutionArgs, type RunWorkflowArgs } from "./run-and-execution.js"
import { dispatchStudioTool } from "./studio-dispatch.js"
import type { ActionProposal, CopilotToolContext, RunProposal, StudioTurnState } from "./types.js"

export type { ToolDefinition, SurfaceTools }

export interface ToolOutcome {
  /** Text handed back to the model (wrapped as untrusted by the caller). */
  text: string
  isError: boolean
  /**
   * Set when the turn must stop and let the person decide: the canvas's run
   * proposal, or one of the studio surface's action proposals. The loop keeps
   * it and ends the message either way.
   */
  proposal?: RunProposal | ActionProposal
  /** Short human label detail for the activity row. */
  summary?: string
}

const NATIVE_DEFINITIONS: ToolDefinition[] = [
  {
    name: NATIVE_TOOLS.getGraph,
    description:
      "Read the open workflow: nodes (id, type, position, configuration), edges, version, and each node's status in the last run. Call this before your first edit of a turn. Pass include_node_ids to get full configuration for specific nodes only.",
    input_schema: {
      type: "object",
      properties: {
        include_node_ids: {
          type: "array",
          items: { type: "string" },
          description: "Return full data for these node ids; others are summarized.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: NATIVE_TOOLS.editWorkflow,
    description:
      "Apply an incremental change to the open workflow: add or replace nodes (upsertNodes), merge fields into existing nodes (patchNodes), delete nodes or edges, add or rewire edges. Send only what changes — never the whole graph. Positions are optional. Returns the new version plus any adjustments the server made and warnings you should read.",
    input_schema: {
      type: "object",
      properties: {
        upsertNodes: {
          type: "array",
          description: "Whole nodes to create or replace.",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Lowercase a-z, 0-9, '-' or '_' (max 64)." },
              type: { type: "string", description: "Kebab-case node type from the catalog." },
              position: {
                type: "object",
                properties: { x: { type: "number" }, y: { type: "number" } },
                required: ["x", "y"],
                additionalProperties: false,
              },
              parentId: { type: "string", description: "Group node id, when this node lives inside a group." },
              data: { type: "object", description: "Node configuration — see get_node_skill(type)." },
            },
            required: ["id", "type"],
            additionalProperties: false,
          },
        },
        patchNodes: {
          type: "array",
          description: "Shallow-merge these fields into an existing node's data.",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              data: { type: "object" },
              position: {
                type: "object",
                properties: { x: { type: "number" }, y: { type: "number" } },
                required: ["x", "y"],
                additionalProperties: false,
              },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
        deleteNodeIds: { type: "array", items: { type: "string" } },
        upsertEdges: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              source: { type: "string" },
              sourceHandle: { type: ["string", "null"] },
              target: { type: "string" },
              targetHandle: { type: ["string", "null"] },
            },
            required: ["source", "target"],
            additionalProperties: false,
          },
        },
        deleteEdgeIds: { type: "array", items: { type: "string" } },
        set: {
          type: "object",
          description: "Rename the workflow. (Workflow settings are not writable here.)",
          properties: { name: { type: "string", maxLength: 120 } },
          additionalProperties: false,
        },
        note: { type: "string", description: "One sentence describing the change, shown to the user." },
      },
      required: ["note"],
      additionalProperties: false,
    },
  },
  {
    name: NATIVE_TOOLS.getWorkflowGraph,
    description:
      "Read ANOTHER of the user's workflows in this project — how a flow they already like is built, so you can follow the same shape here. Find ids with list_workflows. Reading is all this does: you cannot edit or run another workflow from this conversation.",
    input_schema: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "From list_workflows." },
      },
      required: ["workflow_id"],
      additionalProperties: false,
    },
  },
  {
    name: NATIVE_TOOLS.createWorkflow,
    description:
      "Create a NEW workflow in this project and build it in one call — use it when the user asks for something separate rather than changes to the flow on screen. Once per conversation turn. The new workflow opens from their dashboard; this conversation stays attached to the workflow already open, so run_workflow still proposes THAT one.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 120, description: "What the user would call it." },
        nodes: { type: "array", items: { type: "object" }, description: "Same node shape as edit_workflow's upsertNodes." },
        edges: { type: "array", items: { type: "object" }, description: "Same edge shape as edit_workflow's upsertEdges." },
        note: { type: "string", description: "One sentence describing what you built, shown to the user." },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: NATIVE_TOOLS.runWorkflow,
    description:
      "PROPOSE a run. This does not start anything: the user sees the proposal with its credit estimate and decides. Pass node_id to propose ONE node — the right choice when you changed a single step and only that step needs redoing, since it spends a fraction of a whole-graph run. Configure everything through edit_workflow first — a run has no override channel. After calling it, say what will run and stop; the outcome arrives in the user's next message.",
    input_schema: {
      type: "object",
      properties: {
        note: { type: "string", description: "One line shown on the Run card." },
        node_id: {
          type: "string",
          description: "Run only this node, from get_graph. Omit to propose the whole workflow.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: NATIVE_TOOLS.getExecution,
    description:
      "Read a run's per-node status and failures (latest run by default). Use it after the user reports a run, then diagnose_run for remediation detail on a failed node.",
    input_schema: {
      type: "object",
      properties: { execution_id: { type: "string", description: "Defaults to the workflow's latest run." } },
      additionalProperties: false,
    },
  },
  {
    name: NATIVE_TOOLS.remember,
    description:
      'Save ONE standing user preference or correction so every future conversation honors it (e.g. "always 9:16", "never add background music"). Use it when the user states a durable rule or corrects you in a way that should persist — never for one-off task details, secrets, or anything containing a URL. The user sees every save and can delete it.',
    input_schema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          maxLength: 400,
          description: "One short standing rule, in the user's own terms.",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
]

/**
 * The tool surface for a turn: what the model sees, plus the two things a
 * dispatcher needs and cannot recover once `_meta` is dropped — which tools
 * carry a confirmation class, and which of those can be priced without
 * spending.
 *
 * Sorted by name so the cached prompt prefix (tools precede system) is
 * byte-stable across turns and replicas. Natives come from this file; a
 * surface may add its own.
 */
export async function buildToolSurface(
  invoker: McpInvoker,
  profile: CopilotSurfaceProfile = copilotSurface("workflow"),
): Promise<SurfaceTools> {
  const rendered = renderSurfaceTools(profile, await invoker.listTools())
  const natives = [
    ...NATIVE_DEFINITIONS.filter((definition) => profile.nativeTools.has(definition.name)),
    ...profile.nativeDefinitions,
  ]
  return {
    ...rendered,
    definitions: [...natives, ...rendered.definitions].sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/** The tool list alone, for a caller that needs nothing else. */
export async function buildToolDefinitions(
  invoker: McpInvoker,
  profile?: CopilotSurfaceProfile,
): Promise<ToolDefinition[]> {
  return (await buildToolSurface(invoker, profile)).definitions
}

export interface DispatchDeps {
  readonly ctx: CopilotToolContext
  readonly invoker: McpInvoker
  /** Node types added so far this turn — the Run card lists them for the user. */
  readonly addedNodeTypes: Set<string>
  /** Files wired onto a node this turn, so the Run card can name them too. */
  readonly wiredAssets: WiredAsset[]
  /** Workflows created this turn — the bound lives here, not in the model. */
  readonly created: { count: number }
  /**
   * The surface this turn runs on. Absent means the canvas — the surface the
   * copilot had when there was only one.
   */
  readonly surface?: CopilotSurfaceProfile
  /**
   * The studio surface's own per-turn state: what list time learned about the
   * tools, whether this message has proposed already, and whether previewing a
   * change turned out to be unavailable. Absent on the canvas.
   */
  readonly studio?: StudioTurnState
}

/** Execute one tool call. Never throws for a model-visible problem — it returns an error result the model can act on. */
export async function dispatchTool(deps: DispatchDeps, name: string, rawArgs: unknown): Promise<ToolOutcome> {
  const args = (rawArgs ?? {}) as Record<string, unknown>
  const profile = deps.surface ?? copilotSurface("workflow")
  try {
    // The studio surface answers FIRST, because on it a tool call is usually
    // not a tool call: everything that would change the person's production,
    // publish it, copy it, import into it, export it or spend a credit comes
    // back as a proposal they confirm in the editor. It returns null for
    // everything it does not own — the canvas, a free read, the shared memory
    // tool, a name that is on no surface — so every path below is untouched.
    const proposed = await dispatchStudioTool(deps, name, rawArgs)
    if (proposed) return proposed

    // A native reaches its case only when its own surface declares it: a
    // canvas native named on another surface falls through to the same
    // refusal a hallucinated tool gets, without anything being called.
    if (profile.nativeTools.has(name)) {
      switch (name) {
        case NATIVE_TOOLS.getGraph:
          return { text: await runGetGraph(deps.ctx, args as GetGraphArgs), isError: false }

        case NATIVE_TOOLS.getWorkflowGraph:
          return {
            text: await runGetWorkflowGraph(deps.ctx, args as GetWorkflowGraphArgs),
            isError: false,
          }

        case NATIVE_TOOLS.createWorkflow: {
          if (deps.created.count >= CREATES_PER_TURN) {
            return {
              text: `Only ${CREATES_PER_TURN} workflow can be created per message. Tell the user what you would build and let them ask again.`,
              isError: true,
            }
          }
          // Counted BEFORE the await: two `create_workflow` blocks in one
          // assistant message are dispatched a microtask apart, and a count
          // written after the insert would let both through.
          deps.created.count += 1
          const result = await runCreateWorkflow(deps.ctx, args as CreateWorkflowArgs)
          // Deliberately NOT folded into `deps.addedNodeTypes` / `wiredAssets`:
          // those feed the Run card for the workflow on SCREEN, and listing
          // nodes that went into a different workflow would tell the user they
          // are about to spend credits on something they never gained.
          return {
            text: JSON.stringify(
              {
                workflowId: result.workflowId,
                name: result.name,
                nodeCount: result.edit.nodeCount,
                edgeCount: result.edit.edgeCount,
                note: "Created. This conversation stays attached to the workflow already open — run_workflow still proposes that one.",
              },
              null,
              2,
            ),
            isError: false,
            summary: `created ${result.name}`,
          }
        }

        case NATIVE_TOOLS.editWorkflow: {
          const result = await runEditWorkflow(deps.ctx, args as unknown as EditWorkflowArgs)
          for (const type of result.addedNodeTypes) deps.addedNodeTypes.add(type)
          for (const asset of result.wiredAssets) {
            if (!deps.wiredAssets.some((a) => a.id === asset.id && a.nodeId === asset.nodeId)) {
              deps.wiredAssets.push(asset)
            }
          }
          const summary = [
            result.addedNodeIds.length ? `added ${result.addedNodeIds.length}` : "",
            result.updatedNodeIds.length ? `updated ${result.updatedNodeIds.length}` : "",
            result.removedNodeIds.length ? `removed ${result.removedNodeIds.length}` : "",
          ]
            .filter(Boolean)
            .join(", ")
          return { text: JSON.stringify(result, null, 2), isError: false, summary: summary || "no change" }
        }

        case NATIVE_TOOLS.runWorkflow: {
          const { proposal, message } = await proposeRun(
            deps.ctx,
            args as RunWorkflowArgs,
            [...deps.addedNodeTypes],
            deps.wiredAssets,
          )
          return { text: message, isError: false, proposal }
        }

        case NATIVE_TOOLS.getExecution:
          return { text: await runGetExecution(deps.ctx, args as GetExecutionArgs), isError: false }

        case NATIVE_TOOLS.remember:
          return await runRemember(deps.ctx, args as RememberArgs)
      }
    }

    if (!profile.mcpAllowlist.has(name)) {
      return { text: `Tool "${name}" is not available in this conversation.`, isError: true }
    }
    // Everything this path may call is free. A surface whose tools change the
    // document, publish, copy or spend proposes those instead — and a name
    // that arrives here without having been proposed is refused before the
    // invoker is touched, whatever the reason it arrived.
    if (!profile.freeTools.has(name)) {
      return {
        text: `"${name}" changes the person's work, so it cannot be called directly here — it has to be proposed and confirmed.`,
        isError: true,
      }
    }
    // Order is the enforcement: the model's own args go in first, then
    // whatever this tool pins, then the id this surface addresses. A
    // model-supplied `scope: "public"` or id loses to the value after it.
    const result = await deps.invoker.callTool(name, {
      ...args,
      ...(profile.forcedArgs[name] ?? {}),
      ...profile.forcedIdArg(deps.ctx.workflowId),
    })
    const text = result.content
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n")
    return { text: text || "(no output)", isError: Boolean(result.isError) }
  } catch (err) {
    if (err instanceof EditRejected) return { text: err.message, isError: true }
    const message = err instanceof Error ? err.message : String(err)
    return { text: `The tool failed: ${message}`, isError: true }
  }
}
