---
"@nodaro/shared": minor
"@nodaro/studio-production": minor
---

**@nodaro/shared** — the wire contract of `/v1/studio/productions`, as types.

`StudioProductionView` is the one read shape every studio production route and
every studio MCP tool returns: the production's identity and audience, its
film look, cast, folders, cuts and bin, what is in flight, and its shots in
timeline order. `detail: "summary"` carries counts and the active urls;
`detail: "full"` adds every result with the context that regenerates it.
`ResultKey` is how a result is ADDRESSED — its job id when it has one, its url
otherwise, never a position, because two writers hold a production open by
design and an index is stale the moment either inserts.

The document's own sub-objects (`Cast`, `ScenePlan`, `LookSelectionMap`, …) are
named JSON aliases rather than re-declared shapes: their definition lives in
`@nodaro/studio-production` and re-declaring it here would be a second
definition of the document, which is exactly the disagreement this contract
exists to end.

**@nodaro/studio-production** — `toProductionView` / `toProductionSummary`
(a pure projection of `parseProduction`: no reconciling, no writes) and
`resultKey` / `findResult`. A build-time pin holds the projection assignable to
the shared contract, so the two cannot drift in silence.
