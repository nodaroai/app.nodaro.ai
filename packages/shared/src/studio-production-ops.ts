/**
 * The WRITE protocol of `/v1/studio/productions` — TYPES ONLY.
 *
 * Every change to a studio production, from any writer, is one of the semantic
 * operations below (spec D3). Not a JSON Patch against `settings.studio` — a
 * patch is positional, so a concurrent insert silently corrupts it — and not a
 * whole-document PUT, which is last-write-wins forever. An operation addresses
 * by stable KEY, which is what lets the server apply a batch that was composed
 * against a slightly older document: the editor, an MCP agent and the copilot
 * all hold the same production open, and they must be able to write to it at
 * the same time without clobbering one another.
 *
 * This union lives here, in the Apache package, for the same reason
 * `studio-production-wire.ts` does: the SDK is typed against `@nodaro/shared`,
 * and an SDK caller composing an `ops` batch needs to know what it may send.
 * The IMPLEMENTATION — the zod schemas, the handlers, `applyOps`, the receipts —
 * lives in the FSL-licensed `@nodaro/studio-production`, which pins its own
 * narrowed union against this one at build time (`ops/schema.ts`, "the wire
 * pin"), so the two cannot drift apart in silence.
 *
 * ## Reading the union
 *
 * - The `op` field is the discriminator; narrowing on it gives the exact args.
 * - Scalars, ids, urls, enums and booleans are typed exactly.
 * - The document's own sub-objects — a scene plan, a cast member, a generated
 *   result, a cut — are {@link StudioOpDocumentJson}, opaque here and narrowed
 *   by the package that owns them. Their real type name is in each doc comment.
 * - Ids that a LATER operation can address are minted by the CALLER and carried
 *   in the operation (`add_shot { id }`, `add_folder { id }`, `add_cut`'s
 *   `cut.id`, `duplicate_shot { newId }`). That is what makes a client's
 *   optimistic state and the server's canonical document agree on every id the
 *   client will ever reference.
 * - Positions appear exactly twice: `move_shot`'s `toIndex` and the
 *   `afterShotId` of `add_shot` / `insert_shots`. Everything else is a key.
 */

/**
 * A sub-object of the production document, carried opaquely.
 *
 * `object` rather than `Record<string, unknown>`, and the difference is not
 * cosmetic: TypeScript grants an implicit index signature to object literal and
 * mapped types but NOT to interfaces, so half of the real payloads
 * (`ScenePlan`, `ShotClipResult`, `SerializedProduction`, `ShotPendingClip`)
 * would fail to satisfy a `Record` alias and the build-time pin in
 * `@nodaro/studio-production` could not hold. `object` still says the useful
 * thing — this field takes a JSON object, not a string — while leaving the
 * shape to the package that owns it.
 *
 * Re-declaring those shapes here is not an option on either count: a second
 * definition of the document is the disagreement this contract exists to end,
 * and publishing the studio's domain types under Apache would be an
 * irrevocable grant of code deliberately placed one tier down.
 */
export type StudioOpDocumentJson = object

/**
 * The CONFIRMATION class of an operation (spec §6).
 *
 * `S` safe · `D` delete (trash-backed unless the operation is one of the two
 * that destroy) · `P` publish · `$` spends credits. Read at DISPATCH — by the
 * MCP tool annotations and by the copilot's "never without confirmation" rule —
 * so it is a property of the vocabulary rather than of a prompt.
 */
export type StudioOpClass = "S" | "D" | "P" | "$"

/**
 * One operation, as it goes over the wire.
 *
 * Grouped by section in the order `@nodaro/studio-production` assembles them.
 */
