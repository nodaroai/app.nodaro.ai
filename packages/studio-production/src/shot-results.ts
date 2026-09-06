/**
 * A shot's RESULT rows — one {@link ShotStillResult} per generate-image
 * generation, one {@link ShotClipResult} per generate-video take. Each carries
 * the CONTEXT a strip-click restores (prompt, model, frames, references, look
 * ids), which is why the fields live on the result and not on the still/clip.
 *
 * Extracted from `shot.ts` (which re-exports both) — same frozen contract.
 */
import type { ConnectedReference } from "@nodaro/shared"
import type { SubjectFields } from "@nodaro/prompts"

import type { VoiceDirection } from "./voice-direction"

import type { LookSelectionMap, ShotBeat, ShotTransition } from "./shot"

/** One generation in a shot's results list (a single generate-image result). */
export interface ShotStillResult {
  /** Result image URL (R2). */
  readonly url: string
  /** Job that produced it (→ the canvas `GeneratedResult.jobId`); absent for uploads. */
  readonly jobId?: string
  /**
   * User-given name for this image (the rename action), e.g. "Hero astronaut".
   * Absent ⇒ the UI derives a positional "Ref N" label (see {@link
   * stillDisplayName} / {@link productionImageRefs}). Captured onto an
   * image-reference CHIP at insert time, so the chip's label is stable even if a
   * later index shift would renumber the derived default. Persisted per-result
   * (shot-graph) + KEPT by {@link buildStill}'s keep-predicate so a lone named
   * still doesn't collapse it away.
   */
  readonly name?: string
  /** The prompt that produced it — loaded back into the composer on strip-click. */
  readonly prompt?: string
  /**
   * The NEGATIVE prompt sent with this generation (models with native
   * `negativePrompt` support — see model-menu's `negativePromptSupported`) —
   * restored into the composer's Negative-prompt field on strip-click, exactly
   * like {@link prompt}. Absent when the model has no native support or the
   * field was empty.
   */
  readonly negativePrompt?: string
  /** The image model that produced it — restored on strip-click. */
  readonly provider?: string
  /**
   * The reference image URLs sent to the model for this generation — restored
   * into the composer's manual-refs channel on strip-click. (Flat URLs — the
   * exact reference images that were sent.)
   */
  readonly referenceImageUrls?: ReadonlyArray<string>
  /**
   * The BOUND `@`-entity references (characters / locations / props) used for
   * this generation — restored on strip-click so the composer rebuilds the
   * entity CHIPS (not just plain text), keeping the bindings intact for a
   * re-generate. Carries identity (slug/canonical), unlike `referenceImageUrls`.
   */
  readonly references?: ReadonlyArray<ConnectedReference>
  /**
   * The saved Filerobot design-state URL (R2) for a still that was edited in the
   * Filerobot "Edit image" editor — restored on re-edit to REBUILD the Filerobot
   * layers/adjustments instead of starting from the flat rendered image. Present
   * only on a Filerobot-edited still result. SERIALIZED to the graph (shot-graph
   * `imageNode` -> `readResults`) so it survives a project reload, mirroring
   * {@link references}. This is the still-side mirror of
   * {@link ShotClipResult.freecutProjectUrl}. Like the other per-result fields it
   * lives ON the result (not still-level), so a lone edited still MUST keep its
   * results list (buildStill's keep-predicate) — else the collapse to the bare
   * `{ url }` shape would drop it.
   */
  readonly filerobotDesignStateUrl?: string
  /**
   * The technical levers THIS option was generated with — the aspect ratio, the
   * resolution/quality tier, and how many candidates its batch fanned out.
   *
   * Results already recorded their creative context (prompt / model / refs);
   * these three were the gap that made "take the settings of scene 3" a partial
   * answer. Stamped at completion from the submit, so they describe what was
   * actually sent — never a live lever that has moved since. Absent on every
   * result generated before this shipped, and on an upload; a copy applies what
   * is there and leaves the rest alone.
   */
  readonly aspectRatio?: string
  readonly resolution?: string
  readonly count?: number
  /**
   * PROMPT-FORMAT marker — STRUCTURED FIELDS ARE PRESENT (R62/A10). `2` ⇒ this
   * result carries a structured channel of its own: {@link look} ids,
   * {@link subject} ids, or both. Normally that is the same statement as "the
   * prose is raw" — {@link prompt} holds the RAW editor prose — and ABSENT ⇒
   * LEGACY, `prompt` holding text with the catalog clauses already BAKED IN, so
   * restoring it must not also re-arm the live look ids (D4: a baked prompt plus
   * live ids folds the same hint twice — the exact bug class the structured
   * pipeline exists to kill).
   *
   * THE ONE PLACE THE TWO READINGS PART is a D4-suppressed stage submitting in
   * STRUCTURED mode. No legacy prompt ever baked a subject fold, so those ids
   * are this result's own and this marker is the only record of them — it IS
   * stamped there. Such a result carries `subject` with NO `look`, which is what
   * keeps it safe on the graph: `resultDirection`'s gate emits no `direction`
   * key, so nothing folds twice. The residual is the readers that mean "the
   * prose is baked" — the composer's `seedSuppresses`, `recoverLegacyResultLook`
   * and the plan exporter's `promptBaked` — which read that one result as raw.
   * No second signal for baked-ness exists on a result today (A10 residual).
   */
  readonly promptFormat?: 2
  /**
   * The look ids THIS generation was projected from — STUDIO picker keys (the
   * {@link Shot.look} vocabulary). Named `look`, not `direction`, to avoid
   * colliding with {@link ShotClipResult.directions} (the `/` voice-direction
   * chips).
   *
   * A restore DOES re-arm it — through the store, not the seed: selecting a
   * result writes its layers back onto the production film and the scene's own
   * look (spec 2026-09-01-asset-look-provenance D-A2), while the composer seed
   * still carries only {@link promptFormat}, so a legacy result stays
   * suppressed exactly as before (INV-A2). The other readers are scene COPY
   * ("take the settings of scene 3"), a shot RECIPE, and the wire-reproduction
   * guard.
   *
   * THE EXACT SELECTION THE RUN WENT OUT WITH — never the live editor selection
   * at some later moment. For a still: the merged film + scene map that fed the
   * image projection. For a clip: that same merged map PLUS `cameraMotionId`,
   * MINUS `transitionId` when the shots owned transitions at submit. That is
   * what makes `directionWireFields(result.look, surface)` reproduce the wire
   * byte-for-byte (pinned by the round-trip guard in Composer.test).
   */
  readonly look?: LookSelectionMap
  /**
   * The LAYER SPLIT of {@link look} as it stood AT SUBMIT (D-A1) — `filmLook`
   * is the production-wide FILM layer, `sceneLook` this scene's own overrides.
   * {@link look} stays the merged echo (it reproduces the wire, and it is what
   * a pre-D-A1 result has); these two say WHICH SURFACE each id came from, so a
   * restore can re-arm the FILM strip and the SCENE grid separately instead of
   * guessing by key.
   *
   * INV-A3: `{ ...filmLook, ...sceneLook }` equals {@link look}, scene winning
   * on a shared key — the editor's own merge order.
   *
   * PRESENCE IS THE DISCRIMINATOR: either field present ⇒ layered, and the
   * ABSENT sibling means that layer was genuinely EMPTY at submit. BOTH absent
   * while `look` is set ⇒ a merged-only result (pre-D-A1, or a shell with no
   * layers — classic/mobile hold one ephemeral picker object), which splits by
   * the documented `FILM_LOOK_KEYS` heuristic (D-A3) instead. Claiming an empty
   * film layer there would make a restore CLEAR the production's film.
   *
   * SUBMIT-TIME like everything else here (INV-A1) — never the live layers at
   * land time; jobs are concurrent and the layers move while one renders.
   */
  readonly filmLook?: LookSelectionMap
  readonly sceneLook?: LookSelectionMap
  /**
   * The SUBJECT ids this run was sent with — the platform-keyed Person /
   * Styling / prop bag `/v1/generate-image` and `/v1/generate-video` fold
   * server-side, the subject twin of {@link look}. Echoed for the same reason:
   * once the clauses stop riding the prose, this record is the only thing a
   * restore can re-arm the Subject pickers from.
   */
  readonly subject?: SubjectFields
}

