import { test } from "node:test"
import assert from "node:assert/strict"
import {
  migrationNumber,
  addedMigrations,
  removedMigrations,
  evaluate,
  formatReport,
  runCheck,
  runRecheck,
} from "../check-migration-numbers.mjs"

const M = (name) => `supabase/migrations/${name}`

test("migrationNumber reads the NNN_ prefix of a top-level migration only", () => {
  assert.equal(migrationNumber(M("465_collections.sql")), 465)
  assert.equal(migrationNumber("465_collections.sql"), 465)
  assert.equal(migrationNumber(M("001_initial_schema.sql")), 1)
  assert.equal(migrationNumber(M(".sequence")), null)
  assert.equal(migrationNumber(M("_phase2_pending/_test-fixture.sql")), null)
  assert.equal(migrationNumber(M("_phase2_pending/REVERSE_credit.sql")), null)
  assert.equal(migrationNumber(M("465_collections.md")), null)
  assert.equal(migrationNumber("backend/465_collections.sql"), null)
})

test("addedMigrations keeps added, renamed and copied migrations; drops edits, removals and other paths", () => {
  const files = [
    { filename: M("465_a.sql"), status: "added" },
    // today's renumber fix was a rename: the new name is a new allocation
    { filename: M("466_b.sql"), status: "renamed", previous_filename: M("464_b.sql") },
    { filename: M("467_c.sql"), status: "copied" },
    { filename: M("300_old.sql"), status: "modified" },
    { filename: M("301_gone.sql"), status: "removed" },
    { filename: M(".sequence"), status: "modified" },
    { filename: M("_phase2_pending/_x.sql"), status: "added" },
    { filename: "backend/src/x.ts", status: "added" },
  ]
  assert.deepEqual(addedMigrations(files), [M("465_a.sql"), M("466_b.sql"), M("467_c.sql")])
})

test("a number dev already holds under a different filename is a collision, and the fix is max(dev, open PRs) + 1", () => {
  const r = evaluate({
    added: [M("464_input_overrides.sql")],
    baseFiles: ["463_x.sql", "464_dialogue_v4.sql"],
    openPrs: [{ number: 1816, added: [M("466_site_capture.sql")] }],
  })
  assert.equal(r.collisions.length, 1)
  assert.deepEqual(r.collisions[0], {
    file: M("464_input_overrides.sql"),
    number: 464,
    baseFiles: ["464_dialogue_v4.sql"],
    suggested: 467,
  })
  assert.equal(r.nextFree, 467)
})

test("the same filename already on dev is not a collision (the PR merged dev in, or it landed elsewhere)", () => {
  const r = evaluate({ added: [M("464_x.sql")], baseFiles: ["463_a.sql", "464_x.sql"], openPrs: [] })
  assert.deepEqual(r.collisions, [])
})

test("no open-PR data falls back to dev alone", () => {
  const r = evaluate({ added: [M("463_mine.sql")], baseFiles: ["462_a.sql", "463_b.sql"], openPrs: null })
  assert.equal(r.collisions[0].suggested, 464)
  assert.equal(r.openPrsKnown, false)
})

test("several collisions get consecutive free numbers, above this PR's own non-colliding numbers", () => {
  const r = evaluate({
    added: [M("463_a.sql"), M("464_b.sql"), M("470_c.sql")],
    baseFiles: ["463_x.sql", "464_y.sql"],
    openPrs: [{ number: 9, added: [M("468_z.sql")] }],
  })
  assert.deepEqual(r.collisions.map((c) => [c.number, c.suggested]), [[463, 471], [464, 472]])
})

test("open PRs whose files dev already holds (the dev→main promote) do not inflate the free number", () => {
  const r = evaluate({
    added: [M("463_a.sql")],
    baseFiles: ["462_x.sql", "463_y.sql"],
    openPrs: [{ number: 2, added: [M("462_x.sql"), M("463_y.sql")] }],
  })
  assert.equal(r.collisions[0].suggested, 464)
})

