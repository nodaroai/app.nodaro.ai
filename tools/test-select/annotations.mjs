// tools/test-select/annotations.mjs
// @reads-none parses only the source text it is given; SCANNER below names read calls, it makes none
// A test that reads files at run time (a guard that scans the source, a test
// that loads a fixture or a migration) has no import edge to what it reads,
// so the import graph can never select it. It declares what it reads instead:
//   // @test-watches <glob> [<glob>…]   — runs when a matching file changes
//   // @test-always <reason>            — runs on every change
// A file-reading test with neither runs on every change (the safe default)
// and is held on the burn-down list in untagged-scanners.json.
// A test-side HELPER that reads only the paths its caller passes it (a parse
// cache) has nothing of its own to declare — the importing test decides what
// is read, so the TEST must declare it:
//   // @test-reads-for-caller <reason>
// (see summarizeTest in test-node.mjs). A test or helper whose file reads
// never touch the repo (temp files it writes) says so:
//   // @test-reads-none <reason>
// `[ \t]`, never `\s`: an annotation must not span lines. With `\s` an empty
// `// @test-watches` swallowed the next source line as its globs — turning an
// always-run file reader into one selected by bogus globs. A trailing `*/`
// (one-line `/* @test-watches … */`, or a block comment's last line) is not a glob.
const WATCH = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@test-watches[ \t]+([^ \t\n].*?)[ \t]*(?:\*\/)?[ \t]*$/gm
const ALWAYS = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@test-always[ \t]+([^ \t\n].*?)[ \t]*(?:\*\/)?[ \t]*$/gm
const TEST_READS_NONE = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@test-reads-none[ \t]+([^ \t\n].*?)[ \t]*(?:\*\/)?[ \t]*$/gm
const FOR_CALLER = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@test-reads-for-caller[ \t]+([^ \t\n].*?)[ \t]*(?:\*\/)?[ \t]*$/gm
// A PRODUCT module that reads repo files at run time declares them, so a
// change to one of those files selects the tests that reach the module:
//   // @reads <glob> [<glob>…]      — the repo files it reads
//   // @reads-none <reason>         — its file reads never touch repo files
// Enforced by tools/__tests__/reads-guard.test.mjs (decided 2026-10-13).
const READS = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@reads[ \t]+([^ \t\n].*?)[ \t]*(?:\*\/)?[ \t]*$/gm
const READS_NONE = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@reads-none[ \t]+([^ \t\n].*?)[ \t]*(?:\*\/)?[ \t]*$/gm
// Over-matching is safe (the test just runs more often); under-matching is not.
// `toMatchFileSnapshot(` reads a golden, `lintFiles(` has ESLint read the
// source, and `new URL(…, import.meta.url)` builds a path to read — each was
// a reader the earlier list missed (video-overlay-graph's 16 goldens,
// rules-of-hooks, provider-base-urls). `addSourceFileAtPath(` has ts-morph
// read a file (parse-node-definitions reads nodes.ts that way), and
// `import.meta.glob` (also the generic `import.meta.glob<T>(…)` form) / a
// `?raw` import have Vite load files as text or modules with no static import
// edge to them. ts-morph's other loaders (`addSourceFilesAtPaths(`,
// `addSourceFileAtPathIfExists(`), `openSync(` (fontkit opens the overlay
// fonts that way) and `createRequire(` (hosting-ranges.ts loads its generated
// JSON through it, invisible to Vite's graph) read files too.
const SCANNER = /\b(?:readFileSync|readdirSync|readFile|readdir|opendir|globSync|existsSync|statSync|createReadStream|readJson|readJsonSync|toMatchFileSnapshot|lintFiles|addSourceFileAtPath|addSourceFileAtPathIfExists|addSourceFilesAtPaths|openSync|createRequire)\s*\(|["'](?:fast-glob|tinyglobby|glob)["']|\bexec(?:File)?(?:Sync)?\(\s*["'`]git\b|\bnew URL\([^)]*import\.meta\.url|\bimport\.meta\.glob\b|["'][^"'\n]*\?raw["']/

// An EMPTY annotation still matches the line regexes above: a one-line
// `/* @test-watches */` captures its own `*/`, and a CRLF file's
// `// @test-always \r` captures the `\r` (JS `$` matches before `\r`, and
// `[^ \t\n]` accepts it). Neither is a glob or a reason — an empty
// annotation declares nothing.
const globsOf = (captured) => captured.split(/[ \t\r]+/).filter((g) => g && g !== "*/")
const reasonOf = (captured) => {
  const reason = captured.trim()
  return reason && reason !== "*/" ? reason : null
}
// The first annotation that actually gives a reason (an empty one before it
// must not hide it).
const firstReason = (source, re) => {
  for (const m of source.matchAll(re)) {
    const reason = reasonOf(m[1])
    if (reason) return reason
  }
  return null
}

export function parseAnnotations(source) {
  const watches = [...source.matchAll(WATCH)].flatMap((m) => globsOf(m[1]))
  return { watches, always: firstReason(source, ALWAYS), forCaller: firstReason(source, FOR_CALLER), readsNone: firstReason(source, TEST_READS_NONE) }
}

export function parseReads(source) {
  const reads = [...source.matchAll(READS)].flatMap((m) => globsOf(m[1]))
  return { reads, readsNone: firstReason(source, READS_NONE) }
}

export function isScanner(source) {
  return SCANNER.test(source)
}

// Registries (§5.8 B, decided 2026-10-16). A generated aggregate of node
// units declares which of its imports are MEMBER edges and the collections it
// exports; a composer that re-exports a composed collection declares the
// names it is consumed through:
//   // @registry <glob>…                       — on an aggregate: imports of matching files are member edges
//   // @registry-exports <aggregate>: <Name>…  — on an aggregate or a composer
// A module that names a registry export says how it uses it:
//   // @registry-lookup <reason>        — product: only looks up an entry by a type it is given
//   // @registry-enumerates <reason>    — product: iterates the collection (what an undeclared one is assumed to do)
//   // @test-units-by-name <reason>     — test/helper: only looks up the unit types it names literally
// See tools/test-select/registry.mjs.
const REGISTRY = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@registry[ \t]+([^ \t\n].*?)[ \t]*(?:\*\/)?[ \t]*$/gm
const REGISTRY_EXPORTS = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@registry-exports[ \t]+([a-z][a-z0-9-]*):[ \t]*([^\n]*?)[ \t]*(?:\*\/)?[ \t]*$/gm
const REGISTRY_LOOKUP = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@registry-lookup[ \t]+([^ \t\n].*?)[ \t]*(?:\*\/)?[ \t]*$/gm
const REGISTRY_ENUMERATES = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@registry-enumerates[ \t]+([^ \t\n].*?)[ \t]*(?:\*\/)?[ \t]*$/gm
const UNITS_BY_NAME = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@test-units-by-name[ \t]+([^ \t\n].*?)[ \t]*(?:\*\/)?[ \t]*$/gm
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

export function parseRegistryAnnotations(source) {
  const members = [...source.matchAll(REGISTRY)].flatMap((m) => globsOf(m[1]))
  const exports = []
  for (const m of source.matchAll(REGISTRY_EXPORTS)) {
    const names = globsOf(m[2]).filter((n) => IDENTIFIER.test(n))
    if (names.length) exports.push({ aggregate: m[1], names })
  }
  return {
    members,
    exports,
    lookup: firstReason(source, REGISTRY_LOOKUP),
    enumerates: firstReason(source, REGISTRY_ENUMERATES),
    unitsByName: firstReason(source, UNITS_BY_NAME),
  }
}
