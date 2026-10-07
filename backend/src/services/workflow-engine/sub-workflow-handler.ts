import { assertCanvasExecutionAllowed, findWordlessTranscriptFeeds, PREVIEW_RENDER_NESTED, type WordlessTranscriptFeed } from "@nodaro/shared"
import { previewRendersIn, PREVIEW_RENDER_NESTED_MESSAGE } from "./nested-preview-renders.js"
/**
 * Sub-workflow handler — executes a referenced workflow recursively.
 * Ported from frontend sub-workflow-executor.ts.
 *
 * Constraints:
 * - Max depth: 5
 * - Cycle detection via workflowId:routeId tracking
 */

import { PARAMETER_NODE_TYPES } from "@nodaro/shared"
import { getParameterPromptHint, findForeignCatalogIds, foreignCatalogIdMessage } from "@nodaro/prompts"
import { config } from "../../lib/config.js"
import { settledWithLimit } from "../../lib/settled-with-limit.js"
import { DrainAbortError } from "../../lib/worker-drain.js"
import { supabase } from "../../lib/supabase.js"
import {
  buildExecutionLevels,
  computeGatedIds,
  getEffectivelySkippedIds,
  isSourceNode,
  isSkipNode,
} from "./execution-graph.js"
import { computeEmptyInputSkipIds } from "./empty-input-skips.js"
import { resolveNodeInputs } from "./input-resolver.js"
import { normalizeLegacyNodeTypes } from "./normalize-node-types.js"
import { extractSourceNodeOutput, getPrimaryOutput } from "./output-extractor.js"
import { seededFromSavedData } from "./saved-data.js"
import { executeNode } from "./node-executor.js"
import { labelRefHintContext } from "./label-ref-hint-context.js"
import type {
  SimpleNode,
  SimpleEdge,
  NodeExecutionState,
  NodeOutput,
  OrchestratorContext,
  ResolvedInputs,
} from "./types.js"
import { MAX_SUB_WORKFLOW_DEPTH } from "./types.js"
import { resolveCanvasResultIds } from "../../lib/canvas-result-ids.js"

/**
 * Result of executing a sub-workflow node.
 *
 * `creditsUsed` is the SUM of the committed credits reported by every inner
 * node (and, recursively, every nested sub-workflow). The parent orchestrator
 * threads this into its `totalCredits` accumulator so
 * `workflow_executions.total_credits_used` reflects sub-workflow spend and
 * monetized app-run creator earnings are computed on the correct base.
 */
export interface SubWorkflowResult {
  output: NodeOutput
  creditsUsed: number
}

/**
 * Prepare a referenced workflow's raw nodes for sub-workflow execution.
 *
 * Runs the shared legacy-type migration (`normalizeLegacyNodeTypes` — the single
 * source of truth, incl. edit-image/image-to-image/old-collect AND loop → list).
 * The helper preserves every field it doesn't rewrite, `parentId` included, so
 * group children keep their parent inside the sub-workflow execution graph
 * without any extra re-threading. Non-mutating (the helper copies on rewrite and
 * passes untouched nodes through by reference). Exported for direct regression
 * testing of the per-node normalization.
 */
export function prepareSubWorkflowNodes(
  rawNodes: ReadonlyArray<SimpleNode>,
): SimpleNode[] {
  return normalizeLegacyNodeTypes(rawNodes)
}

/** The reference a sub-workflow node carries: which workflow, which route, and
 *  the `workflowId:routeId` cycle key both the executor and the up-front
 *  preflight below key their visited sets on. */
export function subWorkflowReference(node: SimpleNode): {
  referencedWorkflowId: string | undefined
  routeId: string
  routeKey: string
} {
  const referencedWorkflowId = node.data?.workflowId as string | undefined
  const routeId = (node.data?.selectedRouteId as string) ?? "default"
  return { referencedWorkflowId, routeId, routeKey: `${referencedWorkflowId}:${routeId}` }
}

/**
 * Which workflow a sub-workflow reference resolves against.
 *
 * `ctx.workflowOwnerId` when set: sub-workflow references point at workflows
 * owned by the *author* of the containing workflow, which can differ from
 * `ctx.userId` for shared-workflow presentation runs (viewer pays) and app runs
 * (creator's snapshot, runner's identity). Falls back to `ctx.userId` so legacy
 * callers stay protected. ONE derivation, so the executor and the preflight can
 * never scope the same reference differently.
 */
