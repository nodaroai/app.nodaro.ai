<!-- tools/units/README.md -->
# Node units (`gen:units`)

A **unit** is one node type kept in its own folders instead of across ~21
central registration files (§5.8 option B, decided 2026-10-16):

| Tree | Folder | Holds |
|---|---|---|
| frontend | `frontend/src/nodes/<type>/` | `unit.json` (**the manifest, source of truth**), `strings.json`, `types.ts`, `node.tsx`, `config.tsx`, `option.tsx`, `exec.ts`, `api.ts`, generated `definition.generated.ts` / `labels.generated.ts`, `__tests__/` |
| backend | `backend/src/nodes/<type>/` | `route.ts` (or `route.ee.ts` when Cloud-only), `payload.ts`, `worker.ts`, `price.ee.ts`, `output.ts` / `inputs.ts`, `characterize.char.ts` (an ffmpeg worker's characterization operation), generated `descriptor.generated.ts`, `__tests__/` |

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
npm run gen:units -- --new <type> --category <category> --kind <worker|sync|inline|source> \
  --after <type|first> --description "One sentence for /v1/nodes." \
  (--family <family id> --picker-after <type|first> | --no-picker) \
  [--label "<Label>"] [--price <credits>] [--characterize <operation|first>]
```

- Every flag but `--label` is stated, never guessed: `--after` is the place in
  `NODE_DEFINITIONS` and the skills catalog, `--picker-after` the place in the
  picker family (a type of that family, or `first`) — both user-visible order;
  `--description` is what `/v1/nodes` and MCP show; `--price` (required for
  `worker` and `sync`, refused otherwise) is the `price.ee.ts` row — 0 for a
  free node, stated.
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
  `docs` as `docs.awaiting`. It prints what stays central:
  1. fill the folders: the node's step, its handles in `unit.json` with the
     matching `types.ts` fields and `node.tsx` pips;
  2. `strings.json`: the node label in he/ja/ko/pt-br (`labels`) and any UI
     string only the unit uses, in all five dicts (`keys`);
  3. its page under `docs/nodes/`, in the same PR: `docs.page` replaces the
     scaffold's `docs.awaiting` (docs-node-registry-parity needs the page, and
     gen:units writes its `docs/nodes/README.md` row from `docs.page`); until
     the page is on the docs site the type is listed in `AWAITING_DOCS_PAGE`
     (`node-docs.test.ts`), then the snapshot is refreshed
     (`npm -w frontend run gen:node-docs -- --live`) and the line dropped;
     a video output also needs its length rule (`length:exact-video` /
     `length:pass-video`, or `length:unknown` with a `lengthUnknownReason`
     when no rule can bound it);
  4. a node with a route: the `model_pricing` seed migration at the same price
     as `price.ee.ts`;
  5. a media output: a `@nodaro/shared` changeset (`contract.producer` adds a
     row to `packages/shared/src/generated/unit-contracts.ts`);
  6. `npm run gen`, `npm run build:packages` (render-rules carries the node's
     settings), `npm run typecheck`.

**Which kinds a new node can be today.** The editor runs every kind, but a
server-run workflow (API, MCP, webhook, schedule, a published app) runs a unit
only through an execution seam (`EXECUTION_SEAMS` in `seams.mjs`). Only
`worker` is live: `payload.ts` through `UNIT_PAYLOADS`, `worker.ts` through
`UNIT_WORKERS`. `sync` (SYNC_HTTP_NODES), `inline` (INLINE_NODES) and `source`
(SOURCE_NODE_TYPES) do not compose units yet, so the validator refuses them;
the first node of such a kind builds its seam and flips its `live`.

## Files

| File | What |
|---|---|
| `manifest.mjs` | The one loader + validator (G6). gen:skills loads units through it too. |
| `seams.mjs` | Every seam: the aggregates, projections, splice regions and data files, each with its composer and a `live` flag. |
| `capabilities.mjs` | The closed list of manifest `capabilities`, each read by exactly one seam. |
| `vocabulary.mjs` | Categories, handle kinds, producer kinds, execution kinds, queues — pinned to the product by `frontend/src/__tests__/units-vocabulary.test.ts`. |
| `templates.mjs` | The emitters and the region splice. |
| `scaffold.mjs` | `gen:units -- --new`: flags, the in-memory validation, the write, the printed next steps. |
| `scaffold-templates.mjs` | The scaffold's file templates, one worked shape per `execution.kind`. |
| `price-reader.mjs` | Reads `price.ee.ts` `staticCosts` with the TypeScript parser (lazily) for the editor's `priceFallback`. |
| `gen.mjs` | The CLI. |
| `unit.schema.json` | Editor autocomplete (`"$schema"` in `unit.json`); the validator is the authority. |
| `legacy-nodes.json` | Types still in the hand-written `NODE_DEFINITIONS` literal — a burn-down that only shrinks (G1). |
| `registry-composers.json` | The reviewed composition points: the only product modules that may import an aggregate (G3), and the collections each re-exports (`exports`: the registry names G4 and the test-select registry rule read), and `foldsAtLoad`: the registries a composer reads every unit of while it loads — their enumerator, derived by `structure.mjs` `loadTimeRegistryReads` and held to it by `node-units-structure.test.ts`. |
| `central-mentions.json` | Reasoned exceptions to G2 (a unit's type id named outside its folders) — only shrinks. |
| `__fixtures__/tree/` | The fixture unit `fixture-echo`: every optional file, every seam, used by the generator and guard tests. |

## Seams go live one at a time

A seam is live once its composer edit exists. Until then gen:units writes
nothing for it, and a unit that needs it fails validation with
"needs the … seam, which is not live". **A node that needs a missing seam
builds that seam in its own PR** — there is no exceptions list. Every output
seam in `seams.mjs` is live (PR1b): the aggregates exist (empty until the
first unit), each composed once into the collection the product reads. Of the
execution seams only `run-worker` is (above). The same rule holds below the
seams: a capability, an input kind (`ACCEPTS_KINDS`) or a category
(`REGISTRY_CATEGORIES`) is added only with the composition that reads it.

| Registry | Composed in |
|---|---|
| `NODE_DEFINITIONS`, `SceneNodeType`/`SceneNodeData` | `frontend/src/types/nodes.ts` (`LEGACY_NODE_DEFINITIONS` ∪ units at `position.after`) |
| `nodeTypes`, config panels, `NODE_OPTIONS` + families, executors, label tables | `components/nodes/index.ts`, `config-panel.tsx`, `node-options.tsx` + `node-families.ts`, `execute-node.ts` (kit: `workflow-editor/unit-exec-kit.ts`), `lib/i18n/labels.ts` |
| everything derived from a unit's manifest in the editor (`EXECUTABLE_TYPES`, the price mirror, `HANDLE_OUTPUT_TYPES`, `TARGET_HANDLE_ACCEPTS`, the ffmpeg rule, config-panel names and button sets, output extraction) | read through `frontend/src/lib/unit-definitions.ts` (the one door to the definitions aggregate, so modules a unit imports are never composers) |
| `NODE_REGISTRY`, `STATIC_CREDIT_COSTS` / `CREDIT_COSTS`, routes (core + ee), payloads + required media, the ffmpeg worker map | `node-registry.ts`, `ee/billing/credits.ts`, `app.ts`, `payload-builder.ts`, `workers/handlers/ffmpeg.ts` |
| everything derived from a unit's manifest on the server (saved output, `NOT_GENERIC_RECOVERABLE`, the MCP handle table `lib/node-handles.ts`, the `length:unknown` rows of `VIDEO_OUTPUT_LENGTH_RULES` / `UNBOUNDED_LENGTH_REASONS` in `lib/video-output-length.ts`) | read through `backend/src/lib/unit-descriptors.ts` |
| the canvas connection rule of a unit's inputs (each `handles.inputs[].accepts`) | `frontend/src/lib/connection-validation.ts` asks `lib/unit-connections.ts` (below) |
| the producer sets | `packages/shared/src/producer-types.ts` ∪ `generated/unit-contracts.ts` |
| the ffmpeg characterization operations (`OPERATIONS`; each named by its unit's type — its golden key — and placed after its `after`) | `backend/src/providers/video/__characterization__/operations.ts`. The unit file and its aggregate are `.char.ts`, like the harness: excluded from the build and the default test run |
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
`audio`, `image`; several = any of them), and writes no predicate of its own.
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

**Ordered registries.** Where a user or an agent sees a registry's order, a
unit is placed, never appended: NODE_DEFINITIONS after its `position.after`,
NODE_OPTIONS and its family after its `picker.after`, NODE_REGISTRY (/v1/nodes)
after its `registry.after` (else `position.after`), TARGET_HANDLE_ACCEPTS (the
handle popover's candidates) after its `picker.after` (else `position.after`),
and the Copilot's ALL_NODE_HANDLES at its place in type order — so a migrated
node keeps its exact legacy position. Sets and lookup records only promise
membership. The keyed aggregates are null-prototype objects, so a lookup by
any `node.type` a workflow carries ("constructor", "toString") finds no unit.
(The pilot's migration was proven against a snapshot of every composed
registry; the snapshot was retired once remove-audio landed, decided
2026-10-16.)

## Rules the validator enforces

- `type` equals the folder name and is not a legacy type, nor a reserved id
  a composer's wider table already holds (an Object.prototype name, a canvas
  macro or other add-node option, a credit id of `credits.ts`);
  `position.after` and `picker.after` are always stated (order is
  user-visible), and `picker.after` is a type of the unit's own family. An anchor
  may be another unit: every ordered composition (the editor's
  `insertAtPositions` and `composeRecordAfter`, the server's `placeAfter`)
  places a unit after a unit, transitively, and refuses a cycle among units.
- Handle ids unique; kinds from the vocabulary; a media output needs a
  matching `contract.producer` (`dynamic` for more than one media kind).
- `contract` is a whitelist (`producer`). It is the only thing a unit puts in
  `@nodaro/shared`, so **no price, credit id, doctrine or prompt text** may
  appear anywhere in a manifest.
- `execution.kind` decides the required files: `worker` → route, payload,
  worker, exec, api; `sync` → route, exec, api; `inline` → exec; `source` →
  none. Any route needs `price.ee.ts` (a zero-cost one too). `price.ee.ts`
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
- Parameter pickers and canvas macros are not units.

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
| G7 | unit modules have no top-level side effects | `node-units-structure.test.ts` |

How test selection treats the aggregates: `tools/test-select/README.md`, "Registries".
