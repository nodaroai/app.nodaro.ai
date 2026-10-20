/**
 * The use-case graph builders, keyed by builder (decided 2026-10-18): what
 * each builder needs (its source ceiling, how many recordings it takes, the
 * node data keys a run sends, the built node every wired input stands for,
 * its result kind) and how it resolves settings and builds its graph. No type
 * id, label, route, inputs or review flag: a node's row (use-case-rows.ts)
 * names its builder and provides those, and use-case-registry.ts composes the
 * two into a descriptor.
 *
 * tools/units reads this file as text (use-case-rules.mjs): a unit's
 * `execution.builder` must be a key of USE_CASE_SPECS, written as
 * `  <key>: defineUseCase<…>({`. Adding a builder = a new key here. Pure.
 */
import type { UseCaseGraph, UseCaseMediaKind } from "./use-case-graph"
import { USE_CASE_MASTER_NODE_ID, USE_CASE_MAX_RECORDINGS, type UseCaseSourcesShape } from "./use-case-cameras"
import { editPlanRenderEstimateLength, renderLengthSec } from "./apply-edl-estimate"
import { MULTICAM_NODE_IDS } from "./use-case-multicam"
import type { UseCaseDescriptor, UseCaseSettings, UseCaseSources } from "./use-case-registry"
import { isUseCaseFramingSource, type UseCaseFramingSource } from "./use-case-framing"
import {
  TIGHTEN_ABSENT_FRAMING_SOURCE,
  TIGHTEN_MAX_EPISODE_SEC,
  TIGHTEN_NODE_IDS,
  buildTightenEpisodeGraph,
  resolveTightenEpisodeSettings,
  type TightenEpisodeSettings,
} from "./tighten-episode-graph"
import {
  CHAPTERS_NODE_IDS,
  buildEpisodeChaptersGraph,
  resolveEpisodeChaptersSettings,
  type EpisodeChaptersSettings,
} from "./episode-chapters-graph"
import {
  TRAILER_FORMAT_SPECS,
  TRAILER_NODE_IDS,
  buildEpisodeTrailerGraph,
  resolveEpisodeTrailerSettings,
  type EpisodeTrailerSettings,
} from "./episode-trailer-graph"
import {
  CLIP_PACK_ABSENT_FRAMING_SOURCE,
  CLIP_PACK_NODE_IDS,
  buildClipPackGraph,
  resolveClipPackSettings,
  type ClipPackSettings,
} from "./clip-pack-graph"
import {
  SPEAKER_LAYOUT_ABSENT_FRAMING_SOURCE,
  SPEAKER_LAYOUT_NODE_IDS,
  buildSpeakerLayoutGraph,
  resolveSpeakerLayoutSettings,
  type SpeakerLayoutSettings,
} from "./speaker-layout-graph"

/** The descriptor fields a node's row (and @nodaro/shared's review holds) provide — never a spec's. */
type UseCaseRowFields = "type" | "label" | "route" | "inputs" | "reviewable"

/** A builder's spec as the registry composes it: a descriptor minus its row's fields, settings erased. */
export type UseCaseBuilderSpec = Omit<UseCaseDescriptor, UseCaseRowFields>

/** A spec as written: its builder takes the settings its own resolver makes, type-checked as such. */
interface UseCaseSpec<S extends object> extends Omit<UseCaseBuilderSpec, "resolveSettings" | "build"> {
  resolveSettings(raw: UseCaseSettings | undefined, mediaKind: UseCaseMediaKind, shape?: UseCaseSourcesShape): S
  build(settings: S, sources: UseCaseSources): UseCaseGraph
}

/**
 * Raw settings with the spec's absent framing default written in where they
 * name no framing source (a copy; the given object is never changed): every
 * reader of a descriptor's `resolveSettings` reads an absent source through
 * the spec, never through a resolver's own fallback.
 */
function withFramingDefault(raw: UseCaseSettings | undefined, absent: UseCaseFramingSource): UseCaseSettings | undefined {
  if (isUseCaseFramingSource(raw?.framingSource)) return raw
  return { ...(raw ?? {}), framingSource: absent }
}

