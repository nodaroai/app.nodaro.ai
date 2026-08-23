import { hasOrganizations } from "../config.js"
import { getPluginServices } from "../private-plugins/load.js"
import { supabase } from "../supabase.js"
import { getUserMcpPreferences, invalidateUserPreferences } from "./user-preferences.js"

/**
 * Which workspace an MCP session works in.
 *
 * The client has no header to send — an MCP session is not an HTTP request
 * it controls — so the selection is remembered on the profile and resolved
 * once, here, when the session is created. A session is ONE REQUEST: the
 * server is rebuilt per `POST /mcp`, so this runs on every call and the
 * stored preference, not the in-memory field, is what makes a selection
 * outlive the tool that made it.
 *
 * It is RE-VALIDATED every time rather than trusted, and that is the whole
 * point of this module: a preference is written once and read for months,
 * and membership can end in between. A client that kept working inside a
 * workspace it had been removed from would be the exact failure the tenancy
 * axis exists to prevent, and unlike a browser there is nobody watching a
 * switcher who would notice.
 *
 * A selection that no longer resolves is not refused — the session continues
 * in the personal space. Refusing instead would break every tool for someone
 * whose only mistake was being removed from a class.
 */
export async function resolveSessionWorkspace(userId: string): Promise<string | undefined> {
  if (!hasOrganizations()) return undefined
  const orgs = getPluginServices().orgs
  if (!orgs) return undefined

  const preferred = await readStoredWorkspace(userId)
  if (!preferred) return undefined

  try {
    const result = await orgs.resolveRequestContext({
      userId,
      headerWorkspaceId: preferred,
      // Treated as an identity route: a stale selection comes back as "no
      // workspace" rather than a rejection, which is what lets the session
      // continue instead of failing whole.
      identityRoute: true,
    })
    if (result.workspaceId) return result.workspaceId
  } catch {
    // The resolver is unreachable. Working in the personal space is wrong in
    // a recoverable way; working in an unverified workspace is not.
    return undefined
  }

  // It resolved to nothing — but WHICH nothing is not something the resolver
  // will say. "You were removed" and "the organization is suspended for an
  // hour" come back identical on purpose, so that the header cannot be used
  // to learn what exists. Forgetting the preference on the strength of that
  // answer would make a temporary suspension permanently erase every MCP
  // client's selection, while the browser — which reconciles against the
  // list `me` returns, and that list still carries suspended organizations —
  // would restore it on the next load. Same event, opposite outcome.
  //
  // So the list decides here too, and the two halves agree by construction.
  await forgetIfTrulyGone(userId, preferred, orgs)
  return undefined
}

/** Write the selection onto the profile, and drop the preference cache. */
export async function storeSessionWorkspace(userId: string, workspaceId: string | null): Promise<void> {
  const current = await getUserMcpPreferences(userId).catch(() => ({}))
  const { error } = await supabase
    .from("profiles")
    .update({ mcp_preferences: { ...current, defaultWorkspaceId: workspaceId } })
    .eq("id", userId)
  if (error) throw new Error(`mcp: could not store the workspace preference: ${error.message}`)
  invalidateUserPreferences(userId)
}

/**
 * The stored selection, read PAST the preferences cache.
 *
 * That cache is a process-local `Map` with a 60s TTL, and
 * `invalidateUserPreferences` clears it in one process only. Every other
 * process would keep resolving the workspace the caller just switched away
 * from — and `list_workspaces` would report it as SELECTED while new work
 * landed elsewhere, which is precisely the silent tenancy failure this axis
 * exists to prevent. Two processes is not hypothetical: a rolling deploy
 * runs the old and the new one side by side.
 *
 * One indexed single-row read per MCP request, and only where organizations
 * are switched on. The cache still serves everything else it holds, where
 * being a minute stale costs nothing.
 */
async function readStoredWorkspace(userId: string): Promise<string | undefined> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("mcp_preferences")
      .eq("id", userId)
      .single()
    if (error || !data) return undefined
    const prefs = (data.mcp_preferences ?? {}) as { defaultWorkspaceId?: string | null }
    return prefs.defaultWorkspaceId ?? undefined
  } catch {
    // A preference read that fails is not a selection; the personal space is
    // the safe answer and the session still works.
    return undefined
  }
}

/**
 * Clear the selection only when the workspace is genuinely no longer the
 * caller's — never merely because it stopped resolving.
 *
 * `me()` lists what the account belongs to, suspended organizations
 * included, which is exactly the distinction the resolver refuses to draw.
 * If the workspace is still on that list the selection is worth keeping: the
 * organization will come back and the client picks up where it left off.
 */
async function forgetIfTrulyGone(
  userId: string,
  workspaceId: string,
  orgs: NonNullable<ReturnType<typeof getPluginServices>["orgs"]>,
): Promise<void> {
  try {
    const me = await orgs.me(userId)
    const stillListed = (me.workspaces as Array<{ id?: string }>).some((w) => w.id === workspaceId)
    if (stillListed) return
    await storeSessionWorkspace(userId, null)
  } catch {
    // Best effort in both directions: the session is already correct without
    // it, and neither failing here nor guessing would improve anything.
  }
}
