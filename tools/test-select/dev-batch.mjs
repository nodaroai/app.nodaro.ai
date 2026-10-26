// tools/test-select/dev-batch.mjs
// Which merges one post-merge dev run covers. The dev group of CI keeps one
// run going and only the newest pending one (ci.yml `concurrency`), so a run
// tests every merge since the last dev commit whose run FINISHED — not just
// the commit before it, whose run may have been dropped.
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { devRunState } from "./ci-mode.mjs"

/** Walk no further back than this; a longer gap is reported as unknown. */
export const MAX_BATCH = 30

/**
 * @param {{sha: string, repo: string, firstParents: string[], gh: Function}} args
 *   firstParents: `git rev-list --first-parent` of `sha`, newest first, `sha` itself first.
 * @returns {{last: string|null, lastState: "green"|"failed"|"none", batch: string[]}}
 *   batch: the commits this run covers, oldest first, ending with `sha`.
 */
export function findBatch({ sha, repo, firstParents, gh }) {
  const batch = [sha]
  for (const candidate of firstParents.slice(1, MAX_BATCH + 1)) {
    const state = devRunState(gh, repo, candidate)
    if (state === "green" || state === "failed") return { last: candidate, lastState: state, batch: batch.reverse() }
    batch.push(candidate)
  }
  return { last: null, lastState: "none", batch: batch.reverse() }
}

/** The PR whose merge commit IS this commit (commits/{sha}/pulls also lists open PRs containing it). */
export function prOf(gh, repo, sha) {
  const n = gh(`repos/${repo}/commits/${sha}/pulls`, "--jq", `[.[] | select(.merge_commit_sha == "${sha}")][0].number // empty`)
  return n ? Number(n) : null
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { GITHUB_SHA: sha, GITHUB_REPOSITORY: repo } = process.env
  const gh = (...args) => execFileSync("gh", ["api", ...args], { encoding: "utf8" }).trim()
  const firstParents = execFileSync("git", ["rev-list", "--first-parent", `--max-count=${MAX_BATCH + 1}`, sha], { encoding: "utf8" }).split("\n").filter(Boolean)
  const { last, lastState, batch } = findBatch({ sha, repo, firstParents, gh })
  const merges = batch.map((s) => ({ sha: s, pr: prOf(gh, repo, s) }))
  process.stdout.write(JSON.stringify({ last, lastState, merges }) + "\n")
}
