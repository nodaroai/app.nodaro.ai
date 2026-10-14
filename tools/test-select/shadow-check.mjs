// tools/test-select/shadow-check.mjs
// Shadow mode (PRs into dev until TEST_SELECT_ENFORCE=true, decided
// 2026-10-13): the full suite ran; did any test file that failed fall OUTSIDE
// what the selector would have run? Each such file is a "miss" — the one
// thing that would make enforcing the selector unsafe — so a clean shadow
// record is the proof the selector is complete.
// CI:  node shadow-check.mjs <vitest-json-report> <list-file> <wouldRun> <out-json> <summary-file> <project> [<vitest-exit-code> [<unhandled 1|0>]]
//      (cwd = the project directory; never throws, never sets a failing exit code;
//      the exit code may also come from env VITEST_RC)
// A run that failed with no failing test file (an unhandled error, a crash
// before the report) cannot be checked against the selection: it is recorded
// as `unattributed` — a possible miss, which a clean shadow record excludes.
// So is a run whose log shows a Vitest unhandled error: the JSON report does
// not record those, so failing files inside the selection cannot explain it.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { failedFiles } from "./failed-files.mjs"

// failed/selected are project-relative test paths.
export function compareShadow({ failed, selected, wouldRun }) {
  if (!["affected", "none", "full"].includes(wouldRun)) throw new Error(`unknown wouldRun '${wouldRun}'`)
  const chosen = new Set(selected)
  const misses = wouldRun === "full" ? [] : wouldRun === "none" ? [...failed] : failed.filter((f) => !chosen.has(f))
  return { misses, checked: failed.length }
}

function readList(file) {
  try {
    return readFileSync(file, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
  } catch {
    return [] // no list: the selector would have run none, or full
  }
}

const UNATTRIBUTED = "the run failed without a failing test file (unhandled error or crash) — not attributable to a file; counted as a possible miss"

const UNHANDLED = "Vitest reported an unhandled error — not attributable to a file; counted as a possible miss"

export function runShadowCheck([reportPath, listPath, wouldRun, outPath, summaryPath, project, rcArg, unhandledArg], cwd = process.cwd()) {
  const selected = readList(listPath)
  const rcRaw = rcArg ?? process.env.VITEST_RC
  const runFailed = rcRaw !== undefined && rcRaw !== "" && Number(rcRaw) !== 0
  const unhandled = unhandledArg === "1"
  let out
  let md
  try {
    const failed = failedFiles(JSON.parse(readFileSync(reportPath, "utf8")), cwd)
    const { misses } = compareShadow({ failed, selected, wouldRun })
    out = { project, wouldRun, selected: selected.length, failed, misses }
    const ran = wouldRun === "full" ? "the full suite" : `${selected.length} file${selected.length === 1 ? "" : "s"}`
    md = ["#### Shadow check", "", `The selector would have run ${ran}; ${failed.length} failed; ${misses.length} outside the selection.`, ""]
    if (misses.length) md.push("**Selector misses** — failed, and the selector would have skipped them:", "", ...misses.map((f) => `- \`${f}\``), "")
    for (const f of misses) process.stdout.write(`::warning title=Selector miss (${project})::${f} failed but the selector would have skipped it\n`)
    if (runFailed && failed.length === 0) out.unattributed = true
  } catch (err) {
    const error = String(err?.message ?? err).split("\n")[0]
    out = { project, wouldRun, selected: selected.length, failed: [], misses: [], error }
    md = ["#### Shadow check", "", `The shadow check could not run (${error}); the full suite's own result stands.`, ""]
    if (runFailed) out.unattributed = true
  }
  if (unhandled) {
    out.unattributed = true
    md.push(`**Unattributed failure:** ${UNHANDLED}.`, "")
    process.stdout.write(`::warning title=Unattributed failure (${project})::${UNHANDLED}\n`)
  } else if (out.unattributed) {
    md.push(`**Unattributed failure:** ${UNATTRIBUTED}.`, "")
    process.stdout.write(`::warning title=Unattributed failure (${project})::${UNATTRIBUTED}\n`)
  }
  try { writeFileSync(outPath, `${JSON.stringify(out, null, 1)}\n`) } catch { /* reporting only */ }
  try { appendFileSync(summaryPath, `${md.join("\n")}\n`) } catch { /* reporting only */ }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runShadowCheck(process.argv.slice(2))
  } catch (err) {
    process.stdout.write(`::warning::shadow check failed: ${String(err?.message ?? err).split("\n")[0]}\n`)
  }
}
