// tools/test-select/enforced-audit.mjs
// The selector's audit once it enforces (TEST_SELECT_ENFORCE=true, decided
// 2026-10-18). A PR into dev then runs only its selection, so it leaves no
// shadow check: a test file the selection skipped can only fail after the
// merge, in the full suite that the merge commit's own CI run on dev runs
// (post-merge mode, one run per commit). For each PR whose final run was
// enforced and that merged, this module holds that dev run's failed-file
// lists (failed-<project>-<shard>: .txt / .flaky / .unknown) to the selection
// the PR was tested with. It holds only pure functions;
// shadow-report.mjs collects the data with `gh` and prints the report.
//
// How an enforced run is recognised: ci.yml uploads selection-<project>-<shard>
// only when the Select step's output is `selection=affected`. Only an enforced
// run writes that (a shadow run writes `selection=shadow`). The JSON inside
// says `mode: "affected"`, but that field alone is the selector's own choice:
// a shadow run's selection-<project>.json, inside its shadow-* artifact, says
// it too. An enforced run whose selector chose `none` or `full` uploads no
// selection at all. Its mode is read from the Select line that cli.mjs prints
// in the test job's log (selectLineFromLog).
import { compareRegistry } from "./shadow-check.mjs"

export const PROJECTS = ["frontend", "backend"]
export const JOBS = { frontend: "Frontend Tests", backend: "Backend Tests" }

// The selection JSON names files repo-relative ("frontend/src/…"). The
// failed lists, shadow misses and baseFailures are project-relative ("src/…").
// Every comparison happens on the project-relative form.
export function projectPath(project, file) {
  return file.startsWith(`${project}/`) ? file.slice(project.length + 1) : file
}

// The line cli.mjs prints in the test job's Select step: "<project>:
// <affected|none|full> — <reason>" when enforced, "<project>: shadow (would
// run: <mode>) — <reason>" in shadow mode. The job log prefixes each line
// with a timestamp. Null when no such line is there.
export function selectLineFromLog(log, project) {
  const re = new RegExp(`^(?:\\S+Z )?${project}: (?:shadow \\(would run: (affected|none|full)\\)|(affected|none|full)) — `, "m")
  const m = re.exec(log ?? "")
  if (!m) return null
  return m[1] ? { ci: "shadow", selection: m[1] } : { ci: "enforced", selection: m[2] }
}

// One project's selection in an enforced run, from its selection-<project>-<shard>
// artifacts (every shard selects from the same merge commit, so the shards
// agree). parts: [{ shard, selection, error? }]. Any part that could not be
// read is kept as `unreadable`; an artifact that is not an enforced
// selection, or shards that disagree, is an error.
export function selectionFromArtifacts(project, parts) {
  const unreadable = parts.filter((p) => p.error).map((p) => p.error)
  const read = parts.filter((p) => p.selection)
  if (!read.length) return { error: unreadable.join("; ") || `selection-${project}.json missing from its artifacts` }
  const wrong = read.find((p) => p.selection.mode !== "affected")
  if (wrong) return { error: `selection-${project}-${wrong.shard}: mode ${JSON.stringify(wrong.selection.mode)}, not "affected"` }
  const filesOf = (sel) => (Array.isArray(sel.files) ? sel.files.map((f) => projectPath(project, f.file)).sort() : null)
  const files = filesOf(read[0].selection)
  if (!files) return { error: `selection-${project}-${read[0].shard}: no files list` }
  if (read.some((p) => filesOf(p.selection)?.join("\n") !== files.join("\n"))) return { error: `the selection-${project} shards disagree on the selection` }
  const sel = read[0].selection
  const rule = sel.registryRule
  return {
    status: "affected",
    files,
    base: sel.base ?? null,
    ...(rule && {
      registry: {
        mode: rule.mode,
        selection: { mode: rule.selection?.mode, files: (rule.selection?.files ?? []).map((f) => projectPath(project, f.file)).sort() },
      },
    }),
    ...(unreadable.length && { unreadable }),
  }
}

