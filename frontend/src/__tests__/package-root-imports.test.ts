// @test-watches frontend/**/*.{ts,tsx,mts,cts,mjs,cjs,js} backend/**/*.{ts,tsx,mts,cts,mjs,cjs,js} packages/**/*.{ts,tsx,mts,cts,mjs,cjs,js} scripts/**/*.{ts,tsx,mts,cts,mjs,cjs,js} tools/**/*.{ts,tsx,mts,cts,mjs,cjs,js}
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { loadEntryMaps } from "../../../tools/package-entries/codemod.mjs"

/**
 * No app code imports the ROOT of @nodaro/shared, @nodaro/prompts or
 * @nodaro/sdk — every import names the subpath entry that owns the symbol
 * (`@nodaro/shared/<entry>`, `@nodaro/prompts/<entry>`, `@nodaro/sdk/<entry>`).
 *
 * Why: a root import loads the whole package, ~110 ms of CPU for shared and
 * ~165 ms for prompts per test file (measured 2026-10-13, against 3–60 ms for
 * one entry), and makes every package module "relevant" to the importer, so
 * affected-test selection cannot tell a caption change from a pricing change
 * (for the SDK: one resource from another — #2313 selected 579 of 683 frontend
 * test files through the SDK's root alone).
 *
 * It also catches a ROOT `vi.mock` / `vi.doMock` / `vi.importActual`: once the
 * code under test imports a subpath, a root mock intercepts nothing and the
 * test silently runs against the real module. The same failure has a subpath
 * form — a `vi.mock("@nodaro/shared/<entry>", …)` (or prompts / sdk) override of a name that
 * entry does not export (moved, renamed, or never there) is inert — so every
 * override key of a subpath mock must be exported by that entry.
 *
 * Fix an offender with the codemod, which knows every symbol's entry:
 *   node tools/package-entries/codemod.mjs --write <file>
 *
 * ROOT_ALLOWED is the burn-down: files that need the whole package by design,
 * each with the reason. Every entry must still import a root, so it only shrinks.
 */
const ROOT_ALLOWED: Readonly<Record<string, string>> = {
  "frontend/src/lib/i18n/__tests__/picker-labels-coverage.test.ts":
    "spreads EVERY export of both packages (`{ ...prompts, ...shared }`) to find each catalog label a picker can show — a subpath would hide the catalogs of the other entries",
  "packages/client/src/__tests__/fixtures/client-api-compat.ts":
    "a consumer of the BUILT @nodaro/sdk, compiled (never run) by client-core.test.ts to pin the public API — it imports the root the way every external consumer of a pre-subpath version does, and needs the whole namespace to check every exported resource class",
}

const ROOTS = new Set(["@nodaro/shared", "@nodaro/prompts", "@nodaro/sdk"])
const ROOT_LITERAL = /["'`]@nodaro\/(?:shared|prompts|sdk)["'`]/
const REPO = path.resolve(__dirname, "..", "..", "..")
// Everywhere code can import the packages from: the apps (src, scripts,
// configs), every package, and the repo's tools/scripts. The packages' own
// index.ts and src/entries/ ARE the roots; their tests import the package by a
// computed specifier to compare root with entries. (@nodaro/sdk lives in
// packages/client.)
const SCAN = ["frontend", "backend", "packages", "scripts", "tools"]
const SKIP = /^packages\/(shared|prompts|client)\/src\/(index\.ts$|entries\/)/
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "playwright-report", "test-results"])
const LOADERS = new Set(["import", "require", "vi.mock", "vi.doMock", "vi.unmock", "vi.doUnmock", "vi.importActual", "vi.importMock"])

function walk(rel: string, out: string[]): void {
  for (const e of fs.readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue
    const r = `${rel}/${e.name}`
    if (e.isDirectory()) walk(r, out)
    else if (/\.(ts|tsx|mts|cts|mjs|cjs|js)$/.test(e.name) && !SKIP.test(r)) out.push(r)
  }
}

function callee(call: ts.CallExpression): string | null {
  const e = call.expression
  if (e.kind === ts.SyntaxKind.ImportKeyword) return "import"
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression)) return `${e.expression.text}.${e.name.text}`
  return null
}

