/**
 * The columns a content restriction (migration 581) sets on the rows it
 * covers. A leaf module on purpose: every user-facing read of `assets`
 * filters `RESTRICTED_ASSET_COLUMN` (`asset-restricted-reads.test.ts` holds
 * them to it), and a route or a store must be able to do that without
 * loading the restriction's own machinery (`content-restrictions.ts`, which
 * reaches the storage client and the config).
 */

/** Filter every user-facing `assets` read with `.is(RESTRICTED_ASSET_COLUMN, null)`, or read the column and drop the row. */
export const RESTRICTED_ASSET_COLUMN = "restricted_at"
/** The same column on `jobs`; a restricted job also has no `output_data`. */
export const RESTRICTED_JOB_COLUMN = "restricted_at"
