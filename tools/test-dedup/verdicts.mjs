// tools/test-dedup/verdicts.mjs
// The pure core of the equivalence harness (plan §5.7 PR 2): given what ran
// and what failed, decide whether a test may go. No I/O, no Vitest, no
// TypeScript — the tools self-tests run it without npm ci.
//
//   killVerdict   remove mode: killed(keepers) ⊇ killed(candidate) over a
//                 kill matrix, from the fallback mutator OR a StrykerJS report
//                 (strykerMatrix) — the verdict does not care which produced it.
//   censusDiff    merge mode: the multiset of test names and the pass count.
//   staticsDiff   merge mode: what a merged file carries over (census.mjs).
//   guardVerdict  guard mode: every seeded violation the candidate catches,
//                 the keepers catch too.
// @reads-none pure functions over the data the caller passes in

/** `<file>#<describe > … > title>` — the one test-id spelling of the harness. */
export const testId = (file, fullName) => `${file}#${fullName}`
export const splitId = (id) => {
  const i = id.indexOf("#")
  return i < 0 ? { file: id, name: "" } : { file: id.slice(0, i), name: id.slice(i + 1) }
}
// Stryker joins the describe path with spaces, Vitest's fullName with " > ".
const norm = (name) => name.replace(/ > /g, " ").replace(/\s+/g, " ").trim()

/**
 * The tests a spec names, from the tests that ran: `file` = every test in it;
 * `file#full name` = exactly that test; `file#title` = the one test whose full
 * name ends with that title. Throws on no match or an ambiguous title, so a
 * typo can never silently prove a different test redundant.
 */
export function resolveTests(tests, spec) {
  const { file, name } = splitId(spec)
  const inFile = tests.filter((t) => t.file === file || t.file.endsWith(`/${file}`))
  if (inFile.length === 0) throw new Error(`no test ran from ${file}`)
  if (!name) return inFile.map((t) => t.id)
  const exact = inFile.filter((t) => norm(t.name) === norm(name))
  if (exact.length === 1) return [exact[0].id]
  const suffix = inFile.filter((t) => norm(t.name).endsWith(` ${norm(name)}`))
  if (exact.length === 0 && suffix.length === 1) return [suffix[0].id]
  const found = exact.length > 1 ? exact : suffix
  throw new Error(found.length === 0
    ? `no test named "${name}" in ${file}`
    : `"${name}" matches ${found.length} tests in ${file} — give the full name:\n  ${found.map((t) => t.name).join("\n  ")}`)
}

/**
 * Remove-mode verdict. `mutants`: [{ label, outcome, killedBy: string[] }],
 * outcome ∈ evaluated | timeout | not-loaded | unhandled | selection | flaky |
 * keeper-timeout | error | static; optional `coveredBy` (StrykerJS per-test
 * coverage: an array, or undefined when the report has none) clears an
 * unresolved mutant no candidate test reaches.
 *   evaluated  — killedBy is complete (every failing test, not the first).
 *   anything else but static — the runs could not say which tests detect it
 *              (a timeout, an unhandled error, a keeper whose kill did not
 *              repeat or was only a timeout, a test filter that did not
 *              select what it should): unresolved.
 *   static     — StrykerJS reports module-level mutants as survived with no
 *              coverage (measured: `imageAIHandlers = {}` "survived"):
 *              unevaluated, reported, never counted as proof either way.
 * Precedence: a unique kill → not-proven (1); else anything unresolved →
 * unresolved (2); else a candidate that kills nothing → vacuous (2, it
 * asserts nothing about the subjects — wrong subject?); else proven (0).
 */
export function killVerdict({ mutants, candidateIds, keeperIds }) {
  const cand = new Set(candidateIds)
  const keep = new Set(keeperIds.filter((id) => !cand.has(id)))
  const unique = []
  const unresolved = []
  const unevaluated = []
  let candidateKills = 0
  let evaluated = 0
  for (const m of mutants) {
    if (m.outcome === "static") { unevaluated.push(m); continue }
    if (m.outcome !== "evaluated") {
      // Stryker's per-test coverage: a timeout no candidate test even reaches
      // cannot be one of the candidate's kills.
      if (Array.isArray(m.coveredBy) && !m.coveredBy.some((id) => cand.has(id))) { evaluated++; continue }
      unresolved.push(m)
      continue
    }
    evaluated++
    if (!m.killedBy.some((id) => cand.has(id))) continue
    candidateKills++
    if (!m.killedBy.some((id) => keep.has(id))) unique.push(m)
  }
  const verdict = unique.length > 0 ? "not-proven"
    : unresolved.length > 0 ? "unresolved"
      : candidateKills === 0 ? "vacuous" : "proven"
  const exitCode = { proven: 0, "not-proven": 1, unresolved: 2, vacuous: 2 }[verdict]
  return { verdict, exitCode, total: mutants.length, evaluated, candidateKills, unique, unresolved, unevaluated }
}