export type StudioProductionOp =
  // ── 1. the production's own settings ──────────────────────────────────────
  /** Rename the production. A workflow ROW column, applied in the same write. */
  | { op: "set_name"; name: string }
  /** Set or clear (`null`) the dashboard card image. A ROW column. */
  | { op: "set_thumbnail"; url: string | null }
  /** The dashboard SOFT-hide: the workflow and its graph stay. */
  | { op: "set_archived"; archived: boolean }
  /** Which shot the editor opens on. */
  | { op: "select_shot"; shotId: string }
  /** The film-wide look layer. `LookSelectionMap` — catalog IDS, never prose. */
  | { op: "set_film"; film: StudioOpDocumentJson }
  /** The soundtrack PLAN (prompt + pickers). `PlanMusic`; `null` clears it. */
  | { op: "set_music_plan"; plan: StudioOpDocumentJson | null }
  /** The rendered soundtrack muxed over the export. `ProductionMusic`. */
  | { op: "set_music"; music: StudioOpDocumentJson }
  /** Drop the rendered soundtrack. The plan beside it is untouched. */
  | { op: "clear_music" }
  /**
   * MERGE a patch into the Storyboard tab's state (`brief` lives in it).
   * `Partial<StoryboardSettings>` — a key that is absent is left alone.
   */
  | { op: "set_storyboard"; patch: StudioOpDocumentJson }

  // ── 2. folders ────────────────────────────────────────────────────────────
  /** A new timeline folder, at the caller's id. */
  | { op: "add_folder"; id: string; name: string }
  | { op: "rename_folder"; id: string; name: string }
  /** Remove the folder. Its shots stay; they fall back to no folder. */
  | { op: "remove_folder"; id: string }
  /** Move one shot into a folder, or (`null`) out of every folder. */
  | { op: "move_shot_to_folder"; shotId: string; folderId: string | null }

  // ── 3. shots ──────────────────────────────────────────────────────────────
  /** A new shot at the caller's id, after `afterShotId` (else at the end). */
  | {
      op: "add_shot"
      id: string
      afterShotId?: string
      name?: string
      /** `ScenePlan` — the authored framing / motion / voice, before it renders. */
      plan?: StudioOpDocumentJson
    }
  /** Delete a shot INTO THE BIN, restorable by its trash id. */
  | { op: "remove_shot"; id: string }
  /** Copy a shot, with both result histories, at the caller's `newId`. */
  | { op: "duplicate_shot"; id: string; newId: string }
  /** Reorder to a timeline position; out-of-range clamps to the ends. */
  | { op: "move_shot"; id: string; toIndex: number }
  | { op: "rename_shot"; id: string; name: string }
  /**
   * Paste a serialized production's shots into the timeline.
   *
   * `graph` is a `SerializedProduction` — the import/append and bundle-paste
   * primitive. Every id in it is RE-MINTED, so the same bundle can be pasted
   * twice into one production.
   */
  | { op: "insert_shots"; graph: StudioOpDocumentJson; afterShotId?: string }
  /**
   * Per-stage MERGE of a shot's scene plan: a stage that is absent is left
   * alone, a stage that is `null` is cleared. `PlanFrame` / `PlanMotion` /
   * `PlanVoice`.
   */
  | {
      op: "set_plan"
      shotId: string
      frame?: StudioOpDocumentJson | null
      motion?: StudioOpDocumentJson | null
      voice?: StudioOpDocumentJson | null
    }

  // ── 4. the scene's prose and its cues ─────────────────────────────────────
  /** The scene's own prose, prepended to the shot's prompt at render. */
  | { op: "set_scene_prompt"; shotId: string; text: string }
  /** The whole beat list, replaced. `ShotBeat[]` — timed windows with cues. */
  | { op: "set_beats"; shotId: string; beats: StudioOpDocumentJson[] }
  /** How the scene's last frames go out. `ShotTransition`; `null` clears it. */
  | {
      op: "set_end_transition"
      shotId: string
      transition: StudioOpDocumentJson | null
    }

  // ── 5. the look layers ────────────────────────────────────────────────────
  /** The scene's look layer. `LookSelectionMap` — catalog ids, never prose. */
  | { op: "set_look"; shotId: string; look: StudioOpDocumentJson }
  /** Pin which view of one cast member this scene uses; `null` clears the pin. */
  | {
      op: "set_cast_look"
      shotId: string
      key: string
      look: StudioOpDocumentJson | null
    }
  /** Replace every cast pin on the scene at once. `CastLookMap`. */
  | { op: "set_cast_look_map"; shotId: string; map: StudioOpDocumentJson }

  // ── 6. stills ─────────────────────────────────────────────────────────────
  /**
   * Append a still to the shot's history (uploads, edited media, a landing).
   *
   * Histories ACCUMULATE — this never replaces one. `atFront` inserts it as
   * image #1 and makes it active. `ShotStillResult`.
   */
  | {
      op: "add_still_result"
      shotId: string
      result: StudioOpDocumentJson
      atFront?: boolean
    }
  /** Show a past still. Moves NOTHING — not the start frame, not the end frame. */
  | { op: "set_active_still"; shotId: string; result: string }
  /** Delete one still INTO THE BIN. Never touches the shot's clips. */
  | { op: "remove_still_result"; shotId: string; result: string }
  /** Name a still; blank clears the name back to its derived label. */
  | { op: "rename_still_result"; shotId: string; result: string; name: string }

  // ── 7. clips ──────────────────────────────────────────────────────────────
  /** Append a take to the shot's clip history. `ShotClipResult`. */
  | {
      op: "add_clip_result"
      shotId: string
      result: StudioOpDocumentJson
      atFront?: boolean
    }
  /**
   * Show a past take — and RESTORE the start/end frames it was animated from.
   * The one asymmetry with stills, and it is deliberate.
   */
  | { op: "set_active_clip"; shotId: string; result: string }
  /** Delete one take INTO THE BIN. Never touches the shot's stills. */
  | { op: "remove_clip_result"; shotId: string; result: string }
  /** Name a take; blank clears the name back to "Take N". */
  | { op: "rename_clip_result"; shotId: string; result: string; name: string }

  // ── 8. frames, reference channels and markers ─────────────────────────────
  /** The sticky start frame; `null` clears it. Selecting a result never moves it. */
  | { op: "set_start_frame"; shotId: string; url: string | null }
  /** The sticky end frame; `null` clears it. Model-gated at render. */
  | { op: "set_end_frame"; shotId: string; url: string | null }
  /** Replace one directing reference channel. An empty list clears that kind. */
  | {
      op: "set_directing_references"
      shotId: string
      kind: "images" | "videos" | "audio"
      urls: string[]
    }
  /** Record an animate that is still running. `ShotPendingClip`. */
  | { op: "add_pending_clip"; shotId: string; pending: StudioOpDocumentJson }
  /** Drop an animate marker, by the job it marks. */
  | { op: "remove_pending_clip"; shotId: string; jobId: string }
  /**
   * Record a framing batch that is still running. `ShotPendingStill`.
   *
   * Declared in the vocabulary; refused with `op_not_implemented` until the
   * still markers land (spec D5).
   */
  | { op: "add_pending_still"; shotId: string; pending: StudioOpDocumentJson }
  /** Drop a framing marker, by the job it marks. Refused until D5 lands. */
  | { op: "remove_pending_still"; shotId: string; jobId: string }

  // ── 9. the scene's voiceover ──────────────────────────────────────────────
  /** The generated voiceover and its tuned delivery. `ShotVoice`. */
  | { op: "set_voice"; shotId: string; voice: StudioOpDocumentJson }
  | { op: "clear_voice"; shotId: string }

  // ── 10. the cast — the role→actor registry ────────────────────────────────
  /**
   * Enrol a role. `CastMember`; the key is derived from kind + display name
   * (INV-C), and the caller's entity library is consulted once, at enrolment.
   */
  | { op: "enroll_cast"; member: StudioOpDocumentJson }
  | { op: "remove_cast_member"; key: string }
  /** Rename a role — and rewrite its prose in every shot that names it. */
  | { op: "rename_cast_member"; key: string; displayName: string }
  /** Point a role at a different actor. RESETS the look pins; the receipt says how many. */
  | {
      op: "recast_cast_member"
      key: string
      actor: { kind: string; assetId: string }
    }
  /** The role phrase a reference rides with ("background"); `null` clears it. */
  | { op: "set_cast_role"; key: string; role: string | null }
  /** Enrol every bound chip in the production's prose that is not cast yet. */
  | { op: "mint_cast_from_chips" }

  // ── 11. the bin ───────────────────────────────────────────────────────────
  /** Put a deleted shot, still or take back where it came from. */
  | { op: "restore_trashed"; trashId: string }
  /** Destroy one bin entry. One of the only two operations that destroy media. */
  | { op: "purge_trashed"; trashId: string }
  /** Empty the bin. The other one. */
  | { op: "clear_trash" }

  // ── 12. cuts — the exported versions of the film ──────────────────────────
  /** Record an exported cut. `ProductionCut`; the caller mints `cut.id`. */
  | { op: "add_cut"; cut: StudioOpDocumentJson }
  | { op: "rename_cut"; id: string; name: string }
  /** Delete a cut (and leave the save-time tombstone the merge guard reads). */
  | { op: "delete_cut"; id: string }
  /** Mark a cut as the final one. */
  | { op: "mark_cut_final"; id: string }
  /** Copy a cut at the caller's `newId`. */
  | { op: "duplicate_cut"; id: string; newId: string }

  // ── landing a finished job ────────────────────────────────────────────────
  /**
   * Turn a finished job into the result the editor would have added (D5).
   *
   * Idempotent by job id, `atFront` honoured from the marker, a job with no
   * marker a typed no-op. Declared in the vocabulary; refused with
   * `op_not_implemented` until the marker readers land.
   */
  | { op: "land_job"; jobId: string }

/** Every operation name this vocabulary knows. */
export type StudioProductionOpName = StudioProductionOp["op"]

/** Narrow the union to one member by name: `StudioOpOf<"rename_shot">`. */
export type StudioOpOf<K extends StudioProductionOpName> = Extract<
  StudioProductionOp,
  { op: K }
>
