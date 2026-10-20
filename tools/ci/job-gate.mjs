// tools/ci/job-gate.mjs
// The Diff Gate's job step: one output per gated job (job-inputs.json) —
// `true` when the job must run, `false` when this PR cannot affect it — and a
// line per job in the step summary. The step is continue-on-error, and every
// gated job runs unless its output is exactly `false`, so a gate that fails or
// writes nothing runs everything.
import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"
import { gateJobs, loadJobInputs } from "./job-inputs.mjs"

const env = process.env
// Every changed path, and a renamed file's previous path too. The files API
// lists at most 3000 entries; gateJobs runs everything near that cap.
function changedFiles() {
  const out = execFileSync("gh", ["api", `repos/${env.REPO}/pulls/${env.PR_NUMBER}/files`, "--paginate",
    "--jq", ".[] | .filename, (.previous_filename // empty)"], { encoding: "utf8", maxBuffer: 64 << 20 })
  return [...new Set(out.split("\n").filter(Boolean))]
}

const jobs = loadJobInputs()
let files = null
if (env.EVENT_NAME === "pull_request") {
  try {
    files = changedFiles()
  } catch (err) {
    console.log(`::warning::could not list the PR's files (${String(err?.message ?? err).split("\n")[0]}) — every gated job runs`)
  }
}
const { outputs, reasons } = gateJobs({ event: env.EVENT_NAME, baseRef: env.BASE_REF, files, jobs })
const lines = Object.entries(outputs).map(([k, v]) => `${k}=${v}`)
if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`)
for (const [k, v] of Object.entries(outputs)) console.log(`${k}: ${v ? "runs" : "skipped"} — ${reasons[k]}`)
if (env.GITHUB_STEP_SUMMARY) {
  const rows = Object.entries(outputs).map(([k, v]) => `| ${jobs[k].job} | ${v ? "runs" : "skipped"} | ${reasons[k].replace(/\|/g, "\\|")} |`)
  appendFileSync(env.GITHUB_STEP_SUMMARY, `### Gated jobs (tools/ci/job-inputs.json)\n\n| Job | | Why |\n|---|---|---|\n${rows.join("\n")}\n`)
}
