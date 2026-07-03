# Searchable Model Picker (`ModelSearchSelect`)

## Problem

The image/video model dropdowns are very long. A user has no way to filter them.
They want to type any of:

- a **model name** — `banana`
- a **company / provider** — `google`
- an **aspect ratio** — `16:9`
- a **resolution** — `2K`
- a **video size** — `720`
- a **video clip length** — `8s`

…and have the list narrow to matching models. The search must be available in
**both** places a model is picked:

1. the **bottom-of-node dropdown** (the quick toolbar on the node card), and
2. the **configuration-panel dropdown** (right sidebar).

## Decision

Build **one reusable searchable picker** — `<ModelSearchSelect>` — and drop it in
wherever a model is selected. The list it shows (and therefore what is matchable)
is driven by the context it is opened in: an image node shows only image-gen
models, an image-to-video node shows only i2v models, etc. This is the
"depends where we open it" behavior — it falls out naturally because the picker
is fed the same per-context `*_MODELS` array the dropdown already uses, and the
search tokens are derived from each model's own metadata.

**Scope of this pass:** the universal component, wired into the **image + video
editor selectors only**. Audio / Suno / TTS / voice, the LLM picker, and the
published-app (presentation) runner are deferred — they become near one-line
swaps once the component exists. They are listed below so they are not forgotten.

## Approach

**Popover + cmdk `Command` combobox** (Approach A), replacing the inner shadcn
`<Select>`. Rationale:

- `cmdk` (`components/ui/command.tsx`) and a working combobox reference
  (`components/user-filter.tsx`) already exist in the repo.
- cmdk gives a real search input + keyboard navigation for free.
- The rejected alternative — injecting a filter `<input>` into the Radix
  `<SelectContent>` — fights Radix Select's built-in typeahead and is fragile.
  Per CLAUDE.md ("prefer the most robust, future-proof solution"), we avoid it.

## Components

### 1. `frontend/src/lib/model-search.ts` (pure, no React → unit-testable)

The "brain." Builds a search haystack per model and matches queries against it.

```ts
// Build one lowercased haystack string for a model id.
// Sources (all already used to render the real dropdowns, so search can never
// claim a capability the model doesn't actually offer in the UI):
//   - name:        label + value(id) + desc
//   - company:     getModel(id)?.family  -- with a base-id fallback when the
//                  exact id isn't in the catalog (veo3.1 / veo3_lite / grok /
//                  ltx-*): strip mode/tier suffixes (.1, _lite, _fast, -fast,
//                  -i2v, -t2v, -pro) and retry getModel(base), so "google"
//                  still matches every VEO variant. (from @nodaro/shared)
//   - aspect:      IMAGE_ASPECT_RATIOS[id] ?? VIDEO_ASPECT_RATIOS[id]   (values)
//   - resolution:  IMAGE_RESOLUTION_OPTIONS[id] ?? VIDEO_RESOLUTION_OPTIONS[id]
//   - duration:    VIDEO_DURATION_OPTIONS[id]      (formatted "8s")
// Memoized in a module-level Map keyed by id.
export function modelSearchHaystack(value: string, label: string, desc?: string): string

// Multi-token AND match, case-insensitive, substring per token.
// query "banana 4k"  -> haystack must contain "banana" AND "4k"
// Empty / whitespace query -> matches everything (returns true).
export function modelMatchesQuery(haystack: string, query: string): boolean
```

Matching rules:

- **Case-insensitive.** Haystack and query are lowercased.
- **Substring per token.** `720` matches `720p`; `2k` matches `2k`/`2K`; `16:9`
  matches `16:9`.
- **AND across whitespace-separated tokens.** Every token must be present.
- **Order preserved.** Filtering never reorders the curated model list (so we use
  `shouldFilter={false}` on `Command` and filter ourselves, rather than cmdk's
  fuzzy-score reordering).

### 2. `frontend/src/components/editor/config-panels/model-search-select.tsx`

```tsx
type ModelOption = { value: string; label: string; desc?: string; tooltip?: string }

interface ModelSearchSelectProps {
  value: string
  onChange: (value: string) => void
  options: readonly ModelOption[]
  // Optional controlled-open plumbing so the canvas quick toolbars can keep
  // their openCount / deferred-close behavior. Falls back to internal state.
  open?: boolean
  onOpenChange?: (open: boolean) => void
  triggerClassName?: string   // reuse ghostTriggerClass / ghostPopoverTriggerClass
  contentClassName?: string   // e.g. "z-[9999]" — required for pickers mounted
                              // inside a modal (face generator) so the popover
                              // isn't occluded by the dialog
  align?: "start" | "center" | "end"
  ariaLabel?: string
  placeholder?: string        // search placeholder; sensible default
  triggerIcon?: ReactNode     // e.g. the Sparkles icon used in the toolbars
}
```

