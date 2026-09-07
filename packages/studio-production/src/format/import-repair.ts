import {
  beatsCapSeconds,
  beatsTotalSeconds,
  renderFloor,
  roundSeconds,
} from "../beats"
import { CAMERA_MOVEMENT_KEY, liveLookId } from "../look-pickers"
import { nearestDuration, type DirectingMode } from "../model-menu"
import { clampBeatsToBudget } from "../scene-settings"

import { repairAudio, repairMusic, repairVoice, warnOrphanRuns } from "./import-repair-sound"
import { pickerFor, repairLookMap, repairSubject } from "./import-repair-subject"
import type {
  FormatRegistry,
  RegistryModel,
  RegistryNode,
} from "./registry"
import {
  FORMAT_VERSION,
  type AudioLayer,
  type FrameDocument,
  type LeverNode,
  type LookMap,
  type MotionDocument,
  type ProductionDocument,
  type SceneDocument,
  type ShotDocument,
} from "./schema"
import { warning, type ImportWarning } from "./warnings"

/**
 * Stage 3 — REPAIR (spec §6.3). Catalog-aware and never rejecting: a document
 * that reached here IS a document, and what this studio cannot resolve is
 * dropped with a receipt rather than refused. That is the designed behaviour
 * for catalog drift (§11) — the platform's generator emits ids valid per ITS
 * live `@nodaro/prompts`, studio validates against its PINNED one.
 *
 * PURE: the input document is never mutated; every level is copied before it is
 * changed, and no id is minted here (identity belongs to `map`).
 *
 * The SOUND repairs — `repairAudio`, `warnOrphanRuns`, `repairVoice` — live in
 * the sibling `./import-repair-sound` (fix round 2, R40-1: split out once this
 * file crossed the 800-line house cap), and the LOOK-MAP / SUBJECT id gate and
 * repairs — `gateIds`, `repairLookMap`, `repairSubject`, `pickerFor` — live in
 * `./import-repair-subject` (B14 — the same TECHNIQUE, a different reason:
 * that split was PRE-EMPTIVE, taken while this file sat back under the cap but
 * close enough that the program's later tasks would have pushed it over
 * again). Both are imported here and called exactly as before either move.
 */

/**
 * The model a stage will actually render on. An authored model outside the
 * allowlist falls to the stage default (a retired or renamed id — §11); an
 * ABSENT one is checked against that same default, because that is the model
 * the Composer will open the scene with. One rule, so the option, duration and
 * budget checks below can never disagree about which model they mean.
 */
function repairModel(
  authored: string | undefined,
  models: ReadonlyArray<RegistryModel>,
  fallback: string,
  kind: "image" | "video",
  path: string,
  warnings: ImportWarning[],
): { id: string | undefined; row: RegistryModel | undefined } {
  const row = (id: string) => models.find((m) => m.id === id)
  if (authored === undefined) return { id: undefined, row: row(fallback) }
  if (row(authored)) return { id: authored, row: row(authored) }
  warnings.push(
    warning(
      "model",
      `"${authored}" is not an available ${kind} model — using ${fallback}.`,
      path,
    ),
  )
  return { id: fallback, row: row(fallback) }
}

/**
 * A per-model option, kept VERBATIM when the model offers it (D15 — `2K` on
 * gpt-image-2, `2 MP` on flux-2; studio never normalises them). The stage
 * default rescues it only when the model offers THAT too; otherwise the field
 * drops and the stage's own default applies (video resolution: Auto).
 */
function repairOption(
  authored: string | undefined,
  offered: ReadonlyArray<string>,
  fallback: string | undefined,
  label: string,
  model: string,
  path: string,
  warnings: ImportWarning[],
): string | undefined {
  if (authored === undefined || offered.includes(authored)) return authored
  const next = fallback && offered.includes(fallback) ? fallback : undefined
  warnings.push(
    warning(
      "option",
      next
        ? `${model} has no ${label} "${authored}" — using "${next}".`
        : `${model} has no ${label} "${authored}" — dropped.`,
      path,
    ),
  )
  return next
}

