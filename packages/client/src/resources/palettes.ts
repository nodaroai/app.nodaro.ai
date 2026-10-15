import type { NodaroClient } from "../client.js"

/** One of your colour palettes. */
export interface ColorPalette {
  id: string
  name: string
  /** 2–12 colours, `#RRGGBB`, upper case. */
  colors: string[]
  /** Your own note. It is not put into the prompt. */
  description: string | null
  createdAt: string
  updatedAt: string
}

export interface CreatePaletteInput {
  /** 1–80 characters. */
  name: string
  /** 2–12 colours, `#RRGGBB` (any case; stored upper case). */
  colors: string[]
  /** Up to 500 characters. */
  description?: string | null
}

/** Only the fields you send are written; `description: null` clears it. */
export interface UpdatePaletteInput {
  name?: string
  colors?: string[]
  description?: string | null
}

export interface ListPalettesParams {
  /** Page size, 1–100 (server default 50). */
  limit?: number
  /** The previous page's `nextCursor`. */
  cursor?: string
}

export interface PalettePage {
  data: ColorPalette[]
  /** Pass back as `cursor` for the next page; `null` on the last one. */
  nextCursor: string | null
}

/** The prefix of a palette's generate-image direction id (`direction.colorLook`). */
export const PALETTE_DIRECTION_PREFIX = "palette:" as const

/**
 * A palette as a generate-image direction value — put it on
 * `direction.colorLook`. The run names each colour (an everyday name and its
 * hex) in the prompt; the job keeps the id, so a re-run uses the palette as it
 * is then.
 */
export function paletteDirectionId(id: string): `palette:${string}` {
  return `${PALETTE_DIRECTION_PREFIX}${id}`
}

/**
 * Colour palettes — `GET/POST /v1/palettes`, `GET/PATCH/DELETE /v1/palettes/:id`.
 *
 * Yours only (another person's id answers 404). Use one on generate-image as
 * `direction: { colorLook: paletteDirectionId(id) }`. OAuth app tokens need
 * `assets:read` for reads and `assets:write` for writes.
 */
export class PalettesResource {
  constructor(private client: NodaroClient) {}

  /** Your palettes, newest first. Page with `nextCursor`. */
  list(params: ListPalettesParams = {}): Promise<PalettePage> {
    return this.client.request<PalettePage>("GET", "/v1/palettes", {
      query: { limit: params.limit, cursor: params.cursor },
    })
  }

  get(id: string): Promise<ColorPalette> {
    return this.client.request<ColorPalette>("GET", `/v1/palettes/${encodeURIComponent(id)}`)
  }

  create(input: CreatePaletteInput): Promise<ColorPalette> {
    return this.client.request<ColorPalette>("POST", "/v1/palettes", { body: input })
  }

  update(id: string, input: UpdatePaletteInput): Promise<ColorPalette> {
    return this.client.request<ColorPalette>("PATCH", `/v1/palettes/${encodeURIComponent(id)}`, { body: input })
  }

  /** A run that still names the palette answers 404 `direction_not_found`. */
  async delete(id: string): Promise<void> {
    await this.client.request<{ success: true }>("DELETE", `/v1/palettes/${encodeURIComponent(id)}`)
  }
}
