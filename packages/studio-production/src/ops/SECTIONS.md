# The operation sections — the map every lane builds against

`applyOps` is one discriminated union of ~50 semantic operations, each the
server-side twin of one studio store reducer (spec §6, D3). The union is
assembled from **twelve section modules**; this file is the map from a section
to its ops, their exact names and args, the studio reducer each generalises,
the studio test file whose assertions must be ported verbatim, and how its
receipts read.

Read `types.ts` (the contract), `errors.ts` (the one failure shape) and
`production.ts` (what a `Production` is) before this file.

---

## What a section module looks like

`src/ops/sections/<section>.ts` exports exactly three things:

```ts
export const <section>OpSchemas = {
  <op_name>: z.object({ op: z.literal("<op_name>"), /* args, verbatim from §6 */ }),
  // …
} as const

export const <section>Handlers: SectionHandlers<typeof <section>OpSchemas> = {
  <op_name>: (production, op, ctx) => ({ production, receipt, warnings }),
  // …
}

export const <section>OpClasses: SectionClasses<typeof <section>OpSchemas> = {
  <op_name>: "S", // S safe · D delete · P publish · $ credits
}
```

and its tests live in `src/ops/__tests__/apply.<section>.test.ts`.

### The rules that hold in every section

1. **Port the test FIRST, watch it fail, then implement.** Assertions ported
   from the studio store's tests stay **identical** — only the call shape
   changes, from `store.<reducer>(args)` to
   `<section>Handlers.<op>(production, op, ctx)`. If an assertion cannot
   survive the move, STOP that op and report it as blocked with the reason.
   That is the oracle rule: the studio's suite is the specification of these
   reducers, and a quietly adjusted expectation is a silent behaviour change.
2. **Addressing is by stable key, never by position.** Shots, folders, cuts and
   trash entries by their ids; cast rows by their role slug; results by
   `ResultKey` (`resultKey(result) = jobId ?? url`, `src/result-key.ts` — use
   `findResult`, and note a duplicate key resolves to the FIRST match). The
   only positions in the whole vocabulary are `move_shot`'s `toIndex` and
   `add_shot` / `insert_shots`' `afterShotId`. Several studio reducers take an
   INDEX (`setActiveStillResult(shotId, index)`); the op takes a `ResultKey`
   and the handler resolves it — that is the one deliberate generalisation, and
   the ported assertion still checks the same resulting document.
3. **Copy-on-write, always.** Never mutate `production`, a shot, a result list
   or a nested record. Immutability is what makes a mid-batch throw leave the
   input document untouched, and it is load-bearing for the studio's re-render.
4. **Nothing ambient.** No `Date.now()`, no `Math.random()`, no `crypto`, no
   `fetch`. A timestamp is `ctx.now` (an ISO string) and a fresh id is
   `ctx.mintId()`. Ids a later op could ADDRESS are minted by the CALLER and
   carried in the op (`add_shot { id }`, `add_folder { id }`,
   `add_cut { cut.id }`, `duplicate_shot { newId }`, `duplicate_cut { newId }`).
5. **Throw, never swallow.** A missing target is
   `opError("op_target_missing", …)`; args the schema allowed but the document
   refuses are `opError("op_invalid", …)`. Handlers never catch an `OpError`.
6. **Deletes are trash-backed.** `remove_shot`, `remove_still_result` and
   `remove_clip_result` route through the trash (`src/trash.ts`,
   `appendToTrash`) exactly as the store does. `purge_trashed` and
   `clear_trash` are the ONLY operations that destroy media references.
7. **Stay inside your lane.** A section never edits `schema.ts`, `apply.ts`,
   `describe-ops.ts`, `index.ts`, another section's file, or any codec module.
   If a codec helper you need does not exist, add a small pure helper INSIDE
   your section file and say so in your report.
8. **No React, no `import.meta.env`, no `console.log`.** Files ≤ 800 lines. No
   competitor names in any comment.

### How a receipt reads

`receipt.summary` is one line **for a person** — `describeOps` reuses it
verbatim and the copilot renders it on a proposal card. The house style, from
the spec's own examples:

