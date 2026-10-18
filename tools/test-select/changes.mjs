// tools/test-select/changes.mjs
// The changed files of a run, from either source: a PR (the GitHub files API —
// the PR checkout is a shallow merge commit with no base history) or a local
// branch (git diff against a base ref, plus the working tree).
import { matchesAny } from "./glob.mjs"

export function parseNameStatus(text) {
  return text.split("\n").filter(Boolean).map((line) => {
    const [code, path] = line.split("\t")
    const status = code[0] === "D" ? "D" : code[0] === "A" ? "A" : "M"
    return { status, path }
  })
}

// One item of GET /repos/{repo}/pulls/{pr}/files → changes.
export function parsePrFilesJson(items) {
  return items.flatMap(({ status, filename, previous_filename: previous }) => {
    if (status === "removed") return [{ status: "D", path: filename }]
    // A rename removes a module path other code may still import.
    if (status === "renamed") return [{ status: "D", path: previous }, { status: "A", path: filename }]
    if (status === "added" || status === "copied") return [{ status: "A", path: filename }]
    return [{ status: "M", path: filename }]
  })
}

const PER_PAGE = 100
// The API lists at most 3000 files (30 pages); one more page reads the empty
// tail. Past that the change count already forces a full run.
const MAX_PAGES = 31

