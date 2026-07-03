# Character Studio Redesign — Design Spec

**Date:** 2026-06-13
**Status:** Approved (design); pending implementation plan
**Scope:** Character entity only. Location / Object / Animal(Creature) adopt the foundation in a later pass.

---

## 1. Goal

Restructure the Character Studio around a **resource → identity → output** mental model, and make the **Voice** page actually functional (today it stores a voice that is consumed nowhere). Concretely:

1. Introduce a **Resources** group (References, Pickers, LoRA) as the inputs a character is built from.
2. Split today's overloaded **Appearance** tab into **Profile** (who the character is) and **Appearance** (head/body angles + lighting).
3. Keep **Visuals** (Expressions, Poses, Motions, Sheet) unchanged.
4. Rework **Voice** into a real resource: browse + clone + design + reliable preview, an in-studio **Talk** panel, and **downstream auto-wiring** into TTS/lip-sync nodes.
5. Build the nav as a **reusable, config-driven foundation** so the other three entity studios can adopt the same shell later.

### Non-goals (this pass)
- Location / Object / Creature studio migration (foundation is built reuse-ready; only character is wired).
- Multiple LoRAs per character (single LoRA, matching current schema).
- Creature/location voice auto-wiring (trivial follow-on once the character pattern lands).

### Checklists that do NOT apply (avoid over-application)
- **New Node Registration** and **Parameter Picker Registration (5 registries)** in CLAUDE.md apply to *canvas node types*. The studio pages and the Person/Wardrobe pickers here are **in-studio UI** that read/write the `characters` row — they are **not** canvas nodes and must not be registered as such.
- **Provider Enum Sync (13 steps)** applies to image/video model enums. No new image/video/voice providers are added here.

---

## 2. Current State (summary)

- Entry: `frontend/src/components/editor/character-studio/character-studio-modal.tsx` — full-screen modal, sidebar nav hardcoded inline, 7 tabs in 3 groups (Identity: Appearance · Visuals: Expressions/Poses/Motions/Sheet · Character: Voice/Personality).
- All tabs read/write a single staged state via `use-character-studio.ts` (debounced 600ms auto-save to `/v1/characters`; dirty-field tracking preserves worker auto-appends).
- `appearance-tab.tsx` is overloaded: identity form + portrait generate/approve + reference photos + person picker + seed prompt + head/body angle grids + lighting grid.
- LoRA training UI (`training-section.tsx`) lives only in the **legacy** `character-page-modal.tsx`, not in the new studio.
- Voice (`voice-tab.tsx`) renders `VoiceBrowser` with `showCustomVoices=false` + a traits textarea. **`character.voice` is consumed nowhere** in generation (confirmed via repo-wide grep) — pure dead metadata.
- All voice creation primitives already exist as backend routes + `lib/api.ts` functions + React Query hooks (see §7).

---

## 3. Target Navigation Structure

```
RESOURCES
  • References      (📷)  — reference-photo uploader (relocated from Appearance)
  • Pickers         (🎚)  — Person attributes + Wardrobe (structured, auto-injected)
  • LoRA            (🧬)  — training UI (relocated from legacy modal + reworked) [Cloud only]
IDENTITY
  • Profile         (👤)  — name, portrait+approval, description, gender, style, base outfit, provider, canonical desc, seed prompt
  • Appearance      (🧭)  — head angles, body angles, lighting
VISUALS
  • Expressions     (😄)  — unchanged
  • Poses           (🧍)  — unchanged
  • Motions         (🏃)  — unchanged
  • Sheet           (📋)  — unchanged
CHARACTER
  • Voice           (🎤)  — reworked (browse/clone/design + Talk + auto-wire)
  • Personality     (🧠)  — unchanged
```

LoRA hides when `!hasCredits()` (Cloud-only), like today's training section.

---

## 4. Reusable Foundation (config-driven nav)

**Problem today:** the sidebar and tab-routing are hardcoded inside `character-studio-modal.tsx`. Each future entity would re-implement it.

**Design:** extract a generic **`StudioShell`** + a declarative **nav config**.

