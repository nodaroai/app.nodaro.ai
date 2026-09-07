import type { Direction } from "./direction"
import type { LookSelectionMap, ProductionFilmLook } from "./shot"

/**
 * Which LOOK LAYER a pick lands in.
 *
 * The v2 editor persists cinematic direction in two layers — FILM
 * (production-wide: camera / colour / art style / period) and SCENE (this
 * scene's own lighting / atmosphere / mood / …). The editor reads them merged
 * with the scene last, so a scene value already WINS over the film's.
 *
 * The layer is decided by the SURFACE you used, not by the key. Deciding it by
 * key made the FILM chip and the SCENE LOOK card for Period the same control
 * twice — both wrote the film — so a film set in 2000 could never hold a
 * flashback scene in the 1980s, even though the merge would have honoured one.
 *
 * Period is the one dimension that legitimately appears in both places: the
 * film's era, and a per-scene override of it.
 */

/** Two look values equal? A multi-pick dimension holds an array, so `===` alone
 *  reads every re-render as a change — and a false change writes a spurious
 *  override of a value the scene never set. */
export function sameLookValue(
  a?: string | ReadonlyArray<string>,
  b?: string | ReadonlyArray<string>,
): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i])
  }
  return a === b
}

/** Two whole look MAPS equal? Key-for-key over the union, through
 *  {@link sameLookValue} — so a map that only differs by array IDENTITY (a
 *  fresh `atmosphereId` array off a JSON parse) is not read as a difference. */
export function sameLookMap(
  a: ProductionFilmLook | undefined,
  b: ProductionFilmLook | undefined,
): boolean {
  const left = a ?? {}
  const right = b ?? {}
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const k of keys) {
    if (!sameLookValue(left[k], right[k])) return false
  }
  return true
}

/**
 * The look dimensions the FILM strip owns — everything else a look picker
 * writes belongs to the SCENE. Splitting by key is what lets one merged
 * `Direction` object drive both surfaces while each half persists in its own
 * place (production settings vs. the scene's entry).
 *
 * Declared HERE, in the leaf that owns the layer rule, rather than beside the
 * `@`-picker derivations: the portable-plan registry gates an imported `film`
 * map on these keys and runs under node, where `project-references` throws
 * (it reaches `import.meta.env` through `hooks/useEntities`).
 */
export const FILM_LOOK_KEYS: ReadonlySet<string> = new Set([
  "cameraFormatId",
  "colorLookId",
  "styleId",
  "eraId",
])

/** The FILM layer after a write ARRIVING at it. Keys the film does not own are
 *  dropped rather than trusted: the strip is handed the film layer, so anything
 *  else arriving here is a caller bug, not a value to persist. The same gate
 *  serves the paste-time film import (D-B3), where the map comes off an
 *  untrusted FILE and `readLookMap` has only checked its shapes. */
export function filmLayerWrite(next: Direction): ProductionFilmLook {
  const out: Record<string, string | ReadonlyArray<string>> = {}
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined || !FILM_LOOK_KEYS.has(k)) continue
    out[k] = v
  }
  return out
}

/**
 * The SCENE layer after a write from the scene grid.
 *
 * The grid is handed the MERGED view, so writing it back wholesale would copy
 * every inherited film value into the scene as an override — change Mood and
 * you would silently pin the film's era to this scene forever. Only what
 * actually CHANGED against the merged view is applied.
 *
 * A cleared key drops the scene's own entry and nothing else, so the film's
 * value shows through again. That is what "Default" on a scene card means:
 * stop overriding — not "no era at all", which stays the FILM chip's to say.
 */
export function sceneLayerWrite(
  merged: Direction,
  next: Direction,
  sceneLook: ProductionFilmLook | undefined,
): ProductionFilmLook {
  const out: Record<string, string | ReadonlyArray<string>> = { ...(sceneLook ?? {}) }
  for (const k of new Set([...Object.keys(merged), ...Object.keys(next)])) {
    if (sameLookValue(merged[k], next[k])) continue
    if (next[k] === undefined) delete out[k]
    else out[k] = next[k]
  }
  return out
}

/**
 * Look keys that belong to NEITHER persisted layer — per-generation composer
 * state a result's merged `look` (and a D-A1 `sceneLook`) carries anyway: a
 * clip's selection is the merged film+scene map PLUS `cameraMotionId`. Putting
 * one back would persist an override for a dimension the scene grid never
 * shows.
 *
 * Spelled as literals rather than imported from `lib/look-pickers`, for the
 * same node-safety reason as FILM_LOOK_KEYS above; `look-layers.test.ts` pins
 * them against `CAMERA_MOVEMENT_KEY` / `CHARACTER_FX_KEY` so the two can't
 * drift apart.
 */
