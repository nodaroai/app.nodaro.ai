# Picker Catalogs as a Public Contract — Design

**Date:** 2026-06-05
**Status:** Implementing (branch `feat/picker-catalogs-public-contract`)

## Goal

Let studio and other external apps consume the parameter-picker **catalogs** (options, prompt fragments, categories, i18n) as a **stable contract**, without coupling to app-internal code — by shipping them as **data in `@nodaro/shared`**, not behind API/SDK endpoints.

## Decision: library, not API

The test is **"server state, or static config?"**

- **`@nodaro/shared` (library)** → pure/static/deterministic: catalogs, prompt assembly, types. Nothing to round-trip a server for.
- **`@nodaro/client` SDK + `/v1` API** → server *state*: jobs, credits, uploads, workflows, live model pricing.

Pickers are static config + pure functions → they belong in the library. An API for catalogs only earns its place if one of these appears (none apply today): **(1)** non-JS consumers (`npm install` impossible), **(2)** server-driven catalogs (plan/edition gating, A/B, personalization), **(3)** guaranteed live-parity without consumers upgrading. If any shows up, add a read-only `GET /v1/catalogs` that is a thin **projection of the same package** — one source of truth, two surfaces.

## What a picker is

A catalog entry `{ id, label, category?, description?, promptHint }` + a prompt-fragment function (`get*PromptHint` / the unified `getParameterPromptHint`) + an **app-only** React preview. The first two are pure data/logic; only the preview is app UI.

## What already exists (verified)

- **Catalogs with `promptHint` on every entry** — ~25+ single-dim catalogs in `packages/shared/src/*.ts` (mood, lens, setting, pose, lighting, color-look, atmosphere, style, era, photo-genre, backdrop, aesthetic, render-quality, transitions, character-fx, materials, animals, vehicles, weapons, furniture, held-prop, action-fx, loop-subject, …), plus multi-dim (person, styling, framing, temporal, exposure-settings, music-genre).
- **Prompt assembly** — `getParameterPromptHint(node, ctx?)` (single source of truth, used by both frontend executor and backend) + per-catalog `get*PromptHint(id)` / `build*Hints(value)`.
- **Value resolution** — `getParameterValue` + `PARAMETER_NODE_TYPES` (`parameter-node-value.ts`).
- **i18n — already complete in `shared`.** `packages/shared/src/i18n/` carries per-catalog, per-locale bundles across **12 locales** (`en, es, fr, de, pt-BR, ru, hi, ja, ko, zh-CN, he, ar`); `I18nCatalogId` is the typed key. Localized labels resolve via the catalog's `catalogId`. **Nothing to add here** — the contract just needs to expose `catalogId` so consumers can localize.

## What's missing (this work adds)

1. **No discoverable aggregate.** The picker catalogs are ~30 separate exports with no single, typed "these are the pickers" surface. A consumer has to know every export name. → Add a `PICKER_CATALOGS` registry.
2. **Visual metadata lives as React, not data.** The picker visuals are bespoke per-catalog React preview components in the *frontend* registry (`SettingPreview`, `MoodEmoji`, `ColorLookPreview`, `PoseIcon`, …) — not catalog fields. → Add an optional `icon?` field to the contract; populate the **data-native** ones; document the rest.

## The contract (added to `@nodaro/shared`)

```ts
interface PickerOption {
  id: string
  label: string                 // English canonical; localize via catalogId + i18n
  description?: string
  category?: string             // group id (matches categoryOrder/Labels)
  promptHint: string            // the clause this option contributes
  icon?: string                 // data-native visual only (emoji / swatch); see below
}

interface PickerCatalog {
  nodeType: string              // e.g. "mood"
  label: string                 // e.g. "Mood"
  catalogId: I18nCatalogId      // i18n key for localized labels
  kind: "single" | "multi"
  valueField?: string           // node-data field a single picker writes
  defaultValue?: string
  categoryOrder?: readonly string[]
  categoryLabels?: Readonly<Record<string, string>>
  options?: readonly PickerOption[]   // single-dim
  fields?: readonly string[]          // multi-dim dimension keys
  dimensions?: readonly { field: string; label: string; options: readonly PickerOption[] }[] // multi-dim, self-describing
}

export const PICKER_CATALOGS: readonly PickerCatalog[]
export function getPickerCatalog(nodeTypeOrCatalogId: string): PickerCatalog | undefined
export function listPickerCatalogs(): readonly PickerCatalog[]
```

Exported from the package root (`@nodaro/shared`). Options **reference the existing catalog arrays** (no data duplication).

**Drift guard (invariant + test, not "remember to update"):** a frontend test asserts `PICKER_CATALOGS` stays in lock-step with the frontend picker registry (`SINGLE_PICKERS` / `MULTI_PICKERS`) — same nodeTypes, catalogIds, valueFields, defaults, category order/labels, and option ids. If the app adds/edits a picker and forgets the registry, the test fails.

## Visual metadata — the honest split

Investigation showed the visuals are **not** simple liftable data; they're custom React components. So:

- **Data-native visuals (lift now):** emoji (`MoodEmoji`, animal/vehicle/weapon icons) and swatches/colors → expose via `icon?`. Cheap, high-value.
- **Component-rendered visuals (NOT data):** `SettingPreview`, `ColorLookPreview`, `AtmospherePreview`, `LensPreview`, etc. render generated SVG/graphics. There is nothing to "lift." Consumers **render their own** visual from `label`/`category` — which is exactly what studio wants (it rebuilds its own pickers to match [redacted-reference]).
- **Rich-preview parity for third parties (future, only on demand):** render each preview once → static SVG/PNG on R2 → add `thumbnailUrl` to the catalog data. This turns component-visuals into pure data for everyone, with **no** React shipped. This is the right path **instead of** shipping styled components (drags the design system + contaminates the backend, which also imports `shared`) **or** a headless kit (gives behavior, not the pretty tile).

## Non-goals (v1)

- No `/v1/catalogs` API (add only if non-JS / runtime / parity demand appears).
- No styled component export; no headless React kit.
- No full visual parity (thumbnail-baking deferred).

## Phasing

- **v1 (this change):** `PICKER_CATALOGS` registry + `icon?` field (data-native populated) + drift test + i18n exposure. Ship to `dev`, deploy to `main`.
- **Phase 2:** frontend `SINGLE_PICKERS`/`MULTI_PICKERS` *derive* from `PICKER_CATALOGS` (collapse the duplication the drift test currently guards); add `@nodaro/shared/catalogs` subpath export for a clean public boundary; register the `@nodaro` npm scope + publish; studio un-vendors (`npm install` instead of `file:`).
- **Phase 3 (on demand):** thumbnail-baking for rich visual parity; optional headless kit; optional read-only `/v1/catalogs` projection for non-JS consumers.

## Consumer usage (studio)

```ts
import { PICKER_CATALOGS, getParameterPromptHint } from "@nodaro/shared"
import { client } from "@/lib/nodaro"

const mood = PICKER_CATALOGS.find((c) => c.nodeType === "mood")!
// render your own tile-grid from mood.options (+ mood.categoryOrder/Labels, localized via mood.catalogId)
const clause = getParameterPromptHint({ type: "mood", mood: selectedId }) // or selectedOption.promptHint
const { jobIds } = await client.nodes.run("generate-image", { prompt: [base, clause].filter(Boolean).join(", ") })
```
