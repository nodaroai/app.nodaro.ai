import type { WorkflowExport } from "@nodaro/shared"

import type {
  PlanMusic,
  ProductionCut,
  ProductionFilmLook,
  ProductionFolder,
  ProductionMusic,
  Shot,
} from "../shot"
import {
  buildClip,
  buildStill,
  clipResults,
  clipTakeDisplayName,
  safeFileName,
  shotDisplayName,
  stillDisplayName,
  stillResults,
} from "../shot"
import {
  serializeProduction,
  type StoryboardSettings,
  type StudioSettingsV3,
} from "../shot-graph"
import { stripTransient, toRecipeOnlyShot } from "./production-bundle-strip"
import { castForShots } from "../cast-bundle"
import type { Cast } from "../cast"
import {
  carryDirection,
  carryStructured,
  resultDirection,
} from "../shot-direction"

/**
 * The BUNDLE format — how a frame / motion / scene / film leaves the studio as
 * a JSON file (portability spec 2026-08-31 §2).
 *
 * One envelope for all four kinds: the platform's `WorkflowExport` v1 wrapping
 * a `serializeProduction` MINI-GRAPH — the same one-shot-graph trick the shot
 * clipboard and the trash use, so any field the persistence machinery learns
 * is exported here for free, with no parallel serializer to keep in sync. A
 * bundle is therefore also a valid platform import (`workflows.import`), and a
 * platform `export_workflow` of a studio production parses here too.
 *
 * Media travels BY URL (public R2 links; the platform re-hosts bytes only
 * cross-instance). "Recipe only" bundles carry no URLs at all — the shots
 * collapse into `Shot.recipe` (see production-bundle-strip).
 *
 * Sanitation is parse → transform → serialize, never JSON surgery: building
 * through `serializeProduction` means a bundle can never carry `shared`,
 * `trash`, `freecutDraftUrl`, `archived` or out-of-band dashboard keys — the
 * serializer only emits what it is handed, and {@link BundleSource} (hence
 * `filmBody`'s `extras`) has no slot for any of them. `archived` is the newest
 * of those (A4): a soft-hide is a fact about ONE account's production list, and
 * a file that landed archived would import into a list it is filtered out of.
 */

export type BundleKind = "frame" | "motion" | "scene" | "film"

/** `linked` = media as URLs to Nodaro storage; `none` = recipe only. */
export type BundleMedia = "linked" | "none"

/** The studio meta block — top-level, so the platform's (non-strict) import
 *  schema simply drops it; nothing needs it after import. */
export interface StudioBundleMeta {
  readonly version: 1
  readonly app: "studio.nodaro.ai"
  readonly kind: BundleKind
  readonly media: BundleMedia
}

export type ProductionBundle = Omit<WorkflowExport, "settings"> & {
  readonly settings: { readonly studio: StudioSettingsV3 }
  readonly nodaroStudio: StudioBundleMeta
}

/**
 * The production slice a bundle is built from — the store's fields in the
 * editor, or `parseProduction`'s output on the dashboard. Structural on
 * purpose: both sources already have this shape.
 */
export interface BundleSource {
  readonly name: string
  readonly shots: ReadonlyArray<Shot>
  readonly music?: ProductionMusic
  /**
   * The soundtrack PLAN (prompt + pickers). Travels UNGATED by media, unlike
   * the rendered `music`: a plan carries no url and no binding, so it is the
   * `storyboard` brief's kind of field, not a rendered output's (R41).
   */
  readonly musicPlan?: PlanMusic
  readonly folders?: ReadonlyArray<ProductionFolder>
  readonly storyboard?: StoryboardSettings
  readonly cuts?: ReadonlyArray<ProductionCut>
  readonly film?: ProductionFilmLook
  /**
   * The production's CAST — the role→actor sheet a bundle carries ONCE (cast
   * spec D6g). Projected onto the exported slice by `castForShots`, and dropped
   * entirely from a recipe-only bundle: a cast row IS a binding (an actor id,
   * often a look url), and "recipe only" exists to carry no bindings. Those
   * roles still arrive as NAMES in the prose — the honest unresolved state,
   * which is exactly what a recipe promises.
   *
   * Since C6 that last sentence is something the export has to DO, not something
   * it gets: a cast chip serializes as `@<role-slug>`, so a recipe-only slice
   * that just dropped the sheet would ship machine slugs nothing in the file
   * explains. The display names are handed to `toRecipeOnlyShot`, which spells
   * the tokens back out — see `production-bundle-strip`.
   */
  readonly cast?: Cast
}