// Why a miss stays a miss although its base was looked at (none: not looked at).
export function baseNote(base, file) {
  if (!base) return {}
  const at = base.sha ? ` ${base.sha.slice(0, 9)}` : ""
  if (base.error) return { baseNote: `base${at} not checked: ${base.error}` }
  if (base.flaky?.includes(file)) return { baseNote: `failed on the base${at}'s dev run too, but passed alone there (labelled flaky): ${base.url}` }
  if (base.unknown?.includes(file)) return { baseNote: `failed on the base${at}'s dev run too; its re-run left no report: ${base.url}` }
  return {}
}

// What the merge commit's own post-merge run on dev failed, for one project.
// devRuns: the CI push runs of that commit on dev, newest first: [{ url,
// status, conclusion, artifacts: [names], jobs: [{ name, conclusion, testStep }] }]
// (`jobs` across every attempt: a re-run that went green keeps attempt 1's
// failed lists, and the audit still reads them). testStep is the conclusion of
// the job's "Run tests" step. readLists(artifactName) → { failed, flaky,
// unknown }, project-relative; it throws when the artifact cannot be read.
//   - a shard whose Run tests step passed in every attempt has nothing to say.
//     Its job can still be red (picker-ui's suite runs on shard 1), and then it
//     uploads empty lists, which is not a crash;
//   - a shard whose Run tests step failed must have left
//     failed-<project>-<shard>. With every list empty, the failure names no
//     file: it is unattributed;
//   - a shard whose step never finished (skipped after a setup failure,
//     cancelled) ran no full suite: the run proves nothing, an error.
// An unfinished run is `pending`, and neither an audit nor clean.
export function postMergeFailures({ sha, project, devRuns, readLists }) {
  const done = devRuns.find((r) => r.status === "completed")
  if (!done) return devRuns.length ? { sha, url: devRuns[0].url, pending: true } : { sha, error: "no CI run of it on dev" }
  const fail = (error) => ({ sha, url: done.url, error })
  if (!["success", "failure"].includes(done.conclusion)) return fail(`its dev run ended ${done.conclusion || "without a conclusion"}`)
  const job = JOBS[project]
  const shards = new Map() // shard → the Run tests conclusions of its attempts
  for (const j of done.jobs ?? []) {
    if (!j.name.startsWith(`${job} (`)) continue
    const n = Number(j.name.slice(job.length + 2).split("/")[0])
    if (!Number.isInteger(n)) continue
    if (!shards.has(n)) shards.set(n, [])
    shards.get(n).push(j.testStep ?? "")
  }
  if (!shards.size) return fail(`its dev run has no ${job} shard job`)
  const out = { sha, url: done.url, failed: [], flaky: [], unknown: [], unattributed: [] }
  for (const n of [...shards.keys()].sort((a, b) => a - b)) {
    const steps = shards.get(n)
    if (!steps.includes("failure")) {
      if (steps.includes("success")) continue
      return fail(`${job} (${n}/…) never finished its Run tests step (${steps.filter(Boolean).join(", ") || "not run"}) — no full suite there`)
    }
    const name = `failed-${project}-${n}`
    if (!(done.artifacts ?? []).includes(name)) return fail(`${job} (${n}/…) failed its tests and left no ${name} list`)
    let lists
    try { lists = readLists(name) } catch (err) { return fail(`${name}: ${String(err?.message ?? err).split("\n")[0]}`) }
    const any = ["failed", "flaky", "unknown"].some((k) => lists[k]?.length)
    if (!any) out.unattributed.push(n)
    for (const key of ["failed", "flaky", "unknown"]) out[key] = [...new Set([...out[key], ...(lists[key] ?? [])])].sort()
  }
  return out
}

// selection: { status: "affected", files, registry? } | { status: "none" } |
// { status: "full" } | { status: "untested", why } (the PR ran none of this
// project's tests: the Diff Gate skipped them). It is what the PR's FINAL run
// ran.
const covers = (selection, file) => selection.status === "full" || (selection.status === "affected" && selection.files.includes(file))