/** `file:line kind "<root>"` for every place the file loads, mocks or type-queries a root. */
function rootUses(rel: string, text: string): string[] {
  const kind = rel.endsWith("x") ? ts.ScriptKind.TSX : /\.[mc]?js$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind)
  const out: string[] = []
  const hit = (node: ts.Node, what: string, spec: string) =>
    out.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${what} "${spec}"`)
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && ROOTS.has(node.moduleSpecifier.text)) {
      hit(node, ts.isImportDeclaration(node) ? "import" : "export … from", node.moduleSpecifier.text)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal) && ROOTS.has(node.argument.literal.text)) {
      hit(node, "import() type", node.argument.literal.text)
    } else if (ts.isCallExpression(node)) {
      const name = callee(node)
      const arg = node.arguments[0]
      if (name && LOADERS.has(name) && arg && ts.isStringLiteralLike(arg) && ROOTS.has(arg.text)) hit(node, `${name}()`, arg.text)
    } else if (ts.isExternalModuleReference(node) && ts.isStringLiteralLike(node.expression) && ROOTS.has(node.expression.text)) {
      hit(node, "import = require()", node.expression.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

type EntryMaps = Record<string, { entries: string[]; nameToEntries: Map<string, string[]> }>
const SUBPATH_MOCK = /vi\.(?:do)?[mM]ock\(\s*["'`]@nodaro\/(?:shared|prompts|sdk)\//

