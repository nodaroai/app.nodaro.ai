# Character Node — Hybrid Role Dropdown + Identity-Lock (Design)

**Date:** 2026-07-01
**Status:** Approved (brainstorming) — revised after adversarial full-review; pending implementation plan
**Branch:** `feat/character-node-default-role`

## Problem

The character node's title-row dropdown (`frontend/src/components/nodes/character-node.tsx:345-368`) still renders the **legacy** usage-mode vocabulary — "Identical", "Face only", "Face + Pose", "Pose only", "Emotion only", "Style only", "Name only", "None" — via `usageModeLabel(USAGE_MODES)`, with no hybrid gate. The Unified Reference Roles work (Phase D) migrated the mention **pills** and the `@`-autocomplete to the new role vocabulary, but the character **node's own dropdown was never in scope**. `IMAGE_REFERENCE_FORMAT` now defaults to **`"hybrid"`** everywhere (`frontend/src/lib/image-reference-format.ts:23`), so the node is the last place speaking the old language.

It is not merely cosmetic. In hybrid, the node's `defaultUsageMode` only reaches output through two of the three wired-character resolution paths, and even there it is lossy:

1. **Extras path** (`renderExtraRefsHybrid`, `prompt-builder.ts:1048`) — role = `firstSightExtraRole(defaultUsageMode, "wired-character")`. This maps only `face`/`pose`/`style` to themselves; `identical`/`face-pose`/`emotion`/`name`/`none` all collapse to `"person"`. So **5 of the 8 dropdown options are dead** on this path.
2. **Canonical-fallback path** (`renderCanonicalFallbackHybrid`, `prompt-builder.ts:973`; video `video-reference-resolver.ts:515`) — used when a character node is wired to a generator but **not** `@`-mentioned and **not** an extra. This is the **most common wiring**, and it **hardcodes** `defaultRoleForSource("wired-character")` = `"person"`, ignoring `defaultUsageMode` entirely today.
3. **Mention path** (`resolveCharacterMentionsHybrid`, `prompt-builder.ts:318`; video `video-reference-resolver.ts:298`) — an un-roled `@`-mention also falls straight to `"person"`, ignoring the node default.

So the node dropdown is (a) mislabelled, (b) lossy where it works, and (c) ignored entirely for the most common wiring. The fix must make the node's default role reach **all** paths on **both** image and video.

Scope note: only the **character** node has this dropdown; `location-node.tsx` / `object-node.tsx` / `creature-node.tsx` have no equivalent control (verified).

## Decisions (from brainstorming)

1. **Vocabulary — full pill parity.** The node's hybrid dropdown offers the complete character role vocabulary (`person / face / clothes / hair / pose / expression / style`) + `Custom…`, matching the mention pill.
2. **Also expose identity-lock** on the node (the existing `off/soft/strict` field), not just the role dropdown.
3. **Identity-lock — 3 real levels, reuse the existing field.** `off` → no lock line, `soft` → mild "preserve likeness" line, `strict` → strong "match exactly" clamp. Reuse `CharacterNodeData.identityLock`; accept that existing nodes (default `"soft"`) will emit a mild identity line in hybrid.

## Design

### Data model

