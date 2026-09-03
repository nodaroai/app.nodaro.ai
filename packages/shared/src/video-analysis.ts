/**
 * Video-analysis node — shared data contract.
 *
 * Single source of truth for the video-analysis node: the backend worker, the
 * frontend, and a future generator all import from here. Two schema layers:
 *   - `windowAnalysisSchema` — what the LLM emits per analysis window
 *     (strict-JSON footer). `scenes` has NO min (a quiet window returning zero
 *     scenes is a VALID result). Model-emitted `oversized`/`slotRefs` are
 *     STRIPPED here — they are validator-computed later (z.object drops unknown
 *     keys by default).
 *   - `videoAnalysisResultSchema` — the merged, validator-computed result across
 *     all windows; requires >=1 scene overall.
 *
 * Entity slots are referenced in scene `visual` text via `{slot:<id>}` tokens
 * (`SLOT_TOKEN_RE`) — a grammar distinct from `NODE_REF_PATTERN` and the
 * `{image:N}` reference tokens. Unresolved tokens UNWRAP to their literal id
 * text, never delete (spec invariant), so a downstream prompt never carries a
 * dangling `{slot:…}` placeholder.
 */
import { z } from "zod"

export const VIDEO_ANALYSIS_MAX_SCENE_SEC = 8

/**
 * Camera VIEWPOINT — where the camera is relative to the subject. The axis
 * `shotType` does not carry, and the one the analyzer had been improvising.
 *
 * Two failures this fixes, both from real jobs:
 *
 *  1. `shotType` is framing SIZE (Wide … Extreme Close-Up), so a true angle had
 *     nowhere to go and landed in the MOVEMENT field instead:
 *     `"camera": "low angle static"`. That loses the angle to anything reading
 *     `camera` and pollutes the movement vocabulary.
 *  2. The relational viewpoints — `Over-the-Shoulder`, `POV` — were conventions
 *     inside the `shotType` list, competing with the sizes for one slot. So an
 *     over-the-shoulder MEDIUM had to pick one and threw the other away. They
 *     belong here, leaving `shotType` free to state the size: an OTS medium is
 *     `shotType: "Medium"` + `angle: "over-the-shoulder"`, which is strictly more
 *     than either field could carry alone.
 *
 * A closed enum rather than free text precisely because improvisation is the
 * failure being fixed. Absent means EYE-LEVEL — the overwhelming default, so
 * omitting it costs nothing on most shots (the same "absence is the default"
 * shape as `transitionOut` and appearance variations).
 *
 * `from-behind` and `over-the-shoulder` also carry real meaning downstream: a
 * face is not visible in either, which is what auto-cast needs to know before
 * choosing one as an identity reference.
 */
export const VIDEO_ANALYSIS_SHOT_ANGLES = [
  // Vertical placement and roll — the classical "angles".
  "eye-level", "low", "high", "overhead", "worms-eye", "dutch",
  // Relational viewpoints — where the camera sits with respect to the subject.
  "over-the-shoulder", "pov", "profile", "from-behind",
] as const
export type VideoAnalysisShotAngle = (typeof VIDEO_ANALYSIS_SHOT_ANGLES)[number]

/** Viewpoints in which the subject's FACE is not visible — so a frame shot this
 *  way is a poor identity reference however good its framing otherwise is. */
export const VIDEO_ANALYSIS_FACELESS_ANGLES: ReadonlySet<string> = new Set(["over-the-shoulder", "from-behind"])

/**
 * Effects applied to the PICTURE of a shot. An array — a shot can be grainy and
 * vignetted at once — and absent when the image is clean, which is most shots.
 *
 * Scoped deliberately to things done to the IMAGE, and NOT to compositing that
 * asserts what is in the shot (picture-in-picture, split screen). That line
 * matters: a real job invented `{slot:creator} overlay talking to camera` across
 * nine scenes for a man who is never seen, so a field for "there is an inset of a
 * person here" would hand that fabrication a legitimate home. An effect is
 * verifiable in the pixels; a claim about who is inset is not.
 *
 * `dissolve` and `fade` are NOT here either — they are edits BETWEEN shots and
 * belong to `transitionOut`.
 */
export const VIDEO_ANALYSIS_VISUAL_EFFECTS = [
  "blur", "pixelate", "glitch", "grain", "vignette", "flash", "distortion", "double-exposure",
] as const
export type VideoAnalysisVisualEffect = (typeof VIDEO_ANALYSIS_VISUAL_EFFECTS)[number]

/**
 * Visible edit INTO the next shot.
 *
 * `dissolve` (a cross-fade from one image to the other) is distinct from `fade`
 * (through black or white). Collapsing both onto `fade` — as this enum did — makes
 * a recreation render the wrong edit, and the two look nothing alike.
 *
 * ABSENT means NOTHING ASSERTED (since v2): the analyser emits a value only
 * when it can see the device; an unknown or uncertain edit is left out so the
 * video model chooses. `cut` is itself an assertion (an instant change between
 * two clearly different shots), never a default.
 */