/**
 * Why a StrykerJS JSON report cannot serve as a kill matrix, or null. It must
 * come from a run with `disableBail: true` (with bail, `killedBy` holds only
 * the first killing test and a keeper looks as if it misses the mutant) and
 * `coverageAnalysis: "perTest"` (the only mode with per-test `coveredBy`).
 * The report's own `config` says so; a report without it proves nothing.
 */
export function strykerReportProblem(report) {
  const c = report?.config
  if (!c) return "the report has no `config` (Stryker writes it with the json reporter): cannot tell whether bail was off"
  if (c.disableBail !== true) return "the report comes from a run without `disableBail: true`: `killedBy` lists only the first killing test"
  if (c.coverageAnalysis !== "perTest") return `the report's coverageAnalysis is ${JSON.stringify(c.coverageAnalysis)}, not "perTest"`
  return null
}

/**
 * The kill matrix of a StrykerJS JSON report (mutation-testing-report-schema).
 * `projectDir` is the repo-relative directory Stryker ran in (its paths are
 * relative to it). Check strykerReportProblem first. A mutant whose
 * `killedBy` / `coveredBy` names a test the report does not list, or that is
 * Killed with no killer, is unresolved: dropping the unknown id would hide a
 * kill. A missing `coveredBy` stays undefined (no coverage data), never [].
 * Note: Stryker runs a test file's tests together, so a same-file keeper's
 * kill can depend on the candidate having run first — the fallback mutator
 * scores keepers without the candidate; a Stryker report cannot.
 */
export function strykerMatrix(report, projectDir) {
  const rel = (p) => (p.startsWith("/") || !projectDir ? p : `${projectDir}/${p}`).replace(/\/+/g, "/")
  const tests = []
  const byStrykerId = new Map()
  for (const [file, tf] of Object.entries(report.testFiles ?? {})) {
    for (const t of tf.tests) {
      const entry = { id: testId(rel(file), t.name), file: rel(file), name: t.name, state: "passed" }
      tests.push(entry)
      byStrykerId.set(t.id, entry.id)
    }
  }
  const ids = (list) => (list === undefined ? undefined : list.map((id) => byStrykerId.get(id)))
  const mutants = []
  for (const [file, f] of Object.entries(report.files ?? {})) {
    for (const m of f.mutants) {
      if (m.status === "Ignored" || m.status === "Pending") continue
      const label = `${rel(file)}:${m.location.start.line}:${m.location.start.column} ${m.mutatorName} → \`${String(m.replacement ?? "").replace(/\s+/g, " ").slice(0, 60)}\``
      const killedBy = ids(m.killedBy) ?? []
      const coveredBy = ids(m.coveredBy)
      const unknown = killedBy.includes(undefined) || (coveredBy ?? []).includes(undefined)
      const outcome = unknown || (m.status === "Killed" && killedBy.length === 0) ? "error"
        : m.static && m.status === "Survived" && !(m.coveredBy?.length) ? "static"
          : m.status === "Killed" || m.status === "Survived" || m.status === "NoCoverage" ? "evaluated"
            : m.status === "Timeout" ? "timeout" : "error"
      mutants.push({ label, outcome, killedBy: killedBy.filter(Boolean), coveredBy: coveredBy?.filter(Boolean), status: m.status })
    }
  }
  return { tests, mutants }
}

/**
 * Merge-mode census. `before`/`after`: [{ file, name, state }]. A merged file
 * wraps each original file in a top-level `describe("<original file name>")`;
 * when every after-test sits under such a wrapper the comparison is per
 * original file, otherwise over the whole multiset of names.
 */