| Field | Location | Notes |
|---|---|---|
| **new** `defaultRole?: string` | `CharacterNodeData` (`frontend/src/types/nodes.ts`) | Hybrid default role slug (pre-sanitized). `undefined` ⇒ source default `"person"`. Written **only** by the hybrid dropdown. Workflow save is passthrough (`z.record(z.unknown())`), so **no workflow-route Zod change**. |
| `defaultUsageMode` | `CharacterNodeData` | **Unchanged** — remains the *legacy*-mode default; keeps `usageModeDirective`/`effectiveMode` correctly typed. A separate field is required because role slugs `person/clothes/hair/expression` are **not** `UsageMode` members (compile error) and `usageModeDirective` has no case for them (returns `undefined` — poisons the legacy + video-legacy path, `character-usage-mode.ts:63-81`, `video-reference-resolver.ts:534`). |
| **new** `defaultRole?: string` | `ConnectedReference` (`packages/shared/src/types.ts`) | Carries the node default into the shared resolvers. **Forces** a matching field in `backend/src/lib/connected-reference-schema.ts` (route schema for structured refs) — pinned by the drift-guard test `backend/src/routes/__tests__/generate-image.test.ts:134-188` (compile-time `Exclude<TypeKeys,SchemaKeys>` + `Record<keyof ConnectedReference, true>` sample + runtime key-count). Omitting it **hard-fails CI**. |
| **new** `defaultRole?: string` | `CharacterMeta` (`video-reference-resolver.ts:158-162`) + `ExtraRefCharacterContext` (`extra-refs.ts:52-56`) | The video-extras + shared-extras lookup types read the node default via these, not via `ConnectedReference`. Returned by both `lookupCharacterBySlug` adapters (FE `video-prompt-assembly.ts:298-311`, BE `payload-builder.ts:940-948`) and `buildExtraRefCharacterContextLookup` (`payload-builder.ts:815`). |
| **reused** `identityLock` (`off/soft/strict`) | `CharacterNodeData` (`nodes.ts:3675`) | No new field. Now also **stamped** onto `ConnectedReference.identityLock` (`{enabled,text}`) — which is already in `connected-reference-schema.ts:69-71`, so **no schema change for lock**. |

### Node UI — `character-node.tsx` (hybrid branch, gated on `IMAGE_REFERENCE_FORMAT`)