// The files of a PR, through Node's own fetch — no `gh` binary needed on the
// runner. Any failure throws, and the engine turns a throw into a full run.
export async function fetchPrChanges({ repo, pr, token, fetchImpl = fetch }) {
  if (!repo || !pr) throw new Error("--pr needs --repo owner/name")
  if (!token) throw new Error("--pr needs GH_TOKEN or GITHUB_TOKEN")
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "nodaro-test-select",
  }
  const items = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/${repo}/pulls/${pr}/files?per_page=${PER_PAGE}&page=${page}`
    // A hung request must not hold the job until its timeout.
    const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`GitHub API ${url}: HTTP ${res.status} ${res.statusText ?? ""}`.trim())
    const body = await res.json()
    if (!Array.isArray(body)) throw new Error(`GitHub API ${url}: the response is not a list`)
    items.push(...body)
    if (body.length < PER_PAGE) break
  }
  return parsePrFilesJson(items)
}

export function mergeChanges(changes) {
  const byPath = new Map()
  for (const c of changes) {
    const prev = byPath.get(c.path)
    // A delete that comes after any other status wins: the file is gone now
    // (a committed edit then a working-tree delete must still read as a
    // removal, or the "removed module → full run" rule never fires locally).
    // Deleted then re-added stays a modification.
    const status = !prev || prev === c.status ? c.status : c.status === "D" ? "D" : "M"
    byPath.set(c.path, status)
  }
  return [...byPath].map(([path, status]) => ({ status, path }))
}

// A release bump (changesets) edits only `version` in a manifest and the
// matching workspace entries of the lockfile. That cannot change a test's
// outcome through dependencies or configuration, so it is no global trigger
// (decided 2026-10-15). A package's own manifest still counts as a change to
// that package — its build may inline the version. Anything unparseable, or
// any other difference, is not version-only.
//
// The same release also moves the ranges our own packages declare on each
// other (`"@nodaro/shared": "^3.33.0"` → `"^3.34.0"` in packages/cli). A range
// on a WORKSPACE MEMBER (a package that lives in this repo — `workspaces`,
// then each member's `name`) is version-only too (decided 2026-10-18), but
// only while npm still links the local member on both sides: the range is a
// plain semver range, and at each revision the member's own version satisfies
// it. A range the local version no longer satisfies installs the package from
// the registry instead, which is a real change, so it still triggers. A
// third-party range, an added, removed or moved dependency, and an `npm:`,
// `file:`, git or URL spec are never version-only.
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]
const WORKSPACE_RANGE = "<workspace range satisfied by the local member>"
const isLockfile = (path) => /(?:^|\/)package-lock\.json$/.test(path)
// workspace entries ("", "packages/shared", "frontend") — never an installed dependency
const isWorkspaceEntry = (key) => !key.startsWith("node_modules/") && !key.includes("/node_modules/")

// The members' own ranges, replaced by one sentinel when the local member
// satisfies them — never deleted, so an added or removed dependency, or one
// moved to another field, stays a difference.
function normalizeRanges(deps, members) {
  if (!deps || typeof deps !== "object" || !members?.size) return
  for (const [name, range] of Object.entries(deps)) {
    if (members.has(name) && typeof range === "string" && satisfies(members.get(name).version, range)) deps[name] = WORKSPACE_RANGE
  }
}
// Only the workspace's own files: the root manifest and lockfile, and the
// members' manifests. A standalone project elsewhere in the tree (the Apify
// actor under backend/src/providers/) is installed on its own: npm never links
// our packages into it, so its ranges are judged as written.
const isWorkspaceFile = (path, members) => path === "package.json" || path === "package-lock.json"
  || [...(members?.values() ?? [])].some((m) => m.manifest === path)

const withoutVersions = (path, json, members) => {
  const copy = structuredClone(json)
  delete copy.version
  for (const field of DEP_FIELDS) normalizeRanges(copy[field], members)
  if (isLockfile(path) && copy.packages && typeof copy.packages === "object") {
    for (const [key, entry] of Object.entries(copy.packages)) {
      if (!isWorkspaceEntry(key) || !entry || typeof entry !== "object") continue
      delete entry.version
      for (const field of DEP_FIELDS) normalizeRanges(entry[field], members)
    }
  }
  return copy
}
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// `members`: { before, after } — Map(name → version) of the workspace members
// at each revision (workspaceMembers). Without them only `version` fields are
// ignored, as before.
export function isVersionOnlyChange(path, before, after, members = {}) {
  if (!/(?:^|\/)package(?:-lock)?\.json$/.test(path) || before == null || after == null) return false
  let a, b
  try { a = JSON.parse(before); b = JSON.parse(after) } catch { return false }
  if (sameJson(a, b)) return false
  const inWorkspace = isWorkspaceFile(path, members.before) && isWorkspaceFile(path, members.after)
  return sameJson(withoutVersions(path, a, inWorkspace ? members.before : null), withoutVersions(path, b, inWorkspace ? members.after : null))
}

// The workspace members at one revision: Map(name → { version ("" when the
// member has none), manifest (its package.json path) }). `rootManifest` is the root package.json's text; `files`
// the revision's tracked paths; `read(path)` a member manifest's text (null
// when missing). Workspace patterns use glob.mjs (`packages/*`, or a plain
// path like `tools/typescript-native`). Anything unreadable → null, and no
// range counts as version-only.
export function workspaceMembers(rootManifest, files, read) {
  let root
  try { root = JSON.parse(rootManifest) } catch { return null }
  const patterns = Array.isArray(root?.workspaces) ? root.workspaces : root?.workspaces?.packages
  if (!Array.isArray(patterns) || patterns.some((p) => typeof p !== "string" || p.startsWith("!"))) return null
  const manifests = files.filter((f) => f !== "package.json" && f.endsWith("/package.json")
    && matchesAny(f.slice(0, -"/package.json".length), patterns.map((p) => p.replace(/\/+$/, ""))))
  const members = new Map()
  for (const file of manifests) {
    let pkg
    try { pkg = JSON.parse(read(file)) } catch { return null }
    if (typeof pkg?.name !== "string") continue
    members.set(pkg.name, { version: typeof pkg.version === "string" ? pkg.version : "", manifest: file })
  }
  return members
}

// Does `version` satisfy `range`, by npm's semver rules — for the plain forms
// only: `*` / empty, `x.y.z` / `=x.y.z`, `^x.y.z`, `~x.y.z`, `>=x.y.z`. Any
// other form (partial versions, hyphen or `||` ranges, prerelease versions or
// ranges, `npm:`, `file:`, git, URLs, paths) answers false — not version-only.
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/
export function satisfies(version, range) {
  const r = range.trim()
  if (r === "*" || r === "") return true
  const v = SEMVER.exec(version ?? "")
  const m = /^(\^|~|>=|=)?(\d+\.\d+\.\d+)$/.exec(r)
  if (!v || !m) return false
  const [vM, vm, vp] = v.slice(1).map(Number)
  const [rM, rm, rp] = SEMVER.exec(m[2]).slice(1).map(Number)
  const cmp = vM - rM || vm - rm || vp - rp
  switch (m[1]) {
    case "^": return cmp >= 0 && (rM > 0 ? vM === rM : rm > 0 ? vM === 0 && vm === rm : cmp === 0)
    case "~": return cmp >= 0 && vM === rM && vm === rm
    case ">=": return cmp >= 0
    default: return cmp === 0
  }
}
