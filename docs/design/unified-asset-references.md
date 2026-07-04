# Unified asset references — `{image:N}` for Assets-handle connections

**Date:** 2026-06-29
**Status:** ✅ SHIPPED to dev + prod (2026-06-30) — **Phase 1 (video) PR #3692**, **Phase 2 (image) PR #3693**. Reached production via the dev→main deploy PR #3691. See **As-built notes** at the bottom for where the implementation diverged from this design.

## Goal / user story

> When an image is connected to a generate-image / generate-video node via the **Image Refs** handle, the user can reference it in the prompt as `{image:N:label}`, which resolves to `the {label} from @image_N` and points at the N-th reference image. We want the **same behavior for ASSETS** — character / location / object / animal(creature) — connected via the **Assets** handle.

A connected asset must (a) contribute its reference image to `referenceImageUrls`, (b) be referenceable by a positional token that **resolves** (today it silently drops), and (c) be numbered in **one** sequence shared with the plain image refs.

## Decisions (locked)

| # | Decision |
|---|----------|
| D1 | **Unified `{image:N}` numbering.** Assets share ONE reference-image numbering with the Image Refs handle. An asset at position N → `@image_N`. No typed `{character:N}` tokens. |
| D2 | **All four asset types** (character, location, object, animal/creature) become first-class positional refs with guaranteed URL contribution. Characters & locations **keep** their richer `@name` mentions on top — those are just one input to the same unified numbering. |
| D3 | **Order = Image-refs first, then assets.** `referenceImageUrls = [Image-Refs-handle conns (existing order)] + [Assets-handle conns (edge order)]`; **frames stay tail-appended, unnumbered** (`resolveSeedance2Inputs`). |
| D4 | **Spec + phased build.** Phase 1 = generate-video; Phase 2 = generate-image. Each ships with the numbering-invariant + preview↔run parity tests. |
| D5 | **One ordering on ALL surfaces** = image-refs-first (D3), including **flipping #3683's `assembleVideoConnectedReferences`** (today assets-first) to number after the leading flat refs. Converges canvas / orchestrator / API / MCP / SDK / CLI onto one `@image_N`, fixes the orchestrator's latent `@image_1` collision AND #3683's image-route-vs-video-route mismatch. |

## Builds on #3683 (merged to dev 2026-06-29, commit 9365cb24b)

PR #3683 — *"catalog-driven reference coverage + connectedReferences across API/MCP/SDK"* — landed right before this work and is **orthogonal, not conflicting**. It built the **external-caller** half; this feature builds the **editor/canvas** half on top of it. Reuse, don't duplicate:

- **`connectedReferences` is first-class across API / MCP / SDK** (NOT CLI — see Coverage). Routes (`generate-video`/`generate-image`/`text-to-video`) accept `connectedReferences` + `referenceOrder`, validated by `connectedReferenceSchema` (`backend/src/lib/connected-reference-schema.ts`), and **assemble server-side** via the SAME shared core (`assembleVideoConnectedReferences` in `routes/generate-video.ts:166`, `assembleImageInput` for image) → `resolveVideoReferenceCore`. So a direct API/SDK/MCP run already binds inline refs exactly like the canvas.
- **Catalog-driven per-provider reference CAP**: `VIDEO_REF_LIMITS_BY_PROVIDER` + `imageReferenceLimit(provider)` (`model-constants.ts:465,1191`), drift-guarded (`video-ref-limits.test.ts`). Caps are applied **before** numbering so no `@image_(cap+1)` directive points at a dropped slot. **Our unified numbering MUST respect this cap** (flat refs consume budget first, then assets).
- **What #3683 did NOT do:** the editor Assets-handle entities still assemble via the local canvas path (`assembleVideoPrompt`/`execute-node`) and orchestrator `payload-builder` — characters only (no object/creature expander; location is image-only). **That gap is exactly this feature.**

Net effect on the plan: the assembly core, the caps, and the API/MCP/SDK surface already exist. Phase 1 shrinks to **feeding the editor's Assets-handle entities (all 4 types) into that same structured pipeline** on canvas + orchestrator, plus the object/creature/location gaps, plus **CLI parity** (the one surface #3683 skipped).