// One project of one merged PR. post: postMergeFailures; base: baseFailures of
// the commit the PR was tested on (looked up only when needed: see
// needsBase). A file is
//   - flaky: failed in the full run, passed alone. Listed with whether the
//     selection held it, never a miss;
//   - covered: failed again, and the selection held it. The PR ran it and it
//     passed there, so the selector did not skip it;
//   - inherited: failed again outside the selection, and failed again on the
//     base's own dev run too;
//   - a miss: failed again outside the selection, and not inherited;
//   - unknown: its re-run crashed. Outside the selection it is a possible
//     miss (inherited when the base failed it again).
// A shard that failed naming no file is unattributed unless the PR ran the
// full suite.
// The registry rule (TEST_SELECT_REGISTRY_RULE), from registryRule in the
// selection JSON:
//   - enforce: the narrowed selection is the selection that ran, so its
//     misses are the misses above. The registry section notes them and does
//     not count them a second time;
//   - shadow: a registry miss is a non-inherited file that failed again, that
//     the main selection held and the rule's selection did not
//     (compareRegistry). It counts only when the two selections differ.
export function needsBase(selection, post) {
  return [...(post.failed ?? []), ...(post.unknown ?? [])].some((f) => !covers(selection, f))
}

export function auditProject({ selection, post, base = null }) {
  const out = { misses: [], unknown: [], flaky: [], covered: [], inherited: [], unattributed: [], registry: null }
  const inheritedFrom = (file, key) => base?.sha && base[key]?.includes(file)
  const notInherited = []
  for (const file of post.failed ?? []) {
    if (covers(selection, file)) out.covered.push({ file })
    else if (inheritedFrom(file, "failed")) out.inherited.push({ file, base: base.sha, baseUrl: base.url })
    else { out.misses.push({ file, ...baseNote(base, file) }); notInherited.push(file) }
  }
  for (const file of post.unknown ?? []) {
    if (covers(selection, file)) out.covered.push({ file, unknown: true })
    else if (inheritedFrom(file, "failed")) out.inherited.push({ file, base: base.sha, baseUrl: base.url })
    else out.unknown.push({ file, ...baseNote(base, file) })
  }
  for (const file of post.flaky ?? []) out.flaky.push({ file, inSelection: covers(selection, file) })
  if (selection.status !== "full") out.unattributed = [...(post.unattributed ?? [])]
  const rule = selection.status === "affected" ? selection.registry : null
  if (rule?.mode === "enforce") {
    out.registry = { mode: "enforce", misses: out.misses.map((m) => m.file) }
  } else if (rule?.mode === "shadow" && ["affected", "none", "full"].includes(rule.selection?.mode)) {
    // The failed-again files of the post-merge run that are not inherited.
    // compareRegistry keeps those the main selection held and the rule's did not.
    const failedHere = (post.failed ?? []).filter((f) => !inheritedFrom(f, "failed"))
    const { misses, differs } = compareRegistry({ failed: failedHere, main: { mode: "affected", files: selection.files }, registry: rule.selection })
    out.registry = { mode: "shadow", differs, misses: differs ? misses : [] }
  }
  return out
}