export const SHOT_ONLY_LOOK_KEYS: ReadonlySet<string> = new Set([
  "cameraMotionId",
  "characterFxId",
])

/**
 * Look keys a CLIP's stored layers may legitimately OMIT because the video
 * projection carved them out at submit — the scene Transition, dropped while
 * the SHOTS own transitions (`Composer.tsx` `videoLook` / `beatsOwnTransitions`).
 * Absent from the result ⇒ leave the live layer's own value ALONE rather than
 * clearing it: the run not folding a pick is not the user un-picking it, and a
 * wholesale replace would silently delete a persisted override — the exact bug
 * class `sceneLayerWrite` above exists to prevent.
 *
 * BOTH persisted layers, not just the scene: `videoFilmLook` applies the same
 * carve-out to the FILM half, because a persisted film map is narrowed by
 * `readLookMap`, which does not gate on {@link FILM_LOOK_KEYS} — so a stray
 * transition sitting on the film layer is carved out of the result too, and a
 * wholesale film replace would delete it exactly as a scene replace would.
 *
 * Honest edge: a result made when the layer had NO transition will not clear
 * one picked since. Never-delete beats byte-faithful here.
 *
 * Literals, and pinned against `TRANSITION_DIMENSION` in the test — same
 * node-safety rule as the two sets above.
 */
export const SCENE_CARRY_LOOK_KEYS: ReadonlySet<string> = new Set(["transitionId"])

/** The look provenance a still/clip result carries (spec D-A1). Structural, so
 *  both {@link ShotStillResult} and {@link ShotClipResult} satisfy it. */
export interface ResultLookProvenance {
  readonly promptFormat?: 2
  readonly look?: LookSelectionMap
  readonly filmLook?: LookSelectionMap
  readonly sceneLook?: LookSelectionMap
}

/** Drop the per-generation keys no persisted layer owns (see
 *  {@link SHOT_ONLY_LOOK_KEYS}). Returns a fresh object — never the input. */
function withoutShotOnly(map: LookSelectionMap): ProductionFilmLook {
  const out: Record<string, string | ReadonlyArray<string>> = {}
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined || SHOT_ONLY_LOOK_KEYS.has(k)) continue
    out[k] = v
  }
  return out
}

/**
 * The two persisted layers a RESULT was generated under — what selecting it
 * puts back on the editor (spec D-A2).
 *
 * `null` ⇒ WRITE NOTHING (INV-A2). A legacy result's clauses are already BAKED
 * into its prose, so re-arming pickers from it would fold the same hint twice —
 * the same rule the composer's D4 seed suppression enforces on the prompt side.
 *
 * A D-A1 result carries the split as it was AT SUBMIT and it is used VERBATIM;
 * an older format-2 result carries only the merged map, which splits by
 * {@link FILM_LOOK_KEYS} (D-A3 — `eraId` lands on the FILM, the per-scene
 * flashback being the rarity; a documented HEURISTIC, not an invariant). Either
 * way BOTH halves come back and both are stripped of {@link SHOT_ONLY_LOOK_KEYS}:
 * an absent half is `{}`, not "leave the live layer alone" — the point is to
 * show the asset's OWN state, and the browse-session stash is what makes that
 * recoverable. The one softening is {@link SCENE_CARRY_LOOK_KEYS}, applied by
 * the store to BOTH layers, where the live film and scene looks are in hand.
 *
 * Array VALUES are passed through by reference; the store deep-copies on write.
 */
export function resultLookLayers(
  result: ResultLookProvenance,
): { readonly film: ProductionFilmLook; readonly scene: ProductionFilmLook } | null {
  if (result.promptFormat !== 2) return null
  if (result.filmLook || result.sceneLook) {
    return {
      film: withoutShotOnly(result.filmLook ?? {}),
      scene: withoutShotOnly(result.sceneLook ?? {}),
    }
  }
  const merged = result.look
  if (!merged || Object.keys(merged).length === 0) return null
  const film: Record<string, string | ReadonlyArray<string>> = {}
  const scene: Record<string, string | ReadonlyArray<string>> = {}
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || SHOT_ONLY_LOOK_KEYS.has(k)) continue
    ;(FILM_LOOK_KEYS.has(k) ? film : scene)[k] = v
  }
  return { film, scene }
}
