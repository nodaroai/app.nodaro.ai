# @nodaro/studio-production

## 0.2.0

### Minor Changes

- 097eaab: **@nodaro/studio-production** — a new package: the Nodaro studio's production
  document, as code.

  A production is a workflow whose `settings.studio` holds the shots. Until now
  the only implementation of that document lived in the studio app's browser
  bundle, which is why the platform could not read, validate or edit a production
  from a route, an MCP tool or the copilot. This package is that implementation,
  moved to where the server can run it: the shot/graph codec, the
  `nodaro-studio-production` plan format (import, repair, export, JSON schema and
  the authoring skill it renders), the bundle codec, and the shared vocabulary —
  cast keys and prose, looks, direction, subject, beats, transitions, voice,
  music, the video lane and the curated model menu.

  Browser-free by construction (a test walks every module and fails on a React,
  `import.meta.env`, Supabase or `@nodaro/sdk` edge), FSL-licensed like
  `@nodaro/prompts`, with the wire contract of `/v1/studio/productions` kept next
  door in `@nodaro/shared` as types.

- e846720: **@nodaro/shared** — the wire contract of `/v1/studio/productions`, as types.

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

### Patch Changes

- Updated dependencies [15d2086]
- Updated dependencies [e846720]
- Updated dependencies [055b122]
  - @nodaro/shared@2.24.0
