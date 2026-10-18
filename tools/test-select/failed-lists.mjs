// tools/test-select/failed-lists.mjs
// The three per-project lists a failed post-merge shard uploads, read back for
// the attribution comment (attribution.mjs):
//   failed-<project>.txt          failed again when re-run alone (or not re-run)
//   failed-<project>.txt.flaky    passed when re-run alone — labelled, never forgiven
//   failed-<project>.txt.unknown  the re-run crashed without a report
//
// Found at ANY depth under the download directory, because
// actions/download-artifact's layout depends on how many artifacts match: two
// or more land in one subdirectory each (failed-frontend-1/failed-frontend.txt…),
// but a single one — the usual case, one failing shard — is extracted straight
// into the directory. A reader that assumed the subdirectories found nothing
// for every one-shard failure, and the comment said "not captured".
// (`merge-multiple` is no way out: every shard writes the same file names.)
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const SUFFIX = { failed: "", flaky: ".flaky", unknown: ".unknown" }

function filesUnder(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return [] // no artifact was downloaded
  }
  return entries.flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? filesUnder(p) : e.isFile() ? [p] : []
  })
}

/** `{ failed, flaky, unknown }`, each `{ [project]: string[] }` — the shape buildAttributionComment takes. */
export function readFailedLists(dir, projects = ["frontend", "backend"]) {
  const files = filesUnder(dir).sort()
  const lines = (name) => files
    .filter((f) => path.basename(f) === name)
    .flatMap((f) => readFileSync(f, "utf8").split("\n").map((l) => l.trim()).filter(Boolean))
  return Object.fromEntries(Object.entries(SUFFIX).map(([kind, suffix]) =>
    [kind, Object.fromEntries(projects.map((p) => [p, lines(`failed-${p}.txt${suffix}`)]))]))
}