export function subWorkflowOwnerId(ctx: Pick<OrchestratorContext, "userId" | "workflowOwnerId">): string {
  return ctx.workflowOwnerId ?? ctx.userId
}

/**
 * Load the graph a sub-workflow node references, EXACTLY as the run will see it:
 * owner-scoped fetch, legacy-type migration, route-snapshot reachability filter.
 *
 * The one loader for both `executeSubWorkflow` (below) and
 * `findNestedWordlessTranscriptFeeds` (the orchestrator's up-front check), so
 * the two can never disagree about which nodes a nested run will execute.
 *
 * `null` = the reference does not resolve (no `workflowId`, or no row for this
 * owner). Callers decide what that means: the executor throws the not-found
 * error at that node; the preflight treats it as "nothing to see here" and lets
 * the run raise it.
 */
export async function loadSubWorkflowGraph(
  node: SimpleNode,
  ownerId: string,
): Promise<{ nodes: SimpleNode[]; edges: SimpleEdge[] } | null> {
  const { referencedWorkflowId } = subWorkflowReference(node)
  if (!referencedWorkflowId) return null

  // `supabase` here is the service-role client (bypasses RLS) and the node's
  // workflowId is user-controlled, so the fetch MUST be scoped by owner to
  // prevent referencing arbitrary workflows (IDOR).
  const { data: workflow, error: wfError } = await supabase
    .from("workflows")
    .select("nodes, edges")
    .eq("id", referencedWorkflowId)
    .eq("user_id", ownerId)
    .single()

  if (wfError || !workflow) return null

  // Migrate legacy node types before processing, via the shared helper (single
  // source of truth). Re-threads parentId so group children flow into the
  // sub-workflow execution graph — see prepareSubWorkflowNodes.
  // Saved result ids resolved by the owner's jobs (canvas-result-ids.ts), as
  // the parent graph's are: a child render the run skips hands its saved take on.
  const savedNodes = await resolveCanvasResultIds(workflow.nodes, ownerId)
  let subNodes: SimpleNode[] = prepareSubWorkflowNodes((savedNodes as SimpleNode[]) ?? [])
  let subEdges: SimpleEdge[] = (workflow.edges as SimpleEdge[]) ?? []

  // Filter to reachable nodes for the selected route (if route filtering is configured)
  const routeSnapshot = node.data?.routeSnapshot as {
    inputPorts?: Array<{ id: string; mediaType: string }>
    outputPorts?: Array<{ id: string; mediaType: string }>
    inputNodeId?: string
    outputNodeId?: string
  } | undefined

  if (routeSnapshot?.inputNodeId && routeSnapshot?.outputNodeId) {
    const reachable = getReachableNodes(
      routeSnapshot.inputNodeId,
      routeSnapshot.outputNodeId,
      subEdges,
    )
    subNodes = subNodes.filter((n) => reachable.has(n.id))
    subEdges = subEdges.filter(
      (e) => reachable.has(e.source) && reachable.has(e.target),
    )
  }

  return { nodes: subNodes, edges: subEdges }
}

/** A wordless transcript feed found inside a NESTED graph, plus the sub-workflow
 *  node ids that lead to it — so the refusal can name where to look. */
export interface NestedWordlessTranscriptFeed extends WordlessTranscriptFeed {
  /** Sub-workflow node ids from the run graph down to the graph holding the
   *  feed, outermost first. Never empty. */
  readonly subWorkflowPath: readonly string[]
}

/** The refusal line for a nested hit: the message, then the path to the pair. */
export function nestedWordlessFeedMessage(feed: NestedWordlessTranscriptFeed): string {
  return (
    `${feed.message} (Sub-workflow node ${feed.subWorkflowPath.join(" → ")}` +
    ` → Transcribe node ${feed.transcribeNodeId} → Add Captions node ${feed.consumerNodeId})`
  )
}

/** A graph a `sub-workflow` node in the run will execute, as the run will load
 *  it, with the sub-workflow node ids that lead to it (outermost first). */
