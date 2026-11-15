// The history gate's private marker list (tools/check-history-surface.mjs):
// how the list is read and refused, how a marker matches, and what a finding
// may print. The tree gate's half, and the tests that run BOTH gates on one
// list, are in check-private-markers.test.mjs; the rest of the history gate is
// in check-history-surface.test.mjs.
//
// Every value is fake and built at runtime (random words, and invisible
// characters from String.fromCharCode): the real list is a secret, and the
// publish path greps it across every tracked file.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  addedLinesFromPatch,
  findHistoryViolations,
  foldCase,
  invisibleMarkers,
  parseMarkerList,
  WITHHELD,
  writtenPathsFromPatch,
} from "../check-history-surface.mjs"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

const COMPETITOR = ["artl", "st"].join("i")
const ch = (code) => String.fromCharCode(code)

function patch(path, addedLines) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${addedLines.length} @@`,
    ...addedLines.map((l) => `+${l}`),
  ].join("\n")
}

/** A throwaway repository with a fixed identity. */
function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "history-markers-"))
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
      },
    })
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  git("init", "-q", "-b", "main")
  write("seed.ts", "// seed\n")
  git("add", "-A"); git("commit", "-qm", "seed")
  return { dir, git, write, base: git("rev-parse", "HEAD").trim(), done: () => rmSync(dir, { recursive: true, force: true }) }
}

// ---------------------------------------------------------------------------
// The marker list is read as scripts/check-private-markers.sh reads it: one
// marker per line, exactly as written (whitespace around it is kept), with a
// leading BOM and trailing \r's dropped and empty or whitespace-only lines
// skipped. Matching then differs on purpose: the tree gate matches a marker
// literally, this gate reads its edge whitespace as a word boundary — a
// superset. tools/__tests__/check-private-markers.test.mjs runs both gates on
// one list and pins what each catches.

test("parseMarkerList keeps spaces and tabs, drops a leading BOM, trailing \\r's and blank lines", () => {
  assert.deepEqual(parseMarkerList("\uFEFF zz-a \r\n\r\n   \n\t\r\n\tzz-b\t\nzz-c\r\r\nzz-d"), [
    " zz-a ", // the byte-order mark is a save artifact, never part of the first marker
    "\tzz-b\t",
    "zz-c", // every carriage return at a line's end goes (a file converted twice)
    "zz-d",
  ])
  assert.deepEqual(parseMarkerList(""), [])
  assert.deepEqual(parseMarkerList("\uFEFF"), [])
  assert.deepEqual(parseMarkerList(" \n\t\r\n"), [])
  // Only line ENDS are touched: an inner carriage return stays.
  assert.deepEqual(parseMarkerList("zz-e\rzz-f\r\n"), ["zz-e\rzz-f"])
})

/** Letters and digits only, so "inside a longer word" means what it says. */
const fakeWord = () => `zq${randomBytes(6).toString("hex")}`

// A real list, a REQUIRE flag or a PR title in the shell running the tests
// must not decide the outcome.
const {
  PRIVATE_LEAK_MARKERS: _list,
  MIRROR_REQUIRE_MARKERS: _require,
  HISTORY_CHECKS: _checks,
  PR_TITLE: _title,
  PR_BODY: _body,
  ...CLI_ENV
} = process.env

/**
 * The CLI with only the marker check, the list required. The timeout turns a
 * matcher that loops (spawnSync blocks the event loop, so node:test's own
 * timeout cannot fire) into a red test rather than a hung job.
 */
function runMarkerCli(dir, range, extra = {}) {
  const cli = join(REPO_ROOT, "tools/check-history-surface.mjs")
  const r = spawnSync("node", [cli, range], {
    cwd: dir,
    encoding: "utf8",
    timeout: 30000,
    env: { ...CLI_ENV, HISTORY_CHECKS: "markers", MIRROR_REQUIRE_MARKERS: "1", ...extra },
  })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

const assertNoValues = (out, values) => {
  for (const v of values) assert.ok(!out.toLowerCase().includes(v.toLowerCase()), "a marker value was printed")
}

/** The numbers of every marker one added line trips, through the real scan. */
function markerHits(markers, text) {
  const commit = { sha: "x", subject: "", message: "", patch: patch("x.ts", [text]) }
  return findHistoryViolations([commit], { checks: ["markers"], markers }).map((v) => Number(v.why.match(/#(\d+)$/)[1]))
}

test("edge whitespace is a word boundary: the term on its own is caught, inside a longer word never", () => {
  const [a, b, c, d, e, f, g, h, n, q, p] = Array.from({ length: 11 }, fakeWord)
  const nbsp = ch(0xa0)
  const nel = ch(0x85)
  const bom = ch(0xfeff)
  // [marker, lines it catches, lines it never catches]
  const rows = [
    [` ${a} `, // bounded on both sides
      [`see ${a} here`, `see ${a}.`, `${a} is here`, `the repo is ${a}`, a, `https://github.com/org/${a}.git`,
        `use \`${a}\` here`, `(${a.toUpperCase()})`, `x${a}y, then ${a}.`],
      [`x${a}y`, `${a}s`, `snake_${a}_x`, `${a}1`, `9${a}`]],
    [`(${b} `, // a trailing space bounds only the character after the term
      [`(${b},`, `(${b})`, `see (${b}`, `(${b} x`, `x(${b}.`, `(${b.toUpperCase()};`],
      [`(${b}ly`, `(${b}_x`, `(${b}9`]],
    [`${c}${nbsp}`, // a no-break space at the edge is a boundary like a space
      [`has ${c} in it`, `${c}.`, `${c}${nbsp}here`, `x${c}`],
      [`${c}x`]],
    [` ${d}`, // a leading space bounds only the character before
      [`see ${d}x`, d, `/${d}`],
      [`x${d}`, `_${d}`, `1${d}`]],
    [`${e} ${f} `, // inner whitespace stays literal
      [`${e} ${f}.`, `${e} ${f}`, `x${e} ${f}`],
      [`${e}  ${f}`, `${e}${f}`, `${e}\t${f}`, `${e} ${f}1`]],
    [` ${h.slice(0, 4).toUpperCase()}${h.slice(4)} `, // a mixed-case marker is folded too
      [`see ${h}.`, `${h} is here`],
      [`x${h}`]],
    [`${n}${nel}`, // NEL (U+0085) is Unicode White_Space: a boundary like a space
      [`see ${n}.`, `has ${n} in it`],
      [`${n}x`]],
    [`${q}${bom} `, // a byte-order mark tucked inside the edge space is trimmed, never kept in the term
      [`see ${q}.`, `${q} x`],
      [`${q}x`]],
    [` ${bom}${p}`, // ... on the leading side too
      [`see ${p}.`, `${p} x`],
      [`x${p}`]],
    [g, [`x${g}y`], []], // no edge whitespace: a plain substring, as before
  ]
  const markers = rows.map(([m]) => m)
  rows.forEach(([marker, hits, misses], i) => {
    hits.forEach((line, j) => assert.deepEqual(markerHits(markers, line), [i + 1], `marker #${i + 1} missed catch row ${j}`))
    misses.forEach((line, j) => assert.deepEqual(markerHits(markers, line), [], `marker #${i + 1} tripped miss row ${j}`))
    // Everything the tree gate's exact match catches, this gate catches too.
    for (const [j, line] of [...hits, ...misses].entries()) {
      if (line.toLowerCase().includes(marker.toLowerCase())) {
        assert.deepEqual(markerHits(markers, line), [i + 1], `marker #${i + 1} row ${j}: an exact match was not caught`)
      }
    }
  })
})

