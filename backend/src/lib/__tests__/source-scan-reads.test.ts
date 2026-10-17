// @test-watches backend/src/lib/__tests__/source-scan.ts backend/src/lib/__tests__/source-ast.ts
/**
 * `source-scan.ts` reads exactly what it declares, and no caller can point it
 * anywhere else.
 *
 * Test selection runs a test that reads files when a file it reads changes:
 * the test declares `// @test-watches <glob>…`, and a test-side helper's
 * declaration flows into every test that imports it (tools/test-select/README.md).
 * The structural guards read backend/src through `source-scan.ts`, so its one
 * declaration, `backend/src/**\/*.ts`, is what selects all of them. That holds
 * only while the module cannot read outside it. A walker that took a directory
 * (the old `sourceFiles(dir)`) or a file (`parse(file)`) would read whatever its
 * caller passed, under a declaration that names none of it: the caller's test
 * would then be skipped on a change to a file it reads. So:
 *
 *  - the module's exports and their parameters are a fixed census: a new
 *    export, a new parameter, a re-export from anywhere but `source-ast.ts`,
 *    or a new import fails here until this file is updated on purpose;
 *  - so are its read sites: one `readdirSync` (the walk from `SRC`) and one
 *    `readFileSync` (each walked file), named imports only, `typescript` as a
 *    type only (a value import would reach `ts.sys.readFile`, which reads
 *    through TypeScript's own `fs` and never through the spy below), and no
 *    `require`, `import()` or `.sys` — so a read in a branch the run below
 *    never takes still fails here;
 *  - every path the module reads at run time is recorded (`node:fs` is
 *    spied, and the module is imported afresh inside the recording, so its
 *    top-level code is recorded too) and must be covered by its declaration —
 *    a directory it lists only by a glob that admits a NEW file there, so a
 *    declaration narrowed to part of the tree fails;
 *  - `source-ast.ts`, the parse-only half, reads nothing: no fs import, and of
 *    the TypeScript API only the parser (`ts.sys`, a program or a compiler
 *    host would read files).
 */
import { readFileSync } from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { isScanner, parseAnnotations } from "../../../../tools/test-select/annotations.mjs"
import { matchesAny } from "../../../../tools/test-select/glob.mjs"
import { SCAN_TIMEOUT_MS, SRC } from "./source-ast.js"

const spy = vi.hoisted(() => ({ recording: false, reads: [] as Array<{ fn: string; path: string }> }))

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>()
  // Every fs entry point that takes a path to read, list or probe.
  const READERS = /^(?:read|open|stat|lstat|exists|access|realpath|createReadStream|watch)/
  const wrapped: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(real)) {
    if (typeof value !== "function" || !READERS.test(name)) continue
    wrapped[name] = (...args: unknown[]) => {
      if (spy.recording) spy.reads.push({ fn: name, path: args[0] instanceof URL ? args[0].href : String(args[0]) })
      return (value as (...a: unknown[]) => unknown)(...args)
    }
  }
  return { ...real, ...wrapped, default: { ...real, ...wrapped } }
})

const REPO = resolve(SRC, "..", "..")
const HERE = "backend/src/lib/__tests__"
const SCAN = `${HERE}/source-scan.ts`
const AST = `${HERE}/source-ast.ts`
const readRepo = (p: string) => readFileSync(join(REPO, p), "utf8")

/** The exports `source-scan.ts` may have: each function with its parameter names. */
const FUNCTIONS: Readonly<Record<string, readonly string[]>> = {
  sourceFiles: [],
  eachSourceFile: ["needles", "fn"],
}
/**
 * The modules it may import, and how. A new one is a new way to read
 * (fs/promises, child_process); `typescript` as a value is `ts.sys`.
 */
const IMPORTS: Readonly<Record<string, "value" | "type">> = { "./source-ast.js": "value", "node:fs": "value", "node:path": "value", typescript: "type" }
/** The only names it may import from node:fs. */
const FS_NAMES = ["readFileSync", "readdirSync"]
/**
 * Its read sites, and the walk's: `<enclosing function>: <call>`. The walk
 * starts at `SRC` and recurses into what it lists; each file read is one the
 * walk returned. A change here is a change to what every importer reads.
 */
const READ_SITES = [
  "collect: readdirSync(dir, { withFileTypes: true })",
  "collect: collect(full, acc)",
  "sourceFiles: collect(SRC, [])",
  "eachSourceFile: readFileSync(file, \"utf8\")",
]
/** The bindings those calls read through. */
const BINDINGS = ["collect: const full = join(dir, entry.name)", "eachSourceFile: for (const file of sourceFiles())"]
/** Of the TypeScript API, `source-ast.ts` may use only the parser. */
const TS_API = ["createSourceFile", "ScriptTarget", "ScriptKind"]

