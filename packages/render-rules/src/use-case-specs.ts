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
import type { UseCaseDescriptor, UseCaseSettings, UseCaseSources } from "./use-case-registry"
import {
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
  CLIP_PACK_NODE_IDS,
  buildClipPackGraph,
  resolveClipPackSettings,
  type ClipPackSettings,
} from "./clip-pack-graph"

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
 * A builder spec from its typed form. A caller only ever builds from settings
 * the same descriptor's `resolveSettings` made, so the settings type is erased
 * here, once, and nowhere else: each builder is checked against its own settings.
 */
function defineUseCase<S extends object>(spec: UseCaseSpec<S>): UseCaseBuilderSpec {
  return {
    ...spec,
    resolveSettings: (raw, kind, shape) => spec.resolveSettings(raw, kind, shape) as unknown as UseCaseSettings,
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
    // `cameras` is resolved (and sent) only for two or more recordings or a Master audio.
    settingKeys: ["output", "framing", "captions", "captionStyle", "reviewBeforeRender", "planTier", "instructions", "styleGuide", "musicDuckAmount", "cameras"],
    resultKind: "episode",
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
    // Every chosen format is made, whichever one fails: a failed format refunds itself and is named.
    triesEvery: Object.values(TRAILER_FORMAT_SPECS).map((spec) => spec.nodeId),
    // Each format is the planned teaser at the length its render is estimated at (the longest trailer the plan cuts), after the intro card.
    outputLength: { fixedSec: renderLengthSec(editPlanRenderEstimateLength({ mode: "trailer" }, undefined)), after: "introCard" },
    resolveSettings: (raw, kind, shape) => resolveEpisodeTrailerSettings(raw, kind, shape),
    // Every recording, the master and the intro card: one recording builds exactly as before.
    build: (settings, sources) => buildEpisodeTrailerGraph(settings, sources),
  }),
  clipPack: defineUseCase<ClipPackSettings>({
    maxSourceSec: TIGHTEN_MAX_EPISODE_SEC,
    maxRecordings: 1,
    // An audio recording makes audio clips (decided 2026-10-14).
    needsVideo: false,
    inputNodeIds: { media: CLIP_PACK_NODE_IDS.source },
    settingKeys: ["count", "targetDurationSec", "framing", "captions", "captionStyle", "reviewBeforeRender", "planTier", "instructions", "styleGuide"],
    resultKind: "clips",
    // Every clip is rendered and captioned, whichever one fails: each failed clip refunds itself and is named.
    triesEvery: [CLIP_PACK_NODE_IDS.render, CLIP_PACK_NODE_IDS.captions],
    // An audio recording makes audio clips: no framing (null, the recording's shape) and no captions.
    audioForced: Object.freeze({ framing: null, captions: false }),
    resolveSettings: (raw, kind) => resolveClipPackSettings(raw, kind),
    build: (settings, sources) => buildClipPackGraph(settings, { media: sources.media }),
  }),
} as const

export type UseCaseBuilderKey = keyof typeof USE_CASE_SPECS
