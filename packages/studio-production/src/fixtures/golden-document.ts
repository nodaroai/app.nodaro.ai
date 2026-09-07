/**
 * THE GOLDEN PRODUCTION, AUTHORED — the document `build-golden.ts` serializes.
 *
 * Every value here is a literal: no `Date.now`, no `crypto.randomUUID`, no
 * clock and no randomness anywhere in the closure. The fixture is compared
 * BYTE-for-byte in two repos, so a value that moved between renders would make
 * the contract untestable — the same rule the operations themselves keep
 * (`ctx.now`, `ctx.mintId`), applied to the document they act on.
 *
 * What it carries, and why each piece is here (plan P1.0, spec §11):
 *  - SHOT 1 — the fully worked scene: a three-deep still history with the
 *    cinematic channel as IDS, a two-deep clip history whose takes remember the
 *    frames they were made from, an in-flight animate MARKER, a voiceover with
 *    tuned delivery, timed beats carrying a SPOKEN cue, a scene look and a cast
 *    pin. If a save can erode anything, it erodes here first.
 *  - SHOT 2 — a REFERENCES-mode clip with no still at all: the one shape whose
 *    video node has no start frame and no still→clip edge.
 *  - SHOT 3 — a node-less RECIPE placeholder with its plan: the entry that
 *    claims no node and must survive parse anyway.
 *  - The production layers: a two-role cast (a bound character, and a location
 *    carrying the role phrase its reference rides with), a film look, a folder,
 *    a storyboard with its brief, a soundtrack plan, one final cut, and a bin
 *    holding one deleted image and one deleted take.
 *
 * Absent on purpose: `music` (the op script adds and drops one), `shared`
 * (sharing flips only through the audience-gated route, D3.5) and `archived`.
 */
import type { ConnectedReference } from "@nodaro/shared"

import { castSlug, enrollCastMember, type Cast, type CastLookMap } from "../cast"
import type { ScenePlan } from "../scene-plan"
import { buildClip, buildStill } from "../shot"
import type {
  PlanMusic,
  ProductionCut,
  ProductionFilmLook,
  ProductionFolder,
  Shot,
  ShotBeat,
  ShotClipResult,
  ShotPendingClip,
  ShotRecipe,
  ShotStillResult,
  ShotVoice,
} from "../shot"
import {
  parseProduction,
  serializeProduction,
  type SerializedProduction,
  type StoryboardSettings,
} from "../shot-graph"
import type { TrashedItem } from "../trash"

/** The parsed document — what `parseProduction` returns, named once here. */
export type ParsedProduction = ReturnType<typeof parseProduction>

// ── the one re-serialize both the builder and the test use ──────────────────

/**
 * A parsed production → the graph a save writes.
 *
 * `serializeProduction`'s thirteen positional arguments are the reason this
 * exists: every caller that spelled them out by hand would be one rename away
 * from silently swapping `trash` for `cuts`. Named once, here.
 */
export function reserialize(production: ParsedProduction): SerializedProduction {
  return serializeProduction(
    production.shots,
    production.selectedShotId,
    production.music,
    production.shared,
    production.folders,
    production.storyboard,
    production.cuts,
    production.trash,
    production.freecutDraftUrl,
    production.film,
    production.cast,
    production.musicPlan,
    production.archived,
  )
}

// ── the cast ────────────────────────────────────────────────────────────────

export const KIRA = "Kira"
export const VALLEY = "Sunspire Valley"
/** The keys enrolment mints — INV-C: `castSlug(kind, displayName) === key`. */
export const KIRA_KEY = castSlug("character", KIRA)
export const VALLEY_KEY = castSlug("location", VALLEY)

/**
 * Two roles: a bound CHARACTER carrying its own identity description and a
 * default look, and a LOCATION carrying the role phrase its reference rides
 * with (`defaultRole`). Enrolled through the registry's own `enrollCastMember`
 * so the keys are the ones a real enrolment would mint.
 */
function buildCast(): Cast {
  const withKira = enrollCastMember(
    {},
    {
      kind: "character",
      assetId: "char-kira",
      displayName: KIRA,
      defaultLook: {
        url: "https://r2.example/cast/kira-front.png",
        variantSlug: "angles:front",
        label: "front",
      },
      description: "A courier in a rain-black coat.",
    },
  )
  if (!withKira) throw new Error("golden fixture: the character did not enroll")
  const withValley = enrollCastMember(withKira.cast, {
    kind: "location",
    assetId: "loc-sunspire",
    displayName: VALLEY,
    defaultRole: "background",
  })
  if (!withValley) throw new Error("golden fixture: the location did not enroll")
  if (withKira.key !== KIRA_KEY || withValley.key !== VALLEY_KEY) {
    throw new Error("golden fixture: the cast keys are not the ones castSlug mints")
  }
  return withValley.cast
}

