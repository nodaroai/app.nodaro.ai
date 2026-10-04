import { createClient } from "@/lib/supabase"
import { getCurrentUserId, getWorkflowDocument, type WorkflowAccessLevel, type WorkflowDocument } from "@/lib/api"

/**
 * THE way the browser reads a workflow's CONTENT — its `nodes` and `settings`.
 *
 * A studio production keeps its owner's working state inside those two
 * columns: the empty media slots and the runs in flight on each scene, the
 * drafts in the bin (`settings.studio`), and every finished take's voice plan
 * (`data.generatedResults[]` on the canvas nodes). Nobody the owner only let
 * LOOK may receive any of it (studio rulings T11 / T21 / T42). Every server
 * door a `view` reader uses already strips it — `GET /v1/workflows/:id` among
 * them (`stripStudioDraftWorkflow`) — but the browser's own PostgREST client
 * is not a door: the row policies let a `view` reader SELECT the row, so a
 * plain `.select("*")` hands them the stored document whole.
 *
 * So the stored row is read here only for its OWNER, and the query itself says
 * so — `.eq("user_id", me)`, with `me` taken from the session that signs the
 * request — so the raw bytes this returns can only ever be the caller's own.
 * Everyone else is asked of the server, which answers by access: the stored
 * row for `edit` (their editor saves the graph back whole, so it must keep the
 * owner's drafts — T21 / T77) and the reader's projection for `view`. The
 * browser never applies a strip itself; what a reader may hold is the server's
 * answer, in one place.
 *
 * Guarded: `lib/__tests__/workflow-content-read-guard.test.ts` fails the build
 * on any other browser read of `workflows` that selects content without being
 * scoped to the caller's own rows.
 *
 * Accepted residual (#1596): the row policies still let a `view` reader query
 * the table themselves, and Realtime still pushes the row to their socket.
 * This module keeps the APP from ever holding what it should not; only a
 * database change can stop a determined reader.
 */

/** What the reader was judged at. `own` on the owner's branch is a statement
 *  about whose row it is — what they may DO is still asked of the server
 *  (`applyWorkflowAccess`). */
export type WorkflowContentAccess = Exclude<WorkflowAccessLevel, "none">

/**
 * The row fields the content readers use, in the table's own spelling — the
 * owner's branch returns the row PostgREST gives, and the server's answer is
 * mapped onto the same names, so a caller cannot tell which branch it got.
 * Optional because a caller selects only what it needs.
 */
export interface WorkflowContentRow {
  readonly id: string
  readonly name?: string
  readonly user_id?: string
  readonly project_id?: string | null
  readonly folder_id?: string | null
  readonly nodes?: unknown
  readonly edges?: unknown
  readonly settings?: unknown
  readonly updated_at?: string
  readonly version?: number | null
}

export interface WorkflowContent {
  readonly row: WorkflowContentRow
  readonly access: WorkflowContentAccess
}

/**
 * Read one workflow's content as THIS caller may hold it.
 *
 * `projection` is the owner branch's column list — the same list the caller
 * selected before this existed, so an owner's read is the query it always was
 * plus the owner filter. A non-owner gets the server's whole document whatever
 * the list says.
 *
 * Null when the caller cannot reach the workflow. A failed request throws.
 */
export async function readWorkflowContent(workflowId: string, projection: string): Promise<WorkflowContent | null> {
  const me = await getCurrentUserId()
  if (me) {
    const { data, error } = await createClient()
      .from("workflows")
      .select(projection)
      .eq("id", workflowId)
      .eq("user_id", me)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data) return { row: data as unknown as WorkflowContentRow, access: "own" }
  }
  return readWorkflowContentFromServer(workflowId)
}

/**
 * The server's answer alone, for a caller that already knows the row is not its
 * own — a Realtime broadcast about somebody else's workflow — and so has no use
 * for the owner probe.
 */
export async function readWorkflowContentFromServer(workflowId: string): Promise<WorkflowContent | null> {
  const doc = await getWorkflowDocument(workflowId)
  return doc ? { row: toContentRow(doc), access: doc.access } : null
}

/**
 * Whether a row is the caller's own, by its `user_id`. Fails closed: a row with
 * no `user_id`, or a caller not known yet, is somebody else's.
 */
export function isOwnWorkflowRow(row: { readonly user_id?: unknown }, callerId: string | null | undefined): boolean {
  return !!callerId && typeof row.user_id === "string" && row.user_id === callerId
}

function toContentRow(doc: WorkflowDocument): WorkflowContentRow {
  return {
    id: doc.id,
    name: doc.name,
    user_id: doc.userId,
    project_id: doc.projectId ?? null,
    folder_id: doc.folderId ?? null,
    nodes: doc.nodes,
    edges: doc.edges,
    settings: doc.settings,
    updated_at: doc.updatedAt,
    version: typeof doc.version === "number" ? doc.version : null,
  }
}
