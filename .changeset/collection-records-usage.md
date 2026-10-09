---
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Collection records know whether they were used, and a delete moves a record to the collection's Trash instead of removing it.

- `usedAt` / `usedBy` and `deletedAt` on every record; `usage` (`all` / `unused` / `used`), `status` (`active` / `trash`), `until`, `order`, and numbered pages (`offset`, with the result's `total`) on the records list; `usedCount` and `trashCount` on a collection; the saving workflow's name and project on a record's `source`.
- `PATCH /v1/collections/:id/records/:recordId` (`{ used }`) marks one; `DELETE …/records/:recordId` moves it to the Trash; `POST …/records/:recordId/restore` brings it back; `DELETE …/records/:recordId/permanent` deletes a record already in the Trash for good; `POST …/records/bulk` (`{ ids, action: "trash" | "restore" | "delete" }`) does any of those for up to 100 at once.
- Save to Collection reads a `mediaUrl` (with `mediaKind`) into the record's media.
- SDK: `collections.records({ usage, status, until, order, offset })`, `collections.setUsed`, `collections.deleteRecord` (to the Trash), `collections.restoreRecord`, `collections.deleteRecordForever`, `collections.bulkRecords`. CLI: `collections records --usage --status --until --order --offset`, `collections mark-used`, `collections remove [--forever]`, `collections restore`, `collections export --until --usage`.