/** One generation in a shot's clip results list (a single generate-video result). */
export interface ShotClipResult {
  /** Result video URL (R2). */
  readonly url: string
  /** Job that produced it (→ the canvas `GeneratedResult.jobId`); absent for legacy. */
  readonly jobId?: string
  /**
   * User-given name for this take (the clips-rail rename action), e.g. "Crash
   * into frame". The video mirror of {@link ShotStillResult.name}: takes of one
   * shot share a start frame so their thumbnails are identical — the name is how
   * you tell them apart beyond the length badge. Absent ⇒ the UI derives a
   * positional "Take N" ({@link clipTakeDisplayName}). Persisted per-result
   * (shot-graph) + KEPT by {@link buildClip}'s keep-predicate so a lone named
   * take doesn't collapse it away.
   */
  readonly name?: string
  /** The directing prompt that produced it — loaded back into the composer on strip-click. */
  readonly prompt?: string
  /**
   * The NEGATIVE prompt sent with this render (models with native
   * `negativePrompt` support — Kling/Wan families) — restored into the
   * directing composer's Negative-prompt field on clip-select, exactly like
   * {@link prompt}. The video mirror of {@link ShotStillResult.negativePrompt}.
   */
  readonly negativePrompt?: string
  /**
   * The video model + clip length THIS result was generated with — restored into
   * the directing composer on clip-select (the video mirror of a still result's
   * `provider`). Per-result (not just clip-level) so stepping to a past clip
   * brings back the exact model + duration it was made with, even when sibling
   * clips used different ones.
   */
  readonly provider?: string
  readonly duration?: number
  /**
   * The start/end frame URLs this clip was generated FROM (restored when the
   * user steps back to this video — spec #9c). Each clip remembers its source
   * frames so selecting a past video brings back the frames it was made from.
   */
  readonly startFrameUrl?: string
  readonly endFrameUrl?: string
  /**
   * The reference image URLs this clip was generated FROM in "references" input
   * mode (reference-image-capable video models, e.g. Seedance 2). They COEXIST
   * with the frames now (spec D27 — the server folds a start/end frame into the
   * references and writes the first/last-frame note itself), so a references take
   * records the end frame it was made with and restores both. Restored — together
   * with the directing input mode — when the user steps back to this clip.
   */
  readonly referenceImageUrls?: ReadonlyArray<string>
  /**
   * The reference VIDEO URLs this clip was generated FROM (references mode,
   * video-reference-capable models, e.g. Seedance 2's `reference_video_urls`).
   * Restored alongside {@link referenceImageUrls} on clip-select.
   */
  readonly referenceVideoUrls?: ReadonlyArray<string>
  /**
   * The reference AUDIO URLs this clip was generated FROM (references mode,
   * audio-reference-capable models, e.g. Seedance 2's `reference_audio_urls` —
   * audio-driven motion). Restored alongside the other reference kinds.
   */
  readonly referenceAudioUrls?: ReadonlyArray<string>
  /**
   * The BOUND `@`-entity references (characters / locations / props) used for this
   * clip's directing prompt — restored on clip-select so the composer rebuilds the
   * entity CHIPS (not just plain text). Mirrors {@link ShotStillResult.references};
   * their portraits also ride the animate as reference images (so the right people
   * render). SERIALIZED to the graph (shot-graph `readReferences`) so the chips
   * survive a project reload, not just an in-memory stage switch.
   */
  readonly references?: ReadonlyArray<ConnectedReference>
  /**
   * The SEMANTIC `/` voice directions of the directing prompt (tone / SFX /
   * ambience / music chips). The persisted prompt keeps their NEUTRAL `[text]`
   * form; the model-specific syntax is resolved only at submit
   * (`renderDirectionsIntoPrompt`), so the same clip re-renders correctly after
   * a model switch. Restored on clip-select (blue chips rebuild) and SERIALIZED
   * to the graph (`readVoiceDirections` in `voice-direction`) like
   * {@link references}.
   */
  readonly directions?: ReadonlyArray<VoiceDirection>
  /**
   * The timed SHOTS this take was authored from (editor-v2 motion beats).
   *
   * Without them, selecting a past take restored its prompt while the shots
   * that produced it stayed as they were — so "+ New clip", which clears them
   * for a fresh pass, would have been a one-way door.
   */
  readonly beats?: ReadonlyArray<ShotBeat>
  /**
   * The scene's GENERIC PROMPT this take was authored under (see
   * {@link Shot.scenePrompt}) — recorded so selecting a past take restores the
   * scene description that produced it instead of leaving a later one standing
   * over it. Absent on a take made without one, which is what CLEARS it.
   */
  readonly scenePrompt?: string
  /**
   * The scene's WAY OUT this take was folded with (see {@link Shot.endTransition}) —
   * on the result for the same reason as {@link scenePrompt}, and with the same
   * absent-means-made-without-one rule.
   *
   * Load-bearing beyond the restore: the take's {@link prompt} carries this
   * node's CLAUSE baked into its prose, so the seed strips it back out
   * (`lib/beats`' `stripEndTransition`) and only the take knows which node to
   * strip. Without the pair the composer would append the clause to a prose
   * that already ends with it — once more per generate cycle (the D4
   * fold-twice class).
   */
  readonly endTransition?: ShotTransition
  /**
   * The saved FreeCut project's URL (R2) for a clip that was edited in the FreeCut
   * editor — restored on re-edit to REBUILD the FreeCut layers (timeline, overlays,
   * trims) instead of starting from the flat rendered video. Present only on a
   * FreeCut-edited clip result. SERIALIZED to the graph (shot-graph `videoNode` ->
   * `readClipResults`) so it survives a project reload, mirroring {@link references}.
   * Like the other per-result fields it lives ON the result (not clip-level), so a
   * lone edited clip MUST keep its results list (buildClip's keep-predicate) — else
   * the collapse to the bare `{ url }` shape would drop it.
   */
  readonly freecutProjectUrl?: string
  /**
   * The aspect ratio + resolution tier THIS take was rendered at — the video
   * mirror of {@link ShotStillResult.aspectRatio} / `resolution` (the model and
   * the length already lived here). Stamped at completion from the submit.
   */
  readonly aspectRatio?: string
  readonly resolution?: string
  /**
   * PROMPT-FORMAT marker — STRUCTURED FIELDS ARE PRESENT (R62/A10). `2` ⇒ this
   * result carries a structured channel of its own: {@link look} ids,
   * {@link subject} ids, or both. Normally that is the same statement as "the
   * prose is raw" — {@link prompt} holds the RAW editor prose — and ABSENT ⇒
   * LEGACY, `prompt` holding text with the catalog clauses already BAKED IN, so
   * restoring it must not also re-arm the live look ids (D4: a baked prompt plus
   * live ids folds the same hint twice — the exact bug class the structured
   * pipeline exists to kill).
   *
   * THE ONE PLACE THE TWO READINGS PART is a D4-suppressed stage submitting in
   * STRUCTURED mode. No legacy prompt ever baked a subject fold, so those ids
   * are this result's own and this marker is the only record of them — it IS
   * stamped there. Such a result carries `subject` with NO `look`, which is what
   * keeps it safe on the graph: `resultDirection`'s gate emits no `direction`
   * key, so nothing folds twice. The residual is the readers that mean "the
   * prose is baked" — the composer's `seedSuppresses`, `recoverLegacyResultLook`
   * and the plan exporter's `promptBaked` — which read that one result as raw.
   * No second signal for baked-ness exists on a result today (A10 residual).
   */
  readonly promptFormat?: 2
  /**
   * The look ids THIS generation was projected from — STUDIO picker keys (the
   * {@link Shot.look} vocabulary). Named `look`, not `direction`, to avoid
   * colliding with {@link ShotClipResult.directions} (the `/` voice-direction
   * chips).
   *
   * A restore DOES re-arm it — through the store, not the seed: selecting a
   * result writes its layers back onto the production film and the scene's own
   * look (spec 2026-09-01-asset-look-provenance D-A2), while the composer seed
   * still carries only {@link promptFormat}, so a legacy result stays
   * suppressed exactly as before (INV-A2). The other readers are scene COPY
   * ("take the settings of scene 3"), a shot RECIPE, and the wire-reproduction
   * guard.
   *
   * THE EXACT SELECTION THE RUN WENT OUT WITH — never the live editor selection
   * at some later moment. For a still: the merged film + scene map that fed the
   * image projection. For a clip: that same merged map PLUS `cameraMotionId`,
   * MINUS `transitionId` when the shots owned transitions at submit. That is
   * what makes `directionWireFields(result.look, surface)` reproduce the wire
   * byte-for-byte (pinned by the round-trip guard in Composer.test).
   */
  readonly look?: LookSelectionMap
  /**
   * The clip mirror of {@link ShotStillResult.filmLook} — read that doc. The
   * clip's {@link look} is the merged map PLUS `cameraMotionId` and MINUS
   * `transitionId` when the shots owned transitions, and the split carries
   * those same carve-outs so INV-A3 holds here too: the camera motion rides
   * `sceneLook` (it is a per-scene/clip pick, never the film's).
   */
  readonly filmLook?: LookSelectionMap
  readonly sceneLook?: LookSelectionMap
  /**
   * The SUBJECT ids this run was sent with — the platform-keyed Person /
   * Styling / prop bag `/v1/generate-image` and `/v1/generate-video` fold
   * server-side, the subject twin of {@link look}. Echoed for the same reason:
   * once the clauses stop riding the prose, this record is the only thing a
   * restore can re-arm the Subject pickers from.
   */
  readonly subject?: SubjectFields
}
