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
npm run gen                    # gen:units, then gen:skills
```

## Files

| File | What |
|---|---|
| `manifest.mjs` | The one loader + validator (G6). gen:skills loads units through it too. |
| `seams.mjs` | Every seam: the aggregates, projections, splice regions and data files, each with its composer and a `live` flag. |
| `capabilities.mjs` | The closed list of manifest `capabilities`, each read by exactly one seam. |
| `vocabulary.mjs` | Categories, handle kinds, producer kinds, execution kinds, queues — pinned to the product by `frontend/src/__tests__/units-vocabulary.test.ts`. |
| `templates.mjs` | The emitters and the region splice. |
| `price-reader.mjs` | Reads `price.ee.ts` `staticCosts` with the TypeScript parser (lazily) for the editor's `priceFallback`. |
| `gen.mjs` | The CLI. |
| `unit.schema.json` | Editor autocomplete (`"$schema"` in `unit.json`); the validator is the authority. |
| `legacy-nodes.json` | Types still in the hand-written `NODE_DEFINITIONS` literal — a burn-down that only shrinks (G1). |
| `registry-composers.json` | The reviewed composition points: the only product modules that may import an aggregate (G3), and the collections each re-exports (`exports`: the registry names G4 and the test-select registry rule read). |
| `central-mentions.json` | Reasoned exceptions to G2 (a unit's type id named outside its folders) — only shrinks. |
| `__fixtures__/tree/` | The fixture unit `fixture-echo`: every optional file, every seam, used by the generator and guard tests. |

## Seams go live one at a time

A seam is live once its composer edit exists. Until then gen:units writes
nothing for it, and a unit that needs it fails validation with
"needs the … seam, which is not live". **A node that needs a missing seam
builds that seam in its own PR** — there is no exceptions list. Every seam
in `seams.mjs` is live (PR1b): the aggregates exist (empty until the first
unit), each composed once into the collection the product reads. The same
rule holds below the seams: a capability, an input kind (`ACCEPTS_KINDS`) or
a category (`REGISTRY_CATEGORIES`) is added only with the composition that
reads it.

| Registry | Composed in |
|---|---|
| `NODE_DEFINITIONS`, `SceneNodeType`/`SceneNodeData` | `frontend/src/types/nodes.ts` (`LEGACY_NODE_DEFINITIONS` ∪ units at `position.after`) |
| `nodeTypes`, config panels, `NODE_OPTIONS` + families, executors, label tables | `components/nodes/index.ts`, `config-panel.tsx`, `node-options.tsx` + `node-families.ts`, `execute-node.ts` (kit: `workflow-editor/unit-exec-kit.ts`), `lib/i18n/labels.ts` |
| everything derived from a unit's manifest in the editor (`EXECUTABLE_TYPES`, the price mirror, `HANDLE_OUTPUT_TYPES`, `TARGET_HANDLE_ACCEPTS`, the ffmpeg rule, config-panel names and button sets, output extraction) | read through `frontend/src/lib/unit-definitions.ts` (the one door to the definitions aggregate, so modules a unit imports are never composers) |
| `NODE_REGISTRY`, `STATIC_CREDIT_COSTS` / `CREDIT_COSTS`, routes (core + ee), payloads + required media, the ffmpeg worker map | `node-registry.ts`, `ee/billing/credits.ts`, `app.ts`, `payload-builder.ts`, `workers/handlers/ffmpeg.ts` |
| everything derived from a unit's manifest on the server (saved output, `NOT_GENERIC_RECOVERABLE`, the MCP handle table `lib/node-handles.ts`) | read through `backend/src/lib/unit-descriptors.ts` |
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

- `type` equals the folder name and is not a legacy type; `position.after`
  and `picker.after` are always stated (order is user-visible). An anchor
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
- Parameter pickers and canvas macros are not units.

## Guards

| | Guard | Where |
|---|---|---|
| G1 | a type lives in exactly one place (unit or legacy literal); the legacy list only shrinks | `tools/__tests__/node-units-guard.test.mjs`, runtime twin in `frontend/src/__tests__/node-units-structure.test.ts` |
| G2 / G2b | no string literal of a unit's type id outside its folders; unit-owned i18n keys are not also hand-written | `frontend/src/__tests__/node-units-structure.test.ts` |
| G3 | aggregates declare `@registry` / `@registry-exports`; only listed composers import them | `node-units-guard.test.mjs` |
| G4 | tests and product modules that name a registry export declare how they use it | `node-units-guard.test.mjs` (burn-downs `tools/test-select/registry-users-*.json`) |
| G5 | a unit imports no other unit, no aggregate, no engine module | the `node-units-*` boundary rules in `tools/structure/` |
| G6 | the manifest is valid | `gen:units --check` + `tools/__tests__/units-manifest.test.mjs` |
| G7 | unit modules have no top-level side effects | `node-units-structure.test.ts` |

How test selection treats the aggregates: `tools/test-select/README.md`, "Registries".
