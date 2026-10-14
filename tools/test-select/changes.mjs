// tools/test-select/changes.mjs
// The changed files of a run, from either source: a PR (the GitHub files API —
// the PR checkout is a shallow merge commit with no base history) or a local
// branch (git diff against a base ref, plus the working tree).

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
