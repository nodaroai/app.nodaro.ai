import type { ConnectedReference } from "@nodaro/shared"

import { castKeyForName, hasActor, roleTokenForName, type Cast } from "../cast"
import type { StageDraft } from "../composer-draft-types"
import type { PlanVoice } from "../scene-plan"
import { sceneSettings } from "../scene-settings"
import type {
  LookSelectionMap,
  PlanMusic,
  ProductionFilmLook,
  ProductionFolder,
  ProductionMusic,
  Shot,
  ShotBeat,
  ShotVoice,
} from "../shot"
import type { StoryboardSettings } from "../shot-graph"

import { audioFromDirections } from "./audio"
import {
  activeStill,
  framingPrompt,
  motionPrompt,
  toFrameDocument,
  toLeverNode,
  toMotionDocument,
} from "./export-scene"
import {
  CAST_KIND_LIST,
  FORMAT_ID,
  FORMAT_VERSION,
  type CastEntry,
  type LookMap,
  type MusicDocument,
  type ProductionDocument,
  type SceneDocument,
  type ShotDocument,
  type VoiceDocument,
} from "./schema"

/**
 * The inverse map (spec §7): a production's authoring state as a portable plan.
 * PLAN ONLY — no rendered media (that already round-trips through the
 * platform's `export_workflow`). A voiceover's LINE + voice pick (D4) and the
 * soundtrack's PROMPT + pickers (D5) both travel; the rendered AUDIO of
 * either one does not (D8's rule for every stage).
 *
 * Per FIELD (§5): the levers come from what the scene currently READS AS
 * (`sceneSettings` — the active result's recorded context, else the plan), the
 * prose from the most UNFOLDED source there is (the unsent draft, else the
 * plan, and a stored result's prompt only as a LAST resort — on the v2 shell it
 * is already hint-folded). Empty values are omitted, so a file carries only
 * decisions.
 */

export interface ExportOptions {
  /** The unsent composer draft for a shot's stage (`loadComposerDraft`), so the
   *  file matches what is on screen, not only what was submitted. */
  readonly draftFor: (
    shotId: string,
    stage: "framing" | "directing",
  ) => StageDraft | undefined
  /** The production's RENDERED soundtrack (`settings.studio.music`), if any —
   *  wins over {@link musicPlan} the same way a rendered voiceover wins over a
   *  scene's plan (plan-import-v2 D5). */
  readonly music?: ProductionMusic
  /** The production's soundtrack PLAN (`settings.studio.musicPlan`), read only
   *  when {@link music} is absent. */
  readonly musicPlan?: PlanMusic
  /** The Storyboard tab's own state (`settings.studio.storyboard`,
   *  plan-import-v2 D6) — only its `brief` travels; every other field is the
   *  tab's own scratch (coverage-guard.test.ts's STORYBOARD_EXCLUDED). */
  readonly storyboard?: StoryboardSettings
  /** The production's CAST (`settings.studio.cast`) — read for two things only
   *  (see {@link toCast}): a role's hand-written `description`, and the
   *  DESCRIBED roles, which have no chip to be found by. Absent ⇒ the export is
   *  exactly the chip-derived one it has always been. */
  readonly cast?: Cast
}

/** A store look map as the document's (fresh arrays — never the store's). A key
 *  holding an EMPTY array is a picker with nothing picked: dropped, so a look
 *  can't travel as a key that says nothing (§7 omits empty values). Callers
 *  guard the RESULT — a map whose only key was empty must emit no `look` at all. */
function toLookMap(look: LookSelectionMap): LookMap {
  const out: LookMap = {}
  for (const [key, value] of Object.entries(look)) {
    if (!Array.isArray(value)) {
      out[key] = value as string
      continue
    }
    if (value.length > 0) out[key] = [...value]
  }
  return out
}

function toShotDocument(beat: ShotBeat): ShotDocument {
  const transition = toLeverNode(beat.transition)
  const characterFx = toLeverNode(beat.characterFx)
  return {
    seconds: beat.seconds,
    text: beat.text,
    ...(beat.label ? { label: beat.label } : {}),
    ...(beat.picks && Object.keys(beat.picks).length > 0
      ? { picks: { ...beat.picks } }
      : {}),
    ...(transition ? { transition } : {}),
    ...(characterFx ? { characterFx } : {}),
    ...(beat.directions?.length ? { audio: audioFromDirections(beat.directions) } : {}),
  }
}