export const VIDEO_ANALYSIS_TRANSITIONS = [
  "cut", "fade", "dissolve", "wipe", "whip",
  // v2 (2026-08-30, recast shot craft rev 1.5 Appendix F): the common edits a
  // creator actually cuts with. `white-flash` / `digital-glitch` are spelled
  // out because `flash` / `glitch` already name in-shot EFFECTS (the axis test
  // below) — a device is the edit BETWEEN two shots, an effect is on one shot.
  "zoom", "slide", "white-flash", "digital-glitch", "morph", "match", "jump",
] as const
export type VideoAnalysisTransition = (typeof VIDEO_ANALYSIS_TRANSITIONS)[number]

/**
 * What burned-in text IS (2026-08-28, recast shot craft). Decides render-vs-omit
 * downstream: a `subtitle` is a transcription of the piece's own speech — a
 * recreation re-speaks it and must not render it — while a `title`, `caption`,
 * `lower-third` or `logo` is picture content. Absent when a scene carries no
 * text. A new KEY on the scene: strip-mode readers drop it harmlessly.
 */
export const VIDEO_ANALYSIS_TEXT_KINDS = ["title", "caption", "lower-third", "subtitle", "logo", "other"] as const
export type VideoAnalysisTextKind = (typeof VIDEO_ANALYSIS_TEXT_KINDS)[number]

/** How the CLIP opens (clip-level, not per scene — a window's first scene is
 *  not the clip's). Absent ⇒ a hard open. Only `fade` today. */
export const VIDEO_ANALYSIS_CLIP_TRANSITIONS_IN = ["fade"] as const
export type VideoAnalysisClipTransitionIn = (typeof VIDEO_ANALYSIS_CLIP_TRANSITIONS_IN)[number]

/**
 * Time manipulation — slow motion, ramps, timelapse, freeze, reverse.
 *
 * Previously unrepresentable anywhere in the schema, so a recreation rendered
 * every shot at normal speed no matter what the footage did. It is a first-class
 * lever in every video model and a real editing decision in most action footage.
 *
 * `"normal"` is deliberately NOT a member: absence is normal speed, so there is
 * exactly one way to say "nothing unusual here" and the field costs nothing on
 * the majority of shots.
 */
export const VIDEO_ANALYSIS_SPEED_EFFECTS = ["slow-motion", "ramp-in", "ramp-out", "timelapse", "freeze", "reverse"] as const

/** CHRONICLE TIME (2026-08-17): the STORY clock, per scene, as read from the
 *  pictures — light, sky, practicals. "ambiguous" is the honest answer for a
 *  windowless interior; guessing day is exactly the kind of tidy inference
 *  the analysis doctrine forbids. */
export const VIDEO_ANALYSIS_TIMES_OF_DAY = ["dawn", "day", "dusk", "night", "ambiguous"] as const

/** STORY JUMP since the PREVIOUS scene in the list: how much narrative time
 *  passed across the cut, judged from evidence (wardrobe change, aged
 *  subjects, season, a title card), not from the cut itself. Time outranks
 *  location for continuity judgements (same person, new place, continuous
 *  time ⇒ same outfit; same place, years later ⇒ anything may differ), which
 *  is why this is a structured field and not prose. "unclear" is the honest
 *  default; the FIRST scene of a clip is "continuous" by convention. */
export const VIDEO_ANALYSIS_STORY_JUMPS = ["continuous", "same-day", "another-day", "years-later", "unclear"] as const
export type VideoAnalysisSpeedEffect = (typeof VIDEO_ANALYSIS_SPEED_EFFECTS)[number]

/**
 * The CLIP-LEVEL look — one source of truth for the properties that belong to
 * the whole piece rather than any one shot.
 *
 * Colour grade, camera format and lens character were previously only ever prose
 * inside each scene's `visual`, which meant a 43-scene analysis re-decided the
 * grade forty-three independent times with nothing holding them consistent. That
 * is the same drift problem entity slots solve for people: state it once, apply it
 * everywhere. A recreation reads this alongside every scene.
 *
 * Every field optional — an analyzer that cannot read the format should say
 * nothing rather than guess, and a per-scene deviation still belongs in that
 * scene's `visual` prose.
 */