test("a marker of nothing but a no-break space is matched exactly, never as an empty term", { timeout: 5000 }, () => {
  const nbsp = ch(0xa0)
  const markers = [fakeWord(), nbsp]
  // Misses first: an empty term would hit "" at once (and loop forever on "a b").
  assert.deepEqual(markerHits(markers, ""), [])
  assert.deepEqual(markerHits(markers, "a b"), [])
  assert.deepEqual(markerHits(markers, `a${nbsp}b`), [2])
})

test("every marker that hits a line is reported, as the tree gate reports them", () => {
  const [w, other] = [fakeWord(), fakeWord()]
  // #1 "w " (bounded) also catches "w."; #2 "w." is that line's exact form; #3 a second term.
  const markers = [`${w} `, `${w}.`, other]
  assert.deepEqual(markerHits(markers, `see ${w}. and ${other}`), [1, 2, 3])
  assert.deepEqual(markerHits(markers, `see ${w} here`), [1])
})

test("case folds one code point at a time, so a capital sigma ending a word still matches", () => {
  const [sigma, capital, final] = [ch(0x3c3), ch(0x3a3), ch(0x3c2)]
  const w = fakeWord()
  // String#toLowerCase turns a word-final capital sigma into the final form,
  // which a marker's plain sigma would never match.
  assert.deepEqual(markerHits([`${w}a${sigma}`], `${w.toUpperCase()}A${capital} end`), [1])
  assert.deepEqual(markerHits([`${capital} `], `x A${capital} y`), [1])
  // The final form folds to the plain one, on both sides.
  assert.deepEqual(markerHits([`${w}${final}`], `${w}${sigma}x`), [1])
  assert.equal(foldCase(`A${capital} ${final}`), `a${sigma} ${sigma}`)
  assert.equal(foldCase("MiXeD"), "mixed")
})