// prs: one entry per PR into dev that has an enforced run since --since:
//   { pr, state, url?, mergeUrl?, runs, superseded, error?, projects?: { [project]: auditProject | { error } } }
// state: "audited" (merged; its final run was enforced; its post-merge run finished),
// "unmerged" (nothing to audit, no error), "pending" (its post-merge run has
// not finished), "shadow-final" (its final run was a shadow run, which the
// shadow report checked), "unselected-green" (merged with no enforced run
// finished on its final head, and its post-merge full run passed: a miss is a
// post-merge failure, so with none there is nothing it could have missed —
// listed so the merge-before-CI gap stays visible, never blocking Clean;
// decided 2026-10-19), "error" (could not be audited).
// Clean needs: no miss, no unknown re-run outside a selection, no unattributed
// failure, nothing pending, nothing that could not be audited.
export function aggregateEnforced(prs, unclassified = []) {
  const misses = []
  const unknown = []
  const flaky = []
  const covered = []
  const inherited = []
  const unattributed = []
  const errors = unclassified.map((u) => ({ ...u }))
  const registry = { checked: 0, misses: [], enforced: 0, enforcedMisses: 0 }
  const count = { audited: 0, unmerged: 0, pending: 0, "shadow-final": 0, "unselected-green": 0, error: 0 }
  const runs = { final: 0, superseded: 0, unmerged: 0, pending: 0, "shadow-final": 0, "unselected-green": 0, error: 0 }
  const pending = []
  const unselectedGreen = []
  for (const p of prs) {
    count[p.state]++
    if (p.state === "audited") {
      runs.final++
      runs.superseded += p.superseded ?? 0
    } else {
      runs[p.state] += p.runs ?? 0
    }
    const at = { pr: p.pr, url: p.mergeUrl ?? p.url }
    if (p.state === "pending") pending.push(at)
    if (p.state === "unselected-green") unselectedGreen.push({ ...at, note: p.note })
    if (p.state === "error") errors.push({ ...at, error: p.error })
    if (p.state !== "audited") continue
    for (const project of PROJECTS) {
      const r = p.projects?.[project]
      if (!r) continue
      if (r.error) { errors.push({ ...at, project, error: r.error }); continue }
      for (const m of r.misses) misses.push({ project, ...at, ...m })
      for (const m of r.unknown) unknown.push({ project, ...at, ...m })
      for (const m of r.flaky) flaky.push({ project, ...at, ...m })
      for (const m of r.covered) covered.push({ project, ...at, ...m })
      for (const m of r.inherited) inherited.push({ project, ...at, ...m })
      for (const shard of r.unattributed) unattributed.push({ project, ...at, shard })
      for (const e of r.unreadable ?? []) errors.push({ ...at, project, error: e })
      if (r.registry?.mode === "enforce") {
        registry.enforced++
        registry.enforcedMisses += r.registry.misses.length
      } else if (r.registry?.mode === "shadow" && r.registry.differs) {
        registry.checked++
        for (const file of r.registry.misses) registry.misses.push({ project, ...at, file })
      }
    }
  }
  const clean = count.audited > 0 && ![misses, unknown, unattributed, pending, errors].some((l) => l.length)
  return { prs: count, runs, misses, unknown, flaky, covered, inherited, unattributed, pending, unselectedGreen, errors, registry, clean }
}

// Which enforced run of a PR is its final selection: the newest run of the
// head the PR merged with. runs: [{ id, headSha }]; null when none ran it.
export function finalRun(runs, headSha) {
  const own = runs.filter((r) => r.headSha === headSha)
  return own.length ? own.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a)) : null
}

// The shadow and the enforced record together: Clean only when both are,
// and at least one run or PR was checked in all.
export function overallClean(shadow, enforced) {
  const shadowOk = ![shadow.misses, shadow.unattributed, shadow.crashed, shadow.missing, shadow.errors].some((l) => l.length)
  const enforcedOk = ![enforced.misses, enforced.unknown, enforced.unattributed, enforced.pending, enforced.errors].some((l) => l.length)
  return shadowOk && enforcedOk && shadow.runsChecked + enforced.prs.audited > 0
}