export function censusDiff({ before, after }) {
  const base = (f) => f.split("/").pop().replace(/\.(test|spec)\.[cm]?[jt]sx?$/, "")
  const wrappers = new Map()
  for (const t of before) { wrappers.set(base(t.file), base(t.file)); wrappers.set(t.file.split("/").pop(), base(t.file)) }
  const head = (name) => name.split(" > ")[0]
  const wrapped = after.length > 0 && after.every((t) => wrappers.has(head(t.name)) && t.name.includes(" > "))
  const key = (t, side) => {
    if (side === "before") return wrapped ? `${base(t.file)} :: ${t.name}` : t.name
    if (!wrapped) return t.name
    const parts = t.name.split(" > ")
    return `${wrappers.get(parts[0])} :: ${parts.slice(1).join(" > ")}`
  }
  const count = (list, side) => {
    const m = new Map()
    for (const t of list) { const k = key(t, side); m.set(k, (m.get(k) ?? 0) + 1) }
    return m
  }
  const b = count(before, "before")
  const a = count(after, "after")
  const missing = []
  const extra = []
  for (const [k, n] of b) for (let i = (a.get(k) ?? 0); i < n; i++) missing.push(k)
  for (const [k, n] of a) for (let i = (b.get(k) ?? 0); i < n; i++) extra.push(k)
  // A test under a throwing hook passed nothing: its file is red.
  const passed = (list) => list.filter((t) => t.state === "passed" && !t.hookFailed).length
  const failed = (list) => list.filter((t) => t.state === "failed" || t.hookFailed).map((t) => `${t.file}#${t.name}`)
  const result = {
    wrapped,
    before: { total: before.length, passed: passed(before) },
    after: { total: after.length, passed: passed(after) },
    missing, extra, failed: [...failed(before), ...failed(after)],
  }
  result.ok = missing.length === 0 && extra.length === 0 && result.failed.length === 0 && result.before.passed === result.after.passed
  return result
}

/**
 * What the subjects execute, compared: `before`/`after` are Map<file, Set<key>>
 * (runners.mjs coveredLines `hits`: every covered statement, branch arm and
 * function). Equal sets on every subject → ok.
 */
export function coverageDiff(before, after) {
  const order = (x, y) => (parseInt(String(x).replace(/^\D+/, ""), 10) - parseInt(String(y).replace(/^\D+/, ""), 10)) || String(x).localeCompare(String(y))
  const files = [...new Set([...before.keys(), ...after.keys()])].sort()
  const rows = files.map((file) => {
    const b = before.get(file) ?? new Set()
    const a = after.get(file) ?? new Set()
    const lost = [...b].filter((l) => !a.has(l)).sort(order)
    const gained = [...a].filter((l) => !b.has(l)).sort(order)
    return { file, before: b.size, after: a.size, lost, gained }
  })
  return { rows, ok: rows.every((r) => r.lost.length === 0 && r.gained.length === 0) }
}

/**
 * Merge-mode verdict: a definite difference (census, statics or coverage) →
 * different (1); else a run that cannot be compared (timed out, unhandled
 * errors) → unresolved (2); else equal (0).
 */
export function mergeVerdict({ census, coverage, statics, problems = [] }) {
  const verdict = !census.ok || coverage?.ok === false || statics?.ok === false ? "different"
    : problems.length > 0 ? "unresolved" : "equal"
  return verdict
}

/** Multiset difference: the items of `a` that `b` lacks, with repeats. */
function lacks(a, b) {
  const left = new Map()
  for (const x of b) left.set(x, (left.get(x) ?? 0) + 1)
  const out = []
  for (const x of a) { const n = left.get(x) ?? 0; if (n > 0) left.set(x, n - 1); else out.push(x) }
  return out
}

/**
 * Merge-mode statics (census.mjs testFileStatics of each side's files), per
 * plan §2: the same `@vitest-environment`, the same vi.mock set and factories
 * in every original file and in the merged one, no shared-worker
 * (`no-isolate-files.json`) file involved, every hook and every `@test-watches`
 * / `@test-always` of the originals kept, at most `maxLines` lines per merged
 * file, and the same multiset of assertions and of test bodies. Each row:
 * { check, ok, detail }.
 */