export interface BuildBundleOptions {
  /** Which shot (frame / motion / scene kinds). Ignored for `film`. */
  readonly shotId?: string
  /**
   * `false` = recipe only (scene/film kinds ONLY — a frame or motion without
   * its media is an empty file, so those two always ship linked). Default true.
   */
  readonly includeMedia?: boolean
}

/** The chosen shot + its 1-based strip position (display names are positional). */
function targetShot(
  source: BundleSource,
  shotId: string | undefined,
): { shot: Shot; index: number } {
  const index = shotId ? source.shots.findIndex((s) => s.id === shotId) : 0
  const shot = source.shots[index]
  if (!shot) throw new Error("Shot not found in this production")
  return { shot, index }
}

/** A shot's ACTIVE still result (clamped index — a stale activeIndex never throws). */
function activeStill(shot: Shot) {
  if (!shot.still) return undefined
  const results = stillResults(shot.still)
  const index = Math.min(Math.max(shot.still.activeIndex ?? 0, 0), results.length - 1)
  return { still: shot.still, result: results[index]!, index }
}

/** A shot's ACTIVE clip take (clamped index). */
function activeClip(shot: Shot) {
  if (!shot.clip) return undefined
  const results = clipResults(shot.clip)
  const index = Math.min(Math.max(shot.clip.activeIndex ?? 0, 0), results.length - 1)
  return { clip: shot.clip, result: results[index]!, index }
}

/** What a per-kind builder produces: the bundle's name + its shots (+ the
 *  production-level extras, which only a film carries). The FILM LOOK is NOT
 *  here — every kind carries it, so `buildBundle` attaches it once (D-B1). */
interface BundleBody {
  readonly name: string
  readonly shots: ReadonlyArray<Shot>
  readonly extras?: Pick<
    BundleSource,
    "music" | "musicPlan" | "folders" | "storyboard" | "cuts"
  >
}

/** The role display names a recipe-only projection spells its tokens back out
 *  with (see `BundleSource.cast`). Empty for a cast-less production. */
function roleNamesOf(cast: Cast | undefined): string[] {
  return Object.values(cast ?? {}).map((m) => m.displayName)
}

/** The whole production: every shot + the production-level layers. */
function filmBody(source: BundleSource, media: BundleMedia): BundleBody {
  const roleNames = roleNamesOf(source.cast)
  return {
    name: source.name,
    shots:
      media === "linked"
        ? source.shots.map((s) => stripTransient(s, { keepFolder: true }))
        : source.shots.map((s) =>
            toRecipeOnlyShot(s, { keepFolder: true, roleNames }),
          ),
    extras: {
      folders: source.folders,
      storyboard: source.storyboard,
      musicPlan: source.musicPlan,
      // Rendered outputs travel only with media.
      ...(media === "linked" ? { music: source.music, cuts: source.cuts } : {}),
    },
  }
}

/** One shot, whole (its histories, voice, keyframes) — or its recipe. */
function sceneBody(
  shot: Shot,
  sceneName: string,
  media: BundleMedia,
  cast: Cast | undefined,
): BundleBody {
  return {
    name: sceneName,
    shots:
      media === "linked"
        ? [stripTransient(shot)]
        : [toRecipeOnlyShot(shot, { roleNames: roleNamesOf(cast) })],
  }
}

/** A one-shot scene holding exactly the ACTIVE still result. */
function frameBody(shot: Shot, sceneName: string): BundleBody {
  const active = activeStill(shot)
  if (!active) throw new Error("This scene has no frame to export")
  return {
    name: `${sceneName} — ${stillDisplayName(active.result, active.index)}`,
    shots: [
      {
        id: shot.id,
        ...(shot.name ? { name: shot.name } : {}),
        still: buildStill(
          {
            nodeId: active.still.nodeId,
            provider: active.result.provider ?? active.still.provider,
            prompt: active.result.prompt ?? active.still.prompt,
            // The cinematic channel rebases by EXACTLY the expression above
            // (INV-D). A frame export re-projects ONE result, so the ids come
            // from that result (gated on its own `promptFormat`, which may
            // differ from a sibling's) whenever it carries the prompt, and from
            // the still level only when the prompt fell back there too. Without
            // this, the exported `generate-image` node carried raw prose and no
            // ids, and a canvas re-run folded no cinematic clause at all —
            // while a scene/film export of the same shot (a whole-shot spread
            // through `stripTransient`) kept them.
            ...(active.result.prompt !== undefined
              ? resultDirection(active.result, "image")
              : carryDirection(active.still)),
            // The canvas's `structured` is OUTSIDE that gate on purpose: it is
            // neither studio's nor the result's, so no `promptFormat` decides
            // whether the export keeps it (see `carryStructured`).
            ...carryStructured(active.still),
          },
          [active.result],
          0,
        ),
      },
    ],
  }
}