/**
 * A builder spec from its typed form. A caller only ever builds from settings
 * the same descriptor's `resolveSettings` made, so the settings type is erased
 * here, once, and nowhere else: each builder is checked against its own settings.
 * Its resolver reads an absent framing source as the spec's `absentFramingSource`.
 */
function defineUseCase<S extends object>(spec: UseCaseSpec<S>): UseCaseBuilderSpec {
  return {
    ...spec,
    resolveSettings: (raw, kind, shape) => spec.resolveSettings(withFramingDefault(raw, spec.absentFramingSource), kind, shape) as unknown as UseCaseSettings,
    build: (settings, sources) => spec.build(settings as unknown as S, sources),
  }
}

export const USE_CASE_SPECS = {
  tighten: defineUseCase<TightenEpisodeSettings>({
    maxSourceSec: TIGHTEN_MAX_EPISODE_SEC,
    // Up to six recordings (decided 2026-10-17): the route's body, both
    // engines' inputs, the estimate and the stored-attempt match read them all.
    maxRecordings: USE_CASE_MAX_RECORDINGS,
    needsVideo: false,
    inputNodeIds: { media: TIGHTEN_NODE_IDS.source, music: TIGHTEN_NODE_IDS.music, masterAudio: USE_CASE_MASTER_NODE_ID },
    // `cameras` is resolved (and sent) only for two or more recordings or a Master audio; `framingSource` only when a framed episode follows faces.
    settingKeys: ["output", "framing", "captions", "captionStyle", "reviewBeforeRender", "planTier", "instructions", "styleGuide", "musicDuckAmount", "cameras", "framingSource"],
    resultKind: "episode",
    // A node with no framing source keeps the even split it always had.
    absentFramingSource: TIGHTEN_ABSENT_FRAMING_SOURCE,
    // An audio recording makes an audio episode, with no captions (its framing is only hidden, never cleared).
    audioForced: Object.freeze({ output: "audio", captions: false }),
    resolveSettings: (raw, kind, shape) => resolveTightenEpisodeSettings(raw, kind, shape),
    // Every recording, the master and the bed: one recording builds exactly as before.
    build: (settings, sources) => buildTightenEpisodeGraph(settings, sources),
  }),
  chapters: defineUseCase<EpisodeChaptersSettings>({
    maxSourceSec: TIGHTEN_MAX_EPISODE_SEC,
    maxRecordings: 1,
    needsVideo: false,
    inputNodeIds: { media: CHAPTERS_NODE_IDS.source },
    settingKeys: ["planTier", "instructions", "styleGuide"],
    resultKind: "chapters",
    // Nothing is framed.
    absentFramingSource: "static",
    resolveSettings: (raw, kind) => resolveEpisodeChaptersSettings(raw, kind),
    build: (settings, sources) => buildEpisodeChaptersGraph(settings, { media: sources.media }),
  }),
  trailer: defineUseCase<EpisodeTrailerSettings>({
    maxSourceSec: TIGHTEN_MAX_EPISODE_SEC,
    // Up to six recordings (decided 2026-10-17), read only for a viewer who may use Speaker Map.
    maxRecordings: USE_CASE_MAX_RECORDINGS,
    // Every format is a video (decided 2026-10-14): a run whose recordings are all sound only is refused.
    needsVideo: true,
    inputNodeIds: { media: TRAILER_NODE_IDS.source, introCard: TRAILER_NODE_IDS.intro, masterAudio: USE_CASE_MASTER_NODE_ID },
    // `cameras` is resolved (and sent) only for two or more recordings or a Master audio.
    settingKeys: ["formats", "reviewBeforeRender", "planTier", "instructions", "styleGuide", "cameras"],
    resultKind: "formats",
    absentFramingSource: "static",
    // Every chosen format is made, whichever one fails: a failed format refunds itself and is named.
    triesEvery: Object.values(TRAILER_FORMAT_SPECS).map((spec) => spec.nodeId),
    // Each format is the planned teaser at the length its render is estimated at (the longest trailer the plan cuts), after the intro card.
    outputLength: { kind: "fixed", fixedSec: renderLengthSec(editPlanRenderEstimateLength({ mode: "trailer" }, undefined)), after: "introCard" },
    resolveSettings: (raw, kind, shape) => resolveEpisodeTrailerSettings(raw, kind, shape),
    // Every recording, the master and the intro card: one recording builds exactly as before.
    build: (settings, sources) => buildEpisodeTrailerGraph(settings, sources),
  }),
  clipPack: defineUseCase<ClipPackSettings>({
    maxSourceSec: TIGHTEN_MAX_EPISODE_SEC,
    // Up to six recordings (decided 2026-10-17), read only for a viewer who may use Speaker Map.
    maxRecordings: USE_CASE_MAX_RECORDINGS,
    // An audio recording makes audio clips (decided 2026-10-14).
    needsVideo: false,
    inputNodeIds: { media: CLIP_PACK_NODE_IDS.source, masterAudio: USE_CASE_MASTER_NODE_ID },
    // `cameras` is resolved (and sent) only for two or more recordings or a Master audio; `framingSource` only when a framed pack follows faces.
    settingKeys: ["count", "targetDurationSec", "framing", "captions", "captionStyle", "reviewBeforeRender", "planTier", "instructions", "styleGuide", "cameras", "framingSource"],
    resultKind: "clips",
    absentFramingSource: CLIP_PACK_ABSENT_FRAMING_SOURCE,
    // Every clip is switched, rendered and captioned, whichever one fails: each failed clip refunds itself and is named.
    // The switch comes last: the render and the captions keep their places.
    triesEvery: [CLIP_PACK_NODE_IDS.render, CLIP_PACK_NODE_IDS.captions, MULTICAM_NODE_IDS.switch],
    // An audio recording makes audio clips: no framing (null, the recording's shape) and no captions.
    audioForced: Object.freeze({ framing: null, captions: false }),
    resolveSettings: (raw, kind, shape) => resolveClipPackSettings(raw, kind, shape),
    // Every recording and the master: one recording builds exactly as before.
    build: (settings, sources) => buildClipPackGraph(settings, sources),
  }),
  speakerLayout: defineUseCase<SpeakerLayoutSettings>({
    maxSourceSec: TIGHTEN_MAX_EPISODE_SEC,
    // Its picture is the result: a run whose recordings are all sound only is refused.
    needsVideo: true,
    // Up to six recordings (decided 2026-10-17), read only for a viewer who may use Speaker Map.
    maxRecordings: USE_CASE_MAX_RECORDINGS,
    inputNodeIds: { media: SPEAKER_LAYOUT_NODE_IDS.source, masterAudio: USE_CASE_MASTER_NODE_ID },
    // A new node: `cameras` and `framingSource` are always resolved (and sent).
    settingKeys: ["targetAspect", "layout", "switchType", "emphasisStyle", "framingSource", "reviewBeforeRender", "cameras"],
    resultKind: "layout",
    // A new node (decided 2026-10-17): no framing source follows faces for a viewer who may use Speaker Frames, else the even split.
    absentFramingSource: SPEAKER_LAYOUT_ABSENT_FRAMING_SOURCE,
    // Its render frames one recording whole: the route measures it and applies Speaker View's source-shape rule up front.
    wholeClipRender: true,
    // The whole recording, the same length: the clock's (the Master audio's, else the longest recording's).
    outputLength: { kind: "clock" },
    resolveSettings: (raw, kind, shape) => resolveSpeakerLayoutSettings(raw, kind, shape),
    // Every recording and the master: one recording is Speaker View's video mode on it.
    build: (settings, sources) => buildSpeakerLayoutGraph(settings, sources),
  }),
} as const

export type UseCaseBuilderKey = keyof typeof USE_CASE_SPECS
