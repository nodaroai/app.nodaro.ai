# Animal/Creature Entity + Object→"Object/Props" Relabel

**Status:** Design v3 (brainstormed 2026-06-08; audited 3 rounds; v3 = post-deep-audit corrections)
**Scope:** Add a first-class **Animal/Creature** reference entity (DB-backed, Studio, generation, community sharing) modeled on the existing **Object** entity; plus relabel the `object` node's display name to **"Object/Props"**.

> **v3 changelog (a 5-agent adversarial audit refuted several v2 fixes + found 3 omitted subsystems):**
> - §5 now mirrors the **full physical `objects` table DDL** (not `SELECT_COLUMNS`, which is a read projection missing `workflow_id`/`main_image_url`/`custom_variations` that the community adapter references). Removed the false "mirror `updated_at` trigger" (objects has none — `updated_at` is route-managed).
> - **NEW §7.3 Generation write-back** — objects persist generated assets via an `append_object_asset` RPC + Supabase Realtime publication + `object-auto-attach.ts` + worker `entity.ts`. v2 omitted this entirely; it is *inside* PR1's "generate/save/use" promise.
> - §7.2 fixed: creature routing is mostly **membership SETS, not switch cases**; named the 4 sets that silently drop a `creatureRef` before image/video generation, plus a drift-proof discovery procedure (the v2 grep missed bare-string sets + `packages/shared`).
> - **NEW §6.1 Studio wiring** — the studio opens via store state + a `workflow-editor-main` render block (v2 omitted it → modal never opens). Studio is **6 tabs / 13 files**, explicit-save (not debounced), `ensureSavedBeforeGen`.
> - §8 adds the **`category` typed union** (compile blocker) + correct config-panel touchpoints (display-name map + render case; v2's "button-type set" was a misdirection).
> - §9 fixed the **unnamed CHECK constraint** name for migration 207 + the **stale classification test** caveat; trimmed over-listed community components (only `publish-dialog` needs widening).
> - §11 pricing fixed: entity generation prices by the **`provider` body field**, not a (non-existent) `generate-object` credit key.
> - **NEW §7.4 Workflow export/import** — `with_assets` bundling silently drops creatures unless extended.
> - §14 re-scoped: PR1 must include write-back + keystone routing + studio wiring to actually be "generate/save/use." SDK CRUD resource + MCP tools + library-browser modal are **named deferrals** (PR4).

---

## 1. Goal

A new canvas node, **Animal/Creature**, that works like Character/Object: define a specific animal or creature (a dragon, a pet husky, a phoenix) once — consistent look + angles/poses/motions — and reuse it across shots. **DB-backed**, has a **Studio**, supports **generation**, is **shareable** in the community library. Separately, the `object` node is relabeled **"Object/Props"** (display only).

## 2. Decisions locked

| # | Decision | Choice |
|---|----------|--------|
| D1 | What it is | A **new** full entity (NOT a relabel of `face`). |
| D2 | Human Face node | **Untouched**. Animal/Creature is separate + additive. |
| D3 | Template | Clone + adapt the **Object** entity. **Mirror it structurally** (same physical columns/constraints/handles/execution-class/RPCs/realtime) — diverging is the #1 audit-found bug source. |
| D4 | Studio tabs | **Appearance · Angles · Poses · Motions · Variations** (object's tabs with Materials→**Poses**). **Sheet tab DEFERRED from PR1** to a follow-up — reference-sheet support requires widening the `EntityKind` shared type across ~12 `Record<EntityKind>` maps; PR1 ships **5 tabs**. The `sheets`/`detail_closeups` columns + RPC arms exist (ready), just no UI yet. |
| D5 | `species` field | **Free text + autocomplete** from `packages/shared/src/animals.ts` (126 entries). |
| D6 | Community sharing | **In v1** (PR2). |
| D7 | Type string | `creature`. Display label everywhere: **"Animal/Creature"**. |
| D8 | Object relabel | display name → **"Object/Props"** (label only; type string stays `object`). |
| D9 | Animal-path triplication | **Keep all three, document** (picker / Object-`animal` / Creature). Additive, zero migration. See §3.1. |
| **D10** | Data-model mirror granularity | Mirror the **full physical objects table** (incl. legacy `main_image_url`/`custom_variations`/`workflow_id`) so the cloned adapter/RPC/worker code maps 1:1 with no phantom-column drift. Add `species`; rename the `materials` slot to `poses`. |

**Untouched:** the human `face` node + face-swap; the **Animal parameter-picker** (`"animal"`); Object's `category:"animal"` + `animalId`.

## 3. Out of scope (YAGNI for v1)

LoRA training, voice, human-style "expressions" (creatures get Poses). No change to the Object entity beyond its label.

### 3.1 The three animal paths (D9 — keep all three)

| Path | What it is | Identity? | Use |
|------|-----------|-----------|-----|
| **Animal parameter-picker** (`"animal"`) | generic species **prompt fragment** via FieldMappings | No | quick "an animal" |
| **Object, `category:"animal"`** | DB-backed Object, animal category (legacy) | object-style | existing object-animals — **untouched** |
| **Creature** (`creature`) — NEW | first-class DB-backed Animal/Creature | richest | a **specific, reusable** animal/creature |

Deliberate; a `docs/nodes/...` note explains the distinction. No code redirect/deprecation in v1.

### 3.2 Why a separate entity (considered alternative, rejected)

An architecture review proposed **Character subject-aware** (`human|animal`) for performers + Object-`animal` for props, with no new entity. **Rejected** because the primary intent is consistent *non-human/fantastical* subjects (dragons/phoenixes/pets), not performers — those fit Character poorly (human-shaped: likeness/consent/voice) and Object only loosely. Creature is intentionally performance-light in v1 (no expressions/voice/LoRA). If *performing* animals later matter, Character-subject-aware is the path **then**, and can coexist. The Object-`animal` redundancy is accepted (D9).

## 4. The entity

| Aspect | Value |
|---|---|
| Node type string | `creature` |
| Display label | **Animal/Creature** ("Create Animal/Creature" in add-node/toolbar) |
| Output handle | `creatureRef` (handle color `HANDLE_COLORS.imageRef`, mirror object — guarded by `handle-color-guard.test.ts`) |
| Data type | `CreatureNodeData` (`frontend/src/types/nodes.ts`) |
| Node `category` | **`creature`** — a NEW value in the `NodeCategory` union + `base-node.tsx` category union + its 4 category-keyed style maps (see §8). |
| Icon | lucide `PawPrint` / `Rabbit` |
| MiniMap color | **`#A78BFA` (violet)** in `getMiniMapNodeColor` (`workflow-canvas.tsx:~338`) — unused hue (Char #F472B6, Obj #34D399, Loc #22D3EE, Face #FB923C). |
| DB table | `creatures` |
| Hero image | approved **into `source_image_url`** (mirror `object-main-image-approval.ts:217`) — `main_image_url` is carried for structural parity but is legacy/unused, same as object. |
| Credit cost | generation prices by the **`provider`** body field (image/video model id) — see §11. |
| Execution class | **EXECUTABLE** (like object/character/location) — NOT a source node. See §7. |

## 5. Data model — `creatures` table

**Mirror the full *physical* `objects` table** (cumulative DDL across migrations `018`+`026`(FKs)+`147`+`170`+`200`+`202`+`204`+`205`) — the **DDL**, not `objects.ts:127 SELECT_COLUMNS` (that is the camelCase read projection and omits `workflow_id`/`main_image_url`/`custom_variations`, which the community adapter still references). Apply two deltas: **add `species TEXT`**, **rename the `materials` jsonb slot to `poses`**. New migration **`206_creatures.sql`**.

Physical columns to replicate (transcribe each column's exact type/default/nullability from the source migrations — do NOT guess):

`id` (uuid PK) · `user_id` (uuid NOT NULL FK→profiles ON DELETE CASCADE) · `node_id` (text) · `workflow_id` (uuid, FK added in 026) · `project_id` (uuid FK→projects) · `name` (text NOT NULL) · `description` (text) · **`species` (text — NEW)** · `category` (text) · `style` (text) · `source_image_url` (text — seed + approved hero) · `main_image_url` (text — legacy, parity-only) · `image_provider` (text, 204) · `angles` (jsonb) · **`poses` (jsonb — was `materials`)** · `motion_clips` (jsonb) · `variations` (jsonb) · `custom_variations` (jsonb) · `reference_photos` (jsonb — PII-stripped on share) · `canonical_description` (text) · `style_lock` (boolean, nullable) · `selected_asset_by_variant` (jsonb NOT NULL DEFAULT `'{}'`, 205) · `sheets` (jsonb, 200/202) · `detail_closeups` (jsonb, 200/202) · `deleted_at` (timestamptz) · `created_at` / `updated_at` (timestamptz).

- **RLS:** mirror objects — `FOR ALL USING (auth.uid() = user_id)` (objects uses a `DO` block; reproduce).
- **Indexes:** mirror objects (user_id, project_id, node_id).
- **`updated_at`:** **route-managed** (every write sets `updated_at: new Date().toISOString()`; the `expectedUpdatedAt` optimistic-concurrency contract depends on it). **NO DB trigger** — objects has none; do not add one.
- **No `r2_assets_purged_at`** — objects has none; the soft-delete→R2-reap path mirrors object's route-side `collectObjectR2Keys` + `batchDeleteFromR2`.
- **`append_creature_asset` RPC + Realtime** — see §7.3 (must live in migration 206).

## 6. Studio — `frontend/src/components/editor/creature-studio/`

Clone `object-studio/` (a **13-file** dir, **6 tabs**). Tabs (D4): **Appearance** (hero, species[autocomplete], style, description) · **Angles** · **Poses** (net-new UI; mirror `materials-tab.tsx`) · **Motions** · **Variations** · **Sheet** (`ReferenceSheetTab` + a `SHEET_TAB_ADAPTERS.creature` adapter + a `use-creature-studio-jobs` hook).

Files to clone (object-studio has these): `creature-studio-modal.tsx`, `appearance-tab.tsx`, `angles-tab.tsx`, `poses-tab.tsx` (from materials-tab), `motion-tab.tsx`, `variations-tab.tsx`, `creature-asset-tab.tsx`, `reference-photos-section.tsx`, `use-creature-studio.ts`, `use-creature-studio-jobs.ts`, `use-creature-realtime-sync.ts`, `__tests__/creature-studio-modal.test.tsx`.

- **Hook reality:** `useObjectStudio` is **explicit-save** (no debounce) — `saveStaged()` fires from the modal Save button; first-generate save is **`ensureSavedBeforeGen()`** (not "ensureSaved"). Staged state uses `objectDbId`/`objectName`; refetch-on-open via `refetchedRef`/`refetchAndRestage`. Mirror these names → `creatureDbId`/`creatureName`/`ensureSavedBeforeGen`.
- **Realtime:** the studio shows generated assets live via `use-object-realtime-sync.ts` (`object:${id}` channel). The creature equivalent depends on §7.3's `ALTER PUBLICATION` line.
- **Studio-modal test gotcha:** `object-studio-modal.test.tsx` must `vi.mock("@/hooks/use-auth")` (the modal calls `useAuth()`→`useNavigate()`, throws without a Router) and stub `@/lib/supabase` (realtime client). The creature test clone needs both mocks.
- **Share button (D6):** reuse `PublishDialog` with `entityType="creature"` (widen its inline union at `publish-dialog.tsx:19`; likeness checkbox stays character-only). Keep the z-[10000] fix.
- **Species autocomplete (D5):** datalist/combobox from `animals.ts`; free text accepted.

### 6.1 Studio entry-point wiring (was omitted — without it the modal never opens)

The object studio opens via three coupled pieces; replicate all for creature:
1. `frontend/src/hooks/use-workflow-store.ts` — `objectStudioNodeId` state + `setObjectStudioNodeId` setter (decl ~:604, impl ~:2885) → add `creatureStudioNodeId`/`setCreatureStudioNodeId`.
2. `frontend/src/components/editor/workflow-editor/workflow-editor-main.tsx` — the selector (~:278) + the conditional `<ObjectStudioModal nodeId={objectStudioNodeId} .../>` render block (~:1466) → add a `<CreatureStudioModal .../>` block.
3. `frontend/src/components/nodes/creature-node.tsx` — the "Open Studio" button calls `setCreatureStudioNodeId(id)` (mirror `object-node.tsx:306`).

## 7. Backend

### 7.1 Routes (mirror object's full route family — object has FOUR route files)
- `routes/creatures.ts` — CRUD + duplicate + soft/permanent delete (mirror `objects.ts`; large surface: list/get/save/duplicate/delete/restore). `requireAppScope("assets:write")` on mutations.
- `routes/creature-restore.ts` (mirror `object-restore.ts`).
- `routes/creature-main-image-approval.ts` — approve hero **into `source_image_url`** + caption (mirror `object-main-image-approval.ts`).
- `routes/creature-llm-caption.ts` (mirror `object-llm-caption.ts`).
- `routes/generate-creature.ts` — hero + per-tab asset generation; **prices by `provider`** (see §11).
- `app.ts` — register all five (core; no edition gate).
- `lib/node-registry.ts` — `creature` descriptor.
- `lib/entity-naming.ts` — widen the table-name type to include `"creatures"`.

### 7.2 Execution engine — creature is EXECUTABLE; most touchpoints are membership SETS, not cases

Add a `case "creature"` ONLY where object truly has a switch case; everywhere else, **add `creature` to a SET**:

| File / symbol | Kind | Action | If missed |
|---|---|---|---|
| `workflow-editor/types.ts:154` `EXECUTABLE_TYPES` | set | add `creature` | not runnable; `node-registry-sync.test.ts` fails |
| `execution-graph.ts:~190` `SOURCE_NODE_TYPES` | set | **do NOT add** | orchestrator throws `Unknown node type`; CI parity test fails (EXECUTABLE ∩ SOURCE must be ∅) |
| `execution-graph.ts:~296` `IMAGE_SOURCE_TYPES` | set | add `creature` | input routing breaks |
| `payload-builder.ts:3816` `case "object"` | **case** | add `case "creature"` (reads `creatureDbId`) | orchestrator throws |
| `payload-builder.ts:904` `VIDEO_REF_IMAGE_SOURCE_TYPES` | set | add `creature` | **creatureRef dropped from i2v/t2v ref reorder** |
| `payload-builder.ts:253` `resolveSheetEntity` tuple + `idField` | tuple | add `creature` + `creatureDbId` | reference-sheet composition skips creature |
| `input-resolver.ts:952` `ENTITY_NODE_TYPES` | set | add `creature` | **backend won't treat creatureRef as image source** |
| `output-extractor.ts:853` `ENTITY_RESULT_TYPES` | set | add `creature` | **creature output dropped → dead downstream edge** |
| `node-executor.ts:161` entity switch | **case** | add `case "creature"` (`pick("description","prompt")`) | prompt field not extracted |

### 7.3 Generation write-back (NEW — objects' result-persistence path; required for PR1)

Generated assets are written back to the row via a table-specific RPC + surfaced live via Realtime. Mirror for creature:
- **Migration 206 must also:** create `append_creature_asset(uuid, text, jsonb)` (mirror `append_object_asset` from migration 147, hardened per `170_lock_down_append_asset_rpcs.sql` / 200; its `CASE` arms cover `angles`/`poses`/`motion_clips`/`variations`/`custom_variations`/`sheets`/`detail_closeups` — use `poses`, NOT `materials`), and `ALTER PUBLICATION supabase_realtime ADD TABLE creatures`.
- `backend/src/lib/creature-auto-attach.ts` — mirror `object-auto-attach.ts` (`autoAttachCreatureAsset` + `setCreatureMainImage`; calls `supabase.rpc("append_creature_asset", …)`).
- `backend/src/workers/handlers/entity.ts` — add a creature branch (mirror the object branch ~:177 that calls auto-attach + set-main-image).

### 7.4 Workflow export/import bundling (NEW — silent data loss otherwise)

`with_assets=true` bundles char/obj/loc; a creature in an exported workflow is **silently lost** unless extended. Touch all of:
- `backend/src/lib/workflow-assets.ts` — `ASSET_FIELDS` (~:91), `collectAssetIds` (~:100, `node.type==="object"`), `workflowExportSchema` (~:75), `fetchExportAssets` (~:143), `reCreateAssets` (~:261), `remapNodeAssetIds` (~:328).
- `packages/shared/src/workflow-export.ts` — add `WorkflowExportCreature` (mirror `WorkflowExportObject`).
- Flows through `routes/workflows.ts` + MCP `export_workflow`/`import_workflow` automatically once the lib is extended.

## 8. Frontend node registration

Standard new-node steps (`[internal spec reference removed]`) — verified object touchpoints:
1. `types/nodes.ts` — `CreatureNodeData` + `SceneNodeData` + `SceneNodeType` unions + `NODE_DEFINITIONS` (~:6567 label) + **`NodeCategory` union (~:44) add `"creature"`**.
2. `components/nodes/creature-node.tsx` — mirror `object-node.tsx` **including its hardcoded `style={{maxWidth:'220px'}}` (object-node:101)** — entity nodes do NOT use `video-node-defaults.ts`; the media-node-sizing invariant test excludes them (verified). Pass `category="creature"`.
3. **`components/nodes/base-node.tsx`** — add `"creature"` to the category union (~:36) **and** a `creature` arm to the 4 category-keyed maps: `CATEGORY_HEADER` (~:107), `CATEGORY_ICON_COLOR` (~:124), accent-glow (~:504), icon-bg (~:539) — else compile error (typed union) or no styling (Record maps return undefined).
4. `components/nodes/index.ts` — `creature: CreatureNode`.
5. `add-node-popup.tsx` — `NODE_OPTIONS` ("Create Animal/Creature") **and** `COMMON_ASSETS_SECTION.types` (~:1390, the Assets group).
6. `node-toolbar.tsx` — sidebar entry (separate list).
7. `editor-toolbar.tsx` — reset/clear case (~:283).
8. `config-panels/entity-configs.tsx` — `CreatureConfig` (mirror `ObjectConfig` ~:427) + provider-aware fail-safe `useEffect` if any dropdown.
9. `config-panels/index.ts` — export.
10. `config-panel.tsx` — import + **display-name map** (~:344 `"creature":"Animal/Creature"`) + **render case** (~:634 `case "creature": return <CreatureConfig/>`). *(NOT a "button-type set" — object is in neither `GENERATE_BUTTON_TYPES` nor `RUN_BUTTON_TYPES`; entity nodes render Run via `RunNodeButton` inside the node.)*
11. `lib/api.ts` — creature client fns (mirror the object surface ~:1273–1579: generate/save/approve/recaption/delete/restore/get/list). `hooks/queries/use-assets-queries.ts:53` — add `useCreatures` (used by studio upstream-picker + future library).
12. `workflow-editor/execute-node.ts` — DAG block + the sets `t2vRefAllowedTypes` (~:2467), `WIRED_SOURCE_LABELS` (~:689 & ~:1297), llm-chat image-source tuple (~:3870); `execution-graph.ts extractNodeOutput` object case (~:547); `node-input-resolver.ts` OR-chain (~:1468) + `creatureDbId` sheet branch (~:1484).
13. **Identity/handle keystones:** `generate-image-handles.ts:116 IDENTITY_TYPES` (propagates to generate-video-handles / image-producer-handles / target-handle-registry / unused-prompt-edges / node-compatibility); `use-workflow-store.ts:2191 IDENTITY_TYPES_FOR_CLASSIFIER`; **`generate-image-handle-migration.ts:31` (a SEPARATE `IDENTITY_TYPES`)**; `handle-output-types.ts:76` (`creature:{creatureRef:"imageRef"}`); `node-compatibility.ts:80 HANDLE_COMPATIBILITY` (`creatureRef:["creatureRef"]`); `connection-validation.ts:441 IDENTITY_VALIDATORS` + **author `isValidCreatureConnection` in `identity-handles.ts` + `IDENTITY_HANDLE_LABELS.creature`** (a new predicate, not a tuple add).
14. **`packages/shared`** (outside the editor grep): `node-mappable-fields.ts:56` (`creature` field list — FieldMappings/`{ref}` injection), `ancestor-refs.ts:11` (entity tuple — ancestor/mention resolution), `prompt-builder.ts:~1560` (identity prompt label).
15. `node-search-modal.tsx` (~:61), `template-utils.ts:58` (label map), `workflow-canvas.tsx` (edge-handle label map ~:103 + `getMiniMapNodeColor` ~:338 + `ENTITY_NODE_TYPES` ~:134), `connected-media-list.tsx` — label/color maps.
16. `backend/skills/` — `npm run gen:skills` (needs `INTERNAL_ORCHESTRATOR_SECRET` ≥32 chars inline; `gen:skills:check` hard-fails otherwise).

**Drift-proof discovery (the v2 grep missed bare-string sets + `packages/shared`):**
```bash
grep -rn '"object"' frontend/src backend/src packages/shared/src | grep -iE '"character"|"location"'
grep -rn "objectRef\|objectDbId" frontend/src backend/src packages/shared/src
```
Triage each hit: core editor/handle/execution/persistence (`use-workflow-persistence.ts:206/315/418`, `run-handlers.ts:769/1074`, `workflow-editor-main.tsx:431`, `use-workflow-store.ts:115`, `manual-edit-node.tsx`, image-source sets in `video-configs`/`llm-chat-config`/`reference-sheet-config`) → **v1-required**; asset libraries / `scene-config.tsx:115` / `kling3-director-modal` / `extract-references-modal` → triage per feature; MCP verb tools + `ee/pipelines/*` → **named v1.1 deferrals** (§13).

## 9. Community sharing for creatures (D6 — PR2)

**🔴 Migration `207_community_creature_entity_type.sql`:** the `community_listings.entity_type` CHECK at `201:16` is an **unnamed inline** constraint → Postgres auto-name `community_listings_entity_type_check`. Migration:
```sql
ALTER TABLE community_listings DROP CONSTRAINT IF EXISTS community_listings_entity_type_check;
ALTER TABLE community_listings ADD CONSTRAINT community_listings_entity_type_check
  CHECK (entity_type IN ('character','location','object','creature'));
```
Do **NOT** touch `community_listings_likeness_chk` (`201:44`) — creature passes it trivially (`<> 'character'`). No other community table has an entity_type CHECK (`community_clones.entity_type` is plain TEXT; snapshots have none).

**Compile-enforced (TS forces a `creature` key):** `community-entity-adapters.ts` `EntityType` union + `COMMUNITY_ENTITY_ADAPTERS` (Record); `publish.ts:8 PREVIEW_BUDGET` (add `creature:4`); `admin-community.ts:9 ENTITY_TABLE`.

**Adapter classification:** since creatures structurally mirrors objects (D10), mirror object's adapter (`community-entity-adapters.ts:35`) **column-for-column** — `species`→publicTextField, `poses`→assetField (was `materials`), `reference_photos`→stripField. ⚠️ The object adapter currently does **not** classify `image_provider`/`selected_asset_by_variant`/`sheets`/`detail_closeups` (a pre-existing drift); classify these for creature (likely `sheets`/`detail_closeups`→assetField, `image_provider`/`selected_asset_by_variant`→public/ignored) and fix the object/location drift in the same PR.

**Classification test (NOT a magic auto-guard):** `__tests__/community-entity-adapters.test.ts` only checks columns hand-listed in its `COLUMNS` map. Add a `COLUMNS.creatures` array **derived from `206_creatures.sql`** (not copied from the stale `objects` block, which has phantom `workflow_id`/`main_image_url`/`custom_variations` and omits the 4 real columns above) + a 4th `describe("creature adapter")` block. Otherwise the guard is inert.

**Runtime (NOT compile-enforced):** `admin-community.ts:31` AND `:75` (`.includes(entityType)` — `:75` is the `by-source` route); `community.ts:64` clone `z.enum`; `packages/cli/src/commands/community.ts:23 ENTITY_TYPES` + help strings `:63`/`:151`; `packages/shared/src/community.ts:8 CommunityEntityType` (rebuild **shared→client→cli**); `frontend/src/ee/app/explore/page.tsx` — the **local** `type EntityType` (`:26`, NOT from shared) + `ENTITY_TABS` (`:30`) + copy string (`:164`); `publish-dialog.tsx:19` inline union.

**Zero-change (verified — do not touch):** `community-card.tsx` / `community-preview-modal.tsx` (consume `CommunityCard` from shared); `packages/client/src/resources/community.ts` (uses `CommunityEntityType`, widens transitively); clone/reaper/asset-lifecycle services (adapter-driven). `featured-entities.ts` returns `[]` for creature (empty Featured row until curated — note).

**Guard:** add a publish + clone test for `entityType:"creature"` (207 applied; end-to-end routing).

## 10. Object → "Object/Props" relabel (D8 — PR3)

Display-name change only (type string `object`, `objectRef` handle, `objects` table, `objectName` unchanged). User-facing label spots (verified):
`types/nodes.ts:6567/6573` NODE_DEFINITIONS · `add-node-popup.tsx:1174` "Create Object" · `node-toolbar.tsx:196` · `object-node.tsx` handle label + alt · `node-search-modal.tsx:61` · `config-panel.tsx:344` display name · `entity-configs.tsx:427` header (+ "Open Object Studio" :439/:443, "Object Name" :471/:473) · `workflow-canvas.tsx:103` edge-handle label map (`objectRef:"Object/Props"` — this is NOT the MiniMap; MiniMap is `getMiniMapNodeColor`, leave color) · `object-page-modal.tsx` title · `template-utils.ts:58` · **`unified-asset-library.tsx:503` "Objects" filter tab (×2 copies in the file) · `asset-selection-modal.tsx:190` "Objects" filter**.
Leave internal `object`/`objectRef` identifiers and the picker **group** label "Object" (spans vehicle/weapon/animal/etc.) alone. Verify: `grep -rn '"Object"\|Objects\b\|Create Object' frontend/src/components`.

## 11. Generation pipeline

Mirror `generate-object`: from the seed image, generate hero + per-tab assets via configured image/video providers with credit guard. **Pricing:** `generate-creature.ts` sets `modelIdentifier = provider` (mirror `generate-object.ts:131`) and the credit guard resolves cost from the provider/model id — there is **no flat `generate-object`/`generate-creature` credit key and no `model_pricing` seed to add** (existing per-model rows cover it). Assets persist via §7.3's `append_creature_asset`.

## 12. Testing

- **Backend:** creatures CRUD/duplicate/restore; main-image-approval writes `source_image_url`; `append_creature_asset` RPC + write-back via worker `entity.ts`; community **classification test** (`COLUMNS.creatures` from 206 DDL) + publish/clone `creature`; **migrations 206 + 207 apply**; export/import round-trips a creature (`with_assets`).
- **Frontend:** node registration (component renders, config panel, both add-node + toolbar, `category="creature"` styling), `EXECUTABLE_TYPES`/`IDENTITY_TYPES` membership, studio modal opens (with `useAuth`/supabase mocks), `/explore` Creatures tab.
- **SDK/CLI:** `CommunityEntityType` includes `creature`; CLI `--type creature` validates; clone/publish accept it.
- Run **FULL** backend + frontend vitest + `gen:skills:check` (entity-routing + new node → targeted runs miss CI invariants; per memory `full_suite_before_shipping_enum_changes`).

## 13. File map (summary) + named deferrals

**New:** migrations `206_creatures.sql` (table + RLS + indexes + `append_creature_asset` RPC + Realtime publication), `207_community_creature_entity_type.sql`; `backend/src/routes/{creatures,creature-restore,creature-main-image-approval,creature-llm-caption,generate-creature}.ts`; `backend/src/lib/creature-auto-attach.ts`; `frontend/src/components/nodes/creature-node.tsx`; `frontend/src/components/editor/creature-studio/*` (13 files); `CreatureConfig`; `packages/shared/src/workflow-export.ts` `WorkflowExportCreature`.

**Modified:** see §6.1 (studio wiring), §7.2 (execution sets/cases), §7.3 (worker `entity.ts`), §7.4 (`workflow-assets.ts`), §8 (registration incl. `base-node.tsx` category maps + `packages/shared` sets), §9 (community), §10 (relabel). `gen:skills` regenerated.

**Named deferrals (v1.1 — NOT silent):**
- **SDK entity CRUD resource** `packages/client/src/resources/creatures.ts` (objects/characters have one) — PR4.
- **MCP creature tools** (`mcp/tools/verbs-clo.ts` etc.) — coherent deferral (per-verb, no shared enum to break).
- **Creature library browser** — `creature-page-modal.tsx` (object has a 2nd modal beyond the studio) + gallery + `unified-asset-library` Creatures tab. Studio (opened from the node) ships in PR1; the standalone library browser is PR4.

## 14. Phasing — shippable PRs

**PR1 — Creature entity, end-to-end (large; this is what "create/generate/save/use" actually requires):**
migration 206 (table + RLS + indexes + `append_creature_asset` + Realtime) → routes (CRUD/restore/approval/caption/generate, priced by provider) → `creature-auto-attach.ts` + worker `entity.ts` branch → execution sets/cases (§7.2, all keystones) → §7.4 export bundling → frontend node registration (§8 incl. `category` maps + identity keystones + `packages/shared` sets) → studio (`creature-studio/` **5 tabs**, Sheet deferred + wiring §6.1 + tests) → `gen:skills` → FULL suite. **Exit:** create, generate (assets persist + show live), save, wire a creatureRef into image/video, export/import — all working.

**PR2 — Community sharing (§9):** migration 207 (CHECK widen) → adapter + classification test (+fix object/location drift) → compile-enforced + runtime touchpoints → CLI + shared (rebuild shared→client→cli) → `/explore` Creatures tab + `publish-dialog` → studio Share button → publish/clone creature test. Depends on PR1.

**PR3 — Object→"Object/Props" relabel (§10):** display-label sweep (incl. library filters + `template-utils.ts`). Independent.

**PR4 (deferred) — Parity:** SDK `creatures` resource + MCP tools + library browser.

> Each PR: dev → staging test → dev→main `--merge` (applies migrations to prod). PR1 (206) and PR2 (207) carry migrations → validate on staging first; never renumber a deployed migration.

## 15. Risks / watch-items

- **EXECUTABLE-not-source** (§7.2) + the 4 SET touchpoints that silently drop a creatureRef before generation — the top re-introduction risk; covered by the table in §7.2 + a wired-creature→video test.
- **Write-back subsystem** (§7.3) is easy to miss and breaks "save" — the `append_creature_asset` RPC + Realtime publication must be IN migration 206.
- **Data-model: transcribe DDL** from the real objects migrations (not memory, not SELECT_COLUMNS); `materials`→`poses` rename must be consistent across the table, the `append_creature_asset` `CASE` arms, auto-attach, the adapter, and the studio tab key.
- **Two migrations** (206, 207) apply to prod via dev→main; validate on staging.
- **Community runtime arrays + the stale classification test** (§9) — derive `COLUMNS.creatures` from the 206 DDL; the test is a hand-maintained guard, not automatic.
- **`category` union + maps** (§8 #3) — compile error or missing styling if any of the 4 maps lacks a `creature` arm.
- **gen:skills** mandatory; **fail-safe `useEffect`** on any provider-aware dropdown in CreatureConfig/studio.
- Type string `creature` doesn't collide with the `animal` picker (verified).
