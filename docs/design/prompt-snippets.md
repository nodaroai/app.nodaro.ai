# Prompt Snippets

Reusable inline text fragments ("identity lock", "cinematic quality", "slow dolly-in") that users inject into prompts while writing, via a `/` slash menu or a snippets button. Distinct from **presets**, which reconfigure the whole node: snippets compose *inside* the text the user is already writing, including negative prompts.

## Goals

- Inject curated prompt fragments at the caret without leaving the keyboard (`/` trigger) or via a discoverable button next to the prompt field.
- Keep the composing view uncluttered: recognized snippet text renders as a compact named **pill** that can be swapped for sibling variations (e.g. cycle lighting looks between runs to compare results).
- Ship a factory catalog (~60 snippets, image + video, positive + negative) mined from our 217 factory presets and current model prompting guides.
- Let users create and manage their own snippets (name, description, text, category, scope) mirroring the user-presets experience.

## Non-goals (v1)

- Snippet UI in published-app input cards (app runtime keeps plain text inputs).
- SDK/CLI/MCP snippet management (a read-only factory endpoint ships for parity; full CRUD later).
- Community/team sharing of snippets, favorites, group folders, i18n of factory snippet names.
- Batch "one generation per variation" fan-out (future; pill swap enables the manual loop).
- Refactoring factory presets to compose from snippet constants (preset mining found e.g. "watermark" duplicated ×123 — worthwhile cleanup, separate effort).
- Pills inside negative-prompt fields (those use the plain `TagTextarea`; they get the slash menu and plain-text insertion only).

## Decisions (settled in brainstorm)

