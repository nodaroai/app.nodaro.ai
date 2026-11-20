import type { NodaroClientCore } from "../core.js"

/**
 * Share links — one result (a job), a generation session or a project, shared
 * view only by an unguessable link. Mirrors the backend's `/v1/shares` and
 * `/v1/public/shares/:token` wire contract (`routes/shares.ts`); the types are
 * declared here so the SDK stays dependency-free.
 */

export type ShareKind = "job" | "session" | "project"

/** Your link for one of your items. */
export interface Share {
  /**
   * The capability: anyone holding it can open the link while it is on. 43
   * characters, base64url. The address to hand out is the share card,
   * `https://nodaro.ai/s/<token>` on Nodaro (the deployment's share site): it
   * previews on social networks and chats, and opens the share page.
   */
  token: string
  kind: ShareKind
  targetId: string
  /** `false` once turned off: the link answers 404 until it is turned on again — with the same token. */
  shared: boolean
  /** The viewer also gets the reference files the result was made from. */
  allowCopy: boolean
  createdAt: string
  updatedAt: string
}

export interface GetShareParams {
  kind: ShareKind
  /** The id of your job, session or project. */
  targetId: string
}

export interface SetShareInput {
  kind: ShareKind
  targetId: string
  /** `true` turns the link on (the same token as before, if it was on once); `false` turns it off. */
  shared: boolean
  /** Omitted: the link keeps its current value (`false` on a new link). */
  allowCopy?: boolean
}

/** A setting value as a link shows it: never an address or an id. */
export type SharedSettingValue = string | number | boolean | SharedSettingValue[] | { [key: string]: SharedSettingValue }

export interface SharedReference {
  url: string
  kind: "image" | "video" | "audio"
}

/** One result as a link shows it — never its owner, its charge, its error or the route that ran it. */
export interface SharedJob {
  /** The job's id. */
  id: string
  /** The job's type, e.g. `"generate-image"`. */
  type: string
  mediaKind: "image" | "video" | "audio"
  /** The result's file. */
  outputUrl: string
  /** Every file of that kind, when the job made several. */
  outputUrls?: string[]
  width?: number
  height?: number
  durationSec?: number
  /** The owner's name for the result, or `null`. */
  title: string | null
  createdAt: string
  /** The prompt as it was written, exactly as sent (reference tokens included); `null` for a trend run. */
  prompt: string | null
  /**
   * The prompt as a person reads it: each reference token (`@maya:1`,
   * `@image-1:1:background`, `{video:1:clip}`) shown as the name on its pill
   * (`@Maya`, `@Image 1`, `@clip`). Show this; send `prompt` back to reuse it.
   * `null` for a trend run; absent from an older server.
   */
  displayPrompt?: string | null
  negativePrompt?: string | null
  /** The public model id and its name; `null` when the model is not in the public catalog. */
  model: { id: string; name: string } | null
  /** The settings it was made with. Addresses and ids are never here (with `allowCopy`, the files are in `references`). */
  settings: Record<string, SharedSettingValue>
  /** Only on a link that allows copying: the files the result was made from. */
  references?: SharedReference[]
  /** A trend run: its trend, with no prompt or settings (the recipe is the platform's). */
  trend?: { slug: string; name: string }
}

export interface SharedSession {
  title: string | null
  /** The creation tool that owns it, e.g. `"create-image"`. */
  tool: string | null
  createdAt: string
  /** How many results the link shows ({@link SharesResource.publicItems}). */
  itemCount: number
}

export interface SharedProject {
  name: string
  /** Its sessions that show something, most recently active first (at most 200). */
  sessions: Array<{ id: string; title: string | null; tool: string | null; itemCount: number; coverUrl: string | null }>
}

/** What a link shows: one of `job`, `session` or `project`, by its `kind`. */
export interface PublicShare {
  kind: ShareKind
  allowCopy: boolean
  job?: SharedJob
  session?: SharedSession
  project?: SharedProject
}

export interface PublicShareItemsParams {
  /** The previous page's `nextCursor`. */
  cursor?: string
  /** Page size, 1–100 (server default 50). */
  limit?: number
  /** Required for a shared project: one of the sessions {@link SharesResource.getPublic} lists. */
  sessionId?: string
}

export interface PublicShareItemsPage {
  data: SharedJob[]
  /** Pass back as `cursor`; `null` on the last page. A page may hold fewer than `limit`. */
  nextCursor: string | null
}

export class SharesResource {
  constructor(private client: NodaroClientCore) {}

  /** Your link for one of your items, or `null` when it was never shared. A 404 `NodaroError` when the item is not yours. */
  async get(params: GetShareParams): Promise<Share | null> {
    const res = await this.client.request<{ data: Share | null }>("GET", "/v1/shares", {
      query: { kind: params.kind, targetId: params.targetId },
    })
    return res.data
  }

  /**
   * Turn the link of one of your items on or off. Turning it on again later
   * brings back the same token. A 422 `NodaroError` (`share_not_allowed`, with
   * a `reason`) when the item cannot be shared now; 404 when it is not yours.
   */
  async set(input: SetShareInput): Promise<Share> {
    const res = await this.client.request<{ data: Share }>("PUT", "/v1/shares", { body: input })
    return res.data
  }

  /** What a link shows. Works signed out; a 404 `NodaroError` for a link that is unknown, turned off, or whose item is gone. */
  async getPublic(token: string): Promise<PublicShare> {
    const res = await this.client.request<{ data: PublicShare }>("GET", `/v1/public/shares/${encodeURIComponent(token)}`)
    return res.data
  }

  /** A shared session's results, newest first (a shared project: one of its sessions, by `sessionId`). Works signed out. */
  publicItems(token: string, params: PublicShareItemsParams = {}): Promise<PublicShareItemsPage> {
    const query: Record<string, string> = {}
    if (params.cursor) query.cursor = params.cursor
    if (params.limit !== undefined) query.limit = String(params.limit)
    if (params.sessionId) query.sessionId = params.sessionId
    return this.client.request("GET", `/v1/public/shares/${encodeURIComponent(token)}/items`, { query })
  }
}