/** `shot.voice` without its result `url` — the plan-shaped half of a rendered
 *  voiceover (mirrors `activeStill`'s legacy rung: media travels by url
 *  through the platform's own workflow export, never through this format,
 *  D8). Copy-on-write, like `omitProse`/`omitMedia` in `scene-plan.ts`. */
function stripUrl(voice: ShotVoice): PlanVoice {
  const out = { ...voice } as Record<string, unknown>
  delete out.url
  return out as PlanVoice
}

/** A scene's voiceover — a rendered result (url stripped) or the plan, AS THE
 *  DOCUMENT WRITES IT (plan-import-v2 D4): a fresh `delivery` object, never
 *  the store's own. */
function toVoiceDocument(voice: PlanVoice): VoiceDocument {
  return {
    text: voice.text,
    ...(voice.casting ? { casting: voice.casting } : {}),
    ...(voice.voiceId ? { voiceId: voice.voiceId } : {}),
    ...(voice.voiceType ? { voiceType: voice.voiceType } : {}),
    ...(voice.ttsProvider ? { ttsProvider: voice.ttsProvider } : {}),
    ...(voice.model ? { model: voice.model } : {}),
    ...(voice.delivery ? { delivery: { ...voice.delivery } } : {}),
  }
}

function toScene(
  shot: Shot,
  folderName: ReadonlyMap<string, string>,
  opts: ExportOptions,
): SceneDocument {
  // The skeleton's ids are never read — export writes the scene's OWN shots.
  const settings = sceneSettings(shot, (i) => `beat-${i}`)
  const framing = opts.draftFor(shot.id, "framing")
  const directing = opts.draftFor(shot.id, "directing")
  const scene: SceneDocument = {}
  const name = shot.name?.trim()
  if (name) scene.name = name
  const folder = shot.folderId ? folderName.get(shot.folderId) : undefined
  if (folder) scene.folder = folder
  const look = shot.look ? toLookMap(shot.look) : undefined
  if (look && Object.keys(look).length > 0) scene.look = look
  const frame = toFrameDocument(shot, settings.frame, framing)
  if (frame) scene.frame = frame
  const shots = shot.beats?.length ? shot.beats.map(toShotDocument) : undefined
  const motion = toMotionDocument(shot, settings.motion, directing, !!shots)
  if (motion) scene.motion = motion
  if (shots) scene.shots = shots
  // A RENDERED voiceover (its result, url stripped) wins over the plan — the
  // same "what it currently reads as" rule the two stages follow above; a
  // plan-only scene (nothing generated yet) falls to `shot.plan?.voice`.
  // `casting` is a PROSE hint `ShotVoice` never carries (it exists only on
  // the plan) — merged in from the plan even once a real voiceover has
  // rendered (R38-4), so re-importing into a library that lacks the
  // voiceover's `voiceId` still tells the recipient who was cast.
  const voice = shot.voice
    ? { ...stripUrl(shot.voice), ...(shot.plan?.voice?.casting ? { casting: shot.plan.voice.casting } : {}) }
    : shot.plan?.voice
  if (voice) scene.voice = toVoiceDocument(voice)
  // A scene must carry at least one stage (§3) — FOUR of them, `voice`
  // included: a narration-only scene is a scene, and stamping a phantom empty
  // frame on it would export a framing decision nobody made. An untouched
  // placeholder still exports as an empty frame rather than vanishing.
  if (!scene.frame && !scene.motion && !scene.shots && !scene.voice) {
    scene.frame = { prompt: "" }
  }
  return scene
}

/**
 * The PICKER half of a soundtrack document — the plan's `selections`,
 * flattened onto the document's own field names. Split out (R44) because it is
 * the half a RENDERED track has nothing to say about: {@link ProductionMusic}
 * carries a prompt and a duration and no selections at all, so the pickers
 * survive a render only if they come from the plan beside it.
 *
 * `vocals`/`vocalGender` are omitted when they still read as the DEFAULTS
 * `toPlanMusic` (import.ts) fills for an omitted document — the same "the model
 * decides" discipline `AUTO_ID` gets elsewhere in this module (fix round 2,
 * item 3): re-importing without them fills the identical defaults, so writing
 * them out invents a decision the author never made. `vocals: "vocals"` alone
 * (gender left at "any") is a real pick and stays.
 */