// ── collection (gh) ─────────────────────────────────────────────────────
// enforcedRuns: [{ id, url, headSha, pr, jobs: [[name, conclusion, jobId, testStep]], projects: { [project]: selection | { error } } }]
// listedByHead: Map(head sha → [{ id, kind }]) over every listed PR run, to
// tell where a PR's final run went when it is not an enforced one.
// helpers: gh(...args) → stdout (throws), readLists(runId, name, project),
// devFailures(sha, project) (baseFailures of a base commit), baseFromJobLog(jobs, project) → { sha } | { error }.
export function collectEnforcedAudits({ repo, enforcedRuns, listedByHead, gh, readLists, devFailures, baseFromJobLog }) {
  const byPr = new Map()
  const unclassified = []
  for (const run of enforcedRuns) {
    if (!run.pr) { unclassified.push({ url: run.url, error: `an enforced run whose PR could not be found${run.prError ? ` (${run.prError})` : ""}` }); continue }
    if (!byPr.has(run.pr)) byPr.set(run.pr, [])
    byPr.get(run.pr).push(run)
  }
  const devRunsBySha = new Map()
  const devRunsOf = (sha) => {
    if (!devRunsBySha.has(sha)) {
      const runs = gh("api", `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=dev&per_page=10`,
        "--jq", ".workflow_runs[] | [.id, .html_url, .status, (.conclusion // \"\")] | @tsv")
        .split("\n").filter(Boolean).map((l) => { const [id, url, status, conclusion] = l.split("\t"); return { id, url, status, conclusion } })
      const done = runs.find((r) => r.status === "completed")
      if (done) {
        done.artifacts = gh("api", `repos/${repo}/actions/runs/${done.id}/artifacts?per_page=100`, "--jq", ".artifacts[] | select(.expired | not) | .name").split("\n").filter(Boolean)
        done.jobs = gh("api", "--paginate", `repos/${repo}/actions/runs/${done.id}/jobs?filter=all&per_page=100`, "--jq",
          ".jobs[] | [.name, (.conclusion // \"\"), ([.steps[]? | select(.name == \"Run tests\") | (.conclusion // \"\")] | first // \"\")] | @tsv")
          .split("\n").filter(Boolean).map((l) => { const [name, conclusion, testStep] = l.split("\t"); return { name, conclusion, testStep } })
      }
      devRunsBySha.set(sha, runs)
    }
    return devRunsBySha.get(sha)
  }
  const prs = []
  for (const [pr, runs] of [...byPr].sort((a, b) => a[0] - b[0])) {
    const entry = { pr, runs: runs.length }
    prs.push(entry)
    let info
    try {
      // the always-present fields first: gh()'s output is trimmed, so a leading empty field would shift the rest
      const [headSha, baseRef, mergedAt = "", mergeSha = ""] = gh("api", `repos/${repo}/pulls/${pr}`, "--jq", "[.head.sha, .base.ref, (.merged_at // \"\"), (.merge_commit_sha // \"\")] | @tsv").split("\t")
      info = { mergedAt, mergeSha, headSha, baseRef }
    } catch (err) {
      Object.assign(entry, { state: "error", url: runs[0].url, error: `PR #${pr} could not be read: ${firstLine(err)}` })
      continue
    }
    if (info.baseRef !== "dev") { Object.assign(entry, { state: "error", url: runs[0].url, error: `PR #${pr} targets ${info.baseRef}, not dev` }); continue }
    if (!info.mergedAt) { entry.state = "unmerged"; entry.url = runs[0].url; continue }
    const final = finalRun(runs, info.headSha)
    if (!final) {
      const kinds = (listedByHead.get(info.headSha) ?? []).map((r) => r.kind)
      if (kinds.includes("shadow")) { Object.assign(entry, { state: "shadow-final", url: runs[0].url }); continue }
      const why = `its final head ${info.headSha.slice(0, 9)} has no enforced run listed${kinds.length ? ` (listed as: ${kinds.join(", ")})` : ""}`
      // Nothing selected it — but a green post-merge full run leaves nothing to miss.
      let devRuns
      try { devRuns = devRunsOf(info.mergeSha) } catch (err) {
        Object.assign(entry, { state: "error", url: runs[0].url, error: `${why}; its post-merge run of ${info.mergeSha.slice(0, 9)} could not be read: ${firstLine(err)}` })
        continue
      }
      const done = devRuns.find((r) => r.status === "completed")
      if (!done) { Object.assign(entry, { state: "pending", url: runs[0].url, mergeUrl: devRuns[0]?.url }); continue }
      if (done.conclusion === "success") { Object.assign(entry, { state: "unselected-green", url: runs[0].url, mergeUrl: done.url, note: why }); continue }
      Object.assign(entry, { state: "error", url: runs[0].url, mergeUrl: done.url, error: `${why}, and its post-merge run ${info.mergeSha.slice(0, 9)} ended ${done.conclusion || "unfinished"}` })
      continue
    }
    Object.assign(entry, { url: final.url, superseded: runs.length - 1, mergeSha: info.mergeSha })
    let devRuns
    try { devRuns = devRunsOf(info.mergeSha) } catch (err) {
      Object.assign(entry, { state: "error", error: `the post-merge run of ${info.mergeSha.slice(0, 9)} could not be read: ${firstLine(err)}` })
      continue
    }
    const done = devRuns.find((r) => r.status === "completed")
    entry.mergeUrl = (done ?? devRuns[0])?.url
    entry.projects = {}
    for (const project of PROJECTS) {
      const selection = final.projects[project]
      if (!selection) continue
      if (selection.error) { entry.projects[project] = { error: selection.error }; continue }
      const post = postMergeFailures({ sha: info.mergeSha, project, devRuns, readLists: (name) => readLists(done.id, name, project) })
      if (post.pending) { entry.state = "pending"; break }
      if (post.error) { entry.projects[project] = { error: `post-merge run ${info.mergeSha.slice(0, 9)}: ${post.error}` }; continue }
      let base = null
      if (needsBase(selection, post)) {
        const found = selection.base ? { sha: selection.base } : baseFromJobLog(final.jobs, project)
        base = found.sha ? devFailures(found.sha, project) : { error: found.error }
      }
      entry.projects[project] = { ...auditProject({ selection, post, base }), ...(selection.unreadable && { unreadable: selection.unreadable }) }
    }
    entry.state ??= "audited"
  }
  return { prs, unclassified }
}