test("another open PR adding the same number under another name is a warning, not a failure", () => {
  const r = evaluate({
    added: [M("467_mine.sql")],
    baseFiles: ["466_x.sql"],
    openPrs: [{ number: 1844, added: [M("467_theirs.sql")] }],
  })
  assert.deepEqual(r.collisions, [])
  assert.deepEqual(r.openPrClashes, [{ file: M("467_mine.sql"), number: 467, pr: 1844, prFile: M("467_theirs.sql") }])
  const report = formatReport(r, { base: "dev" })
  assert.equal(report.errors.length, 0)
  assert.equal(report.warnings.length, 1)
  assert.match(report.warnings[0], /#1844/)
  assert.match(report.warnings[0], /468/)
})

test("the error names the taken file, the free number, and the .sequence bump", () => {
  const r = evaluate({ added: [M("464_mine.sql")], baseFiles: ["464_theirs.sql"], openPrs: [] })
  const { errors } = formatReport(r, { base: "dev" })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /464_mine\.sql/)
  assert.match(errors[0], /464_theirs\.sql/)
  assert.match(errors[0], /465_mine\.sql/)
  assert.match(errors[0], /\.sequence/)
})

test("removedMigrations returns the old side of a rename and removed files, as basenames", () => {
  const files = [
    { filename: M("466_b.sql"), status: "renamed", previous_filename: M("466_a.sql") },
    { filename: M("301_gone.sql"), status: "removed" },
    { filename: M("465_new.sql"), status: "added" },
    { filename: M("300_old.sql"), status: "modified" },
    { filename: "backend/x.sql", status: "removed" },
  ]
  assert.deepEqual(removedMigrations(files), ["466_a.sql", "301_gone.sql"])
})

test("renaming a dev migration's description under the same number is not a collision, nor out of order", () => {
  const r = evaluate({
    added: [M("466_b.sql")],
    removed: ["466_a.sql"],
    baseFiles: ["464_x.sql", "466_a.sql", "467_y.sql"],
    openPrs: [],
  })
  assert.deepEqual(r.collisions, [])
  assert.deepEqual(r.outOfOrder, [])
  assert.equal(formatReport(r, { base: "dev" }).warnings.length, 0)
})

test("a free number below dev's highest is flagged out of order, with the next free number to use", () => {
  const r = evaluate({ added: [M("465_c.sql")], baseFiles: ["464_a.sql", "466_b.sql"], openPrs: [] })
  assert.deepEqual(r.collisions, [])
  assert.deepEqual(r.outOfOrder, [{ file: M("465_c.sql"), number: 465, highest: 466, suggested: 467 }])
  const { errors, warnings } = formatReport(r, { base: "dev" })
  assert.equal(errors.length, 0, "a warning until decided otherwise (OUT_OF_ORDER_FAILS)")
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /465_c\.sql/)
  assert.match(warnings[0], /466/)
  assert.match(warnings[0], /467_c\.sql/)
  assert.match(warnings[0], /db push/)
})

