/**
 * One descriptor per use-case node (decided 2026-10-14): everything a route,
 * an estimator, the review and the editor need to know about a type, so none
 * of them names a type. Adding a use-case node = a builder + one entry here
 * (and its registrations outside this package). Pure.
 */
import {
  isUseCaseNodeType,
  type UseCaseGraph,
  type UseCaseMediaKind,
  type UseCaseMediaSource,
  type UseCaseNodeType,
  type UseCaseResultKind,
} from "./use-case-graph"
import {
  TIGHTEN_EPISODE,
  TIGHTEN_MAX_EPISODE_SEC,
  TIGHTEN_NODE_IDS,
  buildTightenEpisodeGraph,
  resolveTightenEpisodeSettings,
  type TightenEpisodeSettings,
} from "./tighten-episode-graph"
import {
  CHAPTERS_NODE_IDS,
  EPISODE_CHAPTERS,
  buildEpisodeChaptersGraph,
  resolveEpisodeChaptersSettings,
  type EpisodeChaptersSettings,
} from "./episode-chapters-graph"

export type UseCaseInputHandle = "media" | "music" | "introCard"
export interface UseCaseSources {
  readonly media: UseCaseMediaSource
  readonly music?: { readonly url: string }
  readonly introCard?: { readonly url: string }
}
export type UseCaseSettings = Readonly<Record<string, unknown>>

export interface UseCaseDescriptor {
  readonly type: UseCaseNodeType
  /** English label (server messages, MCP); the editor shows its own localized label. */
  readonly label: string
  readonly route: string
  readonly maxSourceSec: number
  /** A recording without picture is refused before anything starts. */
  readonly needsVideo: boolean
  readonly inputs: readonly UseCaseInputHandle[]
  /** The built node each wired input stands for (an estimate replaces it by the real source). */
  readonly inputNodeIds: Readonly<Partial<Record<UseCaseInputHandle, string>>>
  /** The node data keys a run sends its route. */
  readonly settingKeys: readonly string[]
  readonly reviewable: boolean
  readonly resultKind: UseCaseResultKind
  resolveSettings(raw: UseCaseSettings | undefined, mediaKind: UseCaseMediaKind): UseCaseSettings
  build(settings: UseCaseSettings, sources: UseCaseSources): UseCaseGraph
}

/** A descriptor as written: its builder takes the settings its own resolver makes, type-checked as such. */
interface UseCaseSpec<S extends object> extends Omit<UseCaseDescriptor, "resolveSettings" | "build"> {
  resolveSettings(raw: UseCaseSettings | undefined, mediaKind: UseCaseMediaKind): S
  build(settings: S, sources: UseCaseSources): UseCaseGraph
}

/**
 * A descriptor from its spec. A caller only ever builds from settings the same
 * descriptor's `resolveSettings` made, so the settings type is erased here,
 * once, and nowhere else: each builder is checked against its own settings.
 */
function defineUseCase<S extends object>(spec: UseCaseSpec<S>): UseCaseDescriptor {
  return {
    ...spec,
    resolveSettings: (raw, kind) => spec.resolveSettings(raw, kind) as unknown as UseCaseSettings,
    build: (settings, sources) => spec.build(settings as unknown as S, sources),
  }
}

const tighten = defineUseCase<TightenEpisodeSettings>({
  type: TIGHTEN_EPISODE,
  label: "Tighten Episode",
  route: `/v1/${TIGHTEN_EPISODE}`,
  maxSourceSec: TIGHTEN_MAX_EPISODE_SEC,
  needsVideo: false,
  inputs: ["media", "music"],
  inputNodeIds: { media: TIGHTEN_NODE_IDS.source, music: TIGHTEN_NODE_IDS.music },
  settingKeys: ["output", "framing", "captions", "captionStyle", "reviewBeforeRender", "planTier", "instructions", "styleGuide", "musicDuckAmount"],
  reviewable: true,
  resultKind: "episode",
  resolveSettings: (raw, kind) => resolveTightenEpisodeSettings(raw, kind),
  build: (settings, sources) =>
    buildTightenEpisodeGraph(settings, { media: sources.media, ...(sources.music ? { music: sources.music } : {}) }),
})

const chapters = defineUseCase<EpisodeChaptersSettings>({
  type: EPISODE_CHAPTERS,
  label: "Chapters",
  route: `/v1/${EPISODE_CHAPTERS}`,
  maxSourceSec: TIGHTEN_MAX_EPISODE_SEC,
  needsVideo: false,
  inputs: ["media"],
  inputNodeIds: { media: CHAPTERS_NODE_IDS.source },
  settingKeys: ["planTier", "instructions", "styleGuide"],
  reviewable: false,
  resultKind: "chapters",
  resolveSettings: (raw, kind) => resolveEpisodeChaptersSettings(raw, kind),
  build: (settings, sources) => buildEpisodeChaptersGraph(settings, { media: sources.media }),
})

export const USE_CASE_DESCRIPTORS: { readonly [K in UseCaseNodeType]: UseCaseDescriptor } = Object.freeze({
  [TIGHTEN_EPISODE]: tighten,
  [EPISODE_CHAPTERS]: chapters,
})

export function usecaseDescriptor(type: UseCaseNodeType): UseCaseDescriptor {
  return USE_CASE_DESCRIPTORS[type]
}

export function usecaseContinuePath(type: UseCaseNodeType): string {
  return `${USE_CASE_DESCRIPTORS[type].route}/continue`
}

/** Is a node of `type` a use-case node whose own result is a list (Clip Pack's clips, Trailer's formats)? */
export function usecaseListsItsResult(type: string | null | undefined): boolean {
  if (!isUseCaseNodeType(type)) return false
  const kind = USE_CASE_DESCRIPTORS[type].resultKind
  return kind === "clips" || kind === "formats"
}

/**
 * Is a node of `type` a use-case node whose own result is text (Chapters' show
 * notes on `text`, its list on `json`), with no episode? Its `text` pip is also
 * what an edge naming no pip reads.
 */
export function usecaseResultIsText(type: string | null | undefined): boolean {
  return isUseCaseNodeType(type) && USE_CASE_DESCRIPTORS[type].resultKind === "chapters"
}
