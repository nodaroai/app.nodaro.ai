import { supabase } from "./supabase.js"
import { hasOrganizations } from "./config.js"

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

/**
 * Every way this can end. `personalSpaceDisabled` is a THIRD arm rather than
 * another `error` string so that adding it breaks the build at each call site
 * instead of quietly falling through as a success — five routes resolve a
 * default project and each owes the caller a different refusal.
 */
export type DefaultProjectOutcome =
  | DefaultProjectResolution
  | { readonly error: string }
  | { readonly personalSpaceDisabled: true }

/**
 * The refusal a route owes a caller whose organization has closed the personal
 * space. 403 rather than 409: this is a permission the organization withdrew,
 * not a conflict with the current state of anything.
 *
 * The code is what clients branch on — the message is for a human and may be
 * reworded; `personal_space_disabled` may not.
 */
export const PERSONAL_SPACE_DISABLED_ERROR = {
  code: "personal_space_disabled",
  message: "Your organization requires new work to be created in a workspace.",
} as const

/**
 * May this user have a personal space at all?
 *
 * An organization can turn the personal space off for its members, so their
 * work has to live inside a workspace and cannot be carried away privately.
 * The database enforces that inside `ensure_default_project()`, the RPC — and
 * only the BROWSER calls that RPC. This helper reproduces the check on the
 * server, where the same create arrives over REST, the SDK, the CLI and MCP
 * and would otherwise walk straight past a rule the browser obeys.
 *
 * It calls the same SQL predicate the RPC does rather than re-deriving the
 * rule, so the two answers cannot drift: `personal_space_enabled_for` is
 * granted to `service_role` precisely so this path can ask it.
 *
 * Skipped entirely when organizations are off — nobody can be a member of
 * anything then, so the answer is always yes and the round trip is waste.
 *
 * Fails OPEN. A blip talking to the database would otherwise stop every user
 * on the platform from creating anything, to enforce a placement policy that
 * today applies to nobody. Losing the gate for the duration of an outage is
 * the smaller failure by a wide margin.
 */
async function personalSpaceAllowed(userId: string): Promise<boolean> {
  if (!hasOrganizations()) return true
  const { data, error } = await supabase.rpc("personal_space_enabled_for", { p_user_id: userId })
  if (error) return true
  return data !== false
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
export async function ensureDefaultProject(userId: string): Promise<DefaultProjectOutcome> {
  // BEFORE the lookup, matching the RPC exactly: an organization that has
  // turned the personal space off refuses even a default project that already
  // exists, because the point is that new work must not land there. Guarding
  // only the insert would let anyone who signed up before the setting changed
  // keep using the space it was meant to close.
  if (!(await personalSpaceAllowed(userId))) return { personalSpaceDisabled: true }

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