test("out-of-order suggestions come after the collisions' and before the open-PR clash hints", () => {
  const r = evaluate({
    added: [M("463_a.sql"), M("465_b.sql"), M("470_c.sql")],
    baseFiles: ["463_x.sql", "466_y.sql"],
    openPrs: [{ number: 9, added: [M("470_z.sql")] }],
  })
  assert.deepEqual(r.collisions.map((c) => [c.number, c.suggested]), [[463, 471]])
  assert.deepEqual(r.outOfOrder.map((o) => [o.number, o.suggested]), [[465, 472]])
  const { warnings } = formatReport(r, { base: "dev" })
  assert.equal(warnings.length, 2)
  assert.match(warnings[1], /#9/)
  assert.match(warnings[1], /473 is free now/)
})

test("a file dev already holds by name is never out of order", () => {
  const r = evaluate({ added: [M("465_c.sql")], baseFiles: ["465_c.sql", "466_b.sql"], openPrs: [] })
  assert.deepEqual(r.outOfOrder, [])
})

// ── the CLI halves, against a stubbed `gh api` ──────────────────────────────

function fakeGh(routes) {
  const calls = []
  const gh = async (method, path) => {
    calls.push(`${method} ${path}`)
    for (const [re, reply] of routes) {
      if (re.test(`${method} ${path}`)) {
        if (reply instanceof Error) throw reply
        return typeof reply === "function" ? reply(path) : reply
      }
    }
    throw new Error(`unexpected gh call: ${method} ${path}`)
  }
  return { gh, calls }
}

const quiet = () => {
  const lines = []
  return { lines, log: (l) => lines.push(l) }
}

const baseTreeRoutes = (names) => [
  [/^GET repos\/o\/r\/contents\/supabase\?ref=dev$/, [{ name: "migrations", type: "dir", sha: "tree1" }]],
  [/^GET repos\/o\/r\/git\/trees\/tree1$/, { truncated: false, tree: names.map((path) => ({ path, type: "blob" })) }],
]

test("runCheck fails a PR whose number dev took after it branched", async () => {
  const { gh } = fakeGh([
    [/^GET repos\/o\/r\/pulls\/7\/files\?per_page=100&page=1$/, [{ filename: M("464_mine.sql"), status: "added" }]],
    ...baseTreeRoutes(["464_theirs.sql", ".sequence"]),
    [/^GET repos\/o\/r\/pulls\?state=open&per_page=100&page=1$/, [{ number: 7, head: { sha: "a" } }, { number: 8, head: { sha: "b" } }]],
    [/^GET repos\/o\/r\/pulls\/8\/files\?per_page=100&page=1$/, [{ filename: M("465_other.sql"), status: "added" }]],
  ])
  const { lines, log } = quiet()
  const code = await runCheck({ gh, repo: "o/r", pr: "7", base: "dev", log })
  assert.equal(code, 1)
  assert.ok(lines.some((l) => l.startsWith("::error file=supabase/migrations/464_mine.sql::") && /466_mine\.sql/.test(l)), lines.join("\n"))
})

test("runCheck reads dev LAST, after listing every open PR, so its snapshot is the freshest", async () => {
  const { gh, calls } = fakeGh([
    [/^GET repos\/o\/r\/pulls\/7\/files\?per_page=100&page=1$/, [{ filename: M("466_mine.sql"), status: "added" }]],
    ...baseTreeRoutes(["465_theirs.sql"]),
    [/^GET repos\/o\/r\/pulls\?state=open&per_page=100&page=1$/, [{ number: 8, head: { sha: "b" } }]],
    [/^GET repos\/o\/r\/pulls\/8\/files\?per_page=100&page=1$/, [{ filename: M("467_other.sql"), status: "added" }]],
  ])
  const { log } = quiet()
  assert.equal(await runCheck({ gh, repo: "o/r", pr: "7", base: "dev", log }), 0)
  const lastPrRead = calls.lastIndexOf("GET repos/o/r/pulls/8/files?per_page=100&page=1")
  const firstDevRead = calls.indexOf("GET repos/o/r/contents/supabase?ref=dev")
  assert.ok(lastPrRead >= 0 && firstDevRead > lastPrRead, calls.join("\n"))
})

test("runCheck passes a PR with no migrations without reading dev", async () => {
  const { gh, calls } = fakeGh([
    [/^GET repos\/o\/r\/pulls\/7\/files\?per_page=100&page=1$/, [{ filename: "backend/x.ts", status: "added" }]],
  ])
  const { log } = quiet()
  assert.equal(await runCheck({ gh, repo: "o/r", pr: "7", base: "dev", log }), 0)
  assert.equal(calls.length, 1)
})

test("runCheck pages through PR files", async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ filename: `frontend/f${i}.ts`, status: "added" }))
  const { gh } = fakeGh([
    [/^GET repos\/o\/r\/pulls\/7\/files\?per_page=100&page=1$/, page1],
    [/^GET repos\/o\/r\/pulls\/7\/files\?per_page=100&page=2$/, [{ filename: M("464_mine.sql"), status: "added" }]],
    ...baseTreeRoutes(["464_theirs.sql"]),
    [/^GET repos\/o\/r\/pulls\?state=open/, []],
  ])
  const { log } = quiet()
  assert.equal(await runCheck({ gh, repo: "o/r", pr: "7", base: "dev", log }), 1)
})

