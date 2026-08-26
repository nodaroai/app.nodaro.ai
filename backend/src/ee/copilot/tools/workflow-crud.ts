/**
 * `get_workflow_graph` and `create_workflow` — the copilot reading, and
 * starting, workflows OTHER than the one on screen.
 *
 * Both are deliberately thin wrappers over machinery that already exists.
 * `get_workflow_graph` re-points `runGetGraph` at another id; `create_workflow`
 * inserts an EMPTY row and then calls `runEditWorkflow` against it. Neither
 * grows a write path or a projection of its own, so every guard the editor
 * tools have — the URL lock, the node-type denials, the ownership checks, the
 * byte caps, and every guard added after this file is written — applies by
 * construction rather than by remembering to copy it.
 */
import { supabase } from "../../../lib/supabase.js"
import { runGetGraph } from "./get-graph.js"
import { runEditWorkflow, type EditWorkflowArgs, type EditWorkflowResult } from "./edit-workflow.js"
import { EditRejected } from "./edit-rejected.js"
import type { CopilotToolContext } from "./types.js"

export interface GetWorkflowGraphArgs {
  workflow_id?: string
}

/**
 * Read another workflow of the user's, in the SAME project as the open one.
 *
 * Scope is the pair `(user_id, project_id)` on one query chain — the same
 * predicate `list_workflows` uses, so what the model can NAME through that
 * tool is exactly what it can READ through this one. `user_id` is the
 * authorization; `project_id` is a narrowing filter and never a substitute
 * for it (`project-scope-guard.test.ts` pins that pairing across the MCP
 * tools, and the reason holds here).
 *
 * Widening this to the whole account is a real decision — a user's other
 * projects can hold client work they would not expect this conversation to
 * read — and it is deliberately not taken here.
 */
export async function runGetWorkflowGraph(
  ctx: CopilotToolContext,
  args: GetWorkflowGraphArgs,
): Promise<string> {
  const targetId = typeof args.workflow_id === "string" ? args.workflow_id.trim() : ""
  if (!targetId) throw new EditRejected("get_workflow_graph: workflow_id is required.")

  // The open workflow needs no lookup — and asking for it by id must not
  // behave differently from `get_graph`.
  if (targetId === ctx.workflowId) return runGetGraph(ctx, {})

  const { data, error } = await supabase
    .from("workflows")
    .select("id")
    .eq("id", targetId)
    .eq("user_id", ctx.userId)
    .eq("project_id", ctx.projectId)
    .maybeSingle()
  if (error) throw new Error(`get_workflow_graph: ${error.message}`)
  if (!data) {
    // One wording for "not yours", "not in this project" and "does not exist".
    // Three answers would make this an existence oracle for other people's ids.
    throw new EditRejected(
      "No workflow with that id in this project. Use list_workflows to see what is here.",
    )
  }

  // Everything `get_graph` does — the projection, the URL policy, the last
  // run's per-node status — pointed at the other id.
  return runGetGraph({ ...ctx, workflowId: targetId }, {})
}

export interface CreateWorkflowArgs {
  name?: string
  /** Same shapes `edit_workflow` takes — it is the writer, and it validates. */
  nodes?: EditWorkflowArgs["upsertNodes"]
  edges?: EditWorkflowArgs["upsertEdges"]
  note?: string
}

export interface CreateWorkflowResult {
  readonly workflowId: string
  readonly name: string
  readonly edit: EditWorkflowResult
}

const NAME_MAX = 120

/**
 * Create a workflow and build it in ONE tool call, in two steps that share no
 * write path.
 *
 * Step 1 inserts an empty row. Step 2 is `runEditWorkflow` against the new id.
 * The tool therefore has no graph writer of its own: nodes reach the database
 * only through the path the deny lists, the destination lock, the URL lock and
 * the byte caps already guard.
 *
 * `project_id` and `user_id` come from `ctx`, never from the model — an
 * argument for either would be an authorization channel. **There is no
 * `settings` argument and there must never be one:** `settings.studio.shared`
 * makes a workflow's full graph readable with no authentication at
 * `GET /v1/public/workflows/:id`, so one accepted field would turn "build me a
 * flow" into "publish my flow to the internet". `edit_workflow` excludes
 * `settings` for the same reason.
 */
export async function runCreateWorkflow(
  ctx: CopilotToolContext,
  args: CreateWorkflowArgs,
): Promise<CreateWorkflowResult> {
  const name = typeof args.name === "string" && args.name.trim() ? args.name.trim().slice(0, NAME_MAX) : "Untitled workflow"

  const { data, error } = await supabase
    .from("workflows")
    .insert({
      user_id: ctx.userId,
      project_id: ctx.projectId,
      name,
      nodes: [],
      edges: [],
      // Written explicitly rather than left to the column default: this empty
      // object is the security property, and a default can be changed by a
      // migration that never thinks about this file.
      settings: {},
    })
    .select("id, name")
    .single()
  if (error) throw new Error(`create_workflow: ${error.message}`)
  const created = data as { id: string; name: string }

  // Step 2. A derived context so the edit lands on the NEW workflow while
  // every other property of this turn — the user, the project, the publishing
  // permission, the pasted links — travels unchanged.
  //
  // The build is what makes the row worth having, so a build that FAILS takes
  // the row with it. `edit_workflow` rejects for ordinary reasons — a denied
  // node type, an invented entity id, a raw URL — and without this the model
  // would leave an empty workflow behind on every one of them, which is
  // exactly the abandoned-seed bug the home-page hand-off had (#904). Worse
  // here: the user would be handed a link to it.
  let edit: EditWorkflowResult
  try {
    edit = await runEditWorkflow(
      { ...ctx, workflowId: created.id },
      {
        upsertNodes: args.nodes,
        // `upsertEdges`, not `edges` — the writer's own field name. Spelled
        // wrong it type-checks as an extra property and silently drops every
        // edge, leaving a pile of unconnected nodes.
        upsertEdges: args.edges,
        note: typeof args.note === "string" ? args.note : `Created ${created.name}`,
      },
    )
  } catch (err) {
    // Owner-scoped, like every other delete. Best-effort: if the row survives
    // it is an empty workflow nobody was told about, which is the lesser of
    // the two failures — the model still hears why the build was refused.
    await supabase.from("workflows").delete().eq("id", created.id).eq("user_id", ctx.userId)
    throw err
  }

  // Announced only once it EXISTS as something worth opening. Emitting before
  // the build would pin a link to an empty canvas whenever step 2 failed.
  ctx.emit({
    type: "workflow_created",
    data: { workflowId: created.id, name: created.name, projectId: ctx.projectId },
  })

  return { workflowId: created.id, name: created.name, edit }
}