function musicPickers(
  plan: PlanMusic | undefined,
): Omit<MusicDocument, "prompt" | "duration"> {
  const sel = plan?.selections
  if (!sel) return {}
  const vocals = sel.vocals === "vocals" ? ("vocals" as const) : undefined
  const vocalGender = vocals && sel.vocalGender !== "any" ? sel.vocalGender : undefined
  return {
    ...(vocals ? { vocals } : {}),
    ...(vocalGender ? { vocalGender } : {}),
    ...(sel.genre ? { genre: sel.genre } : {}),
    ...(sel.mood ? { mood: sel.mood } : {}),
    ...(sel.instruments.length ? { instruments: [...sel.instruments] } : {}),
    ...(sel.singingStyle ? { singingStyle: sel.singingStyle } : {}),
    ...(sel.language ? { language: sel.language } : {}),
  }
}

/**
 * The production's ONE soundtrack, root `music` (plan-import-v2 D5).
 *
 * MERGED, not either-or (R44). A RENDERED track (`opts.music`) still decides
 * the PROSE — `prompt`/`duration`, the same "what it currently reads as" rule
 * {@link toScene}'s voice branch follows, minus the `url`/`provider` a result
 * owns (D8) — but the PICKERS come from the plan beside it, because a rendered
 * track has no `selections` field for them to come from. Discarding them the
 * moment a track landed meant pressing Generate silently cost the exported file
 * the genre, mood and instruments the author had chosen: the same production,
 * exported one click apart, described its own soundtrack differently.
 *
 * An absent `selections` (a hand-authored plan that never went through a
 * picker) exports the prompt alone, either way.
 */
function toMusicDocument(opts: ExportOptions): MusicDocument | undefined {
  if (opts.music) {
    return {
      prompt: opts.music.prompt,
      ...(opts.music.duration !== undefined ? { duration: opts.music.duration } : {}),
      ...musicPickers(opts.musicPlan),
    }
  }
  const plan = opts.musicPlan
  if (!plan) return undefined
  // A picker-only DRAFT has no prose to export — and since R64/A2 made the
  // panel's pickers store-owned, a plan CAN exist before a word is typed.
  // `repairMusic` drops a blank-prompt node on the way back in, so writing one
  // would ship a soundtrack that silently vanishes on re-import.
  if (!plan.prompt.trim()) return undefined
  return {
    prompt: plan.prompt,
    ...(plan.duration !== undefined ? { duration: plan.duration } : {}),
    ...musicPickers(plan),
  }
}

/**
 * What the EXPORTER writes — a {@link ProductionDocument} whose root `music`
 * slot is the {@link MusicDocument} it has always been. The document type keeps
 * that slot `unknown` for the IMPORT boundary alone (R42: the structural schema
 * must not hard-fail a whole file over one malformed soundtrack), and there is
 * no reason for the export side to lose its typing over the import side's
 * defensiveness — a caller reading `doc.music.prompt` type-checks again.
 */
export type ExportedProductionDocument = Omit<ProductionDocument, "music"> & {
  music?: MusicDocument
}

export function exportProduction(
  shots: ReadonlyArray<Shot>,
  film: ProductionFilmLook | undefined,
  folders: ReadonlyArray<ProductionFolder>,
  title: string,
  opts: ExportOptions,
): ExportedProductionDocument {
  const folderName = new Map(folders.map((f) => [f.id, f.name]))
  const cast = toCast(shots, opts)
  const filmLook = film ? toLookMap(film) : undefined
  const music = toMusicDocument(opts)
  return {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    ...(title.trim() ? { title: title.trim() } : {}),
    ...(opts.storyboard?.brief?.trim() ? { brief: opts.storyboard.brief.trim() } : {}),
    ...(filmLook && Object.keys(filmLook).length > 0 ? { film: filmLook } : {}),
    ...(folders.length > 0 ? { folders: folders.map((f) => f.name) } : {}),
    scenes: shots.map((shot) => toScene(shot, folderName, opts)),
    ...(cast.length > 0 ? { cast } : {}),
    ...(music ? { music } : {}),
  }
}

/**
 * `ConnectedReference.source` → the cast KIND. Local on purpose: the identical
 * map in `lib/project-references` sits behind a closure that reaches
 * `import.meta.env`, and nothing in `production-format/` may import that (§9).
 * `wired-image` has no row — a manual image chip is not cast.
 */
const CAST_KIND_BY_SOURCE: Readonly<Record<string, CastEntry["kind"]>> = {
  "wired-character": "character",
  "wired-face": "character",
  "wired-location": "location",
  "wired-object": "object",
  "wired-creature": "creature",
}

/** A word character for boundary purposes — the mirror of `lib/prompt-mentions`'s
 *  own `isWordChar`, which is unexported there and stays that way (§9 keeps this
 *  module's closure narrow). */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch)
}

/** Is this chip the ACTOR, rather than one pinned view of them? The enroller's
 *  own predicate (`cast-merge.castFromChips`), applied to the same question
 *  from the other side: which image may stand for the person. */
