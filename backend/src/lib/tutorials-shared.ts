// Shared tutorial response shape used by both the community route
// (`routes/tutorials.ts`) and the admin route (`ee/routes/admin-tutorials.ts`).
// Lives in core because the response shape itself is community-relevant; the
// admin route just adds CRUD on top.

export function toTutorialResponse(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    videoUrl: row.video_url,
    thumbnailUrl: row.thumbnail_url,
    category: row.category,
    sortOrder: row.sort_order,
    isEnabled: row.is_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