| Question | Decision |
|---|---|
| Menu access | Both: `/` trigger inside the editor (mirrors `@` and `{`) + a snippets button beside the AI prompt-helper button |
| What lands in the prompt | **Plain text, always.** Pills are a pure display layer: the editor recognizes known snippet texts in the stored string and collapses them into named pills (same pattern as `@`-mention pills, which promote plain tokens at parse time) |
| Pill timing | Pills ship in v1, including swap-to-variation |
| Scoping | By modality (`image`/`video`/`audio`/`text`) + field target (`prompt`/`negative`), declared per node in `NODE_PROMPT_FIELDS`. Not per-node-type (avoids duplicating "cinematic quality" across 10 video nodes) |
| V1 rollout | Menu everywhere the shared editors render (all ~35 node types' prompt + negative fields); factory catalog curated for image + video; user CRUD in v1 |

**Why plain-text storage is load-bearing:** `node.data.prompt` stays a plain string, so the backend payload builder, final-prompt preview, prompt-helper wizard, published apps, SDK, MCP, export/import, and community sharing all keep working with zero changes and zero new invariants. There is no marker format to strip, no runtime library lookup, no snapshot semantics. A snippet whose library entry is later edited or deleted simply stops matching — the pill degrades to ordinary text and the prompt is byte-for-byte unchanged. Marker-based storage (`{{snippet:...}}`) was explicitly rejected: it would require every present and future prompt consumer to strip/resolve markers (a silent-leak-to-provider failure mode) and is a one-way storage format.

## Concepts and data model

### Factory snippets (`packages/shared/src/factory-snippets/`)

```ts
export type SnippetTarget = "prompt" | "negative"
export type SnippetMedia = "image" | "video" | "audio" | "text"

export interface FactorySnippet {
  readonly id: string            // stable kebab slug, e.g. "identity-lock"
  readonly name: string          // "Identity Lock"
  readonly description?: string  // one-liner shown in menu search
  readonly text: string          // the exact fragment inserted (5–40 words)
  readonly target: SnippetTarget // which field's menu it appears in
  readonly media: readonly SnippetMedia[] // which node modalities see it
  readonly category: string      // menu group + pill-swap sibling pool, e.g. "Lighting"
}
```

- Files: `types.ts`, `catalog.ts` (single file while ≤ ~100 entries; split per-media later), `index.ts` export. Re-exported from `packages/shared/src/index.ts`.
- English-only names/descriptions (consistent with factory presets).
- Guard test enforces: unique ids and names, non-empty trimmed text, text ≤ 600 chars, valid target/media/category, no `{`/`}`/`@` characters in text (avoids colliding with mention/variable token parsing).

### User snippets (DB)

Migration `NNN_prompt_snippets.sql`:

```sql
CREATE TABLE prompt_snippets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        varchar(80)  NOT NULL,
  description varchar(300),
  text        varchar(2000) NOT NULL,
  target      text NOT NULL DEFAULT 'prompt' CHECK (target IN ('prompt','negative')),
  media       text[] NOT NULL DEFAULT '{}',   -- empty = all modalities
  category    varchar(60),                    -- free text; groups menu + swap pool
  sort_order  integer,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);
```

- RLS: owner-only select/insert/update/delete (standard `auth.uid() = user_id` policies; no `profiles` self-query).
- `media` values constrained to the four modalities via CHECK or route-level Zod (route-level is sufficient; mirror presets' approach).

### Scoping model

`NODE_PROMPT_FIELDS` (`frontend/src/lib/prompt-fields.ts`) gains a `media: SnippetMedia` per node entry — single source of truth; a new node declares its modality once and inherits the right snippet pool. Examples: `generate-image`/`modify-image` → `image`; all video nodes → `video`; music/TTS/SFX/voice nodes → `audio`; `text-prompt`/`llm-chat`/`generate-script` → `text`.

A field's visible pool = snippets where `target` matches the field (prompt vs negative) AND (`media` is empty OR contains the node's modality). User snippets default to `media: []` (all), narrowable in the manage dialog.

## UX

### Slash menu (PromptEditor — all prompt fields + quick-edit modal)

- New TipTap Suggestion extension on `/`, allowed at line start or after whitespace only (never mid-word — `https://` must not trigger). Coexists with `@` and `{`.
- Typing after `/` filters the pool: case-insensitive substring over name, description, and category; name-prefix matches rank first.
- Layout: "My snippets" section first (when any match), then factory snippets grouped by category with sticky headers — same visual language as the existing `@` suggestion list. Row = name + dimmed one-line text preview.
- Keys: ↑/↓ navigate, **Enter or Tab** accept, Esc dismisses (and stays dismissed for that `/` occurrence while the caret remains in it — Tiptap suggestion default), menu auto-hides when matches reach zero. `allowSpaces: false`.
- Accept atomically replaces the `/query` with the snippet text (which immediately renders as a pill, see below). Insertion adds a leading `", "` when the preceding character is not whitespace/comma/line-start, nothing otherwise; caret lands after the inserted text.

### Slash menu (TagTextarea — negative fields)

`TagTextarea` already implements a multi-trigger autocomplete framework (`[`, `<`, `{`). Add `/` as a fourth trigger showing the flat filtered list (target=`negative`, node's modality). Plain-text insertion, no pills (plain `<textarea>` can't render them; negative fragments are short comma lists, so clutter is low). Same keyboard rules.

### Snippets button

A small button (lucide `Scissors`) beside `PromptHelperButton` in the field's label row — both in config panels and the prompt quick-edit modal. Opens the same searchable menu as a popover anchored to the field; selecting inserts at the caret (or appends when the field isn't focused). Footer actions: **New snippet** (prefilled from the current text selection when one exists) and **Manage snippets…**.

### Pills (display layer, PromptEditor only)

- A TipTap extension scans plain-text ranges for exact substring matches against the union of factory + user snippet texts visible to that field, longest-match-first, skipping ranges already owned by mention/image-ref pills. Matched ranges render as an atomic NodeView pill: scissors icon + snippet name, amber/emerald tone (distinct from violet=character, cyan=location).
- Serialization emits the pill's underlying text verbatim — the stored string and copy/paste output are always the plain prompt.
- Hover: tooltip with the full fragment text. Click: popover with
  - **Swap** — sibling snippets (same category, same target, modality-compatible), each showing name + truncated text; selecting replaces the underlying text and the pill re-renders as the new snippet. ◀ ▶ quick-cycle buttons step through siblings for fast compare-runs.
  - **Edit as text** — unwraps to plain editable text (match intentionally broken).
  - **Remove** — deletes the fragment (and a dangling leading separator if we inserted one).