/** The Framing stage's levers, against the model that will render them. */
function repairFrame(
  frame: FrameDocument,
  registry: FormatRegistry,
  path: string,
  warnings: ImportWarning[],
): FrameDocument {
  const next: FrameDocument = { ...frame }
  const model = repairModel(
    frame.model,
    registry.imageModels,
    registry.defaults.imageModel,
    "image",
    `${path}.model`,
    warnings,
  )
  if (model.id) next.model = model.id
  const named = model.row?.id ?? registry.defaults.imageModel
  const aspectRatio = repairOption(
    frame.aspectRatio,
    model.row?.aspectRatios ?? [],
    registry.defaults.aspectRatio,
    "aspect ratio",
    named,
    `${path}.aspectRatio`,
    warnings,
  )
  if (aspectRatio) next.aspectRatio = aspectRatio
  else delete next.aspectRatio
  const resolution = repairOption(
    frame.resolution,
    model.row?.resolutions ?? [],
    registry.defaults.resolution,
    "resolution",
    named,
    `${path}.resolution`,
    warnings,
  )
  if (resolution) next.resolution = resolution
  else delete next.resolution
  if (frame.count !== undefined) {
    const count = Math.min(
      Math.max(Math.round(frame.count), 1),
      registry.candidates.max,
    )
    if (count !== frame.count) {
      warnings.push(
        warning(
          "count",
          `${frame.count} options is outside 1–${registry.candidates.max} — using ${count}.`,
          `${path}.count`,
        ),
      )
    }
    next.count = count
  }
  if (frame.subject) {
    const subject = repairSubject(frame.subject, registry, path, warnings)
    if (Object.keys(subject).length > 0) next.subject = subject
    else delete next.subject
  }
  return next
}

/** The Directing stage's levers. `hasShots` decides the prose rule: a scene
 *  with shots writes its motion in them, so a prompt beside them is dropped. */
