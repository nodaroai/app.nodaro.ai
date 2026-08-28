---
"@nodaro/prompts": minor
"@nodaro/shared": minor
"@nodaro/sdk": minor
"@nodaro/cli": minor
---

Compact professional `term` on every picker-catalog entry.

`@nodaro/prompts`: each catalog entry can now carry a short `term` beside its long `promptHint` — the two-to-four word phrase a professional would actually write in a prompt ("whip pan left", "hard cut", "medium close-up"). `label` stays what users see, `promptHint` is what models read in verbose hint mode, `term` is what they read in compact hint mode. New `term.ts` (`deriveTerm` / `isSuspiciousDerivedTerm` / `resolveTerm` / `TERM_MAX_CHARS`) plus a `get<Name>Term(id)` getter alongside every `get<Name>PromptHint(id)`, and 740 explicit terms authored where the lowercased label is not the trade term. A guard test walks every registered catalog and fails for a suspicious label with no authored term, so the convention is enforced rather than documented. `PickerOption.term` is always present and already resolved (`""` for a no-op "auto"/"none" entry that injects nothing) — consumers render `label` and inject `term`, never deriving one from the other.

`@nodaro/shared`: `ProjectedCatalogOption` gains `term?: string` — the `GET /v1/catalogs` wire shape carries it at **both** detail levels, so a thin client rendering its own pickers gets the injectable term without a second `detail=full` fetch. The four object-entity catalogs (animals / vehicles / weapons / furniture) gain the same optional `term?` field, authored only where the label is a UI compound ("Airship / Dirigible" → `airship`, "Plasma Sword / Lightsaber" → `plasma sword`); everywhere else the lowercased label *is* the professional term and `@nodaro/prompts` resolves it that way.

`@nodaro/sdk`: `PickerOption` and `ProjectedCatalogOption` mirror the new field, so `client.pickerCatalogs.get()` and `client.catalogs.list()` are typed for it at both detail levels.

`@nodaro/cli`: `nodaro catalog` snapshots now record an entry's `term`, and `diff-upstream`'s three-way merge counts a term-only upstream edit as a real content change — previously such an edit was invisible to a vendored pack's merge plan. Minor rather than patch: `CatalogSnapshotEntry` is a published type and gains a field.
