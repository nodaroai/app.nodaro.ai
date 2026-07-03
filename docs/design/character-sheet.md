# Character Reference Sheet — Redesign (design spec)

**Date:** 2026-06-28
**Branch:** `feat/character-sheet-redesign`
**Status:** approved design, twice audited against the codebase → ready for implementation plan

> **[reference removed]:**
> - **Pass 1** killed the first draft's invented `SheetSection.variants` field — the engine already has an equivalent **`entries`** field, wired through the planner, both stages, AND the route Zod schema; `variants` would have been silently stripped. This spec uses `entries`.
> - **Pass 2** (three independent lenses: refute-the-fixes / data-flow trace / blind-spots) found a **BLOCKING** panel-count overflow, a regression Pass-1's fix introduced (prepared-key shape), and a shared-tab blast radius. All folded in below.

## Problem

The Character Studio "Sheet" page (shared `reference-sheet-tab.tsx`) generates a composited turnaround/reference sheet, but:

1. You **can't view a sheet full-screen** — result + "Existing sheets" grid have only Download / Set-thumbnail.
2. You **can't copy the sheet URL**.
3. The sheet "types" are **bare, unexplained, uncosted chips** — no hint of what each produces, that some need to **generate angles first**, or **how many credits** it costs.
4. The clean **head + body turnaround** format most useful for AI video reference (front/profiles/back-of-head + front/side/back body — see attached screenshots) isn't a clearly-offered option.

## Current state (verified — reuse, don't rebuild)

- **Two-stage flow** (`reference-sheet-tab.tsx`): Stage A `planSheetGeneration(entityKind, sections, flavour, bucketsByColumn, name)` → `{ presentUrls: string[]; missing: PanelGenRequest[] }`; each `missing` is generated via `sheet-tab-adapter.ts` and awaited; Stage B `generateReferenceSheet` (`POST /v1/reference-sheet`) composites. Both stages resolve panels through the SAME pure planner `panel-plan.ts::planSheetPanels`.
- **`SheetSection`** = `{ kind, board?, subtitle?, panelCount?, entries? }`. **`entries?: SheetEntry[]`**, preset entry `{ kind:"preset", variant:string }`, is the curated-panel mechanism. `planSheetPanels`: `entries?.length` → emit exactly those variants in order; else `BOARD_VARIANTS[entity][board].slice(0, panelCount ?? DEFAULT_PANEL_COUNT)`, **`DEFAULT_PANEL_COUNT = 4`**.
- **`planSheetPanels` throws if a plan exceeds `MAX_PANELS_PER_SHEET = 24`.** Since `estimateSheetCost` will wrap `planSheetGeneration` → `planSheetPanels`, this throw can fire **on the frontend** during a live-cost recompute (see §3 cap).
- **Route Zod schema** (`reference-sheet.schema.ts`): `flavour.sections[].entries` already validated; `type` is a **required** `z.enum(SHEET_TYPES)` carrier; the layout comes from `flavour.sections` (curated sections **win** over `DEFAULT_SECTIONS[type]` — `plan-generation.ts:22`). The `flavour` object is a plain `z.object` → **strips unknown keys** (so `presetId` must be added there).
- **Angle catalog** (`entity-prompts.ts`): `headAngles` = `[front, 3/4 left, left profile, right profile, 3/4 right, above, below]` (7, **no `back`**); `bodyAngles` includes `back`. Backend angle PROMPT maps already have profiles/above/below **and head `back`** (`generate-character-asset.ts:191`). The variant gate is a runtime `.includes(CHARACTER_ASSET_VARIANTS[assetType])`, reading the same shared array.
- **Board counts** (`BOARD_VARIANTS[character]`): expressions = 11, poses = 9, wardrobe = 3, detail = 3 (default slice = `min(4, n)` → Expr 4 / Poses 4 / Wardrobe 3 / Detail 3).
- **Cost**: `reference-sheet:assembly = 4` (still); each missing panel = a character-asset gen with no provider override → `nano-banana = 1`. No provider selector in the sheet flow → per-panel cost is constant **1**. `presetId` does not change the credit id (keys off `outputFormat`).
- **`MultiImageLightbox`** (`components/ui/multi-image-lightbox.tsx`): props `items: {url,alt?,kind?:"image"|"video"}[]`, `startIndex`, `onClose`; ←/→/Esc; supports `kind:"video"`; z-`[100]`. **No `actions` slot today.** Root closes on backdrop click → action buttons must `e.stopPropagation()`.
- **`ReferenceSheet`** record has NO `name`/`presetId`. The worker hardcodes **`source:"node"`** for ALL sheets (studio included) and stores the **input `flavour` verbatim**; the grid labels by `${type} · ${skin}` and does **not** filter by `source` (so never filter by `source==="studio"` — it would hide everything).
- The character adapter's `awaitJob` only resolves a URL — it does **not** update `staged` buckets; the studio refetches the row **only on open**. (Basis for the §3 prepared-key tracking.)

