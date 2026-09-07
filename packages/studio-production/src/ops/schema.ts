/**
 * THE OPERATION VOCABULARY — one discriminated union over every section (§6, D3).
 *
 * Twelve section modules each declare their own zod objects; this file is where
 * they become ONE type. A single `z.discriminatedUnion("op", …)` is what lets a
 * route validate an arbitrary batch in one call, what gives an LLM one schema to
 * emit against instead of fifty tool signatures, and what makes "an op this
 * build does not have" a parse failure rather than a silent no-op.
 *
 * Three things are assembled here and nothing else:
 *
 *  - `StudioProductionOpSchema` — the union, listed member by member. The list
 *    is spelled out rather than spread from `Object.values(OP_SCHEMAS)` because
 *    `z.discriminatedUnion` needs a TUPLE to infer the members; a spread widens
 *    it to an array and the inferred type collapses to `never`. The cost is one
 *    line per operation, and the benefit is that adding a schema without adding
 *    it to the union is visible in the diff.
 *  - `OP_CLASS` — the §6 confirmation class of every operation, `satisfies`-pinned
 *    complete over the union, so a new op cannot reach the MCP annotations or the
 *    copilot's allowlist without someone deciding whether it is safe.
 *  - The three P1.2 placeholders (`land_job`, `add_pending_still`,
 *    `remove_pending_still`). They are in the VOCABULARY now — §6 names them and
 *    the route's schema has to reject a typo differently from a not-yet-built op
 *    — but their handlers refuse with `op_not_implemented` until P1.2 lands the
 *    still markers and the job readers. See `apply.ts`.
 */
import { z } from "zod"

import type { StudioProductionOp as StudioProductionOpWire } from "@nodaro/shared"

import { beatsOpClasses, beatsOpSchemas } from "./sections/beats"
import { castOpClasses, castOpSchemas } from "./sections/cast"
import { clipsOpClasses, clipsOpSchemas } from "./sections/clips"
import { cutsOpClasses, cutsOpSchemas } from "./sections/cuts"
import { foldersOpClasses, foldersOpSchemas } from "./sections/folders"
import { framesOpClasses, framesOpSchemas } from "./sections/frames"
import { looksOpClasses, looksOpSchemas } from "./sections/looks"
import { productionOpClasses, productionOpSchemas } from "./sections/production"
import { shotsOpClasses, shotsOpSchemas } from "./sections/shots"
import { stillsOpClasses, stillsOpSchemas } from "./sections/stills"
import { trashOpClasses, trashOpSchemas } from "./sections/trash"
import { voiceOpClasses, voiceOpSchemas } from "./sections/voice"
import type { OpClass, SectionClasses } from "./types"

// ── the P1.2 placeholders ───────────────────────────────────────────────────

/**
 * The three operations §6 names that this build parses but cannot yet apply.
 *
 * `land_job` turns a finished job into the result the store would have added,
 * and the pending-STILL markers are the half of D5 that lets a framing batch
 * resume without the tab that started it. Both need `Shot.pendingStills` and
 * `landJobResult`, which land in P1.2.
 *
 * They are declared HERE rather than in `sections/frames.ts` because the section
 * lanes own only what they implement: a schema whose handler refuses belongs
 * with the refusal. When P1.2 lands, the two marker ops move into `frames.ts`
 * beside their clip twins, `land_job` gets its own module, and this block goes
 * away — the union and `OP_CLASS` keep the same shape either way.
 */
export const deferredOpSchemas = {
  /** D5: land a finished job into its marker's shot. Idempotent by job id. */
  land_job: z.object({
    op: z.literal("land_job"),
    jobId: z.string().min(1),
  }),
  /**
   * The framing twin of `add_pending_clip`.
   *
   * `pending` is an opaque object until `ShotPendingStill` exists (P1.2 owns
   * `shot.ts`); a placeholder that guessed the fields would be a second
   * definition of the marker, which is exactly what the codec-is-the-source
   * rule forbids.
   */
  // TODO(P1.2): narrow `pending` to `ShotPendingStill` and move to sections/frames.ts.
  add_pending_still: z.object({
    op: z.literal("add_pending_still"),
    shotId: z.string().min(1),
    pending: z.record(z.string(), z.unknown()),
  }),
  /** The framing twin of `remove_pending_clip`, addressed by the job it marks. */
  // TODO(P1.2): move to sections/frames.ts beside `remove_pending_clip`.
  remove_pending_still: z.object({
    op: z.literal("remove_pending_still"),
    shotId: z.string().min(1),
    jobId: z.string().min(1),
  }),
} as const