/** The bound chip a prompt's `@kira` resolves to. */
const kiraChip: ConnectedReference = {
  id: "char-kira",
  defaultName: KIRA,
  source: "wired-character",
  url: "https://r2.example/cast/kira-front.png",
  characterSlug: KIRA_KEY,
  description: "A courier in a rain-black coat.",
}

/** …and the location's, so the plan's own chips are a different source. */
const valleyChip: ConnectedReference = {
  id: "loc-sunspire",
  defaultName: VALLEY,
  source: "wired-location",
  url: "https://r2.example/cast/sunspire.png",
}

// ── shot 1: framed, animated, voiced, and mid-render ─────────────────────────

/** The scene's timed beats — the second carries the SPOKEN cue (D5). */
const beats: ReadonlyArray<ShotBeat> = [
  {
    id: "beat-1",
    seconds: 3,
    text: `${KIRA} steps to the parapet and looks east.`,
    label: "Opening",
    picks: { cameraMotionId: "dolly-in" },
    references: [kiraChip],
    transition: { id: "cross-dissolve" },
    characterFx: { id: "wind-swept", intensity: "subtle" },
    directions: [
      {
        kind: "speech",
        text: "[quietly] We move at first light.",
        speaker: KIRA,
        voice: "voice-kira",
      },
    ],
  },
  {
    id: "beat-2",
    seconds: 2,
    text: "The storm front rolls over the ridge behind her.",
    directions: [{ kind: "sfx", text: "distant thunder" }],
  },
]

const stillResultsShot1: ReadonlyArray<ShotStillResult> = [
  {
    url: "https://r2.example/still-1a.png",
    jobId: "job-still-1a",
    name: "Wide establishing",
    prompt: `@${KIRA_KEY} on the rooftop at first light`,
    negativePrompt: "motion blur",
    provider: "flux-2-max",
    referenceImageUrls: ["https://r2.example/ref/rooftop.png"],
    references: [kiraChip],
    aspectRatio: "16:9",
    resolution: "2k",
    count: 2,
    promptFormat: 2,
    look: { timeOfDay: "blue-hour", style: "neo-noir" },
    filmLook: { style: "neo-noir" },
    sceneLook: { timeOfDay: "blue-hour" },
    subject: { heldProp: ["lantern"] },
  },
  {
    url: "https://r2.example/still-1b.png",
    jobId: "job-still-1b",
    prompt: `@${KIRA_KEY} on the rooftop at first light`,
    provider: "flux-2-max",
    filerobotDesignStateUrl: "https://r2.example/design/still-1b.json",
    promptFormat: 2,
    look: { timeOfDay: "blue-hour" },
  },
  {
    url: "https://r2.example/still-1c.png",
    jobId: "job-still-1c",
    prompt: "the rooftop, empty",
    provider: "nano-banana",
  },
]

const clipResultsShot1: ReadonlyArray<ShotClipResult> = [
  {
    url: "https://r2.example/clip-1a.mp4",
    jobId: "job-clip-1a",
    name: "Take 1",
    prompt: "she turns into the wind",
    provider: "grok-i2v",
    duration: 5,
    startFrameUrl: "https://r2.example/still-1b.png",
    endFrameUrl: "https://r2.example/still-1a.png",
    references: [kiraChip],
    directions: [{ kind: "ambience", text: "wind over a wet roof" }],
    beats,
    scenePrompt: "A courier crosses the valley before the storm.",
    endTransition: { id: "fade-out" },
    aspectRatio: "16:9",
    resolution: "1080p",
    promptFormat: 2,
    look: { timeOfDay: "blue-hour" },
  },
  {
    url: "https://r2.example/clip-1b.mp4",
    jobId: "job-clip-1b",
    prompt: "she turns into the wind, slower",
    provider: "grok-i2v",
    duration: 5,
    startFrameUrl: "https://r2.example/still-1b.png",
    freecutProjectUrl: "https://r2.example/freecut/clip-1b.json",
  },
]

