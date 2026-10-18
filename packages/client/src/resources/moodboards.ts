import type { NodaroClientCore } from "../core.js"

/** One image of a moodboard — a link, never a copy. */
export interface MoodboardImage {
  /** An http(s) image link (no localhost or private address), up to 2048 characters. */
  url: string
  /** Up to 200 characters; it goes along with the image as a style reference. */
  caption?: string
}

/** One of your moodboards. */
export interface Moodboard {
  id: string
  name: string
  /** The words a run puts into the prompt as the moodboard's look. */
  description: string | null
  /** 1–12 images, in order. */
  images: MoodboardImage[]
  createdAt: string
  updatedAt: string
}

export interface CreateMoodboardInput {
  /** 1–80 characters. */
  name: string
  /** Up to 1000 characters. */
  description?: string | null
  /** 1–12 images. */
  images: MoodboardImage[]
}

/** Only the fields you send are written; `images` replaces them all; `description: null` clears it. */
export interface UpdateMoodboardInput {
  name?: string
  description?: string | null
  images?: MoodboardImage[]
}

export interface ListMoodboardsParams {
  /** Page size, 1–100 (server default 50). */
  limit?: number
  /** The previous page's `nextCursor`. */
  cursor?: string
}

export interface MoodboardPage {
  data: Moodboard[]
  /** Pass back as `cursor` for the next page; `null` on the last one. */
  nextCursor: string | null
}

/** The prefix of a moodboard's generate-image direction id (`direction.style`). */
export const MOODBOARD_DIRECTION_PREFIX = "moodboard:" as const

/**
 * A moodboard as a generate-image direction value — put it on
 * `direction.style`. The run puts its description into the prompt and sends
 * its images as style references after your own references, up to the
 * model's reference limit (the answer's `warnings` says when some did not
 * fit). The job keeps the id.
 */
export function moodboardDirectionId(id: string): `moodboard:${string}` {
  return `${MOODBOARD_DIRECTION_PREFIX}${id}`
}

/**
 * Moodboards — `GET/POST /v1/moodboards`, `GET/PATCH/DELETE /v1/moodboards/:id`.
 *
 * Yours only (another person's id answers 404). Use one on generate-image as
 * `direction: { style: moodboardDirectionId(id) }`. OAuth app tokens need
 * `assets:read` for reads and `assets:write` for writes.
 */
export class MoodboardsResource {
  constructor(private client: NodaroClientCore) {}

  /** Your moodboards, newest first. Page with `nextCursor`. */
  list(params: ListMoodboardsParams = {}): Promise<MoodboardPage> {
    return this.client.request<MoodboardPage>("GET", "/v1/moodboards", {
      query: { limit: params.limit, cursor: params.cursor },
    })
  }

  get(id: string): Promise<Moodboard> {
    return this.client.request<Moodboard>("GET", `/v1/moodboards/${encodeURIComponent(id)}`)
  }

  create(input: CreateMoodboardInput): Promise<Moodboard> {
    return this.client.request<Moodboard>("POST", "/v1/moodboards", { body: input })
  }

  update(id: string, input: UpdateMoodboardInput): Promise<Moodboard> {
    return this.client.request<Moodboard>("PATCH", `/v1/moodboards/${encodeURIComponent(id)}`, { body: input })
  }

  /** Deletes the moodboard only; the images it links to are untouched. */
  async delete(id: string): Promise<void> {
    await this.client.request<{ success: true }>("DELETE", `/v1/moodboards/${encodeURIComponent(id)}`)
  }
}