- past tense, one sentence, ending in a period;
- the target named the way the user sees it — a shot by its **name** when it
  has one, otherwise `Shot <n>` by its 1-based timeline position; a result as
  `take <n>` of its shot; a cast row by its **display name** with its kind in
  parentheses;
- the destination or side effect in a trailing parenthetical —
  `(in the bin)`, `(reset 3 pins)`, `(4 prompts rewritten)`;
- **no ids in the prose.** Minted ids ride `receipt.ids`.

Worked examples: `"Renamed Shot 3 to “Rooftop”."` · `"Shot 3 → Dolly in."` ·
`"Deleted take 2 of Shot 1 (in the bin)."` · `"Bound @Kira (character)."` ·
`"Pasted 4 shots after Shot 2."` · `"Emptied the bin (7 items destroyed)."`

A `warnings` entry is for something worth saying that is not a failure — a
no-op (`"Shot 2 was already in that folder."`) or a wide side effect
(`"Renamed the role in 4 prompts."`).

---

## Sources (READ-ONLY)

The studio checkout `~/code/studio.nodaro.ai.2` on `dev` — **never edit it,
never switch its branch.** The reducers live in `src/store/production-store.ts`
(a barrel over `production-store-{state,helpers,shots,stills,clips,trash,cuts-audio,scene,cast-look}.ts`);
`production-store-state.ts` declares every reducer's signature; the `L…`
numbers in the tables below are ITS lines (the spec's §6 cites a different
inventory, so verify against the file, not against §6). The oracle tests are `src/store/production-store.test.ts`
(the bulk), `production-store.cast.test.ts`, `production-store.direction.test.ts`,
`production-store.import.test.ts`, `production-store.look-restore.test.ts`,
`production-store.trash-still.test.ts` and `src/store/trash.test.ts`.

---

## 1. `production` — the document's own settings

`src/ops/sections/production.ts` · `apply.production.test.ts`

| Op | Args | Class | Studio reducer |
| --- | --- | --- | --- |
| `set_name` | `{ name: string }` | S | `renameProduction` — `src/lib/production.ts:299` (an SDK call, **not** a reducer) |
| `set_thumbnail` | `{ url: string \| null }` | S | `setProductionThumbnail` — `src/lib/production.ts:313` (an SDK call, **not** a reducer) |
| `set_archived` | `{ archived: boolean }` | D when `true` | `setArchived` (state L414) |
| `select_shot` | `{ shotId: string }` | S | `selectShot` (L212) |
| `set_film` | `{ film: LookSelectionMap }` | S | `setProductionFilm` (L465) |
| `set_music_plan` | `{ plan: PlanMusic \| null }` | S | `setMusicPlan` (L409) |
| `set_music` | `{ music: ProductionMusic }` | S | `setMusic` (L405) |
| `clear_music` | — | D | `setMusic(undefined)` (L405) |
| `set_storyboard` | `{ patch: Partial<StoryboardSettings> }` | S | `setStoryboard` (L440) — a **merge**, not a replace |

**Tests to port:** `production-store.test.ts` → `describe("storyboard merge vs
replace")` (L1422). `setStoryboard` MERGES and `resetStoryboard` REPLACES — the
op is the merge; `brief` lives inside the patch.

**The two ROW ops (`set_name`, `set_thumbnail`) — read this before writing them.**
`Production` is `parseProduction`'s return type, and `name` / `thumbnailUrl` are
columns on the workflow ROW, not fields of `settings.studio` (§6 already marks
`set_name` "(route)"). So both handlers **return `production` unchanged** and put
the intended column value on the receipt's `row` field:

```ts
return {
  production,
  receipt: { op: "set_name", summary: `Renamed the production to “${op.name}”.`,
             row: { name: op.name } },
}
```

The route applies `row` in the same CAS write. Do **not** widen `Production`,
and do not reach for the workflow row inside a handler.

> Contract decision (scaffold lane, 2026-09-06). The integrator may prefer to
> widen `Production` instead; if that ruling comes, only these two handlers and
> `OpReceipt.row` change.

*Not an operation:* `shared` — sharing flips only through the audience-gated
route (D3.5), and an ops body carrying it is a 400.

---

## 2. `folders`

`src/ops/sections/folders.ts` · `apply.folders.test.ts`