const firstLine = (err) => String(err?.message ?? err).split("\n")[0]

// The enforced half of the printed report (shadow-report.mjs renderReport).
export function renderEnforced(e) {
  const at = (m) => `#${m.pr} ${m.url}`
  const sel = (m) => (m.inSelection ? "in the PR's selection" : "outside the PR's selection")
  return [
    `── Enforced PRs (a PR ran only its selection; audited on its merge commit's post-merge dev run): ${Object.values(e.prs).reduce((a, b) => a + b, 0)}`,
    `  audited (merged; final run enforced; post-merge run finished): ${e.prs.audited} — ${e.runs.final} final run(s), ${e.runs.superseded} superseded by a later push`,
    `  not merged — nothing to audit: ${e.prs.unmerged} PR(s), ${e.runs.unmerged} run(s)`,
    `  final run in shadow mode (checked above): ${e.prs["shadow-final"]} PR(s), ${e.runs["shadow-final"]} enforced run(s)`,
    `  post-merge run not finished yet (blocks Clean): ${e.prs.pending} PR(s)`,
    ...e.pending.map((m) => `    - ${at(m)}`),
    `  merged with no enforced run finished on its final head, post-merge full run green — nothing to miss (not blocking Clean): ${e.prs["unselected-green"]} PR(s)`,
    ...(e.unselectedGreen ?? []).map((m) => `    - ${m.note}  ${at(m)}`),
    `  could not be audited: ${e.prs.error} PR(s)`,
    `Enforced misses (failed again on the post-merge run, not flaky, outside the PR's final selection, not failing again on its base): ${e.misses.length}`,
    ...e.misses.map((m) => `  - ${m.project}: ${m.file}  ${at(m)}${m.baseNote ? `  (${m.baseNote})` : ""}`),
    `Re-run left no report, outside the selection (possible misses): ${e.unknown.length}`,
    ...e.unknown.map((m) => `  - ${m.project}: ${m.file}  ${at(m)}${m.baseNote ? `  (${m.baseNote})` : ""}`),
    `Flaky on the post-merge run (failed in the full run, passed alone — not misses): ${e.flaky.length}`,
    ...e.flaky.map((m) => `  - ${m.project}: ${m.file}  ${at(m)}  (${sel(m)})`),
    `Inherited from dev (failed again on the PR's base commit's own dev run — not a miss): ${e.inherited.length}`,
    ...e.inherited.map((m) => `  - ${m.project}: ${m.file}  ${at(m)}  (base ${m.base.slice(0, 9)}: ${m.baseUrl})`),
    `Failed again inside the PR's selection (selected on the PR — not a selector miss; the pass cache may have skipped one whose inputs passed before): ${e.covered.length}`,
    ...e.covered.map((m) => `  - ${m.project}: ${m.file}  ${at(m)}${m.unknown ? "  (re-run left no report)" : ""}`),
    `Unattributed post-merge failures (a shard failed naming no file — possible misses): ${e.unattributed.length}`,
    ...e.unattributed.map((m) => `  - ${m.project} shard ${m.shard}: ${at(m)}`),
    `Enforced checks that could not run or be read: ${e.errors.length}`,
    ...e.errors.map((m) => `  - ${m.project ? `${m.project}: ` : ""}${m.error}  ${m.pr ? at(m) : m.url}`),
  ]
}
