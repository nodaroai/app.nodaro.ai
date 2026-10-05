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
 * Realtime is the other way a row reaches the browser: a broadcast IS the
 * stored row (REPLICA IDENTITY FULL), pushed to every socket subscribed to it.
 * So a canvas subscribes only while its access is `own` or `edit`
 * (`mayHoldStoredRow`); a `view` reader's canvas opens no subscription at all,
 * polls a content-free stamp instead and re-reads through the server when it
 * moves (T85 / T86, `use-workflow-realtime-sync.ts`).
 *
 * That access is the reader's CURRENT one, not only what the load was told: it
 * can change while a canvas is open (an `edit` collaborator lowered to `view`,
 * or removed), so the canvas re-asks it (T97, `use-workflow-access-recheck.ts`)
 * every minute while its tab is visible, as soon as the tab is shown again, and
 * the moment a save is turned away or meets a row it can no longer read. Each
 * answer goes into the record the load wrote, and an answer of `view` or
 * `none` closes the subscription and stops every save on the spot; the canvas
 * turns read-only too, once no node shows a run in flight, so a paid run
 * already out still lands its result on its node (`applyWorkflowAccess`; a run
 * outside the executors, such as Generate All Assets on a character's or
 * object's page, marks its node through `withRunInFlight`). (An owner's own
 * row stays theirs, and so does its subscription; only the saves stop and the
 * canvas turns read-only: `recheckedAccess`.) So the app never holds what the
 * reader's CURRENT access forbids, with three exceptions. Between two asks a
 * canvas acts on the last answer it had: up to a minute in a visible tab, and
 * in a hidden one until it is shown again or a save misses. What it was shown
 * under an earlier, wider access stays on screen, never saved, until the
 * canvas is reloaded, or, with no unsaved changes on it, until the row next
 * moves and the stripped re-read replaces it (a reader with no access left is
 * sent nothing to replace it with). And
 * the record keeps any `own`, not only the owner's: the server answers a
 * platform admin `own` too, and the record cannot tell the two apart. So an
 * admin who loses that role while the canvas is open keeps the subscription
 * until the canvas is reloaded, and receives the stored row on it for as long
 * as they may still view the workflow.
 *
 * Residual, accepted for now by Tal on 2026-10-04 (T96): a `view` reader who
 * deliberately queries the database with their own token can still read the
 * stored row. The row policies (`workflows_select`, migration 338) let them
 * SELECT it, so a direct PostgREST query returns it whole, and a Realtime
 * channel they open on the row by hand receives its broadcasts (the app never
 * opens one for them). All of the above governs what the APP asks for and
 * keeps; only a database change can stop a determined reader. RLS chooses
 * rows, not columns, and a column privilege binds every signed-in caller alike
 * (owners included), so closing it is a separate future program, the database
 * permission change: narrow `workflows_select` to `own` / `edit`, and move a
 * `view` reader's remaining table reads, the T85 stamp poll among them, behind
 * server routes.
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
  /**
   * The owner's nodes AS STORED, present only when `row` is the server's
   * resolved answer taken in place of the stored row. What is saved differs
   * from what the canvas holds by exactly the results the server resolved, so
   * a save baseline seeded from it (`savedBaselineNodes`) writes them once.
   */
  readonly storedNodes?: unknown
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
    if (data) {
      const row = data as unknown as WorkflowContentRow
      // Saved result ids the server resolves on read (decided 2026-10-05): a
      // placeholder `exec-…` job id, or an Apply EDL take with no Preview
      // label. The rule is the server's alone (backend lib/canvas-result-ids.ts,
      // one jobs lookup), so a row that may hold one is read through the same
      // door everyone else uses; the canvas then holds the real ids and its
      // next ordinary save persists them. Nothing is written by the read, so
      // the save cursor (`version`, `updated_at`) is the stored row's. Only an
      // `own` answer is taken: a creator the server answers `view` (an archived
      // workspace) would be handed the reader's projection, without the drafts
      // their canvas saves back. Any other answer, or none, keeps the stored row.
      if (mayHoldUnresolvedResultIds(row.nodes)) {
        const served = await readWorkflowContentFromServer(workflowId).catch(() => null)
        // Judged against the workflow asked for, not `row.id`: a projection
        // that selected no `id` (duplicate's) would otherwise discard every
        // answer it paid for.
        if (served && served.access === "own" && served.row.id === workflowId) return { ...served, storedNodes: row.nodes }
      }
      return { row, access: "own" }
    }
  }
  return readWorkflowContentFromServer(workflowId)
}

/**
 * Whether a stored graph may hold a saved result id the server resolves on
 * read: a placeholder job id (`exec-…`) or an Apply EDL take whose result
 * carries no render quality. Deliberately WIDER than the server's exact rule —
 * a miss keeps the owner's canvas on the stored ids for good, while a false hit
 * costs one read that hands the same row back.
 */
