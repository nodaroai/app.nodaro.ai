import type { NodaroClientCore } from "../core.js"
import type { Job } from "./jobs.js"

/**
 * A generation session: one run of work in a creation tool (Create Image,
 * Video, Music), optionally inside a project. Its project is fixed at
 * creation — to get an item into another project, move it into a session
 * there ({@link SessionsResource.moveItems}) or import a copy of the link.
 */
export interface GenerationSession {
  id: string
  /** Null when the session has no project, or its project was deleted. */
  projectId: string | null
  /** Null = untitled; a UI may fall back to the first prompt. */
  title: string | null
  /** The creation tool that owns the session, e.g. `"create-image"`. */
  tool: string
  createdAt: string
  /** The latest activity: an item added, or an edit. */
  updatedAt: string
  archivedAt: string | null
  /** The item picked as the session's cover (`update(id, { coverJobId })`); `null` = automatic. */
  coverJobId: string | null
  /** Live items: not removed, and their job not deleted. */
  itemCount: number
  /** Items removed from the session — its part of the Trash
   *  (`items(id, { removed: true })`, `client.trash.list()`). Absent from an
   *  older server. */
  removedCount?: number
  /** Up to four image links: the cover's image first when one is set, then the
   *  newest completed items. */
  previewUrls: string[]
}

export interface CreateSessionInput {
  /** One of your projects (on the side of the workspace line you are on). */
  projectId?: string
  title?: string
  /** Lowercase letters, digits and dashes, at most 40 — e.g. `"create-image"`. */
  tool: string
}

export interface UpdateSessionInput {
  /** `null` makes the session untitled again. */
  title?: string | null
  archived?: boolean
  /** One of the session's items to lead its previews (404 if it is not an
   *  item of this session); `null` goes back to automatic. */
  coverJobId?: string | null
}

export interface ListSessionsParams {
  /** A project's id, or `"none"` for the sessions with no project. */
  projectId?: string | "none"
  tool?: string
  /** Archived sessions are left out unless this is true. */
  includeArchived?: boolean
  /** Page size, 1–100 (server default 50). */
  limit?: number
  /** The previous page's `next`. */
  cursor?: string
}

/** One item of a session's feed: a link to one of your jobs. */
export interface SessionItem {
  jobId: string
  addedAt: string
  /** When the item was removed from the session (it is in the Trash); `null`
   *  for a live item. Absent from an older server. */
  removedAt?: string | null
  /** True when imported from elsewhere rather than born in this session. */
  imported: boolean
  importedFrom: { sessionId: string; title: string | null } | null
  job: Job
}

export interface ListSessionItemsParams {
  /** `true`: the items removed from the session (its Trash), newest removal first. */
  removed?: boolean
  limit?: number
  cursor?: string
}

/** {@link SessionsResource.moveItems}' body. */
export interface MoveSessionItemsInput {
  /** Items of `fromSessionId` to move, up to 100. */
  jobIds: string[]
  /** The session they are in now. It keeps them as removed items, so the move can be undone from its Trash. */
  fromSessionId: string
}

export interface SessionPage<T> {
  data: T[]
  /** Pass back as `cursor` for the next page; `null` on the last one. */
  next: string | null
}

export class SessionsResource {
  constructor(private client: NodaroClientCore) {}

  /**
   * Create a session. Send its `id` as `sessionId` on a generation request
   * (`nodes.run("generate-image", { sessionId, … })`, video, speech, music) and
   * the job is born in it.
   */
  create(input: CreateSessionInput): Promise<{ data: GenerationSession }> {
    return this.client.request("POST", "/v1/sessions", { body: input })
  }

