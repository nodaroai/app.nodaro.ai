// The private-marker gate (scripts/check-private-markers.sh) runs at publish
// time AND on every PR into dev/main. The real list is a repo secret, so these
// tests drive the script with a FAKE list against throwaway repos. They pin:
// a hit fails and prints only `marker #N` plus file paths, never a value; a
// clean tree passes; a required list that is missing fails.
//
// Fake markers are random and built at runtime: they cannot coincide with the
// real list, and none is spelled in this tracked file.
import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO = fileURLToPath(new URL("../..", import.meta.url))
const SCRIPT = join(REPO, "scripts/check-private-markers.sh")
const HISTORY_GATE = join(REPO, "tools/check-history-surface.mjs")
// Every spawn of the history CLI is bounded: spawnSync blocks the event loop,
// so node:test's own timeout cannot stop a matcher that loops, and the job
// would hang instead of naming the failing test.
const HISTORY_TIMEOUT = 30000

const fakeMarker = () => `fake-marker-${randomBytes(6).toString("hex")}`
/** Letters and digits only, so "inside a longer word" means what it says. */
const fakeWord = () => `zq${randomBytes(6).toString("hex")}`

// A real list, a REQUIRE flag or a PR title exported in the shell running the
// tests must not decide the outcome.
const {
  PRIVATE_LEAK_MARKERS: _list,
  MIRROR_REQUIRE_MARKERS: _require,
  HISTORY_CHECKS: _checks,
  PR_TITLE: _title,
  PR_BODY: _body,
  ...BASE_ENV
} = process.env
const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
}

const HEADER = "== private-marker gate (strings that must never appear in a published tree) =="

// git grep reads TRACKED files, so the fixtures are added to the index (forced,
// so a global excludes file cannot silently untrack one).
function withRepo(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "private-markers-"))
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir, env: BASE_ENV })
    track(dir, files)
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function track(dir, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  execFileSync("git", ["add", "-f", "--", ...Object.keys(files)], { cwd: dir, env: BASE_ENV })
}

function runGate(cwd, env = {}) {
  const r = spawnSync("bash", [SCRIPT], { cwd, encoding: "utf8", env: { ...BASE_ENV, ...env } })
  return { status: r.status, out: `${r.stdout}${r.stderr}` }
}

function assertNoValues(out, markers) {
  for (const m of markers) {
    assert.ok(!out.toLowerCase().includes(m.toLowerCase()), "a marker value was printed")
  }
}

