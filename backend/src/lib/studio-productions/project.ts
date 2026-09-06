import { supabase } from "../supabase.js"

/**
 * The studio APP's per-user project — the SAME name the app uses
 * (`studio-project.ts`'s `STUDIO_PROJECT_NAME`), which is exactly what makes a
 * production created over MCP appear on the studio.nodaro.ai dashboard beside
 * the ones the user made by hand.
 */
export const STUDIO_PROJECT_NAME = "Studio"

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
    .insert({ user_id: userId, name: STUDIO_PROJECT_NAME, settings: { studio: {} } })

  const resolved = await findOldestStudioProject(userId)
  if (resolved) return resolved
  throw new Error(`Failed to create Studio project: ${error?.message ?? "unknown"}`)
}
