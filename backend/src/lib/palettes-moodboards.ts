/**
 * Colour palettes and moodboards (migration 522) — the request schemas, wire
 * shapes and row mapping shared by `routes/palettes.ts`, `routes/moodboards.ts`,
 * their OpenAPI entries and the direction resolver (`lib/user-direction.ts`).
 *
 * A palette or moodboard is the caller's own. On generate-image it is named as
 * a direction value — `colorLook: "palette:<id>"`, `style: "moodboard:<id>"` —
 * and resolved on every run.
 */
import { z } from "zod"
import { safeUrlSchema } from "./url-validator.js"

export const PALETTES_TABLE = "color_palettes"
export const MOODBOARDS_TABLE = "moodboards"

export const PALETTE_COLUMNS = "id, user_id, name, colors, description, created_at, updated_at"
export const MOODBOARD_COLUMNS = "id, user_id, name, description, images, created_at, updated_at"

/** The bounds, one place (the migration's CHECKs hold the same numbers). */
export const PALETTE_LIMITS = { nameMax: 80, colorsMin: 2, colorsMax: 12, descriptionMax: 500 } as const
export const MOODBOARD_LIMITS = { nameMax: 80, descriptionMax: 1000, imagesMin: 1, imagesMax: 12, captionMax: 200, urlMax: 2048 } as const

/** A page of a list: 1..100, default 50. */
export const LIST_PAGE_DEFAULT = 50

const nameSchema = z.string().trim().min(1).max(PALETTE_LIMITS.nameMax)
/** `#RRGGBB`, any case on the wire; stored upper case (`normalizeColors`). */
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Each colour is a #RRGGBB hex value")
const colorsSchema = z.array(hexColor).min(PALETTE_LIMITS.colorsMin).max(PALETTE_LIMITS.colorsMax)

export const idParams = z.object({ id: z.string().uuid() })

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(512).optional(),
})

export const createPaletteBody = z.object({
  name: nameSchema,
  colors: colorsSchema,
  description: z.string().trim().max(PALETTE_LIMITS.descriptionMax).nullable().optional(),
})

export const updatePaletteBody = z
  .object({
    name: nameSchema.optional(),
    colors: colorsSchema.optional(),
    /** `null` (or an empty string) clears it. */
    description: z.string().trim().max(PALETTE_LIMITS.descriptionMax).nullable().optional(),
  })
  .refine((b) => b.name !== undefined || b.colors !== undefined || b.description !== undefined, {
    message: "Nothing to update: send name, colors or description",
  })

/**
 * One moodboard image. The url passes the same SSRF gate as every other
 * reference image a caller hands the API (`safeUrlSchema`: http(s) only, never
 * localhost or a private address); it is stored as given — a link, not a copy.
 */
const moodboardImage = z.object({
  url: safeUrlSchema.refine((u) => u.length <= MOODBOARD_LIMITS.urlMax, {
    message: `An image url is at most ${MOODBOARD_LIMITS.urlMax} characters`,
  }),
  caption: z.string().trim().max(MOODBOARD_LIMITS.captionMax).optional(),
})
const imagesSchema = z.array(moodboardImage).min(MOODBOARD_LIMITS.imagesMin).max(MOODBOARD_LIMITS.imagesMax)

export const createMoodboardBody = z.object({
  name: z.string().trim().min(1).max(MOODBOARD_LIMITS.nameMax),
  description: z.string().trim().max(MOODBOARD_LIMITS.descriptionMax).nullable().optional(),
  images: imagesSchema,
})

export const updateMoodboardBody = z
  .object({
    name: z.string().trim().min(1).max(MOODBOARD_LIMITS.nameMax).optional(),
    /** `null` (or an empty string) clears it. */
    description: z.string().trim().max(MOODBOARD_LIMITS.descriptionMax).nullable().optional(),
    /** Replaces every image. */
    images: imagesSchema.optional(),
  })
  .refine((b) => b.name !== undefined || b.description !== undefined || b.images !== undefined, {
    message: "Nothing to update: send name, description or images",
  })

/** Colours as stored: upper case. */
export function normalizeColors(colors: readonly string[]): string[] {
  return colors.map((c) => c.toUpperCase())
}

/** A description as stored: trimmed, and empty means none. */
export function normalizeDescription(description: string | null | undefined): string | null {
  const d = description?.trim()
  return d ? d : null
}

export interface MoodboardImage {
  url: string
  caption?: string
}

/** Images as stored: an empty caption is no caption. */
export function normalizeImages(images: ReadonlyArray<{ url: string; caption?: string }>): MoodboardImage[] {
  return images.map(({ url, caption }) => (caption ? { url, caption } : { url }))
}

export interface PaletteRow {
  id: string
  user_id: string
  name: string
  colors: string[]
  description: string | null
  created_at: string
  updated_at: string
}

export interface MoodboardRow {
  id: string
  user_id: string
  name: string
  description: string | null
  images: MoodboardImage[]
  created_at: string
  updated_at: string
}

/** A palette on the wire. */
export interface ColorPalette {
  id: string
  name: string
  colors: string[]
  description: string | null
  createdAt: string
  updatedAt: string
}

/** A moodboard on the wire. */
export interface Moodboard {
  id: string
  name: string
  description: string | null
  images: MoodboardImage[]
  createdAt: string
  updatedAt: string
}

export function toPalette(row: PaletteRow): ColorPalette {
  return {
    id: row.id,
    name: row.name,
    colors: row.colors ?? [],
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function toMoodboard(row: MoodboardRow): Moodboard {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    images: Array.isArray(row.images) ? normalizeImages(row.images) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
