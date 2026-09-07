/**
 * The WIRE mappers — one live record → the plain JSON actually persisted, plus
 * the deep-copies the serializer leans on so the persisted blob can never alias
 * store state. Each is the exact inverse of a `shot-graph-read*` narrower: a
 * field written here and not read back there is ERASED on the next save.
 */
import type { ScenePlan } from "./scene-plan"
import type {
  LookSelectionMap,
  ShotClipResult,
  ShotStillResult,
} from "./shot"
import type { TrashedItem } from "./trash"

/**
 * ONE still result → its persisted (wire) form. The exact inverse of
 * {@link readStillResults}, and the single writer of that shape: the canvas
 * node's `generatedResults` and the trash bin's stored results both go through
 * here, so a field can never round-trip in one and be silently dropped by the
 * other. (Mirrors {@link clipResultToWire}.)
 */
export function stillResultToWire(r: ShotStillResult): Record<string, unknown> {
  return {
    url: r.url,
    ...(r.jobId ? { jobId: r.jobId } : {}),
    // Per-result inputs (Nodaro ignores these extras; we read them back so a
    // strip-click reloads the generation's prompt + model + refs into the
    // composer). Copy the refs array; omit when empty so refs-less results
    // stay byte-identical (the single-result round-trip invariant).
    ...(r.prompt ? { prompt: r.prompt } : {}),
    // The negative prompt this generation was sent with (native-support
    // models) — read back so a strip-click restores it after a reload.
    ...(r.negativePrompt ? { negativePrompt: r.negativePrompt } : {}),
    ...(r.provider ? { provider: r.provider } : {}),
    // The user-given image name (Nodaro ignores this extra; we read it back) so
    // a renamed image keeps its label across a reload and an image CHIP that
    // references it stays named. Omitted when absent (byte-identical round-trip).
    ...(r.name ? { name: r.name } : {}),
    ...(r.referenceImageUrls?.length
      ? { referenceImageUrls: [...r.referenceImageUrls] }
      : {}),
    // The bound `@`-entity chips (Nodaro ignores this extra; we read it back) so
    // the chips REBUILD on a project reload instead of degrading to flat text.
    ...(r.references?.length ? { references: [...r.references] } : {}),
    // The saved Filerobot design-state url (Nodaro ignores this extra; we read
    // it back) so re-editing a Filerobot-edited still after a project reload
    // REBUILDS the Filerobot layers/adjustments instead of starting from the flat
    // rendered image. Still-side mirror of videoNode's freecutProjectUrl.
    ...(r.filerobotDesignStateUrl
      ? { filerobotDesignStateUrl: r.filerobotDesignStateUrl }
      : {}),
    // The technical levers this option was made with (Nodaro ignores these
    // extras; we read them back) so "copy the settings of scene 3" survives a
    // reload. Omitted when absent — a legacy result stays byte-identical.
    ...(r.aspectRatio ? { aspectRatio: r.aspectRatio } : {}),
    ...(r.resolution ? { resolution: r.resolution } : {}),
    ...(r.count !== undefined ? { count: r.count } : {}),
    // The prompt-format marker + the look ids / subject ids this
    // generation was projected from. Read back by the matching reader below —
    // a field written here and NOT read there is erased on the next debounced
    // save (the readVoice lesson).
    ...(r.promptFormat !== undefined ? { promptFormat: r.promptFormat } : {}),
    ...(r.look ? { look: copyLookMap(r.look) } : {}),
    // …and its LAYER SPLIT (D-A1) — which half of the merged map above came
    // from the FILM strip and which from this scene. Same read-it-back-or-be-
    // erased contract as everything else on this record.
    ...(r.filmLook ? { filmLook: copyLookMap(r.filmLook) } : {}),
    ...(r.sceneLook ? { sceneLook: copyLookMap(r.sceneLook) } : {}),
    ...(r.subject ? { subject: { ...r.subject } } : {}),
  }
}
/**
 * ONE clip result → its persisted (wire) form. The exact inverse of
 * {@link readClipResults}, and the single writer of that shape: the canvas node's
 * `generatedResults` and the trash bin's stored results both go through here, so a
 * field can never round-trip in one and be silently dropped by the other.
 *
 * Absent fields are OMITTED (never written as `undefined`) so a frame-less or
 * pre-feature clip stays byte-identical — the single-result round-trip invariant.
 * Nodaro ignores the studio-only extras; we read them back ourselves, and a field
 * written here but NOT read back by `readClipResults` would be ERASED on the next
 * save (the readVoice lesson).
 */
