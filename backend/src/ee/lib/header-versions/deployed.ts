import type { SiteEnvironment } from "./products.js"

/**
 * Which commit an environment runs, from the deployments the hosting platform
 * posts to the repository. Its environment names carry the project first
 * (`<project> / production`), so only the suffix names the environment.
 *
 * A deployment is judged by its whole status history, never its latest status
 * alone: the platform posts again on the same deployment when it redeploys or
 * retries it (a live one can fail later, a failed one can succeed), and with
 * several services it marks the previous deployment `inactive` before the new
 * one has settled.
 *
 * - live: the newest deployment that has ever succeeded and is not `inactive`;
 * - in the hand-over gap (none such): the newest that ever succeeded;
 * - `deploying`: a newer deployment, or the live one itself, is building;
 * - `lastFailed`: the newest deployment's latest status is a failure — the site
 *   still serves the live one.
 */

export interface DeploymentRecord {
  readonly id: number
  readonly environment: string
  readonly sha: string
  readonly createdAt: string
}

export type DeploymentState = "success" | "failure" | "error" | "inactive" | "in_progress" | "queued" | "pending" | "unknown"

/** One status of a deployment and when it was set (`null`: GitHub gave no time). */
export interface DeploymentStatus {
  readonly state: DeploymentState
  readonly at: string | null
}

const BUILDING: ReadonlySet<DeploymentState> = new Set(["in_progress", "queued", "pending"])
const FAILED: ReadonlySet<DeploymentState> = new Set(["failure", "error"])

/** How many deployments of one environment are looked at before giving up on finding the live one. */
export const DEPLOYMENTS_WALKED = 10

/** The environment a deployment's name ends with (`<project> / staging` → `staging`), or `null` for any other. */
export function environmentOf(name: string): SiteEnvironment | null {
  const last = name.split("/").at(-1)?.trim().toLowerCase()
  return last === "production" || last === "staging" ? last : null
}

export interface Deployed {
  readonly sha: string
  /** When it went live: its newest success status, else when it was created. */
  readonly deployedAt: string
  /** A newer deployment, or this one again, is being built or rolled out. */
  readonly deploying: boolean
  /** The newest deployment's latest status is a failure; the site still serves this one. */
  readonly lastFailed: boolean
}

/**
 * The live deployment of one environment, or `null` when none of the newest
 * {@link DEPLOYMENTS_WALKED} ever succeeded. `historyOf` answers a
 * deployment's statuses newest first; it is asked newest first and no further
 * than the live one.
 */
export async function liveDeployment(
  records: readonly DeploymentRecord[],
  environment: SiteEnvironment,
  historyOf: (record: DeploymentRecord) => Promise<readonly DeploymentStatus[]>,
): Promise<Deployed | null> {
  const newestFirst = records
    .filter((record) => environmentOf(record.environment) === environment)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id - a.id)
    .slice(0, DEPLOYMENTS_WALKED)
  let deploying = false
  let lastFailed = false
  let handOver: { readonly record: DeploymentRecord; readonly at: string | null } | null = null
  for (const [index, record] of newestFirst.entries()) {
    const history = await historyOf(record)
    const latest = history[0]?.state ?? "unknown"
    const success = history.find((status) => status.state === "success")
    if (index === 0 && FAILED.has(latest)) lastFailed = true
    if (success && latest !== "inactive") {
      return { sha: record.sha, deployedAt: success.at ?? record.createdAt, deploying: deploying || BUILDING.has(latest), lastFailed }
    }
    if (BUILDING.has(latest)) deploying = true
    if (success && !handOver) handOver = { record, at: success.at }
  }
  return handOver ? { sha: handOver.record.sha, deployedAt: handOver.at ?? handOver.record.createdAt, deploying, lastFailed } : null
}