test("a hit fails and prints only `marker #N` and the offending paths, never a value", () => {
  const [hit1, miss, hit3] = [fakeMarker(), fakeMarker(), fakeMarker()]
  const files = {
    "clean.txt": "nothing to see\n",
    // Matching is case-insensitive.
    "src/leak.ts": `// ${hit1.toUpperCase()}\n`,
    "docs/notes.md": `see ${hit3}\n`,
    "docs/more.md": `and ${hit3} again\n`,
  }
  withRepo(files, (dir) => {
    const { status, out } = runGate(dir, { PRIVATE_LEAK_MARKERS: `${hit1}\n${miss}\n${hit3}\n` })
    assert.equal(status, 1)
    // Every marker is checked before the abort, each hit under its own number.
    assert.match(out, /^ABORT: private marker #1 found in tracked files:\nsrc\/leak\.ts$/m)
    assert.match(out, /^ABORT: private marker #3 found in tracked files:\ndocs\/more\.md\ndocs\/notes\.md$/m)
    assert.ok(!out.includes("marker #2"))
    assert.ok(!out.includes("clean.txt"))
    assert.ok(!out.includes("clean ("))
    assertNoValues(out, [hit1, miss, hit3])
    const allowed = new Set([HEADER, ...Object.keys(files)])
    for (const line of out.trimEnd().split("\n")) {
      assert.ok(
        allowed.has(line) || /^ABORT: private marker #\d+ found in tracked files:$/.test(line),
        `unexpected output line: ${line}`,
      )
    }
  })
})

test("a clean tree passes, and blank lines in the list are not markers", () => {
  withRepo({ "a.txt": "alpha\n", "src/b.ts": "export const b = 1\n" }, (dir) => {
    const markers = [fakeMarker(), fakeMarker()]
    const { status, out } = runGate(dir, {
      PRIVATE_LEAK_MARKERS: `\n${markers[0]}\n\n${markers[1]}\n\n`,
      MIRROR_REQUIRE_MARKERS: "1",
    })
    assert.equal(status, 0)
    assert.equal(out, `${HEADER}\nclean (2 markers checked)\n`)
  })
})

test("MIRROR_REQUIRE_MARKERS=1 with no list fails, whether the list is unset or empty", () => {
  withRepo({ "a.txt": "alpha\n" }, (dir) => {
    for (const env of [{ MIRROR_REQUIRE_MARKERS: "1" }, { MIRROR_REQUIRE_MARKERS: "1", PRIVATE_LEAK_MARKERS: "" }]) {
      const { status, out } = runGate(dir, env)
      assert.equal(status, 1)
      assert.match(out, /^ABORT: MIRROR_REQUIRE_MARKERS=1 but no marker list/m)
    }
  })
})

test("with no list and no requirement, the gate skips with a note", () => {
  withRepo({ "a.txt": "alpha\n" }, (dir) => {
    const { status, out } = runGate(dir)
    assert.equal(status, 0)
    assert.match(out, /^\(no marker list — set PRIVATE_LEAK_MARKERS or \.leak-markers/m)
  })
})

test("a local .leak-markers file is the fallback list, and never trips on itself", () => {
  const marker = fakeMarker()
  withRepo({ "a.txt": "alpha\n" }, (dir) => {
    writeFileSync(join(dir, ".leak-markers"), `${marker}\n`) // untracked, as in a real checkout
    let r = runGate(dir, { MIRROR_REQUIRE_MARKERS: "1" })
    assert.equal(r.status, 0)
    assert.match(r.out, /^clean \(1 markers checked\)$/m)

    track(dir, { "src/c.ts": `// ${marker}\n` })
    r = runGate(dir, { MIRROR_REQUIRE_MARKERS: "1" })
    assert.equal(r.status, 1)
    assert.match(r.out, /^ABORT: private marker #1 found in tracked files:\nsrc\/c\.ts$/m)
    assertNoValues(r.out, [marker])
  })
})

// The list is read line by line, exactly as written: whitespace around a marker
// is kept, a leading BOM and every trailing \r are dropped, and an empty or
// whitespace-only line is no marker. tools/check-history-surface.mjs reads it
// by the same rule, so both gates number the markers alike. Matching differs on
// purpose: this gate matches a marker literally; the history gate reads its
// edge whitespace as a word boundary, which catches every line this gate does
// and more (the last test below runs both on one list and pins each).

test("the tree gate matches a space-bounded marker exactly: never inside a longer word, nor without its spaces", () => {
  const word = fakeWord()
  const env = { PRIVATE_LEAK_MARKERS: ` ${word} \n`, MIRROR_REQUIRE_MARKERS: "1" }
  withRepo({ "inside.txt": `x${word}y and ${word}s, then ${word}\n` }, (dir) => {
    let r = runGate(dir, env)
    assert.equal(r.status, 0, "the marker matched inside a longer word, or at a line's end")
    assert.equal(r.out, `${HEADER}\nclean (1 markers checked)\n`)

    track(dir, { "spaced.txt": `see ${word.toUpperCase()} here\n` })
    r = runGate(dir, env)
    assert.equal(r.status, 1)
    assert.match(r.out, /^ABORT: private marker #1 found in tracked files:\nspaced\.txt$/m)
    assert.ok(!r.out.includes("inside.txt"))
    assertNoValues(r.out, [word])
  })
})

test("a list saved with CRLF line ends still matches, from the secret and from .leak-markers", () => {
  const [m1, m2] = [fakeMarker(), fakeMarker()]
  const crlf = `${m1}\r\n${m2}\r\n`
  withRepo({ "src/leak.ts": `// ${m2}\n`, "clean.txt": "nothing\n" }, (dir) => {
    let r = runGate(dir, { PRIVATE_LEAK_MARKERS: crlf, MIRROR_REQUIRE_MARKERS: "1" })
    assert.equal(r.status, 1, "a trailing \\r made the marker match nothing")
    assert.match(r.out, /^ABORT: private marker #2 found in tracked files:\nsrc\/leak\.ts$/m)
    assertNoValues(r.out, [m1, m2])

    writeFileSync(join(dir, ".leak-markers"), crlf)
    r = runGate(dir, { MIRROR_REQUIRE_MARKERS: "1" })
    assert.equal(r.status, 1)
    assert.match(r.out, /^ABORT: private marker #2 found in tracked files:\nsrc\/leak\.ts$/m)
    assertNoValues(r.out, [m1, m2])
  })
})

test("a byte-order mark and repeated carriage returns never make a marker dead", () => {
  const [m1, m2] = [fakeMarker(), fakeMarker()]
  withRepo({ "one.txt": `has ${m1} in it\n`, "two.txt": `has ${m2} in it\n` }, (dir) => {
    const expectBoth = (r) => {
      assert.equal(r.status, 1, "a save artifact left a marker that matches nothing")
      assert.match(r.out, /^ABORT: private marker #1 found in tracked files:\none\.txt$/m)
      assert.match(r.out, /^ABORT: private marker #2 found in tracked files:\ntwo\.txt$/m)
      assertNoValues(r.out, [m1, m2])
    }
    // A BOM before the first marker, and a CR-CR-LF line end, in the secret...
    expectBoth(runGate(dir, { PRIVATE_LEAK_MARKERS: `\uFEFF${m1}\n${m2}\r\r\n`, MIRROR_REQUIRE_MARKERS: "1" }))
    // ...and a Windows editor's save of .leak-markers: BOM + CRLF.
    writeFileSync(join(dir, ".leak-markers"), `\uFEFF${m1}\r\n${m2}\r\n`)
    expectBoth(runGate(dir, { MIRROR_REQUIRE_MARKERS: "1" }))
  })
})

const isRoot = process.getuid?.() === 0

test("a .leak-markers that exists but cannot be read aborts, never reads as no list", { skip: isRoot && "root reads any file" }, () => {
  withRepo({ "a.txt": "alpha\n" }, (dir) => {
    const file = join(dir, ".leak-markers")
    writeFileSync(file, `${fakeMarker()}\n`)
    chmodSync(file, 0o000)
    try {
      for (const required of ["1", ""]) {
        const r = runGate(dir, { MIRROR_REQUIRE_MARKERS: required })
        assert.equal(r.status, 1, `an unreadable list passed (MIRROR_REQUIRE_MARKERS=${JSON.stringify(required)})`)
        assert.match(r.out, /^ABORT: \.leak-markers exists but cannot be read\.$/m)
        assert.doesNotMatch(r.out, /no marker list|markers checked/)
      }
    } finally {
      chmodSync(file, 0o600)
    }
  })
})

test("whitespace-only lines are no markers, and do not shift the numbering", () => {
  const marker = fakeMarker()
  const env = { PRIVATE_LEAK_MARKERS: `   \n\t\n \t \r\n\r\n${marker}\n`, MIRROR_REQUIRE_MARKERS: "1" }
  withRepo({ "a.txt": "spaced   out\n\tand  tabbed\t\n" }, (dir) => {
    let r = runGate(dir, env)
    assert.equal(r.status, 0, "a whitespace-only line was grepped as a marker")
    assert.equal(r.out, `${HEADER}\nclean (1 markers checked)\n`)

    track(dir, { "b.txt": `${marker}\n` })
    r = runGate(dir, env)
    assert.equal(r.status, 1)
    assert.match(r.out, /^ABORT: private marker #1 found in tracked files:\nb\.txt$/m)
    assertNoValues(r.out, [marker])
  })
})

/** Lists that hold no marker at all: each is no list. */
const NO_MARKER_LISTS = ["   \n\t\n", "\r\n\r\n", " \r\n\t\r\n", "\n"]

test("a list with no usable marker is no list: required, it aborts; optional, it skips with a note", () => {
  withRepo({ "a.txt": "spaced   out\n\tand  tabbed\t\n" }, (dir) => {
    for (const list of NO_MARKER_LISTS) {
      let r = runGate(dir, { PRIVATE_LEAK_MARKERS: list, MIRROR_REQUIRE_MARKERS: "1" })
      assert.equal(r.status, 1, `a blank list passed although required: ${JSON.stringify(list)}`)
      assert.match(r.out, /^ABORT: MIRROR_REQUIRE_MARKERS=1 but no marker list/m)
      assert.doesNotMatch(r.out, /markers checked/)

      r = runGate(dir, { PRIVATE_LEAK_MARKERS: list })
      assert.equal(r.status, 0)
      assert.match(r.out, /^\(no marker list — set PRIVATE_LEAK_MARKERS or \.leak-markers/m)
    }
    // The same for a blank .leak-markers file with no secret set.
    writeFileSync(join(dir, ".leak-markers"), " \r\n\t\r\n")
    const r = runGate(dir, { MIRROR_REQUIRE_MARKERS: "1" })
    assert.equal(r.status, 1)
    assert.match(r.out, /^ABORT: MIRROR_REQUIRE_MARKERS=1 but no marker list/m)
  })
})

test("a secret with no usable marker falls back to .leak-markers", () => {
  const marker = fakeMarker()
  withRepo({ "src/c.ts": `// ${marker}\n` }, (dir) => {
    writeFileSync(join(dir, ".leak-markers"), `${marker}\n`)
    const r = runGate(dir, { PRIVATE_LEAK_MARKERS: " \r\n\t\n", MIRROR_REQUIRE_MARKERS: "1" })
    assert.equal(r.status, 1)
    assert.match(r.out, /^ABORT: private marker #1 found in tracked files:\nsrc\/c\.ts$/m)
    assertNoValues(r.out, [marker])
  })
})

test("both gates treat a list with no usable marker as no list", () => {
  withRepo({ "seed.txt": "seed\n" }, (dir) => {
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "seed"], {
      cwd: dir,
      env: { ...BASE_ENV, ...GIT_IDENTITY },
    })
    const history = (env) =>
      spawnSync("node", [HISTORY_GATE, "HEAD"], {
        cwd: dir,
        encoding: "utf8",
        timeout: HISTORY_TIMEOUT,
        env: { ...BASE_ENV, ...env, HISTORY_CHECKS: "markers" },
      }).status
    for (const list of NO_MARKER_LISTS) {
      const required = { PRIVATE_LEAK_MARKERS: list, MIRROR_REQUIRE_MARKERS: "1" }
      assert.deepEqual([runGate(dir, required).status, history(required)], [1, 1], JSON.stringify(list))
      const optional = { PRIVATE_LEAK_MARKERS: list }
      assert.deepEqual([runGate(dir, optional).status, history(optional)], [0, 0], JSON.stringify(list))
    }
  })
})

test("one list through both gates: the same numbers, and the history gate catches every tree hit and more", () => {
  const [a, b, c, r] = [fakeWord(), fakeWord(), fakeWord(), fakeWord()]
  const plain = fakeMarker()
  const unused = fakeMarker()
  const nbsp = String.fromCharCode(0xa0)
  const bom = String.fromCharCode(0xfeff)
  // A Windows editor's save: a BOM, CRLF line ends (one CR-CR-LF), blank and
  // whitespace-only lines. #1 plain, #2 " a ", #3 "(b ", #4 c + no-break space,
  // #5 unused, #6 "r " and #7 "r." (one line, two markers), #8 a lone no-break space.
  const list =
    `${bom}${plain}\r\n  \r\n ${a} \r\n\t\r\n(${b} \r\r\n${c}${nbsp}\r\n\r\n${unused}\r\n` +
    `${r} \r\n${r}.\r\n${nbsp}\r\n`
  const env = { PRIVATE_LEAK_MARKERS: list, MIRROR_REQUIRE_MARKERS: "1" }
  withRepo({ "seed.txt": "seed\n" }, (dir) => {
    const git = (...args) =>
      execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
        cwd: dir,
        encoding: "utf8",
        env: { ...BASE_ENV, ...GIT_IDENTITY },
      })
    git("commit", "-qm", "seed")
    const base = git("rev-parse", "HEAD").trim()
    // One commit, so the history gate's per-commit report reads like the tree's.
    // One marker form per file, so each file names exactly what caught it.
    track(dir, {
      "src/plain.ts": `// ${plain.toUpperCase()}\n`, // no edge whitespace: a substring in both
      "a-spaced.txt": `see ${a} here\n`, // the marker as written: both gates
      "a-period.txt": `see ${a}.\n`, // from here to a-url: the history gate only
      "a-start.txt": `${a} is here\n`,
      "a-end.txt": `the repo is ${a}\n`,
      "a-url.txt": `https://github.com/org/${a}.git\n`,
      "a-inside.txt": `x${a}y and ${a}s and snake_${a}_x\n`, // inside longer words: neither
      "b-space.txt": `(${b} x\n`, // as written: both
      "b-comma.txt": `(${b.toUpperCase()}, ok\n`, // from here to b-end: the history gate only
      "b-paren.txt": `(${b})\n`,
      "b-end.txt": `see (${b}\n`,
      "b-inside.txt": `(${b}ly\n`, // neither
      "c-nbsp.txt": `has ${c}${nbsp}here\n`, // as written: both (and #8, its lone no-break space)
      "c-space.txt": `has ${c} in it\n`, // the history gate only
      "c-inside.txt": `${c}x\n`, // neither
      "r-both.txt": `see ${r}.\n`, // "r." as written: both; "r " as a boundary: the history gate too
      "spaces.txt": "spaced   out\tand\ttabbed\n", // whitespace-only lines are no markers: neither
    })
    // Messages are the history gate's alone: a wrapped body line and the PR title.
    git("commit", "-qm", "add files", "-m", `A wrapped line that ends on the\n${a}. It goes on.`)

    const tree = runGate(dir, env)
    const history = spawnSync("node", [HISTORY_GATE, `${base}..HEAD`], {
      cwd: dir,
      encoding: "utf8",
      timeout: HISTORY_TIMEOUT,
      env: { ...BASE_ENV, ...env, HISTORY_CHECKS: "markers", PR_TITLE: `feat: the (${b}) look` },
    })
    const historyOut = `${history.stdout}${history.stderr}`

    // The tree gate: `ABORT: private marker #N …` and then the files it names.
    const treeHits = []
    let n = null
    for (const line of tree.out.split("\n")) {
      const m = line.match(/^ABORT: private marker #(\d+) found in tracked files:$/)
      if (m) n = Number(m[1])
      else if (n !== null && line) treeHits.push(`#${n} ${line}`)
    }
    // The history gate: `<sha> <file> (private marker #N)` per finding; the PR
    // title's sha is PR-title, a commit message's file is :message.
    const historyHits = [...historyOut.matchAll(/^\s+(\S+) (\S+) \(private marker #(\d+)\)$/gm)].map(
      ([, sha, file, num]) => `#${num} ${sha === "PR-title" ? sha : file}`,
    )

    const both = ["#1 src/plain.ts", "#2 a-spaced.txt", "#3 b-space.txt", "#4 c-nbsp.txt", "#7 r-both.txt", "#8 c-nbsp.txt"]
    const historyOnly = [
      "#2 a-period.txt", "#2 a-start.txt", "#2 a-end.txt", "#2 a-url.txt", "#2 :message",
      "#3 b-comma.txt", "#3 b-paren.txt", "#3 b-end.txt", "#3 PR-title",
      "#4 c-space.txt",
      "#6 r-both.txt", // every marker on a line is reported, as the tree gate does
    ]
    assert.equal(tree.status, 1)
    assert.equal(history.status, 1)
    assert.deepEqual(treeHits.sort(), [...both].sort())
    assert.deepEqual(historyHits.sort(), [...both, ...historyOnly].sort())
    for (const hit of treeHits) assert.ok(historyHits.includes(hit), `the history gate missed a tree hit: ${hit}`)
    assertNoValues(`${tree.out}${historyOut}`, [a, b, c, r, plain, unused])
  })
})

test("both gates refuse, by number only, a list or a marker that can never match", () => {
  const [m1, m2, m3] = [fakeMarker(), fakeMarker(), fakeMarker()]
  const ch = (code) => String.fromCharCode(code)
  const [zwsp, wj, bom, nul] = [ch(0x200b), ch(0x2060), ch(0xfeff), ch(0)]
  const bytes = (...parts) => Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p) : Buffer.from(p))))
  // [what, how the list arrives, what both gates must say: dead marker numbers, or a list-level refusal]
  const cases = [
    ["lone-CR line ends (one dead marker)", { env: `${m1}\r${m2}\r` }, [1]],
    ["a carriage return inside #2", { env: `${m1}\n${m2}\r${m3}\n` }, [2]],
    ["a zero-width space ending #2, a word joiner starting #3", { env: `${m1}\n${m2}${zwsp}\n${wj}${m3}\n` }, [2, 3]],
    ["a zero-width space starting #1, a word joiner ending #2", { env: `${zwsp}${m1}\n${m2}${wj}\n` }, [1, 2]],
    ["a byte-order mark starting line 2", { env: `${m1}\n${bom}${m2}\n` }, [2]],
    ["a byte-order mark ending #1, in .leak-markers", { file: `${m1}${bom}\r\n${m2}\r\n` }, [1]],
    ["a NUL byte in .leak-markers", { file: `${m1}\n${nul}${m2}\n` }, "not-text"],
    ["a UTF-16LE .leak-markers (PowerShell's default)", { file: bytes([0xff, 0xfe], Buffer.from(`${m1}\r\n${m2}\r\n`, "utf16le")) }, "not-text"],
    ["a UTF-16 byte-order mark and no NUL, in .leak-markers", { file: bytes([0xfe, 0xff], `${m1}\n`) }, "not-text"],
    ["a UTF-16 byte-order mark in the secret", { envBytes: bytes([0xff, 0xfe], `${m1}\n${m2}\n`) }, "not-text"],
    [".leak-markers is a directory", { dir: true }, "unreadable"],
  ]
  withRepo({ "seed.txt": "seed\n" }, (dir) => {
    const git = (...args) =>
      execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8", env: { ...BASE_ENV, ...GIT_IDENTITY } })
    git("commit", "-qm", "seed")
    const base = git("rev-parse", "HEAD").trim()
    // Every marker would hit, were the list read: a refusal is the only way to pass none.
    track(dir, { "a.txt": `has ${m1} and ${m2} and ${m3}\n` })
    git("commit", "-qm", "hits")
    const listFile = join(mkdtempSync(join(tmpdir(), "marker-bytes-")), "list")
    try {
      for (const [what, source, expected] of cases) {
        rmSync(join(dir, ".leak-markers"), { recursive: true, force: true })
        if (source.file !== undefined) writeFileSync(join(dir, ".leak-markers"), source.file)
        if (source.dir) mkdirSync(join(dir, ".leak-markers"))
        if (source.envBytes) writeFileSync(listFile, source.envBytes)
        // Not required: each refusal must fire although no list is demanded.
        const env = { ...BASE_ENV, ...(source.env !== undefined ? { PRIVATE_LEAK_MARKERS: source.env } : {}) }
        // Raw bytes reach the environment only through a shell (Node re-encodes env strings as UTF-8).
        const run = (cmd, ...args) => {
          const r = source.envBytes
            ? spawnSync("bash", ["-c", 'export PRIVATE_LEAK_MARKERS="$(cat "$1")"; shift; exec "$@"', "_", listFile, cmd, ...args], { cwd: dir, encoding: "utf8", timeout: HISTORY_TIMEOUT, env })
            : spawnSync(cmd, args, { cwd: dir, encoding: "utf8", timeout: HISTORY_TIMEOUT, env })
          return { status: r.status, out: `${r.stdout}${r.stderr}` }
        }
        const tree = run("bash", SCRIPT)
        const history = run("node", HISTORY_GATE, `${base}..HEAD`)
        for (const [gate, r] of [["tree", tree], ["history", history]]) {
          assert.equal(r.status, 1, `${gate} gate, ${what}: passed`)
          assert.doesNotMatch(r.out, /found in tracked files|\(private marker #\d+\)$|markers checked|History check passed/m, `${gate} gate, ${what}: scanned anyway`)
          if (expected === "not-text") assert.match(r.out, /ABORT: the private marker list is not UTF-8 text/, `${gate} gate, ${what}`)
          else if (expected === "unreadable") assert.match(r.out, /ABORT: \.leak-markers exists but cannot be read/, `${gate} gate, ${what}`)
          else {
            const dead = [...r.out.matchAll(/ABORT: private marker #(\d+) holds an invisible character/g)].map((m) => Number(m[1]))
            assert.deepEqual(dead, expected, `${gate} gate, ${what}`)
          }
          assertNoValues(r.out, [m1, m2, m3])
        }
      }
    } finally {
      rmSync(dirname(listFile), { recursive: true, force: true })
    }
  })
})

test("a git grep that fails, rather than finds nothing, aborts by marker number; git's message is never shown", () => {
  const marker = fakeMarker()
  const realGit = spawnSync("bash", ["-c", "command -v git"], { encoding: "utf8", env: BASE_ENV }).stdout.trim()
  const bin = mkdtempSync(join(tmpdir(), "fake-git-"))
  try {
    // Every git call passes through, except grep: it fails as git does, quoting its pattern.
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nif [ "$1" = grep ]; then echo "fatal: cannot grep: $*" >&2; exit 128; fi\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 },
    )
    withRepo({ "a.txt": `has ${marker}\n` }, (dir) => {
      const r = runGate(dir, { PRIVATE_LEAK_MARKERS: `${marker}\n`, MIRROR_REQUIRE_MARKERS: "1", PATH: `${bin}:${BASE_ENV.PATH}` })
      assert.equal(r.status, 1, "a git grep error read as no match")
      assert.match(r.out, /^ABORT: private marker #1 could not be checked \(git grep failed with exit 128\)\.$/m)
      assert.doesNotMatch(r.out, /markers checked|fatal/)
      assertNoValues(r.out, [marker])
    })
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
})

test("run from a subdirectory, the gate still scans the whole checkout", () => {
  const marker = fakeMarker()
  withRepo({ "docs/x.md": `${marker}\n`, "src/y.ts": "ok\n" }, (dir) => {
    const { status, out } = runGate(join(dir, "src"), { PRIVATE_LEAK_MARKERS: marker })
    assert.equal(status, 1)
    assert.match(out, /^docs\/x\.md$/m)
  })
})

test("the publish path and the PR check run this one script", () => {
  const publish = readFileSync(join(REPO, "scripts/publish-to-public.sh"), "utf8")
  assert.match(publish, /check-private-markers\.sh/)
  assert.ok(!publish.includes("git grep -I -l -i -F"), "publish-to-public.sh re-implements the gate")

  const workflow = readFileSync(join(REPO, ".github/workflows/private-marker-check.yml"), "utf8")
  // The PR check runs the BASE branch's copy of the gate (a branch cut before
  // the gate existed has none, and a PR must not edit the check it is judged
  // by), from the PR checkout's root, so it scans the PR's tracked files.
  assert.match(workflow, /gate=\.gate-base\/scripts\/check-private-markers\.sh/)
  assert.match(workflow, /ref: \$\{\{ github\.base_ref \|\| github\.ref_name \}\}\s*\n\s*path: \.gate-base/)
  assert.ok(!/run: bash scripts\/check-private-markers\.sh/.test(workflow), "the PR check runs the PR's own copy of the gate")
  assert.match(workflow, /PRIVATE_LEAK_MARKERS: \$\{\{ secrets\.PRIVATE_LEAK_MARKERS \}\}/)
  assert.match(workflow, /MIRROR_REQUIRE_MARKERS: "1"/)
})

test("the PR check runs the base branch's gate, and the PR's own copy only while the base has none", () => {
  const workflow = readFileSync(join(REPO, ".github/workflows/private-marker-check.yml"), "utf8")
  // The check step's shell, exactly as the workflow runs it.
  const m = workflow.match(/Check tracked files for private markers[\s\S]*?run: \|\n((?: {10}.*\n?)+)/)
  assert.ok(m, "could not find the check step's run block")
  const script = m[1].split("\n").map((l) => l.slice(10)).join("\n")
  const dir = mkdtempSync(join(tmpdir(), "marker-gate-step-"))
  try {
    mkdirSync(join(dir, "scripts"), { recursive: true })
    mkdirSync(join(dir, ".gate-base", "scripts"), { recursive: true })
    writeFileSync(join(dir, "scripts", "check-private-markers.sh"), "echo ran-pr-copy\n")
    writeFileSync(join(dir, ".gate-base", "scripts", "check-private-markers.sh"), "echo ran-base-copy\n")
    writeFileSync(join(dir, "step.sh"), script)
    const both = spawnSync("bash", ["step.sh"], { cwd: dir, encoding: "utf8" })
    assert.equal(both.status, 0)
    assert.match(both.stdout, /ran-base-copy/)
    assert.doesNotMatch(both.stdout, /ran-pr-copy/, "the PR's copy ran although the base has one")

    rmSync(join(dir, ".gate-base"), { recursive: true, force: true })
    const bootstrap = spawnSync("bash", ["step.sh"], { cwd: dir, encoding: "utf8" })
    assert.equal(bootstrap.status, 0)
    assert.match(bootstrap.stdout, /ran-pr-copy/)
    assert.match(bootstrap.stdout, /no copy of the gate yet/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test(".leak-markers is gitignored, so the list can never be committed", () => {
  const r = spawnSync("git", ["check-ignore", "-q", ".leak-markers"], { cwd: REPO, env: BASE_ENV })
  assert.equal(r.status, 0, ".leak-markers is not ignored (or is tracked)")
})
