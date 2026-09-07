import { supabase } from "../supabase.js"

/**
 * The studio APP's per-user project — the SAME name the app uses
 * (`studio-project.ts`'s `STUDIO_PROJECT_NAME`), which is exactly what makes a
 * production created over MCP appear on the studio.nodaro.ai dashboard beside
 * the ones the user made by hand.
 */
export const STUDIO_PROJECT_NAME = "Studio"

/**
 * The project-level `settings.studio` marker — the app's own
 * `STUDIO_PROJECT_SETTINGS`, spelled the same.
 *
 * Its PRESENCE is what identifies the dedicated Studio project (the app's
 * project-level read-only, sharing the whole project by link, depends on it
 * being written), and the version is how that shape is allowed to evolve. It is
 * distinct from each workflow's own `settings.studio` shot index.
 *
 * Writing a bare `{}` here would satisfy the app's presence-only check and so
 * never be repaired by it: the project would sit unversioned forever, differing
 * from every project a user created through the app for no reason a later
 * reader could explain.
 */
export const STUDIO_PROJECT_SETTINGS = { version: 1 } as const

async function findOldestStudioProject(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .eq("name", STUDIO_PROJECT_NAME)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/**
 * The user's "Studio" project id, creating it if this is their first production.
 *
 * Oldest-first with an id tiebreak, and — the part that matters — the insert is
 * followed by a fresh SELECT rather than trusting its own returned id. There is
 * no unique constraint on `projects(user_id, name)`, so two concurrent callers
 * can both insert; converging on the oldest row means they agree on which
 * project is "Studio" instead of quietly filling two. Mirrors
 * `ensureMcpProject` / `ensureRecastProject`, deliberately.
 */
export async function ensureStudioProject(userId: string): Promise<string> {
  const existing = await findOldestStudioProject(userId)
  if (existing) return existing

  const { error } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      name: STUDIO_PROJECT_NAME,
      settings: { studio: { ...STUDIO_PROJECT_SETTINGS } },
    })

  const resolved = await findOldestStudioProject(userId)
  if (resolved) return resolved
  throw new Error(`Failed to create Studio project: ${error?.message ?? "unknown"}`)
}