const hasModifier = (n: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === kind)

/** Every way `source` departs from the census above, or [] when it matches. */
function censusProblems(source: string): string[] {
  const sf = ts.createSourceFile("source-scan.ts", source, ts.ScriptTarget.Latest, true)
  const problems: string[] = []
  const seen = new Set<string>()
  const imports = new Set<string>()
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
      imports.add(st.moduleSpecifier.text)
      continue
    }
    if (ts.isExportDeclaration(st)) {
      const from = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null
      if (from !== "./source-ast.js" || !st.exportClause) problems.push(`re-export ${st.getText(sf).split("\n")[0]} — only named re-exports from ./source-ast.js`)
      continue
    }
    if (ts.isExportAssignment(st)) {
      problems.push("a default export")
      continue
    }
    if (!hasModifier(st, ts.SyntaxKind.ExportKeyword)) continue
    if (!ts.isFunctionDeclaration(st) || !st.name) {
      problems.push(`export ${st.getText(sf).split("\n")[0]} — only the census functions are exported`)
      continue
    }
    const name = st.name.text
    const params = st.parameters.map((p) => p.name.getText(sf))
    const expected = FUNCTIONS[name]
    if (!expected) problems.push(`export function ${name}(${params.join(", ")}) — not in the census`)
    else if (params.join(",") !== expected.join(",")) problems.push(`export function ${name}(${params.join(", ")}) — the census has (${expected.join(", ")})`)
    seen.add(name)
  }
  for (const name of Object.keys(FUNCTIONS)) if (!seen.has(name)) problems.push(`export function ${name} is gone — update the census`)
  for (const spec of imports) if (!(spec in IMPORTS)) problems.push(`import from "${spec}" — not in the census`)
  return [...problems, ...readSiteProblems(sf)]
}

const enclosing = (n: ts.Node): string => {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) && p.name) return p.name.text
    if (ts.isArrowFunction(p) && ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name)) return p.parent.name.text
  }
  return "<module>"
}

/** Ways to read that no import census sees: `require`, `import()`, `ts.sys`. */
function escapeHatches(sf: ts.SourceFile): string[] {
  const found: string[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) found.push(`${enclosing(n)}: import(…)`)
    if (ts.isIdentifier(n) && ["require", "createRequire", "sys"].includes(n.text)) found.push(`${enclosing(n)}: ${n.text}`)
    if (ts.isImportEqualsDeclaration(n)) found.push(`import = ${n.getText(sf)}`)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return found
}

/** source-scan.ts's imports' shapes, its read sites and its walk, against the census. */
function readSiteProblems(sf: ts.SourceFile): string[] {
  const problems = escapeHatches(sf).map((h) => `${h} — reads past the census`)
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue
    const spec = st.moduleSpecifier.text
    const clause = st.importClause
    if (IMPORTS[spec] === "type" && !clause?.isTypeOnly) problems.push(`import from "${spec}" must be \`import type\` (a value import reaches ts.sys)`)
    if (spec === "node:fs") {
      const named = clause?.namedBindings
      const names = named && ts.isNamedImports(named) ? named.elements.map((e) => e.getText(sf)).sort() : null
      if (clause?.name || !names || names.join(",") !== FS_NAMES.join(",")) problems.push(`import from "node:fs" must be exactly { ${FS_NAMES.join(", ")} }`)
    }
  }
  const sites: string[] = []
  const bindings: string[] = []
  const NAMES = new Set([...FS_NAMES, "collect"])
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n) && NAMES.has(n.text) && !ts.isImportSpecifier(n.parent) && !ts.isFunctionDeclaration(n.parent)) {
      if (ts.isCallExpression(n.parent) && n.parent.expression === n) sites.push(`${enclosing(n)}: ${n.parent.getText(sf)}`)
      else problems.push(`${enclosing(n)}: ${n.text} used other than as a direct call — reads past the census`)
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && (n.name.text === "full" || n.name.text === "file")) {
      const stmt = ts.isForOfStatement(n.parent.parent) ? n.parent.parent : n.parent
      bindings.push(`${enclosing(n)}: ${ts.isForOfStatement(stmt) ? `for (${stmt.initializer.getText(sf)} of ${stmt.expression.getText(sf)})` : `const ${n.getText(sf)}`}`)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  const diff = (have: string[], want: readonly string[], what: string) => {
    for (const s of have.filter((x) => !want.includes(x))) problems.push(`${what} not in the census: ${s}`)
    for (const s of want.filter((x) => !have.includes(x))) problems.push(`${what} in the census is gone: ${s}`)
    if (have.length !== new Set(have).size) problems.push(`${what} repeated: ${have.join(" | ")}`)
  }
  diff(sites, READ_SITES, "read site")
  diff(bindings, BINDINGS, "binding")
  return problems
}