- Backspace at the pill boundary deletes the whole pill (standard atomic-node behavior, same as `@` pills).
- Editing the snippet in the library re-runs matching: old occurrences degrade to plain text (prompt unchanged). Deleting the library entry behaves the same. Coincidental user-typed text that equals a snippet text pill-ifies — harmless, unwrap restores.
- Matching re-runs when the user-snippet query data changes (initial load, CRUD) — mirrors how the editor already re-parses when known upstreams change.

### Manage dialog

Modeled on `node-preset-manage-dialog.tsx`, simpler: flat list of the user's snippets with inline edit (name, description, text, target, media multi-select, category), create, delete. Opened from the menu footer. (Manual reorder is deferred — the list and menu order user snippets most-recent-first; `sort_order` exists in the schema/API for when reorder UI lands.)

## Final-prompt provenance highlighting (fast-follow, same cycle)

`FinalPromptPreview` gains origin-colored rendering: every part of the assembled prompt is tinted by where it came from, with a small legend under the preview —

- user-typed text (default foreground),
- resolved `{NodeLabel}` variables,
- parameter-picker fragments appended via FieldMappings (`getParameterPromptHint`),
- snippet fragments (same amber as the editor pills),
- mention identity/reference directives and the auto-appended style / negative suffixes (muted tints).

Implementation: the shared prompt builder gains a segment-emitting variant (`buildImagePromptSegments` → `PromptSegment[] { text, origin }` with `origin ∈ user | variable | picker | mention | style | negative`). The string builder remains the source of truth; segments are a join-guarded decomposition of it (collapsing to a single `user` segment whenever assembly rewrites the body — truncation, `{image:N}` expansion, reference reorder). Backend behavior byte-for-byte unchanged, guarded by a unit test asserting `segments.map(s => s.text).join("")` equals the legacy output across fixtures. Provenance is captured at the points that already perform each substitution/append, never re-derived by string matching afterwards. The one exception is snippets: they are plain text by design (no assembly step knows about them), so the preview recognizes them with the same matcher the editor pill layer uses.

## Backend API

`backend/src/routes/prompt-snippets.ts`, registered in `app.ts`. Fastify plugin + Zod on every endpoint. Mirrors `node-presets.ts` auth posture: reads require `req.userId`; writes call `rejectProgrammaticAuth()` (editor-only, SDK/OAuth tokens get 400); no credit guard; core (not `ee/`), no edition gating.

| Endpoint | Purpose |
|---|---|
| `GET /v1/prompt-snippets` | List the user's snippets (no server filters — the client pool builder filters by target/media) |
| `POST /v1/prompt-snippets` | Create — `{ name, description?, text, target, media, category?, sortOrder? }`; 409 `name_taken` on duplicate |
| `PATCH /v1/prompt-snippets/:id` | Update any of the above |
| `DELETE /v1/prompt-snippets/:id` | Delete |
| `GET /v1/prompt-snippets/factory` | Factory catalog (SDK/API parity; the editor imports it from `@nodaro/shared` directly) |

Frontend: `use-prompt-snippets-queries.ts` React Query hooks (list staleTime 60s; create/update/remove mutations invalidating the list), `api.ts` client functions + `PromptSnippet` type.

## Touchpoint map

| Layer | File | Change |
|---|---|---|
| Shared | `packages/shared/src/factory-snippets/{types,catalog,index}.ts` | New — types + curated catalog + guard-test target |
| Shared | `packages/shared/src/index.ts` | Export factory-snippets |
| DB | `supabase/migrations/NNN_prompt_snippets.sql` | Table + RLS |
| Backend | `backend/src/routes/prompt-snippets.ts`, `backend/src/app.ts` | Routes + registration |
| Frontend | `frontend/src/lib/prompt-fields.ts` | Add `media` per node entry |
| Frontend | `frontend/src/lib/api.ts`, `frontend/src/hooks/queries/use-prompt-snippets-queries.ts` | API client + hooks |
| Frontend | `config-panels/prompt-editor/` | New `SnippetSuggestionExtension` (slash menu), `SnippetPillExtension` + pill NodeView (match/swap/unwrap), wiring in `index.tsx` |
| Frontend | `config-panels/tag-textarea.tsx` | `/` trigger for negative fields |
| Frontend | `config-panels/snippet-menu.tsx`, `snippet-manage-dialog.tsx` | Shared menu panel (used by slash popup + button popover) + manage dialog |
| Frontend | config panels + `prompt-quick-edit-modal.tsx` | Snippets button beside `PromptHelperButton` |
| Docs | `docs/prompt-snippets.md` (+ index link) | Public docs page — required by the docs-sync rule |

