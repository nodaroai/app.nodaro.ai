/**
 * The use-case graph builders, keyed by builder (decided 2026-10-18): what
 * each builder needs (its source ceiling, the node data keys a run sends, the
 * built node every wired input stands for, its result kind) and how it
 * resolves settings and builds its graph. No type id, label, route, inputs or
 * review flag: a node's row (use-case-rows.ts) names its builder and provides
 * those, and use-case-registry.ts composes the two into a descriptor.
 *
 * tools/units reads this file as text (use-case-rules.mjs): a unit's
 * `execution.builder` must be a key of USE_CASE_SPECS, written as
 * `  <key>: defineUseCase<…>({`. Adding a builder = a new key here. Pure.
 */
import type { UseCaseGraph, UseCaseMediaKind } from "./use-case-graph"
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

/** The descriptor fields a node's row (and @nodaro/shared's review holds) provide — never a spec's. */
type UseCaseRowFields = "type" | "label" | "route" | "inputs" | "reviewable"

/** A builder's spec as the registry composes it: a descriptor minus its row's fields, settings erased. */
export type UseCaseBuilderSpec = Omit<UseCaseDescriptor, UseCaseRowFields>

/** A spec as written: its builder takes the settings its own resolver makes, type-checked as such. */
interface UseCaseSpec<S extends object> extends Omit<UseCaseBuilderSpec, "resolveSettings" | "build"> {
  resolveSettings(raw: UseCaseSettings | undefined, mediaKind: UseCaseMediaKind): S
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
    resolveSettings: (raw, kind) => spec.resolveSettings(raw, kind) as unknown as UseCaseSettings,
    build: (settings, sources) => spec.build(settings as unknown as S, sources),
  }
}

export const USE_CASE_SPECS = {
  tighten: defineUseCase<TightenEpisodeSettings>({
    maxSourceSec: TIGHTEN_MAX_EPISODE_SEC,
    needsVideo: false,
    inputNodeIds: { media: TIGHTEN_NODE_IDS.source, music: TIGHTEN_NODE_IDS.music },
    settingKeys: ["output", "framing", "captions", "captionStyle", "reviewBeforeRender", "planTier", "instructions", "styleGuide", "musicDuckAmount"],
    resultKind: "episode",
    resolveSettings: (raw, kind) => resolveTightenEpisodeSettings(raw, kind),
    build: (settings, sources) =>
      buildTightenEpisodeGraph(settings, { media: sources.media, ...(sources.music ? { music: sources.music } : {}) }),
  }),
  chapters: defineUseCase<EpisodeChaptersSettings>({
    maxSourceSec: TIGHTEN_MAX_EPISODE_SEC,
    needsVideo: false,
    inputNodeIds: { media: CHAPTERS_NODE_IDS.source },
    settingKeys: ["planTier", "instructions", "styleGuide"],
    resultKind: "chapters",
    resolveSettings: (raw, kind) => resolveEpisodeChaptersSettings(raw, kind),
    build: (settings, sources) => buildEpisodeChaptersGraph(settings, { media: sources.media }),
  }),
} as const

export type UseCaseBuilderKey = keyof typeof USE_CASE_SPECS