export function staticsDiff({ before, after, sharedWorker = new Set(), maxLines = 800 }) {
  const rows = []
  const row = (check, ok, detail = "") => rows.push({ check, ok, detail })
  const flat = (list, key) => list.flatMap((f) => f[key])
  const show = (items) => items.map((x) => `\`${x.replace(/\s+/g, " ").slice(0, 80)}\``).join("; ")
  const envs = new Set([...before, ...after].map((f) => f.env || "(project default)"))
  row("Same `@vitest-environment`", envs.size === 1, [...envs].join(", "))
  const mockSet = (f) => f.mocks.join("\n")
  const mockSets = new Set([...before, ...after].map(mockSet))
  row("Same vi.mock set and factories in every file", mockSets.size === 1,
    mockSets.size === 1 ? `${before[0]?.mocks.length ?? 0} mock call(s)` : [...before, ...after].map((f) => `${f.file}: ${f.mocks.length}`).join(", "))
  const shared = [...before, ...after].filter((f) => sharedWorker.has(f.file)).map((f) => f.file)
  row("No shared-worker file (no-isolate-files.json)", shared.length === 0, shared.join(", "))
  const lostHooks = lacks(flat(before, "hooks"), flat(after, "hooks"))
  row("Every hook of the originals kept", lostHooks.length === 0, show(lostHooks))
  const lostWatches = [...new Set(flat(before, "watches"))].filter((w) => !flat(after, "watches").includes(w))
  row("`@test-watches` / `@test-always`: the union kept", lostWatches.length === 0, lostWatches.join(" "))
  const long = after.filter((f) => f.lines > maxLines).map((f) => `${f.file}: ${f.lines}`)
  row(`Merged file(s) at most ${maxLines} lines`, long.length === 0, long.join(", "))
  for (const [key, label] of [["assertions", "assertions"], ["bodies", "test bodies"]]) {
    const missing = lacks(flat(before, key), flat(after, key))
    const extra = lacks(flat(after, key), flat(before, key))
    row(`Same ${label} (${flat(before, key).length} before, ${flat(after, key).length} after)`, missing.length === 0 && extra.length === 0,
      [missing.length ? `missing: ${show(missing)}` : "", extra.length ? `new: ${show(extra)}` : ""].filter(Boolean).join(" — "))
  }
  return { rows, ok: rows.every((r) => r.ok) }
}

/**
 * Guard-mode verdict. `seeds`: [{ seed, candidate, keepers }] and `baseline`
 * the same shape with no seed applied, each side one of
 *   "pass"     — every test passed;
 *   "caught"   — a test failed (or a hook threw, or a module failed to load);
 *   "timeout"  — the run timed out, or its only failures were timeouts: not
 *                evidence either way (a guard that loops is no catch).
 * Precedence: a seed the candidate catches and the keepers miss → not covered
 * (1); else a red or timed-out baseline, or a timeout where the candidate
 * caught or either side might have → unresolved (2); else no seed the
 * candidate catches → vacuous (2: the seeds test nothing it guards); else
 * covered (0).
 */
export function guardVerdict({ baseline, seeds }) {
  const rows = seeds.map((s) => ({
    ...s,
    ok: s.candidate !== "caught" || s.keepers === "caught",
    unresolved: s.candidate === "timeout" || (s.candidate === "caught" && s.keepers === "timeout"),
  }))
  const baselineOk = baseline.candidate === "pass" && baseline.keepers === "pass"
  const uncaught = seeds.filter((s) => s.candidate === "pass" && s.keepers === "pass").map((s) => s.seed)
  const missed = rows.filter((r) => !r.ok && !r.unresolved)
  const verdict = missed.length > 0 ? "not-covered"
    : !baselineOk || rows.some((r) => r.unresolved) ? "unresolved"
      : !rows.some((r) => r.candidate === "caught") ? "vacuous" : "covered"
  const exitCode = { covered: 0, "not-covered": 1, unresolved: 2, vacuous: 2 }[verdict]
  return { ok: verdict === "covered", verdict, exitCode, baselineOk, rows, uncaught }
}

// ---- Markdown, for pasting into a PR description ---------------------------

const yes = (b) => (b ? "yes" : "**no**")
const REMOVE_HEADING = { proven: "PROVEN", "not-proven": "REFUTED (unique kills)", unresolved: "UNRESOLVED", vacuous: "VACUOUS" }