- **Role dropdown** replaces the title-row usage-mode `Select` (`:345-368`). Built from `REFERENCE_ROLE_PRESETS["wired-character"]` (already exported from `@nodaro/shared`) + a `Custom…` free-form input, writing `defaultRole`. `person` is the baseline and equals the unset state.
- **Identity-lock control** on its **own compact sub-row** (mirroring the `${style}·${gender}` sub-row at `:370`), not crammed next to the truncating name. Writes `identityLock` (`off/soft/strict`), default-display `"soft"` (matches `DEFAULT_IDENTITY_LOCK` + config panel). Same field the config panel (`config-panels/entity-configs.tsx:85-86`), Character Studio (`character-studio/pages/profile-page.tsx:118-119`), and `lib/character-node-data.ts:56` already read/write, so all stay in sync. (Studio's unset-display default `"strict"` diverges from runtime `"soft"` — out of scope to change, noted.)
- **Interactive-control requirement:** every new control inside the node must replicate the existing triple `onClick`/`onPointerDown`/`onMouseDown` → `stopPropagation` (`:355-357`) to stop React Flow drag.
- **Shared-code hoist:** move `sanitizeRole` (and `roleToCharacterRefSlots`) from `config-panels/prompt-editor/character-ref-roles.ts` into `@nodaro/shared` (alongside `REFERENCE_ROLE_PRESETS`), and re-export from `character-ref-roles.ts` for existing importers. The node then imports from shared — avoiding a `components/nodes → config-panels/prompt-editor` layering smell, single source of truth for sanitisation.
- **Legacy branch unchanged.** When `IMAGE_REFERENCE_FORMAT === "legacy"`, the node renders exactly today's usage-mode dropdown (writes `defaultUsageMode`) and shows no lock control.

### Resolution — one shared helper, applied to all six paths

Add a single helper (shared, e.g. `reference-roles.ts`):

```
resolveDefaultRole(defaultRole, defaultUsageMode, source):
  return defaultRole?.trim() || firstSightExtraRole(defaultUsageMode, source)
```

`defaultRole` is stored pre-sanitised ⇒ used **verbatim** (Custom survives). When absent, it falls back to the existing `firstSightExtraRole` (back-compat: `face/pose/style` pass through, else `"person"`).

**Role precedence** per path:
- **Mention** (image `:318`, video `:298`): `perMentionTokenRole ?? resolveDefaultRole(...)`.
- **Extras** (image `:1048`, video `:612`) and **Canonical fallback** (image `:973`, video `:515`): `resolveDefaultRole(...)` (no per-mention token).

**Identity-lock mapping.** A shared helper (in `identity-lock.ts`) maps the node `identityLock` mode → the per-reference lock shape, stamped onto the ref at every construction site:

```
off    → { enabled: false }                                       // no line
soft   → { enabled: true, text: getIdentityLockClause("soft") }   // mild
strict → { enabled: true, text: getIdentityLockClause("strict") } // strong
```

`buildIdentityLockLine(ref, binding)` is **already called** on all three image paths (`:1051`/`:974`/`:355`) and all three video paths (`:615`/`:516`/`:339`), so once the ref carries `identityLock`, the line emits automatically. The per-mention pill `~lock`/`~nolock` still **overrides** via `withForcedIdentityLock` (its `undefined`/inherit path returns the ref unchanged, so the node default governs; `true`/`false` force on/off — `identity-lock.ts:163-167`).

### Plumbing — stamp `defaultRole` + `identityLock` at every ref-construction site, read via the helpers

**Shared** (`packages/shared/src/`):
- `types.ts` — `ConnectedReference.defaultRole`.
- `reference-roles.ts` — `resolveDefaultRole` helper; hoist `sanitizeRole`/`roleToCharacterRefSlots`.
- `identity-lock.ts` — `identityLock` mode → per-ref-lock helper.
- `extra-refs.ts` — add role+lock to `ExtraRefInput` (`:40-47`) + `ExtraRefCharacterContext` (`:52-56`); stamp both onto the `ConnectedReference` in `expandExtraRefsToConnectedReferences` (`:70-122`).
- `prompt-builder.ts` — read via helper at extras `:1048`, canonical `:973`, mention `:318`.
- `video-reference-resolver.ts` — read via helper at extras `:612`, canonical `:515`, mention `:298`; add `defaultRole` to `CharacterMeta` (`:158-162`).

**Frontend:**
- `components/nodes/character-node.tsx` — UI (above).
- `config-panels/prompt-editor/character-ref-roles.ts` — re-export hoisted helpers.
- `config-panels/connected-references.ts` — stamp `defaultRole` + `identityLock` at **all four** wired-character sites (`:193`, `:217`, `:275`, `:303` — incl. the attached-char-definitions branch) and the extras `ctxLookup` (`:345`).
- `workflow-editor/execute-node.ts` — stamp at the main character expansion (`:1018`, variants) and the extras context (`:617`).
- `lib/video-prompt-assembly.ts` — stamp at `expandCharacterNodeIntoRefs` (`:103-140`) and return `defaultRole` from `lookupCharacterBySlug` (`:298-311`); reverse the explicit `identityLock`-omission (`:316-318`).
- `lib/compute-injected-refs.ts` — **consumer, not a stamp site.** Optionally read `defaultRole` for the reorder-UI tiles (`InjectedRefTile`, `:208/:228/:247`); no ref is constructed here.

**Backend** (`backend/src/`):
- `services/workflow-engine/payload-builder.ts` — stamp at `expandWiredCharacterRefs` (`:366-404`), the extras context lookup / `CharacterMeta` adapter (`:815`, `:940-948`); reverse the explicit `identityLock`-omission (`:954-956`).
- `lib/connected-reference-schema.ts` — add `defaultRole` to `connectedReferenceSchema`, and add it to the drift-guard test sample in `routes/__tests__/generate-image.test.ts`.

## Back-compat & behavior change

- **Non-mutating read-through** for existing nodes: a node with `defaultUsageMode:"face"` and no `defaultRole` resolves/display role `face`; `identical`/`face-pose`/`emotion`/`name`/`none` → `person`. `defaultRole` is written only when the user picks a role in the hybrid dropdown.
- **Behavior change 1 (role, canonical + mention paths).** Today the canonical-fallback and un-roled-mention paths **ignore** the node default and always emit `"person"`. After this change they honor it via the shared helper. In practice the default `defaultUsageMode` is `"identical"` → `"person"` (**no change** for the overwhelming majority); only nodes a user explicitly set to **Face/Pose/Style** flip from `"person"` → that role on these paths — i.e. the dropdown finally does what it says. This is a fix, but it is a prompt change for those workflows. Extras already behaved this way (no change there).
- **Behavior change 2 (identity-lock).** Existing nodes default `identityLock:"soft"`, so in hybrid they now emit a mild likeness line for wired refs + canonical + un-overridden mentions where they previously emitted none (the F4 "identityLock intentionally NOT populated" deferrals at `video-prompt-assembly.ts:316-318` / `payload-builder.ts:954-956` are **un-deferred**). Additive to the role directive; on-theme for a Character node.
- **Legacy is byte-identical.** Both changes are hybrid-only; the `legacy` kill-switch path is untouched. **Ship to staging (`next.nodaro.ai`) first for a soak** before dev→main — this is a visible prompt change across existing character workflows.

## Testing

- **Node component:** role menu + lock sub-row render in hybrid; usage-mode dropdown (no lock) in legacy — gate on a mocked `IMAGE_REFERENCE_FORMAT`. Picking a preset role writes `defaultRole`; `Custom…` writes the sanitised slug; picking a lock level writes `identityLock`; `stopPropagation` wired.
- **Shared helper:** `resolveDefaultRole` precedence — `defaultRole` over `defaultUsageMode`; Custom verbatim; unset → `person`; `face/pose/style` back-compat pass-through.
- **All six paths honor `defaultRole`:** image + video × {extras, canonical, mention} — a `defaultRole:"clothes"` node emits "the clothes from …" on every path; a per-mention role still overrides.
- **Identity-lock:** off/soft/strict → correct per-ref line on all six paths; per-mention `~lock`/`~nolock` overrides the node default.
- **Schema drift-guard:** update `generate-image.test.ts` sample for `ConnectedReference.defaultRole` (else compile + key-count fail).
- **Convergence:** the existing `character-convergence-image.test.ts` pins image/video parity on the `usageMode` path — verify it still passes (refs carry no `defaultRole`, so the `firstSightExtraRole` fallback is unchanged); **add** a new case pinning image/video parity for a `defaultRole` node (the existing test does not cover it). Also verify the canonical case at `:61-73` (default node → still `"person"`).
- **Legacy byte-identical:** existing character/location mention + resolver tests unchanged (the guard).

## Registration / process

- New node-data field `defaultRole` ⇒ run `INTERNAL_ORCHESTRATOR_SECRET="<32+ chars>" npm run gen:skills` (in `backend/`); `gen:skills:check` CI hard-fails on drift.
- `ConnectedReference.defaultRole` ⇒ update `connected-reference-schema.ts` **and** the drift-guard test (above). This is the only route-schema touch; the workflow-save path stays passthrough.
- No new node type, no provider/model enum. `identityLock` is an existing field ⇒ no skills change, only new consumption.
- Full backend + frontend + shared vitest before shipping (provider/resolver-adjacent change).

## Out of scope

- Retiring the deprecated `collectIdentityLockClause` / `getIdentityLockClause` node-clause path (tracked separately in `identity-lock.ts`).
- Location/object/creature node default-role controls (those nodes have no such dropdown today; their canonical resolvers correctly use `defaultRoleForSource` / `locationModeToRole`).
- Fixing the Character Studio unset-display default (`"strict"` vs runtime `"soft"`).
- The per-mention identity-lock tri-state token work (already shipped: `~lock` / `~nolock`).
