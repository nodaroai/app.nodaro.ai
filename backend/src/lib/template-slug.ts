import { sanitizeSlugBase, generateSlug } from "./marketplace-helpers.js"

/**
 * Slugs a template may never be given, because a static `/v1/templates/<word>`
 * route owns that path: `GET /v1/templates/:slug` would be shadowed by it and
 * the template would be unreachable. The suffix used to rule this out for every
 * slug; now that a requested slug is used exactly, these must be named.
 * `template-slug.test.ts` fails when the route file registers a static segment
 * that is not listed here.
 */
export const RESERVED_TEMPLATE_SLUGS: ReadonlySet<string> = new Set([
  "browse",
  "publish",
  "keep-check",
  "mine",
  "favorite",
  "favorites",
])

/** The longest slug a publisher may request (the publish body's `slug` max). */
const MAX_REQUESTED_SLUG = 50

/**
 * The slug to try for a NEW template on its `attempt`-th insert (0-based).
 *
 * Attempt 0 with a requested slug is that slug, exactly (only normalised the way
 * a slug always is: lower-case, dashes) — the column is UNIQUE across active and
 * inactive rows alike, so the insert is the check, and losing a race to another
 * publisher is the same unique violation. Every other attempt, and a publish
 * with no usable requested slug, takes the suffixed form (of the requested slug
 * when there is one, else of the name).
 */
export function templateSlugCandidate(
  requested: string | undefined,
  name: string,
  attempt: number,
): string {
  const base = requested ? sanitizeSlugBase(requested, MAX_REQUESTED_SLUG).replace(/-+$/, "") : ""
  if (attempt === 0 && base && !RESERVED_TEMPLATE_SLUGS.has(base)) return base
  return generateSlug(base || name)
}
