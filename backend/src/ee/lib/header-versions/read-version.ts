/**
 * Reading which header version a commit or a site carries, from the text of
 * the file that says so. Pure: no fetching here. The package's name is an
 * argument: it is read from the header's own repository (`packageNameOf`).
 */

/** A version as a lockfile, a pin or a tag spells it: x.y.z with an optional pre-release. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/** Whether `value` is one exact version (never a range or a dist-tag). */
export function isExactVersion(value: unknown): value is string {
  return typeof value === "string" && EXACT_VERSION.test(value)
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null

/** The `name` a `package.json` gives its package, or `null`. */
export function packageNameOf(text: string): string | null {
  const name = record(parseJson(text))?.name
  return typeof name === "string" && name.trim() !== "" ? name.trim() : null
}

/**
 * The installed version of `packageName` in a `package-lock.json`: the
 * `packages` map of lockfile v2/v3, else the `dependencies` map of v1. `null`
 * when the lockfile does not install it.
 */
export function versionFromLockfile(text: string, packageName: string): string | null {
  const lock = record(parseJson(text))
  if (!lock) return null
  const fromPackages = record(record(lock.packages)?.[`node_modules/${packageName}`])?.version
  if (isExactVersion(fromPackages)) return fromPackages
  const fromDependencies = record(record(lock.dependencies)?.[packageName])?.version
  return isExactVersion(fromDependencies) ? fromDependencies : null
}

/** What a `package.json` declares for `packageName` (a range is possible), or `null`. */
export function declaredInPackageJson(text: string, packageName: string): string | null {
  const pkg = record(parseJson(text))
  if (!pkg) return null
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const spec = record(pkg[field])?.[packageName]
    if (typeof spec === "string" && spec.trim() !== "") return spec.trim()
  }
  return null
}

/** The `PIN="x.y.z"` line of `install-package.sh`, or `null`. */
export function versionFromPin(text: string): string | null {
  const pin = /^PIN="([^"\n]*)"\s*$/m.exec(text)?.[1]
  return isExactVersion(pin) ? pin : null
}

export interface SiteFile {
  /** `null`: the build has no header package. */
  readonly version: string | null
  /** Whether the site shows the header (the package can be installed with the header off). */
  readonly header: boolean
}

/**
 * The `shell-version.json` a site serves, or `null` when the answer is not
 * that file — a site that predates it answers its HTML shell with a 200.
 */
export function parseSiteFile(text: string): SiteFile | null {
  const file = record(parseJson(text))
  if (!file || typeof file.header !== "boolean") return null
  if (file.version === null) return { version: null, header: file.header }
  return isExactVersion(file.version) ? { version: file.version, header: file.header } : null
}

/**
 * Semver order: negative when `a` is older than `b`, positive when newer. A
 * pre-release sorts before its release; pre-release tags compare as text (only
 * releases are ranked today, see {@link latestRelease}).
 */
export function compareVersions(a: string, b: string): number {
  const [coreA = "", preA] = a.split("-", 2)
  const [coreB = "", preB] = b.split("-", 2)
  const partsA = coreA.split(".").map(Number)
  const partsB = coreB.split(".").map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0)
    if (diff !== 0) return diff
  }
  if (preA === preB) return 0
  if (preA === undefined) return 1
  if (preB === undefined) return -1
  return preA < preB ? -1 : 1
}

/** The highest release among tag names (`v0.13.0`); pre-releases and other tags are ignored. */
export function latestRelease(tags: readonly string[]): string | null {
  const releases = tags
    .map((tag) => (tag.startsWith("v") ? tag.slice(1) : tag))
    .filter((version) => isExactVersion(version) && !version.includes("-"))
  return releases.reduce<string | null>((best, version) => (best === null || compareVersions(version, best) > 0 ? version : best), null)
}