export const clipLookSchema = z.object({
  /**
   * The rendering MEDIUM — "live-action photoreal", "2D anime", "stop-motion
   * claymation", "3D render", "oil painting", "pixel art".
   *
   * The most consequential field in this object, and orthogonal to every other
   * one: two shots with identical grade, lens, lighting and framing still look
   * nothing alike when one is live action and the other is an oil painting. Get
   * this wrong and a recreation renders the whole piece in the wrong medium,
   * which no amount of correct grade or lighting can rescue.
   *
   * Mirrors the product's Style picker, whose catalog defines exactly this axis
   * and states its independence from lighting, colour-look, atmosphere and lens.
   * A clip that genuinely changes medium partway (live action with an animated
   * insert) states the deviation in that scene's `visual`, as with `lighting`.
   */
  style: z.string().optional(),
  /**
   * The Style picker CATALOG ID the prose in `style` corresponds to — the
   * analyzer's PICK ("pixar-3d" beside "3D stylized animation"), not a second
   * description of it.
   *
   * Worth strictly more than the prose it accompanies: an id addresses the
   * catalog, so a recreation renders the same medium the product's own Style
   * picker would render, instead of re-interpreting a sentence. Absent when the
   * analyzer read a medium it could not place in the catalog — `style` then
   * carries the whole answer, as it always did.
   *
   * A free `string` here on purpose. The PRODUCER validates it against the
   * catalog (the analyzer plugin's wire schema is an enum generated from
   * `STYLES`, so an invented id never leaves it), while this package must not
   * carry the catalog itself. A closed enum here would only add a second copy
   * of the vocabulary to drift out of date — and, worse, would REJECT a
   * catalog entry newer than the installed `@nodaro/shared`, which is exactly
   * the analysis a consumer most wants to read.
   */
  styleId: z.string().optional(),
  /** Colour grade / palette — "muted teal-and-orange, crushed blacks". */
  grade: z.string().optional(),
  /** Camera or film FORMAT and stock — "anamorphic digital", "16mm film grain". */
  format: z.string().optional(),
  /** Lens character — "wide-angle, shallow depth of field throughout". */
  lens: z.string().optional(),
  /** Overall lighting style — "hard single-source daylight, deep shadow". */
  lighting: z.string().optional(),
  /** What KIND of piece this is — "cinematic trailer", "talking-head vlog". */
  genre: z.string().optional(),
  /**
   * The visual INFLUENCE the piece clearly evokes — a cinematographer, director,
   * photographer or named aesthetic ("shot like Deakins", "Wes Anderson
   * symmetry", "80s Kodachrome editorial").
   *
   * The highest-leverage field here by a distance: a couple of words transfer a
   * whole aesthetic that would otherwise take a paragraph of grade, lens and
   * lighting prose to approximate — which is exactly why the product already
   * exposes it as a curated picker ("Photographer / Artist") whose catalog ships
   * `in the style of …` prompt hints. The analyzer had no way to read it back.
   *
   * Deliberately conservative: OMIT unless the footage genuinely evokes a
   * well-known, nameable style. A confident misattribution is worse than silence,
   * because it drags an entire wrong aesthetic into every regenerated shot — so
   * describing the look in `grade`/`lighting` always beats guessing a name.
   */
  influence: z.string().optional(),
})
export type ClipLook = z.infer<typeof clipLookSchema>
export const VIDEO_ANALYSIS_ENTITY_SOURCES = ["wired-character", "wired-object", "wired-location", "wired-creature"] as const
export type VideoAnalysisEntitySource = (typeof VIDEO_ANALYSIS_ENTITY_SOURCES)[number]
/** Matches {slot:<id>} tokens. Distinct from NODE_REF_PATTERN / {image:N} grammars. */
export const SLOT_TOKEN_RE = /\{slot:([a-z0-9-]+)\}/g

/**
 * Appearance variations (cast-variations spec, 2026-07-24): a slot's canonical
 * `description` IS its default look; `variations` enumerates NON-default looks
 * only (dream vs reality, flashback, disguise…). `"default"` is a reserved
 * variationId — used in scene bindings / ledger keys / routing for unbound
 * scenes, never inside `variations[]`. The closed slug vocabulary is
 * doctrine-enforced (the schema pins only the id charset, like `role`);
 * `alt-1`/`alt-2` are the escape hatches.
 */
export const VIDEO_ANALYSIS_VARIATION_SLUGS = ["dream", "flashback", "disguise", "costume", "transformation", "era", "alt-1", "alt-2"] as const
/** Max NON-default looks per slot. The window layer REJECTS past the cap (schema-forced retry); the cross-window merge FOLDS at the cap. */
export const VIDEO_ANALYSIS_MAX_VARIATIONS = 4
export const VIDEO_ANALYSIS_DEFAULT_VARIATION = "default"

export const slotVariationSchema = z.object({
  variationId: z.string().min(1).regex(/^[a-z0-9-]+$/)
    .refine((id) => id !== VIDEO_ANALYSIS_DEFAULT_VARIATION, { message: `"${VIDEO_ANALYSIS_DEFAULT_VARIATION}" is reserved for the slot's canonical look` }),
  label: z.string().min(1),
  /** Full STANDALONE casting-sheet look restating the slot's invariant identity
   *  core (face, build, age) — the manifest substitutes it wholesale, so a
   *  wardrobe-only delta would silently delete identity from the prompt. */
  description: z.string().min(1),
  /** Per-variation identity reference (auto-cast frame or user sheet). In the
   *  schema from day one: every strip-mode round-trip must carry it. */
  refImageUrl: z.string().url().optional(),
})
export type SlotVariation = z.infer<typeof slotVariationSchema>