export function clipResultToWire(r: ShotClipResult): Record<string, unknown> {
  return {
    url: r.url,
    ...(r.jobId ? { jobId: r.jobId } : {}),
    // The user-given take name (the clips-rail rename).
    ...(r.name ? { name: r.name } : {}),
    ...(r.prompt ? { prompt: r.prompt } : {}),
    // The negative prompt this render was sent with (native-support models).
    ...(r.negativePrompt ? { negativePrompt: r.negativePrompt } : {}),
    ...(r.provider ? { provider: r.provider } : {}),
    ...(r.duration !== undefined ? { duration: r.duration } : {}),
    ...(r.startFrameUrl ? { startFrameUrl: r.startFrameUrl } : {}),
    ...(r.endFrameUrl ? { endFrameUrl: r.endFrameUrl } : {}),
    ...(r.referenceImageUrls?.length
      ? { referenceImageUrls: [...r.referenceImageUrls] }
      : {}),
    ...(r.referenceVideoUrls?.length
      ? { referenceVideoUrls: [...r.referenceVideoUrls] }
      : {}),
    ...(r.referenceAudioUrls?.length
      ? { referenceAudioUrls: [...r.referenceAudioUrls] }
      : {}),
    // The bound `@`-entity chips of the directing prompt, so a reload rebuilds the
    // character chips instead of degrading them to flat text.
    ...(r.references?.length ? { references: [...r.references] } : {}),
    // The `/` voice-direction chips (semantic {kind, text}).
    ...(r.directions?.length ? { directions: [...r.directions] } : {}),
    // The timed SHOTS this take was authored from — read back by
    // `readBeats`, so a past take can restore the shots that made it.
    ...(r.beats?.length ? { beats: [...r.beats] } : {}),
    // …and the scene's GENERIC PROMPT it was made under, for the same restore.
    ...(r.scenePrompt ? { scenePrompt: r.scenePrompt } : {}),
    // …and its WAY OUT, whose clause the take's prose carries baked in: the
    // seed strips it back out, and only this record says which node to strip.
    ...(r.endTransition ? { endTransition: { ...r.endTransition } } : {}),
    // The saved FreeCut project url, so re-editing rebuilds the layers instead of
    // starting from the flat rendered video.
    ...(r.freecutProjectUrl ? { freecutProjectUrl: r.freecutProjectUrl } : {}),
    // What this take was rendered at (the video mirror of the still's levers).
    ...(r.aspectRatio ? { aspectRatio: r.aspectRatio } : {}),
    ...(r.resolution ? { resolution: r.resolution } : {}),
    // The prompt-format marker + the look ids / subject ids this
    // generation was projected from. Read back by the matching reader below —
    // a field written here and NOT read there is erased on the next debounced
    // save (the readVoice lesson).
    ...(r.promptFormat !== undefined ? { promptFormat: r.promptFormat } : {}),
    ...(r.look ? { look: copyLookMap(r.look) } : {}),
    // …and its LAYER SPLIT (D-A1) — which half of the merged map above came
    // from the FILM strip and which from this scene. Same read-it-back-or-be-
    // erased contract as everything else on this record.
    ...(r.filmLook ? { filmLook: copyLookMap(r.filmLook) } : {}),
    ...(r.sceneLook ? { sceneLook: copyLookMap(r.sceneLook) } : {}),
    ...(r.subject ? { subject: { ...r.subject } } : {}),
  }
}