test("runCheck falls back to dev alone when the token cannot list open PRs", async () => {
  const { gh } = fakeGh([
    [/^GET repos\/o\/r\/pulls\/7\/files\?per_page=100&page=1$/, [{ filename: M("464_mine.sql"), status: "added" }]],
    ...baseTreeRoutes(["464_theirs.sql"]),
    [/^GET repos\/o\/r\/pulls\?state=open/, new Error("HTTP 403: Resource not accessible by integration")],
  ])
  const { lines, log } = quiet()
  assert.equal(await runCheck({ gh, repo: "o/r", pr: "7", base: "dev", log }), 1)
  assert.ok(lines.some((l) => /465_mine\.sql/.test(l)))
  assert.ok(lines.some((l) => l.startsWith("::warning::") && /dev only/.test(l)))
})

test("runCheck does not flag a PR that renames dev's migration under the same number", async () => {
  const { gh } = fakeGh([
    [/^GET repos\/o\/r\/pulls\/7\/files\?per_page=100&page=1$/, [
      { filename: M("466_b.sql"), status: "renamed", previous_filename: M("466_a.sql") },
    ]],
    ...baseTreeRoutes(["465_x.sql", "466_a.sql"]),
    [/^GET repos\/o\/r\/pulls\?state=open/, []],
  ])
  const { lines, log } = quiet()
  assert.equal(await runCheck({ gh, repo: "o/r", pr: "7", base: "dev", log }), 0, lines.join("\n"))
})

test("runCheck refuses to judge against a truncated dev tree", async () => {
  const { gh } = fakeGh([
    [/^GET repos\/o\/r\/pulls\/7\/files\?per_page=100&page=1$/, [{ filename: M("464_mine.sql"), status: "added" }]],
    [/^GET repos\/o\/r\/contents\/supabase\?ref=dev$/, [{ name: "migrations", type: "dir", sha: "tree1" }]],
    [/^GET repos\/o\/r\/git\/trees\/tree1$/, { truncated: true, tree: [] }],
  ])
  const { log } = quiet()
  await assert.rejects(runCheck({ gh, repo: "o/r", pr: "7", base: "dev", log }), /truncated/)
})

const noSleep = async () => {}

