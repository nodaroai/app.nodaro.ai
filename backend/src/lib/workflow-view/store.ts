/**
 * The rows of `workflow_view_links` (migration 691): one per workflow, read
 * and written only here, with the service role. Every function throws on a
 * database error; a missing table is noted for the presence gate first
 * (table.ts) and thrown as `ViewLinksUnavailableError`, which the routes
 * answer 503 not_available.
 */
import { randomBytes } from "node:crypto"
import { supabase } from "../supabase.js"
import { isUserBlocked } from "../access-blocks.js"
import { noteViewLinksTableError, VIEW_LINKS_TABLE } from "./table.js"

/** The columns every read but the download names: never the saved copy itself. */
const LINK_COLUMNS = "workflow_id, owner_id, token, indexable, locale, export_includes_assets, exported_at, created_at"

export interface ViewLinkRow {
  readonly workflow_id: string
  readonly owner_id: string
  readonly token: string
  readonly indexable: boolean
  readonly locale: string | null
  readonly export_includes_assets: boolean | null
  readonly exported_at: string | null
  readonly created_at: string
}

/** What the owner is told about their link. */
export type ViewLinkState =
  | { readonly enabled: false }
  | {
      readonly enabled: true
      readonly token: string
      readonly indexable: boolean
      readonly export: { readonly exportedAt: string; readonly includesAssets: boolean } | null
      readonly createdAt: string
    }

export class ViewLinksUnavailableError extends Error {
  constructor() {
    super("workflow_view_links is not in this database yet")
    this.name = "ViewLinksUnavailableError"
  }
}

/** A view token: 32 random bytes, base64url (43 characters, the table's CHECK). */
export function newViewToken(): string {
  return randomBytes(32).toString("base64url")
}

/** The shape every token has: anything else is answered as unknown without a read. */
export const VIEW_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

function fail(error: { code?: string | null } | null): never {
  if (noteViewLinksTableError(error)) throw new ViewLinksUnavailableError()
  throw error
}

export function exportStateOf(row: Pick<ViewLinkRow, "exported_at" | "export_includes_assets">): { exportedAt: string; includesAssets: boolean } | null {
  return row.exported_at ? { exportedAt: row.exported_at, includesAssets: row.export_includes_assets === true } : null
}

export function viewLinkState(row: ViewLinkRow | null): ViewLinkState {
  if (!row) return { enabled: false }
  return { enabled: true, token: row.token, indexable: row.indexable, export: exportStateOf(row), createdAt: row.created_at }
}

/** The link of `workflowId`, whoever turned it on. */
export async function readViewLinkOf(workflowId: string): Promise<ViewLinkRow | null> {
  const { data, error } = await supabase.from(VIEW_LINKS_TABLE).select(LINK_COLUMNS).eq("workflow_id", workflowId).maybeSingle()
  if (error) fail(error)
  return (data as ViewLinkRow | null) ?? null
}

/**
 * Turns the link on for `ownerId` (idempotent). A link left over from an
 * earlier owner of the workflow is replaced: a link answers only for the
 * workflow's current creator, so the old one was dead already.
 */
export async function enableViewLink(workflowId: string, ownerId: string, locale: string | null): Promise<ViewLinkRow> {
  const existing = await readViewLinkOf(workflowId)
  if (existing && existing.owner_id === ownerId) {
    if (locale && locale !== existing.locale) return updateViewLink(workflowId, ownerId, { locale })
    return existing
  }
  if (existing) await revokeViewLink(workflowId)
  const { error } = await supabase
    .from(VIEW_LINKS_TABLE)
    .upsert({ workflow_id: workflowId, owner_id: ownerId, token: newViewToken(), locale }, { onConflict: "workflow_id", ignoreDuplicates: true })
  if (error) fail(error)
  // Two enables at once: the second's insert is ignored, and both read the one row.
  const row = await readViewLinkOf(workflowId)
  if (!row) throw new Error("the view link vanished right after it was written")
  return row
}