/** `file:line` for every override key of a subpath vi.mock that the entry does not export. */
function deadMockKeys(rel: string, text: string, maps: EntryMaps): string[] {
  const kind = rel.endsWith("x") ? ts.ScriptKind.TSX : /\.[mc]?js$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind)
  const out: string[] = []
  const unwrap = (n: ts.Node): ts.Node => (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) ? unwrap(n.expression) : n)
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ["vi.mock", "vi.doMock"].includes(callee(node) ?? "")) {
      const [arg, factory] = node.arguments
      const m = arg && ts.isStringLiteralLike(arg) ? /^(@nodaro\/(?:shared|prompts|sdk))\/([\w-]+)$/.exec(arg.text) : null
      if (m && factory && (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))) {
        const [, pkg, entry] = m
        // A standalone subpath outside the root (`@nodaro/sdk/supabase`) is not an entry: nothing to check.
        if (!maps[pkg]?.entries.includes(entry)) return ts.forEachChild(node, visit)
        let obj: ts.Node | undefined
        if (!ts.isBlock(factory.body)) obj = unwrap(factory.body)
        else {
          const last = factory.body.statements[factory.body.statements.length - 1]
          if (last && ts.isReturnStatement(last) && last.expression) obj = unwrap(last.expression)
        }
        if (obj && ts.isObjectLiteralExpression(obj)) {
          for (const p of obj.properties) {
            if (ts.isSpreadAssignment(p) || !p.name || !(ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name))) continue
            const owners = maps[pkg]?.nameToEntries.get(p.name.text) ?? []
            if (!owners.includes(entry)) {
              out.push(`${rel}:${sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1} ${m[0]} overrides \`${p.name.text}\`, ${owners.length ? `which is exported by ${owners.map((o) => `${pkg}/${o}`).join(", ")}` : `which ${pkg} does not export`}`)
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

function scanFiles(): string[] {
  const files: string[] = []
  for (const d of SCAN) walk(d, files)
  return files
}

describe("package root imports", () => {
  it("the scanner sees every way a root can be named", () => {
    const sample = [
      `import { a } from "@nodaro/shared"`,
      `import type { B } from '@nodaro/prompts'`,
      `export { c } from "@nodaro/shared"`,
      `type T = import("@nodaro/shared").X`,
      `const m = await import("@nodaro/prompts")`,
      `vi.mock("@nodaro/shared", async (o) => ({ ...(await o<typeof import("@nodaro/shared")>()) }))`,
      `const r = await vi.importActual<object>("@nodaro/prompts")`,
      `const q = require("@nodaro/shared")`,
      `import { NotFoundError } from "@nodaro/sdk"`,
      `vi.mock("@nodaro/sdk", () => ({}))`,
      `import { ok } from "@nodaro/shared/models"`,
      `import { createClient } from "@nodaro/sdk/client"`,
      `const s = "@nodaro/shared is a package" // a string is not an import`,
    ].join("\n")
    expect(rootUses("sample.ts", sample).map((h) => h.replace(/^sample\.ts:\d+ /, ""))).toEqual([
      `import "@nodaro/shared"`,
      `import "@nodaro/prompts"`,
      `export … from "@nodaro/shared"`,
      `import() type "@nodaro/shared"`,
      `import() "@nodaro/prompts"`,
      `vi.mock() "@nodaro/shared"`,
      `import() type "@nodaro/shared"`,
      `vi.importActual() "@nodaro/prompts"`,
      `require() "@nodaro/shared"`,
      `import "@nodaro/sdk"`,
      `vi.mock() "@nodaro/sdk"`,
    ])
  })

  // Reads ~7,000 source files; generous for a loaded CI box.
  it("no app code imports, mocks or type-queries a package root; the allowlist only shrinks", { timeout: 60_000 }, () => {
    const files = scanFiles()
    const offenders: string[] = []
    const allowedUsed = new Set<string>()
    for (const rel of files) {
      const text = fs.readFileSync(path.join(REPO, rel), "utf8")
      // Only a file that spells a root as a whole string literal can use one;
      // parse just those (subpath importers are nearly every file).
      if (!ROOT_LITERAL.test(text)) continue
      const uses = rootUses(rel, text)
      if (!uses.length) continue
      if (ROOT_ALLOWED[rel]) allowedUsed.add(rel)
      else offenders.push(...uses)
    }
    expect(files.length, "the scan found no files — the repo layout changed").toBeGreaterThan(5000)
    expect(files, "tools/ and backend/scripts are scanned too").toEqual(expect.arrayContaining(["tools/scene3d-acceptance/lib/scoping.mjs", "backend/scripts/gen-skills.ts"]))
    expect(offenders, `root imports of @nodaro/shared / @nodaro/prompts / @nodaro/sdk — run: node tools/package-entries/codemod.mjs --write <file>`).toEqual([])
    expect(Object.keys(ROOT_ALLOWED).filter((f) => !allowedUsed.has(f)), "allowlisted files that no longer import a root — remove them from ROOT_ALLOWED").toEqual([])
  })

  it("every override of a subpath vi.mock is a name that entry exports", { timeout: 60_000 }, () => {
    const maps = loadEntryMaps() as EntryMaps
    expect(deadMockKeys("sample.ts", `vi.mock("@nodaro/shared/models", async (o) => ({ ...(await o()), MODEL_CATALOG: [], notAName: 1 }))`, maps)).toEqual([
      "sample.ts:1 @nodaro/shared/models overrides \`MODEL_CATALOG\`, which is exported by @nodaro/shared/model-catalog",
      "sample.ts:1 @nodaro/shared/models overrides \`notAName\`, which @nodaro/shared does not export",
    ])
    expect(deadMockKeys("sample.ts", `vi.mock("@nodaro/sdk/client", async (o) => ({ ...(await o()), NotFoundError: class {} }))`, maps)).toEqual([
      "sample.ts:1 @nodaro/sdk/client overrides \`NotFoundError\`, which is exported by @nodaro/sdk/errors",
    ])
    expect(deadMockKeys("sample.ts", `vi.mock("@nodaro/sdk/supabase", () => ({ createSharedSupabaseClient: vi.fn() }))`, maps)).toEqual([])
    const dead: string[] = []
    for (const rel of scanFiles()) {
      const text = fs.readFileSync(path.join(REPO, rel), "utf8")
      if (SUBPATH_MOCK.test(text)) dead.push(...deadMockKeys(rel, text, maps))
    }
    expect(dead, "a subpath mock overrides a name its entry does not export — the override is inert; mock the owning entry or drop the key").toEqual([])
  })
})
