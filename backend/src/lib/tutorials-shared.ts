// Shared tutorial response shape used by both the community route
// (`routes/tutorials.ts`) and the admin route (`ee/routes/admin-tutorials.ts`).
// Lives in core because the response shape itself is community-relevant; the
// admin route just adds CRUD on top.
//
// After migration 114, video tutorials reference `tutorial_categories` via
// `category_id`. Callers that select the joined category get a nested
// `tutorial_categories` object (Supabase embed); we surface it as `category`
// in the response.

interface CategoryEmbed {
  id?: string | null
  name?: string | null
  slug?: string | null
  sort_order?: number | null
}

function pickCategory(row: Record<string, unknown>): {
  id: string | null
  name: string | null
  slug: string | null
  sortOrder: number | null
} | null {
  const embed = row.tutorial_categories as CategoryEmbed | CategoryEmbed[] | null | undefined
  const flat = Array.isArray(embed) ? embed[0] : embed
  if (!flat) return null
  return {
    id: flat.id ?? null,
    name: flat.name ?? null,
    slug: flat.slug ?? null,
    sortOrder: flat.sort_order ?? null,
  }
}

export function toTutorialResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    type: "video" as const,
    title: row.title,
    description: row.description,
    videoUrl: row.video_url,
    thumbnailUrl: row.thumbnail_url,
    categoryId: row.category_id,
    category: pickCategory(row),
    sortOrder: row.sort_order,
    isEnabled: row.is_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Standard select string that embeds the joined category row. */
export const TUTORIAL_SELECT_WITH_CATEGORY =
  "*, tutorial_categories(id, name, slug, sort_order)"
