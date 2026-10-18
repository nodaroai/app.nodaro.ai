import type { NodaroClientCore } from "../core.js"
import type { Job } from "./jobs.js"

/**
 * A generation session: one run of work in a creation tool (Create Image,
 * Video, Music), optionally inside a project. Its project is fixed at
 * creation — to get an item into another project, import it into a session
 * there.
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
  itemCount: number
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
  projectId?: string
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
  /** True when imported from elsewhere rather than born in this session. */
  imported: boolean
  importedFrom: { sessionId: string; title: string | null } | null
  job: Job
}

export interface ListSessionItemsParams {
  limit?: number
  cursor?: string
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

  /** The session's items, born-in and imported, newest first. */
  items(id: string, params: ListSessionItemsParams = {}): Promise<SessionPage<SessionItem>> {
    const query: Record<string, string> = {}
    if (params.limit !== undefined) query.limit = String(params.limit)
    if (params.cursor) query.cursor = params.cursor
    return this.client.request("GET", `/v1/sessions/${encodeURIComponent(id)}/items`, { query })
  }

  /**
   * Import some of your own jobs into a session — a link, not a copy (up to 100
   * a call). All-or-nothing: if any id is not one of your jobs, nothing is
   * imported and the call fails with 404. Items already there are left as they are.
   */
  importItems(id: string, input: { jobIds: string[] }): Promise<{ data: { imported: number; requested: number } }> {
    return this.client.request("POST", `/v1/sessions/${encodeURIComponent(id)}/items`, { body: input })
  }

  /** Remove one item from a session. Only the link goes: the job, and every other session holding it, stay. */
  removeItem(id: string, jobId: string): Promise<{ success: true }> {
    return this.client.request(
      "DELETE",
      `/v1/sessions/${encodeURIComponent(id)}/items/${encodeURIComponent(jobId)}`,
    )
  }
}
