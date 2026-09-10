// The harness must LOAD on a bare checkout.
//
// This repo's tool self-test CI job runs `node --test tools/__tests__/*.mjs`
// with no `npm ci` at all. One static `import "@nodaro/sdk"` anywhere in the
// harness tree turns every test in this directory red — and it would do so in
// a way that looks like the test's own fault rather than an import's. So the
// rule is checked directly: every module here imports only `node:` builtins
// and its own siblings, and every one of them is then actually imported to
// prove it.
//
// The credential rules are pinned the same way. `~/.config/nodaro` holds a CLI
// profile that can quietly authenticate a paid run against a deployment nobody
// meant to bill; this harness reads the environment and nothing else.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "scene3d-acceptance")

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(path))
    else if (entry.name.endsWith(".mjs")) out.push(path)
  }
  return out
}

const FILES = walk(ROOT)

/**
 * Source with its comments removed.
 *
 * The rules below are about what the CODE does, and this tree explains its
 * reasoning at length — `client.mjs` says in prose that it deliberately does
 * NOT read `~/.config/nodaro`, which a naive grep would read as it doing so.
 * `//` preceded by `:` is left alone so a URL inside a string survives.
 */
function code(file) {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}
/** `import x from "y"`, `export * from "y"`, `import "y"` — static forms only. */
const STATIC_IMPORT = /^\s*(?:import|export)\s+(?:[^;'"]*?\sfrom\s+)?["']([^"']+)["']/gm

test("the harness is a real tree of modules, not a stub", () => {
  assert.ok(FILES.length >= 10, `expected the harness modules, found ${FILES.length}`)
  const names = FILES.map((f) => relative(ROOT, f))
  for (const expected of ["scene3d-acceptance.mjs", "lib/receipt.mjs", "lib/client.mjs", "commands/authoring.mjs", "commands/benchmark.mjs"]) {
    assert.ok(names.includes(expected), `missing ${expected}`)
  }
})

test("every static import is a node: builtin or a sibling — nothing from node_modules", () => {
  const offenders = []
  for (const file of FILES) {
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(STATIC_IMPORT)) {
      const specifier = match[1]
      const ok = specifier.startsWith("node:") || specifier.startsWith("./") || specifier.startsWith("../")
      if (!ok) offenders.push(`${relative(ROOT, file)} → ${specifier}`)
    }
  }
  assert.deepEqual(offenders, [], "these must be dynamic imports inside a function, not static ones")
})

test("the SDK and the doctrine package are reached only through a dynamic import", () => {
  const client = readFileSync(join(ROOT, "lib/client.mjs"), "utf8")
  assert.ok(/await import\("@nodaro\/sdk"\)/.test(client), "the SDK import must be dynamic and inside the factory")
  const scoping = readFileSync(join(ROOT, "lib/scoping.mjs"), "utf8")
  assert.ok(/await import\("@nodaro\/prompts"\)/.test(scoping))
})

test("every module actually loads with no dependencies installed", async () => {
  for (const file of FILES) {
    if (file.endsWith("scene3d-acceptance.mjs")) continue // the entry point runs on import
    await assert.doesNotReject(() => import(file), `${relative(ROOT, file)} failed to load`)
  }
})

test("no module reads the CLI's profile directory", () => {
  for (const file of FILES) {
    const source = code(file)
    assert.equal(/\.config\/nodaro/.test(source), false, `${relative(ROOT, file)} reaches for the CLI profile`)
    assert.equal(/homedir\(\)|os\.homedir/.test(source), false, `${relative(ROOT, file)} reaches into the home directory`)
  }
})

test("the API key is read in exactly one place", () => {
  const readers = FILES.filter((file) => /process\.env\.NODARO_API_KEY/.test(code(file)))
    .map((file) => relative(ROOT, file))
    .sort()
  // client.mjs builds the authenticated client; harness.mjs passes the literal
  // to the receipt's secret scan so a leak is caught rather than committed.
  assert.deepEqual(readers, ["lib/client.mjs", "lib/harness.mjs"])
})

test("no fixture prompt is embedded in the tree", async () => {
  // The table prompt and the A/B common prompt are acceptance fixtures owned by
  // the plan repository. A copy here would be a leak into a publicly mirrored
  // repo AND a copy free to drift from the gate it is supposed to be.
  const { VEHICLE_PROMPT } = await import(join(ROOT, "commands/benchmark.mjs"))
  for (const file of FILES) {
    assert.equal(/round single-leg table|hard-shell suitcase/i.test(readFileSync(file, "utf8")), false, `${relative(ROOT, file)} embeds a fixture prompt`)
  }
  // The benchmark's own load-shape brief is deliberate and is NOT a fixture.
  assert.ok(VEHICLE_PROMPT.length > 100)
})
