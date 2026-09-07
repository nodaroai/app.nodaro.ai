import {
  castFromChips,
  describedRolesFrom,
  enrollCastMember,
  importProduction,
  mergeCast,
  parseProduction,
  serializeProduction,
  type Cast,
  type CastEnrollment,
  type ImportResult,
  type MentionCandidate,
  type SerializedProduction,
  type Shot,
  type StudioSettingsV1,
  type StudioSettingsV3,
  type ViewableWorkflow,
} from "@nodaro/studio-production"

import { durationsFor } from "./durations.js"

/**
 * A plan, landed as a production.
 *
 * This is the studio app's own landing path (`useLandProduction`) running on
 * the server: import the document against the caller's library, mint the cast
 * from the chips the import bound, enroll the names that bound to nothing as
 * DESCRIBED roles, and serialize the result into a workflow graph.
 *
 * It is the SAME code — `importProduction`, `castFromChips`,
 * `describedRolesFrom`, `mergeCast` and `serializeProduction` all come from
 * `@nodaro/studio-production` — which is the only reason a production created
 * here and one created in the app are the same kind of thing rather than two
 * things that resemble each other.
 */

export interface LandPlanOptions {
  readonly candidates: ReadonlyArray<MentionCandidate>
  /** Used when the document names no title of its own. */
  readonly fallbackName?: string
}

/** What an import produced, before anything decides where it is stored. */
export interface LandedPlanOk {
  readonly ok: true
  readonly name: string
  readonly shots: ReadonlyArray<Shot>
  readonly cast: Cast
  readonly result: Extract<ImportResult, { ok: true }>
}

export type LandedPlan =
  | LandedPlanOk
  | { readonly ok: false; readonly error: string; readonly path?: string }

/** The name a production with no title of its own gets. */
export const DEFAULT_PRODUCTION_NAME = "Untitled production"

/**
 * Import a plan and mint its cast.
 *
 * `existingCast` scopes the mint: a NEW production starts with no cast at all,
 * so every bound chip is arriving for the first time; an APPEND runs against
 * what the production already has, so a name it already knows keeps its one
 * role instead of minting a second beside it.
 */
export function landPlan(
  plan: unknown,
  opts: LandPlanOptions,
  existingCast: Cast = {},
): LandedPlan {
  const result = importProduction(plan, {
    candidates: opts.candidates,
    durationsFor,
  })
  if (!result.ok) {
    return { ok: false, error: result.error, ...(result.path ? { path: result.path } : {}) }
  }

  const minted = castFromChips(existingCast, result.shots)
  // Names the document declared that bound to NOTHING enroll as described
  // roles — a name with the plan's own words and no face. AFTER the chip mint,
  // so a name the chips already bound stays that role.
  let cast: Cast = minted.cast
  for (const member of describedRolesFrom(result.summary.unresolvedCast, cast)) {
    cast = enrollCastMember(cast, member)?.cast ?? cast
  }

  return {
    ok: true,
    name: result.title?.trim() || opts.fallbackName?.trim() || DEFAULT_PRODUCTION_NAME,
    shots: minted.shots,
    cast,
    result,
  }
}

/** A landed plan as a BRAND-NEW production's graph. */
export function serializeCreate(landed: LandedPlanOk): SerializedProduction {
  return serializeProduction(
    landed.shots,
    landed.shots[0]?.id,
    undefined,
    undefined,
    landed.result.folders,
    // The root brief lands in the storyboard WITHOUT turning the panel on: it
    // is the production's logline, not a request to open a tab.
    landed.result.brief ? { brief: landed.result.brief } : undefined,
    undefined,
    undefined,
    undefined,
    landed.result.film,
    landed.cast,
    landed.result.music,
  )
}

/**
 * Every key the index has EVER owned inside `settings.studio` — v3's, plus the
 * legacy v1 shape's, which a v1 row still carries when it is appended to.
 *
 * An append is a read-modify-write of ONE row's `settings.studio`, and the
 * serializer writes that object whole. So anything the row was carrying that
 * this build has never heard of — a newer studio's composer draft, a soundtrack
 * draft, the hidden favorites row's own payload and its `hidden` flag — is
 * destroyed by the write unless it is carried across: spec §11, "`settings.studio`
 * unknown to the serializer is never erased".
 *
 * It is a DENY list over the serializer's own keys rather than a diff against
 * what it emitted, because the serializer deliberately OMITS things: a pruned
 * storyboard, an empty cast, a `shared` that is false. Preserving by difference
 * would put every one of those back and undo the prune on every single append.
 *
 * v1's `perShot` is on the list for the same reason the app's own v1→v3 read
 * drops it: it maps node ids the rewrite is about to replace, so preserving it
 * would keep a dead job map alive in the v3 blob for good.
 */