export const entitySlotSchema = z.object({
  slotId: z.string().min(1).regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  source: z.enum(VIDEO_ANALYSIS_ENTITY_SOURCES),
  role: z.string().min(1),
  description: z.string().min(1),
  /** Auto-cast visual reference — a hosted frame from the analyzed footage
   *  where this entity is clearly visible. Optional/additive: producers may
   *  omit it; consumers use it as an identity reference for recreation. */
  refImageUrl: z.string().url().optional(),
  /**
   * Why `refImageUrl` is ABSENT, when the analyzer's vision pass actively
   * refused every candidate frame rather than merely failing to produce one.
   *
   * Present only alongside a missing `refImageUrl`, and only for a real refusal
   * — never for a technical failure, so its presence always carries meaning. The
   * important case reads like "the shots bound to this slot show someone else —
   * cast as X, but on screen: Y", which is the analyzer telling you the casting
   * description and the footage disagree. A consumer should treat that as a
   * reason to review the slot before spending on regeneration, since a wrong
   * identity propagates into every regenerated shot.
   */
  refRejectedReason: z.string().optional(),
  /** NON-default looks only; present only when at least one exists. */
  variations: z.array(slotVariationSchema).max(VIDEO_ANALYSIS_MAX_VARIATIONS).optional(),
})
export type EntitySlot = z.infer<typeof entitySlotSchema>

/**
 * The sound LAYER vocabulary — what kind of thing this layer is.
 *
 * `ambience` is deliberately its own member rather than a flavour of `sfx`:
 * they are different layers of a real mix and they are recreated by different
 * means — ambience is the continuous bed a scene sits in (room tone, distant
 * traffic, wind), an sfx is a discrete hit (a door slam, a gunshot). Folded
 * together, a scene's bed and its one-off noises arrive indistinguishable and
 * anything recreating the mix has to guess which it was told.
 *
 * Exported so a consumer keying its own document by these modes imports the
 * vocabulary instead of restating it — the same reason every other closed
 * vocabulary in this file is a const.
 */
export const VIDEO_ANALYSIS_AUDIO_MODES = ["speech", "music", "sfx", "ambience"] as const
export type VideoAnalysisAudioMode = (typeof VIDEO_ANALYSIS_AUDIO_MODES)[number]

/**
 * One concurrent sound layer in a scene. Real footage stacks sound (music bed
 * under dialogue over ambient room tone), so a scene carries an ARRAY of these
 * — an empty array means genuine silence. `content`: speech = verbatim words;
 * music/sfx/ambience = gen-ready description. `voice` is speech-only
 * voice-casting.
 */
const audioLayerSchema = z.object({
  mode: z.enum(VIDEO_ANALYSIS_AUDIO_MODES),
  content: z.string().min(1),
  voice: z.string().optional(),
  /**
   * SPEECH ONLY — `slotId` of the on-screen speaker saying these words.
   *
   * `voice` casts a voice ("male, proud triumphant shouting"); this says WHO it
   * belongs to, so a recreation can route the line to the right character
   * instead of guessing. Usually one person speaks per scene and the guess is
   * right, which is exactly why the cases with two speakers over one cut fail
   * silently without this field.
   *
   * Optional by design and deliberately NOT refined against `mode` here: the
   * window schema is the enforced decode grammar, and rejecting a whole roll
   * because the model tagged a music layer would be a hair-trigger failure. A
   * speaker on a non-speech layer, or one naming a slot that no longer exists,
   * is stripped structurally by `dropUnknownSpeakers` — the same
   * unwrap/drop/sweep philosophy the slot-token and binding channels use.
   *
   * An unseen narrator gets NO speaker: a voice with no body is never a slot
   * (doctrine §5), so attribution here would resurrect the phantom-entity
   * defect that `stripOrphanSlots` exists to kill.
   */
  speakerSlot: z.string().optional(),
  /**
   * SPEECH ONLY — WHO says these words, by NAME.
   *
   * The second of two ways to name a speaker, and the one for documents that
   * have no slots: `speakerSlot` addresses an `EntitySlot` of THIS analysis by
   * id, while `speaker` is the plain cast name a production keys its own cast
   * by ("Jack Mercer"). A layer may legitimately carry both — the id for the
   * analysis it came from, the name for the document it is going into — and a
   * consumer that understands only one reads the one it understands.
   *
   * Optional, and not refined against `mode`, for the same reason
   * `speakerSlot` is not: the window schema is the enforced decode grammar and
   * must not throw away a whole roll over one mis-tagged field.
   *
   * NOT swept by `dropUnknownSpeakers`. That function is the SLOT channel's
   * sanitizer — it judges an id against the surviving slot list, and a name has
   * no id space to be unknown in. The asymmetry is deliberate and pinned by
   * test; whoever owns the name's vocabulary sanitizes the name.
   *
   * The residual that leaves: a layer can keep a `speaker` naming someone
   * `stripOrphanSlots` already pruned as a phantom, where the same claim spelled
   * `speakerSlot` would have been dropped — the invented-narrator defect, in the
   * one spelling the sweep cannot see. LATENT today, since nothing in this
   * repo emits `speaker`; the day the analyzer does, that sweep is what has to
   * grow, not this field.
   */
  speaker: z.string().optional(),
})
export type AudioLayer = z.infer<typeof audioLayerSchema>

