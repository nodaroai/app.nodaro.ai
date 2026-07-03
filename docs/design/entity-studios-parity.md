# Entity Studios Parity — Design Spec

**Date:** 2026-06-14
**Status:** Approved (scope confirmed by user); pending implementation plan
**Scope:** Bring location / object / creature(animal) studios to parity with the redesigned character studio, generalize the entity image-output handle, and surface creature voice.

Builds directly on the just-shipped character work: the generic `StudioShell` + `StudioNavConfig`, the plain-`image` output handle (PR #3369 + the connectivity fix in `connection-validation.ts`/`payload-builder.ts`), and the voice resource.

---

## 1. Goals (all three user-approved)

1. **Studio port + References** — move location/object/creature studios off their old monolithic tabbed modals onto the shared config-driven `StudioShell`, and promote each one's reference photos (today a section inside `appearance-tab.tsx`) to a first-class **References** page in a Resources group. Mirrors character's `Resources → Identity → content` structure while keeping each entity's meaningful content groups.
2. **Entity image output = first-class image producer (all 4 entities)** — add a plain `image` output handle to location/object/creature (character already has it) and generalize the connectivity so every entity's `image` output connects anywhere `generate-image` output can.
3. **Creature voice** — surface the already-stored creature voice (migration 220) in the frontend, add a Voice page to the creature studio, and wire creature→text-to-speech auto-fill.

### Non-goals
- No new shared studio abstraction beyond `StudioShell` (page files follow the existing per-entity-clone convention, reusing shared leaf components).
- No Pickers/LoRA/Personality/Expressions for location/object/creature (those are character-only; the entities have no such data).
- No new voice migration (220 already added `creatures.voice`).

### Current state (audited)
- All 3 studios are old monolithic modals (`location-studio-modal.tsx`, `object-studio-modal.tsx`, `creature-studio-modal.tsx`), each a near-clone with its own `appearance-tab.tsx`/`angles-tab.tsx`/`motion-tab.tsx`/etc. The character refactor was self-contained — they still compile.
- Accents: location + object cyan `#22d3ee`; creature purple `#A78BFA`.
- Only character has the plain-`image` source handle. `handle-output-types.ts`: `location: { locationRef: "image" }`, `object: { objectRef: "imageRef" }`, `creature: { creatureRef: "imageRef" }`.
- `creatures.voice` column + `creatures.ts` Zod already exist (220); `CreatureNodeData` (frontend) does NOT have `voice`.

---

## 2. Architecture

Reuse `frontend/src/components/editor/studio-shell/` (`StudioShell<S,J>` + `StudioNavConfig` + `StudioNavContext` + `DEFAULT_STUDIO_ACCENT_ACTIVE`) **as-is** — it is already entity-agnostic.

For each of location/object/creature:
- A nav config `<entity>-studio/<entity>-nav-config.tsx` (`StudioNavConfig<<Entity>StudioState, <Entity>StudioJobs>`), groups below, `accentActiveClassName` set to the entity accent, badges = asset-array `.length`.
- `pages/` wrappers: extract the reference-photos section into `pages/references-page.tsx`; the rest of `appearance-tab.tsx` becomes `pages/appearance-page.tsx`; each content tab becomes a thin `pages/<tab>-page.tsx` wrapper binding the existing tab to `StudioPageProps`.
- The modal becomes a thin `<StudioShell config={…} state={studio} jobs={jobs} hasCredits={hasCredits()} header={…} defaultActiveKey="appearance" />` consumer (keeps its header, `use-<entity>-studio` + `-jobs` hooks, the pending-job seeding effect).

### Per-entity nav structure
- **Location** (cyan): Resources[**References**] · Identity[Appearance] · Environment[Time of Day, Weather, Seasons] · Composition[Angles, Lighting] · Atmosphere[Motion] · Sheet[Sheet]
- **Object** (cyan): Resources[**References**] · Identity[Appearance] · Composition[Angles] · Variants[Materials, Variations] · Motion[Motion] · Sheet[Sheet]
- **Creature** (purple): Resources[**References**] · Identity[Appearance] · Composition[Angles, Poses] · Variants[Variations] · Motion[Motion] · Character[**Voice** ✨]

Sheet stays via the shared `reference-sheet-tab` + `SHEET_TAB_ADAPTERS.<entity>` (location/object only — creature has no sheet, matching today).

---

## 3. Entity image output handle (all 4 entities)

**Frontend node + types**
- Add a plain `image` `type="source"` `<Handle>` to `location-node.tsx`, `object-node.tsx`, `creature-node.tsx`, mirroring `character-node.tsx:355-356` (identity `*Ref` handle PLUS a new `image` handle), with the visual pip (`HANDLE_COLORS.image`).
- `handle-output-types.ts`: add `image: "image"` to each entity entry (`location`, `object`, `creature`) alongside its existing `*Ref`.

**Frontend connection-validation** (`connection-validation.ts`)
- Generalize the `imageSourceType` substitution (today: `sourceHandle === "image" && rawSourceType === "character"`) to **all four entity types**:
  ```ts
  const ENTITY_IMAGE_HANDLE_TYPES: ReadonlySet<string> = new Set(["character", "location", "object", "creature"])
  const imageSourceType =
    connection.sourceHandle === "image" && ENTITY_IMAGE_HANDLE_TYPES.has(rawSourceType ?? "")
      ? "upload-image"
      : rawSourceType ?? ""
  ```
  This is already consumed by the 4 image-consumer dispatch branches (generate-image, generate-video, IMAGE_PRODUCER_VALIDATORS, VIDEO_PRODUCER_VALIDATORS), which the audit confirmed cover the COMPLETE set of image inputs `generate-image` output reaches. (`reference-sheet in` is intentionally entity-ref-only — excluded for all, correct.)
  - Belt-and-suspenders (per the audit's residual note): verify `video-retake` / `video-sfx` have no image-typed target that accepts `IMAGE_PRODUCER_TYPES`; if they do, route them through `imageSourceType` too.

**Backend routing** (`payload-builder.ts`)
- Add the `if (e.sourceHandle === "image") continue` guard to the per-entity expand functions: `expandWiredLocationRefs` (+ the object/creature equivalents — locate them) so the entity's `image` handle routes the portrait as a **plain reference**, not identity/mention. Mirrors `resolveSheetEntity` + `expandWiredCharacterRefs`/`buildExtraRefCharacterContextLookup` (already guarded).

**Output emission**
- Confirm each entity's output extractor (`execution-graph.ts` FE + `output-extractor.ts` BE) returns the portrait/`sourceImageUrl` for the `image` handle (the FE resolver's `isPlainImageHandle` from #3369 is already entity-agnostic — it keys on the handle, not the type — so it applies to all). Add a sourceHandle-agnostic emission if any entity extractor doesn't already return the image URL.

**"text input" clarification (documented):** `generate-image` output is an image producer and does NOT connect to literal text/prompt inputs (nor should an entity image handle). The image→text bridge is `image-to-text` (its `image` input is already covered). This satisfies "any image/reference/text input, just like generate-image output."

---

## 4. Creature voice

Backend storage already exists (220 + `creatures.ts` Zod, "reuses the character voice plumbing verbatim"). Frontend surfacing only:
- **Types:** add `voice: CharacterVoice | null` to `CreatureNodeData` (reuse `CharacterVoice`). Add `voice` to the creature save/get path (`api.ts` `saveCreature`/`getCreature` + the creature studio state hook's payload + refetch-merge, mirroring how character does it).
- **Voice page:** extract the character voice-page's reusable core (Browse + Clone + Design-audition + selected card + Talk panel + the local `pollJobUrl`) into a shared `frontend/src/components/editor/studio-shell/voice-resource.tsx` (or `character-studio/voice-resource.tsx`) parameterized by a minimal interface `{ voice, setVoice, sourceImageUrl }`. Character's `voice-page.tsx` and a new creature `pages/voice-page.tsx` both render it. (DRY — avoids duplicating ~300 lines. If the coupling proves heavy, fall back to a creature-local clone, but prefer the extraction.)
- **Auto-wire:** generalize the orchestrator TTS auto-wire (`input-resolver.ts`, currently `srcType === "character" && targetType === "text-to-speech"`) to also fire for `creature`. Read `src.data.voice` (creature carries the identical shape). The payload-builder TTS consumer already reads `resolvedInputs.voice` (entity-agnostic).

---

## 5. Testing

- `connection-validation.test.ts`: each of location/object/creature `image` handle → generate-image `references` + image-to-image = valid; → identity `assets` = rejected; their `*Ref` identity handle behavior unchanged.
- `payload-builder` tests: each entity's `image`-handle edge routes a plain portrait reference (no identity expansion); `*Ref` handle unchanged.
- `input-resolver` test: `creature → text-to-speech` injects `creature.voice.voiceId` (+ no-clobber); `character` unchanged.
- Studio shell render tests per entity: nav renders all groups/pages; badges fire; accent applied.
- Full FE + BE vitest + tsc both + lints + `gen:skills:check` before shipping. (Adding `voice` to `CreatureNodeData` → run `gen:skills` if creature is in the generated skills.)

---

## 6. Phasing (independently shippable)

1. **Image-handle generalization** (FE node handles + `handle-output-types` + `connection-validation` + `payload-builder` guards + tests) — small, high-value, cross-cutting; ship first.
2. **Location** studio port + References page.
3. **Object** studio port + References page.
4. **Creature** studio port + References page + **Voice** (page + types + auto-wire) + `gen:skills`.

Each phase: tsc + targeted tests green, independently shippable to `dev`.
