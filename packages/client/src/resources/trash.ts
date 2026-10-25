import type { NodaroClientCore } from "../core.js"
import type { Job } from "./jobs.js"

/** The session a removed item was removed from. */
export interface TrashSession {
  id: string
  title: string | null
  projectId: string | null
}

/**
 * One entry of the Trash: an item removed from a session, or a deleted job.
 * Narrow on `kind`.
 *
 * - `removed`: kept until restored (`client.sessions.restoreItem(session.id, job.id)`)
 *   or deleted for good (`client.sessions.removeItem(session.id, job.id, { forever: true })`).
 * - `deleted`: kept until `purgeAt` (30 days after `deletedAt`), then deleted for
 *   good (a copy saved to the Library stays); restore with `client.jobs.restore(job.id)`, or delete
 *   now with `client.jobs.delete(job.id, { forever: true })`.
 *
 * A removed item whose job was also deleted is listed once, as the deleted job.
 */
export type TrashEntry =
  | { kind: "removed"; removedAt: string; session: TrashSession; job: Job }
  | { kind: "deleted"; deletedAt: string; purgeAt: string; job: Job }

export interface ListTrashParams {
  /**
   * A project's id: its sessions' removed items, and deleted jobs a session of
   * it held. `"none"`: the sessions with no project, and General.
   */
  projectId?: string | "none"
  /**
   * A creation tool (e.g. `"create-image"`): what a session of that tool holds
   * or held. A job no session ever held has no tool and is left out — filter by
   * `type` alone to include it.
   */
  tool?: string
  /**
   * The job's `input_data.type` (`"generate-image"`, …), like `client.jobs.list`.
   * One value or several (up to 20). Every filter combines with AND.
   */
  type?: string | readonly string[]
  /** Page size, 1–100 (server default 50). */
  limit?: number
  /** The previous page's `next`. */
  cursor?: string
}

export interface TrashPage {
  /** A page may hold fewer than `limit` entries and still carry a `next`; page on `next`. */
  data: TrashEntry[]
  /** Pass back as `cursor` for the next page; `null` on the last one. */
  next: string | null
}

/** Your Trash (`GET /v1/trash`): one entry beside General in a creation tool's sessions list. */
export class TrashResource {
  constructor(private client: NodaroClientCore) {}

  /** One newest-first page of the Trash, on your side of the workspace line. */
  list(params: ListTrashParams = {}): Promise<TrashPage> {
    const query: Record<string, string> = {}
    if (params.projectId) query.projectId = params.projectId
    if (params.tool) query.tool = params.tool
    if (params.type !== undefined) query.type = typeof params.type === "string" ? params.type : params.type.join(",")
    if (params.limit !== undefined) query.limit = String(params.limit)
    if (params.cursor) query.cursor = params.cursor
    return this.client.request("GET", "/v1/trash", { query })
  }
}