## Current state (grounded in code)

### The editor↔resolver split
- **Editor** (`connected-references.ts::buildImageConnectedReferences`): `getConnectedSources` returns *all* edges; only `startFrame`/`endFrame` are excluded. So character/location/object/creature wired to **Assets** already flow into the prompt-editor ref list — characters/locations as rich `@slug:N` mentions, object/creature/face fall through to the generic **`{image:N}`** chip bucket (`connected-references.ts:233-244`). Indices are assigned in **edge order**, mixing handles.
- **Resolver** (`@nodaro/shared/node-refs.ts`): `referenceModalityForHandle("assets")` → **`null`** (not in `REFERENCE_HANDLE_MAP`), so `countRefModalityEdges` does **not** count the Assets handle. → A `{image:N}` chip the editor offers for an object/animal **drops** at resolve time (`N > imageRefCount`).

### Numbering: video vs image
- **Video** (`video-reference-resolver.ts::resolveVideoReferenceCore`): numbers asset URLs from **1**, unaware of plain refs. Backend then assembles `referenceImageUrls = [plain refs…, resolver.additionalUrls…]` (`payload-builder.ts:2432-2443` t2v, `:2305-2380` i2v). → directive `@image_1` and body-token `@image_1` can mean **different** images when both plain refs and assets are present (latent bug, rare today). Only `expandWiredCharacterRefs` runs in the video path; **`expandWiredLocationRefs` is image-only**; there is **no** object/creature expansion at all.
- **Image** (`prompt-builder.ts::buildImagePrompt`): already numbers `@image_N` over `[pre-existing referenceImageUrls] + [mentions] + [canonical fallback]` (`:596, :483, :879`) — i.e. **plain refs first, then assets**, with directive ordinals and worker indices designed to agree. **This is the proven pattern Phase 1 mirrors.**