function repairMotion(
  motion: MotionDocument,
  hasShots: boolean,
  registry: FormatRegistry,
  durationsFor: (model: string) => ReadonlyArray<number>,
  path: string,
  warnings: ImportWarning[],
): MotionDocument {
  const next: MotionDocument = { ...motion }
  const model = repairModel(
    motion.model,
    registry.videoModels,
    registry.defaults.videoModel,
    "video",
    `${path}.model`,
    warnings,
  )
  if (model.id) next.model = model.id
  const named = model.row?.id ?? registry.defaults.videoModel
  const aspectRatio = repairOption(
    motion.aspectRatio,
    model.row?.aspectRatios ?? [],
    registry.defaults.aspectRatio,
    "aspect ratio",
    named,
    `${path}.aspectRatio`,
    warnings,
  )
  if (aspectRatio) next.aspectRatio = aspectRatio
  else delete next.aspectRatio
  // Auto IS the Directing resolution default (`DIRECTING_RESOLUTION_AUTO` —
  // omit the field, the provider renders its own), so there is nothing to fall
  // back to: a tier the model has no row for simply drops.
  const resolution = repairOption(
    motion.resolution,
    model.row?.resolutions ?? [],
    undefined,
    "resolution",
    named,
    `${path}.resolution`,
    warnings,
  )
  if (resolution) next.resolution = resolution
  else delete next.resolution
  if (motion.duration !== undefined) {
    const snapped = nearestDuration(
      motion.duration,
      durationsFor(named).map((value) => ({ value })),
    )
    if (snapped === undefined) {
      warnings.push(
        warning("duration", `${named} has no clip-length lever — dropped.`, `${path}.duration`),
      )
      delete next.duration
    } else {
      if (snapped !== motion.duration) {
        warnings.push(
          warning(
            "duration",
            `${motion.duration}s is not a ${named} clip length — using ${snapped}s.`,
            `${path}.duration`,
          ),
        )
      }
      next.duration = snapped
    }
  }
  if (motion.cameraMotionId !== undefined) {
    const picker = registry.pickers.find((p) => p.key === CAMERA_MOVEMENT_KEY)
    const id = liveLookId(motion.cameraMotionId)
    if (picker?.options.some((o) => o.id === id)) {
      next.cameraMotionId = id
    } else {
      warnings.push(
        warning(
          "unknown-id",
          `"${motion.cameraMotionId}" is not a Camera Movement option — dropped.`,
          `${path}.cameraMotionId`,
        ),
      )
      delete next.cameraMotionId
    }
  }
  // The RESOLVED model's own `inputs` row (D1) — the same `model` this
  // function already settled the aspect ratio, resolution and duration levers
  // against, so the option check and the model check can never disagree.
  if (motion.input !== undefined) {
    if (model.row?.inputs?.includes(motion.input as DirectingMode)) {
      next.input = motion.input
    } else {
      warnings.push(
        warning(
          "option",
          `${named} has no "${motion.input}" input mode — dropped.`,
          `${path}.input`,
        ),
      )
      delete next.input
    }
  }
  // `scenePrompt` is NOT swept with `prompt` below and never will be: the shots
  // replace the scene-level motion prose, but the scene's generic prompt is
  // exactly the description that stands OVER them. It survives on the spread.
  if (hasShots && motion.prompt) {
    warnings.push(
      warning(
        "motion-prompt",
        "A scene with shots writes its motion in them — the scene-level motion prompt was dropped.",
        `${path}.prompt`,
      ),
    )
    delete next.prompt
  }
  if (motion.audio) {
    // `named` is the model this scene will RENDER on — the authored one when
    // the allowlist carries it, the stage default when it doesn't (or when the
    // file named none). The capability check reads it for the same reason the
    // option/duration checks above do: one rule, so they can never disagree
    // about which model they mean.
    const audio = repairAudio(motion.audio, named, path, warnings)
    if (audio) next.audio = audio
    else delete next.audio
  }
  // A shot-less scene's `prompt` IS its whole directing plan (B3): the
  // stage's submitted text, so a bracketed run orphaned in it is the same
  // silent-stage-direction risk a shot's own text already gets scanned for
  // (rule 12). A scene WITH shots carries no scene-level `prompt` past this
  // point — dropped above, whenever it was hasShots && motion.prompt truthy,
  // and never written to begin with otherwise — so `next.prompt` is always
  // undefined there and this scan is naturally shot-less-only; no extra
  // `hasShots` gate needed.
  if (next.prompt) warnOrphanRuns(next.prompt, next.audio, `${path}.prompt`, warnings)
  // `scenePrompt` is UNGATED by `hasShots` (fix round 1, R70 — corrects the
  // original B3 landing, which wrongly scoped this to the shot-less case):
  // `foldScenePrompt` (Composer's `directingBaseText`, "the ONE place the
  // directing body is assembled") folds it AHEAD of the directing body
  // UNCONDITIONALLY, whether that body is a shot-less scene's own prose or
  // the beats a scene WITH shots carries — so it reaches the model either
  // way, and an orphan run in it would otherwise warn nothing on a
  // with-shots scene. Scanned here, BEFORE the scene→shot-1 move runs (in
  // `repairDocument`, after this returns), against the scene's own
  // `next.audio` — never a shot's inherited cues, which each SHOT is scanned
  // against separately, in `repairShots`.
  if (next.scenePrompt) {
    warnOrphanRuns(next.scenePrompt, next.audio, `${path}.scenePrompt`, warnings)
  }
  // How the scene GOES OUT — the same node a shot's `transition` is, so the
  // same repair against the same catalog (`repairShots` calls it per shot).
  // UNGATED by `hasShots`: a scene's last frames go out whether its directing
  // prose is one paragraph or five timed windows.
  repairLever(next, "endTransition", registry.transition, "transition", path, warnings)
  return next
}

/** A transition / character-FX node against its catalog. THE ID IS REQUIRED
 *  (`readTransition`'s rule — the node IS its pick), and a lever step the
 *  catalog doesn't publish reads as unset rather than dropping the pick.
 *
 *  Generic in its OWNER, not typed to {@link ShotDocument}: the scene's own
 *  `motion.endTransition` is the same node in a different seat, and one repair
 *  for both is what keeps a scene's way out held to the same catalog as a
 *  shot's way in. */
