// @test-watches frontend/src/**/*.{ts,tsx}
import { describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import ts from "typescript"

/**
 * The app's SDK client (`lib/nodaro-client.ts`) is the SDK's core plus only
 * the resources the app calls — never `createClient()`'s full `NodaroClient`,
 * which loads every resource module. Nearly every frontend test reaches the
 * client through `api.ts`, so one VALUE import of `@nodaro/sdk/client` in
 * product code would make all of them depend on every SDK resource again: a
 * change to `resources/sessions.ts` selected 647 of 1457 frontend test files
 * that way (measured 2026-10-18), against 128 without it — none through the SDK.
 *
 * Type-only imports are fine (erased; `ee/shell/types.ts` names
 * `NodaroClient`). Need a resource? Add it to `AppNodaroClient`.
 */
const SRC = path.resolve(__dirname, "..", "..")
const FULL_CLIENT = new Set(["@nodaro/sdk/client", "@nodaro/sdk"])

/** Modules that need the full client by design, each with the reason. Only shrinks. */
const FULL_CLIENT_ALLOWED: Readonly<Record<string, string>> = {
  "ee/shell/app-header.tsx":
    "the shared site header's `sdk` prop is a full NodaroClient; the module is loaded lazily, only on a Cloud build with VITE_SHARED_HEADER on",
}

function productFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__" || e.name.startsWith(".")) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) productFiles(p, out)
    else if (/\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

/** `file:line` for every import of the full client that survives compilation. */
function valueImports(file: string): string[] {
  const text = fs.readFileSync(file, "utf8")
  if (!text.includes("@nodaro/sdk")) return []
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  const at = (n: ts.Node) => `${path.relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier) && FULL_CLIENT.has(n.moduleSpecifier.text)) {
      const typeOnly = ts.isImportDeclaration(n)
        ? n.importClause?.isTypeOnly === true ||
          (n.importClause !== undefined && !n.importClause.name && n.importClause.namedBindings !== undefined &&
            ts.isNamedImports(n.importClause.namedBindings) && n.importClause.namedBindings.elements.every((el) => el.isTypeOnly))
        : n.isTypeOnly
      if (!typeOnly) out.push(at(n))
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && FULL_CLIENT.has(n.arguments[0].text)) {
      out.push(at(n))
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

describe("the app's SDK client stays slim", () => {
  it("no product module loads @nodaro/sdk/client (the full client, every resource) at run time", () => {
    const offenders = productFiles(SRC)
      .filter((file) => !FULL_CLIENT_ALLOWED[path.relative(SRC, file)])
      .flatMap(valueImports)
    const stale = Object.keys(FULL_CLIENT_ALLOWED).filter((rel) => !fs.existsSync(path.join(SRC, rel)) || valueImports(path.join(SRC, rel)).length === 0)
    expect(stale, "allowed modules that no longer load the full client — drop them").toEqual([])
    expect(offenders, "build on AppNodaroClient (lib/nodaro-client.ts) — import only `type`s from @nodaro/sdk/client").toEqual([])
  })

  it("catches a value import and lets a type import through", () => {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "slim-"))
    try {
      const bad = path.join(tmp, "bad.ts")
      fs.writeFileSync(bad, `import { createClient, type NodaroClient } from "@nodaro/sdk/client"\nconst m = import("@nodaro/sdk/client")\n`)
      const ok = path.join(tmp, "ok.ts")
      fs.writeFileSync(ok, `import type { NodaroClient } from "@nodaro/sdk/client"\nimport { type ClientOptions } from "@nodaro/sdk/client"\n`)
      expect(valueImports(bad)).toHaveLength(2)
      expect(valueImports(ok)).toEqual([])
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