/** The in-flight animate marker a reload resumes polling on (D5). */
const pendingClip: ShotPendingClip = {
  jobId: "job-clip-pending-1",
  provider: "grok-i2v",
  prompt: "she turns into the wind, one more",
  startedAt: 1_757_116_800_000,
  duration: 5,
  aspectRatio: "16:9",
  resolution: "1080p",
  references: [kiraChip],
  scenePrompt: "A courier crosses the valley before the storm.",
  promptFormat: 2,
  look: { timeOfDay: "blue-hour" },
}

const voice: ShotVoice = {
  url: "https://r2.example/voice/shot-1.mp3",
  text: "We move at first light.",
  voiceId: "voice-kira",
  voiceType: "library",
  ttsProvider: "elevenlabs-v3",
  model: "eleven_v3",
  delivery: { stability: 0.35, style: 0.2 },
}

/** This scene's pin on the one true actor — a view, never an identity (D6f). */
const castLook: CastLookMap = {
  [KIRA_KEY]: {
    url: "https://r2.example/cast/kira-back.png",
    variantSlug: "angles:back",
    label: "back",
  },
}

const shot1: Shot = {
  id: "shot-1",
  name: "Rooftop dawn",
  folderId: "folder-act-1",
  still: buildStill(
    {
      nodeId: "generate-image-shot-1",
      provider: "flux-2-max",
      prompt: `@${KIRA_KEY} on the rooftop at first light`,
      direction: {
        shotSize: "wide-shot",
        composition: ["rule-of-thirds", "leading-lines"],
      },
      subject: { heldProp: ["lantern"] },
    },
    stillResultsShot1,
    1,
  ),
  clip: buildClip(
    {
      nodeId: "generate-video-shot-1",
      provider: "grok-i2v",
      prompt: "she turns into the wind",
      duration: 5,
      direction: { cameraMotion: "dolly-in" },
    },
    clipResultsShot1,
    0,
  ),
  voice,
  startFrame: "https://r2.example/still-1b.png",
  endFrame: "https://r2.example/still-1a.png",
  pendingClips: [pendingClip],
  beats,
  scenePrompt: "A courier crosses the valley before the storm.",
  endTransition: { id: "fade-out" },
  look: { timeOfDay: "blue-hour", lightingStyle: ["rim-light"] },
  castLook,
}

// ── shot 2: a references-mode clip, with no still at all ─────────────────────

const shot2: Shot = {
  id: "shot-2",
  name: "Valley crossing",
  clip: buildClip(
    {
      nodeId: "generate-video-shot-2",
      provider: "seedance-2",
      prompt: `${KIRA} crosses @${VALLEY_KEY} as the light goes`,
    },
    [
      {
        url: "https://r2.example/clip-2a.mp4",
        jobId: "job-clip-2a",
        prompt: `${KIRA} crosses @${VALLEY_KEY} as the light goes`,
        provider: "seedance-2",
        duration: 6,
        referenceImageUrls: ["https://r2.example/ref/valley.png"],
        referenceVideoUrls: ["https://r2.example/ref/crossing.mp4"],
        referenceAudioUrls: ["https://r2.example/ref/wind.mp3"],
        references: [valleyChip],
      },
    ],
    0,
  ),
  directingReferenceUrls: ["https://r2.example/ref/valley.png"],
  directingReferenceVideoUrls: ["https://r2.example/ref/crossing.mp4"],
  directingReferenceAudioUrls: ["https://r2.example/ref/wind.mp3"],
}

// ── shot 3: a node-less recipe placeholder, carrying its plan ────────────────

const recipe: ShotRecipe = {
  framing: {
    prompt: "the ridge line at dusk, no figures",
    provider: "flux-2-max",
    negativePrompt: "people",
    aspectRatio: "16:9",
    resolution: "2k",
    promptFormat: 2,
    look: { timeOfDay: "dusk" },
    subject: { animal: "wolf" },
  },
  directing: {
    prompt: "the wolf crests the ridge and stops",
    provider: "grok-i2v",
    duration: 5,
    negativePrompt: "camera shake",
    directions: [{ kind: "ambience", text: "wind in dry grass" }],
    promptFormat: 2,
    look: { timeOfDay: "dusk" },
  },
  voice: {
    text: "Nothing followed her out of the valley.",
    voiceId: "voice-narrator",
    voiceType: "premade",
    ttsProvider: "elevenlabs-multilingual",
    model: "eleven_multilingual_v2",
  },
}

