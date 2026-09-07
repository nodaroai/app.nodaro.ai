import type {
  Shot,
  ShotBeat,
  ShotClip,
  ShotRecipe,
  ShotStill,
  ShotVoice,
} from "../shot"
import { EDITED_CLIP_PROVIDER, clipResults, stillResults } from "../shot"
import { planWithoutMedia } from "../scene-plan"
import { untokenizeRoles } from "../role-prose"

/**
 * Pure shot transforms for the bundle exports (lib/production-bundle):
 *
 *  - {@link stripTransient} — what EVERY export drops: `pendingClips` are a
 *    run's private resume markers (a foreign job id is meaningless — and the
 *    paste path already refuses to carry them), and `folderId` dangles outside
 *    its production (kept only for a whole-film export, whose folders travel).
 *  - {@link toRecipeOnlyShot} — the "recipe only" projection: NO media, NO
 *    references — just the regeneration inputs, carried in {@link ShotRecipe}
 *    (see the portability spec §3). The still/clip collapse into
 *    `recipe.framing`/`recipe.directing` derived from the ACTIVE result (its
 *    per-result prompt/model/levers win over the shot-level mirrors); a shot
 *    that already carries a recipe (imported, not yet generated) keeps it for
 *    the layers it has nothing newer for. The scene's authored PLAN rides too,
 *    minus its media — a plan is prose and levers, which is what a recipe is
 *    (see `scene-plan`'s `planWithoutMedia`).
 *
 * All pure copy-on-write — inputs are never mutated (store idiom).
 */

export interface StripOptions {
  /** Keep `folderId` (whole-film exports, where the folders list travels too). */
  readonly keepFolder?: boolean
  /**
   * The production's role DISPLAY NAMES — what a recipe-only projection needs to
   * keep its own promise (see {@link toRecipeOnlyShot}). Unused by
   * {@link stripTransient}, whose bundle carries the cast sheet itself.
   */
  readonly roleNames?: ReadonlyArray<string>
}

/** Drop the fields NO export may carry (`pendingClips`; `folderId` unless film). */
export function stripTransient(shot: Shot, opts: StripOptions = {}): Shot {
  const out: Shot = { ...shot }
  delete (out as { pendingClips?: unknown }).pendingClips
  if (!opts.keepFolder) delete (out as { folderId?: string }).folderId
  return out
}

/** The framing recipe derived from a still's ACTIVE result (undefined when promptless). */
function framingRecipeOf(still: ShotStill): ShotRecipe["framing"] {
  const active = stillResults(still)[still.activeIndex ?? 0]
  const prompt = active?.prompt || still.prompt
  if (!prompt) return undefined
  const provider = active?.provider || still.provider || undefined
  return {
    prompt,
    ...(provider ? { provider } : {}),
    ...(active?.negativePrompt ? { negativePrompt: active.negativePrompt } : {}),
    ...(active?.aspectRatio ? { aspectRatio: active.aspectRatio } : {}),
    ...(active?.resolution ? { resolution: active.resolution } : {}),
    // The look IDS, gated on the ACTIVE result's OWN marker: a sibling result
    // may be a different format, and the ids only mean "the look that produced
    // this prompt" when that prompt is raw prose.
    ...(active?.promptFormat === 2
      ? {
          promptFormat: 2 as const,
          ...(active.look && Object.keys(active.look).length
            ? { look: { ...active.look } }
            : {}),
          // The Subject ids ride beside the look, under the same gate and for
          // the same reason (R48): a subject is ids, not a binding. Copied to
          // exactly the depth `look` above is — one level, the file's idiom.
          ...(active.subject ? { subject: { ...active.subject } } : {}),
        }
      : {}),
  }
}

