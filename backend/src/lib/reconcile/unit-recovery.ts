// @registry-lookup answers the recovery of the one job type it is given (unitRecoverOf)
/**
 * The one door to the node units' recoveries (tools/units/README.md, "A
 * worker unit's recovery"), a reviewed composer
 * (tools/units/registry-composers.json): `UNIT_RECOVERS`, each own-writer worker unit's
 * `recover.ts` under its type — the job type its rows carry once the video
 * worker picked them up (the BullMQ job name, which is the unit's type).
 *
 * A unit with one is still NOT_GENERIC_RECOVERABLE (lib/job-finalize.ts): its
 * worker writes its own completion, so no generic media finalize may take its
 * row. The KIE reconcile (lib/reconcile/kie.ts) asks this door before that
 * denial and, for a type that answers, delivers the task's result through the
 * unit's own delivery instead of bumping the row toward its exhaustion.
 *
 * A pure lookup: nothing here reads the collection while it loads.
 */
import { UNIT_RECOVERS } from "../../nodes/_generated/recovers.js"
import type { UnitRecover } from "../../nodes/kit.js"

/** The recovery of the unit whose job type this is; undefined for any other type (every legacy one). */
export function unitRecoverOf(jobType: string | null | undefined): UnitRecover | undefined {
  return typeof jobType === "string" && Object.hasOwn(UNIT_RECOVERS, jobType) ? UNIT_RECOVERS[jobType] : undefined
}
