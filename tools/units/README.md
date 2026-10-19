<!-- tools/units/README.md -->
# Node units (`gen:units`)

A **unit** is one node type kept in its own folders instead of across ~21
central registration files (§5.8 option B, decided 2026-10-16):

| Tree | Folder | Holds |
|---|---|---|
| frontend | `frontend/src/nodes/<type>/` | `unit.json` (**the manifest, source of truth**), `strings.json`, `types.ts`, `node.tsx`, `config.tsx`, `option.tsx`, `exec.ts`, `api.ts`, generated `definition.generated.ts` / `labels.generated.ts`, `__tests__/` |
| backend | `backend/src/nodes/<type>/` | `route.ts` (or `route.ee.ts` when Cloud-only), `payload.ts`, `worker.ts`, `price.ee.ts`, `output.ts` / `inputs.ts`, `characterize.char.ts` (an ffmpeg worker's characterization operation), `use-case.ts` (a use-case node's request body), `budget.ts` (a worker's job budget), generated `descriptor.generated.ts`, `__tests__/` |

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
  [--label "<Label>"] [--price <credits>] [--builder <key>] [--characterize <operation|first>]
```

- Every flag but `--label` is stated, never guessed: `--after` is the place in
  `NODE_DEFINITIONS` and the skills catalog, `--picker-after` the place in the
  picker family (a type of that family, or `first`) — both user-visible order;
  `--description` is what `/v1/nodes` and MCP show; `--price` (required for
  `worker`, `sync` and `use-case`, refused otherwise) is the `price.ee.ts`
  row — 0 for a free node, stated; for a use-case node it is the per-run fee,
  the row `use-case-fee:<type>`.
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
     `backend/src/lib/mcp/tools/verbs-use-case.ts` (typecheck fails until it is
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
  `backend/src/lib/mcp/tools/verbs-use-case.ts`, a typed total table), and a
  `SETTINGS_TABLES` row in `backend/src/lib/__tests__/use-case-graph-validity.test.ts`;
  typecheck fails until both of the last two exist.

  Its spec (`USE_CASE_SPECS.<builder>`, composed with the node's row into its
  `UseCaseDescriptor`) states, beside its graph, what the engines read about
  the node so no rule names a use-case type:
  - `outputLength` (`{ fixedSec, after? }`): the length of each video it
    delivers — a fixed length, after the named input's length when that input
    is wired. `lib/video-output-length.ts` makes it the node's length rule, and
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
| everything derived from a unit's manifest on the server (saved output, `NOT_GENERIC_RECOVERABLE`, `NODARO_EXCLUSIVE_NODE_TYPES` (the `edition:nodaro-exclusive` capability), `TEXT_SOURCE_NODE_TYPES` (a first output of kind `text`), the MCP handle table `lib/node-handles.ts`, the MCP verbs' widget model `lib/mcp/widget-models.ts`, the `length:unknown` rows of `VIDEO_OUTPUT_LENGTH_RULES` / `UNBOUNDED_LENGTH_REASONS` in `lib/video-output-length.ts`) | read through `backend/src/lib/unit-descriptors.ts` |
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
| the long single-node restore horizon (`LONG_RUNNING_NODE_TYPES`: a reload re-attaches a running job's poll for 6 h instead of 30 minutes) | `frontend/src/lib/single-node-restore.ts`, the legacy rows ∪ the units whose definition is `longRunning` (through `unit-definitions.ts`) |
| the kept-length sets (`LENGTH_KEEPING_VIDEO_TYPES` / `EXACT_LENGTH_VIDEO_TYPES`, the `length:*` capabilities — the run estimates, the run's charge and, through them, the listing's `VIDEO_OUTPUT_LENGTH_RULES`) | `packages/render-rules/src/kept-length.ts` ∪ `unit-kept-lengths.generated.ts` |

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

**A worker unit's JSON outputs.** A worker whose outputs are JSON (`kind:
"look"`, each with its `from`; the validator, `json-output-rules.mjs`, lets a
look output stand only beside other look outputs) writes each output's value
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
  `budget.ts` is only for `worker` (the video worker's liveness budget). Any
  route needs `price.ee.ts` (a zero-cost one too). `price.ee.ts`
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
| `handles.outputs[].kind: "look"` (not a use case) | a JSON output names its `from` (the field its value lands on), and a unit with one has only `look` outputs: no lane lands a job's JSON beside its media yet ("A worker unit's JSON outputs"; `json-output-rules.mjs`). |
| `handles.outputs[].from` (use-case) | absent: the use-case reader (`use-case-io.ts` in the editor, `use-case-output.ts` on the server) reads a use-case node's outputs, never `from`. |
| `handles.outputs[].runtimeTyped: true` | only on an audio/video/image output with `contract.producer: "dynamic"`: the pip's kind is decided at run time, so it gets no `HANDLE_OUTPUT_TYPES` row. |
| `picker.alsoOnTabs` | picker tabs (other than its family's own) that also list the node (`TAB_SUPERSET`). |
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