function isCanonicalRef(ref: ConnectedReference): boolean {
  return !ref.isExtraRef && !ref.variantSlug
}

/** The references a prose string actually NAMES. `cast` is DERIVED (§7): a chip
 *  whose `@Name` is no longer in the prose is not advertised — and re-imports as
 *  nothing, which is exactly what the round-trip caveat says.
 *
 *  A mention ENDS where prose resumes (`recoverTypedMentions`' rule), so
 *  "@Alleyway" never advertises a chip called "Alley". Only the character AFTER
 *  the name is checked — the `@` is its own left boundary.
 *
 *  TWO SPELLINGS (C6): a cast chip serializes as its `@<role-slug>` token, not
 *  as `@Display Name`, so a slice whose chips are all cast would otherwise
 *  advertise nothing at all. The token is derived from the reference's own name
 *  (`roleTokenForName`) — cast-free, like every other reader of this grammar. */
function namedIn(
  text: string,
  refs: ReadonlyArray<ConnectedReference>,
): ConnectedReference[] {
  return refs.filter((r) => proseNames(text, r.defaultName))
}

/** Does this prose NAME a role — in either of the two spellings? Lifted out of
 *  {@link namedIn} so a DESCRIBED role, which has no chip to be filtered by,
 *  is advertised on exactly the same terms a bound one is. */
function proseNames(text: string, displayName: string): boolean {
  const name = displayName.toLowerCase()
  if (!name) return false
  const lower = text.toLowerCase()
  const says = (needle: string, isToken = false): boolean => {
    for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, i + 1)) {
      const after = lower[i + needle.length]
      // For a TOKEN, `-` also ends nothing: it would make the run a LONGER
      // token than this one (`@panda` inside `@panda-2`). A NAME keeps the
      // boundary it always had — hyphenated prose after a name ("@Kira-like")
      // is not a different name.
      if (!isWordChar(after) && !(isToken && after === "-")) return true
    }
    return false
  }
  const token = roleTokenForName(displayName)
  return says(`@${name}`) || (token !== null && says(token, true))
}

/**
 * What a recipient would have to create: every bound entity the EXPORTED prose
 * names, deduped by kind + name.
 *
 * INFORMATIONAL (D4) — the importer itself creates nothing, and the preview
 * lists what the recipient's library is missing. `imageUrl` is what makes the
 * recipient's own "Create them…" possible (D8, the one user-initiated
 * exception): it is written by a STUDIO EXPORT, from the bound entity's own
 * image, and an authored plan simply leaves it out.
 *
 * From the CANONICAL chip only. A cast-look VIEW chip (`isExtraRef` /
 * `variantSlug`, `applyCastLook`) is a pose pinned for one scene, not a claim
 * about who somebody is — the enroller skips them for the same reason, and a
 * recipient creating an actor FROM one would get a library row whose canonical
 * image is a back-of-the-head shot. Only a view of them in the slice ⇒ the row
 * still ships, without a url: who is missing is worth saying either way.
 *
 * DESCRIBED ROLES (spec `2026-09-06-reference-menu-and-described-roles-design`)
 * ship too, and they are the reason this reads the cast at all: a name with
 * words and no face has no chip to be found by, so it is advertised off the
 * REGISTRY, on the same terms — the prose has to name it ({@link proseNames}),
 * and it rides without an `imageUrl` because there is no actor to picture.
 *
 * `description` is the role's own HAND-WRITTEN line, never the library's
 * caption: absent on the row means "use the live caption" (spec §2.1), and
 * writing the caption into the file would freeze one the library later changes.
 */