function repairLever<F extends string>(
  owner: Partial<Record<F, LeverNode>>,
  field: F,
  node: RegistryNode,
  label: string,
  path: string,
  warnings: ImportWarning[],
): void {
  const authored = owner[field]
  if (!authored) return
  const at = `${path}.${field}`
  const id = liveLookId(authored.id)
  if (!node.ids.some((o) => o.id === id)) {
    warnings.push(
      warning("unknown-id", `"${authored.id}" is not a ${label} this studio knows — dropped.`, at),
    )
    delete owner[field]
    return
  }
  const next: LeverNode = { id }
  for (const dim of node.dimensions) {
    const value = authored[dim.field]
    if (value === undefined) continue
    if (dim.options.some((o) => o.id === value)) next[dim.field] = value
    else {
      warnings.push(
        warning("unknown-id", `"${value}" is not a ${dim.label} step — dropped.`, `${at}.${dim.field}`),
      )
    }
  }
  owner[field] = next
}

/**
 * One scene's timed shots: lengths onto the tenths grid, picks and lever nodes
 * against the catalog, then the whole list into the render budget of the model
 * it will animate on (`clampBeatsToBudget` — the copy-settings path's own
 * clamp, so a 30-second plan on a 10-second model behaves identically here).
 *
 * `sceneAudio` is the scene's own REPAIRED `motion.audio` — about to move onto
 * shot 1 (the caller's own rule, right after this returns). Shot 1's orphan
 * scan has to see it arriving too, or a token only the incoming scene cue
 * claims reads as unclaimed a beat before the move claims it.
 */
function repairShots(
  shots: ReadonlyArray<ShotDocument>,
  model: string,
  durations: ReadonlyArray<number>,
  sceneAudio: ReadonlyArray<AudioLayer> | undefined,
  registry: FormatRegistry,
  path: string,
  warnings: ImportWarning[],
): ShotDocument[] {
  const kept: ShotDocument[] = []
  shots.forEach((shot, n) => {
    const at = `${path}.shots[${n}]`
    const seconds = roundSeconds(shot.seconds)
    if (seconds <= 0) {
      warnings.push(
        warning("shot-dropped", `Shot ${n + 1} has no length — dropped.`, `${at}.seconds`),
      )
      return
    }
    if (seconds !== shot.seconds) {
      warnings.push(
        warning(
          "seconds",
          `Shot lengths are tenths of a second — ${shot.seconds}s became ${seconds}s.`,
          `${at}.seconds`,
        ),
      )
    }
    const copy: ShotDocument = { ...shot, seconds }
    const picks = shot.picks
      ? repairLookMap(shot.picks, "picks", registry, `${at}.picks`, warnings)
      : undefined
    if (picks && Object.keys(picks).length > 0) copy.picks = picks
    else delete copy.picks
    repairLever(copy, "transition", registry.transition, "transition", at, warnings)
    repairLever(copy, "characterFx", registry.characterFx, "character FX", at, warnings)
    // …against the SAME resolved model the budget clamp below reads (A7).
    const audio = shot.audio ? repairAudio(shot.audio, model, at, warnings) : undefined
    if (audio) copy.audio = audio
    else delete copy.audio
    // Shot 1 only: scan against the cue it is about to inherit too, same
    // order the move itself uses (scene cues first, then the shot's own).
    const scanAudio =
      n === 0 && sceneAudio ? [...sceneAudio, ...(audio ?? [])] : audio
    warnOrphanRuns(copy.text, scanAudio, `${at}.text`, warnings)
    kept.push(copy)
  })
  const cap = beatsCapSeconds(durations)
  const clamped = clampBeatsToBudget(kept, cap, renderFloor(durations) ?? 2)
  if (clamped !== kept) {
    warnings.push(
      warning(
        "budget",
        `These shots run ${beatsTotalSeconds(kept)}s; ${model} renders at most ${cap}s — kept ${beatsTotalSeconds(clamped)}s.`,
        `${path}.shots`,
      ),
    )
  }
  return [...clamped]
}

/**
 * D2 — a FILM key set to the same id on EVERY scene is the film's. A model
 * asked for a film look often writes it per scene (a legal override the layer
 * rule can't flag), which leaves the FILM strip on Default while every scene
 * card fills in. Two or more scenes only: one scene has nothing to disambiguate.
 */