/** Every way source-ast.ts could read a file, or [] when it reads none. */
function astProblems(source: string): string[] {
  const sf = ts.createSourceFile("source-ast.ts", source, ts.ScriptTarget.Latest, true)
  const problems = escapeHatches(sf).map((h) => `${h} — source-ast.ts must read nothing`)
  if (isScanner(source)) problems.push("names a file-reading call (tools/test-select/annotations.mjs SCANNER)")
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && !["node:path", "node:url", "typescript"].includes(n.moduleSpecifier.text)) {
      problems.push(`import from "${n.moduleSpecifier.text}" — only node:path, node:url and typescript`)
    }
    if (ts.isIdentifier(n) && n.text === "ts" && !ts.isImportClause(n.parent) && !ts.isQualifiedName(n.parent)) {
      const access = ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n ? n.parent.name.text : null
      if (access === null) problems.push(`${enclosing(n)}: \`ts\` used other than as \`ts.<member>\``)
      else if (!TS_API.includes(access)) problems.push(`${enclosing(n)}: ts.${access} — only the parser (${TS_API.join(", ")})`)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return problems
}

/** Repo-relative POSIX path of a recorded read, or null when it is outside the repo. */
function repoPath(raw: string): string | null {
  const abs = raw.startsWith("file:") ? fileURLToPath(raw) : resolve(raw)
  const rel = relative(REPO, abs)
  return rel.startsWith("..") ? null : rel.split(sep).join("/")
}

type Read = { path: string; dir: boolean }

/**
 * The recorded reads no watch covers. A file is covered when a watch matches
 * it; a directory it lists only when a watch matches a NEW file in it and in a
 * new directory under it, so a walk of a tree never passes on a watch of part
 * of it.
 */
function uncovered(reads: readonly Read[], watches: readonly string[]): string[] {
  const probes = (dir: string) => [`${dir}/__probe__.ts`, `${dir}/__probe__/__probe__.ts`]
  return [...new Set(reads.filter(({ path, dir }) => (dir
    ? !probes(path).every((probe) => matchesAny(probe, watches))
    : !matchesAny(path, watches))).map((r) => r.path))]
}

describe("source-scan.ts's census: what it can read, read from its source", () => {
  const watches = parseAnnotations(readRepo(SCAN)).watches

  it("declares its reads", () => {
    expect(watches.length).toBeGreaterThan(0)
  })

  it("exports only the census functions, with their parameters, and reads only at the census sites", () => {
    expect(censusProblems(readRepo(SCAN)), "source-scan.ts must not take a directory or a path from its caller: its declaration is what selects every test that imports it").toEqual([])
  })

  it("its declaration admits a new file anywhere in the tree it walks", () => {
    expect(uncovered([{ path: "backend/src", dir: true }], watches)).toEqual([])
  })

  it("source-ast.ts, the parse-only half, reads no file", () => {
    expect(astProblems(readRepo(AST))).toEqual([])
  })
})

describe("source-scan.ts reads only what it declares, at run time", () => {
  const watches = parseAnnotations(readRepo(SCAN)).watches
  const recorded: Array<{ fn: string; path: string }> = []

  beforeAll(async () => {
    spy.reads.length = 0
    // A fresh import inside the window: the module's top-level code runs here.
    vi.resetModules()
    spy.recording = true
    try {
      const { eachSourceFile, sourceFiles } = await import("./source-scan.js")
      sourceFiles()
      eachSourceFile(["\u0000no file contains this"], () => {})
      eachSourceFile(["import"], () => {})
    } finally {
      spy.recording = false
    }
    recorded.push(...spy.reads)
  }, SCAN_TIMEOUT_MS)

  it("the spy sees its reads (so the check below is not vacuous)", () => {
    const paths = recorded.map((r) => repoPath(r.path))
    expect(paths).toContain("backend/src")
    expect(paths).toContain("backend/src/lib/config.ts")
    expect(recorded.length).toBeGreaterThan(500)
  })

  it("every path it reads at run time is covered by its @test-watches", () => {
    expect(recorded.filter((r) => repoPath(r.path) === null), "reads outside the repository").toEqual([])
    const reads = recorded.map((r) => ({ path: repoPath(r.path)!, dir: /^(?:readdir|opendir)/.test(r.fn) }))
    expect(uncovered(reads, watches), `widen source-scan.ts's @test-watches (${watches.join(" ")}) or stop reading these`).toEqual([])
  })

})