/** The directing recipe derived from a clip's ACTIVE take (undefined when promptless). */
function directingRecipeOf(clip: ShotClip): ShotRecipe["directing"] {
  const active = clipResults(clip)[clip.activeIndex ?? 0]
  const prompt = active?.prompt || clip.prompt
  if (!prompt) return undefined
  // An edited take's marker is provenance, not a runnable model — fall back to
  // the clip level, which deliberately keeps the last REAL model (lib/shot).
  const provider =
    (active?.provider !== EDITED_CLIP_PROVIDER ? active?.provider : undefined) ||
    clip.provider ||
    undefined
  const duration = active?.duration ?? clip.duration
  return {
    prompt,
    ...(provider ? { provider } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(active?.negativePrompt ? { negativePrompt: active.negativePrompt } : {}),
    ...(active?.directions?.length
      ? { directions: active.directions.map((d) => ({ ...d })) }
      : {}),
    // See the framing mirror above.
    ...(active?.promptFormat === 2
      ? {
          promptFormat: 2 as const,
          ...(active.look && Object.keys(active.look).length
            ? { look: { ...active.look } }
            : {}),
        }
      : {}),
  }
}

/** A voiceover minus its result url — the text + voice/delivery inputs. */
function voiceRecipeOf(voice: ShotVoice): ShotRecipe["voice"] {
  const out = { ...voice }
  delete (out as { url?: string }).url
  return out
}

/** A beat without its entity chips (a `ConnectedReference` needs a real url). */
function stripBeatReferences(beat: ShotBeat): ShotBeat {
  const out: ShotBeat = { ...beat }
  delete (out as { references?: unknown }).references
  return out
}

/**
 * A recipe's prose, with the cast's `@<role-slug>` tokens (C6) spelled back out
 * as the role NAMES — the projection's own promise, kept literally.
 *
 * A recipe-only bundle deliberately carries no bindings at all, cast sheet
 * included: a role IS a binding. Before C6 that cost nothing, because a chip
 * serialized as its bare name and those roles simply arrived as words — the
 * honest unresolved state a recipe promises. Post-C6 the same prose says
 * `@panda-2`, a machine slug with nothing in the file to explain it, which
 * neither the importer's cast scan nor a reader can turn back into a person.
 * So the projection says the names itself, and the recipe reads as prose again.
 */
function untokenizeRecipeProse(
  shot: Shot,
  roleNames: ReadonlyArray<string> | undefined,
): Shot {
  if (!roleNames?.length) return shot
  const say = <T extends string | undefined>(text: T): T =>
    (text === undefined ? undefined : untokenizeRoles(text, roleNames)) as T
  const proseOf = <T extends { readonly prompt?: string }>(
    part: T | undefined,
  ): T | undefined => (part ? { ...part, ...(part.prompt ? { prompt: say(part.prompt) } : {}) } : part)
  // THE STAGE LIST — `frame` / `motion` / `voice`, by name (a stage added to
  // `ScenePlan` and not to this list is dropped from every cast-bearing
  // recipe-only export). The scene's `endTransition` needs no rung here: this
  // projection rewrites PROSE, and a transition is a catalog id and three lever
  // ids — there is nothing in it to spell back out. It rides the spread below.
  const plan = shot.plan
    ? {
        ...(shot.plan.frame ? { frame: proseOf(shot.plan.frame)! } : {}),
        ...(shot.plan.motion ? { motion: proseOf(shot.plan.motion)! } : {}),
        // The voice stage carries no `prompt` to untokenize (plan-import-v2
        // D4, fix round 1 R38-7) — a straight passthrough, the same way
        // `shot.recipe.voice` below needs none either. Missing this branch
        // dropped an imported voiceover plan one call AFTER `planWithoutMedia`
        // had correctly kept it, on every CAST-BEARING production (the only
        // case this function rebuilds `plan` at all instead of returning the
        // shot untouched).
        // COPIED like the two stages above (`proseOf` hands back a fresh
        // object): a passthrough made the voice stage the one part of the
        // projection that aliased the source shot.
        ...(shot.plan.voice ? { voice: { ...shot.plan.voice } } : {}),
      }
    : undefined
  const recipe = shot.recipe
    ? {
        ...shot.recipe,
        ...(shot.recipe.framing ? { framing: proseOf(shot.recipe.framing)! } : {}),
        ...(shot.recipe.directing
          ? { directing: proseOf(shot.recipe.directing)! }
          : {}),
        // Same rule for the recipe's own voice layer — it has no prose to
        // untokenize, but it must not ride out aliasing the source.
        ...(shot.recipe.voice ? { voice: { ...shot.recipe.voice } } : {}),
      }
    : undefined
  return {
    ...shot,
    ...(shot.beats
      ? { beats: shot.beats.map((b) => ({ ...b, text: say(b.text) })) }
      : {}),
    ...(shot.scenePrompt ? { scenePrompt: say(shot.scenePrompt) } : {}),
    ...(plan ? { plan } : {}),
    ...(recipe ? { recipe } : {}),
  }
}

/**
 * The "recipe only" projection of a shot: no still/clip/voice media, no frame
 * keyframes, no directing references, no entity chips — only name, folder
 * (film exports), look, chip-less beats, the AUTHORED PLAN minus its media
 * (`planWithoutMedia`), and the {@link ShotRecipe} needed to regenerate.
 * Returns a shot that serializes as a NODE-LESS placeholder entry.
 *
 * The prose it keeps is spelled in NAMES, not role tokens — see
 * {@link untokenizeRecipeProse} for why that is the projection's own promise
 * rather than a cosmetic touch-up. Pass `roleNames` (the production's cast
 * display names) or the tokens ride out as slugs.
 */
export function toRecipeOnlyShot(shot: Shot, opts: StripOptions = {}): Shot {
  const framing = shot.still ? framingRecipeOf(shot.still) : shot.recipe?.framing
  const directing = shot.clip
    ? directingRecipeOf(shot.clip)
    : shot.recipe?.directing
  const voice = shot.voice ? voiceRecipeOf(shot.voice) : shot.recipe?.voice
  const plan = planWithoutMedia(shot.plan)
  const recipe: ShotRecipe | undefined =
    framing || directing || voice
      ? {
          ...(framing ? { framing } : {}),
          ...(directing ? { directing } : {}),
          ...(voice ? { voice } : {}),
        }
      : undefined
  return untokenizeRecipeProse(
    {
      id: shot.id,
      ...(shot.name ? { name: shot.name } : {}),
      ...(opts.keepFolder && shot.folderId ? { folderId: shot.folderId } : {}),
      ...(shot.look && Object.keys(shot.look).length > 0 ? { look: shot.look } : {}),
      ...(shot.beats?.length ? { beats: shot.beats.map(stripBeatReferences) } : {}),
      // The scene's generic prompt travels with the shots it stands over: prose
      // with no url and no chip list, which is exactly what a recipe carries.
      ...(shot.scenePrompt ? { scenePrompt: shot.scenePrompt } : {}),
      // …and how the scene GOES OUT, for the same reason: a catalog id and
      // three lever ids, no url and no binding. This list is an ALLOWLIST, so a
      // scene field left off it is dropped from every recipe-only export.
      ...(shot.endTransition ? { endTransition: { ...shot.endTransition } } : {}),
      // The AUTHORED intent, minus its media (`planWithoutMedia`). A plan is
      // prose and levers — the same stuff a recipe is made of — so it belongs in
      // a recipe; what it must not carry is `frame.references` /
      // `frame.referenceImageUrls` / `motion.references`, and it doesn't.
      // Without this, importing a plan-only production and re-exporting it
      // recipe-only silently dropped every prompt it was authored with, while the
      // same export with LINKED media kept them (`stripTransient` spreads).
      ...(plan ? { plan } : {}),
      ...(recipe ? { recipe } : {}),
    },
    opts.roleNames,
  )
}
