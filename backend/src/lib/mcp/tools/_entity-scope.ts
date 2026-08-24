/**
 * The one ownership predicate every saved-entity read goes through.
 *
 * Characters, locations, objects and creatures are read by the MCP tools, by
 * the Copilot through them, and (from the hydration pass) by the orchestrator.
 * Those are three callers of the same question — "is this row this user's?" —
 * and the answer must not be spelled out three times.
 *
 * It is deliberately NARROWER than the database's own row-level security.
 * Migration 338 gave locations, objects and creatures a workspace disjunct, so
 * a workspace member can SELECT a colleague's object; characters never got one.
 * Reading through `user_id` alone means the tools are consistent across all
 * four kinds and fail closed while the organizations work settles. The visible
 * consequence is real and accepted: a workspace member sees a colleague's
 * object in the UI and the copilot says it cannot find it.
 *
 * When that widens, it widens HERE — one function, one guard test — not per
 * tool, which is how the four kinds drifted apart in the first place.
 */

/**
 * The minimum surface this needs from a PostgREST builder.
 *
 * Deliberately NOT expressed as a constraint on the caller's own type:
 * PostgREST's builder generics are deep enough that threading them through a
 * constrained type parameter makes tsc give up ("type instantiation is
 * excessively deep"). The cast is contained to this one function, and the
 * caller keeps its real type on both sides.
 */
interface OwnerScopable {
  eq(column: string, value: string): OwnerScopable
  is(column: string, value: null): OwnerScopable
}

/**
 * Scope a query to rows this user owns and has not archived.
 *
 * Applied to the QUERY rather than checked after the fetch: a row that is not
 * the caller's must come back as zero rows, so "not yours" and "does not
 * exist" are the same answer and neither can be used to probe for ids.
 */
export function entityOwnerFilter<T>(query: T, userId: string): T {
  const scoped = (query as unknown as OwnerScopable).eq("user_id", userId).is("deleted_at", null)
  return scoped as unknown as T
}