| Op | Args | Class | Studio reducer |
| --- | --- | --- | --- |
| `add_folder` | `{ id: string, name: string }` | S | `addFolder` (L199) — mints its own id in the store; the op carries the caller's |
| `rename_folder` | `{ id: string, name: string }` | S | `renameFolder` (L201) |
| `remove_folder` | `{ id: string }` | S | `removeFolder` (L203) — shots in it fall back to no folder |
| `move_shot_to_folder` | `{ shotId: string, folderId: string \| null }` | S | `moveShotToFolder` (L205) — `null` = out of every folder |

**Tests to port:** the folder cases in `production-store.test.ts` (grep
`addFolder` / `moveShotToFolder`). Removing a folder must not remove its shots —
port that assertion exactly.

Receipts: `"Added the folder “Act I”."` · `"Moved Shot 3 into “Act I”."` ·
`"Moved Shot 3 out of its folder."`

---

## 3. `shots`

`src/ops/sections/shots.ts` · `apply.shots.test.ts` (+ `apply.shots.append.test.ts`, `apply.shots.crosslane.test.ts`)

| Op | Args | Class | Studio reducer |
| --- | --- | --- | --- |
| `add_shot` | `{ id: string, afterShotId?: string, name?: string, plan?: ScenePlan }` | S | `addShot` (L165) |
| `remove_shot` | `{ id: string }` | D | `removeShot` (L167) → the trash |
| `duplicate_shot` | `{ id: string, newId: string }` | S | `duplicateShot` (L169) |
| `move_shot` | `{ id: string, toIndex: number }` | S | `reorderShot` (L195), generalised from `"left" \| "right"` to an index |
| `rename_shot` | `{ id: string, name: string }` | S | `renameShot` (L197) |
| `insert_shots` | `{ graph: SerializedProduction, afterShotId?: string }` | S | `pasteShots` (L190) — every id RE-MINTED through `ctx.mintId` |
| `set_plan` | `{ shotId: string, frame?: PlanFrame \| null, motion?: PlanMotion \| null, voice?: PlanVoice \| null }` | S | today `Shot.plan` via import; Phase 3's Composer (D13) |

**Tests to port:** `production-store.test.ts` → `describe("addShot")` (L64),
`describe("removeShot")` (L80), `describe("reorderShot")` (L119),
`describe("duplicateShot")` (L145), `describe("appendShots")` (L1543),
`describe("a scene PLAN survives rendering")` (L1673);
`production-store.import.test.ts` → `describe("pasteShots — N-shot import into
the timeline")` (L34) and `describe("recipe consumption")` (L102);
`production-store.direction.test.ts` → `describe("trash — a direction-bearing
shot survives delete → reload → restore")` (L277).

Three of those describes reach no `shots` OPERATION — `"a scene PLAN survives
rendering"` (L1673), the CLIP half of `"recipe consumption"` (import L102) and
the direction/trash one (L277) exercise the `stills`, `clips` and `trash`
handlers. They are ported in `apply.shots.crosslane.test.ts` against those
handlers rather than dropped, so this listing has no silent hole; the sections
named still own the behaviour.

`insert_shots` is the ONE append primitive — the clipboard paste AND the
importer / Director append (plan L94, L287; R18: Phase 1 replaces the append's
mechanism, not its semantics). So it carries `appendShots`' FOLDER rule as well
as `pasteShots`' identity rule: a folder the arriving graph declares travels as
a NAME (one already here IS that folder, a new name is created with a FRESH
`ctx.mintId()` id, and a `folderId` the graph never declared is dropped rather
than left dangling). The paste's own "the dangling folder id is dropped" case is
that last clause said from the other side, so both reducers' tests hold against
one handler. Three of `describe("appendShots")`' cases cannot survive the move
and are named as blocked in the test file's header, not omitted: the
selection rule (`pasteShots` lands on the LAST arriving shot), the `enrollCast`
option (not an `insert_shots` argument in §6) and the stale-store-snapshot case
(meaningless for a pure handler).

`duplicate_shot`: the copy's node ids are `generate-image-<newId>` /
`generate-video-<newId>` — the SAME derivation every other minting path uses,
because two schemes over caller-supplied ids are not jointly injective, and the
handler additionally refuses a `newId` whose derived node ids are already taken
(a canvas-edited production can carry any node id at all).