  /** Your sessions, newest first. */
  list(params: ListSessionsParams = {}): Promise<SessionPage<GenerationSession>> {
    const query: Record<string, string> = {}
    if (params.projectId) query.projectId = params.projectId
    if (params.tool) query.tool = params.tool
    if (params.includeArchived) query.includeArchived = "true"
    if (params.limit !== undefined) query.limit = String(params.limit)
    if (params.cursor) query.cursor = params.cursor
    return this.client.request("GET", "/v1/sessions", { query })
  }

  get(id: string): Promise<{ data: GenerationSession }> {
    return this.client.request("GET", `/v1/sessions/${encodeURIComponent(id)}`)
  }

  /** Rename or archive a session, or pick its cover. Its project cannot change. */
  update(id: string, input: UpdateSessionInput): Promise<{ data: GenerationSession }> {
    return this.client.request("PATCH", `/v1/sessions/${encodeURIComponent(id)}`, { body: input })
  }

  /** Delete a session and its links. Its jobs are kept, and stay in every other session holding them. */
  delete(id: string): Promise<{ success: true }> {
    return this.client.request("DELETE", `/v1/sessions/${encodeURIComponent(id)}`)
  }

  /**
   * The session's live items, born-in and imported, newest first — or, with
   * `{ removed: true }`, the items removed from it (its part of the Trash),
   * newest removal first. An item whose job was deleted is in neither: it is in
   * `client.trash.list()` as the deleted job.
   */
  items(id: string, params: ListSessionItemsParams = {}): Promise<SessionPage<SessionItem>> {
    const query: Record<string, string> = {}
    if (params.removed) query.removed = "true"
    if (params.limit !== undefined) query.limit = String(params.limit)
    if (params.cursor) query.cursor = params.cursor
    return this.client.request("GET", `/v1/sessions/${encodeURIComponent(id)}/items`, { query })
  }

  /**
   * Import some of your own jobs into a session — a link, not a copy (up to 100
   * a call). All-or-nothing: if any id is not one of your jobs, nothing is
   * imported and the call fails with 404. Items already there are left as they
   * are; an item removed from the session comes back where it was.
   */
  importItems(id: string, input: { jobIds: string[] }): Promise<{ data: { imported: number; requested: number } }> {
    return this.client.request("POST", `/v1/sessions/${encodeURIComponent(id)}/items`, { body: input })
  }

  /**
   * Remove one item from a session: it goes to the session's Trash until
   * {@link restoreItem} brings it back or `{ forever: true }` deletes it for good
   * — no automatic cleanup. Only the link moves: the job, and every other
   * session holding it, stay; an item in no session shows in General
   * (`client.jobs.list({ inSession: false })`). `forever` on an item that is
   * not removed fails with a 409 `NodaroError` whose `code` is `"not_in_trash"`.
   */
  removeItem(id: string, jobId: string, options: { forever?: boolean } = {}): Promise<{ success: true }> {
    return this.client.request(
      "DELETE",
      `/v1/sessions/${encodeURIComponent(id)}/items/${encodeURIComponent(jobId)}`,
      options.forever ? { query: { forever: "true" } } : {},
    )
  }

  /** Bring a removed item back into the session, where it was. An item that is not removed succeeds too. */
  restoreItem(id: string, jobId: string): Promise<{ success: true }> {
    return this.client.request(
      "POST",
      `/v1/sessions/${encodeURIComponent(id)}/items/${encodeURIComponent(jobId)}/restore`,
    )
  }

  /**
   * Move items of another of your sessions into `targetId`, in one
   * transaction: the target gets them (born-in stays born-in, else imported
   * from the source), the source keeps them as removed items — so the move is
   * undone with `restoreItem(fromSessionId, jobId)`. A session in another
   * project is how an item moves to another project. All-or-nothing: if any id
   * is not a live item of `fromSessionId`, nothing moves (404).
   */
  moveItems(targetId: string, input: MoveSessionItemsInput): Promise<{ data: { moved: number } }> {
    return this.client.request("POST", `/v1/sessions/${encodeURIComponent(targetId)}/items/move`, { body: input })
  }
}