const windowSceneBase = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  label: z.string().min(1),
  shotType: z.string().min(1),
  camera: z.string(),
  /** Camera VIEWPOINT. Absent ⇒ eye-level. Keeps `camera` to pure MOVEMENT and
   *  frees `shotType` to state the SIZE even on an over-the-shoulder or POV. */
  angle: z.enum(VIDEO_ANALYSIS_SHOT_ANGLES).optional(),
  /** Time manipulation. Absent ⇒ normal speed. */
  speed: z.enum(VIDEO_ANALYSIS_SPEED_EFFECTS).optional(),
  /** CHRONICLE TIME (2026-08-17) — see the consts' docstrings. Both optional:
   *  absent on every pre-2.6.0 analysis, and legitimately absent when the
   *  analyser cannot read the clock. Enum + optional keeps the window decode
   *  grammar congruence-safe (no ints, no maxItems). */
  timeOfDay: z.enum(VIDEO_ANALYSIS_TIMES_OF_DAY).optional(),
  storyJump: z.enum(VIDEO_ANALYSIS_STORY_JUMPS).optional(),
  visual: z.string().min(1),
  /**
   * Text burned into the PICTURE of this shot — titles, captions, lower-thirds,
   * subtitles — verbatim, in its original script. Absent when the frame carries
   * none.
   *
   * Doctrine already asks for on-screen text inside `visual` prose, but a
   * recreation needs to know discretely whether to RENDER text at all, and
   * `translateOnScreenTextToEnglish` had no structured field to land in. It is
   * also the signal the auto-cast frame judge reads: picture text belonging to an
   * earlier scene's speech means the shot is replayed footage under a voice-over.
   */
  onScreenText: z.string().optional(),
  /** What the on-screen text IS. Meaningful only when `onScreenText` is non-empty. */
  onScreenTextKind: z.enum(VIDEO_ANALYSIS_TEXT_KINDS).optional(),
  /** Effects on this shot's PICTURE. Absent ⇒ a clean image. */
  effects: z.array(z.enum(VIDEO_ANALYSIS_VISUAL_EFFECTS)).optional(),
  transitionOut: z.enum(VIDEO_ANALYSIS_TRANSITIONS).optional(),
  // Round 4 (2026-08-30, recast shot craft rev 1.5 Appendix F.8): the edit into
  // the next scene in the analyser's OWN WORDS — a few words of what it saw
  // ("fast blurred pan left", "fade to black", "zoom-blur warp into the tunnel")
  // — or absent when the take continues through the change or no edit is seen
  // (nothing asserted: the video model decides from story and refs). The closed
  // `transitionOut` vocabulary above is LEGACY from here on: kept so stored
  // blueprints still parse, never emitted again. Readers take
  // `transition ?? transitionOut`.
  transition: z.string().trim().min(1).max(120).optional(),
  // Array of concurrent layers (music + speech + sfx together); [] = silence.
  audio: z.array(audioLayerSchema),
  /** slotId → variationId for slots wearing a NON-default look in this scene
   *  (only slots referenced in the scene; absent key ⇒ the default look).
   *  Rides windowSceneBase so BOTH the window layer and analyzedSceneSchema
   *  inherit it — the out-of-band binding channel (no in-text markers, D6). */
  slotVariations: z.record(z.string(), z.string()).optional(),
})
// .strip() (default) drops model-emitted oversized/slotRefs — validator-computed only.
const windowSceneSchema = windowSceneBase.refine((s) => s.endSec > s.startSec, { message: "endSec must be > startSec" })
export type WindowScene = z.infer<typeof windowSceneSchema>

/** What the MODEL emits per window (strict-JSON footer schema). scenes has NO min. */
export const windowAnalysisSchema = z.object({
  language: z.string().optional(),
  /** The clip-level look as read from THIS window. Merge folds the windows
   *  field-by-field (first non-empty wins), like `language`. */
  look: clipLookSchema.optional(),
  /** The clip opens with a fade-in. Folded from window 0 only. */
  transitionIn: z.enum(VIDEO_ANALYSIS_CLIP_TRANSITIONS_IN).optional(),
  slots: z.array(entitySlotSchema),
  scenes: z.array(windowSceneSchema),
})
export type WindowAnalysis = z.infer<typeof windowAnalysisSchema>

