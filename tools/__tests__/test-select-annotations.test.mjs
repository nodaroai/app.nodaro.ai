// tools/__tests__/test-select-annotations.test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { globToRegExp, matchesAny } from "../test-select/glob.mjs"
import { parseAnnotations, parseReads, isScanner } from "../test-select/annotations.mjs"

test("globs: ** spans directories, * stays inside one, braces alternate", () => {
  assert.ok(matchesAny("frontend/src/lib/i18n/en.ts", ["frontend/src/lib/i18n/*.ts"]))
  assert.ok(!matchesAny("frontend/src/lib/i18n/x/en.ts", ["frontend/src/lib/i18n/*.ts"]))
  assert.ok(matchesAny("frontend/src/a/b/c.tsx", ["frontend/src/**/*.{ts,tsx}"]))
  assert.ok(matchesAny("frontend/src/c.ts", ["frontend/src/**/*.{ts,tsx}"]))
  assert.ok(matchesAny("package.json", ["**/package.json"]))
  assert.ok(matchesAny("backend/package.json", ["**/package.json"]))
  assert.ok(matchesAny("frontend/vitest.config.ts", ["**/vitest.config.*"]))
  assert.ok(!matchesAny("frontend/src/vitest.config.ts.bak/x", ["**/vitest.config.*"]))
  assert.ok(matchesAny("tools/test-select/select.mjs", ["tools/test-select/**"]))
  assert.equal(globToRegExp("a.b").test("aXb"), false, "a dot is literal")
  assert.throws(() => globToRegExp("a{b"), /unclosed/)
})

test("annotations: @test-watches lines collect globs, @test-always gives a reason", () => {
  const src = [
    "// @test-watches frontend/src/lib/i18n/*.ts frontend/src/**/*.tsx",
    " * @test-watches supabase/migrations/*.sql",
    "import { x } from './x'",
  ].join("\n")
  assert.deepEqual(parseAnnotations(src), {
    watches: ["frontend/src/lib/i18n/*.ts", "frontend/src/**/*.tsx", "supabase/migrations/*.sql"],
    always: null,
    forCaller: null, readsNone: null,
  })
  assert.deepEqual(parseAnnotations("// @test-always walks the whole repo with git ls-files\n"), {
    watches: [],
    always: "walks the whole repo with git ls-files",
    forCaller: null, readsNone: null,
  })
  assert.deepEqual(parseAnnotations("const a = 1\n"), { watches: [], always: null, forCaller: null, readsNone: null })
})

test("scanner detection: tests that read files at run time", () => {
  assert.ok(isScanner('const s = readFileSync(path, "utf8")'))
  assert.ok(isScanner("for (const f of readdirSync(dir)) {}"))
  assert.ok(isScanner("await readFile(p)"))
  assert.ok(isScanner('import fg from "fast-glob"'))
  assert.ok(isScanner('execFileSync("git", ["ls-files"])'))
  assert.ok(isScanner('execSync("git ls-files")'))
  assert.ok(!isScanner('import { render } from "@testing-library/react"\nexpect(1).toBe(1)'))
})

test("globs: brace alternatives are globs themselves, and braces nest", () => {
  assert.ok(matchesAny("src/fooX.ts", ["src/{foo*,bar}.ts"]))
  assert.ok(matchesAny("src/bar.ts", ["src/{foo*,bar}.ts"]))
  assert.ok(!matchesAny("src/fooo/x.ts", ["src/{foo*,bar}.ts"]))
  assert.ok(matchesAny("src/a.ts", ["src/{*.ts,x}"]))
  assert.ok(matchesAny("src/x", ["src/{*.ts,x}"]))
  assert.ok(!matchesAny("src/a/b.ts", ["src/{*.ts,x}"]))
  assert.ok(matchesAny("a/d/e", ["a/{b,{c,d}}/e"]))
  assert.ok(matchesAny("a/b/e", ["a/{b,{c,d}}/e"]))
  assert.ok(!matchesAny("a/{c,d}/e", ["a/{b,{c,d}}/e"]))
  assert.ok(matchesAny("src/x/y/z.md", ["src/{**/*.md,none}"]))
  assert.throws(() => globToRegExp("a/{b,{c,d}/e"), /unclosed/)
})

test("annotations never span lines; a block-comment close is not a glob", () => {
  assert.deepEqual(parseAnnotations('// @test-watches\nimport x from "./y"\n'), { watches: [], always: null, forCaller: null, readsNone: null })
  assert.deepEqual(parseAnnotations("// @test-always\nconst a = readFileSync(x)\n"), { watches: [], always: null, forCaller: null, readsNone: null })
  assert.deepEqual(parseAnnotations("// @test-watches   \n// @test-always \t\nfoo\n"), { watches: [], always: null, forCaller: null, readsNone: null })
  assert.deepEqual(parseAnnotations("/* @test-watches backend/skills/** */"), { watches: ["backend/skills/**"], always: null, forCaller: null, readsNone: null })
  assert.deepEqual(parseAnnotations(" * @test-watches a/** b/*.md */").watches, ["a/**", "b/*.md"])
  assert.deepEqual(parseAnnotations("/* @test-always walks git ls-files */").always, "walks git ls-files")
  assert.deepEqual(parseAnnotations("// @test-watches a/** b.md\r\n// @test-always why\r\n"), { watches: ["a/**", "b.md"], always: "why", forCaller: null, readsNone: null })
})

