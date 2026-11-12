<!-- tools/units/README.md -->
# Node units (`gen:units`)

A **unit** is one node type kept in its own folders instead of across ~21
central registration files (§5.8 option B, decided 2026-10-16):

| Tree | Folder | Holds |
|---|---|---|
| frontend | `frontend/src/nodes/<type>/` | `unit.json` (**the manifest, source of truth**), `strings.json`, `types.ts`, `node.tsx`, `config.tsx`, `option.tsx`, `exec.ts`, `api.ts`, `price-id.ts` (a unit priced by its settings: the credit id a run reserves), generated `definition.generated.ts` / `labels.generated.ts`, `__tests__/` |
| backend | `backend/src/nodes/<type>/` | `route.ts` (or `route.ee.ts` when Cloud-only), `quote.ts` (the route's pricing chain, so `POST /v1/quote` can price a run), `payload.ts`, `worker.ts`, `price.ee.ts`, `output.ts` / `inputs.ts`, `characterize.char.ts` (an ffmpeg worker's characterization operation), `use-case.ts` (a use-case node's request body), `budget.ts` (a worker's job budget), `recover.ts` (an own-writer worker's recovery from its provider task), generated `descriptor.generated.ts`, `__tests__/` |

The central registries become **generated, checked-in aggregates** built from
the manifests (`frontend/src/nodes/_generated/`, `backend/src/nodes/_generated/`,
`backend/src/ee/nodes/_generated/`), each composed **once** into the collection
the product already reads (`NODE_DEFINITIONS = legacy ∪ units`, …).

```sh
npm run gen:units              # write every generated file
npm run gen:units -- --check   # CI drift guard (Type Check job): exit 1 listing each stale file
npm run gen:units -- --new …   # scaffold a new node unit (below), then regenerate
npm run gen                    # gen:units, then gen:skills
```

## Adding a node: `--new`

New nodes are units (decided 2026-10-16). Start one with the scaffold:

```sh
npm run gen:units -- --new <type> --category <category> --kind <worker|sync|inline|source|use-case> \
  --after <type|first> --description "One sentence for /v1/nodes." \
  (--family <family id> --picker-after <type|first> | --no-picker) \
  [--label "<Label>"] [--price <credits>] [--lane <provider|llm|local>] [--provider <provider>] \
  [--registry-category <server category>] [--builder <key>] [--characterize <operation|first>]
```

- Every flag but `--label` is stated, never guessed: `--after` is the place in
  `NODE_DEFINITIONS` and the skills catalog, `--picker-after` the place in the
  picker family (a type of that family, or `first`) — both user-visible order;
  `--description` is what `/v1/nodes` and MCP show; `--price` (required for
  `worker`, `sync` and `use-case`, refused otherwise) is the `price.ee.ts`
  row — 0 for a free node, stated; for a use-case node it is the per-run fee,
  the row `use-case-fee:<type>`.
- `--lane <provider|llm|local>` (`worker` only, required): the concurrency
  lane its job counts in — `provider` for a call to an external AI provider
  (other than LLM text), `llm` for an LLM text call, `local` for in-house
  compute (ffmpeg, sharp, Remotion). It becomes the unit's `lane:*`
  capability; stated, never defaulted.
- `--provider <provider>` (a `--lane provider` worker only, required there):
  the provider its job calls, one of the `provider:*` capabilities — the
  ceiling its job counts against (`concurrency-lanes/provider-of.ts`).
- `--registry-category <server category>`: the `/v1/nodes` category a node
  whose own `category` the server does not share (`ai`) is listed under; it
  becomes `registry.category`.
- `--builder <key>` (`use-case` only, required): the node's graph builder, a
  key of `USE_CASE_SPECS` in `packages/render-rules/src/use-case-specs.ts`
  (read as text: a `  <key>: defineUseCase<…>({` line). Write the builder
  first; a key no spec has, or one another unit already uses, is refused.
- The would-be unit is validated **in memory**, with every existing unit, by
  the same validator as `gen:units --check`. A refusal writes nothing and says
  why — including a seam that is not live (a node that needs one builds it in
  its own PR).
- Written, it regenerates, so `--check` is clean at once. The templates
  (`scaffold-templates.mjs`, one worked shape per kind: a worker takes a video
  and returns a video) compile and pass G1–G7; the one step that is the node's
  own work throws "… is not written yet (scaffolded by npm run gen:units --
  --new)" until it is written.
- `--characterize <operation|first>` (worker only) also writes
  `characterize.char.ts` — the ffmpeg characterization the harness runs after
  that operation (a name that is no operation is refused), its `run` left to
  write — and adds the `ffmpeg-media` capability it requires. Bless its golden
  inside the pinned-ffmpeg image (`backend/scripts/characterize-in-image.sh`).
- It writes no `strings.json` (translations cannot be scaffolded) and starts
  `docs` as `docs.awaiting`. It prints what stays central (`nextSteps` in
  `scaffold.mjs`, pinned by `units-scaffold.test.mjs`). For a worker (and the
  other kinds):
  1. fill the folders: the node's step (the one that throws "is not written
     yet"), its handles in `unit.json` with the matching `types.ts` fields and
     `node.tsx` pips;
  2. `strings.json`: the node label in he/ja/ko/pt-br (`labels`) and any UI
     string only the unit uses, in all five dicts (`keys`);
  3. its page under `docs/nodes/`, in the same PR: `docs.page` replaces the
     scaffold's `docs.awaiting` (docs-node-registry-parity needs the page, and
     gen:units writes its `docs/nodes/README.md` row from `docs.page`); until
     the page is on the docs site the type is listed in `AWAITING_DOCS_PAGE`
     (`node-docs.test.ts`), then the snapshot is refreshed
     (`npm -w frontend run gen:node-docs -- --live`) and the line dropped;
  4. with `--price`: the `model_pricing` seed migration for its credit id
     (`<type>`) at the same price as `price.ee.ts`;
  5. a worker: its characterization when it runs ffmpeg (`characterize.char.ts`,
     golden blessed in the pinned-ffmpeg image), its output length rule (`length:exact-video` /
     `length:pass-video`, or `length:unknown` with a `lengthUnknownReason`
     when no rule can bound it) and a `@nodaro/shared` changeset — needed whenever a
     contract key (`contract.producer` or any other) adds a row to
     `packages/shared/src/generated/unit-contracts.ts`.

  For a use-case node:
  1. its builder, written first: `USE_CASE_SPECS.<builder>` in
     `packages/render-rules/src/use-case-specs.ts`, the graph a run expands
     into, with the spec fields its run needs (below): its `outputLength`
     when it delivers a video (a use-case node's length rule — never a
     `length:*` capability, which the validator refuses on it),
     `triesEvery`, `audioForced`;
  2. `backend/src/nodes/<type>/use-case.ts`'s body with the node's settings,
     `settingKeys` in its spec, its handles in `unit.json` and the matching
     `types.ts` fields;
  3. its MCP verb: the `REGISTER_BY_BUILDER` entry for its builder in
     `backend/src/lib/mcp/tools/verbs-use-case.ts`, and the verb's input in
     `INPUT_BY_BUILDER` beside it (`useCaseVerbInput`: its tool name, argument
     shape and body, the one value the verb registers and posts and
     `estimate_use_case` validates and quotes; typecheck fails until both are
     there), and that tool's entry in `docs/mcp/tools.md` (gen:skills:check);
  4. its settings table: a `SETTINGS_TABLES` row in
     `backend/src/lib/__tests__/use-case-graph-validity.test.ts` (typecheck
     fails until it is there);
  5. `strings.json`, as above;
  6. the `model_pricing` seed migration for `use-case-fee:<type>` at the same
     price as `price.ee.ts`;
  7. its docs page, as above;
  8. a `@nodaro/shared` changeset: a use-case node always adds published rows
     (the use-case list and its contract rows in `unit-contracts.ts`).

  Then, for every kind: `npm run build:packages` (gen:skills captures the MCP
  tools from the built packages, which carry the tables gen:units wrote),
  `npm run gen` (gen:units, then gen:skills — `INTERNAL_ORCHESTRATOR_SECRET`
  inline), `npm run build:packages` again (render-rules carries the node's
  settings), then `npm run typecheck`.

**Which kinds a new node can be today.** The editor runs every kind, but a
server-run workflow (API, MCP, webhook, schedule, a published app) runs a unit
only through an execution seam (`EXECUTION_SEAMS` in `seams.mjs`). Two are
live:

- `worker` (`run-worker`): `payload.ts` through `UNIT_PAYLOADS`, `worker.ts`
  through `UNIT_WORKERS`.
- `use-case` (`run-use-case`): a node that expands into a graph of existing
  nodes (Tighten Episode, Chapters, Trailer). `node-executor.ts` sends it to the
  use-case run through `isUseCaseNodeType` (`@nodaro/shared/nodes`, which
  composes the generated `UNIT_USE_CASE_TYPES`), and the factory route
  `POST /v1/<type>` (+ `/estimate`, `/continue`) serves it. The unit has no
  route, payload, worker, `exec.ts` or `api.ts` of its own: the editor runs
  it through `executeUseCase` (`workflow-editor/use-case-executor.ts`). Its
  backend folder holds `use-case.ts` — `body` (the request body, spreading
  the shared shapes of `lib/use-case/body-shapes.ts`) and `inputSchema` (its
  `/v1/nodes` fields), composed into `USE_CASE_BODIES` by
  `lib/use-case/bodies.ts` — and `price.ee.ts`, whose `staticCosts` holds the
  per-run fee row `use-case-fee:<type>` (an estimate expands the run into its
  steps, each priced at its own rate). Its canvas Continue runs through
  `useUseCaseContinue(nodeId)` in `components/nodes/use-case-node-hooks.ts`
  (beside `useUseCaseListDriven(nodeId)`), never the workflow store (G5).
  Beyond its folders it needs its builder in `use-case-specs.ts` (first), its
  MCP verb (the `REGISTER_BY_BUILDER` entry for its builder in
  `backend/src/lib/mcp/tools/verbs-use-case.ts`, a typed total table, and its
  input in `INPUT_BY_BUILDER` beside it, another), and a `SETTINGS_TABLES` row
  in `backend/src/lib/__tests__/use-case-graph-validity.test.ts`; typecheck
  fails until all three exist.

  Its spec (`USE_CASE_SPECS.<builder>`, composed with the node's row into its
  `UseCaseDescriptor`) states, beside its graph, what the engines read about
  the node so no rule names a use-case type:
  - `outputLength`: the length of each video it delivers — `{ kind: "fixed",
    fixedSec, after? }`, a fixed length after the named input's length when
    that input is wired, or `{ kind: "clock" }`, the length of the recording
    the run is clocked to (the Master audio's when wired, else the longest
    recording's). `lib/video-output-length.ts` makes it the node's length rule, and
    a use-case type has a rule exactly when its spec declares one
    (`use-case-output-length.test.ts`). Absent for a node that is not a video
    producer.
  - `triesEvery`: the built nodes that try every one of their kind — a stage
    whose nodes are all named here starts each of them whichever one fails
    (each still checks for a Stop before it starts). Any other stage keeps the
    engine's default: the first failure stops the nodes not started yet.
  - `audioForced`: the node data an audio-only recording wired into `media`
    forces — the values the editor's lock writes and the run's resolver reads
    an audio recording as. Absent for a node that refuses audio (`needsVideo`)
    and for one audio changes nothing on.

  What a run leaves on the node beyond its failure code follows its result
  kind, not its type: `USE_CASE_RESULT_KEYS` (`@nodaro/render-rules`
  `use-case-result-keys.ts`, keyed by `resultKind` — `failedFormats` for a
  `formats` result, `failedClips` for `clips`, nothing for `episode` or
  `chapters`), which `run-result-keys.ts` reads for every use-case type; a
  node of an existing kind needs no entry, and a new kind does not typecheck
  without one. A node with a review (`contract.reviewHold`) is held to three
  facts written in three places — the hold `@nodaro/shared` applies after it,
  `reviewBeforeRender` among its spec's `settingKeys`, and a review-on graph
  that renders a preview — by `backend/src/lib/__tests__/use-case-holding-types.test.ts`.

`sync` (SYNC_HTTP_NODES), `inline` (INLINE_NODES) and `source`
(SOURCE_NODE_TYPES) do not compose units yet, so the validator refuses them;
the first node of such a kind builds its seam and flips its `live`.

**Regenerating, in order.** `npm run build:packages`, then `npm run gen`
(gen:skills captures the MCP tools from the built packages, so a table
gen:units wrote into `@nodaro/shared` or `@nodaro/render-rules` reaches it
only once built), then `npm run build:packages` again (gen:skills writes
render-rules' `node-data-fields.ts`), then `npm run typecheck`. gen:units
also deletes unit rows from gen:skills' legacy handle table
(`backend/src/lib/mcp/generated/node-handles.ts`, `handle-prune.mjs`):
`lib/node-handles.ts` throws on a type that is both a row and a unit, and
gen:skills could not get past that throw to rewrite the table itself.

## Files

| File | What |
|---|---|
| `manifest.mjs` | The one loader + validator (G6). gen:skills loads units through it too. |
| `seams.mjs` | Every seam: the aggregates, projections, splice regions and data files, each with its composer and a `live` flag. |
| `capabilities.mjs` | The closed list of manifest `capabilities`, each naming the seams that read it (`seams: [...]`, every one live). |
| `vocabulary.mjs` | Categories, handle kinds, producer kinds, execution kinds, queues — pinned to the product by `frontend/src/__tests__/units-vocabulary.test.ts`. |
| `use-case-rules.mjs` | The rules of `execution.kind: "use-case"` (required and refused files, `execution.builder` against `USE_CASE_SPECS`, use-case input ids) and of the contract keys `@nodaro/shared` composes; `manifest.mjs` calls it. |
| `app-field-rules.mjs` | The rules of `appFields`, the settings a published app may expose ("A unit's app fields"); `manifest.mjs` calls it. |
| `handle-prune.mjs` | Deletes unit rows from `backend/src/lib/mcp/generated/node-handles.ts` (gen:skills' legacy-only handle table) on every gen:units run. |
| `templates.mjs` | The emitters and the region splice. |
| `scaffold.mjs` | `gen:units -- --new`: flags, the in-memory validation, the write, the printed next steps. |
| `scaffold-templates.mjs` | The scaffold's file templates, one worked shape per `execution.kind`. |
| `price-reader.mjs` | Reads `price.ee.ts` `staticCosts` with the TypeScript parser (lazily) for the editor's `priceRows` (every `staticCosts` row). |
| `gen.mjs` | The CLI. |
| `unit.schema.json` | Editor autocomplete (`"$schema"` in `unit.json`); the validator is the authority. |
| `legacy-nodes.json` | Types still in the hand-written `NODE_DEFINITIONS` literal — a burn-down that only shrinks (G1). |
| `registry-composers.json` | The reviewed composition points: the only product modules that may import an aggregate (G3), and the collections each re-exports (`exports`: the registry names G4 and the test-select registry rule read), and `foldsAtLoad`: the registries a composer reads every unit of while it loads — their enumerator, derived by `structure.mjs` `loadTimeRegistryReads` and held to it by `node-units-structure.test.ts`. |
| `central-mentions.json` | Reasoned exceptions to G2 (a unit's type id named outside its folders) — only shrinks. |
| `__fixtures__/tree/` | The fixture units `fixture-echo` (every optional file, every seam) and `fixture-case` (a use-case unit, with its own `use-case-specs.ts`), used by the generator and guard tests. |
| `__fixtures__/use-case-output-shapes.json` | The saved shapes a use-case node's output is read from; both engines' `use-case-unit-output-parity` tests walk them. |
| `__fixtures__/use-case-engine-parity.json` | What a use-case node hands on from those shapes — its pips, a plan wire into text inputs, the JSON consumers, the Each fan-out and the item modes — pinned once and held on both engines by the `use-case-engine-parity` tests. |

## Seams go live one at a time

A seam is live once its composer edit exists. Until then gen:units writes
nothing for it, and a unit that needs it fails validation with
"needs the … seam, which is not live". **A node that needs a missing seam
builds that seam in its own PR** — there is no exceptions list. Every output
seam in `seams.mjs` is live (PR1b): the aggregates exist (empty until the
first unit), each composed once into the collection the product reads. Of the
execution seams `run-worker` and `run-use-case` are (above). The same rule holds below the
seams: a capability, an input kind (`ACCEPTS_KINDS`) or a category
(`REGISTRY_CATEGORIES`) is added only with the composition that reads it.

| Registry | Composed in |
|---|---|
| `NODE_DEFINITIONS`, `SceneNodeType`/`SceneNodeData` | `frontend/src/types/nodes.ts` (`LEGACY_NODE_DEFINITIONS` ∪ units at `position.after`) |
| `nodeTypes`, config panels, `NODE_OPTIONS` + families, executors, label tables | `components/nodes/index.ts`, `config-panel.tsx`, `node-options.tsx` + `node-families.ts`, `execute-node.ts` (kit: `workflow-editor/unit-exec-kit.ts`), `lib/i18n/labels.ts` |
| everything derived from a unit's manifest in the editor (`EXECUTABLE_TYPES`, the price mirror, `HANDLE_OUTPUT_TYPES`, `TARGET_HANDLE_ACCEPTS`, the ffmpeg rule, config-panel names and button sets, output extraction) | read through `frontend/src/lib/unit-definitions.ts` (the one door to the definitions aggregate, so modules a unit imports are never composers) |
| `NODE_REGISTRY`, `STATIC_CREDIT_COSTS` / `CREDIT_COSTS`, routes (core + ee), payloads + required media, the ffmpeg worker map | `node-registry.ts`, `ee/billing/credits.ts`, `app.ts`, `payload-builder.ts`, `workers/handlers/ffmpeg.ts` |
| everything derived from a unit's manifest on the server (saved output, `NOT_GENERIC_RECOVERABLE`, `NODARO_EXCLUSIVE_NODE_TYPES` (the `edition:nodaro-exclusive` capability), `TEXT_SOURCE_NODE_TYPES` (a first output of kind `text`), the MCP handle table `lib/node-handles.ts`, the MCP verbs' widget model `lib/mcp/widget-models.ts`, the `length:unknown` rows of `VIDEO_OUTPUT_LENGTH_RULES` / `UNBOUNDED_LENGTH_REASONS` in `lib/video-output-length.ts`, a worker's concurrency lane — its `lane:*` capability, read by `laneOf` for `lib/concurrency-lanes/registry.ts`) | read through `backend/src/lib/unit-descriptors.ts` |
| `USE_CASE_BODIES` (a use-case unit's request body) and its `GET /v1/nodes` input schema (`usecaseInputSchemaOf`) | `backend/src/lib/use-case/bodies.ts` ∪ the `use-cases` aggregate. A unit's `use-case.ts` spreads the shared shapes of `lib/use-case/body-shapes.ts` (never `bodies.ts`, a composer — G5) and, being a declaration only (G7), writes an enum over a list as `z.enum(LIST as unknown as [string, ...string[]])`: a helper call such as `z.enum(tuple(LIST))` is not a pure argument |
| the entity-subject targets (`ENTITY_SUBJECT_TARGET_TYPES`; capability `input:entity-subject`: a wired Character / Face / Object / Creature / Location is the node's subject, so it lands in `imageUrl`, not `referenceImageUrls`; the validator requires an input whose `field` is `imageUrl` and whose `accepts` includes `image`) | both input resolvers, legacy rows ∪ the units declaring it: `workflow-editor/node-input-resolver.ts` (through `unit-definitions.ts`) and `workflow-engine/input-resolver.ts` (through `unit-descriptors.ts`). The server's legacy rows lack `gif-to-video`, which the editor's have, so declaring it on that node changes how a server-run workflow routes it |
| the render video sources (`VIDEO_SOURCE_TYPES_FOR_RENDER`: what a Render / composition node's `collectMediaAssets` collects as a video, and `detectPreviewItemType` types as one; every unit whose `contract.producer` is `video` — projected as `producer` into its editor definition — so a `dynamic` unit such as `tighten-episode` is not a member) | `lib/preview-node-types.ts` (re-exported by `workflow-editor/execution-graph.ts`; the store's `classifyPreviewValue` types a URL with no extension by it too), legacy rows ∪ those units (through `unit-definitions.ts`). The server's twin, `VIDEO_SOURCE_TYPES` of `workflow-engine/execution-graph.ts`, is `VIDEO_PRODUCER_TYPES` and so already composes them. `gif-to-video` stays a legacy row until its migration |
| the canvas connection rule of a unit's inputs (each `handles.inputs[].accepts`) | `frontend/src/lib/connection-validation.ts` asks `lib/unit-connections.ts` (below) |
| the producer sets | `packages/shared/src/producer-types.ts` ∪ `generated/unit-contracts.ts` |
| the contract rows (`contract.jsonPips`, `nonPromptInputs`, `reviewHold`, `presents`, `fanOutEach`) | `generated/unit-contracts.ts` (`UNIT_JSON_PIPS`, `UNIT_NON_PROMPT_INPUTS`, `UNIT_REVIEW_HOLDS`, `UNIT_PRESENTS`, `UNIT_FAN_OUT_EACH`), composed into the six shared tables that already existed: `JSON_OUTPUT_KINDS` (`json-kinds.ts`), `NON_PROMPT_TEXT_LANES` (`fan-out-rows.ts`), `REVIEW_HOLDING_USE_CASE_TYPES` (`preview-gate.ts`), `VIDEO_OUTPUT_TYPES` / `TEXT_OUTPUT_TYPES` (`presentation-utils.ts`), `FAN_OUT_EACH_HANDLES` (`producer-types.ts`) |
| `USE_CASE_NODE_TYPES` / `isUseCaseNodeType` (`@nodaro/shared/nodes`, re-exported by `@nodaro/render-rules` and the SDK) | `packages/shared/src/use-case-types.ts` ∪ `UNIT_USE_CASE_TYPES` (units in `NODE_DEFINITIONS` order) |
| `USE_CASE_ROWS` (type → builder, label, inputs) and so `USE_CASE_DESCRIPTORS` (rows × `USE_CASE_SPECS`) | `packages/render-rules/src/use-case-rows.ts` ∪ the `use-case-rows` data file `unit-use-cases.generated.ts` |
| `NODARO_EXCLUSIVE_NODE_TYPES` (the `edition:nodaro-exclusive` capability) | `frontend/src/lib/cloud-only-nodes.ts` and `backend/src/lib/cloud-only-nodes.ts` |
| the ffmpeg characterization operations (`OPERATIONS`; each named by its unit's type — its golden key — and placed after its `after`) | `backend/src/providers/video/__characterization__/operations.ts`. The unit file and its aggregate are `.char.ts`, like the harness: excluded from the build and the default test run |
| the job budgets (`DECLARED_JOB_BUDGETS`, read through `declaredJobBudgetMs` and `BUDGETED_JOB_NAMES`: the video worker's liveness fallback, the orchestrator's ceilings, the row sweeps) | `backend/src/lib/job-budget.ts`, the legacy rows ∪ the `budgets` aggregate (`UNIT_BUDGETS`, each unit's `budget.ts` under its type) |
| an own-writer worker's recovery from its provider task (`UNIT_RECOVERS`, each unit's `recover.ts` under its type; read by the KIE reconcile — its cron and the video worker's stall re-pick — before its `NOT_GENERIC_RECOVERABLE` bump) | `backend/src/lib/reconcile/unit-recovery.ts` (`unitRecoverOf(jobType)`, a lookup; no legacy rows) |
| the price of a run before it starts (`UNIT_QUOTES`, each unit's `quote.ts` under its type: its run route's body schema and pricing chain) | `backend/src/lib/unit-quotes.ts` (`unitQuoteOf(type)`, a lookup, and `unitQuotableTypes()`), read by `POST /v1/quote` (`ee/routes/node-quote.ts`) beside its hand-written rows (`QUOTABLE_NODE_TYPES`) |
| the long single-node restore horizon (`LONG_RUNNING_NODE_TYPES`: a reload re-attaches a running job's poll for 6 h instead of 30 minutes) | `frontend/src/lib/single-node-restore.ts`, the legacy rows ∪ the units whose definition is `longRunning` (through `unit-definitions.ts`) |
| the kept-length sets (`LENGTH_KEEPING_VIDEO_TYPES` / `EXACT_LENGTH_VIDEO_TYPES`, the `length:*` capabilities — the run estimates, the run's charge and, through them, the listing's `VIDEO_OUTPUT_LENGTH_RULES`) | `packages/render-rules/src/kept-length.ts` ∪ `unit-kept-lengths.generated.ts` |
| the image typing sets (the server's `IMAGE_SOURCE_TYPES`; the editor's `IMAGE_SOURCE_TYPES` and `IMAGE_RESULT_TYPES`: every unit whose `contract.producer` is `image`) and the routing of a unit's image pip (as an Upload Image, both engines' `routedAs`) | `workflow-engine/execution-graph.ts` and `input-resolver.ts` (through `unit-descriptors.ts`); `lib/preview-node-types.ts`, `config-panels/results-gallery-media.ts` and `workflow-editor/node-input-resolver.ts` (through `unit-definitions.ts`) |
| the list pips (`LIST_OUTPUT_HANDLES` / `isListOutputHandle`, read by `defaultEdgeOutputMode`: a wire leaving a list pip runs the next node once per item by default) | `packages/shared/src/producer-types.ts` ∪ `generated/unit-contracts.ts` `UNIT_LIST_PIPS` (each unit's `handles.outputs[].list`) |
| the run estimate's count of an Each wire from a list pip (`baseFanOut`: the list the source holds when it is not re-run — after a run once per upstream item, every row's; before a first run, or when it re-runs, the most items a run makes — the `defaultData` field named by the output's `listMax`, as saved on the node, else its default — times the runs the source itself makes; with no `listMax`, the list held) | `packages/render-rules/src/node-fan-out.ts` reads the `list-outputs` data file `unit-list-outputs.generated.ts` (`UNIT_LIST_OUTPUTS`: type, pip, `from`, `max`) |
| the editor's credit id of a unit priced by its settings (`UNIT_PRICE_IDS`, each unit's `price-id.ts`) | `frontend/src/lib/unit-price-ids.ts` (`unitCreditIdOf(type, data)`), read by `getModelIdentifier` (`config-panels/helpers.ts`) and `estimateNodeCredits` (`workflow-editor/types.ts`) |
| a provider-lane worker's provider (its `provider:*` capability) | `backend/src/lib/concurrency-lanes/provider-of.ts`, through `providerOf` (`lib/unit-descriptors.ts`) |
| a unit's `/v1/nodes` category (`registry.category`, projected as `registryCategory`) | `backend/src/lib/node-registry.ts` (`registryCategoryOf`, `lib/unit-compose.ts`) |
| a published app's fields (`appFields`: the publish picker, the app cards, every run's check, `get_app_inputs` and the listing's "up to") | the editor's `getExposableFields` (`components/presentation/exposable-fields.ts`, through `unit-definitions.ts`) and the server's `exposed-unit-field-check.ts` (through `unit-descriptors.ts`), read by the override merge `workers/apply-input-overrides.ts`, every route that takes overrides, and `lib/mcp/extract-app-inputs.ts` — "A unit's app fields" |

The pure composition lives in `frontend/src/lib/unit-compose.ts` and
`backend/src/lib/unit-compose.ts` (an empty unit collection returns the legacy
table itself). The unit kits are type-only: `frontend/src/nodes/kit.ts`
(definition side), `frontend/src/nodes/exec-kit.ts` (exec.ts / config.tsx),
`backend/src/nodes/kit.ts`. What a unit may not import reaches it through them:
`exec.ts` gets a `UnitExecKit` from execute-node.ts, `config.tsx` a
`UnitConfigKit` prop (`kit`, e.g. `localizeNodeLabel`) from config-panel.tsx,
and `node.tsx` its store services from `useUnitNodeKit(id)`
(`frontend/src/components/nodes/use-unit-node-kit.ts`, typed `UnitNodeKit`) —
never the workflow store or a composer itself (G5).

**A unit's connection rule.** A unit declares what each input takes in its
manifest, `handles.inputs[].accepts` (kinds from `ACCEPTS_KINDS`: `video`,
`audio`, `image`; several = any of them; or `look` alone, a JSON input that
takes any JSON producer, `ACCEPTS_JSON`), and writes no predicate of its own.
The canvas validator (`connectionTypesAccepted`) asks
`frontend/src/lib/unit-connections.ts` for every wire into a unit, after the
rules every node shares (JSON kinds, composition/lottie/picker-json pips, UGC)
and before the legacy per-type rules, so the validator is legacy ∪ units: a
declared input takes what its kinds' rule (`unitInputAccepts`,
`ffmpeg-handles.ts`) accepts from the effective source, an undeclared handle
nothing, and a wire with no target handle falls through as before. One
function holds that rule (`unitInputConnectionAccepted`, built once per input),
and every path that judges a unit input calls it: the canvas, the add-node
popup (`node-compatibility.ts`, through `unitConnectionVerdict`) and
`isValidFfmpegConnection`'s unit branch; the handle popover
(`TARGET_HANDLE_ACCEPTS`) is built from the same `unitInputAccepts`. It is a
lookup (`unitDefinitionOf`), so it folds nothing at load. The server has no
copy to keep in step: the Copilot's edge check
(`ee/copilot/tools/edge-validation.ts`) warns by handle name only — an unknown
handle, through `lib/node-handles.ts` (which already holds units), and a
media-class hint keyed by the target handle's NAME (`MEDIA_TARGET_HANDLES`:
`video` / `audio`) — and makes no per-type acceptance judgement. A kind is
added together with its rule there, `ACCEPTS_KINDS` and
`unit.schema.json` (`units-manifest.test.mjs` holds the schema to the
vocabulary). `unit-connections.test.ts` proves it on a fixture unit.

**A unit's input lanes.** An input that declares a `field` names where its
value belongs in the node's data; the run still routes it by the source's
type. Two kinds of input never have a `field`, and both engines route their
wires by the input they land on, into `inputs.unitInputs[<input id>]`
(`unitInputLanding`, `packages/render-rules/src/unit-input-lanes.ts`): a JSON
input (`accepts: ["look"]`) holds the wired JSON string — of two real wires
the last wins, and a wired input whose upstream produced nothing holds `""`
so the unit refuses the run rather than read it as unwired; a many-wire input
(`many: true`) holds one `UnitSourceRow` (`id` = the upstream node, `url`,
`kind` video/audio) per upstream node, in the order of the workflow's edge
list, the first wire from a node winning and a wire that carried nothing
adding no row. A unit's `payload.ts` reads `kit.resolvedInputs.unitInputs`,
its `exec.ts` `kit.inputs.unitInputs`. The lanes are
`backend/src/services/workflow-engine/unit-inputs.ts` and
`frontend/src/components/editor/workflow-editor/unit-inputs.ts`, called by
each resolver before its empty-output skip; they ask `unitInputHandleOf`
(both doors), which answers nothing for a use-case unit (`routeUseCaseInput`
routes those). `unit-input-lanes-parity.test.ts` (one per engine) holds the
two engines to the same `unitInputs` over
`tools/units/__fixtures__/unit-input-lanes-parity.json`.

**A worker unit's JSON outputs.** A worker whose outputs are all JSON (`kind:
"look"`, each with its `from`; the validator, `json-output-rules.mjs`, lets a
look output stand beside other look outputs, or beside media — the next
section) writes each output's value
under the output's id in its job's `output_data`. On the server,
`buildNodeOutputFromJobData` reads that row through `unitJobOutput` and
`extractSavedNodeOutput` reads the node's fields through `unitSavedOutput`,
both into the per-pip carrier `NodeOutput.unitOutputs` (by output id, the
JSON string a wire carries) and `json` (the first output's value, for the
readers of `output.json`); `getPrimaryOutput` hands a look pip its own string
(`unitPipValue`). In the editor, `unitOutputValue` reads a look output's field
as that string, and every lane lands a finished job through `unitJobLanding`
(`backend/src/lib/unit-compose.ts` and `frontend/src/lib/unit-compose.ts`):
each output's value on its `from` (a string holding a JSON object as that
object), an output the job did not write emptied. The canvas run is
`kit.runJsonNode(start, label)` (`pollJobWithNodeUpdate` with a JSON landing),
which resolves the first output as a wire carries it; the server-run lanes are
`json-run-result.ts`, whose `JSON_RUN_RESULT_TYPES` carries these units, as the
popup's `TYPED_SOURCE_NODE_TYPES` does (`node-compatibility.ts`).
`output-extractor-units.test.ts` and `json-run-result-units.test.ts` hold the
two engines to `tools/units/__fixtures__/unit-json-outputs.json`, and the
input-lanes parity fixture wires its JSON-only worker into a JSON input.

The nodes that read a source's structured JSON directly — Extract Field, JSON
Process, the list operators — and a fan-out over an Each wire read the output
of the pip the wire leaves from, never the unit's first output: a wire from a
unit's second look pip hands on that output (an object is one item, an array
its items), on both engines. On the server that is `structuredJsonOf` (the
consumers) and `unitLookPipJsonFor` (the fan-out), both through
`unitPipJson`; in the editor `sourceJsonOf` and `extractNodeOutputAsList`,
through the same-named `unitPipJson`. `unit-json-readers-parity.test.ts` (one
per engine) holds them to `tools/units/__fixtures__/unit-json-readers.json`.

**A worker unit's media take and its side outputs.** A worker whose first
output is a plain media output (its "take": what a run lands and an edge naming
no pip reads) may carry SIDE outputs beside it: a list of files from one run
(`list: true` on an image, video or audio output) and JSON (`look`) outputs
(decided 2026-11-11; `json-output-rules.mjs`). Its job writes each side
output's value under the output's id in `output_data` (a list as an array of
URLs) beside the media keys every media node writes; both engines are held to
`tools/units/__fixtures__/unit-list-outputs.json` by the
`unit-list-outputs-parity.test.ts` pair (`backend/src/services/workflow-engine/__tests__/`,
`frontend/src/components/editor/workflow-editor/__tests__/`).

- **An image pip is an image source.** Whatever the unit's type, a wire from
  one of its `image` pips routes as an Upload Image (`routedAs` on both
  engines, through `lib/unit-descriptors.ts` / `lib/unit-definitions.ts`), so
  every image input takes it; its video and audio pips route as the unit, by
  its producer set. The units whose `contract.producer` is `image` (projected
  as `producer` into both the descriptor and the definition) join the image
  typing sets: the server's `IMAGE_SOURCE_TYPES` (`workflow-engine/execution-graph.ts`),
  the editor's `IMAGE_SOURCE_TYPES` (`lib/preview-node-types.ts`) and
  `IMAGE_RESULT_TYPES` (`config-panels/results-gallery-media.ts`).
- **A list pip** hands one run's files (after a run once per upstream item,
  every run's, row by row — below). The server's node output carries them
  on `unitLists` (by output id; non-empty strings only, an empty list is no
  value), the node holds them on the output's `from` field. A plain (Selected)
  wire carries the first item; an Each wire — the default, `LIST_OUTPUT_HANDLES`
  in `@nodaro/shared` (`defaultEdgeOutputMode`), which the canvas edge also
  reads (`sourceListPip`: list-like, "Selected" hidden) — runs the next node
  once per item; item / item:N pick one; a Bundle hands every item, each
  routed as its own image wire into any target (never one ", "-joined string;
  the editor expands it into one `item:<i>` wire per item,
  `expandUnitListBundles`) — except a target that keeps its own Bundle
  branch on both engines: a fan-in input folds the whole list, a carousel
  post makes each item a media item, and a UGC node's handle takes each item
  on that handle (the last is its value). The list operators read every item
  (`collectItemsForEdge`); a look pip lists its own JSON entries, never the
  take batch. `listMax` (optional, list outputs only) names a
  `defaultData` field holding the most items one run makes (a whole number,
  at least 1): the run estimate counts an Each wire from the pip at that
  before a first run — times the runs the source itself makes, when it runs
  once per upstream item — and the list held after one (`list-outputs` data
  file, `UNIT_LIST_OUTPUTS`, read by `node-fan-out.ts`). Without it an unrun
  list pip quotes one run. A list output may also report how many items its run
  made but could not store: the job's `output_data["<id>NotSaved"]` (a whole
  number, 0 when it stored every one) — on the server's node output as
  `unitListsNotSaved` (by output id), landed on the node and the take as
  `<id>NotSaved` by every lane (`unitSideJobPatch` / `unitSideRunPatch`,
  `frontend/src/lib/unit-compose.ts`), cleared at run start.
- **A JSON output beside the media** lands on `unitOutputs` like a JSON-only
  worker's, but sets no `json` (a JSON consumer wired from the take reads no
  layer data); its JSON readers read its own output only.
- **Landing.** The canvas run is `kit.runProcessingNode`: for a unit with side
  outputs it empties their fields at run start and lands them beside the take
  through `pollJobWithNodeUpdate`'s `extraOutputFields` (`unitSideLanding`,
  `frontend/src/lib/unit-compose.ts`); the server-run lanes and the job
  restores land the same patch from the node output or the job row
  (`unitSideRunFields` / `unitSideJobFields`, `lib/json-run-result.ts`). The
  patch rides on the node AND on the take; a side output the run did not make
  is written as `null` (no value to every reader, and it survives a save).
- **Takes.** A side output reads the ACTIVE take's own field when the take
  carries the key, else the node's field (`unitSavedOutput` on the server,
  `unitOutputValue` / `unitPipList` / `unitPipJson` in the editor). The take
  pip lists only the last batch of a run once per upstream item
  (`__listResults` / `listResults`, `unitTakeBatchFor`) — never the take
  history a legacy media node lists.
- **A run once per upstream item hands on every row's side outputs,
  row-aligned** (decided 2026-11-11). Each row keeps its own on its take: the
  server's fan-out output carries them row-aligned with `listResults`
  (`listResultSideOutputs`, `workers/fan-out-result.ts`), and every editor lane
  spreads each row's on its take (`unitSideListRowFields`,
  `lib/json-run-result.ts`), untagged — what one run made. Beside them the
  node's own side outputs hold the WHOLE batch (`unitBatchSideOutputs`,
  `@nodaro/render-rules` — the one rule both engines run): each list output's
  files row by row; a look output that declares `alignedWith: <list output
  id>` its entries row by row, each carrying the row it came from (`row`,
  0-based: its take's index in the live `listResults` / the editor's
  `__listResults`, which keep "" for a row whose run failed — a row that made
  none adds nothing, so it is a row index, never a position; a node seeded
  from its saved data lists only the takes that were made, so pair an entry
  with its take by what the entry names, Split into Layers' `baseUrl`, never
  by `row`); the not-stored counts summed. A look output with no `alignedWith` holds the
  first row's (in row order) that made one. The server's fan-out output
  carries the whole on `unitLists` / `unitOutputs` / `unitListsNotSaved`; the
  editor's server-run lanes land it on the node like any run's, and its canvas
  run once per item (`executeNodeForList`) lands the same from the batch's
  takes (`unitSideBatchFields`). While the node holds a batch
  (`__listResults`), a wire from a side pip reads the node's fields —
  whichever take is active, as the take pip lists the batch whichever take is
  active (`unitSavedOutput`; the editor's `unitOutputField`): an Each wire
  runs once per item of every row, a Bundle hands them all, a plain wire the
  first, and item:N addresses the whole list. A single run's side outputs are
  as they were: no `row`. The node itself shows its active take's own
  (`read: "take"`), so switching takes shows that row's.
- **Storing extra images.** A worker stores its list's files through
  `finalizeJobWithMedia`'s `extraImageSets` (`lib/job-finalize.ts`): each set
  is uploaded with the result's own uploader (the job's watermark rule and the
  user's storage) under `<jobId>-<key>-<n>`, a few at a time, inside the
  finalize claim; its stored URLs land on `output_data[<key>]` (never on
  `imageUrls`, which the editor reads as takes); `extraOutputData` may be a
  function handed those URLs and the result's own stored URL (what finalize
  writes to `output_data.imageUrl` — Split into Layers names it on each
  layer's data as `baseUrl`, which is how a batch's layer is paired with its
  base: the take pip lists only the takes that were made, so a failed row
  shifts every later take's place); and a set marked `library` is listed on
  `output_data.libraryImages`, from which `createAssetFromJob` files each file
  in the Library under its name. `storeAttempts` tries each image (the result
  and every extra one) that many times — a failed attempt of one image stores
  and counts nothing, and every attempt writes the same key — and a set marked
  `dropUnstorable` leaves out an image that still fails (the job completes
  with the rest; `extraOutputData` and a `meteredBaseCredits` function are
  handed what was stored and dropped, so the charge counts only what was
  stored). Without them, finalize is as before: one attempt, and a failed
  extra image fails the finalize. A finalize that does not complete — a later
  step throws, or a cancel wins the completion — deletes every object it
  stored and gives its bytes back, under its claim and before releasing it
  (`discardUnfinishedStores`, lib/job-finalize-discard.ts); a held result keeps
  its objects for review.

**A unit priced by its settings.** A worker or sync unit whose reserved
credit id depends on the node's data names it in `price.ee.ts` (`creditId`)
and states the same rule for the editor in `price-id.ts` (`creditId:
UnitCreditId`; the validator requires the pair). Both should call one pure
rule — in `@nodaro/render-rules`, taking the unit's type from its generated
descriptor / definition, never as a literal — so they cannot drift. The editor reads it through
`unitCreditIdOf(type, data)` (`frontend/src/lib/unit-price-ids.ts`):
`getModelIdentifier` returns that id, and `estimateNodeCredits` prices it
(the cached charged price, else the `priceRows` mirror, else the type's own
row). A unit with no `price-id.ts` prices exactly as before.

**A worker unit's job budget.** A worker whose job can outlast the default
ceilings (90 minutes of processing) declares its budget in `budget.ts`:
`export const budget: UnitBudget = (data) => …`, the job's budget in ms read
off its queue payload, or `undefined` when the payload names nothing to size
(every reader then keeps its default). It is a pure leaf: it may not load the
ffmpeg runtime, storage, supabase or config (`job-budget-leaf.test.ts`), so it
usually re-exports a budget function from a `*-budget.ts` module beside the
provider. `job-budget.ts` composes it into `DECLARED_JOB_BUDGETS` under the
unit's type — its BullMQ job name — and throws at load on a type that also has
a legacy row. That one registry is what every clock reads: the video worker's
heartbeat (the unit's worker declares no `livenessBudgetMs`; the dispatch
falls back to the registry), the orchestrator's node and workflow ceilings,
the row sweeps and the relay's poll. gen:units also writes `"longRunning":
true` into the unit's editor definition, and the single-node restore list
composes from that flag, so a reload re-attaches the poll of a long job for
6 h with no hand list. `job-budget-units.test.ts` and
`single-node-restore-units.test.ts` prove both on the fixture unit, which
carries a `budget.ts`.

**A worker unit's recovery.** A worker that writes its own completion
(`finalize:own-writer`) is in `NOT_GENERIC_RECOVERABLE`: no generic media
finalize may take its row, so without more a reconcile tick only bumps it, and
a job whose delivery failed (or whose worker died after the provider finished)
is failed and refunded about 90 minutes later — with its result still
downloadable. Such a worker on a provider whose reconcile reads it (today
`provider:kie`, `RECOVERING_PROVIDERS` in `manifest.mjs`) may declare
`recover.ts`: `export const recover: UnitRecover = (task) => …`
(`backend/src/nodes/kit.ts`). The KIE reconcile (`lib/reconcile/kie.ts`) — its
cron and the video worker's stall re-pick — asks
`lib/reconcile/unit-recovery.ts` (`unitRecoverOf`) first; for a type that
answers it polls the saved task (a task that failed upstream still fails and
refunds at once, a running one is bumped) and hands the recovery the task's
WHOLE result (`task.result`: a record-info task's parsed `resultJson`), what it
cost and took, the job's `input_data` and the claimant. The recovery runs the
SAME delivery its worker runs after the provider call — one exported function,
called by both with the same inputs (Split into Layers: `deliverLayerSplit`,
from the parsed result and the run's `maxLayers` / `size` to
`finalizeJobWithMedia`) — so a recovered job is delivered and charged exactly
as the worker would have. A recovery that throws (a result it cannot read, a
base that cannot be stored after its attempts) fails the job and refunds it on
that tick (`reconcile_last_error` `delivery_failed`), never the 18-tick bump; a
`{ ok: false }` outcome (a lost claim, a held or blocked result) is not a
failure. The fal and Replicate reconciles do not read the seam (no own-writer
unit runs there), so the validator refuses `recover.ts` on any other provider.

**A unit's quote.** A unit with a route may let a client ask the price of a
run before it starts (`POST /v1/quote` with its type). It declares its run
route's pricing chain once, in `quote.ts`: `export const quote: UnitQuote = {
body, pricing }` (`backend/src/nodes/kit.ts`) — `body()` builds the route's
Zod body (a function, so the module runs no code while it loads, G7) and
`pricing` is a `RoutePricing` (`prechecks`, `modelResolver`, `opts`). Its
`route.ts` registers exactly that chain as its preHandlers
(`[...quote.pricing.prechecks, creditGuard(quote.pricing.modelResolver,
quote.pricing.opts)]`) and reserves the id the same resolver names, so the
quote and the run read one resolver. The quote route asks it through
`lib/unit-quotes.ts` after its hand-written rows, on the unit's run route
(`nodeRunRoute(type)`): the run's body, its prechecks, its model and node
doors, its `beforePricing` step and its price, with no job and nothing
reserved. A quote opens a notebook on the request (`lib/price-notes.ts`): a
precheck or `computeCredits` that knows more than the number — a hold the run
settles below (`settles_to_actual`), what it measured — says so there, and
the notes are no-ops on a run. The validator refuses `quote.ts` on a unit
with no route. Split into Layers is the first: its quote is the hold (the
most images the run may return), stated as such.

**A unit's app fields.** A published app lets its creator expose some of a
node's settings to the app's users. A unit declares which, and how each is
shown, in its manifest — never in the quick-strip registry
(`NODE_QUICK_CONFIGS`) or a hand-declared `exposableFields`, which are the
legacy nodes' sources:

```json
"defaultData": { "label": "…", "size": "1K", "maxLayers": 9 },
"appFields": [
  { "field": "size", "kind": "select", "labelKey": "myNode.field.size",
    "options": [{ "value": "auto", "labelKey": "myNode.size.auto" }, { "value": "1K" }, { "value": "2K" }] },
  { "field": "maxLayers", "kind": "integer", "labelKey": "myNode.field.maxLayers", "min": 1, "max": 99, "step": 1 }
]
```

- `kind` is a card the app-field system already renders (`APP_FIELD_KINDS`):
  `select`, a fixed list of string values (a select card, which the
  publisher may restrict), and `integer`, a whole number from `min` to `max`
  in steps of `step` (a slider card).
- `labelKey` (and an option's, optional — without one the option shows its
  value) is a key of the unit's own `strings.json` `keys`, so it is in all
  five dicts and reads in the interface language.
- The validator (`app-field-rules.mjs`) holds each field to the node: it is a
  key of `defaultData` whose value is one of its options (or a whole number in
  its range, on its step), never an input's `field` or an output's `from`,
  never a field the run override merge deletes (`RUN_OVERRIDE_CLEARED_FIELDS`
  and `RUN_ONLY_NODE_FIELDS` of `@nodaro/shared`) or one the server writes
  into a run's overrides itself (`SERVER_RUN_OVERRIDE_FIELDS` of
  `@nodaro/render-rules`: a render's `quality`, a plan's `editedEdl`, a
  component's `__injectedPortValues` —
  `backend/src/lib/__tests__/server-run-override-fields.test.ts` finds every
  server writer with the TypeScript parser and fails a key not declared
  there), nor `label` or `fieldMappings`, and exposed once; `types.ts` is
  required beside it. The lists are read from their source as text, strictly
  (`readConstList`: either quote; a spread, a reference, a missing list or a
  missing file throws), so a field added to any is refused here with no second
  list. The
  definitions aggregate writes one `UnitAppFieldsFit<Data, typeof
  definition.appFields>` line per unit that declares them: a field must be a
  key the `<Pascal>Data` type DECLARES (its `[key: string]: unknown` index
  signature does not count) whose type takes every value it lists, or
  typecheck fails there. `exposable-fields-coverage.test.ts` holds each field
  to the node's settings (`isNodeSetting`, from types.ts through gen:skills),
  as it does a strip control.
- gen:units projects `appFields` verbatim into the editor definition and the
  server descriptor (only when declared). The editor's `getExposableFields`
  returns a unit's app fields and nothing else (a unit has neither legacy
  source): the node picker lists them, the app runtimes render them through
  `FieldInputCard`, each starting at its `defaultData` value. On the server,
  `get_app_inputs` and the SDK's flat inputs type a select by its values and
  an integer as a number with its range and step (`extract-app-inputs.ts`, so
  the listing's "up to" prices every option and both ends of a range).
- **The declaration is a guarantee on every run lane.** It covers a run's
  OVERRIDES — what a run request, or a continuation re-applying a stored run,
  writes over the saved node. A run may set a unit's app field only to a value
  it declares — exposed by the app or not, by any lane, and `null` is refused
  too (the merge would delete the key, and the unit's `payload.ts` and
  `creditId(data)` would read no value instead of the default).
  `lib/exposed-unit-field-check.ts` holds it in two places, as the
  outbound-node lock is held:
  - at the ONE merge of a run's overrides into node data,
    `applyInputOverridesToNodes` (`workers/apply-input-overrides.ts`, called
    once, by the orchestrator, for every lane's job and every continuation):
    it throws before touching a node, and the run fails with the message;
  - up front, a 400 `validation_error` before any row exists, on every route
    that takes or re-applies overrides — the app run (`/v1/app/:slug/run`, its
    flat `inputs` and nested `inputOverrides` alike) and a draft run
    (`/v1/app/:slug/runs`); the app's Retry (`app-run-resume.ts`) and Render
    final (`app-render-final.ts`), on the stored run's inputs; a share-token
    run (`/v1/present/:token/run`); a component's run
    (`/v1/component/execute`); the workflow run API (`workflow-execution.ts`),
    which an editor's or an agent's Render final runs through, and its quote
    (`workflow-render-final.ts`), on the stored pin with the Final over it; a
    use-case node's continue (`use-case-continue.ts`, from-failed and Render
    final, on the stored pin with the continuation's own over it); and an
    API token run (`api-tokens.ts`). A route that re-applies a stored run
    checks what the run will APPLY (`continuationInputOverrides`), never only
    what the request sent. `unit-field-override-lanes.test.ts` holds it with
    the TypeScript parser: one product caller of the merge; every route that
    names `inputOverrides` or calls `continuationInputOverrides` checks; and
    each such check reads the applied overrides.
  The wording is a legacy fixed-list strip field's (`Invalid value for
  maxLayers: 500. Use a whole number between 1 and 99.`), and it applies under
  a publisher's restriction too. The refused value is caller-shaped and
  reaches a run's `error_message` column, so it is escaped (a NUL, a lone
  surrogate) and cut to 120 code points, at most ten refusals are spelled out,
  and each is its own sentence. A flat input naming a field the app does not
  expose is dropped, as on any node. Only a run's override is held: a value
  the creator SAVED on the node keeps running. The value lands in the node's
  data like any override, where the unit's `payload.ts` reads it — no seam of
  its own. A legacy node is never read by any of this: its fields keep their
  own rules (an unexposed raw override on one still passes unchecked).
  A direct node run is not an override: `POST /v1/<type>` (the unit's own
  route, which a canvas Run and an API call use) is held by that route's own
  Zod body, not by this check. Derive that body's enum and bounds from the
  same declaration — the unit's own projection, `./descriptor.generated.js`
  (`descriptor.appFields`), which `route.ts` may import (its own folder, G5) —
  built inside the route plugin rather than at the top level (G7 allows no
  computed call there): `z.enum(values as [string, ...string[]])` from a
  select's options, `z.number().int().min(min).max(max)` (and a step check)
  from an integer. The route then can never take a value the declaration
  refuses, or refuse one it takes.
- **Narrowing a declaration is a breaking change.** Removing a select value,
  or raising `min` / lowering `max` (or changing `step`), makes every run that
  sets the old value refuse — a published app whose publisher restricted the
  field to it, a stored run a Retry or a Render final re-applies, an API or
  MCP caller that sends it — until each is changed. There is no retired-values
  list (a strip control's `retainedOptions`): widen freely; narrow only with
  that in mind, and say so in the PR.
- The three `backend/src/lib/mcp/generated/exposable-*.ts` tables stay
  legacy-only: they exist because the server cannot read the editor's
  definitions, and a unit's descriptor is that table for it.
  `exposable-fields-units.test.tsx` renders both editor-side generators with
  a unit carrying app fields composed into `NODE_DEFINITIONS`, and holds them
  to the committed files.
- Proven on `fixture-echo` (a select `size`, an integer `maxLayers`):
  `units-manifest.test.mjs` (the validator), `units-app-field-reserved.test.ts`
  (the reserved names against the runtime lists), `units-emit.test.mjs` (the
  projections and the aggregate line), `unit-app-fields-fit.test.ts` (the
  typecheck), `exposable-fields-units.test.tsx` (the editor),
  `extract-app-inputs-unit-fields.test.ts` (the schema and the check),
  `apply-input-overrides-unit-fields.test.ts` and
  `unit-field-override-fails-execution.test.ts` (the merge and the
  orchestrator), and the route lanes: `app-runner-unit-fields.test.ts`,
  `presentation-lock.test.ts`, `component-execute-lock.test.ts`,
  `app-run-resume.test.ts`.

**Ordered registries.** Where a user or an agent sees a registry's order, a
unit is placed, never appended: NODE_DEFINITIONS after its `position.after`,
NODE_OPTIONS after its `picker.after` (a unit first in its family —
`picker.after: null` — after its `position.after`, which must then have an
add-node option) and its family after its `picker.after`, NODE_REGISTRY (/v1/nodes)
after its `registry.after` (else `position.after`), TARGET_HANDLE_ACCEPTS (the
handle popover's candidates) after its `picker.after` (else `position.after`),
and the Copilot's ALL_NODE_HANDLES at its place in type order — so a migrated
node keeps its exact legacy position. Sets and lookup records only promise
membership. The keyed aggregates are null-prototype objects, so a lookup by
any `node.type` a workflow carries ("constructor", "toString") finds no unit.
(The pilot's migration was proven against a snapshot of every composed
registry; the snapshot was retired once remove-audio landed, decided
2026-10-16. It was restored once more for the conversion of Tighten Episode
and Chapters into use-case units, with sections for the use-case paths, and
retired again when that conversion landed. It was restored a third time for
the gif-to-video migration, and retired when that migration landed. What outlives it is the shared
use-case output shapes fixture, `__fixtures__/use-case-output-shapes.json`,
which the two engines' parity tests read.)

## Rules the validator enforces

- `type` equals the folder name and is not a legacy type, nor a reserved id
  a composer's wider table already holds (an Object.prototype name, a canvas
  macro or other add-node option, a credit id of `credits.ts`);
  `position.after` and `picker.after` are always stated (order is
  user-visible), and `picker.after` is a type of the unit's own family. An anchor
  may be another unit: every ordered composition (the editor's
  `insertAtPositions` and `composeRecordAfter`, the server's `placeAfter`)
  places a unit after a unit, transitively, and refuses a cycle among units.
- Handle ids unique on each side (an input and an output may share one); kinds from the vocabulary; a media output needs a
  matching `contract.producer` (`dynamic` for more than one media kind).
- `contract` is a whitelist (`producer`, `jsonPips`, `nonPromptInputs`,
  `reviewHold`, `presents`, `fanOutEach`). It is the only thing a unit puts in
  `@nodaro/shared`, so **no price, credit id, doctrine or prompt text** may
  appear anywhere in a manifest.
- `execution.kind` decides the required files: `worker` → route, payload,
  worker, exec, api; `sync` → route, exec, api; `inline` → exec; `source` →
  none; `use-case` → backend `use-case.ts` + `price.ee.ts`, and it refuses
  `exec.ts`, `api.ts`, a route, `payload.ts`, `worker.ts`,
  `characterize.char.ts`, `execution.queue` and `execution.requires`.
  `budget.ts` is only for `worker` (the video worker's liveness budget).
  `recover.ts` is only for a `worker` with `finalize:own-writer` and a
  provider whose reconcile reads it (`RECOVERING_PROVIDERS`: `provider:kie`).
  Any route needs `price.ee.ts` (a zero-cost one too). `price.ee.ts`
  exports `staticCosts`, plus `creditId(data)` only when the id a run reserves
  depends on the node's data (a flat-priced unit reserves the row of its type).
- `docs.page` exists, or `docs.awaiting` gives the reason. `docs.index:
  "hand-written"` keeps the node's hand-written `docs/nodes/README.md` row where
  it is (decided 2026-10-16 for migrated nodes, so the public page does not
  change): gen:units emits no generated row for it, and the README must have a
  hand-written row linking `docs.page`. New nodes omit it and get a generated row.
- `registry.after` (optional): the node's place in `/v1/nodes`
  (`NODE_REGISTRY`, which keeps its own hand-curated order) when that differs
  from `position.after`.
- A video output has one length rule. `length:pass-video` (keeps at most its
  video input's length) and `length:exact-video` (exactly it) join the
  kept-length sets; `length:unknown` (no rule bounds it before it has run — a
  GIF's length, which only the file says) gives it the unbounded rule and, in
  `UNBOUNDED_LENGTH_REASONS`, the sentence its top-level `lengthUnknownReason`
  states (required with the capability, refused without it; the descriptor
  carries it), so the listing prices a length-priced step after it at the
  run's own stand-in, and adds no kept-length row (the run estimates read the
  node's own length). `length:unknown` combines with neither other `length:*`
  capability and needs `contract.producer: "video"`; `length:exact-video`
  already implies `length:pass-video`. A **new** node with `length:unknown`
  is also added by hand to the shrink-only unbounded-producers pin in
  `backend/src/lib/__tests__/video-output-length.test.ts` (a migrating legacy
  node is already in it).
- A worker in the provider lane (`lane:provider`) names the one provider its
  job calls with a `provider:*` capability (today `provider:kie`): the
  concurrency gate's provider ceilings (`lib/concurrency-lanes/provider-of.ts`)
  attribute its job through `providerOf` (`lib/unit-descriptors.ts`), so no
  central table names a unit. None, or two, are refused, and a `provider:*`
  on any other unit is refused.
- A unit whose category the server does not share (`ai`, `scene`, …: not
  one of `REGISTRY_CATEGORIES`) names its `/v1/nodes` category in
  `registry.category` (a `NodeCategory` of `backend/src/lib/node-registry.ts`,
  `SERVER_CATEGORIES`: an AI image node is `ai-image`); a unit whose category
  the server shares names none. The descriptor carries it as
  `registryCategory`.
- A worker or sync unit whose `price.ee.ts` names the reserved credit id from
  the node's data (`creditId`) has `price-id.ts` beside its manifest, the
  same rule for the editor ("A unit priced by its settings"); only such a
  unit has one (a flat-priced unit reserves its type's row, a use-case node's
  fee is its own branch).
- A worker counts its job in exactly one concurrency lane: one of
  `lane:provider` / `lane:llm` / `lane:local` (none is refused, two are
  refused). The job lane registry (`backend/src/lib/concurrency-lanes/registry.ts`)
  reads it through `laneOf` (`lib/unit-descriptors.ts`), since no central list
  names a unit. Only a worker runs a job: any other kind with a `lane:*`
  capability is refused (a use-case node dispatches existing nodes, each
  counted in its own lane).
- A use-case node takes no `length:*` capability: its length rule is its
  spec's `outputLength` (above), which `lib/video-output-length.ts` turns
  into its row of `VIDEO_OUTPUT_LENGTH_RULES`.
- `mcp.widgetModelFor` (optional): the MCP tools (snake_case names) that
  dispatch the node's job and whose result widget shows the node's type as its
  `model`. The verb resolves it once, when it registers, with
  `widgetModelOf("<tool>")` (`backend/src/lib/mcp/widget-models.ts`); a legacy
  verb passes its literal instead (`widgetModelOf("<tool>", "<type>")`), and
  passing both, or neither, throws. Migrating a node drops the verb's literal
  and declares the tool here. The value is always the unit's own type, a tool
  is claimed by one unit, and every declared tool must be a registered MCP
  tool (`lib/mcp/__tests__/widget-models.test.ts`, against `tool-surface.json`).
- Parameter pickers and canvas macros are not units.

### Manifest keys beyond the basics

| Key | Rule |
|---|---|
| `execution.builder` | `use-case` only, required: a key of `USE_CASE_SPECS` (`packages/render-rules/src/use-case-specs.ts`), unique across units. |
| `handles.inputs[].id` (use-case) | one of `media`, `music`, `introCard`, `masterAudio` (`USE_CASE_INPUT_HANDLES`; the run routes only these), with no `field`, no `many`, never accepting `look`. |
| `handles.inputs[].accepts: ["look"]` | a JSON input: `look` is never beside another kind, and it declares no `field` (its wire lands in `unitInputs`, "A unit's input lanes"). |
| `handles.inputs[].many: true` | the input takes every wire, in order: only `true`, only when `accepts` ⊆ `video`, `audio` (`MANY_KINDS`), never with `field`. |
| `handles.outputs[].kind: "look"` (not a use case) | a JSON output names its `from` (the field its value lands on), and stands beside other `look` outputs ("A worker unit's JSON outputs") or beside media outputs, the media take first ("A worker unit's media take and its side outputs") — never beside a text or any other output (`json-output-rules.mjs`). |
| `handles.outputs[].from` (use-case) | absent: the use-case reader (`use-case-io.ts` in the editor, `use-case-output.ts` on the server) reads a use-case node's outputs, never `from`. |
| `handles.outputs[].runtimeTyped: true` | only on an audio/video/image output with `contract.producer: "dynamic"`: the pip's kind is decided at run time, so it gets no `HANDLE_OUTPUT_TYPES` row. |
| `handles.outputs[].list: true` | the output carries one run's LIST of files (`LIST_OUTPUT_KINDS`: an image, video or audio output) with a `from`, never `runtimeTyped`; a side output of the media take, which is the unit's first output ("A worker unit's media take and its side outputs"). gen:units writes its `UNIT_LIST_PIPS` row (`@nodaro/shared`, a published row: type id and pip ids) and its `UNIT_LIST_OUTPUTS` row (`@nodaro/render-rules`, private: the run estimate's count). |
| `handles.outputs[].listMax: "<field>"` | only on a list output: the `defaultData` field (a whole number, at least 1) holding the most items one run makes — what the run estimate counts an Each wire from the pip at before a first run. |
| `handles.outputs[].alignedWith: "<list output id>"` | only on a `look` output, naming a list output (`list: true`) of the same unit, never on a use-case node: its entries line up with that list's items one for one. After a run once per upstream item both hand on every row's, row by row, and each entry carries its row (`row`) — "A worker unit's media take and its side outputs" (`json-output-rules.mjs`). |
| `registry.category` | the `/v1/nodes` category (`SERVER_CATEGORIES`) of a unit whose own category the server does not share; refused when it does. |
| `picker.alsoOnTabs` | picker tabs (other than its family's own) that also list the node (`TAB_SUPERSET`). |
| `appFields` | the settings a published app may expose: `{ field, kind: "select", labelKey, options: [{ value, labelKey? }] }` or `{ field, kind: "integer", labelKey, min, max, step }` ("A unit's app fields"). |
| `contract.jsonPips` | `{ <look output id>: "transcript" \| "edl" \| "other" }`, every `look` output declared (`JSON_OUTPUT_KINDS`). |
| `contract.nonPromptInputs` | input ids that are never a prompt lane (`NON_PROMPT_TEXT_LANES`). |
| `contract.reviewHold` | `use-case` only: a review-on run ends at a Preview that holds what follows (`REVIEW_HOLDING_USE_CASE_TYPES`). |
| `contract.presents` | `image` \| `video` \| `audio` \| `text`: how a published app shows the result, where the producer sets do not already decide it. |
| `contract.fanOutEach` | `{ each: <output ids>, primary: <output id> }`, nothing else (`FAN_OUT_EACH_HANDLES`): the outputs an "each" edge reads one item at a time when the node ran once per item (one or more, each named once, never a `look` output), and the output an edge naming no pip reads. A use-case node declares it exactly when its result is a list (`use-case-rows.test.ts`). |

## Guards

| | Guard | Where |
|---|---|---|
| G1 | a type lives in exactly one place (unit or legacy literal); the legacy list only shrinks, and a type it does not list in the literal — a new hand-written node — fails | `tools/__tests__/node-units-guard.test.mjs`, runtime twin in `frontend/src/__tests__/node-units-structure.test.ts` |
| G2 / G2b | no string literal of a unit's type id outside its folders; unit-owned i18n keys are not also hand-written | `frontend/src/__tests__/node-units-structure.test.ts` |
| G3 | aggregates declare `@registry` / `@registry-exports`; only listed composers import them | `node-units-guard.test.mjs` |
| G4 | tests and product modules that name a registry export declare how they use it | `node-units-guard.test.mjs` (burn-downs `tools/test-select/registry-users-*.json`) |
| G5 | a unit imports no other unit, no aggregate, no engine module | the `node-units-*` boundary rules in `tools/structure/` |
| G6 | the manifest is valid | `gen:units --check` + `tools/__tests__/units-manifest.test.mjs` |
| | the scaffold of every kind passes the guards above, and its templates typecheck against the product (in memory, nothing written) | `tools/__tests__/units-scaffold.test.mjs`, `frontend/src/__tests__/units-scaffold.test.ts`, `frontend/src/__tests__/units-scaffold-typecheck.test.ts` |
| G7 | unit modules have no top-level side effects. A top-level call is pure only as a known constructor or a zod chain whose callee text starts `z.` — so keep `z.enum(` on one line (`z` then `.enum(` on the next line is refused) — with pure arguments: an enum over a list is `z.enum(LIST as unknown as [string, ...string[]])`, never `z.enum(tuple(LIST))` | `node-units-structure.test.ts` |

A unit's `node.tsx` and `config.tsx` live under `frontend/src/nodes/<type>/`,
not in `components/nodes/` or `components/editor/config-panels/`. A guard
that scans those directories for every canvas component or config panel
also reads `unitComponentFiles("node" | "config")`
(`frontend/src/test-utils/unit-component-files.ts`, discovered at test time),
so a node that becomes a unit does not drop out of it.

How test selection treats the aggregates: `tools/test-select/README.md`, "Registries".