export const analyzedSceneSchema = windowSceneBase.extend({
  sceneNumber: z.number().int().min(1),
  visualResolved: z.string().min(1),
  oversized: z.boolean().optional(),
  slotRefs: z.array(z.string()),
}).refine((s) => s.endSec > s.startSec, { message: "endSec must be > startSec" })
export type AnalyzedScene = z.infer<typeof analyzedSceneSchema>

export const videoAnalysisResultSchema = z.object({
  meta: z.object({
    durationSec: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspectRatio: z.string(),
    title: z.string().optional(),
    language: z.string().optional(),
  }),
  /** Clip-level look, merged across windows. Deliberately a sibling of `meta`
   *  rather than a member: `meta` is probed fact (ffprobe dimensions, probed
   *  duration), while this is the model's reading of the photography. */
  look: clipLookSchema.optional(),
  /** The clip opens with a fade-in. Folded from window 0 only. */
  transitionIn: z.enum(VIDEO_ANALYSIS_CLIP_TRANSITIONS_IN).optional(),
  slots: z.array(entitySlotSchema),
  scenes: z.array(analyzedSceneSchema).min(1),
  /** CAST VARIATIONS (§4 cap handling): looks the analyzer's merge FOLDED into
   *  the default at VIDEO_ANALYSIS_MAX_VARIATIONS — recorded, never silent. In
   *  the wire schema so strip-mode consumers (the recast client's validated
   *  blueprint view) keep it: the §6 "folded into default look" note is the
   *  user's only pre-pay defense against a wrong split. */
  variationFolds: z.array(z.object({
    slotId: z.string(),
    variationId: z.string(),
    label: z.string(),
  })).optional(),
  /**
   * Analyzer diagnostics for THIS result — things the analysis noticed about
   * itself that a reader should know before spending on regeneration.
   *
   * Added because there was previously no channel for them at all: the merge
   * layer has always produced a warnings list and the auto-cast pass has always
   * had findings, and every one of them died in a `console.warn` inside a worker
   * the user cannot see. So a run could quietly drop a duplicated line, fold a
   * cast look, or conclude a character is not the person their own description
   * names, and the result looked indistinguishable from a clean one.
   *
   * Prose, not codes, and deliberately so — these are read by a human deciding
   * whether to re-run, not branched on. Absent when there is nothing to report.
   */
  warnings: z.array(z.string()).optional(),
})
export type VideoAnalysisResult = z.infer<typeof videoAnalysisResultSchema>

