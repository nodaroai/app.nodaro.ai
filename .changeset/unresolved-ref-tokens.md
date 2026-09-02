---
"@nodaro/shared": minor
---

Add `classifyRefToken`, `unresolvedRefTokens` and `REF_TOKEN_NAMESPACE_PREFIXES`: the shared `{Label}` token classifier the execution engine uses to refuse dispatching a prompt that still carries an unresolvable reference.

The namespace exclusion set widens from `image:` to `image:` / `video:` / `audio:` / `slot:` / `ref:` (matched case-insensitively, as the resolvers themselves match), so reference-handle (`{video:1}`, `{audio:1}`), id-addressed reference (`{ref:hero}`) and recast (`{slot:x}`) tokens are no longer classified as missing node refs. This also changes the editor: such tokens stop rendering as missing-reference warnings and stop suppressing auto-injection of a connected node.

Runtime behaviour the backend engine builds on this classifier: a `{Label}` naming a node that EXISTS in the workflow but produced nothing now resolves to empty text (or to its `|| fallback`) instead of shipping the literal token to the provider. That includes a `{Label}` naming a node that is not connected to the consumer — it resolves to empty text rather than refusing or shipping the literal, so an unconnected reference produces no visible signal. Only a `{Label}` naming no node at all refuses.
