---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Collections — where a workflow's records live. A collection is a named set of records (a title, a text, a link, media links, extra fields, provenance) that a workflow writes to and reads back; text and links only, never files. The same link saved twice is one record; past the plan's cap the oldest records are evicted after a write.

- `@nodaro/shared`: `Collection`, `CollectionRecord`, `CollectionMedia`, `CollectionRecordSource`, the caps by tier (`COLLECTION_TIER_CAPS`, `collectionCapsForTier`), the wire shapes (`ListCollectionsResult` with `available` and `caps`, `ListCollectionRecordsResult`, `AddCollectionRecordInput` / `AddCollectionRecordResult` with `outcome: "inserted" | "duplicate" | "replayed"` and `evicted`), and the one rule every surface renders records with: `collectionRecordHeadline`, `collectionRecordsDigest(records, "headlines" | "full")`, `ingestRecordFromJson(item)` (any JSON item — a feed post, a search result, an article object — mapped to a record), `normalizeDedupeKey`, `normalizeCollectionMedia`, `normalizeCollectionFields`, `isCollectionUrl`.
- `@nodaro/sdk`: `client.collections` — `list`, `get`, `create`, `update`, `delete`, `records`, `addRecord` (with an `idempotencyKey`), `deleteRecord`, `export` (CSV or JSON text).
- `@nodaro/cli`: `nodaro collections list | create | show | update | delete | records | add | remove | export`.