export function deriveSlotRefs(visual: string): string[] {
  const out: string[] = []
  for (const m of visual.matchAll(SLOT_TOKEN_RE)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

export function rewriteSlotTokens(visual: string, renames: Record<string, string>): string {
  return visual.replace(SLOT_TOKEN_RE, (whole, id: string) => (renames[id] ? `{slot:${renames[id]}}` : whole))
}

/** Unresolved tokens unwrap to their literal id text — never deleted (spec invariant). */
export function unwrapUnresolvedTokens(text: string, validIds: Set<string>): { text: string; unresolved: string[] } {
  const unresolved: string[] = []
  const out = text.replace(SLOT_TOKEN_RE, (whole, id: string) => {
    if (validIds.has(id)) return whole
    if (!unresolved.includes(id)) unresolved.push(id)
    return id
  })
  return { text: out, unresolved }
}

/**
 * Rewrite a scene's `slotVariations` after cross-window slot/variation
 * unification: slot keys map through `slotRenames`, then each variation value
 * maps through `variationRenames[<new slotId>]`. Absent renames pass through.
 */
export function rewriteSceneBindings(
  sv: Record<string, string> | undefined,
  slotRenames: Record<string, string>,
  variationRenames?: Record<string, Record<string, string>>,
): Record<string, string> | undefined {
  if (!sv) return undefined
  const out: Record<string, string> = {}
  for (const [slotId, variationId] of Object.entries(sv)) {
    const newSlot = slotRenames[slotId] ?? slotId
    out[newSlot] = variationRenames?.[newSlot]?.[variationId] ?? variationId
  }
  return out
}

/**
 * Drop bindings whose (slotId, variationId) no longer exists after a merge —
 * the unwrap-rule mirror: never persist a dangling binding, and report what
 * was dropped so the caller can warn. `"default"` is always valid for a known
 * slot. `kept` is undefined when nothing survives (no `{}` materialization).
 */
export function dropUnknownBindings(
  sv: Record<string, string> | undefined,
  validBySlot: Map<string, Set<string>>,
): { kept?: Record<string, string>; dropped: Array<{ slotId: string; variationId: string }> } {
  if (!sv) return { dropped: [] }
  const kept: Record<string, string> = {}
  const dropped: Array<{ slotId: string; variationId: string }> = []
  for (const [slotId, variationId] of Object.entries(sv)) {
    const valid = validBySlot.get(slotId)
    if (valid && (variationId === VIDEO_ANALYSIS_DEFAULT_VARIATION || valid.has(variationId))) kept[slotId] = variationId
    else dropped.push({ slotId, variationId })
  }
  return { kept: Object.keys(kept).length > 0 ? kept : undefined, dropped }
}

/**
 * Rewrite speech attribution after cross-window slot unification — the
 * `rewriteSceneBindings` counterpart for the `audio` channel. Slot unification
 * renames a loser id to its survivor and rewrites `{slot:…}` tokens and
 * variation bindings; an un-rewritten `speakerSlot` would be left pointing at an
 * id that no longer exists. Copy-on-write: returns the input array untouched
 * when no layer names a renamed slot.
 */
export function rewriteSpeakerSlots(audio: AudioLayer[], slotRenames: Record<string, string>): AudioLayer[] {
  if (!audio.some((a) => a.speakerSlot !== undefined && slotRenames[a.speakerSlot])) return audio
  return audio.map((a) => {
    const to = a.speakerSlot !== undefined ? slotRenames[a.speakerSlot] : undefined
    return to ? { ...a, speakerSlot: to } : a
  })
}

/**
 * Strip attribution that no scene can honour — the `dropUnknownBindings` mirror
 * for the `audio` channel. Two cases, both model sloppiness rather than errors
 * worth failing a roll over:
 *   - a `speakerSlot` on any non-`speech` layer (nobody is speaking)
 *   - a `speakerSlot` naming a slot that is not in the final list
 *
 * MUST run AFTER the orphan-slot sweep, and attribution must NEVER count as a
 * slot reference for that sweep: a slot reachable only as a speaker is a voice
 * with no body — precisely the invented-narrator entity doctrine §5 forbids. The
 * two passes compose to remove both the phantom slot and the dangling
 * attribution pointing at it.
 */
export function dropUnknownSpeakers(
  audio: AudioLayer[],
  validSlotIds: Set<string>,
): { audio: AudioLayer[]; dropped: string[] } {
  const dropped: string[] = []
  const out = audio.map((a) => {
    if (a.speakerSlot === undefined) return a
    if (a.mode === "speech" && validSlotIds.has(a.speakerSlot)) return a
    dropped.push(a.speakerSlot)
    const { speakerSlot: _drop, ...rest } = a
    return rest
  })
  return { audio: dropped.length > 0 ? out : audio, dropped }
}

/**
 * Fold each window's reading of the clip look into one, FIELD BY FIELD: the first
 * window that had something to say about a field wins it.
 *
 * Per-field rather than first-window-wins-everything because the windows see
 * different footage — an opening window may read the grade confidently while only
 * a later one contains the shot that reveals the format. Mirrors how `language` is
 * resolved across windows rather than taken from window 0.
 *
 * Returns undefined when no window said anything, so an analysis with nothing to
 * report omits the field rather than shipping an empty object.
 */
export function mergeClipLook(looks: ReadonlyArray<ClipLook | undefined>): ClipLook | undefined {
  const out: Record<string, string> = {}
  for (const look of looks) {
    for (const [k, v] of Object.entries(look ?? {})) {
      if (typeof v === "string" && v.trim() && !out[k]) out[k] = v.trim()
    }
  }
  return Object.keys(out).length > 0 ? (out as ClipLook) : undefined
}

/** Substitute {slot:x}: castMap binding wins, else the slot's description, else literal id. */
export function renderAnalyzedScene(scene: { visual: string }, slots: EntitySlot[], castMap?: Record<string, string>): string {
  const byId = new Map(slots.map((s) => [s.slotId, s]))
  return scene.visual.replace(SLOT_TOKEN_RE, (_whole, id: string) => castMap?.[id] ?? byId.get(id)?.description ?? id)
}

/**
 * Float slack for the oversize comparison.
 *
 * Scene boundaries arrive as decimal seconds and the duration is derived by
 * SUBTRACTING two of them, which does not land on the cap exactly: a real job
 * produced a 12.67 → 20.67 scene whose computed length is 8.000000000000002,
 * so a scene sitting precisely ON the 8s cap was flagged oversized and carried
 * a `oversized: true` defect marker downstream for no reason.
 *
 * A microsecond is orders of magnitude below any boundary precision the
 * analyzer can actually resolve (windows land on ~0.01s at best), so this can
 * never mask a genuinely oversized scene — the smallest real overshoot is
 * still ~10000x larger than the tolerance.
 */
const OVERSIZE_TOLERANCE_SEC = 1e-6

export function isOversizedScene(startSec: number, endSec: number): boolean {
  return endSec - startSec > VIDEO_ANALYSIS_MAX_SCENE_SEC + OVERSIZE_TOLERANCE_SEC
}

const STANDARD_RATIOS: Array<[string, number]> = [
  ["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4], ["21:9", 21 / 9],
]
export function aspectRatioFromDims(w: number, h: number): string {
  const r = w / h
  for (const [label, v] of STANDARD_RATIOS) if (Math.abs(r - v) / v < 0.03) return label
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(Math.round(w), Math.round(h))
  return `${Math.round(w) / g}:${Math.round(h) / g}`
}

/** Sung-vocal evidence in a music layer's gen-ready description. Word-bounded
 *  and deliberately WITHOUT bare "song"/"music" (an instrumental bed is
 *  routinely described as a "pop song"). Quoted text of some length inside a
 *  music layer counts too — analysers quote lyrics. */
const MUSIC_VOCAL_RE = /\b(?:lyrics?|sung|sings?|singing|vocals?|chorus|verse|rap(?:ping|ped)?|a cappella)\b/i
const MUSIC_VOCAL_QUOTE_RE = /["\u201c][^"\u201d]{6,}["\u201d]/
/** Negated-vocal phrasing — a layer matching this contributes NO vocal
 *  evidence (it does not veto other layers). */
const MUSIC_NO_VOCAL_RE = /\b(?:no|without|non)[- ](?:vocals?|lyrics?|singing)\b|\binstrumental\b|\bwordless\b/i

/**
 * MUSIC-VIDEO INFERENCE (2026-08-17): is this clip a music video — one whose
 * soundtrack IS the content, to be taken as-is with no stem separation?
 *
 * Lives in SHARED because two sides must agree BYTE-FOR-BYTE on the answer:
 * the recast route derives `music.mode` from it server-side, and the client
 * both prices the original-audio prep and GUARDS on the server's derived mode
 * at generate time — two hand-written copies of this heuristic would drift
 * into that guard firing on honest runs. Deterministic, throw-proof on any
 * malformed analysis (absent fields ⇒ false).
 *
 * The rule is conservative toward FALSE (a false positive keeps unwanted
 * dialogue in the render; a false negative merely runs the separation, which
 * was yesterday's default): at least 4 scenes, at least 80% of scenes carry a
 * music layer, and at least one music layer carries sung-vocal evidence that
 * is not negated ("instrumental", "no vocals").
 *
 * An EXPLICIT analyze-time flag always wins — callers use
 * `flag === true || inferMusicVideo(analysis)` and never let a cached false
 * suppress the inference (the flag can only ever be set true; false means
 * "unset", not "denied").
 */
export function inferMusicVideo(analysis: {
  scenes?: ReadonlyArray<{ audio?: ReadonlyArray<{ mode?: string; content?: string }> }>
} | undefined | null): boolean {
  const scenes = analysis?.scenes ?? []
  if (scenes.length < 4) return false
  const musicLayers = (sc: (typeof scenes)[number]) => (sc.audio ?? []).filter((a) => a?.mode === "music")
  const withMusic = scenes.filter((sc) => musicLayers(sc).length > 0).length
  if (withMusic / scenes.length < 0.8) return false
  return scenes.some((sc) =>
    musicLayers(sc).some((a) => {
      const content = typeof a.content === "string" ? a.content : ""
      if (MUSIC_NO_VOCAL_RE.test(content)) return false
      return MUSIC_VOCAL_RE.test(content) || MUSIC_VOCAL_QUOTE_RE.test(content)
    }),
  )
}

// ---------------------------------------------------------------------------
// The analysis as a BRIEF — the compact projection an LLM is handed
// ---------------------------------------------------------------------------

/** Top-level keys the analyzer derives AFTER the model's pass (merge
 *  diagnostics, folded cast looks). A reader drafting FROM the analysis — a
 *  production plan, a script — needs none of them. */
const DERIVED_ANALYSIS_TOP_KEYS: ReadonlySet<string> = new Set(["warnings", "variationFolds"])

/** Per-scene keys the validator computes from `visual` and the slot list. */
const DERIVED_ANALYSIS_SCENE_KEYS: ReadonlySet<string> = new Set(["visualResolved", "slotRefs", "oversized"])

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/**
 * The analysis with its server-derived fields removed — the form an LLM is
 * handed when the analysis IS the brief (Nodaro Studio's Director and its
 * job-id loader). Drops `warnings` and `variationFolds` at the top and
 * `visualResolved`, `slotRefs`, `oversized` on every scene; keeps
 * `refImageUrl` (a downstream cast image) and everything else. Never mutates;
 * a non-object input comes back as-is.
 *
 * ONE strip list, shared by the worker that composes the brief server-side
 * (`llm-structured` jobs with a `videoUrl`) and the client that loads a
 * finished analysis into a textarea, so the two can never drift.
 */
export function stripDerivedAnalysisFields(json: unknown): unknown {
  const doc = asRecord(json)
  if (!doc) return json
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(doc)) {
    if (DERIVED_ANALYSIS_TOP_KEYS.has(key)) continue
    out[key] =
      key === "scenes" && Array.isArray(value)
        ? value.map((scene) => {
            const s = asRecord(scene)
            if (!s) return scene
            return Object.fromEntries(Object.entries(s).filter(([k]) => !DERIVED_ANALYSIS_SCENE_KEYS.has(k)))
          })
        : value
  }
  return out
}