export function mayHoldUnresolvedResultIds(nodes: unknown): boolean {
  if (!Array.isArray(nodes)) return false
  return nodes.some((node) => {
    const n = (node && typeof node === "object" ? node : {}) as { type?: unknown; data?: { generatedResults?: unknown } }
    const results = n.data?.generatedResults
    if (!Array.isArray(results)) return false
    return results.some((r) => {
      const entry = (r && typeof r === "object" ? r : {}) as { jobId?: unknown; url?: unknown; quality?: unknown }
      if (typeof entry.jobId !== "string" || typeof entry.url !== "string" || entry.url.length === 0) return false
      if (entry.jobId.startsWith("exec-")) return true
      return n.type === "apply-edl" && entry.quality !== "proxy" && entry.quality !== "final"
    })
  })
}

/**
 * The save baseline a load should keep: `loadedNodes` (what the canvas was
 * handed, its `lastSavedSnapshot.nodes`) with each node the server resolved on
 * the way out replaced by its STORED copy — the SAME array when nothing was.
 *
 * Why: the delta save writes only nodes that differ from this baseline, so a
 * baseline equal to the resolved copy would never write a resolved id the user
 * did not otherwise touch, and every open would pay the server read again. The
 * full save writes every node, so it needs nothing from this.
 */
export function savedBaselineNodes<N extends { readonly id: string }>(
  loadedNodes: readonly N[],
  content: { readonly row: Pick<WorkflowContentRow, "nodes">; readonly storedNodes?: unknown },
): readonly N[] {
  if (!Array.isArray(content.storedNodes) || content.storedNodes === content.row.nodes) return loadedNodes
  const servedById = new Map<unknown, string>()
  for (const n of Array.isArray(content.row.nodes) ? content.row.nodes : []) {
    const id = (n as { id?: unknown } | null)?.id
    if (typeof id === "string") servedById.set(id, JSON.stringify(n))
  }
  const storedChanged = new Map<string, N>()
  for (const n of content.storedNodes) {
    const id = (n as { id?: unknown } | null)?.id
    if (typeof id !== "string") continue
    const served = servedById.get(id)
    if (served !== undefined && served !== JSON.stringify(n)) storedChanged.set(id, n as N)
  }
  if (storedChanged.size === 0) return loadedNodes
  return loadedNodes.map((n) => storedChanged.get(n.id) ?? n)
}

/**
 * The server's answer alone, for a caller that must not be handed the stored
 * row — a `view` reader's canvas re-reading after its poll saw the row move —
 * and so has no use for the owner probe.
 */
export async function readWorkflowContentFromServer(workflowId: string): Promise<WorkflowContent | null> {
  const doc = await getWorkflowDocument(workflowId)
  return doc ? { row: toContentRow(doc), access: doc.access } : null
}

/**
 * The access a canvas holds a workflow under — what its load answered, then
 * whatever each re-check of it answered since (T97) — keyed by the workflow it
 * was answered for, so it can only ever speak for that one (the store's
 * `loadedAccess`; T86). `none` is a re-check's answer only: a load that cannot
 * reach the workflow records nothing.
 */
export interface LoadedWorkflowAccess {
  readonly workflowId: string
  readonly access: WorkflowAccessLevel
}

/**
 * Whether the canvas showing `workflowId` may hold its row as stored — which is
 * what a Realtime broadcast carries. Its owner and an `edit` collaborator may
 * (the server answers both the stored row); a `view` reader may not, nor one a
 * re-check found with no access left. Fails closed: no record yet (the load
 * has not answered, or it failed), or a record for another workflow, counts as
 * `view`.
 */
export function mayHoldStoredRow(
  loaded: LoadedWorkflowAccess | null | undefined,
  workflowId: string | null | undefined,
): boolean {
  return !!loaded && !!workflowId && loaded.workflowId === workflowId && (loaded.access === "own" || loaded.access === "edit")
}

/**
 * The record after a re-check of its access answered `answer` (T97).
 *
 * The answer replaces the level, with one exception: `own` stays `own`. On the
 * load's owner branch `own` says whose row it is (the query matched the
 * caller's own `user_id`), and that is not something an access verdict takes
 * away: the server answers the creator `view` once their workspace is archived
 * and `none` while their membership is suspended, the row policies still hand
 * them the row, and the drafts in it are their own. Their saves still stop on
 * such an answer, and their canvas still turns read-only
 * (`applyWorkflowAccess`). A workflow's creator cannot change from a browser
 * (`check_workflows_update_allowed`, migration 338). The one other `own`
 * record is a platform admin's, answered by the server; losing that role
 * mid-session is not the access change these re-checks are for.
 *
 * The same object comes back when nothing changed, so a re-check that confirms
 * the record re-renders nothing that reads it.
 */
export function recheckedAccess(loaded: LoadedWorkflowAccess, answer: WorkflowAccessLevel): LoadedWorkflowAccess {
  if (loaded.access === "own" || loaded.access === answer) return loaded
  return { workflowId: loaded.workflowId, access: answer }
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