## Goals

Character-first (the tab is shared by character/object/location; the redesign is gated to character — see §2 guard):

1. Full-screen viewing of sheets with ←/→ navigation.
2. Copy-URL on sheets.
3. Named, **explained, live-costed** presets: **Studio · Main**, **Studio · Extended**, plus **à-la-carte** board add-ons.
4. **Two-step** generation: **① Prepare angles** (generate only what's missing; angles persist as reusable assets) → **② Compose sheet**, with transparent cost.

## Design

### 1. Full-screen + Copy-URL

- Clicking the result image or any "Existing sheets" tile opens **`MultiImageLightbox`** with `items` = `[result, …existingSheets]` (←/→ pages across all). The builder sets `kind: sheet.flavour?.outputFormat === "motion" ? "video" : "image"` (motion sheets are mp4s; an `<img src=…mp4>` would render broken).
- **Add an optional `actions?: (item) => ReactNode` render-prop to `MultiImageLightbox`** (opt-in; ~10 existing call sites pass nothing → unaffected). The Sheet tab passes a "Copy URL" action. **All action buttons `e.stopPropagation()`** (the lightbox root closes on backdrop click).
- **Copy-URL** (`navigator.clipboard.writeText(url)` + toast): next to Download on the result, in the lightbox via `actions`, and on each existing-sheet hover row.

### 2. Preset model — `entries`-based, character-only

New `packages/shared/src/reference-sheet/presets.ts` — the SoT for the preset cards:

```ts
type SheetPresetId = "studio-main" | "studio-extended"
interface SheetPreset {
  id: SheetPresetId
  label: string            // "Studio · Main"
  description: string
  type: SheetType          // CARRIER for the route's required `type` enum (Main→"turnaround", Extended→"full-reference")
  baseSections: SheetSection[]  // curated via `entries`
  skin: SheetSkin          // "studio"
  aspect: SheetAspect      // "landscape"
}
const presetEntries = (vs: string[]): SheetEntry[] => vs.map((variant) => ({ kind: "preset", variant }))
const PRESET_LABELS: Record<SheetPresetId, string>
```

- **`studio-main`** — *"Clean turnaround for AI video reference."* carrier `turnaround`.
  - `{ kind:"head-turnaround", entries: presetEntries(["front","left profile","right profile","back"]) }`
  - `{ kind:"body-turnaround", entries: presetEntries(["front","left profile","back"]) }`
  - 7 panels, `studio` / `landscape`. (= screenshots 1 & 2.)
- **`studio-extended`** — *"Full turnaround — adds above/below + 3/4 angles."* carrier `full-reference`.
  - head entries: `front, 3/4 left, left profile, right profile, 3/4 right, above, below, back` (8)
  - body entries: `front, 3/4 left, left profile, right profile, back, above, below` (7)
  - 15 panels, `studio` / `landscape`.

Every variant exists in `headAngles`/`bodyAngles` **except head `back`** → the single catalog edit below. *(Layout note: Main head = 4 panels renders as a single row (matches the screenshots); Extended head = 8 wraps 5+3 in the landscape grid — acceptable for the "more coverage" preset.)*

**À-la-carte boards** — optional toggles appended to the base preset's sections (no `entries` → board's default slice):

| Toggle | Section kind | Board | Default panels |
|--------|--------------|-------|----------------|
| Expressions | `expression-board` | expressions | 4 |
| Poses | `pose-board` | poses | 4 |
| Wardrobe | `wardrobe-board` | wardrobe | **3** |
| Detail (eyes/hands/hair) | `detail-board` | detail | **3** |
| Palette | `palette` | — | 0 (structural, free) |

