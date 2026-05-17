import { supabase } from "./supabase.js"

/**
 * Shape returned to callers — mirrors the rows other route handlers serialize
 * via `toProjectResponse`. We return the raw DB row (snake_case) so the caller
 * can either pass it through their own serializer or pluck `id`.
 */
export interface DefaultProjectResolution {
  readonly projectId: string
  readonly project: Record<string, unknown>
  readonly created: boolean
}

const PROJECT_COLS =
  "id, user_id, name, description, settings, is_default, created_at, updated_at"

const DEFAULT_PROJECT_NAME = "My Recent Flows"
const DEFAULT_PROJECT_DESCRIPTION =
  "Auto-created workspace for new workflows"

/**
 * Look up the caller's default project, lazy-creating it if absent.
 *
 * Backend equivalent of the `ensure_default_project()` Postgres RPC the
 * frontend calls directly via Supabase JS. The RPC depends on `auth.uid()`
 * which is NULL when called through the service-role client used by Fastify,
 * so this helper reproduces the same behavior in-handler.
 *
 * Race handling: the partial unique index `uniq_default_project_per_user`
 * means two concurrent inserts cannot both win. On the (rare) race we re-
 * select to return the row the other request created.
 */
export async function ensureDefaultProject(
  userId: string,
): Promise<DefaultProjectResolution | { readonly error: string }> {
  const { data: existing, error: lookupError } = await supabase
    .from("projects")
    .select(PROJECT_COLS)
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle()

  if (lookupError) return { error: lookupError.message }
  if (existing) {
    return {
      projectId: existing.id as string,
      project: existing as Record<string, unknown>,
      created: false,
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      name: DEFAULT_PROJECT_NAME,
      description: DEFAULT_PROJECT_DESCRIPTION,
      settings: {},
      is_default: true,
    })
    .select(PROJECT_COLS)
    .single()

  if (insertError) {
    const { data: raced } = await supabase
      .from("projects")
      .select(PROJECT_COLS)
      .eq("user_id", userId)
      .eq("is_default", true)
      .maybeSingle()
    if (raced) {
      return {
        projectId: raced.id as string,
        project: raced as Record<string, unknown>,
        created: false,
      }
    }
    return { error: insertError.message }
  }

  return {
    projectId: inserted.id as string,
    project: inserted as Record<string, unknown>,
    created: true,
  }
}