const plan: ScenePlan = {
  frame: {
    prompt: "the ridge line at dusk, no figures",
    promptBaked: true,
    negativePrompt: "people",
    provider: "flux-2-max",
    aspectRatio: "16:9",
    resolution: "2k",
    count: 1,
    references: [valleyChip],
    referenceImageUrls: ["https://r2.example/ref/ridge.png"],
    subject: { animal: "wolf" },
  },
  motion: {
    prompt: "the wolf crests the ridge and stops",
    negativePrompt: "camera shake",
    provider: "grok-i2v",
    aspectRatio: "16:9",
    resolution: "1080p",
    duration: 5,
    cameraMotionId: "dolly-in",
    input: "references",
    references: [valleyChip],
    directions: [{ kind: "ambience", text: "wind in dry grass" }],
  },
  voice: {
    text: "Nothing followed her out of the valley.",
    casting: "the narrator, dry and level",
    voiceId: "voice-narrator",
    voiceType: "premade",
    ttsProvider: "elevenlabs-multilingual",
    model: "eleven_multilingual_v2",
    delivery: { stability: 0.7 },
  },
}

const shot3: Shot = { id: "shot-3", name: "Ridge line", recipe, plan }

// ── the production layers ────────────────────────────────────────────────────

const folders: ReadonlyArray<ProductionFolder> = [
  { id: "folder-act-1", name: "Act I" },
]

const film: ProductionFilmLook = {
  style: "neo-noir",
  era: "1980s",
  colorLook: "bleach-bypass",
}

const storyboard: StoryboardSettings = {
  on: true,
  brief: "A courier carries a warning across the valley before the storm lands.",
  filmLength: 45,
  scripts: {
    "shot-1": "She checks the sky, then the road.",
    "shot-2": "The crossing, in one unbroken move.",
  },
  breakdowns: { "shot-1": "Wide, then a slow push as the wind takes her coat." },
  seconds: { "shot-1": 8, "shot-2": 6 },
}

const musicPlan: PlanMusic = {
  prompt: "Low strings under a rising storm.",
  duration: 30,
  selections: {
    vocals: "instrumental",
    vocalGender: "any",
    instruments: ["strings", "taiko"],
    genre: "ambient",
    mood: "tense",
  },
}

const cuts: ReadonlyArray<ProductionCut> = [
  {
    id: "cut-a",
    name: "Cut A",
    url: "https://r2.example/cuts/cut-a.mp4",
    freecutProjectUrl: "https://r2.example/cuts/cut-a.json",
    duration: 42.5,
    shotsCount: 3,
    exportedAt: "2026-09-05T10:15:00.000Z",
    final: true,
  },
]

/** The bin: one deleted IMAGE and one deleted TAKE, both from shot 1. */
const trash: ReadonlyArray<TrashedItem> = [
  {
    kind: "still",
    id: "trash-still-1",
    shotId: "shot-1",
    shotName: "Rooftop dawn",
    index: 3,
    deletedAt: "2026-09-05T09:00:00.000Z",
    stillBase: {
      nodeId: "generate-image-shot-1",
      provider: "flux-2-max",
      prompt: `@${KIRA_KEY} on the rooftop at first light`,
    },
    result: {
      url: "https://r2.example/still-1x.png",
      jobId: "job-still-1x",
      prompt: `@${KIRA_KEY} on the rooftop at first light`,
      provider: "flux-2-max",
    },
  },
  {
    kind: "clip",
    id: "trash-clip-1",
    shotId: "shot-1",
    shotName: "Rooftop dawn",
    index: 2,
    deletedAt: "2026-09-05T09:05:00.000Z",
    clipBase: {
      nodeId: "generate-video-shot-1",
      provider: "grok-i2v",
      prompt: "she turns into the wind",
    },
    result: {
      url: "https://r2.example/clip-1x.mp4",
      jobId: "job-clip-1x",
      prompt: "she turns into the wind, wider",
      provider: "grok-i2v",
      duration: 5,
      startFrameUrl: "https://r2.example/still-1a.png",
    },
  },
]

// ── the authored production, serialized ──────────────────────────────────────

/** The production as authored above, serialized once. */
export function serializeAuthored(): SerializedProduction {
  return serializeProduction(
    [shot1, shot2, shot3],
    "shot-1",
    undefined, // no soundtrack — `set_music` / `clear_music` add and drop one
    undefined, // never shared: sharing flips only through the gated route (D3.5)
    folders,
    storyboard,
    cuts,
    trash,
    undefined, // no FreeCut draft outstanding
    film,
    buildCast(),
    musicPlan,
    undefined, // archived stays ABSENT (plan P1.0)
  )
}

