/**
 * Nodaro Keepers — the bounds of a shelf entry, shared by the route that
 * validates `PUT /v1/<kind>/:id/catalog`, the cursor it hands out and the
 * Studio dialog that writes through it, so the form refuses exactly what the
 * server would. Documented in the API and SDK references; a change here is
 * a change to the public contract.
 */

/** `catalogSort` (the shelf order) is an integer within ±this. */
export const KEEPER_CATALOG_SORT_MAX = 1_000_000

/** `catalogCategory` (the shelf heading) is at most this many characters. */
export const KEEPER_CATALOG_CATEGORY_MAX = 80
