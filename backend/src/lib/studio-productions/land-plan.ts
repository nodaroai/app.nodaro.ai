import {
  castFromChips,
  describedRolesFrom,
  enrollCastMember,
  importProduction,
  mergeCast,
  parseProduction,
  serializeProduction,
  type Cast,
  type ImportResult,
  type MentionCandidate,
  type SerializedProduction,
  type Shot,
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
): SerializedProduction {
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
  return serializeProduction(
    [...parsed.shots, ...landed.shots],
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
}