Renders:

- `<Popover>` (controlled-open aware) →
- `<PopoverTrigger>` a button styled like today's `SelectTrigger` showing the
  current model's label (`options.find(o => o.value === value)?.label ?? value`)
  + a small chevron; accepts `triggerClassName` for the ghost toolbar styling and
  `triggerIcon` for the prefix icon.
- `<PopoverContent className={cn("w-[300px] p-0", contentClassName)}>` (wider
  than narrow ghost triggers; `contentClassName` merges in e.g. `z-[9999]`) →
- `<Command shouldFilter={false}>` →
  - controlled `<CommandInput value={query} onValueChange={setQuery}
    placeholder="Search — name, company, 16:9, 2K, 720, 8s…">`
  - `<CommandList>` of `ModelCommandItem` for the filtered options
  - inline empty state when `filtered.length === 0` (we render it ourselves since
    `shouldFilter={false}` disables cmdk's `CommandEmpty` counting).
- Selecting a row calls `onChange(value)` and closes the popover.

### 3. `ModelCommandItem` (in the same file)

A **fresh reimplementation** of `ModelSelectOption`'s look — **not** a reuse of
`SelectItemWithMeta`, which is a Radix `Select.Item` and throws outside a
`<Select>` context. It renders a `<CommandItem>` that visually matches today:

- `useModelCredits(value)` + `MODEL_CREDIT_RANGES[value]` → the credit badge
  (range `"3-18 CR"` or single `"5 CR"`; omitted when `0`, i.e. community
  edition). Same logic as `ModelSelectOption`.
- label + right-aligned badge, `desc` on a muted second line, right-side tooltip
  (`tooltip ?? desc`), and a leading `Check` when the row is the selected value.

## Rollout — image + video editor selectors (this pass)

| Surface | File | List | Notes |
|---|---|---|---|
| Bottom toolbar | `nodes/generate-image-quick-toolbar.tsx` | `IMAGE_GEN_MODELS` | default + compact modes; preserve `handleOpenChange`/`openCount`/deferred-close via `open`/`onOpenChange` props; keep the "N models" chip when multi-provider is active |
| Bottom toolbar | `nodes/generate-video-quick-toolbar.tsx` | `VIDEO_GEN_MODELS` | default + compact; same open plumbing |
| Config (multi) | `config-panels/image-configs.tsx` — GenerateImage | `IMAGE_GEN_MODELS` | refactor `MultiProviderPicker` to use `ModelSearchSelect` per row |
| Config | `config-panels/image-configs.tsx` — ModifyImage | `MODIFY_IMAGE_MODELS` | inside `MappableField` |
| Config | `config-panels/video-configs.tsx` — ImageToVideo | `VIDEO_I2V_MODELS` | |
| Config | `config-panels/video-configs.tsx` — TextToVideo | `VIDEO_T2V_MODELS` | |
| Config | `config-panels/video-configs.tsx` — GenerateVideo | `VIDEO_GEN_MODELS` | |
| Config | `config-panels/video-configs.tsx` — VideoToVideo | `VIDEO_V2V_MODELS` | |
| Config | `config-panels/video-configs.tsx` — MotionTransfer | `MOTION_TRANSFER_MODELS` | currently hardcoded `SelectItem`s; the list's values+labels match exactly, so the swap is behavior-preserving and adds badge/desc for free |
| Config | `config-panels/entity-configs.tsx` — Face Generator | `IMAGE_GEN_MODELS` | **inside a modal** → pass `contentClassName="z-[9999]"` (matches today's `SelectContent`) |
| Config | `config-panels/kling3-studio-config.tsx` | `VIDEO_I2V_MODELS` | verify exact list/line during impl |
| Config | `config-panels/generative-configs.tsx` — Generative Scene | local `IMAGE_MODEL_OPTIONS` / `VIDEO_MODEL_OPTIONS` | two selectors; each has an **"Auto" sentinel** first option (caller maps `auto`→`undefined`) and plain rendering — pass Auto as a normal option with no metadata |

`MappableField` wrappers are untouched — we only swap the inner `<Select>`.

### `MultiProviderPicker` change

Only one production caller (generate-image). Keep the card-per-selected-provider
layout and the "Add another model" / remove buttons. Replace each row's inner
`<Select>…<SelectContent>{renderItems(p)}…` with
`<ModelSearchSelect options={…} value={p} onChange={…} />`. The `renderItems`
prop collapses into a single `options` prop, **but the per-row filtering it
encodes must move into the component**: each row shows `current value + providers
not already selected` (today: `options.filter(m => m.value === current ||
!selected.includes(m.value))`). Preserve:

- **per-row "hide already-selected" filtering** (compute inside the picker from
  `providers` + the row's value),
- **`renderHint`** (the `ModelDescriptionHint` under each card) — unchanged,
- **`labelOf`** for the remove-button aria-labels (or derive from `options`).

Update the existing tests `__tests__/multi-provider-picker.test.tsx` and the
`MultiProviderPicker` mock in `__tests__/provider-snap.test.tsx` to the new API.

### Bottom-toolbar open/close plumbing

The quick toolbars track `openCount` and defer close by one macrotask
(`setTimeout(…, 0)`) so the toolbar doesn't unpin mid-pick. `ModelSearchSelect`
exposes `open` / `onOpenChange`, so the toolbar passes its existing
`handleOpenChange` unchanged. Ghost styling is passed via `triggerClassName`
(`ghostTriggerClass` default mode, `ghostPopoverTriggerClass` compact mode), and
the `Sparkles` prefix via `triggerIcon`.

## Deferred (component is universal → later one-line swaps)

- **Audio** (9 sites): TTS, Lip Sync, Suno generate/cover/extend/mashup/add-track.
- **LLM** `LlmModelSelect` (8 sites): needs `CommandGroup` for the
  economy/standard/premium tiers; otherwise the same swap.
- **Presentation / app runner** (3 sites in `presentation/config-field-renderer.tsx`):
  uses an `OptionSelect` wrapper.

## Drift resistance

Search tokens are derived from the same `MODEL_CATALOG` (`getModel`) and
per-provider option maps (`IMAGE_ASPECT_RATIOS`, `VIDEO_RESOLUTION_OPTIONS`,
`VIDEO_DURATION_OPTIONS`, …) that already drive the dropdowns. Adding a new model
makes it searchable by its real attributes automatically — there is no separate
search registry to keep in sync.

## Testing

- Unit tests for `model-search.ts`:
  - name: `banana` → `nano-banana*`; `flux` → flux family.
  - company: `google` → imagen/nano-banana/veo/gemini (whatever has `family:"Google"`).
  - aspect: `16:9` → models listing 16:9; `21:9` → only ultra-wide models.
  - resolution: `2k` → models with 2K; `4k` → 4K-capable.
  - video size: `720` → models with `720p`.
  - video length: `8s` → models whose durations include 8.
  - multi-token AND: `banana 4k`; case-insensitivity: `GOOGLE` == `google`.
  - **base-id family fallback:** `google` also matches `veo3.1` / `veo3_lite`
    (ids not in the catalog) via suffix-stripping.
  - empty query → returns all, order preserved.
- Update `multi-provider-picker.test.tsx` + the mock in `provider-snap.test.tsx`
  to the refactored API; keep them green.
- Manual check: **compact-mode bottom toolbar** opens the model combobox as a
  Popover nested inside the compact Popover (Radix supports it, but verify focus
  + the deferred-close keeps the toolbar pinned).
- `npx tsc --noEmit` in `frontend/` and run the affected vitest files before commit.

## Verified against code (audit, 2026-05-31)

- `command.tsx` spreads `...props` to `CommandPrimitive` and `CommandItem` to
  `CommandPrimitive.Item` → `shouldFilter={false}` + custom filter + controlled
  `CommandInput` all work. `CommandList` is `max-h-[300px]` (scrolls).
- Catalog metadata present for the main models (family / aspectRatios /
  resolutions / durations) → every required query type resolves.
- `MultiProviderPicker`: one production caller (generate-image); generate-video
  config is a plain single `<Select>` over `VIDEO_GEN_MODELS`.
- Motion-transfer is hardcoded `<SelectItem>`s whose values+labels equal
  `MOTION_TRANSFER_MODELS` → swap is behavior-preserving.
- `video-retake` toolbar exposes a single locked model → excluded.
- Face-generator selector uses `position="popper" z-[9999]` inside a modal →
  `contentClassName` is required.

## Out of scope

- Changing the model lists / catalog content.
- Audio, LLM, and presentation wiring (this pass).
- Any backend change.
- The `video-retake` toolbar (single locked model — search adds nothing).

## Edge cases / notes

- A `value` absent from every per-provider map (e.g. the generative-configs
  "Auto" sentinel) → haystack falls back to label + id + desc (+ family if the
  id resolves in the catalog). Still searchable by name; harmless.
- Company tokens use the base-id fallback (see `model-search.ts`) so aliased ids
  like `veo3.1` / `veo3_lite` still match their family. Genuinely catalog-less
  ids (spliced LTX) match by name/resolution only — acceptable.
- **Nested Popover (compact toolbar):** in compact mode the model combobox opens
  as a Popover inside the compact-settings Popover. Radix supports this; the
  deferred-close (`setTimeout(…,0)`) must still fire so the toolbar stays pinned.
- `useModelCredits` is gated behind `hasCredits()` and returns `0` in community
  builds — the badge is omitted then, exactly as `ModelSelectOption` does today.