/** A one-shot scene holding exactly the ACTIVE clip take. */
function motionBody(shot: Shot, sceneName: string): BundleBody {
  const active = activeClip(shot)
  if (!active) throw new Error("This scene has no motion to export")
  return {
    name: `${sceneName} — ${clipTakeDisplayName(active.result, active.index)}`,
    shots: [
      {
        id: shot.id,
        ...(shot.name ? { name: shot.name } : {}),
        clip: buildClip(
          {
            nodeId: active.clip.nodeId,
            // Clip-level model, deliberately: an edited take's marker is
            // provenance, and buildClip must fall back to a REAL model id.
            provider: active.clip.provider,
            prompt: active.result.prompt ?? active.clip.prompt,
            duration: active.result.duration ?? active.clip.duration,
            // See `frameBody` — same INV-D rebase, mirroring the `prompt`
            // expression above (a promptless re-voice take inherits the clip's
            // ids rather than clearing them). The canvas video executors do not
            // read node-data direction YET (stored-not-yet-honored, platform
            // follow-up P4b), so this is provenance today and correct-by-then:
            // every motion bundle exported before P4b lands is already right.
            ...(active.result.prompt !== undefined
              ? resultDirection(active.result, "video")
              : carryDirection(active.clip)),
            // See `frameBody` — the passthrough is ungated on both sides.
            ...carryStructured(active.clip),
          },
          [active.result],
          0,
        ),
      },
    ],
  }
}

/**
 * Build a bundle of the given kind from a production slice. Throws on a
 * missing shot / frame / clip — the UI entries are gated on their existence,
 * so reaching here without one is a programming error, not a user state.
 */
export function buildBundle(
  kind: BundleKind,
  source: BundleSource,
  opts: BuildBundleOptions = {},
): ProductionBundle {
  // A frame or a motion IS its media — "recipe only" would be an empty file,
  // so the toggle applies to scene/film alone.
  const media: BundleMedia =
    (kind === "scene" || kind === "film") && opts.includeMedia === false
      ? "none"
      : "linked"

  let body: BundleBody
  if (kind === "film") {
    body = filmBody(source, media)
  } else {
    const { shot, index } = targetShot(source, opts.shotId)
    const sceneName = `${source.name} — ${shotDisplayName(shot, index + 1)}`
    body =
      kind === "frame"
        ? frameBody(shot, sceneName)
        : kind === "motion"
          ? motionBody(shot, sceneName)
          : sceneBody(shot, sceneName, media, source.cast)
  }
  const { name, shots, extras = {} } = body

  const graph = serializeProduction(
    shots,
    undefined,
    extras.music,
    undefined,
    extras.folders,
    extras.storyboard,
    extras.cuts,
    undefined,
    undefined,
    // The production's FILM LOOK — on EVERY kind, not just `film` (D-B1). A
    // scene exported without it landed in another production and silently
    // inherited that production's camera/colour/style/period. Attached here
    // rather than in the four bodies so no kind can drift, and ungated by
    // media for the same reason the rest of the look is: ids are not media, and
    // "recipe only" exists to carry no BINDINGS. The serializer's own
    // omit-when-empty gate means a film-less production emits no key.
    source.film,
    // The role sheet, projected onto THESE shots — and only when the bundle
    // carries bindings at all (see `BundleSource.cast`). The projection runs on
    // the SHIPPED shots, not the source's, so a recipe-collapsed slice is asked
    // about the prose it actually kept.
    media === "linked" ? castForShots(source.cast, shots) : undefined,
    // The soundtrack PLAN, beside the storyboard brief it behaves like (R41).
    extras.musicPlan,
  )
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    // The platform's import schema caps `name` at 200 chars.
    name: name.slice(0, 200),
    nodes: graph.nodes,
    edges: graph.edges,
    settings: graph.settings,
    nodaroStudio: { version: 1, app: "studio.nodaro.ai", kind, media },
  }
}

/** `<safe display name>.<kind>.json` — the kind suffix doubles as user-facing
 *  labeling and as the import dialog's `accept` hint. */
export function bundleFileName(bundle: ProductionBundle): string {
  const base = safeFileName(bundle.name) || "production"
  return `${base}.${bundle.nodaroStudio.kind}.json`
}