function toCast(
  shots: ReadonlyArray<Shot>,
  opts: ExportOptions,
): CastEntry[] {
  const out: CastEntry[] = []
  const seen = new Map<string, number>()
  const described = Object.values(opts.cast ?? {}).flatMap((m) => {
    if (hasActor(m)) return []
    // The PLAN's four kinds, found the way `readCast` finds the panel's five —
    // so the narrowing is the list's, not a hand-written cast.
    const kind = CAST_KIND_LIST.find((k) => k === m.kind)
    return kind ? [{ kind, name: m.displayName, description: m.description }] : []
  })
  for (const shot of shots) {
    const framing = opts.draftFor(shot.id, "framing")
    const directing = opts.draftFor(shot.id, "directing")
    const hasShots = !!shot.beats?.length
    // A take's own references are deliberately absent: its prompt is never
    // exported, and a shot's chips are carried by the shot itself.
    const refs: ConnectedReference[] = [
      ...(activeStill(shot)?.references ?? []),
      ...(framing?.references ?? []),
      ...(shot.plan?.frame?.references ?? []),
      ...(directing?.references ?? []),
      ...(shot.plan?.motion?.references ?? []),
      ...(shot.beats ?? []).flatMap((b) => b.references ?? []),
    ]
    const prose = [
      framingPrompt(shot, framing)?.text,
      motionPrompt(shot, directing, hasShots),
      // The scene's generic prompt is prose like any other — a role may be
      // named ONLY there, and a cast list that missed it would ship a name the
      // recipient is never told to create.
      shot.scenePrompt,
      ...(shot.beats ?? []).map((b) => b.text),
    ]
      .filter((text): text is string => !!text)
      .join("\n")
    for (const { kind, name, description } of described) {
      if (!proseNames(prose, name)) continue
      const key = `${kind}:${name.toLowerCase()}`
      if (seen.has(key)) continue
      seen.set(key, out.length)
      out.push({ kind, name, ...(description ? { description } : {}) })
    }
    for (const ref of namedIn(prose, refs)) {
      const kind = CAST_KIND_BY_SOURCE[ref.source]
      if (!kind) continue
      const key = `${kind}:${ref.defaultName.toLowerCase()}`
      const imageUrl = isCanonicalRef(ref) ? ref.url : undefined
      const description = opts.cast?.[castKeyForName(ref.defaultName)]?.description
      const at = seen.get(key)
      if (at === undefined) {
        seen.set(key, out.length)
        out.push({
          kind,
          name: ref.defaultName,
          ...(description ? { description } : {}),
          ...(imageUrl ? { imageUrl } : {}),
        })
        continue
      }
      // A later CANONICAL chip fills in the image an earlier scene's pinned
      // view couldn't give — scene order must not decide the actor's picture.
      const first = out[at]!
      if (!first.imageUrl && imageUrl) out[at] = { ...first, imageUrl }
    }
  }
  return out
}

/** The longest stem a production name contributes, before `.studio.json`. Well
 *  under every filesystem's 255-byte component limit even at 4 bytes a char. */
const FILE_STEM_MAX = 120

/** `<production name>.studio.json` — {@link import("../shot").shotFileName}'s
 *  rule for the plan file (path-hostile characters stripped, never empty), plus
 *  the two a downloaded FILE needs that a clip name did not: edge DOTS go (a
 *  leading one hides the file, a trailing one runs into the extension), and the
 *  stem is capped. The cap is applied BEFORE the final edge-strip, so a cut can
 *  never leave the name ending on a dash, a dot or a space. */
export function productionFileName(title: string): string {
  const safe = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .slice(0, FILE_STEM_MAX)
    .replace(/^[-.\s]+|[-.\s]+$/g, "")
  return `${safe || "production"}.studio.json`
}

/** The ONE sentence both download paths show when the production carries
 *  RENDERED audio the plan format does not take (D8) — an explicit EXPORT-side
 *  receipt for that loss, the same discipline the importer's own warnings give
 *  every drop on the way in, so nobody discovers it silently on the far side.
 *  Reworded for D4 (R38-5) then D5: a voiceover's LINE, voice pick and
 *  delivery travel as a plan (`toScene`'s `voice` field), and the
 *  soundtrack's PROMPT and pickers do too (`toMusicDocument`'s `music` field)
 *  — only the RENDERED audio of either one does not (there is no url in this
 *  format, for any stage). */
export const UNEXPORTED_AUDIO_NOTICE =
  "A voiceover’s line and voice pick travel as a plan, and so does the soundtrack’s description — the rendered audio does not, for either."

/** The ONE sentence both download paths show when there is nothing to write:
 *  `scenes` is `.min(1)` in the format's own schema (schema.ts) and scenes map
 *  1:1 from shots, so a scene-less production could only produce a file this
 *  app's own importer rejects. Both paths refuse with the same words. */
export const EMPTY_EXPORT_NOTICE = "Nothing to export yet — add a scene first."

/** Whether the production carries RENDERED audio (a voiceover or a soundtrack
 *  that has actually generated) the plan format does NOT take — its url,
 *  never carried by any stage of this format (D8). A soundtrack PLAN alone
 *  (no `music` yet) triggers no notice: `toMusicDocument` already exports it
 *  in full. */
export function hasUnexportedAudio(
  shots: ReadonlyArray<Shot>,
  music: ProductionMusic | undefined,
): boolean {
  return !!music || shots.some((s) => !!s.voice)
}