test("runRecheck re-runs every open dev PR's latest completed guard run, and waits out an in-progress one", async () => {
  let polls33 = 0
  const { gh, calls } = fakeGh([
    [/^GET repos\/o\/r\/pulls\?state=open&base=dev&per_page=100&page=1$/, [
      { number: 1, head: { sha: "s1" } },
      { number: 2, head: { sha: "s2" } },
      { number: 3, head: { sha: "s3" } },
      { number: 4, head: { sha: "s4" } },
      { number: 5, head: { sha: "s5" } },
    ]],
    [/^GET repos\/o\/r\/pulls\/1\/files/, [{ filename: M("470_a.sql"), status: "added" }]],
    [/^GET repos\/o\/r\/pulls\/2\/files/, [{ filename: "frontend/x.ts", status: "modified" }]],
    [/^GET repos\/o\/r\/pulls\/3\/files/, [{ filename: M("471_b.sql"), status: "added" }]],
    [/^GET repos\/o\/r\/pulls\/4\/files/, [{ filename: M("472_c.sql"), status: "added" }]],
    [/^GET repos\/o\/r\/pulls\/5\/files/, [{ filename: M("473_d.sql"), status: "added" }]],
    [/^GET repos\/o\/r\/actions\/workflows\/g\.yml\/runs\?event=pull_request&head_sha=s1&per_page=1$/, { workflow_runs: [{ id: 11, status: "completed" }] }],
    [/^GET repos\/o\/r\/actions\/workflows\/g\.yml\/runs\?event=pull_request&head_sha=s3&per_page=1$/, { workflow_runs: [{ id: 33, status: "in_progress" }] }],
    [/^GET repos\/o\/r\/actions\/workflows\/g\.yml\/runs\?event=pull_request&head_sha=s4&per_page=1$/, { workflow_runs: [{ id: 44, status: "completed" }] }],
    [/^GET repos\/o\/r\/actions\/workflows\/g\.yml\/runs\?event=pull_request&head_sha=s5&per_page=1$/, { workflow_runs: [{ id: 55, status: "queued" }] }],
    [/^GET repos\/o\/r\/actions\/runs\/33$/, () => ({ id: 33, status: ++polls33 < 3 ? "in_progress" : "completed" })],
    [/^POST repos\/o\/r\/actions\/runs\/(11|33)\/rerun$/, null],
    [/^POST repos\/o\/r\/actions\/runs\/44\/rerun$/, new Error("HTTP 403: Resource not accessible by integration")],
  ])
  const { lines, log } = quiet()
  const code = await runRecheck({ gh, repo: "o/r", base: "dev", workflow: "g.yml", log, sleep: noSleep })
  assert.equal(code, 0, "best-effort: a refused re-run warns, it never fails the dev push")
  assert.ok(calls.includes("POST repos/o/r/actions/runs/11/rerun"))
  assert.ok(
    calls.indexOf("POST repos/o/r/actions/runs/33/rerun") > calls.lastIndexOf("GET repos/o/r/actions/runs/33"),
    "an in-progress run may have read the old dev: it is re-run once it completes",
  )
  assert.equal(polls33, 3)
  assert.ok(!calls.some((c) => c.includes("runs/55")), "a queued run has not read dev yet — left alone")
  assert.ok(!calls.some((c) => c.includes("head_sha=s2")), "a PR without migrations is not touched")
  assert.ok(lines.some((l) => l.startsWith("::warning::") && /#4/.test(l)))
})

test("runRecheck warns, and does not re-run, an in-progress run that outlasts the shared deadline", async () => {
  let now = 0
  const { gh, calls } = fakeGh([
    [/^GET repos\/o\/r\/pulls\?state=open&base=dev&per_page=100&page=1$/, [{ number: 3, head: { sha: "s3" } }]],
    [/^GET repos\/o\/r\/pulls\/3\/files/, [{ filename: M("471_b.sql"), status: "added" }]],
    [/^GET repos\/o\/r\/actions\/workflows\/g\.yml\/runs\?event=pull_request&head_sha=s3&per_page=1$/, { workflow_runs: [{ id: 33, status: "in_progress" }] }],
    [/^GET repos\/o\/r\/actions\/runs\/33$/, { id: 33, status: "in_progress" }],
  ])
  const { lines, log } = quiet()
  const code = await runRecheck({
    gh, repo: "o/r", base: "dev", workflow: "g.yml", log,
    sleep: async (ms) => { now += ms },
    now: () => now,
  })
  assert.equal(code, 0)
  assert.ok(!calls.some((c) => c.startsWith("POST")), calls.join("\n"))
  assert.ok(lines.some((l) => l.startsWith("::warning::") && /#3/.test(l) && /run 33/.test(l)), lines.join("\n"))
  assert.ok(now <= 150_000, `the wait is bounded (waited ${now} ms)`)
})