`move_shot`: clamp `toIndex` into `[0, shots.length - 1]`; the ported
`reorderShot` assertions become "left" = `toIndex - 1`, "right" = `toIndex + 1`.

`set_plan` is a **per-stage merge**: a stage key that is absent leaves that
stage alone; a stage key that is `null` CLEARS it. Every by-name stage
enumerator must agree — `readPlan`, `planWithoutMedia`, `isEmptyPlan`
(`scene-plan.ts`), `copyPlan` (`shot-graph-wire.ts`) and `untokenizeRecipeProse`
(`bundle/production-bundle-strip.ts`) each list the stages BY NAME. Grep them
together before touching a stage.

---

## 4. `beats` — the scene's prose and its cues

`src/ops/sections/beats.ts` · `apply.beats.test.ts`

| Op | Args | Class | Studio reducer |
| --- | --- | --- | --- |
| `set_scene_prompt` | `{ shotId: string, text: string }` | S | `setShotScenePrompt` (L582) |
| `set_beats` | `{ shotId: string, beats: ShotBeat[] }` | S | `setShotBeats` (L575) |
| `set_end_transition` | `{ shotId: string, transition: ShotTransition \| null }` | S | `patchShotEndTransition` (L590) |

**Tests to port:** `production-store.test.ts` → `describe("setShotScenePrompt")`
(L1750) and `describe("patchShotEndTransition")` (L1717). The beats vocabulary
itself is `src/beats.ts` (already moved, already tested) — do not reimplement it.

---

## 5. `looks` — the per-scene look and its per-cast overrides

`src/ops/sections/looks.ts` · `apply.looks.test.ts`

| Op | Args | Class | Studio reducer |
| --- | --- | --- | --- |
| `set_look` | `{ shotId: string, look: LookSelectionMap }` | S | `setShotLook` (L551) |
| `set_cast_look` | `{ shotId: string, key: string, look: LookSelectionMap \| null }` | S | `setShotCastLook` (L542) — `null` clears that member's override |
| `set_cast_look_map` | `{ shotId: string, map: CastLookMap }` | S | `setShotCastLookMap` (L549) |

**Tests to port:** `production-store.look-restore.test.ts` (the layer split and
the write-back gate) and the look cases of `production-store.direction.test.ts`.

Direction and look ride as catalog **IDS**, never as baked hint text — the
platform folds them once, server-side, at the model call. A handler that wrote
prose here would fold the same clause twice.

*Not operations:* the browse-session look STASH and the undo stack (UI state).

---

## 6. `stills`

`src/ops/sections/stills.ts` · `apply.stills.test.ts`

| Op | Args | Class | Studio reducer |
| --- | --- | --- | --- |
| `add_still_result` | `{ shotId: string, result: ShotStillResult, atFront?: boolean }` | S | `addShotStillResult` (L221) |
| `set_active_still` | `{ shotId: string, result: ResultKey }` | S | `setActiveStillResult` (L266, by index) |
| `remove_still_result` | `{ shotId: string, result: ResultKey }` | D | `removeShotStillResult` (L274) → the trash |
| `rename_still_result` | `{ shotId: string, result: ResultKey, name: string }` | S | `setStillResultName` (L282) |

**Tests to port:** `production-store.test.ts` → `describe("addShotStillResult")`
(L338), `describe("setActiveStillResult")` (L554),
`describe("removeShotStillResult")` (L621), `describe("setStillResultName")`
(L247), `describe("start frame stickiness (#7)")` (L513);
`production-store.trash-still.test.ts` (both describes);
`production-store.direction.test.ts` → `describe("addShotStillResult — INV-D on
the still")` (L67); `production-store.import.test.ts` →
`describe("addShotStillResult — the widened result carry")` (L79).