test("@reads collects globs; @reads-none gives a reason; neither is mistaken for the other", () => {
  assert.deepEqual(parseReads("// @reads backend/skills/**/*.md docs/**\nconst x = 1\n"), { reads: ["backend/skills/**/*.md", "docs/**"], readsNone: null })
  assert.deepEqual(parseReads("// @reads-none reads only temp files it creates\n"), { reads: [], readsNone: "reads only temp files it creates" })
  assert.deepEqual(parseReads("// @reads\nimport x from './y'\n"), { reads: [], readsNone: null })
  assert.deepEqual(parseReads("/* @reads supabase/migrations/*.sql */"), { reads: ["supabase/migrations/*.sql"], readsNone: null })
})

test("scanner detection covers streams and json helpers", () => {
  assert.ok(isScanner("fs.createReadStream(p)"))
  assert.ok(isScanner("await readJson(p)"))
  assert.ok(isScanner("readJsonSync(p)"))
})

test("an empty one-line block annotation or a CRLF-trailing empty one declares nothing", () => {
  assert.deepEqual(parseAnnotations("/* @test-watches */"), { watches: [], always: null, forCaller: null, readsNone: null })
  assert.deepEqual(parseAnnotations("/** @test-always */"), { watches: [], always: null, forCaller: null, readsNone: null })
  assert.deepEqual(parseAnnotations("// @test-watches \r\nx"), { watches: [], always: null, forCaller: null, readsNone: null })
  assert.deepEqual(parseAnnotations("// @test-always \r\n"), { watches: [], always: null, forCaller: null, readsNone: null })
  assert.deepEqual(parseReads("/* @reads */"), { reads: [], readsNone: null })
  assert.deepEqual(parseReads("/** @reads-none */"), { reads: [], readsNone: null })
  assert.deepEqual(parseReads("// @reads \r\nx"), { reads: [], readsNone: null })
  assert.deepEqual(parseReads("// @reads-none \r\n"), { reads: [], readsNone: null })
})

test("scanner detection covers file snapshots, ESLint over files, and paths built from import.meta.url", () => {
  assert.ok(isScanner('await expect(out).toMatchFileSnapshot("./__goldens__/x.txt")'))
  assert.ok(isScanner('const results = await eslint.lintFiles(["src/**/*.ts"])'))
  assert.ok(isScanner('parse(new URL("../../providers/kie/client.ts", import.meta.url).pathname)'))
  assert.ok(isScanner("const dir = fileURLToPath(new URL('.', import.meta.url))"))
  assert.ok(!isScanner('const u = new URL("https://api.kie.ai/x")'))
})

test("scanner detection covers ts-morph file loads, Vite globs and ?raw imports", () => {
  assert.ok(isScanner('const sf = project.addSourceFileAtPath(nodesPath)'))
  assert.ok(isScanner('const mods = import.meta.glob("./locales/*.json", { eager: true })'))
  assert.ok(isScanner('import doc from "../../docs/nodes/README.md?raw"'))
  assert.ok(!isScanner('const raw = await res.text()\nconst q = "a?b"'))
})

test("scanner detection covers generic import.meta.glob, openSync, createRequire and the other ts-morph loaders", () => {
  assert.ok(isScanner('const m = import.meta.glob<{ default: string }>("./summaries/*.generated.ts")'))
  assert.ok(isScanner("const font = fontkit.openSync(path)"))
  assert.ok(isScanner("const require = createRequire(import.meta.url)"))
  assert.ok(isScanner('project.addSourceFilesAtPaths(["src/**/*.ts"])'))
  assert.ok(isScanner("project.addSourceFileAtPathIfExists(candidate)"))
})

test("@test-reads-for-caller gives a reason, on its own line, and is never a watch or an always", () => {
  assert.deepEqual(parseAnnotations("// @test-reads-for-caller reads only the files its caller passes\nimport fs from 'node:fs'\n"),
    { watches: [], always: null, forCaller: "reads only the files its caller passes", readsNone: null })
  assert.equal(parseAnnotations("/* @test-reads-for-caller x */").forCaller, "x")
  assert.equal(parseAnnotations(" * @test-reads-for-caller reads what it is given\n */").forCaller, "reads what it is given")
  assert.deepEqual(parseAnnotations("// @test-reads-for-caller\nconst a = readFileSync(x)\n"), { watches: [], always: null, forCaller: null, readsNone: null })
  assert.deepEqual(parseAnnotations("/* @test-reads-for-caller */"), { watches: [], always: null, forCaller: null, readsNone: null })
  assert.deepEqual(parseAnnotations("// @test-reads-for-caller \r\nx"), { watches: [], always: null, forCaller: null, readsNone: null })
  assert.deepEqual(parseAnnotations("// @test-always why\r\n").forCaller, null)
  assert.deepEqual(parseReads("// @test-reads-for-caller x\n"), { reads: [], readsNone: null })
})

test("@test-reads-none gives a reason; it is not the product @reads-none and empty declares nothing", () => {
  assert.equal(parseAnnotations("// @test-reads-none reads only temp files\n").readsNone, "reads only temp files")
  assert.equal(parseAnnotations("/* @test-reads-none x */").readsNone, "x")
  assert.equal(parseAnnotations("// @test-reads-none \r\n").readsNone, null)
  assert.equal(parseAnnotations("// @reads-none product reason\n").readsNone, null)
  assert.deepEqual(parseReads("// @test-reads-none x\n"), { reads: [], readsNone: null })
})