describe("the guard's own rules", () => {
  const base = readRepo(SCAN)

  it("passes the module as it is", () => {
    expect(censusProblems(base)).toEqual([])
  })

  it("fails a walker that takes its root from the caller", () => {
    expect(censusProblems(base.replace("export function sourceFiles(): string[] {", "export function sourceFiles(dir: string = SRC): string[] {")))
      .toEqual(["export function sourceFiles(dir) — the census has ()"])
    expect(censusProblems(`${base}\nexport function parse(file: string) { return file }\n`))
      .toEqual(["export function parse(file) — not in the census"])
    expect(censusProblems(`${base}\nexport const scanUnder = (dir: string) => dir\n`)).toHaveLength(1)
    expect(censusProblems(`${base}\nexport * from "./other.js"\n`)).toHaveLength(1)
    expect(censusProblems(`import { readFile } from "node:fs/promises"\n${base}`)).toEqual(['import from "node:fs/promises" — not in the census'])
  })

  it("fails a read the run never reaches, a read at the top level, and a read through ts.sys", () => {
    const topLevel = base.replace("export function sourceFiles(", `const EXTRA = readFileSync(join(SRC, "..", "..", "docs", "mcp", "tools.md"), "utf8")\nexport function sourceFiles(`)
    expect(censusProblems(topLevel)).toEqual(['read site not in the census: <module>: readFileSync(join(SRC, "..", "..", "docs", "mcp", "tools.md"), "utf8")'])
    const branch = base.replace(`fn(parseText(file, text), relPath(file))`, `fn(parseText(file, text), relPath(file))\n    if (needles.length > 99) readFileSync(join(SRC, "..", "x.md"))`)
    expect(censusProblems(branch).some((p) => p.startsWith("read site not in the census: eachSourceFile: readFileSync(join(SRC"))).toBe(true)
    const viaSys = base.replace(`import type ts from "typescript"`, `import ts from "typescript"`)
      .replace(`const text = readFileSync(file, "utf8")`, `const text = ts.sys.readFile(file) ?? ""`)
    expect(censusProblems(viaSys)).toEqual(expect.arrayContaining([
      'import from "typescript" must be `import type` (a value import reaches ts.sys)',
      "eachSourceFile: sys — reads past the census",
    ]))
    expect(censusProblems(base.replace(`import { readdirSync, readFileSync } from "node:fs"`, `import * as fs from "node:fs"`))).toContain('import from "node:fs" must be exactly { readFileSync, readdirSync }')
    expect(censusProblems(`${base}\nconst r = readFileSync\n`)).toContain("<module>: readFileSync used other than as a direct call — reads past the census")
    expect(censusProblems(`${base}\nexport function sourceFilesAsync() { return import("node:fs/promises") }\n`)).toContain("sourceFilesAsync: import(…) — reads past the census")
    expect(censusProblems(base.replace("collect(SRC, [])", `collect(join(SRC, ".."), [])`))).toContain('read site not in the census: sourceFiles: collect(join(SRC, ".."), [])')
  })

  it("source-ast.ts: fails an fs import, ts.sys and a compiler host", () => {
    const ast = readRepo(AST)
    expect(astProblems(`import { readFileSync } from "node:fs"\n${ast}`)).toEqual(expect.arrayContaining(['import from "node:fs" — only node:path, node:url and typescript']))
    expect(astProblems(`${ast}\nexport const read = (f: string) => ts.sys.readFile(f)\n`)).toEqual(expect.arrayContaining(["read: sys — source-ast.ts must read nothing", "read: ts.sys — only the parser (createSourceFile, ScriptTarget, ScriptKind)"]))
    expect(astProblems(`${ast}\nexport const host = () => ts.createCompilerHost({})\n`)).toEqual(["host: ts.createCompilerHost — only the parser (createSourceFile, ScriptTarget, ScriptKind)"])
    expect(astProblems(`${ast}\nconst t = ts\n`)).toEqual(["<module>: `ts` used other than as `ts.<member>`"])
  })

  it("fails a declaration narrowed to part of the tree, and a read of a second root", () => {
    const walk = (...paths: string[]) => paths.map((path) => ({ path, dir: !path.endsWith(".ts") }))
    expect(uncovered(walk("backend/src", "backend/src/lib/a.ts"), ["backend/src/lib/**/*.ts"])).toEqual(["backend/src"])
    expect(uncovered(walk("backend/src/lib", "backend/src/lib/a.ts"), ["backend/src/lib/*.ts"])).toEqual(["backend/src/lib"])
    expect(uncovered(walk("backend/scripts", "backend/scripts/x.ts"), ["backend/src/**/*.ts"])).toEqual(["backend/scripts", "backend/scripts/x.ts"])
    expect(uncovered(walk("backend/src", "backend/src/x.ts"), ["backend/src/**/*.ts"])).toEqual([])
  })
})
