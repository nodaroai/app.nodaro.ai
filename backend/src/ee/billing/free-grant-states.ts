/**
 * Every value `profiles.free_grant_state` may hold — the ONE list. Migration
 * 458's CHECK is pinned to it (`free-grant-states-sync.test.ts`), and
 * `signup-grant.ts`'s `asState` reads through it, so a state added to the
 * database without this list (or the reverse) fails the build instead of being
 * read as "unclaimed".
 *
 * `revoked`: an admin took the grant back. Not claimable, not activatable by
 * a card — only an admin restores it.
 *
 * Its own module, with no imports, because a route reads it at module load
 * (`z.enum(FREE_GRANT_STATES)`): a test that mocks `signup-grant.js` must not
 * be able to take the list away from the route it is testing.
 */
export const FREE_GRANT_STATES = ["unclaimed", "granted", "withheld", "revoked"] as const
export type FreeGrantState = (typeof FREE_GRANT_STATES)[number]