function promoteUnanimousFilm(
  doc: ProductionDocument,
  registry: FormatRegistry,
  warnings: ImportWarning[],
): ProductionDocument {
  if (doc.scenes.length < 2) return doc
  const film: LookMap = { ...(doc.film ?? {}) }
  const scenes = doc.scenes.map((s) => (s.look ? { ...s, look: { ...s.look } } : { ...s }))
  let moved = false
  for (const key of registry.filmKeys) {
    if (film[key] !== undefined) continue
    const first = scenes[0]?.look?.[key]
    if (typeof first !== "string") continue
    if (!scenes.every((s) => s.look?.[key] === first)) continue
    film[key] = first
    for (const s of scenes) {
      const look = { ...s.look }
      delete look[key]
      if (Object.keys(look).length > 0) s.look = look
      else delete s.look
    }
    const label = pickerFor(registry, key)?.label ?? key
    warnings.push(
      warning("layer", `${label} was set on every scene — moved to the film look.`, `scenes[0].look.${key}`),
    )
    moved = true
  }
  if (!moved) return doc
  return { ...doc, film, scenes }
}

export function repairDocument(
  doc: ProductionDocument,
  registry: FormatRegistry,
  durationsFor: (model: string) => ReadonlyArray<number>,
): { doc: ProductionDocument; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = []

  const next: ProductionDocument = { ...doc }
  // Forward-compat without a migration ladder (D13): a newer file opens with
  // what this studio understands, and says so.
  if (doc.version > FORMAT_VERSION) {
    warnings.push(
      warning(
        "newer-version",
        `This file was written by a newer studio (version ${doc.version}) — importing what this version understands.`,
        "version",
      ),
    )
  }
  // The production's ONE soundtrack (plan-import-v2 D5) — repaired for real:
  // `music-options.ts`'s catalogs are text tags folded into the Suno prompt,
  // not platform ids a studio export alone may write. (A root `voice` is no
  // longer a document field at all as of D7 — the schema's own strip already
  // removed it before repair runs; a scene's OWN voiceover, `scenes[].voice`,
  // is handled below, per scene.)
  if (doc.music !== undefined) {
    const music = repairMusic(doc.music, registry, warnings)
    if (music) next.music = music
    else delete next.music
  }
  const film = doc.film
    ? repairLookMap(doc.film, "film", registry, "film", warnings)
    : undefined
  if (film && Object.keys(film).length > 0) next.film = film
  else delete next.film

  next.scenes = doc.scenes.map((scene, i) => {
    const at = `scenes[${i}]`
    const copy: SceneDocument = { ...scene }
    const look = scene.look
      ? repairLookMap(scene.look, "scene", registry, `${at}.look`, warnings)
      : undefined
    if (look && Object.keys(look).length > 0) copy.look = look
    else delete copy.look
    if (scene.frame) {
      copy.frame = repairFrame(scene.frame, registry, `${at}.frame`, warnings)
    }
    if (scene.motion) {
      copy.motion = repairMotion(
        scene.motion,
        !!scene.shots?.length,
        registry,
        durationsFor,
        `${at}.motion`,
        warnings,
      )
    }
    if (scene.shots) {
      const model = copy.motion?.model ?? registry.defaults.videoModel
      copy.shots = repairShots(
        scene.shots,
        model,
        durationsFor(model),
        copy.motion?.audio,
        registry,
        at,
        warnings,
      )
      // A scene with shots carries its cues ON them (D3/D5) — repair has
      // already dropped `motion.prompt` for the same reason above. A
      // scene-level cue surviving THIS repair pass is legal input (the shots
      // just landed beside it), so it moves onto the first shot rather than
      // being lost.
      if (copy.motion?.audio && copy.shots.length) {
        const [first, ...rest] = copy.shots
        copy.shots = [
          { ...first, audio: [...copy.motion.audio, ...(first.audio ?? [])] },
          ...rest,
        ]
        const motion = { ...copy.motion }
        delete motion.audio
        if (Object.keys(motion).length > 0) copy.motion = motion
        else delete copy.motion
        warnings.push(
          warning(
            "audio",
            "A scene with shots carries its cues on them — the scene-level cues moved into the first shot.",
            `${at}.motion.audio`,
          ),
        )
      }
    }
    if (scene.voice) {
      const voice = repairVoice(scene.voice, at, warnings)
      if (voice) copy.voice = voice
      else delete copy.voice
    }
    return copy
  })

  return { doc: promoteUnanimousFilm(next, registry, warnings), warnings }
}