## Factory catalog v1 (curated)

Sources: recurring fragments mined from our 217 factory presets (e.g. "natural skin texture" ×13, "85mm lens" ×15, "watermark" ×123, "morphing" ×71, "cinematic motion" ×51) merged with 2025–2026 model prompting guides (OpenAI gpt-image, BFL Kontext, DeepMind Veo/Imagen, fal Kling 3, Sora 2). Exact texts below are the implementation contract (tuning allowed in PR review). All are `target: prompt` unless marked **NEG**.

**Identity & Consistency** — image+video unless noted
| Name | Text |
|---|---|
| Identity Lock | preserve the exact same face, facial features, eye color, age, and expression as the reference image — do not alter identity |
| Same Person as Reference | the same person as in the reference image: identical face, hairstyle, build, and skin tone |
| Edit Only the Request (image) | change only the requested element; keep the face, pose, lighting, framing, and everything else exactly the same |
| Wardrobe Lock | wearing exactly the same outfit as the reference — same garments, colors, fabrics, and accessories, unchanged |
| No Beautify (image) | preserve natural skin texture, age lines, and asymmetries; do not beautify, smooth, slim, or rejuvenate the face |

**Quality**
| Name | Text |
|---|---|
| Cinematic Quality (image+video) | cinematic still, shallow depth of field, filmic color grade, soft motivated lighting, subtle film grain |
| Editorial Photo (image) | professional editorial photography, sharp focus, balanced natural exposure, magazine-quality composition |
| Photoreal Anchor (image) | photorealistic, shot on a full-frame camera, 50mm lens, natural color science, realistic skin tones |
| Crisp Detail (image+video) | intricate fine detail, crisp micro-textures, tack-sharp focus on the subject |
| Polished 3D Render (image) | physically based rendering, ray-traced global illumination, studio HDRI reflections |

**Lighting** — image+video
Golden Hour · Blue Hour · Rembrandt Portrait (image) · Studio Softbox · Neon Noir · Volumetric Rays · Candlelit · Rim Backlight — texts as researched, e.g. Golden Hour = "bathed in warm golden-hour sunlight, long soft shadows, gentle lens flare"; Neon Noir = "neon signs reflecting on wet pavement, cyan and magenta rim light, moody cinematic glow".

**Camera & Lens** — image+video unless noted
85mm Portrait (image) · 35mm Documentary · Wide Angle 24mm · Macro Detail (image) · Shallow Depth of Field · Deep Focus · Kodak Portra Look · CineStill Night Look · Anamorphic Widescreen — e.g. 85mm Portrait = "85mm portrait lens at f/1.8, creamy bokeh, flattering compression, tack-sharp eyes".

**Composition** — image+video unless noted
Rule of Thirds · Extreme Close-Up · Full Body in Frame · Overhead Flat Lay (image) · Low-Angle Hero · Centered Symmetry — e.g. Full Body in Frame = "full-body shot, entire figure visible head to toe, feet in frame".

**Realism / Anti-AI Look** — image+video unless noted
Real Skin Texture · Candid Phone Photo (image) · Film Grain · Muted True Color · Lived-In Detail — e.g. Real Skin Texture = "natural skin texture with visible pores, fine lines, and subtle imperfections — no airbrushing".

**Text Rendering** — image
Legible Sign Text ("a sign that reads \"YOUR TEXT\" in clear, legible, correctly spelled lettering, high contrast against the background") · Clean Typography.

**Camera Motion** — video
Slow Dolly-In · Orbit Shot · Tracking Shot · Handheld Energy · Crane Reveal · Locked Tripod · FPV Fly-Through — e.g. Slow Dolly-In = "slow steady dolly-in toward the subject, gradual and smooth".

**Motion Quality** — video
Natural Physics · Cinematic Slow Motion · Subtle Ambient Motion · Single Action Beat · I2V Fidelity Lock ("keep the exact appearance, outfit, colors, and background from the input image; animate only the described motion") · Stable Scene Lock.