test("a hunk line that looks like a +++ header is an added line, never a new path", () => {
  const w = fakeWord()
  const twoFiles = [
    "diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -0,0 +1,3 @@",
    `+++ b/${w}`, "+-- a/x", `+more ${w} here`,
    "diff --git a/b.ts b/b.ts", "--- /dev/null", "+++ b/b.ts", "@@ -0,0 +1 @@", "+b",
  ].join("\n")
  assert.deepEqual(addedLinesFromPatch(twoFiles), [
    { path: "a.ts", text: `++ b/${w}` },
    { path: "a.ts", text: "-- a/x" },
    { path: "a.ts", text: `more ${w} here` },
    { path: "b.ts", text: "b" },
  ])
  assert.deepEqual(writtenPathsFromPatch(twoFiles), ["a.ts", "b.ts"])

  // Through a real commit: the report names the real file, never the line's text.
  const r = tempRepo()
  try {
    r.write("a.ts", `++ b/${w}\nmore ${w} here\n`)
    r.git("add", "-A"); r.git("commit", "-qm", "looks like a header")
    const sha = r.git("rev-parse", "HEAD").trim()
    const run = runMarkerCli(r.dir, `${r.base}..HEAD`, { PRIVATE_LEAK_MARKERS: `${w}\n` })
    assert.equal(run.status, 1)
    assert.deepEqual(
      [...run.out.matchAll(/^\s+(\S+) (\S+) \(private marker #(\d+)\)$/gm)].map((m) => m.slice(1)),
      [[sha, "a.ts", "1"]],
    )
    assertNoValues(run.out, [w])
  } finally {
    r.done()
  }
})

test("a surface finding never prints a line that also holds a private marker's term", () => {
  const w = fakeWord()
  const markers = [` ${w} `] // bounded: an in-word occurrence is no marker hit, but still spells the term
  // The term starts at character 155, so a 160-character cut would hold only its first five.
  const long = `${`// ported from ${COMPETITOR} Studio ${"x ".repeat(80)}`.slice(0, 154)} ${w} tail`
  assert.equal(long.indexOf(w), 155)
  const commits = [
    { sha: "a1", subject: "a", message: "a\n", patch: patch("src/a.ts", [`// ported from ${COMPETITOR} Studio, see ${w} here`]) },
    { sha: "a2", subject: "b", message: "b\n", patch: patch("src/b.ts", [`// ported from ${COMPETITOR} Studio as x${w}y`]) },
    { sha: "a3", subject: "c", message: `c\n\nModeled on ${COMPETITOR} Studio and ${w.toUpperCase()}.\n`, patch: "" },
    { sha: "a4", subject: "d", message: "d\n", patch: patch("src/d.ts", [`// ported from ${COMPETITOR} Studio`]) },
    { sha: "a5", subject: "e", message: "e\n", patch: patch("src/e.ts", [long]) }, // the full line is checked, not the cut
  ]
  const expected = [["a1", WITHHELD], ["a2", WITHHELD], ["a3", WITHHELD], ["a4", `// ported from ${COMPETITOR} Studio`], ["a5", WITHHELD]]
  const citations = (found) => found.filter((v) => v.ruleId === "competitor-citation").map((v) => [v.sha, v.text])
  const found = findHistoryViolations(commits, { checks: ["surface", "markers"], markers })
  assert.deepEqual(citations(found), expected)
  for (const v of found) assert.ok(!v.text.toLowerCase().includes(w.slice(0, 5)), "a finding printed (part of) a marker's term")
  // A loaded list withholds even when the markers check itself does not run.
  assert.deepEqual(citations(findHistoryViolations(commits, { checks: ["surface"], markers })), expected)

  // Through the CLI, as the PR check runs it (surface and markers together).
  const r = tempRepo()
  try {
    r.write("a.ts", `// ported from ${COMPETITOR} Studio, see ${w} here\n`)
    r.git("add", "-A"); r.git("commit", "-qm", "borrow")
    const run = runMarkerCli(r.dir, `${r.base}..HEAD`, { PRIVATE_LEAK_MARKERS: ` ${w} \n`, HISTORY_CHECKS: "surface,markers" })
    assert.equal(run.status, 1)
    assert.match(run.out, /\[competitor-citation\]/)
    assert.match(run.out, /line withheld: it holds a private marker/)
    assertNoValues(run.out, [w])
  } finally {
    r.done()
  }
})

test("invisibleMarkers names, by number, each marker an invisible character makes dead", () => {
  const [zwsp, wj, bom, nbsp] = [ch(0x200b), ch(0x2060), ch(0xfeff), ch(0xa0)]
  const ok = (s) => `zz-${s}`
  assert.deepEqual(
    invisibleMarkers([
      ok("a"), // #1 fine
      `${ok("b")}\r${ok("c")}`, // #2 an inner carriage return: lone-CR line ends
      `${ok("d")}${zwsp}`, // #3 a zero-width space at the end
      `${wj}${ok("e")}`, // #4 a word joiner at the start
      `${bom}${ok("f")}`, // #5 a byte-order mark inside the list, at a marker's start
      `${ok("g")}${bom}`, // #6 ... or at its end
      `${ok("h")}${zwsp}${ok("i")}`, // #7 fine: a zero-width space inside is part of the marker
      `${ok("j")}${nbsp}`, // #8 fine: a no-break space is whitespace, a boundary
      `\r${ok("k")}`, // #9 a carriage return at the start
    ]),
    [2, 3, 4, 5, 6, 9],
  )
  assert.deepEqual(invisibleMarkers([]), [])
  // The parser hands a lone-CR list over as one marker, which is then refused.
  assert.deepEqual(invisibleMarkers(parseMarkerList(`${ok("x")}\r${ok("y")}\r`)), [1])
})

test("a space-bounded marker never matches inside a longer word, and catches the word on its own", () => {
  const word = fakeWord()
  const list = { PRIVATE_LEAK_MARKERS: ` ${word} \n` }
  const r = tempRepo()
  try {
    r.write("inside.ts", `// x${word}y and ${word}s and snake_${word}_x\n`)
    r.git("add", "-A"); r.git("commit", "-qm", "inside")
    let run = runMarkerCli(r.dir, `${r.base}..HEAD`, list)
    assert.equal(run.status, 0, "the marker matched inside a longer word")
    assert.match(run.out, /History check passed — markers/)

    // At a line's end: no space after it, still the word on its own.
    r.write("spaced.ts", `// the repo is ${word.toUpperCase()}\n`)
    r.git("add", "-A"); r.git("commit", "-qm", "spaced")
    const spaced = r.git("rev-parse", "HEAD").trim()
    run = runMarkerCli(r.dir, `${r.base}..HEAD`, list)
    assert.equal(run.status, 1)
    assert.deepEqual(
      [...run.out.matchAll(/^\s+(\S+) (\S+) \(private marker #(\d+)\)$/gm)].map((m) => m.slice(1)),
      [[spaced, "spaced.ts", "1"]],
    )
    assertNoValues(run.out, [word])
  } finally {
    r.done()
  }
})

test("a list saved with CRLF line ends still matches, from the secret and from .leak-markers", () => {
  const [m1, m2] = [fakeWord(), fakeWord()]
  const crlf = `${m1}\r\n${m2}\r\n`
  const r = tempRepo()
  try {
    r.write("leak.ts", `// ${m2}\n`)
    r.git("add", "-A"); r.git("commit", "-qm", "leak")
    let run = runMarkerCli(r.dir, `${r.base}..HEAD`, { PRIVATE_LEAK_MARKERS: crlf })
    assert.equal(run.status, 1)
    assert.match(run.out, /^\s+\S+ leak\.ts \(private marker #2\)$/m)
    assertNoValues(run.out, [m1, m2])

    r.write(".leak-markers", crlf) // untracked, after the last commit
    run = runMarkerCli(r.dir, `${r.base}..HEAD`)
    assert.equal(run.status, 1)
    assert.match(run.out, /^\s+\S+ leak\.ts \(private marker #2\)$/m)
    assertNoValues(run.out, [m1, m2])
  } finally {
    r.done()
  }
})

test("whitespace-only lines are no markers, and do not shift the numbering", () => {
  const marker = fakeWord()
  const list = { PRIVATE_LEAK_MARKERS: `   \n\t\n \t \r\n\r\n${marker}\n` }
  const r = tempRepo()
  try {
    r.write("a.ts", "// spaced   out\n//\tand  tabbed\t\n")
    r.git("add", "-A"); r.git("commit", "-qm", "spaces")
    let run = runMarkerCli(r.dir, `${r.base}..HEAD`, list)
    assert.equal(run.status, 0, "a whitespace-only line was read as a marker")

    r.write("b.ts", `// ${marker}\n`)
    r.git("add", "-A"); r.git("commit", "-qm", "hit")
    run = runMarkerCli(r.dir, `${r.base}..HEAD`, list)
    assert.equal(run.status, 1)
    assert.match(run.out, /^\s+\S+ b\.ts \(private marker #1\)$/m)
    assertNoValues(run.out, [marker])
  } finally {
    r.done()
  }
})

test("a list with no usable marker is no list: required, it fails; optional, it skips with a note", () => {
  const r = tempRepo()
  try {
    r.write("a.ts", "// spaced   out\n"); r.git("add", "-A"); r.git("commit", "-qm", "spaces")
    for (const list of ["   \n\t\n", "\r\n\r\n", " \r\n\t\r\n", "\n"]) {
      let run = runMarkerCli(r.dir, `${r.base}..HEAD`, { PRIVATE_LEAK_MARKERS: list })
      assert.equal(run.status, 1, `a blank list passed although required: ${JSON.stringify(list)}`)
      assert.match(run.out, /REQUIRED check cannot run — markers: no marker list/)

      run = runMarkerCli(r.dir, `${r.base}..HEAD`, { PRIVATE_LEAK_MARKERS: list, MIRROR_REQUIRE_MARKERS: "" })
      assert.equal(run.status, 0)
      assert.match(run.out, /markers skipped — no marker list/)
    }
    // The same for a blank .leak-markers file with no secret set.
    r.write(".leak-markers", " \r\n\t\r\n")
    const run = runMarkerCli(r.dir, `${r.base}..HEAD`)
    assert.equal(run.status, 1)
    assert.match(run.out, /REQUIRED check cannot run — markers: no marker list/)
  } finally {
    r.done()
  }
})

test("a secret with no usable marker falls back to .leak-markers", () => {
  const marker = fakeWord()
  const r = tempRepo()
  try {
    r.write("c.ts", `// ${marker}\n`); r.git("add", "-A"); r.git("commit", "-qm", "hit")
    r.write(".leak-markers", `${marker}\n`) // untracked, after the last commit
    const run = runMarkerCli(r.dir, `${r.base}..HEAD`, { PRIVATE_LEAK_MARKERS: " \r\n\t\n" })
    assert.equal(run.status, 1)
    assert.match(run.out, /^\s+\S+ c\.ts \(private marker #1\)$/m)
    assertNoValues(run.out, [marker])
  } finally {
    r.done()
  }
})

test("a byte-order mark and repeated carriage returns never make a marker dead", () => {
  const [m1, m2] = [fakeWord(), fakeWord()]
  const r = tempRepo()
  try {
    r.write("one.ts", `// has ${m1} in it\n`)
    r.write("two.ts", `// has ${m2} in it\n`)
    r.git("add", "-A"); r.git("commit", "-qm", "hits")
    const expectBoth = (run) => {
      assert.equal(run.status, 1)
      assert.match(run.out, /^\s+\S+ one\.ts \(private marker #1\)$/m)
      assert.match(run.out, /^\s+\S+ two\.ts \(private marker #2\)$/m)
      assertNoValues(run.out, [m1, m2])
    }
    // A BOM before the first marker, and a CR-CR-LF line end, in the secret...
    expectBoth(runMarkerCli(r.dir, `${r.base}..HEAD`, { PRIVATE_LEAK_MARKERS: `\uFEFF${m1}\n${m2}\r\r\n` }))
    // ...and a Windows editor's save of .leak-markers: BOM + CRLF.
    r.write(".leak-markers", `\uFEFF${m1}\r\n${m2}\r\n`) // untracked, after the last commit
    expectBoth(runMarkerCli(r.dir, `${r.base}..HEAD`))
  } finally {
    r.done()
  }
})

const isRoot = process.getuid?.() === 0

test("a .leak-markers that exists but cannot be read fails, never reads as no list", { skip: isRoot && "root reads any file" }, () => {
  const r = tempRepo()
  try {
    r.write(".leak-markers", `${fakeWord()}\n`)
    chmodSync(join(r.dir, ".leak-markers"), 0o000)
    for (const required of ["1", ""]) {
      const run = runMarkerCli(r.dir, `${r.base}..HEAD`, { MIRROR_REQUIRE_MARKERS: required })
      assert.equal(run.status, 1, `an unreadable list passed (MIRROR_REQUIRE_MARKERS=${JSON.stringify(required)})`)
      assert.match(run.out, /\.leak-markers exists but cannot be read/)
      assert.doesNotMatch(run.out, /no marker list|History check passed/)
    }
  } finally {
    chmodSync(join(r.dir, ".leak-markers"), 0o600)
    r.done()
  }
})