export function renderRemove({ candidate, keepers, subjects, producer, result, durationMs, notes = [] }) {
  const lines = [
    // No other heading contains "PROVEN": a grep for it finds only a proof.
    `### Kill-set subsumption — ${REMOVE_HEADING[result.verdict]}`,
    "",
    `- Candidate: \`${candidate}\``,
    `- Keepers: ${keepers.map((k) => `\`${k}\``).join(", ")}`,
    `- Mutated: ${subjects.map((s) => `\`${s}\``).join(", ")} (${producer})`,
    "",
    "| Mutants | Evaluated | Killed by candidate | Unique to candidate | Unresolved | Unevaluated (static) | Wall time |",
    "|---|---|---|---|---|---|---|",
    `| ${result.total} | ${result.evaluated} | ${result.candidateKills} | ${result.unique.length} | ${result.unresolved.length} | ${result.unevaluated.length} | ${(durationMs / 1000).toFixed(1)} s |`,
  ]
  if (result.unique.length > 0) {
    lines.push("", "Mutants only the candidate kills (move these assertions into a keeper first):", "")
    for (const m of result.unique) lines.push(`- ${m.label}`)
  }
  if (result.unresolved.length > 0) {
    lines.push("", "Unresolved (no per-test attribution):", "")
    for (const m of result.unresolved) lines.push(`- ${m.outcome}: ${m.label}`)
  }
  if (result.verdict === "vacuous") lines.push("", "The candidate kills no mutant: it asserts nothing about the mutated code. Check the subject list.")
  if (result.unevaluated.length > 0) lines.push("", `${result.unevaluated.length} static (module-level) mutants were not evaluated by StrykerJS; the fallback mutator evaluates them.`)
  for (const n of notes) lines.push("", n)
  return lines.join("\n")
}

export function renderMerge({ beforeFiles, afterFiles, census, coverage, statics, problems = [], verdict }) {
  const v = verdict ?? mergeVerdict({ census, coverage, statics, problems })
  const lines = [
    `### Merge census — ${{ equal: "EQUAL", different: "DIFFERENT", unresolved: "UNRESOLVED" }[v]}`,
    "",
    `- Before: ${beforeFiles.map((f) => `\`${f}\``).join(", ")}`,
    `- After: ${afterFiles.map((f) => `\`${f}\``).join(", ")}`,
    `- Compared ${census.wrapped ? "per original file (top-level describe wrappers)" : "as one multiset of test names"}`,
    "",
    "| | Tests | Passed |",
    "|---|---|---|",
    `| Before | ${census.before.total} | ${census.before.passed} |`,
    `| After | ${census.after.total} | ${census.after.passed} |`,
  ]
  if (problems.length > 0) { lines.push("", "Runs that cannot be compared:", ""); for (const p of problems) lines.push(`- ${p}`) }
  if (census.missing.length > 0) { lines.push("", "Missing after the merge:", ""); for (const k of census.missing) lines.push(`- ${k}`) }
  if (census.extra.length > 0) { lines.push("", "New after the merge:", ""); for (const k of census.extra) lines.push(`- ${k}`) }
  if (census.failed.length > 0) { lines.push("", "Failing:", ""); for (const k of census.failed) lines.push(`- ${k}`) }
  if (statics) {
    lines.push("", "| Check | OK | Detail |", "|---|---|---|")
    for (const r of statics.rows) lines.push(`| ${r.check} | ${yes(r.ok)} | ${(r.detail || "—").replace(/\|/g, "\\|")} |`)
  }
  if (coverage) {
    lines.push("", "| Subject | Covered statements, branch arms, functions before | After | Lost | Gained |", "|---|---|---|---|---|")
    for (const r of coverage.rows) lines.push(`| \`${r.file}\` | ${r.before} | ${r.after} | ${r.lost.join(", ") || "—"} | ${r.gained.join(", ") || "—"} |`)
  }
  return lines.join("\n")
}

export function renderGuard({ candidate, keepers, result }) {
  const heading = { covered: "COVERED", "not-covered": "NOT COVERED", unresolved: "UNRESOLVED", vacuous: "VACUOUS" }[result.verdict]
  const lines = [
    `### Seeded-violation diff — ${heading}`,
    "",
    `- Candidate: \`${candidate}\``,
    `- Keepers: ${keepers.map((k) => `\`${k}\``).join(", ")}`,
    `- Baseline (no seed) passes on both sides: ${yes(result.baselineOk)}`,
    "",
    "| Seed | Candidate | Keepers | OK |",
    "|---|---|---|---|",
    ...result.rows.map((r) => `| \`${r.seed}\` | ${r.candidate} | ${r.keepers} | ${r.unresolved ? "unresolved" : yes(r.ok)} |`),
  ]
  if (result.uncaught.length > 0) lines.push("", `Caught by neither side (the seed tests nothing here): ${result.uncaught.map((s) => `\`${s}\``).join(", ")}`)
  if (result.verdict === "vacuous") lines.push("", "The candidate catches no seed: the seeds test nothing it guards. Check the seeds.")
  return lines.join("\n")
}
