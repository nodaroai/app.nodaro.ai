import type { WorkflowLike as Workflow } from "../workflow-like"
import type {
  PlanMusic,
  ProductionCut,
  ProductionFilmLook,
  ProductionFolder,
  ProductionMusic,
  Shot,
} from "../shot"
import { clipResults, stillResults } from "../shot"
import { parseProduction, type StoryboardSettings } from "../shot-graph"
import type { Cast } from "../cast"
import type { BundleKind, BundleMedia } from "./production-bundle"

/**
 * The bundle READER — narrow an untrusted JSON value (a picked file, a shared
 * copy) into the shots + production slice the import paths consume. Hand-rolled
 * narrowing in the repo idiom (`readShotClipboard`, shot-graph's readers) — the
 * heavy lifting is `parseProduction` itself, whose defensive readers already
 * validate every interior field; this file only validates the ENVELOPE.
 *
 * Sanitizing by construction: the returned slice deliberately has NO
 * `shared` / `trash` / `freecutDraftUrl` / `archived` / `selectedShotId`, and
 * every shot is
 * stripped of `pendingClips` (a foreign file's resume markers point at jobs
 * that were never this account's). Import paths can only re-serialize what
 * this reader hands them, so a hostile file can't smuggle those through.
 */

export type BundleParseFailure =
  | "not-a-bundle"
  | "unsupported-version"
  | "no-scenes"

/** Typed parse failure with user-facing copy in `message`. */
export class BundleParseError extends Error {
  readonly reason: BundleParseFailure

  constructor(reason: BundleParseFailure, message: string) {
    super(message)
    this.name = "BundleParseError"
    this.reason = reason
  }
}

/** The production-level fields an import may use — a deliberate whitelist. */
export interface ParsedBundleProduction {
  readonly music?: ProductionMusic
  /** The soundtrack PLAN — a bundle carries it whether or not a track was
   *  ever rendered (see `BundleSource.musicPlan`). */
  readonly musicPlan?: PlanMusic
  readonly folders?: ReadonlyArray<ProductionFolder>
  readonly storyboard?: StoryboardSettings
  readonly cuts?: ReadonlyArray<ProductionCut>
  readonly film?: ProductionFilmLook
  /**
   * The bundle's CAST — the role sheet, already narrowed by `parseProduction`'s
   * own untrusted `readCast` (re-keyed, first-per-key, malformed rows dropped).
   * Absent on every legacy bundle, which is exactly why an absent cast has to
   * mean "today's chip-addressed behavior" everywhere downstream.
   */
  readonly cast?: Cast
}

export interface ParsedBundle {
  readonly name: string
  readonly kind: BundleKind
  readonly media: BundleMedia
  readonly shots: ReadonlyArray<Shot>
  readonly production: ParsedBundleProduction
}

const KINDS: ReadonlyArray<BundleKind> = ["frame", "motion", "scene", "film"]
const MEDIAS: ReadonlyArray<BundleMedia> = ["linked", "none"]

/** Narrow the optional `nodaroStudio` meta block (absent/corrupt ⇒ inference). */
function readMeta(
  value: unknown,
): { kind: BundleKind; media: BundleMedia } | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const rec = value as Record<string, unknown>
  const kind = KINDS.find((k) => k === rec.kind)
  const media = MEDIAS.find((m) => m === rec.media)
  return kind && media ? { kind, media } : undefined
}

/** Best-effort kind for a meta-less bundle (e.g. a platform `export_workflow`). */
function inferKind(shots: ReadonlyArray<Shot>): BundleKind {
  if (shots.length !== 1) return "film"
  const shot = shots[0]!
  const bare = !shot.voice && !shot.beats?.length
  if (shot.clip && !shot.still && clipResults(shot.clip).length === 1 && bare) {
    return "motion"
  }
  if (shot.still && !shot.clip && stillResults(shot.still).length === 1 && bare) {
    return "frame"
  }
  return "scene"
}

/** A bundle whose shots carry any media is `linked`; recipe-only is `none`. */
function inferMedia(shots: ReadonlyArray<Shot>): BundleMedia {
  return shots.some((s) => s.still || s.clip || s.voice) ? "linked" : "none"
}

const NOT_A_BUNDLE = "This file isn't a Nodaro Studio export."

/**
 * Validate the ENVELOPE (the `WorkflowExport` v1 shape) and hand back the
 * record. Everything INSIDE is validated by `parseProduction`'s own defensive
 * readers, so this is deliberately shallow.
 */
function readEnvelope(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BundleParseError("not-a-bundle", NOT_A_BUNDLE)
  }
  const rec = value as Record<string, unknown>
  if (rec.version !== 1) {
    throw new BundleParseError(
      "unsupported-version",
      "This file was exported by a newer version — update and try again.",
    )
  }
  if (!Array.isArray(rec.nodes) || !Array.isArray(rec.edges)) {
    throw new BundleParseError("not-a-bundle", NOT_A_BUNDLE)
  }
  if (
    rec.settings !== undefined &&
    (typeof rec.settings !== "object" || rec.settings === null)
  ) {
    throw new BundleParseError("not-a-bundle", NOT_A_BUNDLE)
  }
  return rec
}

/**
 * Parse an untrusted JSON value into a {@link ParsedBundle}, or throw a
 * {@link BundleParseError} whose `message` is safe to toast verbatim.
 */
export function parseBundle(value: unknown): ParsedBundle {
  const rec = readEnvelope(value)

  const name =
    typeof rec.name === "string" && rec.name.trim()
      ? rec.name.trim()
      : "Imported production"

  // The interior rides the exact reader every load uses — index-less/legacy
  // graphs migrate, corrupt entries drop, nothing is trusted raw.
  const parsed = parseProduction({
    id: "bundle",
    name,
    nodes: rec.nodes,
    edges: rec.edges,
    settings: rec.settings ?? {},
  } as unknown as Workflow)

  const shots = parsed.shots.map((s) => {
    if (!s.pendingClips) return s
    const out: Shot = { ...s }
    delete (out as { pendingClips?: unknown }).pendingClips
    return out
  })
  if (shots.length === 0) {
    throw new BundleParseError(
      "no-scenes",
      "This file doesn't contain any scenes.",
    )
  }

  const meta = readMeta(rec.nodaroStudio)
  return {
    name,
    kind: meta?.kind ?? inferKind(shots),
    media: meta?.media ?? inferMedia(shots),
    shots,
    production: {
      ...(parsed.music ? { music: parsed.music } : {}),
      ...(parsed.musicPlan ? { musicPlan: parsed.musicPlan } : {}),
      ...(parsed.folders?.length ? { folders: parsed.folders } : {}),
      ...(parsed.storyboard ? { storyboard: parsed.storyboard } : {}),
      ...(parsed.cuts?.length ? { cuts: parsed.cuts } : {}),
      ...(parsed.film && Object.keys(parsed.film).length > 0
        ? { film: parsed.film }
        : {}),
      ...(parsed.cast && Object.keys(parsed.cast).length > 0
        ? { cast: parsed.cast }
        : {}),
    },
  }
}
