---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

Collections, the two workflow nodes (Save to Collection / Read Collection):

- `@nodaro/shared`: `fanOutUrlItemIsText(nodeType, targetHandle)` — lanes where a fan-out item that looks like a link stays the item (Save to Collection's `in`); `isFanOutUrlItem` now treats JSON and sentences as text (only one bare address is a media link); `normalizeDedupeKey` keeps a link's path case (scheme and host fold); `ingestRecordFromJson` no longer takes a numeric `id` as the dedupe key; `collectionRecordHeadline` / `collectionRecordsDigest` tolerate a partial record; `COLLECTION_READ_WINDOW_HOURS_MAX`, `COLLECTION_READ_LIMIT_MAX`, `collectionReadSince` and the read window / order types; `lastOutcome` and `lastEvicted` join `EXECUTION_DATA_KEYS`.
- `@nodaro/prompts`: `TEXT_REQUIRED_NODE_TYPES` includes `collection-write`, and `computeNodeSendText` answers for it (the item, else a typed title / text / link), so a feed with nothing new wired straight into Save to Collection skips it instead of failing the run.