export interface NestedRunGraph {
  readonly nodes: SimpleNode[]
  readonly edges: SimpleEdge[]
  readonly subWorkflowPath: readonly string[]
}

/**
 * Every graph a `sub-workflow` node in the run will execute, loaded ONCE for
 * all the orchestrator's up-front checks (word timings, preview renders) —
 * before any node runs, so a nested problem is refused up front instead of
 * mid-run, after upstream parent nodes executed and billed.
 *
 * Descends only (the caller asks its own questions of its own nodes), loads
 * each referenced graph through `loadSubWorkflowGraph` (so it sees exactly the
 * nodes the run would execute), and mirrors `executeSubWorkflow`'s limits: the
 * same `MAX_SUB_WORKFLOW_DEPTH` ceiling and the same `workflowId:routeId` cycle
 * key, carried down the path so a self-referencing graph is loaded once and not
 * walked again. Depth-first: a graph comes before the graphs nested in it.
 *
 * A reference that cannot be loaded is NOT a preflight's problem: it yields no
 * graph and the run raises its own not-found error at that node. A load that
 * THROWS is swallowed the same way — a preflight may only ever refuse for a
 * real hit, never for an unreachable database.
 */
export async function loadNestedRunGraphs(
  nodes: ReadonlyArray<SimpleNode>,
  ownerId: string,
  depth: number = 0,
  visitedRouteKeys: ReadonlySet<string> = new Set(),
  path: ReadonlyArray<string> = [],
): Promise<NestedRunGraph[]> {
  // Mirrors executeSubWorkflow's ceiling: a node at this depth throws instead of
  // running, so there is nothing below it to check.
  if (depth >= MAX_SUB_WORKFLOW_DEPTH) return []

  const out: NestedRunGraph[] = []

  for (const node of nodes) {
    if (node.type !== "sub-workflow" || node.data?.skipped === true) continue
    const { routeKey } = subWorkflowReference(node)
    if (visitedRouteKeys.has(routeKey)) continue

    let loaded: { nodes: SimpleNode[]; edges: SimpleEdge[] } | null = null
    try {
      loaded = await loadSubWorkflowGraph(node, ownerId)
    } catch (err) {
      console.warn(
        `[nested-preflight] could not load the graph behind sub-workflow node ${node.id}` +
          ` — leaving it to the run: ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }
    if (!loaded) continue

    const nextPath = [...path, node.id]
    out.push({ nodes: loaded.nodes, edges: loaded.edges, subWorkflowPath: nextPath })
    out.push(
      ...(await loadNestedRunGraphs(loaded.nodes, ownerId, depth + 1, new Set([...visitedRouteKeys, routeKey]), nextPath)),
    )
  }

  return out
}

/** The word-timings question `findWordlessTranscriptFeeds` asks of the run
 *  graph, asked of every nested graph (`loadNestedRunGraphs`). NOT covered, by
 *  construction: a chain that CROSSES a sub-workflow boundary (transcribe in
 *  the parent, add-captions in the child, or the reverse) — no single graph
 *  holds that edge pair. */
export function nestedWordlessTranscriptFeeds(graphs: readonly NestedRunGraph[]): NestedWordlessTranscriptFeed[] {
  return graphs.flatMap((graph) =>
    findWordlessTranscriptFeeds(graph.nodes, graph.edges).map((feed) => ({ ...feed, subWorkflowPath: graph.subWorkflowPath })),
  )
}

/** `nestedWordlessTranscriptFeeds` over the graphs `loadNestedRunGraphs` loads. */
export async function findNestedWordlessTranscriptFeeds(
  nodes: ReadonlyArray<SimpleNode>,
  _edges: ReadonlyArray<SimpleEdge>,
  ownerId: string,
  depth: number = 0,
  visitedRouteKeys: ReadonlySet<string> = new Set(),
  path: ReadonlyArray<string> = [],
): Promise<NestedWordlessTranscriptFeed[]> {
  return nestedWordlessTranscriptFeeds(await loadNestedRunGraphs(nodes, ownerId, depth, visitedRouteKeys, path))
}

/**
 * Execute a sub-workflow node.
 *
 * @param node - The sub-workflow node
 * @param resolvedInputs - Inputs wired from upstream nodes
 * @param ctx - Orchestrator context
 * @param depth - Current nesting depth
 * @param executingRouteKeys - Set of "workflowId:routeId" already executing (cycle detection)
 */
export async function executeSubWorkflow(
  node: SimpleNode,
  resolvedInputs: ResolvedInputs,
  ctx: OrchestratorContext,
  depth: number = 0,
  executingRouteKeys: Set<string> = new Set(),
  // The sub-workflow nodes above this one (each with the fan-out iteration
  // that entered it): the Idempotency-Key scope of every node inside.
  idempotencyScope: readonly string[] = [],
): Promise<SubWorkflowResult> {
  // Check depth limit
  if (depth >= MAX_SUB_WORKFLOW_DEPTH) {
    throw new Error(`Sub-workflow depth limit exceeded (max ${MAX_SUB_WORKFLOW_DEPTH})`)
  }

  const { referencedWorkflowId, routeKey } = subWorkflowReference(node)

  if (!referencedWorkflowId) {
    throw new Error("Sub-workflow node has no referenced workflow")
  }

  // Cycle detection
  if (executingRouteKeys.has(routeKey)) {
    throw new Error(`Cycle detected in sub-workflows: ${routeKey}`)
  }
  const newRouteKeys = new Set(executingRouteKeys)
  newRouteKeys.add(routeKey)

  // Load the referenced graph through the SHARED loader (owner-scoped fetch,
  // legacy-type migration, route-snapshot reachability filter) — the same one
  // the orchestrator's up-front nested word-timings check uses, so the two can
  // never disagree about which nodes this run will execute.
  const ownerId = subWorkflowOwnerId(ctx)
  const loaded = await loadSubWorkflowGraph(node, ownerId)

  if (!loaded) {
    throw new Error(`Referenced workflow ${referencedWorkflowId} not found`)
  }

  const subNodes: SimpleNode[] = loaded.nodes
  const subEdges: SimpleEdge[] = loaded.edges

  // Scoping the fetch to the workflow's AUTHOR (`ownerId`) is the guard, and it
  // is the one this path has always had: a sub-workflow reference resolves only
  // against the author's own workflows, so a run cannot reach into a stranger's.
  //
  // A NARROWER gap remains once workflows can be edited by non-authors: an org
  // collaborator with an editor grant could inject a reference to ANOTHER of
  // the author's workflows and read its output through the parent. Closing that
  // correctly means telling an author-authored reference from an injected one,
  // which is a write-time question (which references may an editor add), not a
  // runtime one — a blanket runtime "can the RUNNER see it" check refuses the
  // author-vouched flows too, because a published-app run and a presentation
  // run BOTH execute with `ctx.userId` = the runner and `ctx.workflowOwnerId` =
  // the author, so `userId !== ownerId` is exactly those legitimate cases. The
  // gap is orgs-gated (needs an editor grant) and therefore dark today; it is
  // tracked as a flag-flip prerequisite in the orgs deferred-items note rather
  // than closed here by breaking live app and presentation runs.

  assertCanvasExecutionAllowed(subNodes)

  // The nested graph never passes the orchestrator's chokepoint — it is
  // loaded and executed in-process here — so the catalog wall is asked again,
  // after the route filter and before parameter nodes are pre-completed
  // below. Inert on a deployment with no catalog packs.
  {
    const foreign = findForeignCatalogIds(subNodes)
    if (foreign.length > 0) {
      const err = new Error(foreignCatalogIdMessage(foreign)) as Error & { code?: string }
      err.code = "catalog_value_not_available"
      throw err
    }
  }

  // Same reason, second wall: a transcribe node on a lane that can't return word
  // timings whose transcript reaches add-captions can only fail AFTER the
  // transcription is billed. The orchestrator refuses that up front
  // (orchestrator-worker.ts); a nested graph never reaches that check, so ask
  // again here, on the route-filtered node set that will actually run.
  {
    const wordless = findWordlessTranscriptFeeds(subNodes, subEdges)
    if (wordless.length > 0) {
      const err = new Error(
        wordless
          .map((w) => `${w.message} (Transcribe node ${w.transcribeNodeId} → Add Captions node ${w.consumerNodeId})`)
          .join(" "),
      ) as Error & { code?: string }
      err.code = "transcript_has_no_word_timings"
      throw err
    }
  }

  // A Preview render in a nested graph would hand a preview to the parent,
  // where nothing can Render final. The orchestrator refuses that up front
  // (its nested scan); this is the backstop for a graph that reaches here —
  // only on a run the stop rule applies to (`ctx.previewStopRule`).
  if (ctx.previewStopRule === true) {
    const previews = previewRendersIn(subNodes, subEdges)
    if (previews.length > 0) {
      const err = new Error(`${PREVIEW_RENDER_NESTED_MESSAGE} (render ${previews.join(", ")})`) as Error & {
        code?: string
        errorCode?: string
      }
      err.code = PREVIEW_RENDER_NESTED
      err.errorCode = PREVIEW_RENDER_NESTED
      throw err
    }
  }

  // Initialize node states for the sub-workflow
  const nodeStates: Record<string, NodeExecutionState> = {}

  // Accumulate the committed credits reported by inner nodes so the parent
  // orchestrator's `totalCredits` (and thus total_credits_used + monetization
  // base) includes sub-workflow spend. Nested sub-workflows roll up naturally:
  // the recursive call returns its own summed creditsUsed.
  let creditsUsed = 0

  // Inject inputs from the parent into the sub-workflow input node
  for (const subNode of subNodes) {
    if (subNode.type === "sub-workflow-input") {
      // Build output from resolved inputs
      const output: NodeOutput = {}
      if (resolvedInputs.imageUrl) output.imageUrl = resolvedInputs.imageUrl
      if (resolvedInputs.videoUrl) output.videoUrl = resolvedInputs.videoUrl
      if (resolvedInputs.audioUrl) output.audioUrl = resolvedInputs.audioUrl
      if (resolvedInputs.prompt) output.text = resolvedInputs.prompt

      nodeStates[subNode.id] = {
        status: "completed",
        output,
        completedAt: new Date().toISOString(),
      }
    } else if (isSourceNode(subNode.type)) {
      const sourceOutput = extractSourceNodeOutput(subNode)
      if (sourceOutput) nodeStates[subNode.id] = seededFromSavedData(sourceOutput)
    } else if (subNode.type && PARAMETER_NODE_TYPES.has(subNode.type)) {
      // Parameter pickers (mood, action-fx, lens, person, etc.) emit a prompt
      // fragment via FieldMappings — they have no executable handler. Mirror the
      // main orchestrator: pre-complete them so they never reach executeNode
      // (which would create a stale jobs row → buildPayload throw "Unknown node
      // type" → fail the whole sub-workflow), while still exposing their hint.
      // Graph-composed pickers get the SUB-graph (labelRefHintContext).
      const hint = getParameterPromptHint(subNode, labelRefHintContext(subNode, subNodes, subEdges))
      nodeStates[subNode.id] = seededFromSavedData(hint ? { text: hint } : {})
    }
  }

  // Build execution levels
  const levels = buildExecutionLevels(subNodes, subEdges)
  const skippedIds = getEffectivelySkippedIds(subNodes, subEdges)

  // Skipped by the person = frozen: no run, and its saved results may still
  // stand in for it downstream. Unlike the main run's frozen seed, this state
  // carries no output: a reader that falls back through `savedDataAllowed`
  // gets the saved results, one that reads only `state.output` (some media
  // inputs) gets nothing — an older divergence, left as it was here.
  for (const nodeId of skippedIds) {
    nodeStates[nodeId] = { status: "skipped", completedAt: new Date().toISOString(), fromSavedData: true }
  }

  // Execute level by level
  for (const level of levels) {
    if (ctx.cancelled) throw new Error("Execution cancelled")

    // The same two gates the main orchestrator applies per level (a router's
    // inactive routes, a node the run skipped) and the empty-input skip —
    // without them an inner "no new posts" failed the whole sub-workflow.
    const gated = computeGatedIds(subNodes, subEdges, nodeStates)
    const emptyInputIds = computeEmptyInputSkipIds({ level, nodes: subNodes, edges: subEdges, nodeStates, deadIds: new Set(gated.keys()) })
    for (const n of level) {
      const gateReason = gated.get(n.id)
      if (gateReason === undefined && !emptyInputIds.has(n.id)) continue
      if (nodeStates[n.id]?.status === "completed") continue
      const skipReason = gateReason === "empty_input" || emptyInputIds.has(n.id) ? "empty_input" : undefined
      nodeStates[n.id] = { status: "skipped", nodeType: n.type, completedAt: new Date().toISOString(), ...(skipReason ? { skipReason } : {}) }
    }
    const deadIds = new Set([...gated.keys(), ...emptyInputIds])

    const executableNodes = level.filter((n) => {
      if (isSourceNode(n.type)) return false
      if (skippedIds.has(n.id)) return false
      if (isSkipNode(n.type)) return false
      // Parameter pickers are pre-completed above and have no job handler.
      if (n.type && PARAMETER_NODE_TYPES.has(n.type)) return false
      if (deadIds.has(n.id)) return false
      if (nodeStates[n.id]?.status === "completed") return false
      // Recursive sub-workflow nodes are handled specially
      if (n.type === "sub-workflow") return true
      return true
    })

    const tasks = executableNodes.map((subNode) => async () => {
        nodeStates[subNode.id] = {
          status: "running",
          startedAt: new Date().toISOString(),
        }

        const inputs = resolveNodeInputs(subNode, subEdges, nodeStates, subNodes)

        let result: { output: NodeOutput; creditsUsed?: number }
        if (subNode.type === "sub-workflow") {
          // Recursive sub-workflow execution. The recursive call already sums
          // its own inner spend, so forwarding result.creditsUsed rolls the
          // nested total up into this level's accumulation below.
          result = await executeSubWorkflow(
            subNode,
            inputs,
            ctx,
            depth + 1,
            newRouteKeys,
            [...idempotencyScope, subNode.id],
          )
        } else {
          result = await executeNode(
            subNode,
            inputs,
            subEdges,
            subNodes,
            nodeStates,
            ctx,
            undefined,
            undefined,
            idempotencyScope,
          )
        }

        nodeStates[subNode.id] = {
          status: "completed",
          output: result.output,
          startedAt: nodeStates[subNode.id]?.startedAt,
          completedAt: new Date().toISOString(),
        }

        return result
    })
    const levelAborted = { cancelled: ctx.cancelled }
    const results = await settledWithLimit(tasks, config.MAX_CONCURRENT_NODES_PER_EXECUTION, levelAborted)

    // Check for failures + accumulate committed inner credits.
    for (let i = 0; i < results.length; i++) {
      const result = results[i]
      if (result.status === "rejected") {
        // Deploy drain (B6b): propagate the abort with its IDENTITY intact.
        // The rewrap below would turn it into a plain Error, and the
        // orchestrator's drain hatch (`result.reason instanceof
        // DrainAbortError`) would then miss it and write status='failed' on a
        // healthy execution — the exact harm B6b exists to prevent.
        if (result.reason instanceof DrainAbortError) throw result.reason
        const error = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
        // P14.3: a mapped billing refusal keeps its stable code across this
        // rewrap — without it, every sub-workflow-nested refusal loses the
        // field the budget UI branches on (review finding).
        const wrapped = new Error(`Sub-workflow node ${executableNodes[i].id} failed: ${error}`)
        const code = (result.reason as { errorCode?: string } | null)?.errorCode
        if (code) (wrapped as Error & { errorCode?: string }).errorCode = code
        // PR9: same carry for a worker safety-block verdict — otherwise a
        // sub-workflow-nested node's error_hint is dropped at exactly this
        // rewrap while errorCode survives it.
        const hint = (result.reason as { errorHint?: NodeExecutionState["errorHint"] } | null)?.errorHint
        if (hint) (wrapped as Error & { errorHint?: NodeExecutionState["errorHint"] }).errorHint = hint
        throw wrapped
      }
      creditsUsed += result.value.creditsUsed ?? 0
    }
  }

  // Collect outputs from the sub-workflow output node.
  //
  // Emits BOTH:
  //   - `_outputResults: Record<portId, value>` for handle-based downstream
  //     routing via `out_{portId}` (matches frontend behaviour — without this,
  //     per-port routing on backend-run sub-workflows was broken)
  //   - `_visibleOutputPortId` so output-extractor's fallback picks the
  //     user-selected visible port when no specific `out_{portId}` handle is
  //     wired downstream
  //   - Flat `{imageUrl, videoUrl, audioUrl, text}` for legacy callers and
  //     for the final execution-result collection
  const output: NodeOutput = {}
  const outputResults: Record<string, string> = {}
  let visiblePortId: string | undefined

  for (const subNode of subNodes) {
    if (subNode.type !== "sub-workflow-output") continue
    const outNodeData = subNode.data as Record<string, unknown>
    const ports = (outNodeData.ports as Array<{ id: string }> | undefined) ?? []
    if (!visiblePortId) {
      visiblePortId = outNodeData.visibleOutputPortId as string | undefined
    }

    for (const port of ports) {
      const incomingEdge = subEdges.find(
        (e) => e.target === subNode.id && e.targetHandle === port.id,
      )
      if (!incomingEdge) continue
      const srcNode = subNodes.find((n) => n.id === incomingEdge.source)
      if (!srcNode) continue
      const srcState = nodeStates[srcNode.id]
      if (!srcState?.output) continue
      const value = getPrimaryOutput(srcState.output, srcNode.type, incomingEdge.sourceHandle)
      if (value) outputResults[port.id] = value
    }

    // Also fill the flat NodeOutput slots from the output node's upstream
    // inputs, so callers that consume the sub-workflow without a port-handle
    // (legacy path + fallback) still see a typed media URL.
    const outputInputs = resolveNodeInputs(subNode, subEdges, nodeStates, subNodes)
    if (outputInputs.imageUrl && !output.imageUrl) output.imageUrl = outputInputs.imageUrl
    if (outputInputs.videoUrl && !output.videoUrl) output.videoUrl = outputInputs.videoUrl
    if (outputInputs.audioUrl && !output.audioUrl) output.audioUrl = outputInputs.audioUrl
    if (outputInputs.prompt && !output.text) output.text = outputInputs.prompt
  }

  if (Object.keys(outputResults).length > 0) {
    output._outputResults = outputResults
    if (visiblePortId && outputResults[visiblePortId]) {
      output._visibleOutputPortId = visiblePortId
    }
  }

  // Fallback: if no output node was found, collect from all terminal nodes
  if (!output.imageUrl && !output.videoUrl && !output.audioUrl && !output.text) {
    const terminalNodes = findTerminalNodes(subNodes, subEdges)
    for (const termNode of terminalNodes) {
      const state = nodeStates[termNode.id]
      if (state?.output) {
        if (state.output.imageUrl && !output.imageUrl) output.imageUrl = state.output.imageUrl
        if (state.output.videoUrl && !output.videoUrl) output.videoUrl = state.output.videoUrl
        if (state.output.audioUrl && !output.audioUrl) output.audioUrl = state.output.audioUrl
        if (state.output.text && !output.text) output.text = state.output.text
      }
    }
  }

  return { output, creditsUsed }
}