/** One owner-scoped update; null when the link is gone (or not theirs). */
export async function updateViewLink(
  workflowId: string,
  ownerId: string,
  patch: Partial<{ indexable: boolean; locale: string | null; export_snapshot: unknown; export_includes_assets: boolean | null; exported_at: string | null }>,
): Promise<ViewLinkRow> {
  const { data, error } = await supabase
    .from(VIEW_LINKS_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("workflow_id", workflowId)
    .eq("owner_id", ownerId)
    .select(LINK_COLUMNS)
    .maybeSingle()
  if (error) fail(error)
  if (!data) throw new ViewLinkMissingError()
  return data as ViewLinkRow
}

export class ViewLinkMissingError extends Error {
  constructor() {
    super("no view link to change")
    this.name = "ViewLinkMissingError"
  }
}

/** Turns the link off: the row (and its saved copy) is deleted, so the token never answers again. */
export async function revokeViewLink(workflowId: string): Promise<void> {
  const { error } = await supabase.from(VIEW_LINKS_TABLE).delete().eq("workflow_id", workflowId)
  if (error) fail(error)
}

export interface ViewedWorkflow {
  readonly id: string
  readonly name: string
  readonly nodes: unknown
  readonly edges: unknown
  readonly settings: unknown
  readonly user_id: string
}

export interface LiveViewLink {
  readonly link: ViewLinkRow
  readonly workflow: ViewedWorkflow
}

/**
 * The link a public token names, with its workflow, when it may be shown: the
 * link exists, its workflow is still its owner's and not in a workspace, and
 * the owner is not blocked. Anything else is null (the caller answers 404, never which).
 */
export async function readLiveViewLink(token: string): Promise<LiveViewLink | null> {
  if (!VIEW_TOKEN_RE.test(token)) return null
  const { data, error } = await supabase.from(VIEW_LINKS_TABLE).select(LINK_COLUMNS).eq("token", token).maybeSingle()
  if (error) fail(error)
  const link = data as ViewLinkRow | null
  if (!link) return null
  const [blocked, workflowRead] = await Promise.all([
    isUserBlocked(link.owner_id),
    supabase.from("workflows").select("id, name, nodes, edges, settings, user_id, workspace_id").eq("id", link.workflow_id).maybeSingle(),
  ])
  if (workflowRead.error) throw workflowRead.error
  const workflow = workflowRead.data as (ViewedWorkflow & { workspace_id?: string | null }) | null
  // A workflow that moved into a workspace (its project did) is no longer shown by link, as a share link's item is not.
  if (blocked || !workflow || workflow.user_id !== link.owner_id || workflow.workspace_id) return null
  return { link, workflow }
}

/** The saved copy a live link offers, or null. */
export async function readViewExport(token: string): Promise<{ snapshot: unknown; name: string } | null> {
  const live = await readLiveViewLink(token)
  if (!live?.link.exported_at) return null
  const { data, error } = await supabase.from(VIEW_LINKS_TABLE).select("export_snapshot").eq("token", token).maybeSingle()
  if (error) fail(error)
  const snapshot = (data as { export_snapshot?: unknown } | null)?.export_snapshot
  if (!snapshot) return null
  // The copy's own name: the file is named as it was saved, like everything in it.
  const saved = (snapshot as { name?: unknown }).name
  return { snapshot, name: typeof saved === "string" ? saved : live.workflow.name }
}

export interface OwnWorkflow extends ViewedWorkflow {
  readonly workspace_id: string | null
}

/** The workflow `workflowId` when `userId` created it, else null. The owner routes' one read of the workflow. */
export async function readOwnWorkflow(userId: string, workflowId: string): Promise<OwnWorkflow | null> {
  const { data, error } = await supabase
    .from("workflows")
    .select("id, name, nodes, edges, settings, user_id, workspace_id")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  return (data as OwnWorkflow | null) ?? null
}
