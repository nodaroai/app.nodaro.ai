import { DEPLOYMENTS_WALKED, environmentOf, type DeploymentRecord } from "./deployed.js"
import type { GitHubReader } from "./github.js"
import type { SiteEnvironment } from "./products.js"

/** Scanned when a repository's environment names are not known yet. */
const SCAN_PAGE_SIZE = 100
const SCAN_PAGES = 3

type EnvironmentNames = Partial<Record<SiteEnvironment, string>>

/** A repository's newest deployments, both environments together. */
export interface DeploymentSource {
  of(repo: string): Promise<DeploymentRecord[]>
}

/** The full names (`<project> / production`) these records add to what was known — a new object. */
function withNames(known: EnvironmentNames | undefined, records: readonly DeploymentRecord[]): EnvironmentNames {
  return records.reduce<EnvironmentNames>((names, record) => {
    const environment = environmentOf(record.environment)
    return environment && !names[environment] ? { ...names, [environment]: record.environment } : names
  }, known ?? {})
}

/**
 * One small query per environment once its full name is known; a scan of the
 * newest deployments before that — and again when a known name answers
 * nothing (the project was renamed).
 */
export function createDeploymentSource(github: GitHubReader): DeploymentSource {
  const names = new Map<string, EnvironmentNames>()

  async function scan(repo: string): Promise<DeploymentRecord[]> {
    let found: readonly DeploymentRecord[] = []
    for (let page = 1; page <= SCAN_PAGES; page++) {
      const rows = await github.deployments(repo, { perPage: SCAN_PAGE_SIZE, page })
      found = [...found, ...rows]
      const seen = withNames(names.get(repo), rows)
      names.set(repo, seen)
      if (rows.length < SCAN_PAGE_SIZE || (seen.production && seen.staging)) break
    }
    return [...found]
  }

  return {
    async of(repo) {
      const known = names.get(repo)
      if (known?.production && known.staging) {
        const perEnvironment = await Promise.all(
          [known.production, known.staging].map((environment) => github.deployments(repo, { environment, perPage: DEPLOYMENTS_WALKED })),
        )
        if (perEnvironment.every((rows) => rows.length > 0)) return perEnvironment.flat()
        names.delete(repo)
      }
      return scan(repo)
    },
  }
}