### 4.1 Types — `frontend/src/components/editor/studio-shell/types.ts`
```ts
export interface StudioPageProps<S = unknown> { state: S; jobs: unknown }
export interface StudioPageDef<S = unknown> {
  key: string
  label: string
  icon: ReactNode
  Component: ComponentType<StudioPageProps<S>>
  badge?: (state: S) => { kind: "count" | "check"; value?: number } | null
  visible?: (ctx: { hasCredits: boolean }) => boolean   // e.g. LoRA → hasCredits
}
export interface StudioGroupDef<S = unknown> { label: string; pages: StudioPageDef<S>[] }
export interface StudioNavConfig<S = unknown> { groups: StudioGroupDef<S>[] }
```

### 4.2 `StudioShell` — `frontend/src/components/editor/studio-shell/studio-shell.tsx`
Generic component that renders: header slot, the sidebar (groups → pages, badges, active highlight, `visible()` filtering), and the active page's `Component` with `{ state, jobs }`. Owns only `activePageKey` UI state. **No entity-specific logic.**

### 4.3 Character config — `frontend/src/components/editor/character-studio/character-nav-config.tsx`
Exports `CHARACTER_STUDIO_NAV: StudioNavConfig<CharacterStudioState>` listing the 10 pages above, mapping each to its page component + badge rule.

### 4.4 `character-studio-modal.tsx` becomes thin
Keeps: open/close, `use-character-studio()` + `use-character-studio-jobs()`, the header (portrait/name/counts/save indicator/share), and renders `<StudioShell config={CHARACTER_STUDIO_NAV} state={state} jobs={jobs} header={…} />`.

**Reuse path (not built now):** a creature/location/object modal supplies its own `*_STUDIO_NAV` + state hook and reuses `StudioShell` verbatim.

---

## 5. Resources Group

### 5.1 References — `character-studio/pages/references-page.tsx`
Thin page wrapping the existing `reference-photos-block.tsx` (7 slots: Face / 3⁄4 L / Profile L / Profile R / 3⁄4 R / Body / +other) and its `reference-photo-routing.ts`. **Behavior unchanged**; only relocated out of Appearance. Reads/writes `state.staged.referencePhotos` exactly as today. Per-asset routing (`routePhotosForAsset`) and `realLifeRefsByVariant` are untouched.

### 5.2 Pickers — `character-studio/pages/pickers-page.tsx`
Two structured pickers, **stored on the character and auto-injected at generation** (no more seed-prompt text mutation).

**Person picker:** reuse `PersonPickerDetailed` (backed by `packages/shared/src/person.ts`, 20 dimensions). Change: instead of appending `buildPersonHints()` text to `seedPrompt`, write the structured `PersonValue` to a new `state.staged.person` field.

**Wardrobe picker (net-new):** new catalog `packages/shared/src/wardrobe.ts` modeled on `person.ts`, plus a `WardrobePicker` component modeled on `PersonPickerDetailed`. Writes structured `WardrobeValue` to `state.staged.wardrobe`.

Proposed wardrobe dimensions (single-pick unless noted), each entry carrying a `promptHint`:
| Dimension | Examples |
|-----------|----------|
| archetype | casual, business, formal, streetwear, athletic, fantasy, sci-fi, historical, uniform, swimwear, loungewear |
| top | t-shirt, blouse, hoodie, button-down, tank, sweater, armor-chestplate, kimono-top |
| bottom | jeans, trousers, skirt, shorts, leggings, cargo, kilt |
| outerwear | none, leather jacket, blazer, trench coat, parka, cloak, cardigan |
| footwear | sneakers, boots, heels, sandals, dress shoes, barefoot |
| headwear (multi) | none, cap, beanie, hat, hood, crown, helmet |
| accessories (multi) | glasses, scarf, gloves, jewelry, belt, bag, watch |
| color-palette | neutral, monochrome black, earth tones, pastel, jewel tones, neon, all-white |
| material | cotton, denim, leather, silk, wool, latex, metal, linen |
| era | contemporary, 1920s, 1950s, 1980s, Victorian, medieval, futuristic |

