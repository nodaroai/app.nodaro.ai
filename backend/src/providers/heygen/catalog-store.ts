/**
 * The HeyGen catalogs' Redis snapshot store: the shared store machine
 * (`lib/progressive-catalog/snapshot-store.ts`) bound to the `heygen:catalog`
 * key namespace — keys `heygen:catalog:v1:{avatars|voices}[:meta|:refresh-lock]`,
 * the contract since the catalog moved to Redis (PR #695). Everything about
 * timeouts, the compare-and-set write and the refresh lock is the store's.
 */

import { createSnapshotStore } from "../../lib/progressive-catalog/snapshot-store.js"

export {
  MAX_SNAPSHOT_BYTES,
  REFRESH_LOCK_TTL_MS,
  type SnapshotStore,
  type StoredSnapshot,
  type StoredSnapshotMeta,
} from "../../lib/progressive-catalog/snapshot-store.js"

export const heygenCatalogStore = createSnapshotStore({ namespace: "heygen:catalog", logTag: "heygen/catalog-store" })

export const {
  readSnapshotMeta,
  readSnapshot,
  writeSnapshot,
  acquireRefreshLock,
  isStoreReachable,
  releaseRefreshLock,
} = heygenCatalogStore