/** All three are markers or landings — safe, and hidden from the copilot (§6). */
export const deferredOpClasses: SectionClasses<typeof deferredOpSchemas> = {
  land_job: "S",
  add_pending_still: "S",
  remove_pending_still: "S",
}

// ── the schema table ────────────────────────────────────────────────────────

/**
 * Every operation's schema, by name — the twelve sections plus the placeholders.
 *
 * Useful for the route's error messages ("did you mean…") and for the MCP
 * annotation renderer; the UNION below is what actually validates a batch.
 */
export const OP_SCHEMAS = {
  ...productionOpSchemas,
  ...foldersOpSchemas,
  ...shotsOpSchemas,
  ...beatsOpSchemas,
  ...looksOpSchemas,
  ...stillsOpSchemas,
  ...clipsOpSchemas,
  ...framesOpSchemas,
  ...voiceOpSchemas,
  ...castOpSchemas,
  ...trashOpSchemas,
  ...cutsOpSchemas,
  ...deferredOpSchemas,
} as const

// ── the union ───────────────────────────────────────────────────────────────

/** The batch protocol's one schema: `POST …/:id/ops { ops: StudioProductionOp[] }`. */
export const StudioProductionOpSchema = z.discriminatedUnion("op", [
  // 1. production — the document's own settings
  productionOpSchemas.set_name,
  productionOpSchemas.set_thumbnail,
  productionOpSchemas.set_archived,
  productionOpSchemas.select_shot,
  productionOpSchemas.set_film,
  productionOpSchemas.set_music_plan,
  productionOpSchemas.set_music,
  productionOpSchemas.clear_music,
  productionOpSchemas.set_storyboard,
  // 2. folders
  foldersOpSchemas.add_folder,
  foldersOpSchemas.rename_folder,
  foldersOpSchemas.remove_folder,
  foldersOpSchemas.move_shot_to_folder,
  // 3. shots
  shotsOpSchemas.add_shot,
  shotsOpSchemas.remove_shot,
  shotsOpSchemas.duplicate_shot,
  shotsOpSchemas.move_shot,
  shotsOpSchemas.rename_shot,
  shotsOpSchemas.insert_shots,
  shotsOpSchemas.set_plan,
  // 4. beats
  beatsOpSchemas.set_scene_prompt,
  beatsOpSchemas.set_beats,
  beatsOpSchemas.set_end_transition,
  // 5. looks
  looksOpSchemas.set_look,
  looksOpSchemas.set_cast_look,
  looksOpSchemas.set_cast_look_map,
  // 6. stills
  stillsOpSchemas.add_still_result,
  stillsOpSchemas.set_active_still,
  stillsOpSchemas.remove_still_result,
  stillsOpSchemas.rename_still_result,
  // 7. clips
  clipsOpSchemas.add_clip_result,
  clipsOpSchemas.set_active_clip,
  clipsOpSchemas.remove_clip_result,
  clipsOpSchemas.rename_clip_result,
  // 8. frames
  framesOpSchemas.set_start_frame,
  framesOpSchemas.set_end_frame,
  framesOpSchemas.set_directing_references,
  framesOpSchemas.add_pending_clip,
  framesOpSchemas.remove_pending_clip,
  // 9. voice
  voiceOpSchemas.set_voice,
  voiceOpSchemas.clear_voice,
  // 10. cast
  castOpSchemas.enroll_cast,
  castOpSchemas.remove_cast_member,
  castOpSchemas.rename_cast_member,
  castOpSchemas.recast_cast_member,
  castOpSchemas.set_cast_role,
  castOpSchemas.mint_cast_from_chips,
  // 11. trash
  trashOpSchemas.restore_trashed,
  trashOpSchemas.purge_trashed,
  trashOpSchemas.clear_trash,
  // 12. cuts
  cutsOpSchemas.add_cut,
  cutsOpSchemas.rename_cut,
  cutsOpSchemas.delete_cut,
  cutsOpSchemas.mark_cut_final,
  cutsOpSchemas.duplicate_cut,
  // P1.2 — parsed here, refused in `apply.ts`
  deferredOpSchemas.land_job,
  deferredOpSchemas.add_pending_still,
  deferredOpSchemas.remove_pending_still,
])