// ---------------------------------------------------------------------------
// Graph utilities
// ---------------------------------------------------------------------------

/**
 * BFS from inputNodeId to outputNodeId, returning all reachable node IDs.
 */
function getReachableNodes(
  inputId: string,
  outputId: string,
  edges: SimpleEdge[],
): Set<string> {
  const forwardReachable = bfs(inputId, edges, "forward")
  const backwardReachable = bfs(outputId, edges, "backward")

  // Intersection
  const reachable = new Set<string>()
  for (const id of forwardReachable) {
    if (backwardReachable.has(id)) reachable.add(id)
  }

  // Always include input and output
  reachable.add(inputId)
  reachable.add(outputId)

  return reachable
}

function bfs(
  startId: string,
  edges: SimpleEdge[],
  direction: "forward" | "backward",
): Set<string> {
  const visited = new Set<string>()
  const queue = [startId]

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)

    for (const edge of edges) {
      if (direction === "forward" && edge.source === current && !visited.has(edge.target)) {
        queue.push(edge.target)
      } else if (direction === "backward" && edge.target === current && !visited.has(edge.source)) {
        queue.push(edge.source)
      }
    }
  }

  return visited
}

function findTerminalNodes(
  nodes: SimpleNode[],
  edges: SimpleEdge[],
): SimpleNode[] {
  const hasOutgoing = new Set(edges.map((e) => e.source))
  return nodes.filter((n) => !hasOutgoing.has(n.id))
}