Invariants these tests pin, which must survive the port:
histories **accumulate** (a generate never replaces); stills and clips are
**independent** (removing a still never touches the shot's clips);
`set_active_still` **moves nothing** — not the start frame, not the end frame.

---

## 7. `clips`

`src/ops/sections/clips.ts` · `apply.clips.test.ts`

| Op | Args | Class | Studio reducer |
| --- | --- | --- | --- |
| `add_clip_result` | `{ shotId: string, result: ShotClipResult, atFront?: boolean }` | S | `addShotClipResult` (L312) |
| `set_active_clip` | `{ shotId: string, result: ResultKey }` | S | `setActiveClipResult` (L330) — **restores that clip's own frames** |
| `remove_clip_result` | `{ shotId: string, result: ResultKey }` | D | `removeShotClipResult` (L344) → the trash |
| `rename_clip_result` | `{ shotId: string, result: ResultKey, name: string }` | S | `setClipResultName` (L292) |

**Tests to port:** `production-store.test.ts` → `describe("addShotClipResult")`
(L718), `describe("setActiveClipResult")` (L1055),
`describe("removeShotClipResult")` (L1247), `describe("setClipResultName")`
(L287); `production-store.direction.test.ts` → `describe("addShotClipResult —
INV-D on the clip (the asymmetric base)")` (L216); `src/store/trash.test.ts` →
`describe("deleting a clip fills the bin")` (L78).

`set_active_clip` restoring the frames the clip was made from is the ONE
asymmetry with stills — port that assertion exactly.

`add_clip_result`'s `result` is stated field by field in zod, like the still
section's: `buildTake` narrows by PRESENCE (`result.x ? { x } : {}`), never by
TYPE, so whatever the schema admits is what lands in the document and on the
canvas node. The three structured channels a still has no mirror of (`beats`,
`directions`, `endTransition`) are gated by the CODEC's own readers rather than
a zod restatement of their vocabulary — same reason `shots`' plan stages are.

---

## 8. `frames` — the sticky frames, the reference channels, the clip markers

`src/ops/sections/frames.ts` · `apply.frames.test.ts`

| Op | Args | Class | Studio reducer |
| --- | --- | --- | --- |
| `set_start_frame` | `{ shotId: string, url: string \| null }` | S | `setShotStartFrame` (L374) |
| `set_end_frame` | `{ shotId: string, url: string \| null }` | S | `setShotEndFrame` (L375) |
| `set_directing_references` | `{ shotId: string, kind: "images" \| "videos" \| "audio", urls: string[] }` | S | `setShotDirectingReferences` (L381) |
| `add_pending_clip` | `{ shotId: string, pending: ShotPendingClip }` | S | `addShotPendingClip(shotId, pending: ShotPendingClip)` (L391) |
| `remove_pending_clip` | `{ shotId: string, jobId: string }` | S | `removeShotPendingClip` (L401) |

**Tests to port:** `production-store.test.ts` → `describe("setShotEndFrame")`
(L1318), `describe("setShotDirectingReferences")` (L1177), `describe("pending
clip markers (add/removeShotPendingClip)")` (L1206), and the frame-stickiness
assertions at L513.

**§6 spells no args for the two marker ops** — the shapes above are read off
the reducer signatures at `production-store-state.ts` L391 and L401. Keep the
parameter NAMES the reducers use (`pending`, `jobId`) so the port reads as a
rename of the call, not a redesign.

**Out of this leg:** the pending STILL markers (`add_pending_still` /
`remove_pending_still`) and `land_job` are **P1.2**. The integrator stubs
`land_job` with `opError("op_not_implemented", …)`; do not implement it here.

Frames are **explicit and sticky**: selecting a result never moves them; only
these ops do.

---

## 9. `voice`

`src/ops/sections/voice.ts` · `apply.voice.test.ts`

| Op | Args | Class | Studio reducer |
| --- | --- | --- | --- |
| `set_voice` | `{ shotId: string, voice: ShotVoice }` | S | `setShotVoice` (L451) |
| `clear_voice` | `{ shotId: string }` | D | `clearShotVoice` (L569) |

**Tests to port:** `production-store.test.ts` →
`describe("setShotVoiceSelection")` (L1352).

---

## 10. `cast` — the role→actor registry

`src/ops/sections/cast.ts` · `apply.cast.test.ts`

| Op | Args | Class | Studio reducer |
| --- | --- | --- | --- |
| `enroll_cast` | `{ member: CastMember }` | S | `addCastMember` (L475) |
| `remove_cast_member` | `{ key: string }` | D | `removeCastMember` (L477) |
| `rename_cast_member` | `{ key: string, displayName: string }` | S | `renameCastMember` (L502) |
| `recast_cast_member` | `{ key: string, actor: { kind: CastKind, assetId: string } }` | S | `recastCastMember` (L514) — **resets the pins; the receipt names how many** |
| `set_cast_role` | `{ key: string, role: string \| null }` | S | `setCastRole` (L526) |
| `mint_cast_from_chips` | — | S | `mintCastFromChips` (L490) |

**Tests to port:** `production-store.cast.test.ts` — all three describes
(`the project cast` L13, `rename and recast` L93, `roles that arrive from
elsewhere (C5)` L311).

`recastCastMember` returns `{ pinsReset: number } | null` (`null` when the role
is not cast). The op turns that into the receipt's parenthetical —
`"Recast @Kira (character) (reset 3 pins)."` — and a `null` return is a
`op_target_missing`, not a silent no-op.

Invariants to preserve: **INV-C** — `castSlug(kind, displayName) === key` for
every row (`cast-keys.ts`); enrollment consults the library **once**, through
`ctx.candidates`, and the pool itself is never stored; a rename rewrites the
role's prose in **every** shot and the receipt/warning says in how many.
Use the codec's own `cast-rename.ts` / `cast-rebind.ts` / `cast-merge.ts` —
never a hand-rolled prose rewrite. Both spellings of a role token must be read:
the enrolled `@<role-slug>` and a bare chip name.

---

## 11. `trash`

`src/ops/sections/trash.ts` · `apply.trash.test.ts`

| Op | Args | Class | Studio reducer |
| --- | --- | --- | --- |
| `restore_trashed` | `{ trashId: string }` | S | `restoreTrashedItem` (L357) |
| `purge_trashed` | `{ trashId: string }` | D — **destroys** | `purgeTrashedClip` (L359) |
| `clear_trash` | — | D — **destroys** | `clearTrash` (L361) |

**Tests to port:** `src/store/trash.test.ts` → `describe("restoring")` (L120),
`describe("deleting a whole SHOT")` (L170), `describe("permanent deletion")`
(L243); `production-store.trash-still.test.ts`.

*Not an operation:* `undoLastDelete` (L368) — the session undo STACK is UI
state. A restore over the wire is `restore_trashed` by id.

---

## 12. `cuts` — the exported versions of the film

`src/ops/sections/cuts.ts` · `apply.cuts.test.ts`

| Op | Args | Class | Studio reducer |
| --- | --- | --- | --- |
| `add_cut` | `{ cut: ProductionCut }` | S | `addCut` (L421) — the caller mints `cut.id` |
| `rename_cut` | `{ id: string, name: string }` | S | `renameCut` (L428) |
| `delete_cut` | `{ id: string }` | D | `deleteCut` (L430) — leaves the save-time tombstone |
| `mark_cut_final` | `{ id: string }` | S | `markCutFinal` (L433) |
| `duplicate_cut` | `{ id: string, newId: string }` | S | `duplicateCut` (L435) |

**Tests to port:** `production-store.test.ts` → `describe("cut versions
(settings.studio.cuts)")` (L1466) and `describe("cut deletion tombstones (the
save-time merge guard)")` (L1521). The tombstone behaviour is load-bearing for
the save-time merge — port it exactly.

---

## Owned elsewhere — do not write these

| File | Owner |
| --- | --- |
| `src/ops/schema.ts` (the discriminated union), `apply.ts`, `inverse.ts` | the integrator |
| `src/describe-ops.ts`, `src/index.ts` | the integrator |
| `src/ops/types.ts`, `errors.ts`, `production.ts`, this file, `src/requests/context.ts` | the scaffold lane |
| `src/fixtures/*`, `src/__tests__/golden*.test.ts` | the fixture lane (P1.0) |
| `src/requests/framing.ts` / `directing.ts` / `export.ts` | the three builder lanes (P1.3) |
| `land_job`, `pendingStills` / `pendingMusic` / `pendingDraft`, `src/land.ts` | P1.2 (not this leg) |
| every codec module (`shot*.ts`, `cast*.ts`, `format/*`, `bundle/*`) | nobody, this leg |