**🔴 Panel-count cap (required).** `Studio·Extended (15) + à-la-carte` can exceed `MAX_PANELS_PER_SHEET = 24` (Extended + 3 panel-boards = 26; + all 4 = 29) → `planSheetPanels` throws, and because the live cost calls it, the throw surfaces **in the cost handler**, not just a route 400. So:
- The board toggles are **disabled (greyed, with a "would exceed 24 panels — remove a board" hint)** once the projected plan would exceed 24.
- `estimateSheetCost`'s call to `planSheetGeneration` is wrapped in **try/catch**; on overflow the cost line shows "Too many panels — remove a board" instead of crashing.
- `Studio·Main (7) + all 4 boards = 21` is always safe; only Extended is exposed.

**Object/Location guard (required).** `head-turnaround`/`body-turnaround` boards **don't exist for object/location** (`resolveBoard` throws). The preset UI renders **only when `adapter.entityKind === "character"`**; object/location keep the **existing `SHEET_TYPES` chip UI unchanged**. For character, the presets + à-la-carte boards are a superset of the old character types (turnaround / variation-board≈Expressions / detail≈Detail / full-reference≈Extended+boards), so the chip UI is replaced there. *(Deliberate simplification: character loses the rarely-used "expression-board alone, no turnaround" option; acceptable per the "simplify" goal.)*

**Single catalog edit:** append `"back"` to `CHARACTER_ASSET_VARIANTS.headAngles` (`entity-prompts.ts`) **at the end (index 7)** — keeps the default-4 slice `[front, 3/4 left, left profile, right profile]` unchanged (no test churn), enables the catalog AND satisfies the route's `.includes` gate; the head prompt already has `back`.

### 3. Two-step flow + live cost

New `packages/shared/src/reference-sheet/cost.ts`:

```ts
function estimateSheetCost(
  entityKind, sections, flavour, buckets, name, perPanelCost, assemblyCost,
): { present: number; missing: PanelGenRequest[]; prepareCost: number; assemblyCost: number; total: number; overflow: boolean }
// present = planSheetGeneration(...).presentUrls.length; missing = .missing
// prepareCost = missing.length * perPanelCost; total = prepareCost + assemblyCost
// wrap planSheetGeneration in try/catch → overflow:true (MAX_PANELS) instead of throwing
```

UI (recomputed live as the user toggles preset/boards and as panels get prepared):

```
┌ Studio · Extended ──────────────────────────────┐
│ Full turnaround — adds above/below + 3/4 angles. │
│ Reuses 9 existing angles · 6 missing             │
│ ① Prepare 6 angles  ~6 cr     ② Compose  4 cr    │
└─────────────────────────────────────────────────┘
```

- **① Prepare angles** — generates ONLY the missing panels (Stage A: `adapter.generateAsset` per `missing`, awaited; worker attaches each to the entity bucket → also visible in the Angles tab). Hidden when nothing missing. `N/M` progress.
- **② Compose sheet** — `generateReferenceSheet` with the preset's carrier `type` + explicit `flavour.sections` (base + toggled boards) + `flavour.presetId`. Poll → surface result. **Enabled only when `missing.length === 0`**, else "Prepare N angles first." Stage B re-reads fresh DB buckets, so it sees panels prepared this session.
- **Prepared-key tracking (required — fixes the Pass-1 regression):** the character adapter's `awaitJob` returns only a URL and never updates `staged`, and the studio refetches only on open. So as ① completes, accumulate each prepared panel as **`{ column: missing[i].attachToColumn, name: missing[i].attachName, url }`** (the URL from `awaitJob`) and merge into the **column-keyed** bucket snapshot fed to `planSheetGeneration`/`estimateSheetCost`: `buckets[column] = [...(buckets[column] ?? []), { name, url }]`. `matchVariant` requires a **non-empty URL**, so the captured URL must be injected (a synthetic placeholder is safe — Stage B re-resolves from DB). **Key by `attachToColumn`, NOT `assetType`** (`headAngles`→column `angles`; detail/wardrobe are both `custom` but land in `detail_closeups`/`outfit_variations`) — otherwise the merge writes to a column the planner never reads → Compose never enables.

### 4. Cost gating + edition boundary