/** One operation, validated. */
export type StudioProductionOp = z.infer<typeof StudioProductionOpSchema>

/** The discriminator's domain — every op name this build knows. */
export type StudioProductionOpName = StudioProductionOp["op"]

/** Narrow the union to one member by name: `OpOf<"rename_shot">`. */
export type OpOf<K extends StudioProductionOpName> = Extract<
  StudioProductionOp,
  { op: K }
>

// ── the confirmation classes ────────────────────────────────────────────────

/**
 * S safe · D delete · P publish · $ spends credits (§6).
 *
 * Read at DISPATCH — by the MCP annotations and by the copilot's
 * "never without confirmation" rule — so it is a property of the vocabulary
 * rather than of a prompt. The `satisfies` is the point: a section that adds an
 * op without classing it fails the build here, not in a review.
 */
export const OP_CLASS = {
  ...productionOpClasses,
  ...foldersOpClasses,
  ...shotsOpClasses,
  ...beatsOpClasses,
  ...looksOpClasses,
  ...stillsOpClasses,
  ...clipsOpClasses,
  ...framesOpClasses,
  ...voiceOpClasses,
  ...castOpClasses,
  ...trashOpClasses,
  ...cutsOpClasses,
  ...deferredOpClasses,
} satisfies Record<StudioProductionOpName, OpClass>

// ── the wire pin ────────────────────────────────────────────────────────────

/**
 * The type-only twin in `@nodaro/shared` has to stay the same vocabulary.
 *
 * `@nodaro/shared` is Apache and carries no studio domain types, so its union
 * names every operation and every scalar argument but leaves the document's own
 * sub-objects opaque (`StudioOpDocumentJson`). This package is the one that
 * narrows them, and this assertion is what keeps the two from drifting: an op
 * added, renamed or re-argued here without the same edit there fails
 * `npm run build:packages` — the gate CI runs on every PR.
 *
 * The brackets matter. A naked `A extends B` DISTRIBUTES over a union, and a
 * failing member contributes `never`, which then vanishes from the result — so
 * the unbracketed form would pass whenever ANY single member matched. Tupling
 * both sides compares the unions whole.
 *
 * Two pins, because assignability is one-directional and each direction catches
 * a different mistake:
 *
 *  - SHAPES (`StudioProductionOp` → the wire union) catches an operation this
 *    package has that the wire does not, and an argument renamed, retyped or
 *    dropped here.
 *  - NAMES, both ways, catches the mirror mistake: an op name the WIRE declares
 *    that this build cannot apply. Shapes alone cannot see it — a caller would
 *    compose that op happily against the SDK's types and get `op_invalid` back
 *    from the route, which is the worst place to learn it.
 *
 * What neither can see is an argument added HERE and required, but absent from
 * the wire declaration: structural typing lets excess properties through, so a
 * batch typed against the SDK would parse-fail at runtime. That one is caught by
 * review of this file against `studio-production-ops.ts`, which is why the two
 * are edited together.
 */
type UnionPin<A, B> = [A] extends [B] ? true : never
type MutualPin<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

const _opsAreTheWireShape: UnionPin<
  StudioProductionOp,
  StudioProductionOpWire
> = true
const _opsAreTheWireVocabulary: MutualPin<
  StudioProductionOpName,
  StudioProductionOpWire["op"]
> = true
void _opsAreTheWireShape
void _opsAreTheWireVocabulary
