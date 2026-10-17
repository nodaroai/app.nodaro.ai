// @test-watches backend/src/**/*.ts .github/workflows/ci.yml
/**
 * Cross-tree tests declare what they read in the other tree.
 *
 * Type Check re-runs every backend test that names a frontend path (ci.yml's
 * `cross_tree_parity()` finds them with a grep, so a frontend-only PR, which
 * skips Backend Tests, still runs them). Test selection, though, runs a test
 * only when a change reaches it: through an import, or through the files its
 * `// @test-watches` names. A cross-tree test that reads frontend files at run
 * time and declares nothing runs on every change (the safe default), and one
 * that declares watches missing the frontend files it reads would silently
 * skip the changes that can break it.
 *
 * So every test the parity grep discovers — found here by running that very
 * grep, read out of ci.yml, never a hand-list — that reads files at run time
 * (itself or through a test helper it imports) declares `@test-always`, or
 * `@test-watches` globs covering every frontend path it names in code: string
 * literals, and `join(…, "<front-end dir>", "src", …)` segment runs. A new
 * cross-tree reader fails here until it declares them. Comments are prose and
 * name nothing.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, posix } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { isScanner, parseAnnotations } from "../../../tools/test-select/annotations.mjs"
import { matchesAny } from "../../../tools/test-select/glob.mjs"
import { isTestSideHelper } from "../../../tools/test-select/test-node.mjs"

const REPO = join(__dirname, "..", "..", "..")
// Spelled in two parts so this file names no path of the other tree itself.
const TREE = ["front", "end"].join("")

/** The parity run's discovery, as ci.yml runs it: the directory it `cd`s into and its grep. */
function parityDiscovery(ciYml: string): { cwd: string; grep: string } | null {
  const fn = ciYml.match(/cross_tree_parity\(\)\s*\{([\s\S]*?)\n\s*\}/)?.[1]
  if (!fn || !/npx vitest run[^\n]*"\$\{files\[@\]\}"/.test(fn)) return null
  const cwd = fn.match(/^\s*cd (\S+)\s*$/m)?.[1]
  const grep = fn.match(/grep -rl [^\n|)]*/)?.[0]?.trim()
  return cwd && grep ? { cwd, grep } : null
}

/** One path of the other tree a test names: a file, or a directory / dynamic prefix it reads under. */
type NamedPath = { path: string; under: boolean; ext: string | null }

const DYNAMIC = "\u0000"
const PATH_CHARS = String.raw`[\w./@()\[\]-]`
const PATH_FNS = new Set(["join", "resolve"])

/**
 * The paths of the other tree a source names in code, repo-relative. Each
 * string expression is evaluated as far as the source allows: literals,
 * templates (a substitution of a known constant is inlined, any other one is
 * dynamic), `join(…)` / `resolve(…)` argument chains, and identifiers bound by
 * `const X = <such an expression>`. A path that continues past a dynamic part
 * (`join(FE, "src", "lib", name)`, `${dir}/${locale}.ts`) is a prefix the test
 * reads under. A constant that is only ever composed into longer paths is not
 * named itself — the paths built from it are. Parsed with the TypeScript
 * compiler, so comments, regex literals and nested templates never confuse it.
 */