**Audio & Dialogue** — video (Veo/Sora-class)
Ambient Sound Bed ("Audio: ambient environmental sound matching the scene, quiet room tone, no music") · No Subtitles ("(no subtitles, no on-screen text, no captions)") · Silence Lock ("no dialogue, mouth closed, ambient sound only").

**NEG — Image** (negative field)
| Name | Text |
|---|---|
| Anatomy Cleanup | deformed hands, extra fingers, fused fingers, bad anatomy, extra limbs, distorted face |
| Watermark Scrub | watermark, signature, text overlay, logo, username, jpeg artifacts |
| Low-Quality Scrub | worst quality, low quality, lowres, blurry, out of focus, pixelated |
| No Stray Text | text, captions, lettering, watermarks, logos |
| AI-Look Scrub (image+video) | airbrushed, plastic skin, waxy smooth, overexposed HDR glow, oversaturated colors, beauty filter |
| Clutter Scrub | cluttered composition, busy background, distracting elements |
| Garbled Text Scrub | misspelled text, garbled letters, gibberish writing |

**NEG — Video** (negative field)
| Name | Text |
|---|---|
| Artifact Scrub | morphing, warping, flickering, jitter, frame strobing, melting background |
| Body Stability | extra limbs, duplicate limbs, face distortion, body deformation, floating objects |
| Camera Discipline | camera drift, sudden zooms, handheld shake, unintended scene cuts |
| Identity Drift Scrub | changing facial features, face morphing, identity drift, face distortion |

(~60 entries. Negative-field texts are bare comma lists per Veo guidance — never "no X" phrasing inside a negative field. Models without a negative field — gpt-image, Flux, Imagen 4, Sora, Seedance — are unaffected: users put exclusions inline in the prompt, e.g. No Subtitles / Silence Lock which are prompt-target for that reason.)

## Edge cases & rules

- **Matching**: exact, case-sensitive substring; longest-first; no overlapping pills; never match inside existing mention/ref pills. Snippet texts may not contain `{`, `}`, or `@` (enforced for factory by guard test, for user snippets by route Zod + form validation) so they can never form mention/variable tokens.
- **Two snippets with identical text**: first match wins for pill labeling (user snippets take precedence over factory). Creation UI warns on exact-text duplicates.
- **Performance**: pool is ≤ a few hundred entries; per-keystroke scan is plain `indexOf` per snippet over a ≤ few-KB string — negligible. Matching runs in the same pass that promotes mention tokens.
- **Field mappings**: inserting a snippet is a manual edit — the existing "manual edit severs the wired mapping" behavior applies unchanged.
- **Length budgets**: stored prompt is the real prompt; existing Zod max-lengths and provider char limits count actual content (no wrapper overhead).
- **No telemetry-coupled behavior**: insertion is the only event; no runtime resolution exists to fail.

## Testing

- `packages/shared`: factory catalog guard test (uniqueness, text constraints, valid enums, forbidden characters).
- Frontend (vitest): matcher unit tests (longest-first, overlap skip, mention-range skip, degrade-on-edit, user-over-factory precedence); slash filter ranking; insertion separator logic.
- Backend (vitest): route CRUD, ownership isolation, `rejectProgrammaticAuth` on writes, 409 on duplicate names — mirroring `node-presets` tests.
- Run full backend + frontend suites before shipping (CI invariants: route registration, `gen:skills` untouched — no node data fields change in this feature).

## Rollout

Single feature branch off `dev`; may split into stacked PRs (1: shared catalog + backend + hooks + slash menu + button + TagTextarea + manage dialog; 2: pill layer + swap; 3: final-prompt provenance highlighting) — all land on `dev`/staging in the same cycle, prod ship after the usual staging soak. `docs/prompt-snippets.md` ships with PR 1 (menu) and is extended in PR 2/3 (pills, provenance preview) per the docs-sync rule.

## Future (explicitly deferred)

- Pills in negative fields (requires migrating `TagTextarea` fields to PromptEditor).
- "Generate one result per variation" fan-out from a pill's sibling set.
- Favorites band, group folders, import/export (mirror presets when demand appears).
- Community sharing / admin-curated snippet packs; SDK/MCP CRUD.
- `previousTexts` matching so library edits keep old occurrences pilled with an "(outdated)" badge.
- Composing factory presets from snippet constants to kill catalog duplication.
