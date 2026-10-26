// tools/test-select/bisect-dev.mjs
// Names the merge that broke a batched post-merge run on dev. One dev run can
// cover several merges (ci.yml `concurrency`: only the newest pending run is
// kept), so when it fails the attribution comment can only say "one of these".
// This re-runs ONLY the files that failed again when re-run alone, at merges
// inside the batch, by binary search: the last finished run (before the
// batch) passed and the newest merge fails, so the first failing merge is the
// one that broke it. Run by .github/workflows/dev-failure-bisect.yml, which
// copies tools/test-select/ outside the checkout first: the probes move the
// tree with `git checkout`.
//
//   node bisect-dev.mjs plan     BATCH, FAILED_DIR    → GITHUB_OUTPUT go/files/commits
//   node bisect-dev.mjs run      FILES, COMMITS, REPO_ROOT, RESULT
//   node bisect-dev.mjs comment  BATCH, RESULT, FILES, RUN_URL, BISECT_URL, OUT → OUT + OUT.pr
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { prOf } from "./dev-batch.mjs"
import { readFailedLists } from "./failed-lists.mjs"

/**
 * The first commit whose probe fails, knowing the one before `commits[0]`
 * passed and the last commit fails.
 * @param {string[]} commits  oldest first; the last one is known to fail
 * @param {(sha: string) => "pass" | "fail"} probe
 * @returns {{ culprit: string, probes: {sha: string, result: string}[] }}
 */
export function bisect(commits, probe) {
  if (commits.length === 0) throw new Error("bisect: no commits")
  const probes = []
  let lo = 0
  let hi = commits.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const result = probe(commits[mid])
    probes.push({ sha: commits[mid], result })
    if (result === "fail") hi = mid
    else lo = mid + 1
  }
  return { culprit: commits[lo], probes }
}

/**
 * Whether to bisect, and what. Only a batch of two or more merges whose
 * baseline (the last finished dev run) was green, and only files that failed
 * again when re-run alone: a flaky file would send the search anywhere.
 * @param {{lastState: string, merges: {sha: string}[]}} batch
 * @param {{[project: string]: string[]}} failed
 */
export function planBisect(batch, failed) {
  const files = Object.fromEntries(Object.entries(failed).filter(([, l]) => l.length > 0))
  const why =
    batch.merges.length < 2 ? "the run covered one merge — the attribution comment names it"
    : batch.lastState !== "green" ? "the last finished dev run was not green — the failure may be older than this batch"
    : Object.keys(files).length === 0 ? "no file failed again when re-run alone (flaky, unknown, or a job without file lists)"
    : null
  return { go: why === null, why, files, commits: batch.merges.map((m) => m.sha) }
}

/**
 * The files of one project that exist at the checked-out commit. A failing test
 * file that does not exist yet cannot fail there, so the merge that added it
 * is where the search lands.
 */
export function presentFiles(root, project, files) {
  return files.filter((f) => existsSync(path.join(root, project, f)))
}

function sh(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: "inherit", ...opts })
}

/** Check out `sha`, install and build, then run the failing files there. */
export function probeAt(root, files, sha) {
  sh("git", ["checkout", "-f", "--quiet", sha], { cwd: root })
  sh("npm", ["ci", "--no-audit", "--no-fund"], { cwd: root })
  sh("npm", ["run", "build:packages"], { cwd: root })
  for (const [project, list] of Object.entries(files)) {
    const present = presentFiles(root, project, list)
    if (present.length === 0) continue
    try {
      sh("npx", ["vitest", "run", ...present], { cwd: path.join(root, project) })
    } catch {
      return "fail"
    }
  }
  return "pass"
}

/** The comment for the PR whose merge broke the files. */
export function bisectComment({ culprit, probes, merges, files, runUrl, bisectUrl }) {
  const short = (s) => s.slice(0, 7)
  return [
    `**Bisect: this merge (\`${short(culprit)}\`) is where these files start failing on \`dev\`.** [Failed run](${runUrl}) · [bisect](${bisectUrl})`,
    "",
    "Failing files (each failed again when re-run alone):",
    ...Object.entries(files).flatMap(([p, l]) => l.map((f) => `- ${p}: \`${f}\``)),
    "",
    `The run covered ${merges.length} merges. The last finished dev run before them passed; at each merge probed:`,
    ...probes.map((x) => `- \`${short(x.sha)}\`: ${x.result}`),
    `- \`${short(merges.at(-1).sha)}\`: fail (the run)`,
  ].join("\n")
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"))

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env
  const command = process.argv[2]
  if (command === "plan") {
    const plan = planBisect(readJson(env.BATCH), readFailedLists(env.FAILED_DIR).failed)
    appendFileSync(env.GITHUB_OUTPUT, `go=${plan.go}\nfiles=${JSON.stringify(plan.files)}\ncommits=${JSON.stringify(plan.commits)}\n`)
    appendFileSync(env.GITHUB_STEP_SUMMARY, plan.go ? `### Bisecting ${plan.commits.length} merges\n\n` : `### Bisect skipped\n\n${plan.why}\n`)
  } else if (command === "run") {
    const files = JSON.parse(env.FILES)
    const result = bisect(JSON.parse(env.COMMITS), (sha) => {
      console.log(`::group::probe ${sha}`)
      try {
        return probeAt(env.REPO_ROOT, files, sha)
      } finally {
        console.log("::endgroup::")
      }
    })
    // To a file, not stdout: the probes' own output shares stdout.
    writeFileSync(env.RESULT, `${JSON.stringify(result)}\n`)
  } else if (command === "comment") {
    const gh = (...a) => execFileSync("gh", ["api", ...a], { encoding: "utf8" }).trim()
    const { culprit, probes } = readJson(env.RESULT)
    const { merges } = readJson(env.BATCH)
    writeFileSync(env.OUT, bisectComment({ culprit, probes, merges, files: JSON.parse(env.FILES), runUrl: env.RUN_URL, bisectUrl: env.BISECT_URL }))
    writeFileSync(`${env.OUT}.pr`, String(prOf(gh, env.GITHUB_REPOSITORY, culprit) ?? ""))
  } else {
    console.error("usage: bisect-dev.mjs plan|run|comment")
    process.exit(2)
  }
}