export const SERIALIZER_OWNED_STUDIO_KEYS = [
  "version",
  "shots",
  "selectedShotId",
  "shotOrder",
  "music",
  "musicPlan",
  "shared",
  "archived",
  "folders",
  "storyboard",
  "cuts",
  "freecutDraftUrl",
  "trash",
  "film",
  "cast",
  "perShot",
] as const satisfies ReadonlyArray<keyof StudioSettingsV3 | keyof StudioSettingsV1>

/**
 * The compile-time half of the list above: a field added to `StudioSettingsV3`
 * and left off it fails `tsc` HERE rather than surviving as a stale value that
 * every append quietly restores from the old blob. (`AssertNever` is written
 * with the constraint rather than a conditional so an empty union does not
 * distribute away to a passing check.)
 */
type AssertNever<T extends never> = T
export type EverySettingsKeyIsOwned = AssertNever<
  Exclude<
    keyof StudioSettingsV3 | keyof StudioSettingsV1,
    (typeof SERIALIZER_OWNED_STUDIO_KEYS)[number]
  >
>

const OWNED = new Set<string>(SERIALIZER_OWNED_STUDIO_KEYS)

/** The row's own `settings.studio` keys this serializer does not write. */
function unownedStudioKeys(current: ViewableWorkflow): Record<string, unknown> {
  const studio = (current.settings as { studio?: unknown } | undefined)?.studio
  if (typeof studio !== "object" || studio === null || Array.isArray(studio)) return {}
  const carried: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(studio)) {
    if (!OWNED.has(key)) carried[key] = value
  }
  return carried
}

/**
 * An append's graph PLUS the receipt only the merge can give.
 *
 * `enrolled` is the roles the append actually added — the append's own
 * `castEnrolled` figure. The size of the resulting cast is a different number:
 * appending one scene to a production with ten roles enrolls one, not eleven.
 */
export interface AppendedProduction extends SerializedProduction {
  readonly enrolled: ReadonlyArray<CastEnrollment>
}

/**
 * A landed plan APPENDED to a production that already exists.
 *
 * Appending adds scenes; it does not rename, re-brief or re-look a production —
 * the same rule the studio app's own "Add scenes" follows. So the incoming
 * title, brief and film look are deliberately dropped, the existing folders,
 * cuts, bin, music and flags are carried through untouched, and only two things
 * change: the shots grow at the end and the cast gains whoever is new.
 */
export function serializeAppend(
  current: ViewableWorkflow,
  landed: LandedPlanOk,
): AppendedProduction {
  const parsed = parseProduction(current)
  // `mergeCast` takes the incoming shots as well as the incoming cast: a role
  // is only real if some shot's prose or chips actually refer to it, so the
  // merge re-keys against the shots rather than trusting the map alone.
  const merged = mergeCast(parsed.cast ?? {}, landed.cast, landed.shots)
  const folders = [
    ...(parsed.folders ?? []),
    // A folder the incoming plan names is new to this production by
    // construction — the importer mints ids per import.
    ...landed.result.folders,
  ]
  const serialized = serializeProduction(
    // `merged.shots`, NOT `landed.shots` — the same choice `pasteShots` makes
    // in the studio app's own store. A collision (a different actor arriving
    // under a name this production already gave to someone else) enrolls the
    // newcomer as `kira-2` AND rewrites the arriving prose and chips to say so;
    // persisting the pre-merge shots would enroll the suffix and leave every
    // arriving scene still saying `@kira`, which points the newcomer's scenes
    // at the keeper's role — the exact ambiguity D6a exists to kill.
    [...parsed.shots, ...merged.shots],
    parsed.selectedShotId,
    parsed.music,
    parsed.shared,
    folders,
    parsed.storyboard,
    parsed.cuts,
    parsed.trash,
    parsed.freecutDraftUrl,
    parsed.film,
    merged.cast,
    parsed.musicPlan,
    parsed.archived,
  )
  return {
    nodes: serialized.nodes,
    edges: serialized.edges,
    settings: {
      // The serializer's own keys WIN (it is the fresh write); everything else
      // the row was carrying rides through untouched.
      studio: { ...unownedStudioKeys(current), ...serialized.settings.studio },
    },
    enrolled: merged.enrolled,
  }
}