/**
 * ONE trash entry → its persisted form. A CLIP's result goes through the same
 * {@link clipResultToWire} a live result does; a SHOT's stored graph is already the
 * output of `serializeProduction`, so it's copied as-is (deep-copying it would only
 * risk diverging from what the parser expects).
 */
export function trashItemToWire(item: TrashedItem): Record<string, unknown> {
  if (item.kind === "shot") {
    return {
      kind: "shot",
      id: item.id,
      shotId: item.shotId,
      ...(item.shotName ? { shotName: item.shotName } : {}),
      index: item.index,
      deletedAt: item.deletedAt,
      graph: item.graph,
    }
  }
  if (item.kind === "still") {
    return {
      kind: "still",
      id: item.id,
      shotId: item.shotId,
      ...(item.shotName ? { shotName: item.shotName } : {}),
      index: item.index,
      deletedAt: item.deletedAt,
      stillBase: { ...item.stillBase },
      result: stillResultToWire(item.result),
    }
  }
  return {
    kind: "clip",
    id: item.id,
    shotId: item.shotId,
    ...(item.shotName ? { shotName: item.shotName } : {}),
    index: item.index,
    deletedAt: item.deletedAt,
    clipBase: { ...item.clipBase },
    result: clipResultToWire(item.result),
  }
}

/** Deep-copy a look selection so the persisted index can never alias the store. */
export function copyLookMap(look: LookSelectionMap): LookSelectionMap {
  const out: Record<string, string | ReadonlyArray<string>> = {}
  for (const [k, v] of Object.entries(look)) {
    out[k] = Array.isArray(v) ? [...v] : v
  }
  return out
}

/**
 * Deep-copy a scene plan so the persisted index can never alias the store.
 * SPREAD-based, never a field list: a lever added to the plan's stage types
 * must reach the save without an edit here (the `ShotVoice` rule in
 * {@link serializeProduction}). An empty stage is dropped. A stage whose only
 * values are empty (`prompt: ""`, `references: []`) still writes, and `readPlan`
 * drops it on the way back — the store never holds that shape, and the
 * idempotence test pins the shapes that matter.
 *
 * THIRD STAGE (plan-import-v2 D4, fix round 1 R38-6): `voice` carries no
 * array field to deep-copy — `delivery` is its one nested object, copied the
 * same way `frame`/`motion` copy theirs. Missing this branch entirely was the
 * bug: every writer of `entry.plan` (`serializeProduction`'s callers —
 * landing, the debounced save, the clipboard, the portability bundle) went
 * through THIS function, so an imported voiceover plan was silently dropped
 * on the very first save, never merely un-deep-copied.
 */
export function copyPlan(plan: ScenePlan): ScenePlan {
  const frame = plan.frame ?? {}
  const motion = plan.motion ?? {}
  return {
    ...(Object.keys(frame).length > 0
      ? {
          frame: {
            ...frame,
            ...(frame.references ? { references: [...frame.references] } : {}),
            ...(frame.referenceImageUrls
              ? { referenceImageUrls: [...frame.referenceImageUrls] }
              : {}),
            // The Structured Subject picks are `field → id | id[]`, the same
            // shape a look map is — and a multi-pick dimension's array would
            // alias the store's through the spread above (R35).
            ...(frame.subject ? { subject: copyLookMap(frame.subject) } : {}),
          },
        }
      : {}),
    ...(Object.keys(motion).length > 0
      ? {
          motion: {
            ...motion,
            ...(motion.references ? { references: [...motion.references] } : {}),
            ...(motion.directions ? { directions: [...motion.directions] } : {}),
          },
        }
      : {}),
    ...(plan.voice
      ? {
          voice: {
            ...plan.voice,
            ...(plan.voice.delivery ? { delivery: { ...plan.voice.delivery } } : {}),
          },
        }
      : {}),
  }
}
