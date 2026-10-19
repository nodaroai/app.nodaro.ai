// The pieces `nodaro edit`'s commands share: its option shapes, reading a
// JSON file, and refusing a plan tier the planner does not have. Its own
// module so edit.ts and edit-use-case.ts (the use-case node commands) both
// read them.
import { readFileSync } from "node:fs"
import { EDIT_PLAN_TIERS } from "@nodaro/shared/edl"
import { warn, type OutputOpts } from "../output.js"

export interface GlobalOpts extends OutputOpts {
  profile?: string
}

export interface WatchOpts {
  watch?: boolean
  pollInterval?: number
}

/**
 * Read + JSON-parse a file into an arbitrary value (transcript / EDL / silence /
 * a full sources array). Unlike `loadParamsFile` this accepts ANY top-level JSON:
 * an EDL / transcript / silence result is an object (silence is the
 * silence-detect job's `output_data.json` = `{ version, ranges, durationMs }`),
 * while `--sources-file` is a top-level array (guarded at its call site).
 */
export function readJsonFile(path: string): unknown {
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch (err) {
    throw new Error(`cannot read ${path}: ${(err as Error).message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new Error(`${path} is not valid JSON: ${(err as Error).message}`)
  }
}

/** Exit 1 on a --plan-tier that is not one of the planner's tiers (before any request). */
export function refuseUnknownPlanTier(planTier: string | undefined): void {
  if (planTier !== undefined && !(EDIT_PLAN_TIERS as readonly string[]).includes(planTier)) {
    warn(`--plan-tier must be ${EDIT_PLAN_TIERS.join(", ")} (got "${planTier}")`)
    process.exit(1)
  }
}