- The live-cost readout is **gated behind `hasCredits()`** (`frontend/src/lib/edition.ts`) — never renders in community/business.
- To keep the core tab **ee-import-free**, `perPanelCost` (1) + `assemblyCost` (4) are **constants surfaced via `sheet-tab-adapter.ts`** (core), not the ee `useModelCredits` hook.

### 5. Preset labeling (persisted, no worker change)

- Add `presetId?: SheetPresetId` to **`SheetFlavour`** (`reference-sheet/types.ts`) AND to the **`flavour` Zod schema** (`reference-sheet.schema.ts`) — the only place it would otherwise be stripped. `api.ts` already forwards the full flavour and the worker stores it **verbatim**, so it round-trips with **no worker change**.
- The result + grid + lightbox label via `PRESET_LABELS[flavour.presetId]`, falling back to `${type} · ${skin}` for legacy/non-preset sheets. Do **not** filter the grid by `source`.

### 6. Style controls (secondary)

In the character preset UI, a compact "Style" row keeps `skin` (studio default; cinematic/blueprint/illustrated) + `aspect` + the Title-metadata / Panel-labels toggles. Presets set defaults (studio/landscape); user can override. *(Object/location keep their full existing chip UI.)*

## Files touched

**Shared (`packages/shared/src/reference-sheet/`)** — rebuild `dist` after (auto via frontend `pre*` hooks; a mid-session shared edit needs a manual `npm -w @nodaro/shared run build`).
- `presets.ts` *(new)* — `SHEET_PRESETS`, `presetEntries`, `PRESET_LABELS`, `SheetPresetId`, à-la-carte board list.
- `cost.ts` *(new)* — `estimateSheetCost()` (try/catch MAX_PANELS).
- `types.ts` — add `presetId?: SheetPresetId` to `SheetFlavour`.
- `index.ts` — export the new modules.
- `../entity-prompts.ts` — `headAngles += "back"` (append).

**Backend**
- `routes/reference-sheet.schema.ts` — add `presetId: z.enum(["studio-main","studio-extended"]).optional()` to `flavour`. *(No worker / no `generate-character-asset.ts` change.)*

**Frontend (`components/editor/`)**
- `reference-sheet/reference-sheet-tab.tsx` — character branch: preset cards + à-la-carte toggles (cap-disabled past 24) + Style row + `hasCredits()`-gated cost (via `estimateSheetCost` + prepared-key tracking) + **① Prepare / ② Compose**; non-character branch: existing chip UI unchanged; `MultiImageLightbox` (result + existing sheets, motion→`kind:"video"`) with the `actions` Copy-URL slot; Copy-URL on result + tiles; `PRESET_LABELS`.
- `reference-sheet/sheet-tab-adapter.ts` — expose `perPanelCost` (1) + `assemblyCost` (4).
- `ui/multi-image-lightbox.tsx` — optional `actions?: (item) => ReactNode` slot (default none).

**No new credit SKUs.**

## Testing

- **Shared**: `SHEET_PRESETS` panel-set tests (Main → 7 ordered variants; Extended → 15); `estimateSheetCost` (present/missing combos; all-present → prepareCost 0; **MAX_PANELS overflow → `overflow:true`, no throw**); `entries` resolution (curated subset, not default-4); `headAngles` contains `back` and `slice(0,4)` unchanged.
- **Backend**: route accepts `flavour.presetId`; pricing/credit-id unchanged.
- **Frontend**: character tab — preset selection updates cost; board toggles disable at the 24 cap; **Compose disabled until prepared-key merge clears `missing`** (column-keyed); Copy-URL writes clipboard; lightbox opens with ←/→, renders Copy-URL action (stopPropagation), motion sheet as video; cost readout absent when `!hasCredits()`; **object/location tab unchanged** (still chips).

## Out of scope (now)

- Object/Location presets (the `entries` mechanism supports them; a follow-up).
- Motion (video) sheet generation — unchanged (but motion sheets must display correctly in the new lightbox).
- Per-provider dynamic panel pricing (constant `nano-banana = 1`).

## Resolved

- Curated subsets via the existing **`entries`** field (verified through planner + both stages + Zod).
- Single catalog edit `headAngles += "back"` (head `back` prompt already exists; index-7 append keeps tests green).
- Carrier `type` per preset; `presetId` persists via `flavour` (no worker change).
- Panel cap + prepared-key column-merge close the two Pass-2 blockers.