`buildWardrobeHints(value): string[]` mirrors `buildPersonHints` (multi-pick joins, "none" suppresses output). Export `WARDROBE_DIMENSION_ORDER`, `WARDROBE_CATEGORY_LABELS`, `getWardrobePromptHint` from `packages/shared`.

`baseOutfit` (free text, on Profile) is **retained** as a free-form addendum and combined with the structured wardrobe hint at generation.

### 5.3 LoRA — `character-studio/pages/lora-page.tsx` *(Cloud only)*
Relocate `training-section.tsx` into a studio page and rework UX:
- **Training-image curation:** a selectable grid drawing candidates from `sourceImageUrl` + `referencePhotos` + `angles`/`bodyAngles` + `expressions` + `poses` (dedup by URL). User checks which to include (default: all, min 4). Show count + min-4 gate.
- **Status:** clear badge (untrained/queued/training/succeeded/failed) + progress (8s poll) + trigger word display.
- **Actions:** Start / Re-train / Remove.
- Backend `character-training` routes unchanged. Single LoRA per character (`lora_replicate_version`); multi-LoRA explicitly deferred.
- Page `visible: ({hasCredits}) => hasCredits`.

---

## 6. Identity Group

### 6.1 Profile — `character-studio/pages/profile-page.tsx`
Lifts the identity + portrait portions out of `appearance-tab.tsx`:
- Portrait block: `PortraitCandidateGrid` (multi-candidate generate), approve flow (`approvePortrait` → sets `sourceImageUrl` + returns `canonicalDescription`), `PreviousCandidatesStrip` (history), and the self-contained polling logic currently in `appearance-tab.tsx`.
- Form fields: name, description, gender, style, base outfit, provider, `CanonicalDescriptionExpander`, `SeedPromptTextarea`.
- All read/write the same `state.staged` fields and `patch()` — no auto-save changes.
- The Person picker's old inline "apply to seed prompt" affordance is removed here (moved to structured Pickers page §5.2).

### 6.2 Appearance — `character-studio/pages/appearance-page.tsx`
The three turnaround grids lifted verbatim: Head Angles (`arrayField:"angles"`, 5 presets), Body Angles (`arrayField:"bodyAngles"`, 6 presets), Lighting (`arrayField:"lightingVariations"`, 3 presets) — all instances of the shared `ImageAssetTab`. No behavior change; only relocation. Reference routing for these targets (`headAngles`/`bodyAngles`) still applies.

---

## 7. Character → Voice (the rework)

### 7.1 What already exists (reused, no new backend)
| Capability | Route | api.ts | hook |
|-----------|-------|--------|------|
| Premade voices | `GET /v1/voices` | `getVoices` | `useVoices` |
| Library search | `GET /v1/voices/library` | `searchVoiceLibrary` | `useVoiceLibrary` |
| List custom clones | `GET /v1/voice-clones` | `getVoiceClones` | `useVoiceClones` |
| Clone from audio | `POST /v1/voice-clones` (multipart) / `/from-url` | `createVoiceClone` | `useCreateVoiceClone` |
| Delete clone | `DELETE /v1/voice-clones/:id` | `deleteVoiceClone` | `useDeleteVoiceClone` |
| Design from text | `POST /v1/voice-design` | `voiceDesignApi` | — |
| Preview / Talk (audio) | `POST /v1/text-to-speech` | `textToSpeech` (api.ts:2566) | — |
| Talk (lip-sync video) | `POST /v1/lip-sync` | `lipSyncApi` (api.ts:3820) | — |

### 7.2 Studio voice page — `character-studio/pages/voice-page.tsx`
Three source modes + selected card + Talk panel (see approved voice-page mockup):