### Editor preview
Preview uses the same resolver core (`assembleVideoPrompt` → `resolveVideoPromptMentions` → `resolveVideoReferenceCore`). Fixing the core fixes preview **and** run together (the preview↔run parity test from #3676 enforces this).

## Design

### Canonical reference order (single source of truth)
Introduce one ordering used by **both** the editor numbering and the backend assembly:

```
referenceImageUrls (excluding frames) =
  [ Image-Refs handle connections, in existing order
    (manual data.referenceImageUrls + connectedRefImageOrder) ]
  ++ [ Assets handle connections, in edge order, each expanded:
       character → @mentioned variant URLs then canonical;
       location  → canonical (+ bucketed variants if @mentioned);
       object    → canonical (auto-attach, no mention machinery);
       animal    → canonical (auto-attach, like object) ]
frames (startFrame/endFrame) appended at the TAIL, unnumbered.
```

`@image_N` (body tokens **and** directive ordinals) numbers this list 1..K. `K` = its length. Editor chip N must equal backend position N.

### Numbering authority = the resolver (mirror the image side)
Extend `resolveVideoReferenceCore` so it is the **single** place numbering happens:
1. Accept the **leading plain image refs** (`leadingRefUrls: string[]`) — the Image-Refs-handle URLs already resolved by the input resolver. The resolver seeds `position` and `merged` with these so every directive ordinal and body `{image:N}` is offset past them.
2. Expand & include **all four** entity types (not just characters): accept pre-expanded `wiredAssetRefs` covering character + location + object + animal (callers build these via `to-connected-references.ts` + new `expandWired{Location,Object,Creature}Refs` reused from the image path).
3. Body-token count = `merged.length` (the assembled total), so tokens up to K resolve and beyond-K still drop to bare label (unchanged contract).
4. `REF_BINDING` swap-point unchanged — still emits `@image_N`.

Backend `payload-builder` video cases (i2v/t2v) stop doing the post-hoc `[plain, ...additionalUrls]` merge; they pass `leadingRefUrls` **in** and use the resolver's single merged output for `referenceImageUrls`.

### Count consistency
`countRefModalityEdges` stays the **edge** counter for plain refs. The **token-resolution** count becomes the resolver's `merged.length` (already how `resolveReferenceTokens` is called — `tokenCounts(merged.length)`), so assets are counted by construction. We do **not** need to hack `referenceModalityForHandle("assets")` → image for counting; instead the assets are real entries in `merged`. (Revisit only if a non-resolver call site needs the asset-inclusive count.)

### Editor numbering parity
`buildImageConnectedReferences` / `connectedReferencesToRefImages` must emit indices in the **canonical order** (D3): Image-Refs-handle entries first, then Assets-handle entries. Extract a shared ordering helper (or sort key) so the editor and backend can't drift. Object/animal entries already become `{image:N}` chips; ensure their N matches the canonical order and they carry a sensible default label (entity name).

## Phase 1 — generate-video (ship first)

Converge canvas + orchestrator on the SAME `resolveVideoReferenceCore` the #3683 routes already use, fed with ALL four asset types + leading refs, **capped by `imageReferenceLimit(provider)`**.

Touchpoints:
1. `packages/shared/src/video-reference-resolver.ts` — add `leadingRefUrls` + multi-entity `wiredAssetRefs`; seed `position`/`merged`; number directives + tokens over the unified list. Respect the per-provider cap (flat/leading refs consume budget first — mirror `prompt-builder.ts:1063-1080` and `assembleVideoConnectedReferences`).
2. `packages/shared/src/to-connected-references.ts` — ensure object/creature/location map to the resolver's expected shape (canonical auto-attach for object/animal).
3. `backend/.../payload-builder.ts` — video i2v/t2v: build leading refs + expand all 4 entity types (add object/creature expanders; wire location into video), pass into resolver, drop the post-hoc merge. Where practical, reuse `assembleVideoConnectedReferences` (already exported from `routes/generate-video.ts:166`) so orchestrator ≡ route.
4. `frontend/.../execute-node.ts` — mirror the same on the single-node run path (it calls `resolveVideoPromptMentions`).
5. `frontend/.../video-prompt-assembly.ts` — preview path inherits the core change; `imageRefCount` becomes/aligns with the unified, capped count.
6. `frontend/.../connected-references.ts` (+ `video-audio-ref-items.ts`) — canonical-order indexing for the editor chips; object/animal default labels; cap the offered chips at `imageReferenceLimit`.
7. Autocomplete (`suggestion-list.tsx`): object/animal show as resolving `{image:N}` chips (already offered; verify label + number).
8. **CLI** (`packages/cli/`) — #3683 skipped it. Add `--connected-references <json|@file>` (+ `--reference-order`) passthrough on the `run`/node commands so CLI reaches parity with the SDK it wraps. (Small; can ship in Phase 1 or as a fast-follow.)

## Coverage (API / MCP / SDK / CLI)

| Surface | Status | Notes |
|---------|--------|-------|
| **API** | ✅ done (#3683) | routes accept `connectedReferences` + `referenceOrder`, assemble via the shared core; verify Assets-entity sources resolve once Phase 1 expands them |
| **MCP** | ✅ done (#3683) | `verbs-image` / `verbs-video` / `video-director` expose `connected_references` + `reference_order` |
| **SDK** | ✅ done (#3683) | `@nodaro/sdk` `StructuredReferenceParams`, typed `run`/`runAndWait` overloads, `ConnectedReference` export |
| **CLI** | ❌ **gap** | not touched by #3683 — add passthrough (touchpoint 8) |
| **Editor / canvas / orchestrator** | ❌ **this feature** | Assets-handle entities (all 4) into the unified, capped `{image:N}` numbering |

## Phase 2 — generate-image (after Phase 1 ships)

The image-side `buildImagePrompt` already numbers plain-refs-first. Phase 2 mostly **verifies** parity and **fills gaps**:
- Confirm object/animal(creature) get expanded + numbered on the image path (characters/locations already do).
- Editor chip numbering parity for image nodes (same shared ordering helper).
- Extend the image preview↔run parity + numbering-invariant tests to assets.

## Non-agreement / conflict rules

How the system behaves when references, surfaces, or numbering *don't* agree. Two kinds:

### A. Design-time non-agreement (two surfaces could compute different results)
The governing rule is **make disagreement structurally impossible, not fixed once**:
1. **Single source of truth.** ONE shared function owns the canonical reference order + `@image_N` numbering; every surface (canvas preview, canvas run, orchestrator, API route, MCP, SDK, CLI) *calls* it — none re-derives. Authorities: `resolveVideoReferenceCore` (order + numbering), `VIDEO_REF_LIMITS_BY_PROVIDER` / `imageReferenceLimit` (caps), `referenceModalityForHandle` (modality). Adding a parallel path is the bug.
2. **Invariant + guard test, not "remember to update."** The agreement is pinned by a test that fails on drift: **editor chip N ≡ orchestrator payload position N ≡ route payload position N ≡ directive ordinal**. The red test is the signal (mirrors the #3676 preview↔run parity + #3683 cap drift-guard). CLAUDE.md: prefer an invariant + guard over a hand-maintained list.
3. **Data/capability-driven, not hardcoded.** Provider ref-support + caps come from the catalog, never a hand-kept enum.
4. **When surfaces ALREADY disagree** (image-route plain-first vs video-route assets-first, today): **converge to the proven convention and delete the divergent path** — never add a third. Here → image-refs-first (D5).

### B. Runtime non-agreement (a reference can't be satisfied) — defined fallbacks
1. **Out-of-range token** (`{image:N}`, N > available refs): drop to the **bare label**; never ship a raw `{image:N}` to the model. (`resolveReferenceTokens` contract.)
2. **Over-cap references** (more than the provider accepts): **leading flat refs consume the budget first**, excess assets dropped **before** numbering, so no `@image_(cap+1)` directive points at a slot the worker never gets. (#3683 cap rule, now applied in the shared core.)
3. **Non-ref-capable provider**: strip ALL `{image:N}` tokens to bare labels, attach nothing (`{video:N}`/`{audio:N}` still resolve against their flat counts).
4. **Determinism / tie-break**: canonical order is deterministic — image-refs in handle order, then assets in edge order — so the same graph always numbers identically (no run-to-run drift).

These rules are the acceptance contract for the numbering-invariant test below.

## Numbering invariant + tests

- **Invariant test (new):** for a graph with P plain refs + assets on the Assets handle, assert: editor chip index for each ref == its 1-based position in the backend-assembled `referenceImageUrls` == the ordinal in its directive/binding. One shared fixture drives editor-side and backend-side.
- **Preview↔run parity (extend `preview-run-parity.test.ts`):** add cases with assets on the Assets handle (character, location, object, animal) — assert `assembleVideoPrompt(...)===` the run's prompt, tokens resolved to `@image_N` at the right N.
- **Resolver unit tests (`video-reference-resolver.test.ts`):** leading refs + each entity type; ordering; dedup; frames at tail unaffected; `{image:N}` beyond K still drops.
- Full backend + frontend vitest before each PR (provider/ref change → run the whole suite, not targeted).

## Risks / edge cases
- **Mention coexistence:** a character both `@mentioned` and auto-canonical must not double-count URLs (existing dedup in `merged` covers this; assert in tests).
- **`referenceOrder` / `connectedRefImageOrder`:** user reorder must apply over the unified list, then renumber (the image side's `(@image_|Image )` renumber regex is the reference).
- **Frames:** must remain tail-appended and unnumbered (Seedance) — leading-ref offset must not shift the frame-suffix ordinals.
- **Providers without `reference-image`:** still strip tokens to bare label (gate unchanged).
- **Drift guard:** one shared ordering helper for editor + backend, covered by the invariant test (CLAUDE.md: invariant + guard over "remember to update").

## Out of scope
- Typed `@character_N` / `@location_N` bindings (rejected — D1).
- New editor token syntax (reuse `{image:N}` + existing `@mention`).
- Re-architecting the image-side builder (it already numbers correctly; Phase 2 only fills gaps).

---

## As-built notes (what actually shipped vs this design)

The design above is accurate in intent; two things evolved during implementation. Recorded here so this doc matches the code.

### 1. `leadingRefUrls` (URL-based) vs `ordinalOffset` (edge-based) — the offset is supplied two ways
The design said the orchestrator/canvas would "pass plain refs as `leadingRefUrls`." In practice the **count must be the EDGE count, not the resolved-URL count**, for FE↔BE parity — the canvas preview has no URL-resolution layer, so it can only edge-count, and the orchestrator must match it (the existing `{image:N}` edge-count contract, `payload-builder-video-mentions.test.ts`). So `resolveVideoReferenceCore` gained **two** ways to specify the leading count:

- **`leadingRefUrls: string[]`** — the core OWNS the URLs: prepends them to `additionalUrls` + offset = their count. Used by the **route** (`assembleVideoConnectedReferences`), where the external caller passes real URLs (no edge layer).
- **`ordinalOffset: number`** — the CALLER owns + merges the leading URLs; the core only offsets the numbering + `{image:N}` count, no prepend. `ordinalOffset = countRefModalityEdges(node, "image")` (EDGE count). Used by the **orchestrator** (i2v/t2v/generate-video) and the **canvas** (execute-node run + video-prompt-assembly preview), which keep their own frame-promotion + merge.

`applyReferenceOrder` also gained an `ordinalOffset` so leading refs keep `@image_1..offset` and only the asset tail renumbers.

### 2. Entity contribution split by path (parity-safe)
- **Video** path: `expandWiredEntityExtraRefs` (BE) + `expandWiredEntityExtrasForVideo` (FE) return `{url, description}` auto-attach extras for location/object/creature, gated by `includeWiredEntities` on ref-capable providers. **RAW canonical image, no location smart-variant**, so preview === run.
- **Image** path: `expandWiredObjectCreatureRefs` (BE) returns `wired-object`/`wired-creature` `ConnectedReference[]`, threaded into `buildConnectedRefsForGenerate`/`FromUrls`. Locations + characters already had image-path expanders; only object/creature were missing on the orchestrator (the FE + `buildImagePrompt` already handled them).

### 3. Editor chip numbering (follow-up #1 — mostly closed)
`connectedReferencesToRefImages` numbers the `{image:N}` chip over **auto-attaching refs only** (plain image + canonical character/location + object/creature/face), **skipping character/location VARIANT entries**, image-refs-first. So an Object/Animal wired alongside a Character (which expands to canonical + K variant rows for the `@`-mention drill) now gets its **true** `@image_N` — the variant rows no longer inflate it. Safe because a variant's `index` is never read for insertion (mentions derive their own N by scanning the prompt); it's display/filter/key only. Guarded by `connected-references-image-n-numbering.test.ts`.

**Remaining (genuinely out of scope — the existing `@mention` mechanism, not this feature):**
- `@kira:N` / `@loc:N` insertion (`computeNextMentionIndex`) is **offset-agnostic** — `maxExistingMentionN + 1`, ignoring preceding image-refs/entities. So a character's *own* mention N doesn't reflect its `@image_N` position when image-refs precede it. Reconciling that means making the `@mention` counter run-order-aware — a broader change to the long-standing mention system (touches all existing workflows), with its own risk, so it's deliberately not bundled here.
- When a SPECIFIC variant is `@`-mentioned, the run attaches that variant instead of the canonical; the editor can't know that without parsing mentions, so a later object's chip-N can still drift by one in that case.

### Coverage delivered
Canvas preview · single-node Run · workflow run (orchestrator) · API · MCP · SDK (all via #3683's `connectedReferences`) · CLI (`--params-file`, documented). Image + video both done.

### Tests (guarding the invariant)
`video-reference-leading-refs.test.ts` (resolver leading/offset) · `generate-video.test.ts` (route D5 ordinal) · `payload-builder-video-mentions.test.ts` (orchestrator object→@image_2) · `preview-run-parity.test.ts` case (j) (object→@image_1, preview≡run) · `payload-builder.test.ts` (`expandWiredObjectCreatureRefs`).