function namedPaths(source: string): NamedPath[] {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true)
  const consts = new Map<string, ts.Expression>()
  const composed = new Set<ts.Node>() // nodes that are a part of a longer path expression
  const isPathCall = (n: ts.Node): n is ts.CallExpression => ts.isCallExpression(n)
    && (ts.isIdentifier(n.expression) ? PATH_FNS.has(n.expression.text)
      : ts.isPropertyAccessExpression(n.expression) && PATH_FNS.has(n.expression.name.text))
  const collect = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
      && ts.isVariableDeclarationList(n.parent) && (n.parent.flags & ts.NodeFlags.Const)) consts.set(n.name.text, n.initializer)
    if (isPathCall(n)) n.arguments.forEach((a) => composed.add(a))
    if (ts.isTemplateExpression(n)) n.templateSpans.forEach((sp) => composed.add(sp.expression))
    ts.forEachChild(n, collect)
  }
  collect(sf)
  // An identifier used anywhere but inside a longer path expression is a use of its own.
  const usedAlone = new Set<string>()
  const uses = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && consts.has(n.text) && !composed.has(n)
      && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n)) usedAlone.add(n.text)
    ts.forEachChild(n, uses)
  }
  uses(sf)
  const evaluate = (n: ts.Expression, depth = 0): string | null => {
    if (depth > 8) return null
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text
    if (ts.isParenthesizedExpression(n)) return evaluate(n.expression, depth + 1)
    if (ts.isTemplateExpression(n)) {
      return n.head.text + n.templateSpans.map((sp) => (evaluate(sp.expression, depth + 1) ?? DYNAMIC) + sp.literal.text).join("")
    }
    if (ts.isIdentifier(n)) { const init = consts.get(n.text); return init ? evaluate(init, depth + 1) : null }
    if (isPathCall(n)) return n.arguments.map((a) => evaluate(a, depth + 1) ?? DYNAMIC).join("/")
    return null
  }
  const found: NamedPath[] = []
  // `<tree>/…` anywhere; the bare `<tree>` only as a whole path segment a
  // composition ended on (`join(REPO, "<tree>")`, `${REPO}/<tree>`) — never prose.
  const extract = (text: string, composedText: boolean) => {
    const re = new RegExp(`(?:^|[^\\w.-])(${TREE}/${PATH_CHARS}*)${composedText ? `|(?:^|/)(${TREE})(?=$|${DYNAMIC})` : ""}`, "g")
    for (const raw of text.matchAll(re)) {
      const m = [raw[0], raw[1] ?? raw[2]] as const
      const after = text.slice(raw.index! + raw[0].length)
      let path = posix.normalize(m[1]!).replace(/[.,:;]+$/, "")
      if (after.startsWith(DYNAMIC)) {
        // continues past a dynamic part: the directory it reads under
        if (!m[1]!.endsWith("/")) path = posix.dirname(path)
        const ext = after.match(/\.([a-z0-9]+)$/)?.[1] ?? null
        found.push({ path: path.replace(/\/+$/, ""), under: true, ext })
      } else found.push({ path: path.replace(/\/+$/, ""), under: false, ext: null })
    }
  }
  const visit = (n: ts.Node): void => {
    const expr = ts.isExpression(n) && !composed.has(n)
      && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n) || isPathCall(n))
    if (expr) {
      const text = evaluate(n as ts.Expression)
      if (text !== null) extract(text, !ts.isStringLiteral(n) && !ts.isNoSubstitutionTemplateLiteral(n))
    }
    if (ts.isIdentifier(n) && usedAlone.has(n.text) && !composed.has(n)) {
      const text = evaluate(n)
      if (text !== null) extract(text, true)
    }
    // a constant's own initializer is named through its uses
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && consts.get(n.name.text) === n.initializer) {
      n.initializer && composed.add(n.initializer)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  const byKey = new Map<string, NamedPath>()
  for (const f of found) if (f.path) byKey.set(`${f.path}\0${f.under}\0${f.ext}`, f)
  return [...byKey.values()].sort((a, b) => a.path.localeCompare(b.path) || Number(a.under) - Number(b.under))
}

// What a test that reads under a directory could read there next: a file of
// the extension it builds, else one of the usual kinds.
const PROBE_EXTS = ["ts", "tsx", "js", "mjs", "json", "md", "sql", "html", "css"]
const probesUnder = (dir: string, ext: string | null) => (ext ? [ext] : PROBE_EXTS)
  .flatMap((e) => [`${dir}/__probe__.${e}`, `${dir}/__probe__/__probe__.${e}`])

/**
 * A named file is covered when a watch matches it (a path that does not exist
 * yet included). A named directory — or a prefix the test reads under — is
 * covered only when a watch matches a NEW file there (a probe), so a watch on
 * one unrelated file in it never passes for a walk of all of it.
 */