- **Browse:** `VoiceBrowser` with **`showCustomVoices=true`** (enables the previously-hidden "My Voices" clones tab). On select → `state.patch({ voice: { voiceId, voiceName, traits, voiceType, previewUrl, ttsProvider } })`.
- **Clone from audio:** record/upload an audio sample → `useCreateVoiceClone({ name, file })` → on success, auto-select the new clone as the character's voice. Surface clone list with delete.
- **Design from text:** `voiceDescription` + sample `text` (⚠️ `/v1/voice-design` requires `text` length **100–1000 chars** — the audition input must be ≥100 chars or the route 400s) → `voiceDesignApi` → poll job → audition the generated audio.
  - **⚠️ Persisting a designed voice is NET-NEW backend work, not reuse.** Audited (`backend/src/routes/voice-design.ts`, `backend/src/providers/elevenlabs/voice-design.ts`, `workers/handlers/audio-ai.ts`): voice-design only enqueues a job returning a one-off MP3 + an **ephemeral** ElevenLabs preview token (`generated_voice_id` from `/v1/text-to-voice/design`) that is NOT usable for later TTS. To make a designed voice reusable, a follow-up ElevenLabs **create-voice-from-preview** call is required. Plan a new `POST /v1/voice-clones/from-design` route that takes the preview token, calls create-voice-from-preview, and persists into the existing `voice_clones` table (reuse its persistence + R2 path; do NOT add a new table). **Highest-risk item — sequence last / behind a flag (§11).** Until it lands, Design mode is **audition-only** (generate + listen, no save).
- **Selected card:** voice name + type, **traits** textarea (`voice.traits`), play-sample (`previewUrl`), clear.
- **Talk panel:**
  - Text input ("what the character says").
  - **Speak** → `textToSpeech(text, voice.ttsProvider ?? default, voice.voiceId, { voiceType })` (real export `api.ts:2566` — the spec previously mis-named it `textToSpeechApi`) → poll → play audio. Always available when a voice is set.
  - **Speak + lip-sync portrait** → TTS, then `/v1/lip-sync` with `sourceImageUrl` + the TTS audio → poll → show video. **Gated** on `sourceImageUrl` present (CTA to Profile if missing), like Motions gating today. Credit cost surfaced on the button.
  - Reuse `use-character-studio-jobs` polling patterns for both.

### 7.3 Downstream auto-wiring (orchestrator)
In `backend/src/services/workflow-engine/input-resolver.ts`, following the existing Suno-persona precedent (`suno-voice` → `personaId`, ~line 1517) and **reconciling with existing entity routing**: a `character` node is a member of `ENTITY_NODE_TYPES` (`input-resolver.ts:952`), and `input-resolver.ts:1424-1430` ALREADY routes a `character → lip-sync` edge to `inputs.imageUrl = portrait`. The new logic sits inside / alongside that entity branch, not as an isolated new `if`.

**Only `text-to-speech` consumes a voice — never inject into `lip-sync`.** Audited fact: `lip-sync.ts:12-49` has **no `voice` field** (it takes `imageUrl`/`audioUrl`/`videoUrl`/`provider`), and its `provider` is a `LIP_SYNC_PROVIDERS` enum, NOT a TTS provider — so injecting `voice`/`ttsProvider` there is a no-op + a cross-enum clash. The realistic talking-character chain is **character → text-to-speech → lip-sync**: the TTS node receives the voice (below) and lip-sync consumes that TTS node's audio output, so the chain works end-to-end without touching lip-sync.

Inject for the TTS edge only, override-safe:
```ts
// within the srcType ∈ ENTITY_NODE_TYPES handling, guarded to character (extend to creature/location later)
if (srcType === "character" && connType === "text-to-speech") {
  const v = src.data.voice as CharacterVoice | undefined
  if (v?.voiceId && !inputs.voice) {
    inputs.voice = v.voiceId
    inputs.voiceType = v.voiceType ?? "premade"
    if (v.ttsProvider) inputs.provider = v.ttsProvider   // already a TTS_PROVIDERS member
  }
}
```
The existing `character → lip-sync → imageUrl` routing is left intact. Confirm the exact consumer node-type string (`"text-to-speech"`) against the node registry during implementation. Covered by a unit test (§10) asserting TTS injection + no-clobber, and explicitly NOT asserting any voice injection into lip-sync.

### 7.4 Personality — unchanged.

---

## 8. Data Model & Migrations

### 8.1 `characters` table (new migration, next available number)
Add two JSONB columns (nullable):
- `person jsonb` — structured `PersonValue`.
- `wardrobe jsonb` — structured `WardrobeValue`.

`voice jsonb` already exists (migration 110). Follow the migration rules in CLAUDE.md / memory: **do not renumber**; pick the next free number; `ON CONFLICT DO NOTHING` not relevant (column adds). RLS unaffected (column adds on an existing RLS'd table).

### 8.2 Backend `characters.ts`
- Extend `upsertCharacterBody` Zod with `person` and `wardrobe` (nullable optional objects; loose object schema validated against the catalog dimensions, mirroring how `voice` is typed).
- Add both to `SELECT_COLUMNS`, INSERT, UPDATE, and `toCamel` mapping.

### 8.3 Frontend types — `frontend/src/types/nodes.ts`
- Add to `CharacterNodeData`: `person?: PersonValue` and `wardrobe?: WardrobeValue` (import both value types from `@nodaro/shared`).
- **Widen `CharacterVoice`** — currently `{ voiceId, voiceName, traits }` at `nodes.ts:3387`; add optional `voiceType?: "premade" | "library" | "custom"`, `previewUrl?: string`, `ttsProvider?: TtsProvider`. The backend Zod (`characters.ts:106`) ALREADY accepts these six, but the frontend type rejects them — so §7.2's `state.patch({ voice: { …, voiceType, previewUrl, ttsProvider } })` and §7.3's `v.voiceType`/`v.ttsProvider` reads won't compile without this. Also pass the metadata through `voice-browser.tsx` / `voice-page.tsx` `onSelect`.
- ⚠️ Editing `CharacterNodeData` triggers the `gen:skills` regeneration gate — see §10.

### 8.4 Generation injection (server-side single source of truth)
Portrait + asset generation routes derive `buildPersonHints(person)` + `buildWardrobeHints(wardrobe)` server-side and combine into the prompt as:
```
<identity base> + buildPersonHints(person) + buildWardrobeHints(wardrobe) + baseOutfit + seedPrompt(free-form)
```
**Required plumbing (audited — not free today):**
- `generate-character-asset.ts:258` currently `SELECT`s only `source_image_url, canonical_description` → add `person, wardrobe` to that SELECT.
- `generate-character.ts` (portrait) reads `seedPrompt`/`description` from the **request body** and only `.select("id")` → also read `person`/`wardrobe`. Prefer fetching the row (true single source of truth) over trusting the body.
- Extend the prompt builders: `buildPortraitPrompt` (`character-prompts.ts:48`, today takes only `{ seedPrompt }`) and `buildVariantPrompt` (`generate-character-asset.ts:322`) to accept + append the derived hint fragments.

Frontend `ensureSaved()` already persists staged edits before generation, so the backend always reads current selections. The new Person/Wardrobe pickers write **only** structured fields — never `seedPrompt` — so `seedPrompt` is purely user-authored free text going forward.

**Legacy double-injection (known minor):** an older character may already have person-style hints baked into its `seedPrompt` text. If the user then sets structured `person`, both could describe the same trait. We do **not** auto-strip legacy `seedPrompt` (non-destructive). Risk is low and user-correctable; if it proves annoying, a follow-up can show a one-time "move to structured" nudge. Out of scope for this pass.

### 8.5 `@nodaro/shared`
- New `packages/shared/src/wardrobe.ts` (catalog + `WardrobeValue` + `buildWardrobeHints` + `WARDROBE_DIMENSION_ORDER` + `WARDROBE_CATEGORY_LABELS` + `getWardrobePromptHint`).
- Export all from `packages/shared/src/index.ts` **before** `nodes.ts`/`characters.ts` import `WardrobeValue`. Build order matters: backend imports `@nodaro/shared` via workspace symlink with explicit `.js` extensions (ESM); frontend imports the built `dist/`. Rebuild the shared package before backend/frontend typecheck, per `backend/CLAUDE.md`. Any new relative import in `backend/src` must end in `.js`.

---

## 9. File Plan

**New**
- `frontend/src/components/editor/studio-shell/types.ts`
- `frontend/src/components/editor/studio-shell/studio-shell.tsx`
- `frontend/src/components/editor/character-studio/character-nav-config.tsx`
- `frontend/src/components/editor/character-studio/pages/{references,pickers,lora,profile,appearance,voice}-page.tsx`
- `frontend/src/components/editor/character-studio/wardrobe-picker.tsx`
- `packages/shared/src/wardrobe.ts`
- `supabase/migrations/NNN_character_person_wardrobe.sql`
- Tests per §10.

**Modified**
- `character-studio-modal.tsx` → thin shell consumer.
- `appearance-tab.tsx` → split, then removed (logic moves to profile-page + appearance-page).
- `person-picker-expander.tsx` → **retired** (along with its seed-prompt mutation). The Pickers page uses `PersonPickerDetailed` directly, writing structured `state.staged.person`. The old "apply to seed prompt" affordance is removed.
- `voice-tab.tsx` → replaced by `voice-page.tsx` (delete old).
- Existing `expressions/poses/motions/sheet/personality` tabs → register as pages (light wrapper rename; logic unchanged).
- `backend/src/routes/characters.ts` (Zod + columns), generation routes (hint injection), `input-resolver.ts` (auto-wire).
- `frontend/src/types/nodes.ts`, `packages/shared/src/index.ts`, `frontend/src/lib/api.ts` (if a `from-design` helper is needed).

**Docs (per CLAUDE.md public-docs rule)**
- Update the character studio / character docs under `docs/` to reflect the new structure, the Voice capabilities (browse/clone/design/talk + auto-wire), and the structured Pickers. Note any credit costs surfaced on the Talk lip-sync button.

---

## 10. Testing

- `packages/shared/src/__tests__/wardrobe.test.ts` — `buildWardrobeHints` (single, multi-pick, "none" suppression, dimension order) mirroring person hint tests.
- `input-resolver` test — `character → text-to-speech` injects `voice.voiceId` (+ `voiceType`/`ttsProvider`); respects an existing override (no clobber). **Do NOT** assert voice injection into `lip-sync` (it has no `voice` field — §7.3); optionally assert the existing `character → lip-sync → imageUrl` routing still holds.
- Studio shell render test — `CHARACTER_STUDIO_NAV` renders all groups/pages; LoRA hidden when `hasCredits=false`; badge rules fire.
- Generation hint-injection test — given a saved character with `person`+`wardrobe`, the assembled prompt contains both derived fragments.
- **`gen:skills` (REQUIRED — CI gate):** adding `person?`/`wardrobe?` to `CharacterNodeData` changes the generated `backend/skills/nodes/character.md` (ts-morph walks the type), so `gen:skills:check` hard-fails ("DRIFT DETECTED") unless regenerated. Run `cd backend && INTERNAL_ORCHESTRATOR_SECRET="<32+ chars>" npm run gen:skills` and commit the regenerated skills **in the same PR as the type change**. The secret is NOT in `.env` — pass inline.
- Run **full** frontend + backend vitest before shipping (per memory: targeted runs miss route-enum-sync / gen:skills invariants), `npx tsc --noEmit` in both, both lint scripts (admin-client + ee-imports), and rely on `backend-boot-smoke` for `.js`-ESM regressions.

---

## 11. Suggested Phasing (for the implementation plan)

1. **Foundation + relocation (no behavior change):** `StudioShell` + nav config; split Appearance → Profile + Appearance; relocate References; register existing tabs as pages. Ship-able on its own.
2. **Structured pickers:** `wardrobe.ts` + Wardrobe/Person structured storage + migration + backend Zod/columns + generation injection. 
3. **Voice rework (core):** studio voice-page (browse + clone + Talk audio/lip-sync) + `CharacterVoice` type widening + orchestrator **TTS** auto-wire. Design mode is **audition-only** here.
4. **Voice — designed-voice persistence (highest risk, gated):** new `POST /v1/voice-clones/from-design` + ElevenLabs create-voice-from-preview, behind a flag. Lands last so the rest ships unblocked.
5. **LoRA relocate + rework.**
6. **Public `docs/` updates.**

Each phase is independently shippable to staging (`dev`) and verifiable. **Critical:** the `person`/`wardrobe` type change (Phase 2) and its `gen:skills` regeneration (`backend/skills/`) MUST be in the same commit/PR, or `gen:skills:check` reddens CI.