function uncoveredPaths(source: string, watches: readonly string[], tracked: readonly string[]): string[] {
  const isDir = (p: string) => tracked.some((t) => t.startsWith(`${p}/`)) && !tracked.includes(p)
  return namedPaths(source).filter(({ path, under, ext }) => {
    if (!under && !isDir(path)) return !matchesAny(path, watches)
    return !probesUnder(path, ext).some((probe) => matchesAny(probe, watches))
  }).map(({ path, under }) => (under ? `${path}/…` : path))
    .filter((p, i, all) => all.indexOf(p) === i)
}

const LOCAL_IMPORT = /(?:\bfrom|\bimport|\brequire|\bimportActual|\bimportMock)\s*(?:<[^>]*>)?\s*\(?\s*(["'])((?:\.{1,2}|@)\/[^"']+)\1/g

/** The test-side helpers a file reaches through relative or `@/` (backend/src) imports, transitively. */
function helpersOf(file: string, read: (p: string) => string | null, seen = new Set<string>()): string[] {
  const source = read(file)
  if (source === null) return []
  for (const m of source.matchAll(LOCAL_IMPORT)) {
    const spec = m[2]!
    const base = (spec.startsWith("@/") ? posix.join("backend/src", spec.slice(2))
      : posix.normalize(posix.join(posix.dirname(file), spec))).replace(/\.[cm]?js$/, "")
    const target = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base].find((c) => read(c) !== null)
    if (!target || seen.has(target) || !isTestSideHelper(target)) continue
    seen.add(target)
    helpersOf(target, read, seen)
  }
  return [...seen]
}

/** Every problem of one discovered test, or [] when it is fine. */
function crossTreeProblems(file: string, read: (p: string) => string | null, tracked: readonly string[]): string[] {
  const source = read(file) ?? ""
  const helpers = helpersOf(file, read)
  const readsFiles = isScanner(source) || helpers.some((h) => isScanner(read(h) ?? ""))
  if (!readsFiles) return []
  const own = parseAnnotations(source)
  if (own.always) return []
  const watches = [...own.watches, ...helpers.flatMap((h) => parseAnnotations(read(h) ?? "").watches)]
  if (watches.length === 0 && !own.readsNone) return [`${file}: reads files at run time and declares no @test-watches (nor @test-always)`]
  return uncoveredPaths(source, watches, tracked).map((p) => `${file}: names ${p}, which no @test-watches glob covers`)
}

const readRepo = (p: string): string | null => {
  const abs = join(REPO, p)
  return existsSync(abs) ? readFileSync(abs, "utf8") : null
}

describe("cross-tree tests declare what they read", () => {
  const ciYml = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8")
  const discovery = parityDiscovery(ciYml)

  it("ci.yml still discovers the parity tests with a grep", () => {
    expect(discovery, "cross_tree_parity() or its grep moved — update parityDiscovery, do not delete this guard").not.toBeNull()
  })

  it("every discovered test that reads files declares @test-watches covering the other tree's paths it names, or @test-always", () => {
    const cwd = join(REPO, discovery!.cwd)
    const found = execFileSync("bash", ["-c", `${discovery!.grep} | sort`], { cwd, encoding: "utf8" })
      .split("\n").filter(Boolean).map((f) => posix.join(discovery!.cwd, f))
    expect(found.length, "the parity grep matched nothing — the detector or the tree layout changed").toBeGreaterThan(0)
    const tracked = execFileSync("git", ["ls-files", TREE], { cwd: REPO, encoding: "utf8", maxBuffer: 64 << 20 }).split("\n").filter(Boolean)
    const problems = found.flatMap((f) => crossTreeProblems(f, readRepo, tracked))
    expect(problems, "Declare what these tests read (`// @test-watches <glob>…`, tools/test-select/README.md): test selection runs a cross-tree test only when a change reaches it.").toEqual([])
  }, 60_000)
})

describe("the guard's own rules", () => {
  const fe = (rest: string) => `${TREE}/${rest}`
  const tracked = [fe("src/x.ts"), fe("src/lib/a.ts"), fe("src/lib/b.tsx"), fe("index.html")]
  const files = (map: Record<string, string>) => (p: string) => map[p] ?? null

  it("fails a test that reads a frontend file with no watch, and passes it once watched", () => {
    const src = `import { readFileSync } from "node:fs"\nreadFileSync(join(root, "${fe("src/x.ts")}"))\n`
    expect(crossTreeProblems("backend/src/a.test.ts", files({ "backend/src/a.test.ts": src }), tracked)).toEqual([
      "backend/src/a.test.ts: reads files at run time and declares no @test-watches (nor @test-always)",
    ])
    const narrow = `// @test-watches ${fe("src/lib/*.ts")}\n${src}`
    expect(crossTreeProblems("backend/src/a.test.ts", files({ "backend/src/a.test.ts": narrow }), tracked)).toEqual([
      `backend/src/a.test.ts: names ${fe("src/x.ts")}, which no @test-watches glob covers`,
    ])
    const covered = `// @test-watches ${fe("src/x.ts")}\n${src}`
    expect(crossTreeProblems("backend/src/a.test.ts", files({ "backend/src/a.test.ts": covered }), tracked)).toEqual([])
    const always = `// @test-always walks the tree\n${src}`
    expect(crossTreeProblems("backend/src/a.test.ts", files({ "backend/src/a.test.ts": always }), tracked)).toEqual([])
  })

  it("a test that reads nothing needs nothing; a helper's reads are the test's, and its watches count", () => {
    const named = `const p = "${fe("src/x.ts")}"\n`
    expect(crossTreeProblems("backend/src/a.test.ts", files({ "backend/src/a.test.ts": named }), tracked)).toEqual([])
    const viaHelper = files({
      "backend/src/__tests__/a.test.ts": `import { load } from "./load.js"\n${named}`,
      "backend/src/__tests__/load.ts": "export const load = (p: string) => readFileSync(p)\n",
    })
    expect(crossTreeProblems("backend/src/__tests__/a.test.ts", viaHelper, tracked)).toHaveLength(1)
    const watchingHelper = files({
      "backend/src/__tests__/a.test.ts": `import { load } from "./load.js"\n${named}`,
      "backend/src/__tests__/load.ts": `// @test-watches ${fe("src/x.ts")}\nexport const load = (p: string) => readFileSync(p)\n`,
    })
    expect(crossTreeProblems("backend/src/__tests__/a.test.ts", watchingHelper, tracked)).toEqual([])
  })

  const names = (src: string) => namedPaths(src).map((n) => (n.under ? `${n.path}/…${n.ext ? `.${n.ext}` : ""}` : n.path)).sort()

  it("names paths in literals, templates, join() chains and constants, never in comments", () => {
    const src = [
      `const quotes = /"x'/g // a regex literal holding quotes never opens a string`,
      `// ${fe("src/commented.ts")} is prose`,
      `/* ${fe("src/block.ts")} too */`,
      `const REPO = join(__dirname, "..", "..")`,
      `const a = "../../../${fe("src/lib/a.ts")}"`,
      `readFileSync(a)`,
      `readFileSync(\`${fe("src/lib")}/\${name}.ts\`)`,
      `readFileSync(join(REPO, "${TREE}", "src", "x.ts"))`,
      `readFileSync(join(REPO, "${TREE}", "index.html"))`,
      `readFileSync(\`\${REPO}/${fe("src/tail.ts")}\`)`,
      `const FE = join(REPO, "${TREE}")`,
      `readFileSync(join(FE, "src/lib/b.tsx"))`,
      `readFileSync(join(FE, "src", "lib", file))`,
      `throw new Error("see ${fe("index.html")}.")`,
    ].join("\n")
    expect(names(src)).toEqual([fe("index.html"), fe("src/lib/…"), fe("src/lib/….ts"), fe("src/lib/a.ts"), fe("src/lib/b.tsx"), fe("src/tail.ts"), fe("src/x.ts")].sort())
    expect(names("throw new Error(`the " + TREE + " Run button: ${x}`)")).toEqual([])
  })

  it("a constant used on its own is named; one only composed into longer paths is not", () => {
    expect(names(`const FE = join(root, "${TREE}", "src")\nwalk(FE)\n`)).toEqual([fe("src")])
    expect(names(`const FE = join(root, "${TREE}", "src")\nreadFileSync(join(FE, "x.ts"))\n`)).toEqual([fe("src/x.ts")])
  })

  it("a directory or a dynamic prefix is covered only by a watch that admits a new file there", () => {
    expect(uncoveredPaths(`walk("${fe("src/lib")}")`, [fe("src/**/*.tsx")], tracked)).toEqual([])
    expect(uncoveredPaths(`walk("${fe("src/lib")}")`, [fe("src/lib/a.ts")], tracked)).toEqual([fe("src/lib")])
    expect(uncoveredPaths(`walk("${fe("src/lib")}")`, [fe("index.html")], tracked)).toEqual([fe("src/lib")])
    expect(uncoveredPaths(`readFileSync(\`${fe("src/lib")}/\${n}.ts\`)`, [fe("src/lib/*.ts")], tracked)).toEqual([])
    expect(uncoveredPaths(`readFileSync(\`${fe("src/lib")}/\${n}.ts\`)`, [fe("src/lib/*.tsx")], tracked)).toEqual([`${fe("src/lib")}/…`])
    expect(uncoveredPaths(`existsSync("${fe("src/gone.ts")}")`, [fe("src/*.ts")], tracked)).toEqual([])
    expect(uncoveredPaths(`existsSync("${fe("src/gone.ts")}")`, [fe("src/lib/*.ts")], tracked)).toEqual([fe("src/gone.ts")])
  })

  it("a wrong non-empty watch fails (review mutants)", () => {
    const problems = (src: string) => crossTreeProblems("backend/src/a.test.ts", files({ "backend/src/a.test.ts": src }), tracked)
    // m1: the file is read through a constant base the watch does not cover
    const m1 = `// @test-watches ${fe("index.html")}\nconst FE = join(REPO, "${TREE}")\nreadFileSync(join(FE, "src/lib/a.ts"))\n`
    expect(problems(m1)).toEqual([`backend/src/a.test.ts: names ${fe("src/lib/a.ts")}, which no @test-watches glob covers`])
    // m2: a dynamic file name under a directory, watched as one file
    const m2 = `// @test-watches ${fe("src/lib/a.ts")}\nreadFileSync(join(REPO, "${TREE}", "src", "lib", name))\n`
    expect(problems(m2)).toEqual([`backend/src/a.test.ts: names ${fe("src/lib")}/…, which no @test-watches glob covers`])
    // a walker whose watch was narrowed to a subdirectory
    const narrowed = `// @test-watches ${fe("src/lib/**/*.ts")}\nconst ROOTS = ["${fe("src")}"]\nfor (const r of ROOTS) readdirSync(join(REPO, r))\n`
    expect(problems(narrowed)).toEqual([`backend/src/a.test.ts: names ${fe("src")}, which no @test-watches glob covers`])
    expect(problems(narrowed.replace(fe("src/lib/**/*.ts"), fe("src/**/*.{ts,tsx}")))).toEqual([])
  })

  it("reads the discovery out of a workflow", () => {
    const yml = `          cross_tree_parity() {\n            cd backend\n            files=()\n            while IFS= read -r f; do files+=("$f"); done < <(\n              grep -rl -e '${TREE}/' src --include='*.test.ts' | sort\n            )\n            npx vitest run --testTimeout=30000 "\${files[@]}"\n          }\n`
    expect(parityDiscovery(yml)).toEqual({ cwd: "backend", grep: `grep -rl -e '${TREE}/' src --include='*.test.ts'` })
    expect(parityDiscovery(yml.replace("npx vitest run", "echo"))).toBeNull()
  })
})

